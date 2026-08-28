from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_runtime_dependencies_are_exactly_pinned() -> None:
    requirements = (ROOT / "requirements.lock").read_text(encoding="utf-8")

    assert "onnxruntime-gpu==1.23.2" in requirements
    assert "fastapi==0.115.6" in requirements
    assert "uvicorn==0.34.0" in requirements
    assert "numpy==2.2.6" in requirements
    assert "Pillow==11.3.0" in requirements
    assert "exceptiongroup==1.3.1" in requirements
    assert all(
        "==" in line
        for line in requirements.splitlines()
        if line and not line.startswith("#")
    )


def test_container_requires_nvidia_but_mounts_the_tracked_model_read_only() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")

    assert "CUDAExecutionProvider" in dockerfile
    assert "COPY" not in "\n".join(
        line for line in dockerfile.splitlines() if "models/" in line
    )
    assert "gpus: all" not in compose
    assert "device_ids:" in compose
    assert '"${PRIVATE_HAND_RELAY_CUDA_DEVICE:-0}"' in compose
    assert 'cpus: "2.0"' in compose
    assert "memory: 2G" in compose
    assert "memory: 512M" in compose
    assert "pids: 128" in compose
    assert "pids_limit:" not in compose
    assert "127.0.0.1:8100:8100" in compose
    assert "../../public/models/yolo26_hand_pose_320_fp16.onnx" in compose
    assert ":ro" in compose
    assert "PRIVATE_HAND_RELAY_GPU_MEM_LIMIT_BYTES:-805306368" in compose
    assert "PRIVATE_HAND_RELAY_MAX_HANDSHAKES:-8" in compose
    assert "PRIVATE_HAND_RELAY_INFERENCE_TIMEOUT_SECONDS:-2" in compose
    assert "urlopen('http://127.0.0.1:8100/healthz'" in dockerfile
    assert "NVIDIA_VISIBLE_DEVICES=all" not in dockerfile


def test_container_does_not_bake_a_secret_or_public_listener_into_the_image() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    compose = (ROOT / "compose.yaml").read_text(encoding="utf-8")

    assert "PRIVATE_HAND_RELAY_SIGNING_KEY=" not in dockerfile
    assert "0.0.0.0:8100:8100" not in compose
    assert (
        "PRIVATE_HAND_RELAY_SIGNING_KEY: ${PRIVATE_HAND_RELAY_SIGNING_KEY:?" in compose
    )
    assert (
        "PRIVATE_HAND_RELAY_ALLOWED_ORIGINS: ${PRIVATE_HAND_RELAY_ALLOWED_ORIGINS:?"
        in compose
    )
