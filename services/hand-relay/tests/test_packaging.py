from __future__ import annotations

from pathlib import Path

import yaml


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


def test_container_requires_nvidia_and_copies_checksum_gated_model_bytes() -> None:
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    compose_text = (ROOT / "compose.yaml").read_text(encoding="utf-8")
    compose = yaml.safe_load(compose_text)

    assert "CUDAExecutionProvider" in dockerfile
    assert "COPY ${PRIVATE_HAND_RELAY_MODEL_SOURCE}" in dockerfile
    assert "sha256sum --check" in dockerfile
    assert "PRIVATE_HAND_RELAY_MODEL_BYTES" in dockerfile
    services = compose["services"]
    production = services["hand-relay-640"]
    rollback = services["hand-relay-320-rollback"]
    assert "profiles" not in production
    assert rollback["profiles"] == ["rollback-320"]
    assert production["image"] == "commandcanvas-hand-relay:yolo26-640-fp16"
    assert rollback["image"] == "commandcanvas-hand-relay:yolo26-320-fp16-rollback"
    assert production["ports"] == ["127.0.0.1:8100:8100"]
    assert rollback["ports"] == ["127.0.0.1:8102:8100"]
    assert "volumes" not in production
    assert "volumes" not in rollback
    assert production["build"]["args"] == {
        "PRIVATE_HAND_RELAY_MODEL_SOURCE": "services/hand-relay/models/yolo26_hand_pose_640_fp16.onnx",
        "PRIVATE_HAND_RELAY_MODEL_FILENAME": "yolo26_hand_pose_640_fp16.onnx",
        "PRIVATE_HAND_RELAY_MODEL_SHA256": "f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e",
        "PRIVATE_HAND_RELAY_MODEL_BYTES": "21547949",
    }
    assert rollback["build"]["args"] == {
        "PRIVATE_HAND_RELAY_MODEL_SOURCE": "public/models/yolo26_hand_pose_320_fp16.onnx",
        "PRIVATE_HAND_RELAY_MODEL_FILENAME": "yolo26_hand_pose_320_fp16.onnx",
        "PRIVATE_HAND_RELAY_MODEL_SHA256": "07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc",
        "PRIVATE_HAND_RELAY_MODEL_BYTES": "21447188",
    }
    assert "gpus: all" not in compose_text
    assert '"${PRIVATE_HAND_RELAY_CUDA_DEVICE:-0}"' in compose_text
    assert 'cpus: "2.0"' in compose_text
    assert "memory: 2G" in compose_text
    assert "memory: 512M" in compose_text
    assert "pids: 128" in compose_text
    assert "pids_limit:" not in compose_text
    assert "PRIVATE_HAND_RELAY_GPU_MEM_LIMIT_BYTES:-805306368" in compose_text
    assert "PRIVATE_HAND_RELAY_MAX_HANDSHAKES:-8" in compose_text
    assert "PRIVATE_HAND_RELAY_INFERENCE_TIMEOUT_SECONDS:-2" in compose_text
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
