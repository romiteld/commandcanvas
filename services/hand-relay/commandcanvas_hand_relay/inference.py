from __future__ import annotations

import hashlib
import math
import threading
import warnings
from dataclasses import dataclass
from enum import Enum
from io import BytesIO
from pathlib import Path
from typing import Any, Callable, Protocol

import numpy as np
from PIL import Image, UnidentifiedImageError

from .model_manifest import PRODUCTION_MODEL_MANIFEST, ModelManifest


MODEL_ID = PRODUCTION_MODEL_MANIFEST.repository
MODEL_REVISION = PRODUCTION_MODEL_MANIFEST.revision
MODEL_SHA256 = PRODUCTION_MODEL_MANIFEST.sha256
MODEL_LICENSE = PRODUCTION_MODEL_MANIFEST.release_license
INPUT_SIZE = PRODUCTION_MODEL_MANIFEST.input_size
OUTPUT_SHAPE = PRODUCTION_MODEL_MANIFEST.output_shape
CONFIDENCE_THRESHOLD = 0.45


class BackendInputKind(str, Enum):
    LETTERBOXED_TENSOR = "letterboxed_tensor"
    RGB_FRAME = "rgb_frame"


class CudaUnavailable(RuntimeError):
    pass


class ModelUnavailable(RuntimeError):
    pass


class FrameRejected(ValueError):
    pass


@dataclass(frozen=True)
class LetterboxTransform:
    source_width: int
    source_height: int
    scale: float
    offset_x: int
    offset_y: int


class SessionLike(Protocol):
    def get_providers(self) -> list[str]: ...
    def get_provider_options(self) -> dict[str, dict[str, str]]: ...
    def get_inputs(self) -> list[Any]: ...
    def get_outputs(self) -> list[Any]: ...
    def run(
        self, outputs: object, feeds: dict[str, np.ndarray]
    ) -> list[np.ndarray]: ...


class YoloCudaBackend:
    ready = True
    warm = True
    unavailable_reason: str | None = None
    input_kind = BackendInputKind.LETTERBOXED_TENSOR

    def __init__(
        self,
        session: SessionLike,
        *,
        input_name: str,
        device: str,
        manifest: ModelManifest,
    ):
        self._session = session
        self._input_name = input_name
        self.device = device
        self.manifest = manifest
        self.input_size = manifest.input_size
        self._lock = threading.Lock()

    @classmethod
    def load(
        cls,
        model_path: str | Path,
        *,
        manifest: ModelManifest = PRODUCTION_MODEL_MANIFEST,
        ort_module: Any | None = None,
        device_probe: Callable[[int], str] | None = None,
        warmup_runs: int = 3,
        gpu_mem_limit_bytes: int = 805_306_368,
    ) -> "YoloCudaBackend":
        path = Path(model_path)
        if not path.is_file():
            raise ModelUnavailable("Pinned YOLO hand-pose model is unavailable.")
        if path.stat().st_size != manifest.byte_size:
            raise ModelUnavailable("Pinned YOLO hand-pose model byte size did not match.")
        if _sha256(path) != manifest.sha256:
            raise ModelUnavailable("Pinned YOLO hand-pose model SHA-256 did not match.")
        if ort_module is None:
            import onnxruntime as ort_module  # type: ignore[no-redef]
        if "CUDAExecutionProvider" not in ort_module.get_available_providers():
            raise CudaUnavailable("CUDAExecutionProvider is unavailable.")

        options = ort_module.SessionOptions()
        options.graph_optimization_level = (
            ort_module.GraphOptimizationLevel.ORT_ENABLE_ALL
        )
        options.add_session_config_entry("session.disable_cpu_ep_fallback", "1")
        providers = [
            (
                "CUDAExecutionProvider",
                {
                    "device_id": 0,
                    "arena_extend_strategy": "kSameAsRequested",
                    "gpu_mem_limit": gpu_mem_limit_bytes,
                    "cudnn_conv_algo_search": "HEURISTIC",
                    "do_copy_in_default_stream": 1,
                },
            )
        ]
        try:
            session: SessionLike = ort_module.InferenceSession(
                str(path), sess_options=options, providers=providers
            )
        except Exception as error:
            raise CudaUnavailable("CUDA model session could not initialize.") from error
        active = session.get_providers()
        if not active or active[0] != "CUDAExecutionProvider":
            raise CudaUnavailable("CUDAExecutionProvider did not activate.")
        inputs = session.get_inputs()
        outputs = session.get_outputs()
        if (
            len(inputs) != 1
            or inputs[0].name != manifest.input_name
            or getattr(inputs[0], "type", None) != manifest.input_type
            or tuple(inputs[0].shape) != manifest.input_shape
            or len(outputs) != 1
            or outputs[0].name != manifest.output_name
            or getattr(outputs[0], "type", None) != manifest.output_type
            or tuple(outputs[0].shape) != manifest.output_shape
        ):
            raise ModelUnavailable(
                "CommandCanvas model tensors do not match the selected manifest."
            )
        provider_options = session.get_provider_options().get(
            "CUDAExecutionProvider", {}
        )
        try:
            device_id = int(provider_options.get("device_id", "0"))
        except (TypeError, ValueError):
            raise CudaUnavailable("CUDA device identity is unavailable.") from None
        probe = device_probe or _probe_cuda_device
        try:
            device = probe(device_id).strip()
        except Exception as error:
            raise CudaUnavailable("CUDA device identity is unavailable.") from error
        if len(device) < 3:
            raise CudaUnavailable("CUDA device identity is unavailable.")

        warmup = np.zeros(manifest.input_shape, dtype=np.float32)
        try:
            for _ in range(max(1, warmup_runs)):
                result = session.run(None, {inputs[0].name: warmup})
                output = np.asarray(result[0]) if len(result) == 1 else None
                if (
                    output is None
                    or output.shape != manifest.output_shape
                    or not np.all(np.isfinite(output))
                ):
                    raise ModelUnavailable(
                        "CUDA warmup returned an incompatible model output."
                    )
        except ModelUnavailable:
            raise
        except Exception as error:
            raise CudaUnavailable("CUDA model warmup failed.") from error
        return cls(
            session,
            input_name=inputs[0].name,
            device=device,
            manifest=manifest,
        )

    def infer(
        self,
        tensor: np.ndarray,
        transform: LetterboxTransform,
    ) -> list[dict[str, Any]]:
        with self._lock:
            # The relay intentionally performs one short, warmed CUDA call at a
            # time. Keeping the call in this process avoids a second executor
            # queue retaining stale frames behind the protocol's one-in-flight
            # boundary.
            output = self._session.run(None, {self._input_name: tensor})
        if len(output) != 1:
            raise ModelUnavailable("YOLO hand-pose returned an incompatible output.")
        return parse_output(np.asarray(output[0]), transform)


@dataclass(frozen=True)
class UnavailableBackend:
    unavailable_reason: str
    manifest: ModelManifest = PRODUCTION_MODEL_MANIFEST
    device: str = "CUDA device unavailable"
    ready: bool = False
    warm: bool = False
    input_kind: BackendInputKind = BackendInputKind.LETTERBOXED_TENSOR

    @property
    def input_size(self) -> int:
        return self.manifest.input_size

    def infer(self, _tensor: np.ndarray, _transform: object) -> list[dict[str, Any]]:
        raise CudaUnavailable("Relay inference is unavailable.")


def decode_frame(
    data: bytes,
    *,
    declared_mime: str,
    max_frame_bytes: int,
    max_width: int,
    max_height: int,
    input_size: int = INPUT_SIZE,
) -> tuple[np.ndarray, LetterboxTransform]:
    pixels = decode_rgb_frame(
        data,
        declared_mime=declared_mime,
        max_frame_bytes=max_frame_bytes,
        max_width=max_width,
        max_height=max_height,
    )
    height, width = pixels.shape[:2]
    rgb = Image.fromarray(pixels)

    if input_size not in {320, 640}:
        raise ValueError("CommandCanvas supports only manifest input sizes.")
    scale = min(input_size / width, input_size / height)
    rendered_width = max(1, min(input_size, round(width * scale)))
    rendered_height = max(1, min(input_size, round(height * scale)))
    offset_x = (input_size - rendered_width) // 2
    offset_y = (input_size - rendered_height) // 2
    resized = rgb.resize((rendered_width, rendered_height), Image.Resampling.BILINEAR)
    canvas = Image.new("RGB", (input_size, input_size), (114, 114, 114))
    canvas.paste(resized, (offset_x, offset_y))
    normalized = np.asarray(canvas, dtype=np.float32) / np.float32(255.0)
    tensor = np.ascontiguousarray(normalized.transpose(2, 0, 1)[None, ...])
    return tensor, LetterboxTransform(
        source_width=width,
        source_height=height,
        scale=scale,
        offset_x=offset_x,
        offset_y=offset_y,
    )


def decode_rgb_frame(
    data: bytes,
    *,
    declared_mime: str,
    max_frame_bytes: int,
    max_width: int,
    max_height: int,
) -> np.ndarray:
    """Decode one bounded browser frame without retaining encoded bytes."""

    if not data or len(data) > max_frame_bytes:
        raise FrameRejected("Frame bytes exceed the advertised bound.")
    expected_format = {"image/jpeg": "JPEG", "image/webp": "WEBP"}.get(declared_mime)
    if expected_format is None:
        raise FrameRejected("Frame format is not supported.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data)) as image:
                if image.format != expected_format:
                    raise FrameRejected("Declared frame format does not match bytes.")
                width, height = image.size
                if (
                    width <= 0
                    or height <= 0
                    or width > max_width
                    or height > max_height
                ):
                    raise FrameRejected("Frame dimensions exceed the advertised bound.")
                image.load()
                # Copy before leaving Pillow's context. The returned uint8
                # array is the only raw-frame representation retained during
                # the synchronous inference call.
                rgb = np.asarray(image.convert("RGB"), dtype=np.uint8).copy()
    except FrameRejected:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError):
        raise FrameRejected("Frame decode failed.") from None
    except Image.DecompressionBombWarning:
        raise FrameRejected("Frame dimensions exceed the advertised bound.") from None
    return np.ascontiguousarray(rgb)


def parse_output(
    output: np.ndarray,
    transform: LetterboxTransform,
    *,
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
    max_hands: int = 2,
) -> list[dict[str, Any]]:
    if output.shape != OUTPUT_SHAPE:
        raise ModelUnavailable(
            "CommandCanvas expected YOLO hand-pose output [1,300,69]."
        )
    rows = [
        (row, float(output[0, row, 4]))
        for row in range(OUTPUT_SHAPE[1])
        if math.isfinite(float(output[0, row, 4]))
        and float(output[0, row, 4]) >= confidence_threshold
    ]
    rows.sort(key=lambda item: item[1], reverse=True)
    hands: list[dict[str, Any]] = []
    for row, confidence in rows[: max(1, min(2, max_hands))]:
        box_values = [float(output[0, row, index]) for index in range(4)]
        if not all(math.isfinite(value) for value in box_values):
            raise ModelUnavailable("YOLO hand-pose returned a non-finite box.")
        x1, y1, x2, y2 = box_values
        normalized_x1 = _clamp(
            (min(x1, x2) - transform.offset_x)
            / transform.scale
            / transform.source_width
        )
        normalized_x2 = _clamp(
            (max(x1, x2) - transform.offset_x)
            / transform.scale
            / transform.source_width
        )
        normalized_y1 = _clamp(
            (min(y1, y2) - transform.offset_y)
            / transform.scale
            / transform.source_height
        )
        normalized_y2 = _clamp(
            (max(y1, y2) - transform.offset_y)
            / transform.scale
            / transform.source_height
        )
        landmarks: list[dict[str, float]] = []
        for index in range(21):
            offset = 6 + index * 3
            x = float(output[0, row, offset])
            y = float(output[0, row, offset + 1])
            visibility = float(output[0, row, offset + 2])
            if not all(math.isfinite(value) for value in (x, y, visibility)):
                raise ModelUnavailable("YOLO hand-pose returned a non-finite landmark.")
            normalized_x = (
                (x - transform.offset_x) / transform.scale / transform.source_width
            )
            normalized_y = (
                (y - transform.offset_y) / transform.scale / transform.source_height
            )
            landmarks.append(
                {
                    "x": _round(_clamp(normalized_x)),
                    "y": _round(_clamp(normalized_y)),
                    # This pinned model exposes x/y plus keypoint visibility,
                    # not metric depth. Zero is explicit rather than relabeling
                    # visibility as a fabricated z coordinate.
                    "z": 0.0,
                    "visibility": _round(_clamp(visibility)),
                }
            )
        hands.append(
            {
                "confidence": _round(_clamp(confidence)),
                "handedness": "unknown",
                "boundingBox": {
                    "x": _round(normalized_x1),
                    "y": _round(normalized_y1),
                    "width": _round(normalized_x2 - normalized_x1),
                    "height": _round(normalized_y2 - normalized_y1),
                },
                "landmarks": landmarks,
            }
        )
    return hands


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _probe_cuda_device(device_id: int) -> str:
    import pynvml

    pynvml.nvmlInit()
    try:
        handle = pynvml.nvmlDeviceGetHandleByIndex(device_id)
        raw_name = pynvml.nvmlDeviceGetName(handle)
        name = (
            raw_name.decode("utf-8") if isinstance(raw_name, bytes) else str(raw_name)
        )
        return f"{name} (CUDA device {device_id})"
    finally:
        pynvml.nvmlShutdown()


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


def _round(value: float) -> float:
    return round(value, 6)
