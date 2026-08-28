from __future__ import annotations

import hashlib
import math
import threading
import warnings
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any, Callable, Protocol

import numpy as np
from PIL import Image, UnidentifiedImageError


MODEL_ID = "poptoz/yolo26-hand-pose-face-detection"
MODEL_REVISION = "2abb91a7030e1aa5231ec900ccb2c07ab3f03460"
MODEL_SHA256 = "07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc"
MODEL_LICENSE = "AGPL-3.0"
INPUT_SIZE = 320
OUTPUT_SHAPE = (1, 300, 69)
CONFIDENCE_THRESHOLD = 0.45


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

    def __init__(self, session: SessionLike, *, input_name: str, device: str):
        self._session = session
        self._input_name = input_name
        self.device = device
        self._lock = threading.Lock()

    @classmethod
    def load(
        cls,
        model_path: str | Path,
        *,
        expected_sha256: str = MODEL_SHA256,
        ort_module: Any | None = None,
        device_probe: Callable[[int], str] | None = None,
        warmup_runs: int = 3,
        gpu_mem_limit_bytes: int = 805_306_368,
    ) -> "YoloCudaBackend":
        path = Path(model_path)
        if not path.is_file():
            raise ModelUnavailable("Pinned YOLO hand-pose model is unavailable.")
        if _sha256(path) != expected_sha256:
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
            or list(inputs[0].shape) != [1, 3, INPUT_SIZE, INPUT_SIZE]
            or len(outputs) != 1
            or list(outputs[0].shape) != list(OUTPUT_SHAPE)
        ):
            raise ModelUnavailable(
                "CommandCanvas requires model tensors [1,3,320,320] and [1,300,69]."
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

        warmup = np.zeros((1, 3, INPUT_SIZE, INPUT_SIZE), dtype=np.float32)
        try:
            for _ in range(max(1, warmup_runs)):
                result = session.run(None, {inputs[0].name: warmup})
                if len(result) != 1 or np.asarray(result[0]).shape != OUTPUT_SHAPE:
                    raise ModelUnavailable(
                        "CUDA warmup returned an incompatible model output."
                    )
        except ModelUnavailable:
            raise
        except Exception as error:
            raise CudaUnavailable("CUDA model warmup failed.") from error
        return cls(session, input_name=inputs[0].name, device=device)

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
    device: str = "CUDA device unavailable"
    ready: bool = False
    warm: bool = False

    def infer(self, _tensor: np.ndarray, _transform: object) -> list[dict[str, Any]]:
        raise CudaUnavailable("Relay inference is unavailable.")


def decode_frame(
    data: bytes,
    *,
    declared_mime: str,
    max_frame_bytes: int,
    max_width: int,
    max_height: int,
) -> tuple[np.ndarray, LetterboxTransform]:
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
                rgb = image.convert("RGB")
    except FrameRejected:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError):
        raise FrameRejected("Frame decode failed.") from None
    except Image.DecompressionBombWarning:
        raise FrameRejected("Frame dimensions exceed the advertised bound.") from None

    scale = min(INPUT_SIZE / width, INPUT_SIZE / height)
    rendered_width = max(1, min(INPUT_SIZE, round(width * scale)))
    rendered_height = max(1, min(INPUT_SIZE, round(height * scale)))
    offset_x = (INPUT_SIZE - rendered_width) // 2
    offset_y = (INPUT_SIZE - rendered_height) // 2
    resized = rgb.resize((rendered_width, rendered_height), Image.Resampling.BILINEAR)
    canvas = Image.new("RGB", (INPUT_SIZE, INPUT_SIZE), (114, 114, 114))
    canvas.paste(resized, (offset_x, offset_y))
    pixels = np.asarray(canvas, dtype=np.float32) / np.float32(255.0)
    tensor = np.ascontiguousarray(pixels.transpose(2, 0, 1)[None, ...])
    return tensor, LetterboxTransform(
        source_width=width,
        source_height=height,
        scale=scale,
        offset_x=offset_x,
        offset_y=offset_y,
    )


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
