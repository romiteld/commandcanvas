from __future__ import annotations

import asyncio
import base64
from pathlib import Path

import numpy as np

from helpers import image_bytes

from commandcanvas_hand_relay import benchmark
from commandcanvas_hand_relay.benchmark import run_benchmark, summarize_latencies
from commandcanvas_hand_relay.model_manifest import ROLLBACK_MODEL_MANIFEST


def test_benchmark_reports_p50_p95_and_results_per_second() -> None:
    summary = summarize_latencies([0.010, 0.020, 0.030, 0.040, 0.050])

    assert summary == {
        "samples": 5,
        "p50Ms": 30.0,
        "p95Ms": 48.0,
        "resultsPerSecond": 33.333,
    }


def test_rollback_benchmark_preprocesses_with_the_selected_320_manifest(
    tmp_path: Path,
    monkeypatch,
) -> None:
    image = tmp_path / "hand.jpg"
    image.write_bytes(image_bytes(width=640, height=360))

    class Backend:
        device = "NVIDIA GeForce RTX 3090 (CUDA device 0)"
        manifest = ROLLBACK_MODEL_MANIFEST
        input_size = 320

        def infer(self, tensor: np.ndarray, _transform: object):
            assert tensor.shape == (1, 3, 320, 320)
            return []

    monkeypatch.setenv(
        "PRIVATE_HAND_RELAY_SIGNING_KEY",
        base64.urlsafe_b64encode(bytes(range(32))).rstrip(b"=").decode("ascii"),
    )
    monkeypatch.setenv(
        "PRIVATE_HAND_RELAY_ALLOWED_ORIGINS",
        "https://commandcanvas.example",
    )
    monkeypatch.setenv("PRIVATE_HAND_RELAY_MODEL_PATH", "/models/rollback.onnx")
    monkeypatch.setenv(
        "PRIVATE_HAND_RELAY_MODEL_VARIANT",
        ROLLBACK_MODEL_MANIFEST.variant,
    )
    monkeypatch.setattr(
        benchmark.YoloCudaBackend,
        "load",
        lambda *_args, **_kwargs: Backend(),
    )

    result = asyncio.run(run_benchmark(image, iterations=1, warmup=1))

    assert result["modelVariant"] == "yolo26_hand_pose_320_fp16"
    assert result["inputSize"] == 320
