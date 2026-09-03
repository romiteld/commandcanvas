"""Prepare a local, unreviewed annotation draft from Vision Lab recordings."""

from __future__ import annotations

import shutil
import tempfile
from pathlib import Path
from typing import Any, Callable
from uuid import UUID

from .annotation_workbench import (
    DATASET_SCHEMA_VERSION,
    DRAFT_SCHEMA_VERSION,
    validate_annotation_manifest,
    validate_private_workspace,
)
from .canonical import (
    canonical_json_bytes,
    sha256_bytes,
    sha256_file,
    write_canonical_json,
)
from .prepare_dataset import (
    CommandRunner,
    DatasetPreparationError,
    _asset,
    _check_destination,
    _default_command_runner,
    _extract_png,
    _image_asset,
    _load_strict_json,
    _nonempty_string,
    _probe_video,
    _regular_file,
    _require_exact_keys,
    _root,
    _safe_relative,
    _validate_categories,
    _validate_companion,
    _validate_mapped_session,
    _validate_session_map,
    _resolve_sample_timestamps,
)


DRAFT_PREPARATION_SCHEMA = "commandcanvas.hand-annotation-draft-preparation/v1"
DRAFT_ADAPTER = "commandcanvas-vision-lab-annotation-draft"
DRAFT_ADAPTER_VERSION = "1.0.0"

FrameLabeler = Callable[[Path, dict[str, str]], bytes]


class AnnotationDraftPreparationError(ValueError):
    """Raised when capture evidence cannot safely become an annotation draft."""


def _prepare_sessions(
    *,
    capture_root: Path,
    session_map: dict[str, Any],
    command_runner: CommandRunner,
) -> tuple[str, str, int, list[dict[str, Any]]]:
    dataset_id, actor_id, cadence_ms, mapped_sessions = _validate_session_map(
        session_map
    )
    parsed: list[dict[str, Any]] = []
    identities: dict[str, set[str]] = {
        "visionSessionId": set(),
        "datasetSessionId": set(),
        "videoPath": set(),
        "manifestPath": set(),
        "labelDir": set(),
    }
    capture_group_splits: dict[str, str] = {}
    for index, raw_session in enumerate(mapped_sessions):
        description = f"session map sessions[{index}]"
        session = _validate_mapped_session(raw_session, description)
        vision_session_id = _nonempty_string(
            session["visionSessionId"], f"{description}.visionSessionId"
        )
        dataset_session_id = session["datasetSessionId"]
        capture_group_id = session["captureGroupId"]
        # Reuse the final bridge's exact UUID and split checks by validating their
        # canonical textual form before constructing any output.
        try:
            if str(UUID(dataset_session_id)) != dataset_session_id:
                raise ValueError
            if str(UUID(capture_group_id)) != capture_group_id:
                raise ValueError
        except (ValueError, TypeError, AttributeError) as error:
            raise DatasetPreparationError(
                f"{description} session and capture-group IDs must be canonical UUIDs"
            ) from error
        split = session["split"]
        if split not in {"train", "validation", "holdout"}:
            raise DatasetPreparationError(f"{description}.split is unsupported")
        prior_split = capture_group_splits.get(capture_group_id)
        if prior_split is not None and prior_split != split:
            raise DatasetPreparationError(
                f"captureGroupId {capture_group_id} leaks across split "
                f"{prior_split} and {split}"
            )
        capture_group_splits[capture_group_id] = split
        source, video_relative = _regular_file(
            capture_root, session["videoPath"], f"{description}.videoPath"
        )
        companion_path, manifest_relative = _regular_file(
            capture_root, session["manifestPath"], f"{description}.manifestPath"
        )
        label_relative = _safe_relative(
            session["labelDir"], f"{description}.labelDir"
        ).as_posix()
        annotation = _require_exact_keys(
            session["annotation"],
            {"method", "reviewed", "tool", "toolVersion", "modelSha256"},
            f"{description}.annotation",
        )
        if (
            annotation.get("method") != "manual"
            or annotation.get("reviewed") is not False
            or annotation.get("modelSha256") is not None
        ):
            raise DatasetPreparationError(
                "annotation drafts require unreviewed manual source annotation; "
                "model-assisted sessions require a separate bound prelabel adapter"
            )
        _nonempty_string(annotation.get("tool"), f"{description}.annotation.tool")
        _nonempty_string(
            annotation.get("toolVersion"), f"{description}.annotation.toolVersion"
        )
        companion = _load_strict_json(companion_path, "Vision Lab companion manifest")
        (
            capture_type,
            declared_width,
            declared_height,
            declared_rate,
            started,
            stopped,
        ) = _validate_companion(companion, vision_session_id, source)
        categories = _validate_categories(
            capture_type, session["categories"], f"{description}.categories"
        )
        width, height, duration_seconds, actual_rate, codec = _probe_video(
            source, command_runner
        )
        if declared_width is not None and width != declared_width:
            raise DatasetPreparationError(
                "Vision Lab dimensions do not match ffprobe dimensions"
            )
        if declared_height is not None and height != declared_height:
            raise DatasetPreparationError(
                "Vision Lab dimensions do not match ffprobe dimensions"
            )
        if declared_rate is not None and abs(actual_rate - declared_rate) > max(
            1.0, declared_rate * 0.05
        ):
            raise DatasetPreparationError(
                "Vision Lab frame rate does not match ffprobe frame rate"
            )
        declared_duration = (stopped - started).total_seconds()
        if abs(duration_seconds - declared_duration) > max(
            0.5, declared_duration * 0.15
        ):
            raise DatasetPreparationError(
                "Vision Lab duration does not match ffprobe duration"
            )
        mime_type = str(companion["media"]["mimeType"])
        if "codecs=vp8" in mime_type and codec != "vp8":
            raise DatasetPreparationError("Vision Lab VP8 declaration does not match")
        if "codecs=vp9" in mime_type and codec != "vp9":
            raise DatasetPreparationError("Vision Lab VP9 declaration does not match")
        for field, value in {
            "visionSessionId": vision_session_id,
            "datasetSessionId": dataset_session_id,
            "videoPath": video_relative,
            "manifestPath": manifest_relative,
            "labelDir": label_relative,
        }.items():
            if value in identities[field]:
                raise DatasetPreparationError(f"duplicate {field}: {value}")
            identities[field].add(value)
        duration_ms = int(round(duration_seconds * 1000))
        timestamps = _resolve_sample_timestamps(
            session,
            description=description,
            duration_ms=duration_ms,
            cadence_ms=cadence_ms,
        )
        parsed.append(
            {
                "visionSessionId": vision_session_id,
                "datasetSessionId": dataset_session_id,
                "captureGroupId": capture_group_id,
                "split": split,
                "categories": categories,
                "source": source,
                "sourceSha256": sha256_file(source),
                "width": width,
                "height": height,
                "timestamps": timestamps,
            }
        )
    return dataset_id, actor_id, cadence_ms, parsed


def _materialize_annotation_draft(
    *,
    capture_root: Path,
    session_map_path: Path,
    output_dir: Path,
    command_runner: CommandRunner = _default_command_runner,
    frame_labeler: FrameLabeler | None = None,
    prelabel_model_sha256: str | None = None,
    prelabel_tool: str | None = None,
    prelabel_tool_version: str | None = None,
) -> dict[str, Any]:
    """Extract immutable Vision Lab frames and publish one local review draft."""

    try:
        capture = _root(capture_root, "capture root")
        destination = Path(output_dir).resolve(strict=False)
        repository = Path(__file__).resolve().parents[4]
        validate_private_workspace(destination, repository)
        destination = _check_destination(destination, (capture,))
        source_manifest_path = Path(session_map_path)
        session_map = _load_strict_json(source_manifest_path, "session map")
        dataset_id, actor_id, _, sessions = _prepare_sessions(
            capture_root=capture,
            session_map=session_map,
            command_runner=command_runner,
        )
        source_manifest_sha = sha256_bytes(canonical_json_bytes(session_map))
        staging = Path(
            tempfile.mkdtemp(prefix=f".{destination.name}.", dir=destination.parent)
        )
        try:
            manifest_sessions: list[dict[str, Any]] = []
            split_groups: dict[str, set[str]] = {
                "train": set(),
                "validation": set(),
                "holdout": set(),
            }
            prelabeled_frame_count = 0
            manual_frame_count = 0
            for session in sorted(sessions, key=lambda item: item["datasetSessionId"]):
                session_id = session["datasetSessionId"]
                split_groups[session["split"]].add(session["captureGroupId"])
                model_assisted = (
                    frame_labeler is not None
                    and session["split"] in {"train", "validation"}
                    and session["categories"] != ["negative"]
                )
                source_destination = staging / "videos" / f"{session_id}.webm"
                source_destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(session["source"], source_destination)
                if sha256_file(source_destination) != session["sourceSha256"]:
                    raise DatasetPreparationError(
                        "copied raw WebM does not match its source"
                    )
                frames: list[dict[str, Any]] = []
                for timestamp_ms in session["timestamps"]:
                    frame_id = f"frame-{timestamp_ms:010d}"
                    image_path = staging / "images" / session_id / f"{frame_id}.png"
                    label_path = staging / "labels" / session_id / f"{frame_id}.txt"
                    _extract_png(
                        session["source"], timestamp_ms, image_path, command_runner
                    )
                    image_asset = _image_asset(image_path, staging)
                    if (image_asset["width"], image_asset["height"]) != (
                        session["width"],
                        session["height"],
                    ):
                        raise DatasetPreparationError(
                            "extracted frame dimensions do not match the video"
                        )
                    if model_assisted:
                        assert frame_labeler is not None
                        label_bytes = frame_labeler(
                            image_path,
                            {
                                "datasetId": dataset_id,
                                "sessionId": session_id,
                                "frameId": frame_id,
                                "imageSha256": image_asset["sha256"],
                            },
                        )
                        if not isinstance(label_bytes, bytes):
                            raise DatasetPreparationError(
                                "prelabel adapter must return canonical label bytes"
                            )
                        if sha256_file(image_path) != image_asset["sha256"]:
                            raise DatasetPreparationError(
                                "extracted frame changed during model prelabeling"
                            )
                        prelabeled_frame_count += 1
                    else:
                        label_bytes = b""
                        manual_frame_count += 1
                    label_path.parent.mkdir(parents=True, exist_ok=True)
                    label_path.write_bytes(label_bytes)
                    frames.append(
                        {
                            "frameId": frame_id,
                            "timestampMs": timestamp_ms,
                            "categories": session["categories"],
                            "reviewed": False,
                            "image": image_asset,
                            "label": _asset(label_path, staging),
                        }
                    )
                if sha256_file(session["source"]) != session["sourceSha256"]:
                    raise DatasetPreparationError(
                        "raw WebM changed during frame extraction"
                    )
                manifest_sessions.append(
                    {
                        "sessionId": session_id,
                        "captureGroupId": session["captureGroupId"],
                        "visionSessionId": session["visionSessionId"],
                        "actorId": actor_id,
                        "captureCategories": session["categories"],
                        "source": {
                            "kind": "raw_camera",
                            "overlayDerived": False,
                            **_asset(source_destination, staging),
                            "width": session["width"],
                            "height": session["height"],
                            "mimeType": "video/webm",
                        },
                        "annotation": {
                            "method": (
                                "model_assisted" if model_assisted else "manual"
                            ),
                            "reviewed": False,
                            "tool": (
                                prelabel_tool if model_assisted else DRAFT_ADAPTER
                            ),
                            "toolVersion": (
                                prelabel_tool_version
                                if model_assisted
                                else DRAFT_ADAPTER_VERSION
                            ),
                            "modelSha256": (
                                prelabel_model_sha256 if model_assisted else None
                            ),
                        },
                        "frames": frames,
                    }
                )
            draft = {
                "schemaVersion": DRAFT_SCHEMA_VERSION,
                "canonicalSchemaVersion": DATASET_SCHEMA_VERSION,
                "datasetId": dataset_id,
                "createdAt": session_map["createdAt"],
                "consent": {
                    "approved": True,
                    "version": "commandcanvas-owner-training/v1",
                },
                "keypointOrder": "mediapipe-hand-21",
                "classNames": ["hand"],
                "sourceAdapter": {
                    "name": DRAFT_ADAPTER,
                    "version": DRAFT_ADAPTER_VERSION,
                    "sourceManifestSha256": source_manifest_sha,
                    "actorId": actor_id,
                },
                "splits": {
                    split: sorted(groups) for split, groups in split_groups.items()
                },
                "sessions": manifest_sessions,
            }
            draft_path = staging / "annotation-draft.json"
            write_canonical_json(draft_path, draft)
            validation = validate_annotation_manifest(staging, draft_path)
            staging.rename(destination)
            return {
                "schemaVersion": DRAFT_PREPARATION_SCHEMA,
                "datasetId": dataset_id,
                "manifestSha256": sha256_file(destination / "annotation-draft.json"),
                "sourceManifestSha256": source_manifest_sha,
                "frameCount": validation["frameCount"],
                "reviewedFrameCount": validation["reviewedFrameCount"],
                "prelabeledFrameCount": prelabeled_frame_count,
                "manualFrameCount": manual_frame_count,
                "productionEligible": False,
            }
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise
    except (DatasetPreparationError, OSError, ValueError) as error:
        if isinstance(error, AnnotationDraftPreparationError):
            raise
        raise AnnotationDraftPreparationError(str(error)) from error


def prepare_annotation_draft(
    *,
    capture_root: Path,
    session_map_path: Path,
    output_dir: Path,
    command_runner: CommandRunner = _default_command_runner,
) -> dict[str, Any]:
    """Extract immutable Vision Lab frames into an empty manual-review draft."""

    return _materialize_annotation_draft(
        capture_root=capture_root,
        session_map_path=session_map_path,
        output_dir=output_dir,
        command_runner=command_runner,
    )
