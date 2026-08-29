from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable

import numpy as np
import pytest

from helpers import SIGNING_KEY, image_bytes

from commandcanvas_hand_relay import app as app_module
from commandcanvas_hand_relay.app import _decode_and_infer, create_app
from commandcanvas_hand_relay.config import RelaySettings, SettingsError, load_settings
from commandcanvas_hand_relay.inference import (
    BackendInputKind,
    CudaUnavailable,
    ModelUnavailable,
)
from commandcanvas_hand_relay.model_manifest import (
    RTMDET_HAND_DETECTOR_CANDIDATE,
    RTMPOSE_HAND_REFINER_CANDIDATE,
)


ORIGIN = "https://commandcanvas.vercel.app"


class FakeTensor:
    def __init__(self, name: str, tensor_type: str, shape: list[Any]):
        self.name = name
        self.type = tensor_type
        self.shape = shape


class FakeSession:
    def __init__(
        self,
        *,
        inputs: list[FakeTensor],
        outputs: list[FakeTensor],
        result: Callable[[dict[str, np.ndarray]], list[np.ndarray]],
        providers: list[str] | None = None,
        device_id: str = "0",
    ):
        self._inputs = inputs
        self._outputs = outputs
        self._result = result
        self._providers = providers or ["CUDAExecutionProvider"]
        self._device_id = device_id
        self.calls: list[dict[str, np.ndarray]] = []

    def get_inputs(self) -> list[FakeTensor]:
        return self._inputs

    def get_outputs(self) -> list[FakeTensor]:
        return self._outputs

    def get_providers(self) -> list[str]:
        return self._providers

    def get_provider_options(self) -> dict[str, dict[str, str]]:
        return {"CUDAExecutionProvider": {"device_id": self._device_id}}

    def run(
        self, _output_names: object, feeds: dict[str, np.ndarray]
    ) -> list[np.ndarray]:
        copied = {name: np.asarray(value).copy() for name, value in feeds.items()}
        self.calls.append(copied)
        return self._result(feeds)


class FakeSessionOptions:
    def __init__(self) -> None:
        self.entries: dict[str, str] = {}
        self.graph_optimization_level: object = None

    def add_session_config_entry(self, key: str, value: str) -> None:
        self.entries[key] = value


class FakeOrt:
    class GraphOptimizationLevel:
        ORT_ENABLE_ALL = "all"

    def __init__(
        self,
        sessions: list[FakeSession],
        *,
        available: list[str] | None = None,
        require_cpu_bookkeeping: bool = False,
    ):
        self.sessions = list(sessions)
        self.available = available or ["CUDAExecutionProvider", "CPUExecutionProvider"]
        self.require_cpu_bookkeeping = require_cpu_bookkeeping
        self.options: list[FakeSessionOptions] = []
        self.requested_providers: list[object] = []

    def get_available_providers(self) -> list[str]:
        return self.available

    def SessionOptions(self) -> FakeSessionOptions:
        value = FakeSessionOptions()
        self.options.append(value)
        return value

    def InferenceSession(
        self,
        _path: str,
        *,
        sess_options: FakeSessionOptions,
        providers: object,
    ) -> FakeSession:
        assert sess_options in self.options
        self.requested_providers.append(providers)
        if self.require_cpu_bookkeeping:
            if "session.disable_cpu_ep_fallback" in sess_options.entries:
                raise RuntimeError("hybrid graph requires CPU bookkeeping nodes")
            if not isinstance(providers, list) or providers[-1] != "CPUExecutionProvider":
                raise RuntimeError("CPUExecutionProvider was not an ordered fallback")
        return self.sessions.pop(0)


def detector_session(
    *,
    result: Callable[[dict[str, np.ndarray]], list[np.ndarray]] | None = None,
    input_name: str = "input",
    output_names: tuple[str, str] = ("dets", "labels"),
    output_shapes: tuple[list[Any], list[Any]] = (
        [1, "detections", 5],
        [1, "detections"],
    ),
    providers: list[str] | None = None,
) -> FakeSession:
    def empty(_feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        return [
            np.zeros((1, 1, 5), dtype=np.float32),
            np.zeros((1, 1), dtype=np.int64),
        ]

    return FakeSession(
        inputs=[FakeTensor(input_name, "tensor(float)", [1, 3, 320, 320])],
        outputs=[
            FakeTensor(output_names[0], "tensor(float)", output_shapes[0]),
            FakeTensor(output_names[1], "tensor(int64)", output_shapes[1]),
        ],
        result=result or empty,
        providers=providers,
    )


def pose_session(
    *,
    peak_x: int = 256,
    peak_y: int = 256,
    score: float = 0.8,
    input_name: str = "input",
    output_shapes: tuple[list[Any], list[Any]] = (
        ["batch", 21, 512],
        ["batch", 21, 512],
    ),
    result_override: Callable[[dict[str, np.ndarray]], list[np.ndarray]] | None = None,
    providers: list[str] | None = None,
) -> FakeSession:
    def result(feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        batch = feeds[input_name].shape[0]
        x = np.zeros((batch, 21, 512), dtype=np.float32)
        y = np.zeros((batch, 21, 512), dtype=np.float32)
        x[:, :, peak_x] = score
        y[:, :, peak_y] = score
        return [x, y]

    return FakeSession(
        inputs=[FakeTensor(input_name, "tensor(float)", ["batch", 3, 256, 256])],
        outputs=[
            FakeTensor("simcc_x", "tensor(float)", output_shapes[0]),
            FakeTensor("simcc_y", "tensor(float)", output_shapes[1]),
        ],
        result=result_override or result,
        providers=providers,
    )


def model_file(tmp_path: Path, name: str, content: bytes) -> Path:
    path = tmp_path / name
    path.write_bytes(content)
    return path


def candidate_manifests(detector_path: Path, pose_path: Path) -> tuple[Any, Any]:
    detector = replace(
        RTMDET_HAND_DETECTOR_CANDIDATE,
        model_byte_size=detector_path.stat().st_size,
        model_sha256=hashlib.sha256(detector_path.read_bytes()).hexdigest(),
    )
    pose = replace(
        RTMPOSE_HAND_REFINER_CANDIDATE,
        byte_size=pose_path.stat().st_size,
        sha256=hashlib.sha256(pose_path.read_bytes()).hexdigest(),
    )
    return detector, pose


def relay_settings(**overrides: Any) -> RelaySettings:
    values: dict[str, Any] = {
        "signing_key": SIGNING_KEY,
        "allowed_origins": frozenset({ORIGIN}),
        "model_path": "/models/yolo.onnx",
    }
    values.update(overrides)
    return RelaySettings(**values)


def settings_environment(**overrides: str) -> dict[str, str]:
    import base64

    values = {
        "PRIVATE_HAND_RELAY_SIGNING_KEY": base64.urlsafe_b64encode(bytes(range(32)))
        .rstrip(b"=")
        .decode("ascii"),
        "PRIVATE_HAND_RELAY_ALLOWED_ORIGINS": ORIGIN,
        "PRIVATE_HAND_RELAY_MODEL_PATH": "/models/yolo.onnx",
    }
    values.update(overrides)
    return values


def test_hybrid_backend_is_explicit_opt_in_and_requires_both_model_paths() -> None:
    default = load_settings(settings_environment())

    assert default.backend_variant == "yolo"
    assert default.hybrid_detector_model_path is None
    assert default.hybrid_pose_model_path is None

    with pytest.raises(SettingsError, match="RTMDet model path"):
        load_settings(
            settings_environment(PRIVATE_HAND_RELAY_BACKEND="hybrid_rtmpose")
        )
    with pytest.raises(SettingsError, match="RTMPose model path"):
        load_settings(
            settings_environment(
                PRIVATE_HAND_RELAY_BACKEND="hybrid_rtmpose",
                PRIVATE_HAND_RELAY_RTMDET_MODEL_PATH="/models/detector.onnx",
            )
        )

    hybrid_environment = settings_environment(
            PRIVATE_HAND_RELAY_BACKEND="hybrid_rtmpose",
            PRIVATE_HAND_RELAY_RTMDET_MODEL_PATH="/models/detector.onnx",
            PRIVATE_HAND_RELAY_RTMPOSE_MODEL_PATH="/models/pose.onnx",
    )
    hybrid_environment.pop("PRIVATE_HAND_RELAY_MODEL_PATH")
    selected = load_settings(hybrid_environment)
    assert selected.backend_variant == "hybrid_rtmpose"
    assert selected.model_path is None
    assert selected.hybrid_detector_model_path == "/models/detector.onnx"
    assert selected.hybrid_pose_model_path == "/models/pose.onnx"


def test_composite_capability_uses_a_bounded_deterministic_artifact_revision() -> None:
    from commandcanvas_hand_relay.hybrid_backend import HYBRID_RUNTIME_MANIFEST

    assert HYBRID_RUNTIME_MANIFEST.revision == (
        "25cc71c447d98a3711dc7c568c0a4c9ad9aaefbe6367cefae516531e99c01734"
    )
    assert HYBRID_RUNTIME_MANIFEST.release_license == "Apache-2.0"


def test_loads_two_exact_models_into_cuda_first_sessions_and_warms_both(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)
    detector = detector_session()
    pose = pose_session()
    ort = FakeOrt([detector, pose])

    backend = HybridCudaBackend.load(
        detector_path,
        pose_path,
        detector_manifest=detector_manifest,
        pose_manifest=pose_manifest,
        ort_module=ort,
        device_probe=(
            lambda device_id: f"NVIDIA GeForce RTX 3090 (CUDA device {device_id})"
        ),
        warmup_runs=2,
        gpu_mem_limit_bytes=805_306_368,
    )

    assert backend.ready is True
    assert backend.warm is True
    assert backend.device == "NVIDIA GeForce RTX 3090 (CUDA device 0)"
    assert len(detector.calls) == 2
    assert len(pose.calls) == 2
    assert all(option.entries == {} for option in ort.options)
    assert len(ort.requested_providers) == 2
    assert all(
        providers
        == [
            (
                "CUDAExecutionProvider",
                {
                    "device_id": 0,
                    "arena_extend_strategy": "kSameAsRequested",
                    "gpu_mem_limit": 402_653_184,
                    "cudnn_conv_algo_search": "HEURISTIC",
                    "do_copy_in_default_stream": 1,
                },
            ),
            "CPUExecutionProvider",
        ]
        for providers in ort.requested_providers
    )


def test_load_allows_cpu_bookkeeping_nodes_without_demoting_cuda(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)
    active_providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]
    ort = FakeOrt(
        [
            detector_session(providers=active_providers),
            pose_session(providers=active_providers),
        ],
        require_cpu_bookkeeping=True,
    )

    backend = HybridCudaBackend.load(
        detector_path,
        pose_path,
        detector_manifest=detector_manifest,
        pose_manifest=pose_manifest,
        ort_module=ort,
        device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        warmup_runs=1,
    )

    assert backend.ready is True


def test_load_accepts_exact_rtmdet_ort_metadata_with_distinct_dynamic_axis_names(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)
    detector = detector_session(
        output_shapes=(
            [1, "Gatherdets_dim_1", 5],
            [1, "Gatherlabels_dim_1"],
        )
    )

    backend = HybridCudaBackend.load(
        detector_path,
        pose_path,
        detector_manifest=detector_manifest,
        pose_manifest=pose_manifest,
        ort_module=FakeOrt([detector, pose_session()]),
        device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        warmup_runs=1,
    )

    assert backend.ready is True


def test_load_accepts_exact_rtmpose_ort_metadata_with_dynamic_keypoint_axis(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)
    pose = pose_session(
        output_shapes=(
            ["batch", "MatMulsimcc_x_dim_1", 512],
            ["batch", "MatMulsimcc_x_dim_1", 512],
        )
    )

    backend = HybridCudaBackend.load(
        detector_path,
        pose_path,
        detector_manifest=detector_manifest,
        pose_manifest=pose_manifest,
        ort_module=FakeOrt([detector_session(), pose]),
        device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        warmup_runs=1,
    )

    assert backend.ready is True


def test_warmup_rejects_detector_batch_disagreement_between_outputs(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)

    def mismatched_batch(_feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        return [
            np.zeros((1, 1, 5), dtype=np.float32),
            np.zeros((2, 1), dtype=np.int64),
        ]

    with pytest.raises(ModelUnavailable, match="RTMDet returned an incompatible output"):
        HybridCudaBackend.load(
            detector_path,
            pose_path,
            detector_manifest=detector_manifest,
            pose_manifest=pose_manifest,
            ort_module=FakeOrt(
                [detector_session(result=mismatched_batch), pose_session()]
            ),
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
            warmup_runs=1,
        )


def test_warmup_rejects_rtmpose_output_with_twenty_keypoints(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)

    def twenty_keypoints(feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        batch = feeds["input"].shape[0]
        return [
            np.zeros((batch, 20, 512), dtype=np.float32),
            np.zeros((batch, 20, 512), dtype=np.float32),
        ]

    with pytest.raises(ModelUnavailable, match="RTMPose returned an incompatible output"):
        HybridCudaBackend.load(
            detector_path,
            pose_path,
            detector_manifest=detector_manifest,
            pose_manifest=pose_manifest,
            ort_module=FakeOrt(
                [
                    detector_session(),
                    pose_session(result_override=twenty_keypoints),
                ]
            ),
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
            warmup_runs=1,
        )


def test_refuses_corrupt_model_bytes_before_creating_any_session(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)
    pose_manifest = replace(pose_manifest, sha256="0" * 64)
    ort = FakeOrt([detector_session(), pose_session()])

    with pytest.raises(ModelUnavailable, match="RTMPose.*SHA-256"):
        HybridCudaBackend.load(
            detector_path,
            pose_path,
            detector_manifest=detector_manifest,
            pose_manifest=pose_manifest,
            ort_module=ort,
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        )

    assert ort.options == []


def test_refuses_to_start_when_cuda_provider_is_unavailable(tmp_path: Path) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)
    ort = FakeOrt(
        [detector_session(), pose_session()],
        available=["CPUExecutionProvider"],
    )

    with pytest.raises(CudaUnavailable, match="CUDAExecutionProvider is unavailable"):
        HybridCudaBackend.load(
            detector_path,
            pose_path,
            detector_manifest=detector_manifest,
            pose_manifest=pose_manifest,
            ort_module=ort,
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        )

    assert ort.options == []


@pytest.mark.parametrize(
    ("detector", "pose", "error", "message"),
    [
        (
            detector_session(input_name="images"),
            pose_session(),
            ModelUnavailable,
            "RTMDet tensor contract",
        ),
        (
            detector_session(),
            pose_session(input_name="images"),
            ModelUnavailable,
            "RTMPose tensor contract",
        ),
        (
            detector_session(providers=["CPUExecutionProvider"]),
            pose_session(),
            CudaUnavailable,
            "RTMDet.*did not activate",
        ),
        (
            detector_session(),
            pose_session(providers=["CPUExecutionProvider"]),
            CudaUnavailable,
            "RTMPose.*did not activate",
        ),
        (
            detector_session(
                providers=["CPUExecutionProvider", "CUDAExecutionProvider"]
            ),
            pose_session(),
            CudaUnavailable,
            "RTMDet.*did not activate",
        ),
    ],
)
def test_refuses_wrong_tensor_or_active_provider_contracts(
    tmp_path: Path,
    detector: FakeSession,
    pose: FakeSession,
    error: type[Exception],
    message: str,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)

    with pytest.raises(error, match=message):
        HybridCudaBackend.load(
            detector_path,
            pose_path,
            detector_manifest=detector_manifest,
            pose_manifest=pose_manifest,
            ort_module=FakeOrt([detector, pose]),
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        )


def test_rgb_inference_returns_at_most_two_normalized_existing_hand_results(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)

    def detections(feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        assert feeds["input"].shape == (1, 3, 320, 320)
        return [
            np.array(
                [
                    [
                        [32, 32, 160, 160, 0.9],
                        [160, 160, 288, 288, 0.85],
                        [64, 64, 128, 128, 0.7],
                    ]
                ],
                dtype=np.float32,
            ),
            np.zeros((1, 3), dtype=np.int64),
        ]

    detector = detector_session(result=detections)
    pose = pose_session(score=0.8)
    backend = HybridCudaBackend.load(
        detector_path,
        pose_path,
        detector_manifest=detector_manifest,
        pose_manifest=pose_manifest,
        ort_module=FakeOrt([detector, pose]),
        device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        warmup_runs=1,
    )
    detector.calls.clear()
    pose.calls.clear()

    hands = backend.infer_rgb(np.full((100, 100, 3), 128, dtype=np.uint8))

    assert len(hands) == 2
    assert [hand["confidence"] for hand in hands] == [0.8, 0.8]
    assert all(hand["handedness"] == "unknown" for hand in hands)
    assert all(len(hand["landmarks"]) == 21 for hand in hands)
    assert hands[0]["landmarks"][0] == {
        "x": 0.3,
        "y": 0.3,
        "z": 0.0,
        "visibility": 0.8,
    }
    assert hands[1]["landmarks"][0] == {
        "x": 0.7,
        "y": 0.7,
        "z": 0.0,
        "visibility": 0.8,
    }
    assert hands[0]["boundingBox"] == {
        "x": 0.1,
        "y": 0.1,
        "width": 0.4,
        "height": 0.4,
    }
    assert len(detector.calls) == 1
    assert len(pose.calls) == 1
    assert pose.calls[0]["input"].shape == (2, 3, 256, 256)


def test_empty_detection_is_a_clean_empty_result_without_pose_inference(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)
    detector = detector_session()
    pose = pose_session()
    backend = HybridCudaBackend.load(
        detector_path,
        pose_path,
        detector_manifest=detector_manifest,
        pose_manifest=pose_manifest,
        ort_module=FakeOrt([detector, pose]),
        device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        warmup_runs=1,
    )
    detector.calls.clear()
    pose.calls.clear()

    assert backend.infer_rgb(np.zeros((80, 120, 3), dtype=np.uint8)) == []
    assert len(detector.calls) == 1
    assert pose.calls == []


def test_runtime_rejects_non_finite_pose_output_instead_of_emitting_landmarks(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)

    def one_detection(_feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        return [
            np.array([[[32, 32, 160, 160, 0.9]]], dtype=np.float32),
            np.zeros((1, 1), dtype=np.int64),
        ]

    detector = detector_session(result=one_detection)
    pose = pose_session()
    backend = HybridCudaBackend.load(
        detector_path,
        pose_path,
        detector_manifest=detector_manifest,
        pose_manifest=pose_manifest,
        ort_module=FakeOrt([detector, pose]),
        device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        warmup_runs=1,
    )

    def non_finite(_feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        x = np.zeros((1, 21, 512), dtype=np.float32)
        y = np.zeros((1, 21, 512), dtype=np.float32)
        x[0, 0, 0] = np.nan
        return [x, y]

    pose._result = non_finite

    with pytest.raises(ModelUnavailable, match="RTMPose.*incompatible"):
        backend.infer_rgb(np.zeros((100, 100, 3), dtype=np.uint8))


def test_runtime_rejects_detector_count_disagreement_between_outputs(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)
    detector = detector_session()
    backend = HybridCudaBackend.load(
        detector_path,
        pose_path,
        detector_manifest=detector_manifest,
        pose_manifest=pose_manifest,
        ort_module=FakeOrt([detector, pose_session()]),
        device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        warmup_runs=1,
    )

    def mismatched_count(_feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        return [
            np.zeros((1, 2, 5), dtype=np.float32),
            np.zeros((1, 1), dtype=np.int64),
        ]

    detector._result = mismatched_count

    with pytest.raises(ModelUnavailable, match="RTMDet returned an incompatible output"):
        backend.infer_rgb(np.zeros((100, 100, 3), dtype=np.uint8))


def test_runtime_rejects_rtmpose_output_with_keypoint_count_disagreement(
    tmp_path: Path,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HybridCudaBackend

    detector_path = model_file(tmp_path, "detector.onnx", b"detector")
    pose_path = model_file(tmp_path, "pose.onnx", b"pose")
    detector_manifest, pose_manifest = candidate_manifests(detector_path, pose_path)
    detector = detector_session()
    pose = pose_session()
    backend = HybridCudaBackend.load(
        detector_path,
        pose_path,
        detector_manifest=detector_manifest,
        pose_manifest=pose_manifest,
        ort_module=FakeOrt([detector, pose]),
        device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        warmup_runs=1,
    )

    def one_detection(_feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        return [
            np.array([[[32, 32, 160, 160, 0.9]]], dtype=np.float32),
            np.zeros((1, 1), dtype=np.int64),
        ]

    def mismatched_keypoints(feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        batch = feeds["input"].shape[0]
        return [
            np.zeros((batch, 21, 512), dtype=np.float32),
            np.zeros((batch, 20, 512), dtype=np.float32),
        ]

    detector._result = one_detection
    pose._result = mismatched_keypoints

    with pytest.raises(ModelUnavailable, match="RTMPose returned an incompatible output"):
        backend.infer_rgb(np.zeros((100, 100, 3), dtype=np.uint8))


def test_frame_native_backend_receives_decoded_rgb_and_keeps_wire_projection() -> None:
    class FrameNativeBackend:
        ready = True
        warm = True
        unavailable_reason = None
        device = "NVIDIA GeForce RTX 3090 (CUDA device 0)"
        manifest = SimpleNamespace(
            repository="hybrid",
            revision="pinned",
            keypoints=21,
            release_license="Apache-2.0",
            precision="fp32",
        )
        input_kind = BackendInputKind.RGB_FRAME

        def __init__(self) -> None:
            self.frames: list[np.ndarray] = []

        def infer_rgb(self, frame_rgb: np.ndarray) -> list[dict[str, Any]]:
            self.frames.append(frame_rgb.copy())
            return [
                {
                    "confidence": 0.8,
                    "handedness": "unknown",
                    "boundingBox": {"x": 0.1, "y": 0.1, "width": 0.5, "height": 0.5},
                    "landmarks": [
                        {"x": 0.25, "y": 0.5, "z": 0.0, "visibility": 0.9}
                        for _ in range(21)
                    ],
                }
            ]

    backend = FrameNativeBackend()
    frame = image_bytes(width=96, height=72)
    hands = _decode_and_infer(
        backend,
        frame,
        {"mimeType": "image/jpeg"},
        relay_settings(),
    )

    assert backend.frames[0].shape == (72, 96, 3)
    assert backend.frames[0].dtype == np.uint8
    assert hands == [
        {
            "confidence": 0.8,
            "handedness": "unknown",
            "landmarks": [
                {"x": 0.25, "y": 0.5, "z": 0.0, "visibility": 0.9}
                for _ in range(21)
            ],
        }
    ]


def test_opt_in_startup_loads_hybrid_and_reports_hybrid_capability(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HYBRID_RUNTIME_MANIFEST

    hybrid = SimpleNamespace(
        ready=True,
        warm=True,
        unavailable_reason=None,
        device="NVIDIA GeForce RTX 3090 (CUDA device 0)",
        manifest=HYBRID_RUNTIME_MANIFEST,
        infer_rgb=lambda _frame: [],
    )
    calls: list[tuple[object, ...]] = []

    def load(*args: object, **kwargs: object) -> object:
        calls.append((*args, kwargs))
        return hybrid

    monkeypatch.setattr(app_module.HybridCudaBackend, "load", load)
    selected = relay_settings(
        backend_variant="hybrid_rtmpose",
        hybrid_detector_model_path="/models/detector.onnx",
        hybrid_pose_model_path="/models/pose.onnx",
    )
    app = create_app(settings=selected, restart_process=lambda: None)

    async def exercise() -> dict[str, Any]:
        async with app.router.lifespan_context(app):
            response = await next(
                route.endpoint
                for route in app.routes
                if getattr(route, "path", None) == "/v1/capabilities"
            )()
            return json.loads(response.body)

    capability = asyncio.run(exercise())

    assert calls and calls[0][0:2] == (
        "/models/detector.onnx",
        "/models/pose.onnx",
    )
    assert capability["model"] == {
        "id": HYBRID_RUNTIME_MANIFEST.repository,
        "revision": HYBRID_RUNTIME_MANIFEST.revision,
        "format": "onnx",
        "keypoints": 21,
        "license": "Apache-2.0",
    }
    assert capability["runtime"]["precision"] == "fp32"


def test_opt_in_startup_failure_does_not_silently_fallback_to_yolo(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from commandcanvas_hand_relay.hybrid_backend import HYBRID_RUNTIME_MANIFEST

    def hybrid_failure(*_args: object, **_kwargs: object) -> object:
        raise ModelUnavailable("candidate unavailable")

    def forbidden_yolo(*_args: object, **_kwargs: object) -> object:
        raise AssertionError("hybrid opt-in must not silently execute YOLO")

    monkeypatch.setattr(app_module.HybridCudaBackend, "load", hybrid_failure)
    monkeypatch.setattr(app_module.YoloCudaBackend, "load", forbidden_yolo)
    selected = relay_settings(
        model_path=None,
        backend_variant="hybrid_rtmpose",
        hybrid_detector_model_path="/models/detector.onnx",
        hybrid_pose_model_path="/models/pose.onnx",
    )
    app = create_app(settings=selected, restart_process=lambda: None)

    async def exercise() -> dict[str, Any]:
        async with app.router.lifespan_context(app):
            response = await next(
                route.endpoint
                for route in app.routes
                if getattr(route, "path", None) == "/v1/capabilities"
            )()
            return json.loads(response.body)

    capability = asyncio.run(exercise())

    assert capability["ready"] is False
    assert capability["unavailableReason"] == "model_unavailable"
    assert capability["model"]["id"] == HYBRID_RUNTIME_MANIFEST.repository
