from __future__ import annotations

import hashlib
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


class FakeTensor:
    def __init__(self, name: str, shape: list[int], tensor_type: str = "tensor(float)"):
        self.name = name
        self.shape = shape
        self.type = tensor_type


class FakeSession:
    def __init__(self, providers: list[str] | None = None):
        self.providers = providers or ["CUDAExecutionProvider"]
        self.runs = 0

    def get_providers(self) -> list[str]:
        return self.providers

    def get_provider_options(self) -> dict[str, dict[str, str]]:
        return {"CUDAExecutionProvider": {"device_id": "0"}}

    def get_inputs(self) -> list[FakeTensor]:
        return [FakeTensor("images", [1, 3, 320, 320])]

    def get_outputs(self) -> list[FakeTensor]:
        return [FakeTensor("output0", [1, 300, 69])]

    def run(self, _outputs: object, feeds: dict[str, np.ndarray]) -> list[np.ndarray]:
        self.runs += 1
        assert feeds["images"].shape == (1, 3, 320, 320)
        return [np.zeros((1, 300, 69), dtype=np.float32)]


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


def test_refuses_to_start_when_cuda_is_not_available(tmp_path: Path) -> None:
    model = pinned_model(tmp_path)

    with pytest.raises(CudaUnavailable, match="CUDAExecutionProvider"):
        YoloCudaBackend.load(
            model,
            expected_sha256=hashlib.sha256(model.read_bytes()).hexdigest(),
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
            expected_sha256=MODEL_SHA256,
            ort_module=FakeOrt(["CUDAExecutionProvider"]),
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        )

    digest = hashlib.sha256(model.read_bytes()).hexdigest()
    with pytest.raises(CudaUnavailable, match="did not activate"):
        YoloCudaBackend.load(
            model,
            expected_sha256=digest,
            ort_module=FakeOrt(
                ["CUDAExecutionProvider"], FakeSession(["CPUExecutionProvider"])
            ),
            device_probe=lambda _device_id: "NVIDIA GeForce RTX 3090",
        )


def test_loads_cuda_only_disables_cpu_fallback_and_warms_the_model(
    tmp_path: Path,
) -> None:
    model = pinned_model(tmp_path)
    digest = hashlib.sha256(model.read_bytes()).hexdigest()
    ort = FakeOrt(["CUDAExecutionProvider", "CPUExecutionProvider"])

    backend = YoloCudaBackend.load(
        model,
        expected_sha256=digest,
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


def test_decodes_bounded_jpeg_or_webp_into_letterboxed_nchw() -> None:
    tensor, transform = decode_frame(
        image_bytes(width=640, height=360),
        declared_mime="image/jpeg",
        max_frame_bytes=262_144,
        max_width=1280,
        max_height=720,
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
