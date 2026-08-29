from __future__ import annotations

import hashlib
import math
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Protocol, Sequence

import numpy as np

from .hybrid_pose import (
    FrameBox,
    HybridPoseError,
    PoseEstimate,
    decode_detector_output,
    decode_simcc,
    prepare_detector_input,
    prepare_pose_batch,
)
from .inference import BackendInputKind, CudaUnavailable, ModelUnavailable
from .model_manifest import (
    RTMDET_HAND_DETECTOR_CANDIDATE,
    RTMPOSE_HAND_REFINER_CANDIDATE,
    DetectorCandidateManifest,
    PoseRefinerCandidateManifest,
)


DETECTOR_CONFIDENCE_THRESHOLD = 0.3
MAX_HANDS = 2


@dataclass(frozen=True)
class HybridRuntimeManifest:
    """Capability metadata for the exact two-stage runtime pair."""

    variant: str
    repository: str
    revision: str
    precision: str
    keypoints: int
    release_license: str
    input_size: int


HYBRID_RUNTIME_MANIFEST = HybridRuntimeManifest(
    variant="rtmdet_nano_hand_320_rtmpose_m_distill_256",
    repository="rtmdet-nano-hand+rtmpose-m-distill",
    revision=hashlib.sha256(
        (
            f"{RTMDET_HAND_DETECTOR_CANDIDATE.model_sha256}+"
            f"{RTMPOSE_HAND_REFINER_CANDIDATE.sha256}"
        ).encode("ascii")
    ).hexdigest(),
    precision="fp32",
    keypoints=21,
    release_license="Apache-2.0",
    input_size=RTMDET_HAND_DETECTOR_CANDIDATE.input_shape[-1],
)


class SessionLike(Protocol):
    def get_providers(self) -> list[str]: ...
    def get_provider_options(self) -> dict[str, dict[str, str]]: ...
    def get_inputs(self) -> list[Any]: ...
    def get_outputs(self) -> list[Any]: ...
    def run(
        self, outputs: object, feeds: dict[str, np.ndarray]
    ) -> list[np.ndarray]: ...


class HybridCudaBackend:
    """Pinned RTMDet hand detection followed by batched RTMPose refinement."""

    ready = True
    warm = True
    unavailable_reason: str | None = None
    manifest = HYBRID_RUNTIME_MANIFEST
    input_kind = BackendInputKind.RGB_FRAME

    def __init__(
        self,
        detector_session: SessionLike,
        pose_session: SessionLike,
        *,
        detector_input_name: str,
        pose_input_name: str,
        detector_manifest: DetectorCandidateManifest,
        pose_manifest: PoseRefinerCandidateManifest,
        device: str,
    ):
        self._detector_session = detector_session
        self._pose_session = pose_session
        self._detector_input_name = detector_input_name
        self._pose_input_name = pose_input_name
        self._detector_manifest = detector_manifest
        self._pose_manifest = pose_manifest
        self.device = device
        self.input_size = detector_manifest.input_shape[-1]
        self._lock = threading.Lock()

    @classmethod
    def load(
        cls,
        detector_model_path: str | Path,
        pose_model_path: str | Path,
        *,
        detector_manifest: DetectorCandidateManifest = RTMDET_HAND_DETECTOR_CANDIDATE,
        pose_manifest: PoseRefinerCandidateManifest = RTMPOSE_HAND_REFINER_CANDIDATE,
        ort_module: Any | None = None,
        device_probe: Callable[[int], str] | None = None,
        warmup_runs: int = 3,
        gpu_mem_limit_bytes: int = 805_306_368,
    ) -> "HybridCudaBackend":
        detector_path = Path(detector_model_path)
        pose_path = Path(pose_model_path)
        _validate_model_file(
            detector_path,
            expected_size=detector_manifest.model_byte_size,
            expected_sha256=detector_manifest.model_sha256,
            label="RTMDet",
        )
        _validate_model_file(
            pose_path,
            expected_size=pose_manifest.byte_size,
            expected_sha256=pose_manifest.sha256,
            label="RTMPose",
        )
        if ort_module is None:
            import onnxruntime as ort_module  # type: ignore[no-redef]
        if "CUDAExecutionProvider" not in ort_module.get_available_providers():
            raise CudaUnavailable("CUDAExecutionProvider is unavailable.")

        # Each ONNX Runtime session owns an independent CUDA arena. Divide the
        # configured process budget so opting into two stages does not silently
        # double the service's advertised limit.
        per_session_limit = max(1, gpu_mem_limit_bytes // 2)
        detector_session = _create_cuda_session(
            detector_path,
            ort_module=ort_module,
            gpu_mem_limit_bytes=per_session_limit,
            label="RTMDet",
        )
        _validate_detector_contract(detector_session, detector_manifest)
        detector_device_id = _active_cuda_device(detector_session, label="RTMDet")

        pose_session = _create_cuda_session(
            pose_path,
            ort_module=ort_module,
            gpu_mem_limit_bytes=per_session_limit,
            label="RTMPose",
        )
        _validate_pose_contract(pose_session, pose_manifest)
        pose_device_id = _active_cuda_device(pose_session, label="RTMPose")
        if pose_device_id != detector_device_id:
            raise CudaUnavailable(
                "Hybrid CUDA sessions activated on different devices."
            )

        probe = device_probe or _probe_cuda_device
        try:
            device = probe(detector_device_id).strip()
        except Exception as error:
            raise CudaUnavailable("CUDA device identity is unavailable.") from error
        if len(device) < 3:
            raise CudaUnavailable("CUDA device identity is unavailable.")

        detector_input = detector_session.get_inputs()[0].name
        pose_input = pose_session.get_inputs()[0].name
        detector_warmup = np.zeros(detector_manifest.input_shape, dtype=np.float32)
        pose_warmup = np.zeros((1, *pose_manifest.input_shape[1:]), dtype=np.float32)
        try:
            for _ in range(max(1, warmup_runs)):
                detector_outputs = detector_session.run(
                    list(detector_manifest.output_names),
                    {detector_input: detector_warmup},
                )
                _validate_detector_values(detector_outputs)
                pose_outputs = pose_session.run(
                    list(pose_manifest.output_names),
                    {pose_input: pose_warmup},
                )
                _validate_pose_values(pose_outputs, batch_size=1)
        except ModelUnavailable:
            raise
        except Exception as error:
            raise CudaUnavailable("Hybrid CUDA model warmup failed.") from error

        return cls(
            detector_session,
            pose_session,
            detector_input_name=detector_input,
            pose_input_name=pose_input,
            detector_manifest=detector_manifest,
            pose_manifest=pose_manifest,
            device=device,
        )

    def infer_rgb(self, frame_rgb: np.ndarray) -> list[dict[str, Any]]:
        try:
            detector_tensor, detector_transform = prepare_detector_input(
                frame_rgb,
                input_size=self._detector_manifest.input_shape[-1],
            )
            with self._lock:
                detector_outputs = self._detector_session.run(
                    list(self._detector_manifest.output_names),
                    {self._detector_input_name: detector_tensor},
                )
                _validate_detector_values(detector_outputs)
                boxes = decode_detector_output(
                    np.asarray(detector_outputs[0]),
                    np.asarray(detector_outputs[1]),
                    detector_transform,
                    confidence_threshold=DETECTOR_CONFIDENCE_THRESHOLD,
                    max_hands=MAX_HANDS,
                )
                if not boxes:
                    return []
                pose_tensor, pose_transforms = prepare_pose_batch(
                    frame_rgb,
                    boxes,
                    input_size=self._pose_manifest.input_shape[-1],
                )
                pose_outputs = self._pose_session.run(
                    list(self._pose_manifest.output_names),
                    {self._pose_input_name: pose_tensor},
                )
                _validate_pose_values(pose_outputs, batch_size=len(boxes))
            estimates = decode_simcc(
                np.asarray(pose_outputs[0]),
                np.asarray(pose_outputs[1]),
                pose_transforms,
                split_ratio=self._pose_manifest.simcc_split_ratio,
            )
            return _hand_results(
                boxes,
                estimates,
                frame_rgb.shape[1],
                frame_rgb.shape[0],
            )
        except ModelUnavailable:
            raise
        except HybridPoseError as error:
            raise ModelUnavailable(
                "Hybrid hand-pose output was incompatible."
            ) from error
        except Exception as error:
            raise ModelUnavailable("Hybrid CUDA inference failed.") from error


def _create_cuda_session(
    path: Path,
    *,
    ort_module: Any,
    gpu_mem_limit_bytes: int,
    label: str,
) -> SessionLike:
    options = ort_module.SessionOptions()
    options.graph_optimization_level = ort_module.GraphOptimizationLevel.ORT_ENABLE_ALL
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
        ),
        "CPUExecutionProvider",
    ]
    try:
        return ort_module.InferenceSession(
            str(path),
            sess_options=options,
            providers=providers,
        )
    except Exception as error:
        raise CudaUnavailable(
            f"{label} CUDA model session could not initialize."
        ) from error


def _validate_detector_contract(
    session: SessionLike,
    manifest: DetectorCandidateManifest,
) -> None:
    inputs = session.get_inputs()
    outputs = session.get_outputs()
    if (
        len(inputs) != 1
        or not _tensor_matches(
            inputs[0], manifest.input_name, manifest.input_type, manifest.input_shape
        )
        or len(outputs) != 2
        or not all(
            _tensor_matches(tensor, name, tensor_type, shape)
            for tensor, name, tensor_type, shape in zip(
                outputs,
                manifest.output_names,
                manifest.output_types,
                manifest.output_shapes,
            )
        )
    ):
        raise ModelUnavailable("RTMDet tensor contract did not match the manifest.")


def _validate_pose_contract(
    session: SessionLike,
    manifest: PoseRefinerCandidateManifest,
) -> None:
    inputs = session.get_inputs()
    outputs = session.get_outputs()
    if (
        len(inputs) != 1
        or not _tensor_matches(
            inputs[0], manifest.input_name, manifest.input_type, manifest.input_shape
        )
        or len(outputs) != 2
        or not all(
            _tensor_matches(
                tensor,
                name,
                tensor_type,
                shape,
                allow_symbolic_axes=frozenset({1}),
            )
            for tensor, name, tensor_type, shape in zip(
                outputs,
                manifest.output_names,
                manifest.output_types,
                manifest.output_shapes,
            )
        )
    ):
        raise ModelUnavailable("RTMPose tensor contract did not match the manifest.")


def _tensor_matches(
    tensor: Any,
    expected_name: str,
    expected_type: str,
    expected_shape: Sequence[int | str],
    *,
    allow_symbolic_axes: frozenset[int] = frozenset(),
) -> bool:
    actual_shape = tuple(getattr(tensor, "shape", ()))
    if (
        getattr(tensor, "name", None) != expected_name
        or getattr(tensor, "type", None) != expected_type
        or len(actual_shape) != len(expected_shape)
    ):
        return False
    for axis, (actual, expected) in enumerate(zip(actual_shape, expected_shape)):
        if isinstance(expected, int):
            if actual == expected:
                continue
            if (
                axis in allow_symbolic_axes
                and isinstance(actual, str)
                and bool(actual)
            ):
                continue
            return False
        if not isinstance(actual, str) or not actual:
            return False
    return True


def _active_cuda_device(session: SessionLike, *, label: str) -> int:
    providers = session.get_providers()
    if not providers or providers[0] != "CUDAExecutionProvider":
        raise CudaUnavailable(f"{label} CUDAExecutionProvider did not activate.")
    options = session.get_provider_options().get("CUDAExecutionProvider", {})
    try:
        return int(options.get("device_id", "0"))
    except (TypeError, ValueError):
        raise CudaUnavailable(f"{label} CUDA device identity is unavailable.") from None


def _validate_detector_values(outputs: object) -> None:
    if not isinstance(outputs, list) or len(outputs) != 2:
        raise ModelUnavailable("RTMDet returned an incompatible output.")
    detections = np.asarray(outputs[0])
    labels = np.asarray(outputs[1])
    if (
        detections.ndim != 3
        or detections.shape[0] != 1
        or detections.shape[2] != 5
        or labels.ndim != 2
        or labels.shape != detections.shape[:2]
        or not np.issubdtype(detections.dtype, np.floating)
        or not np.issubdtype(labels.dtype, np.integer)
        or not np.all(np.isfinite(detections))
    ):
        raise ModelUnavailable("RTMDet returned an incompatible output.")


def _validate_pose_values(outputs: object, *, batch_size: int) -> None:
    if not isinstance(outputs, list) or len(outputs) != 2:
        raise ModelUnavailable("RTMPose returned an incompatible output.")
    simcc_x = np.asarray(outputs[0])
    simcc_y = np.asarray(outputs[1])
    expected_shape = (batch_size, 21, 512)
    if (
        simcc_x.shape != expected_shape
        or simcc_y.shape != expected_shape
        or not np.issubdtype(simcc_x.dtype, np.floating)
        or not np.issubdtype(simcc_y.dtype, np.floating)
        or not np.all(np.isfinite(simcc_x))
        or not np.all(np.isfinite(simcc_y))
    ):
        raise ModelUnavailable("RTMPose returned an incompatible output.")


def _hand_results(
    boxes: Sequence[FrameBox],
    estimates: Sequence[PoseEstimate],
    frame_width: int,
    frame_height: int,
) -> list[dict[str, Any]]:
    if len(boxes) != len(estimates) or len(boxes) > MAX_HANDS:
        raise ModelUnavailable(
            "Hybrid hand-pose stages returned different hand counts."
        )
    hands: list[dict[str, Any]] = []
    for box, estimate in zip(boxes, estimates):
        confidence = _rounded(
            min(estimate.detector_confidence, estimate.pose_confidence)
        )
        hands.append(
            {
                "confidence": confidence,
                "handedness": "unknown",
                "boundingBox": {
                    "x": _rounded(_clamp(box.x / frame_width)),
                    "y": _rounded(_clamp(box.y / frame_height)),
                    "width": _rounded(_clamp(box.width / frame_width)),
                    "height": _rounded(_clamp(box.height / frame_height)),
                },
                "landmarks": [
                    {
                        "x": _rounded(_clamp(landmark.x)),
                        "y": _rounded(_clamp(landmark.y)),
                        "z": 0.0,
                        "visibility": _rounded(_clamp(landmark.visibility)),
                    }
                    for landmark in estimate.landmarks
                ],
            }
        )
    return hands


def _validate_model_file(
    path: Path,
    *,
    expected_size: int,
    expected_sha256: str,
    label: str,
) -> None:
    if not path.is_file():
        raise ModelUnavailable(f"Pinned {label} model is unavailable.")
    if path.stat().st_size != expected_size:
        raise ModelUnavailable(f"Pinned {label} model byte size did not match.")
    if _sha256(path) != expected_sha256:
        raise ModelUnavailable(f"Pinned {label} model SHA-256 did not match.")


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
            raw_name.decode("utf-8")
            if isinstance(raw_name, bytes)
            else str(raw_name)
        )
        return f"{name} (CUDA device {device_id})"
    finally:
        pynvml.nvmlShutdown()


def _clamp(value: float) -> float:
    if not math.isfinite(value):
        raise ModelUnavailable("Hybrid hand-pose result was non-finite.")
    return min(1.0, max(0.0, value))


def _rounded(value: float) -> float:
    return round(float(value), 6)
