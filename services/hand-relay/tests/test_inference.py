from __future__ import annotations

import hashlib
import importlib
from dataclasses import FrozenInstanceError, replace
from pathlib import Path
from types import SimpleNamespace
import numpy as np
import pytest

from helpers import image_bytes

from commandcanvas_hand_relay.inference import (
    MODEL_SHA256,
    CudaUnavailable,
    FrameRejected,
    ModelUnavailable,
    YoloCudaBackend,
    decode_frame,
    parse_output,
)
from commandcanvas_hand_relay.model_manifest import (
    MODEL_MANIFESTS,
    PRODUCTION_MODEL_MANIFEST,
    ROLLBACK_MODEL_MANIFEST,
)


class FakeTensor:
    def __init__(self, name: str, shape: list[int], tensor_type: str = "tensor(float)"):
        self.name = name
        self.shape = shape
        self.type = tensor_type


class FakeSession:
    def __init__(
        self,
        providers: list[str] | None = None,
        *,
        input_shape: list[int] | None = None,
        input_name: str = "images",
        input_type: str = "tensor(float)",
        output_shape: list[int] | None = None,
        output_name: str = "output0",
        output_type: str = "tensor(float)",
        output: np.ndarray | None = None,
    ):
        self.providers = providers or ["CUDAExecutionProvider"]
        self.runs = 0
        self.input_shape = input_shape or [1, 3, 640, 640]
        self.input_name = input_name
        self.input_type = input_type
        self.output_shape = output_shape or [1, 300, 69]
        self.output_name = output_name
        self.output_type = output_type
        self.output = (
            output
            if output is not None
            else np.zeros((1, 300, 69), dtype=np.float32)
        )

    def get_providers(self) -> list[str]:
        return self.providers

    def get_provider_options(self) -> dict[str, dict[str, str]]:
        return {"CUDAExecutionProvider": {"device_id": "0"}}

    def get_inputs(self) -> list[FakeTensor]:
        return [FakeTensor(self.input_name, self.input_shape, self.input_type)]

    def get_outputs(self) -> list[FakeTensor]:
        return [FakeTensor(self.output_name, self.output_shape, self.output_type)]

    def run(self, _outputs: object, feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        self.runs += 1
        assert feeds[self.input_name].shape == tuple(self.input_shape)
        return [self.output]


class FakeSessionOptions:
    def __init__(self) -> None:
        self.entries: dict[str, str] = {}
        self.graph_optimization_level: object = None

    def add_session_config_entry(self, key: str, value: str) -> None:
        self.entries[key] = value


class FakeOrt:
    class GraphOptimizationLevel:
        ORT_ENABLE_ALL = "all"

    def __init__(self, available: list[str], session: FakeSession | None = None):
        self.available = available
        self.session = session or FakeSession()
        self.options: FakeSessionOptions | None = None
        self.requested_providers: object = None

    def get_available_providers(self) -> list[str]:
        return self.available

    def SessionOptions(self) -> FakeSessionOptions:
        self.options = FakeSessionOptions()
        return self.options

    def InferenceSession(
        self,
        _path: str,
        *,
        sess_options: FakeSessionOptions,
        providers: object,
    ) -> FakeSession:
        self.options = sess_options
        self.requested_providers = providers
        return self.session


def pinned_model(tmp_path: Path) -> Path:
    path = tmp_path / "model.onnx"
    path.write_bytes(b"pinned model")
    return path


def manifest_for(path: Path):
    return replace(
        PRODUCTION_MODEL_MANIFEST,
        byte_size=path.stat().st_size,
        sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
    )


def test_refuses_to_start_when_cuda_is_not_available(tmp_path: Path) -> None:
    model = pinned_model(tmp_path)

    with pytest.raises(CudaUnavailable, match="CUDAExecutionProvider"):
        YoloCudaBackend.load(
            model,
            manifest=manifest_for(model),
            ort_module=FakeOrt(["CPUExecutionProvider"]),
            device_probe=lambda _device_id: "unused",
        )


def test_refuses_wrong_model_bytes_or_a_session_that_did_not_activate_cuda(
    tmp_path: Path,
) -> None:
    model = pinned_model(tmp_path)
    with pytest.raises(ModelUnavailable, match="SHA-256"):
        YoloCudaBackend.load(
            model,
            manifest=replace(manifest_for(model), sha256=MODEL_SHA256),
            ort_module=FakeOrt(["CUDAExecutionProvider"]),
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        )

    with pytest.raises(CudaUnavailable, match="did not activate"):
        YoloCudaBackend.load(
            model,
            manifest=manifest_for(model),
            ort_module=FakeOrt(
                ["CUDAExecutionProvider"], FakeSession(["CPUExecutionProvider"])
            ),
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        )


def test_loads_cuda_only_disables_cpu_fallback_and_warms_the_model(
    tmp_path: Path,
) -> None:
    model = pinned_model(tmp_path)
    ort = FakeOrt(["CUDAExecutionProvider", "CPUExecutionProvider"])

    backend = YoloCudaBackend.load(
        model,
        manifest=manifest_for(model),
        ort_module=ort,
        device_probe=lambda device_id: f"NVIDIA GeForce RTX 3090 (CUDA device {device_id})",
        warmup_runs=2,
        gpu_mem_limit_bytes=805_306_368,
    )

    assert backend.ready is True
    assert backend.warm is True
    assert backend.device == "NVIDIA GeForce RTX 3090 (CUDA device 0)"
    assert ort.session.runs == 2
    assert ort.options is not None
    assert ort.options.entries == {"session.disable_cpu_ep_fallback": "1"}
    assert ort.requested_providers == [
        (
            "CUDAExecutionProvider",
            {
                "device_id": 0,
                "arena_extend_strategy": "kSameAsRequested",
                "gpu_mem_limit": 805_306_368,
                "cudnn_conv_algo_search": "HEURISTIC",
                "do_copy_in_default_stream": 1,
            },
        )
    ]


def test_refuses_wrong_model_byte_size_before_session_creation(tmp_path: Path) -> None:
    model = pinned_model(tmp_path)
    manifest = replace(manifest_for(model), byte_size=model.stat().st_size + 1)
    ort = FakeOrt(["CUDAExecutionProvider"])

    with pytest.raises(ModelUnavailable, match="byte size"):
        YoloCudaBackend.load(
            model,
            manifest=manifest,
            ort_module=ort,
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        )

    assert ort.options is None


@pytest.mark.parametrize(
    "session",
    [
        FakeSession(input_name="input"),
        FakeSession(input_type="tensor(float16)"),
        FakeSession(input_shape=[1, 3, 320, 320]),
        FakeSession(output_name="detections"),
        FakeSession(output_type="tensor(float16)"),
        FakeSession(output_shape=[1, 300, 6]),
    ],
)
def test_refuses_any_tensor_contract_that_differs_from_the_manifest(
    tmp_path: Path,
    session: FakeSession,
) -> None:
    model = pinned_model(tmp_path)

    with pytest.raises(ModelUnavailable, match="selected manifest"):
        YoloCudaBackend.load(
            model,
            manifest=manifest_for(model),
            ort_module=FakeOrt(["CUDAExecutionProvider"], session),
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        )


def test_refuses_non_finite_warmup_output(tmp_path: Path) -> None:
    model = pinned_model(tmp_path)
    output = np.zeros((1, 300, 69), dtype=np.float32)
    output[0, 0, 0] = np.nan

    with pytest.raises(ModelUnavailable, match="warmup"):
        YoloCudaBackend.load(
            model,
            manifest=manifest_for(model),
            ort_module=FakeOrt(
                ["CUDAExecutionProvider"],
                FakeSession(output=output),
            ),
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        )


def test_320_rollback_requires_its_own_manifest_and_session_shape(
    tmp_path: Path,
) -> None:
    model = pinned_model(tmp_path)
    rollback = replace(
        ROLLBACK_MODEL_MANIFEST,
        byte_size=model.stat().st_size,
        sha256=hashlib.sha256(model.read_bytes()).hexdigest(),
    )
    session = FakeSession(input_shape=[1, 3, 320, 320])

    backend = YoloCudaBackend.load(
        model,
        manifest=rollback,
        ort_module=FakeOrt(["CUDAExecutionProvider"], session),
        device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
    )

    assert backend.manifest.variant == "yolo26_hand_pose_320_fp16"
    assert backend.input_size == 320
    assert session.runs == 3


def test_decodes_bounded_jpeg_or_webp_into_letterboxed_nchw() -> None:
    tensor, transform = decode_frame(
        image_bytes(width=640, height=360),
        declared_mime="image/jpeg",
        max_frame_bytes=262_144,
        max_width=1280,
        max_height=720,
        input_size=320,
    )

    assert tensor.shape == (1, 3, 320, 320)
    assert tensor.dtype == np.float32
    assert transform.source_width == 640
    assert transform.source_height == 360
    assert transform.offset_y == 70

    webp, _ = decode_frame(
        image_bytes(image_format="WEBP"),
        declared_mime="image/webp",
        max_frame_bytes=262_144,
        max_width=1280,
        max_height=720,
        input_size=320,
    )
    assert webp.shape == (1, 3, 320, 320)


@pytest.mark.parametrize(
    ("data", "mime", "message"),
    [
        (b"not-an-image", "image/jpeg", "decode"),
        (image_bytes(), "image/webp", "format"),
        (image_bytes(width=1290), "image/jpeg", "dimensions"),
    ],
)
def test_rejects_malformed_mismatched_or_oversized_images(
    data: bytes, mime: str, message: str
) -> None:
    with pytest.raises(FrameRejected, match=message):
        decode_frame(
            data,
            declared_mime=mime,
            max_frame_bytes=max(262_144, len(data)),
            max_width=1280,
            max_height=720,
        )


def test_parses_two_highest_confidence_hands_and_does_not_fake_depth() -> None:
    output = np.zeros((1, 300, 69), dtype=np.float32)
    for row, confidence in enumerate((0.7, 0.95, 0.2)):
        output[0, row, 4] = confidence
        for keypoint in range(21):
            offset = 6 + keypoint * 3
            output[0, row, offset] = 160 + keypoint
            output[0, row, offset + 1] = 160
            output[0, row, offset + 2] = 0.99
    transform = SimpleNamespace(
        offset_x=0,
        offset_y=0,
        scale=0.5,
        source_width=640,
        source_height=640,
    )

    hands = parse_output(output, transform, confidence_threshold=0.45, max_hands=2)

    assert [hand["confidence"] for hand in hands] == [0.95, 0.7]
    assert all(len(hand["landmarks"]) == 21 for hand in hands)
    assert hands[0]["landmarks"][0] == {
        "x": 0.5,
        "y": 0.5,
        "z": 0.0,
        "visibility": 0.99,
    }
    assert hands[0]["handedness"] == "unknown"


def test_refuses_an_incompatible_bbox_only_output() -> None:
    with pytest.raises(ModelUnavailable, match=r"\[1,300,69\]"):
        parse_output(
            np.zeros((1, 300, 6), dtype=np.float32),
            SimpleNamespace(
                offset_x=0,
                offset_y=0,
                scale=1,
                source_width=320,
                source_height=320,
            ),
        )


def test_production_manifest_pins_the_independently_verified_640_artifact() -> None:
    module = importlib.import_module("commandcanvas_hand_relay.model_manifest")
    manifest = module.PRODUCTION_MODEL_MANIFEST

    assert manifest.variant == "yolo26_hand_pose_640_fp16"
    assert manifest.repository == "poptoz/yolo26-hand-pose-face-detection"
    assert manifest.revision == "2abb91a7030e1aa5231ec900ccb2c07ab3f03460"
    assert manifest.source_artifact == "models/yolo26_hand_pose_fp16.onnx"
    assert manifest.byte_size == 21_547_949
    assert (
        manifest.sha256
        == "f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e"
    )
    assert manifest.input_name == "images"
    assert manifest.input_type == "tensor(float)"
    assert manifest.input_shape == (1, 3, 640, 640)
    assert manifest.output_name == "output0"
    assert manifest.output_type == "tensor(float)"
    assert manifest.output_shape == (1, 300, 69)


def test_model_manifest_and_variant_registry_are_immutable() -> None:
    with pytest.raises(FrozenInstanceError):
        PRODUCTION_MODEL_MANIFEST.byte_size = 1  # type: ignore[misc]

    with pytest.raises(TypeError):
        MODEL_MANIFESTS["mislabeled"] = PRODUCTION_MODEL_MANIFEST  # type: ignore[index]


def test_decodes_a_widescreen_frame_into_a_true_640_letterbox() -> None:
    tensor, transform = decode_frame(
        image_bytes(width=640, height=360),
        declared_mime="image/jpeg",
        max_frame_bytes=262_144,
        max_width=1280,
        max_height=720,
        input_size=640,
    )

    assert tensor.shape == (1, 3, 640, 640)
    assert transform.scale == 1
    assert transform.offset_x == 0
    assert transform.offset_y == 140


def test_parses_a_640_letterbox_back_to_normalized_box_and_landmarks() -> None:
    output = np.zeros((1, 300, 69), dtype=np.float32)
    output[0, 0, :6] = [64, 176, 576, 464, 0.9, 0]
    for keypoint in range(21):
        offset = 6 + keypoint * 3
        output[0, 0, offset : offset + 3] = [320, 320, 0.95]
    transform = SimpleNamespace(
        offset_x=0,
        offset_y=140,
        scale=1,
        source_width=640,
        source_height=360,
    )

    hands = parse_output(output, transform)

    assert hands[0]["boundingBox"] == {
        "x": 0.1,
        "y": 0.1,
        "width": 0.8,
        "height": 0.8,
    }
    assert hands[0]["landmarks"][0] == {
        "x": 0.5,
        "y": 0.5,
        "z": 0.0,
        "visibility": 0.95,
    }
