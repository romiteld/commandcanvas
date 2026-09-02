from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any
from uuid import UUID

from PIL import Image


SPLITS = ("train", "validation", "holdout")
SESSION_IDS = (
    "00000000-0000-4000-8000-000000000101",
    "00000000-0000-4000-8000-000000000102",
    "00000000-0000-4000-8000-000000000103",
)
CAPTURE_GROUP_IDS = (
    "00000000-0000-4000-8000-000000000201",
    "00000000-0000-4000-8000-000000000202",
    "00000000-0000-4000-8000-000000000203",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hand_label() -> str:
    values = ["0", "0.5", "0.5", "0.8", "0.8"]
    for index in range(21):
        x = 0.2 + index * 0.02
        y = 0.3 + index * 0.01
        values.extend((f"{x:.3f}", f"{y:.3f}", "2"))
    assert len(values) == 68
    return " ".join(values) + "\n"


def write_valid_dataset(root: Path) -> Path:
    sessions: list[dict[str, Any]] = []
    split_groups: dict[str, list[str]] = {}
    positive_categories = (
        ["drawing", "pinch"],
        ["edge", "two_hand"],
        ["drawing", "pinch", "edge", "two_hand"],
    )

    for session_index, split in enumerate(SPLITS):
        session_id = SESSION_IDS[session_index]
        capture_group_id = CAPTURE_GROUP_IDS[session_index]
        UUID(session_id)
        UUID(capture_group_id)
        split_groups[split] = [capture_group_id]

        video_path = root / "videos" / f"{session_id}.webm"
        video_path.parent.mkdir(parents=True, exist_ok=True)
        video_path.write_bytes(f"raw-camera-{split}".encode())

        frames: list[dict[str, Any]] = []
        for frame_index, is_negative in enumerate((False, True)):
            frame_id = f"frame-{frame_index:04d}"
            image_path = root / "images" / session_id / f"{frame_id}.png"
            image_path.parent.mkdir(parents=True, exist_ok=True)
            Image.new(
                "RGB",
                (64, 48),
                color=(20 + session_index * 40, 30 + frame_index * 50, 90),
            ).save(image_path)

            label_path = root / "labels" / session_id / f"{frame_id}.txt"
            label_path.parent.mkdir(parents=True, exist_ok=True)
            label_path.write_text("" if is_negative else hand_label(), encoding="utf-8")

            frames.append(
                {
                    "frameId": frame_id,
                    "timestampMs": frame_index * 120,
                    "categories": (
                        ["negative"]
                        if is_negative
                        else positive_categories[session_index]
                    ),
                    "image": {
                        "path": image_path.relative_to(root).as_posix(),
                        "byteSize": image_path.stat().st_size,
                        "sha256": sha256(image_path),
                        "width": 64,
                        "height": 48,
                    },
                    "label": {
                        "path": label_path.relative_to(root).as_posix(),
                        "byteSize": label_path.stat().st_size,
                        "sha256": sha256(label_path),
                    },
                }
            )

        sessions.append(
            {
                "sessionId": session_id,
                "captureGroupId": capture_group_id,
                "actorId": "owner-daniel",
                "captureCategories": sorted(
                    {category for frame in frames for category in frame["categories"]}
                ),
                "source": {
                    "kind": "raw_camera",
                    "overlayDerived": False,
                    "path": video_path.relative_to(root).as_posix(),
                    "byteSize": video_path.stat().st_size,
                    "sha256": sha256(video_path),
                    "width": 640,
                    "height": 480,
                    "mimeType": "video/webm",
                },
                "annotation": {
                    "method": "manual",
                    "reviewed": True,
                    "tool": "commandcanvas-test-annotator",
                    "toolVersion": "1.0.0",
                    "modelSha256": None,
                },
                "frames": frames,
            }
        )

    manifest = {
        "schemaVersion": "commandcanvas.hand-dataset/v1",
        "datasetId": "00000000-0000-4000-8000-000000000001",
        "createdAt": "2026-09-02T12:00:00Z",
        "consent": {
            "approved": True,
            "version": "commandcanvas-owner-training/v1",
        },
        "keypointOrder": "mediapipe-hand-21",
        "classNames": ["hand"],
        "splits": split_groups,
        "sessions": sessions,
    }
    manifest_path = root / "dataset-manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return manifest_path


def write_annotation_draft(root: Path) -> Path:
    """Write a structurally valid but deliberately incomplete review workspace."""

    canonical_path = write_valid_dataset(root)
    canonical = read_manifest(canonical_path)
    canonical_path.unlink()
    canonical["schemaVersion"] = "commandcanvas.hand-annotation-draft/v1"
    canonical["canonicalSchemaVersion"] = "commandcanvas.hand-dataset/v1"
    canonical["sourceAdapter"] = {
        "name": "commandcanvas-test-frame-adapter",
        "version": "1.0.0",
        "sourceManifestSha256": "d" * 64,
    }
    for session_index, session in enumerate(canonical["sessions"]):
        session["visionSessionId"] = f"vision-lab-session-{session_index + 1}"
        session["annotation"]["reviewed"] = False
        for frame in session["frames"]:
            frame_id = f"frame-{frame['timestampMs']:010d}"
            previous_image = root / frame["image"]["path"]
            image_path = root / "images" / session["sessionId"] / f"{frame_id}.png"
            previous_image.replace(image_path)
            previous_label = root / frame["label"]["path"]
            label_path = root / "labels" / session["sessionId"] / f"{frame_id}.txt"
            previous_label.replace(label_path)
            frame["frameId"] = frame_id
            frame["image"]["path"] = image_path.relative_to(root).as_posix()
            frame["image"]["byteSize"] = image_path.stat().st_size
            frame["image"]["sha256"] = sha256(image_path)
            frame["label"]["path"] = label_path.relative_to(root).as_posix()
            frame["reviewed"] = False
            if frame["categories"] != ["negative"]:
                label_path.write_bytes(b"")
            frame["label"]["byteSize"] = label_path.stat().st_size
            frame["label"]["sha256"] = sha256(label_path)
    draft_path = root / "annotation-draft.json"
    write_manifest(draft_path, canonical)
    return draft_path


def read_manifest(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_manifest(path: Path, value: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
