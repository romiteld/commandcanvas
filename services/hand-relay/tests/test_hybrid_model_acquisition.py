from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = ROOT / "models" / "hybrid-models.lock.json"
TOOL_PATH = ROOT / "scripts" / "acquire_hybrid_models.py"


EXPECTED_ARTIFACTS = {
    "rtmdet_nano_hand_detector": {
        "role": "detector",
        "repository": "Tau-J/RTMPose",
        "revision": "cd4d7095f5cfc9cfc4f46289bee91ea4a1e1d9fd",
        "source_url": (
            "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/"
            "onnx_sdk/rtmdet_nano_8xb32-300e_hand-267f9c8f.zip"
        ),
        "source_filename": "rtmdet_nano_8xb32-300e_hand-267f9c8f.zip",
        "source_byte_size": 3_840_129,
        "source_sha256": (
            "9c0370a43c02b2fe42b4382aba7383d97cfa3ed35623b655cac4f0c25cfde402"
        ),
        "format": "zip_member",
        "archive_member": (
            "20230831/rtmdet_onnx/rtmdet_nano_8xb32-300e_hand-267f9c8f/end2end.onnx"
        ),
        "output_filename": "rtmdet_nano_8xb32-300e_hand-267f9c8f.onnx",
        "output_byte_size": 4_010_667,
        "output_sha256": (
            "568d3ea97a5b142488366b67e036b6a5cb0a1fef9087a710cb8e66b6979fbac2"
        ),
        "license": "Apache-2.0",
    },
    "rtmpose_m_distill_hand_refiner": {
        "role": "pose_refiner",
        "repository": "tasmulaev/rtmpose-m-distill",
        "revision": "ec0d56fdf55a350106671e763338a4a76372a888",
        "source_url": (
            "https://huggingface.co/tasmulaev/rtmpose-m-distill/resolve/"
            "ec0d56fdf55a350106671e763338a4a76372a888/onnx/"
            "rtmpose-m-distill-256x256.onnx"
        ),
        "source_filename": "rtmpose-m-distill-256x256.onnx",
        "source_byte_size": 55_118_513,
        "source_sha256": (
            "6d50664e566fffee41a090c98f75e893b50846a753b802dbf5e2072a8dfd7784"
        ),
        "format": "file",
        "output_filename": "rtmpose-m-distill-256x256.onnx",
        "output_byte_size": 55_118_513,
        "output_sha256": (
            "6d50664e566fffee41a090c98f75e893b50846a753b802dbf5e2072a8dfd7784"
        ),
        "license": "Apache-2.0",
    },
}


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _run_tool(*arguments: object) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(TOOL_PATH), *(str(value) for value in arguments)],
        check=False,
        capture_output=True,
        text=True,
    )


def _write_lock(path: Path, artifacts: dict[str, dict[str, object]]) -> None:
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "backend": "hybrid_rtmpose",
                "artifacts": artifacts,
            }
        ),
        encoding="utf-8",
    )


def _direct_artifact(
    *,
    source: Path,
    source_bytes: bytes,
    output_filename: str = "pose.onnx",
) -> dict[str, object]:
    return {
        "role": "pose_refiner",
        "repository": "example/pose",
        "revision": "a" * 40,
        "source_url": source.as_uri(),
        "source_filename": source.name,
        "source_byte_size": len(source_bytes),
        "source_sha256": _sha256(source_bytes),
        "format": "file",
        "output_filename": output_filename,
        "output_byte_size": len(source_bytes),
        "output_sha256": _sha256(source_bytes),
        "license": "Apache-2.0",
    }


def test_production_lock_pins_exact_candidate_artifacts() -> None:
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))

    assert lock == {
        "schema_version": 1,
        "backend": "hybrid_rtmpose",
        "artifacts": EXPECTED_ARTIFACTS,
    }

    result = _run_tool("check-lock", "--lock", LOCK_PATH)
    assert result.returncode == 0, result.stderr
    assert "lock valid: hybrid_rtmpose (2 artifacts)" in result.stdout


def test_verify_fails_closed_when_an_artifact_is_missing(tmp_path: Path) -> None:
    source_bytes = b"verified pose candidate"
    source = tmp_path / "source.onnx"
    source.write_bytes(source_bytes)
    lock_path = tmp_path / "models.lock.json"
    _write_lock(
        lock_path,
        {"pose": _direct_artifact(source=source, source_bytes=source_bytes)},
    )

    result = _run_tool(
        "verify", "--lock", lock_path, "--model-dir", tmp_path / "models"
    )

    assert result.returncode != 0
    assert "missing artifact: pose.onnx" in result.stderr


def test_verify_fails_closed_on_same_size_digest_mismatch(tmp_path: Path) -> None:
    source_bytes = b"expected-model-bytes"
    source = tmp_path / "source.onnx"
    source.write_bytes(source_bytes)
    lock_path = tmp_path / "models.lock.json"
    _write_lock(
        lock_path,
        {"pose": _direct_artifact(source=source, source_bytes=source_bytes)},
    )
    model_dir = tmp_path / "models"
    model_dir.mkdir()
    (model_dir / "pose.onnx").write_bytes(b"x" * len(source_bytes))

    result = _run_tool("verify", "--lock", lock_path, "--model-dir", model_dir)

    assert result.returncode != 0
    assert "SHA-256 mismatch for pose.onnx" in result.stderr


def test_acquire_and_verify_both_artifact_formats_entirely_offline(
    tmp_path: Path,
) -> None:
    detector_bytes = b"detector-model"
    archive_member = "release/end2end.onnx"
    archive = tmp_path / "detector.zip"
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as bundle:
        bundle.writestr(archive_member, detector_bytes)
    archive_bytes = archive.read_bytes()

    pose_bytes = b"pose-model"
    pose_source = tmp_path / "pose-source.onnx"
    pose_source.write_bytes(pose_bytes)

    lock_path = tmp_path / "models.lock.json"
    _write_lock(
        lock_path,
        {
            "detector": {
                "role": "detector",
                "repository": "example/detector",
                "revision": "b" * 40,
                "source_url": archive.as_uri(),
                "source_filename": archive.name,
                "source_byte_size": len(archive_bytes),
                "source_sha256": _sha256(archive_bytes),
                "format": "zip_member",
                "archive_member": archive_member,
                "output_filename": "detector.onnx",
                "output_byte_size": len(detector_bytes),
                "output_sha256": _sha256(detector_bytes),
                "license": "Apache-2.0",
            },
            "pose": _direct_artifact(
                source=pose_source,
                source_bytes=pose_bytes,
            ),
        },
    )
    model_dir = tmp_path / "models"

    acquired = _run_tool("acquire", "--lock", lock_path, "--model-dir", model_dir)
    verified = _run_tool("verify", "--lock", lock_path, "--model-dir", model_dir)

    assert acquired.returncode == 0, acquired.stderr
    assert verified.returncode == 0, verified.stderr
    assert (model_dir / "detector.onnx").read_bytes() == detector_bytes
    assert (model_dir / "pose.onnx").read_bytes() == pose_bytes
    assert "verified 2 artifacts" in verified.stdout


def test_acquire_prevalidates_all_sources_before_replacing_outputs(
    tmp_path: Path,
) -> None:
    good_bytes = b"new-detector"
    good_source = tmp_path / "detector.onnx"
    good_source.write_bytes(good_bytes)
    bad_bytes = b"tampered-pose"
    bad_source = tmp_path / "pose.onnx"
    bad_source.write_bytes(bad_bytes)

    detector = _direct_artifact(
        source=good_source,
        source_bytes=good_bytes,
        output_filename="detector-output.onnx",
    )
    detector["role"] = "detector"
    pose = _direct_artifact(source=bad_source, source_bytes=b"expected-pose")
    pose["source_byte_size"] = len(bad_bytes)
    lock_path = tmp_path / "models.lock.json"
    _write_lock(lock_path, {"detector": detector, "pose": pose})

    model_dir = tmp_path / "models"
    model_dir.mkdir()
    old_detector = b"old-detector"
    old_pose = b"old-pose"
    (model_dir / "detector-output.onnx").write_bytes(old_detector)
    (model_dir / "pose.onnx").write_bytes(old_pose)

    result = _run_tool("acquire", "--lock", lock_path, "--model-dir", model_dir)

    assert result.returncode != 0
    assert "SHA-256 mismatch for source pose.onnx" in result.stderr
    assert (model_dir / "detector-output.onnx").read_bytes() == old_detector
    assert (model_dir / "pose.onnx").read_bytes() == old_pose


def test_acquire_fails_closed_when_the_exact_archive_member_is_absent(
    tmp_path: Path,
) -> None:
    archive = tmp_path / "detector.zip"
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr("wrong/end2end.onnx", b"model")
    archive_bytes = archive.read_bytes()
    lock_path = tmp_path / "models.lock.json"
    _write_lock(
        lock_path,
        {
            "detector": {
                "role": "detector",
                "repository": "example/detector",
                "revision": "b" * 40,
                "source_url": archive.as_uri(),
                "source_filename": archive.name,
                "source_byte_size": len(archive_bytes),
                "source_sha256": _sha256(archive_bytes),
                "format": "zip_member",
                "archive_member": "expected/end2end.onnx",
                "output_filename": "detector.onnx",
                "output_byte_size": 5,
                "output_sha256": _sha256(b"model"),
                "license": "Apache-2.0",
            }
        },
    )

    result = _run_tool(
        "acquire", "--lock", lock_path, "--model-dir", tmp_path / "models"
    )

    assert result.returncode != 0
    assert "archive member missing: expected/end2end.onnx" in result.stderr
    assert not (tmp_path / "models" / "detector.onnx").exists()


def test_check_lock_rejects_path_traversal(tmp_path: Path) -> None:
    source_bytes = b"pose"
    source = tmp_path / "pose-source.onnx"
    source.write_bytes(source_bytes)
    artifact = _direct_artifact(source=source, source_bytes=source_bytes)
    artifact["output_filename"] = "../outside.onnx"
    lock_path = tmp_path / "models.lock.json"
    _write_lock(lock_path, {"pose": artifact})

    result = _run_tool("check-lock", "--lock", lock_path)

    assert result.returncode != 0
    assert "output_filename must be a plain filename" in result.stderr
