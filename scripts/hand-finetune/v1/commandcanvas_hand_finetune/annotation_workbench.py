"""Local-only browser workbench for correcting 21-point hand-pose labels."""

from __future__ import annotations

import ipaddress
import json
import math
import os
import re
import secrets
import tempfile
from copy import deepcopy
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path, PurePosixPath
from typing import Any, Sequence
from urllib.parse import unquote, urlparse
from uuid import UUID, uuid4

from .canonical import (
    attach_digest,
    canonical_json_bytes,
    sha256_bytes,
    sha256_file,
    verify_digest,
    write_canonical_json,
)
from .dataset import HARD_SUBSETS, DatasetValidationError, validate_dataset


WORKBENCH_SCHEMA_VERSION = "commandcanvas.hand-annotation-edit/v1"
FINALIZATION_SCHEMA_VERSION = "commandcanvas.hand-annotation-finalization/v1"
DRAFT_HANDOFF_SCHEMA_VERSION = "commandcanvas.hand-annotation-handoff/v1"
DRAFT_SCHEMA_VERSION = "commandcanvas.hand-annotation-draft/v1"
DATASET_SCHEMA_VERSION = "commandcanvas.hand-dataset/v1"
DATASET_SCHEMA_VERSIONS = {DATASET_SCHEMA_VERSION}
WORKBENCH_TOOL = "commandcanvas-hand-annotation-workbench"
WORKBENCH_VERSION = "1.0.0"
KEYPOINT_NAMES = (
    "Wrist",
    "Thumb CMC",
    "Thumb MCP",
    "Thumb IP",
    "Thumb tip",
    "Index MCP",
    "Index PIP",
    "Index DIP",
    "Index tip",
    "Middle MCP",
    "Middle PIP",
    "Middle DIP",
    "Middle tip",
    "Ring MCP",
    "Ring PIP",
    "Ring DIP",
    "Ring tip",
    "Pinky MCP",
    "Pinky PIP",
    "Pinky DIP",
    "Pinky tip",
)
FRAME_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
EDITOR_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@+-]{0,127}$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
MAX_REQUEST_BYTES = 1_048_576


class AnnotationWorkbenchError(ValueError):
    """Raised when annotation input violates the workbench contract."""


class AnnotationConflict(AnnotationWorkbenchError):
    """Raised when an editor attempts to overwrite newer annotation work."""


def _utc_timestamp() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise AnnotationWorkbenchError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _load_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=_strict_object
        )
    except AnnotationWorkbenchError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise AnnotationWorkbenchError(
            f"could not read strict JSON at {path}: {error}"
        ) from error
    if not isinstance(value, dict):
        raise AnnotationWorkbenchError(f"JSON at {path} must be an object")
    return value


def _resolve_dataset_paths(
    dataset_root: Path, manifest_path: Path
) -> tuple[Path, Path]:
    root = Path(dataset_root)
    manifest = Path(manifest_path)
    try:
        resolved_root = root.resolve(strict=True)
        resolved_manifest = manifest.resolve(strict=True)
    except OSError as error:
        raise AnnotationWorkbenchError(
            f"dataset and manifest must exist: {error}"
        ) from error
    if root.is_symlink() or not resolved_root.is_dir():
        raise AnnotationWorkbenchError("dataset root must be a non-symlink directory")
    if (
        manifest.is_symlink()
        or not resolved_manifest.is_file()
        or resolved_root not in resolved_manifest.parents
    ):
        raise AnnotationWorkbenchError(
            "manifest must be a regular file inside the dataset root"
        )
    return resolved_root, resolved_manifest


def validate_private_workspace(dataset_root: Path, repository_root: Path) -> None:
    """Refuse private annotation work inside the tracked source repository."""

    root = Path(dataset_root).resolve(strict=False)
    repository = Path(repository_root).resolve(strict=True)
    if root == repository or repository in root.parents or root in repository.parents:
        raise AnnotationWorkbenchError(
            "private annotation data must remain outside the repository"
        )


def validate_loopback_host(host: str) -> str:
    """Accept only an explicit local loopback bind."""

    if host == "localhost":
        return host
    try:
        address = ipaddress.ip_address(host)
    except ValueError as error:
        raise AnnotationWorkbenchError(
            "workbench host must be a loopback address"
        ) from error
    if not address.is_loopback:
        raise AnnotationWorkbenchError("workbench host must be a loopback address")
    return host


def validate_request_host(host_header: str) -> str:
    """Refuse DNS-rebinding Host headers before serving private material."""

    if (
        not isinstance(host_header, str)
        or not host_header
        or any(character.isspace() for character in host_header)
        or any(character in host_header for character in "/\\@?#")
    ):
        raise AnnotationWorkbenchError("request Host must identify loopback")
    parsed = urlparse(f"//{host_header}")
    try:
        hostname = parsed.hostname
        parsed.port
    except ValueError as error:
        raise AnnotationWorkbenchError("request Host must identify loopback") from error
    if not hostname:
        raise AnnotationWorkbenchError("request Host must identify loopback")
    try:
        validate_loopback_host(hostname)
    except AnnotationWorkbenchError as error:
        raise AnnotationWorkbenchError("request Host must identify loopback") from error
    return host_header


def _safe_asset(root: Path, relative: Any, *, location: str) -> Path:
    if not isinstance(relative, str):
        raise AnnotationWorkbenchError(f"{location} must be a safe relative path")
    pure = PurePosixPath(relative)
    if (
        not relative
        or "\\" in relative
        or pure.is_absolute()
        or any(part in {"", ".", ".."} for part in pure.parts)
    ):
        raise AnnotationWorkbenchError(f"{location} must be a safe relative path")
    candidate = root.joinpath(*pure.parts)
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise AnnotationWorkbenchError(f"{location} does not exist") from error
    if candidate.is_symlink() or not resolved.is_file() or root not in resolved.parents:
        raise AnnotationWorkbenchError(
            f"{location} must remain inside the dataset root"
        )
    return resolved


def _find_frame(
    manifest: dict[str, Any], session_id: str, frame_id: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    try:
        canonical_session = str(UUID(session_id))
    except (ValueError, TypeError) as error:
        raise AnnotationWorkbenchError("session_id must be a canonical UUID") from error
    if canonical_session != session_id:
        raise AnnotationWorkbenchError("session_id must be a lowercase canonical UUID")
    if not FRAME_ID_PATTERN.fullmatch(frame_id):
        raise AnnotationWorkbenchError("frame_id is invalid")
    sessions = manifest.get("sessions")
    if not isinstance(sessions, list):
        raise AnnotationWorkbenchError("manifest sessions must be an array")
    for session in sessions:
        if not isinstance(session, dict) or session.get("sessionId") != session_id:
            continue
        frames = session.get("frames")
        if not isinstance(frames, list):
            break
        for frame in frames:
            if isinstance(frame, dict) and frame.get("frameId") == frame_id:
                return session, frame
        break
    raise AnnotationWorkbenchError(f"frame not found: {session_id}/{frame_id}")


def _parse_label(
    label_path: Path, *, negative: bool, allow_empty_positive: bool = False
) -> list[dict[str, Any]]:
    try:
        rows = [
            row
            for row in label_path.read_text(encoding="utf-8").splitlines()
            if row.strip()
        ]
    except (OSError, UnicodeError) as error:
        raise AnnotationWorkbenchError(f"label cannot be read: {error}") from error
    if negative:
        if rows:
            raise AnnotationWorkbenchError("negative frame label must be empty")
        return []
    hands: list[dict[str, Any]] = []
    for row_index, row in enumerate(rows):
        tokens = row.split()
        if len(tokens) != 68 or tokens[0] != "0":
            raise AnnotationWorkbenchError(
                f"label row {row_index + 1} must be class 0 with exactly 68 tokens"
            )
        try:
            numbers = [float(token) for token in tokens[1:]]
        except ValueError as error:
            raise AnnotationWorkbenchError(
                f"label row {row_index + 1} is not numeric"
            ) from error
        if any(not math.isfinite(number) for number in numbers):
            raise AnnotationWorkbenchError(f"label row {row_index + 1} is not finite")
        bbox = {
            "centerX": numbers[0],
            "centerY": numbers[1],
            "width": numbers[2],
            "height": numbers[3],
        }
        keypoint_values = numbers[4:]
        keypoints = [
            {
                "x": keypoint_values[index * 3],
                "y": keypoint_values[index * 3 + 1],
                "visibility": int(keypoint_values[index * 3 + 2]),
            }
            for index in range(21)
        ]
        hands.append({"boundingBox": bbox, "keypoints": keypoints})
    if not hands and allow_empty_positive:
        return []
    if not 1 <= len(hands) <= 2:
        raise AnnotationWorkbenchError(
            "positive frame label must contain one or two hands"
        )
    return hands


def _draft_to_canonical(manifest: dict[str, Any]) -> dict[str, Any]:
    canonical = deepcopy(manifest)
    target_schema = canonical.pop("canonicalSchemaVersion", None)
    if target_schema not in DATASET_SCHEMA_VERSIONS:
        raise AnnotationWorkbenchError("draft canonicalSchemaVersion is unsupported")
    canonical["schemaVersion"] = target_schema
    canonical.pop("sourceAdapter", None)
    sessions = canonical.get("sessions")
    if not isinstance(sessions, list):
        raise AnnotationWorkbenchError("draft sessions must be an array")
    for session in sessions:
        if not isinstance(session, dict):
            raise AnnotationWorkbenchError("draft session must be an object")
        session.pop("visionSessionId", None)
        frames = session.get("frames")
        if not isinstance(frames, list):
            raise AnnotationWorkbenchError("draft session frames must be an array")
        reviewed = True
        for frame in frames:
            if not isinstance(frame, dict):
                raise AnnotationWorkbenchError("draft frame must be an object")
            frame_reviewed = frame.pop("reviewed", None)
            if not isinstance(frame_reviewed, bool):
                raise AnnotationWorkbenchError("draft frame reviewed must be boolean")
            reviewed = reviewed and frame_reviewed
        annotation = session.get("annotation")
        if not isinstance(annotation, dict):
            raise AnnotationWorkbenchError("draft annotation must be an object")
        if annotation.get("reviewed") is not reviewed:
            raise AnnotationWorkbenchError(
                "draft session reviewed state must equal its frame review states"
            )
    return canonical


def _bridge_handoff(manifest: dict[str, Any]) -> dict[str, Any]:
    """Bind reviewed labels to capture identities without inventing bridge provenance."""

    group_splits = {
        group: split
        for split, groups in manifest.get("splits", {}).items()
        if isinstance(groups, list)
        for group in groups
    }
    sessions: list[dict[str, Any]] = []
    for session in manifest["sessions"]:
        label_directories: set[str] = set()
        labels: list[dict[str, Any]] = []
        for frame in session["frames"]:
            label = frame["label"]
            label_path = PurePosixPath(label["path"])
            label_directories.add(label_path.parent.as_posix())
            labels.append(
                {
                    "frameId": frame["frameId"],
                    "timestampMs": frame["timestampMs"],
                    "path": label["path"],
                    "byteSize": label["byteSize"],
                    "sha256": label["sha256"],
                }
            )
        if len(label_directories) != 1:
            raise AnnotationWorkbenchError(
                "each draft session must use exactly one canonical label directory"
            )
        capture_group_id = session["captureGroupId"]
        sessions.append(
            {
                "visionSessionId": session["visionSessionId"],
                "datasetSessionId": session["sessionId"],
                "actorId": session["actorId"],
                "captureGroupId": capture_group_id,
                "split": group_splits.get(capture_group_id),
                "captureCategories": deepcopy(session["captureCategories"]),
                "sourceVideo": deepcopy(session["source"]),
                "labelDirectory": next(iter(label_directories)),
                "labels": labels,
                "annotation": deepcopy(session["annotation"]),
            }
        )
    return {
        "schemaVersion": DRAFT_HANDOFF_SCHEMA_VERSION,
        "datasetId": manifest["datasetId"],
        "sourceAdapter": deepcopy(manifest["sourceAdapter"]),
        "sessions": sessions,
        "productionEligible": False,
    }


def _validate_source_adapter(value: Any) -> dict[str, Any]:
    expected = {"name", "version", "sourceManifestSha256", "actorId"}
    if not isinstance(value, dict) or set(value) != expected:
        raise AnnotationWorkbenchError(
            "draft sourceAdapter fields do not match the v1 contract"
        )
    for field in ("name", "version", "actorId"):
        item = value.get(field)
        if not isinstance(item, str) or not EDITOR_ID_PATTERN.fullmatch(item):
            raise AnnotationWorkbenchError(
                f"draft sourceAdapter.{field} must be a stable identifier"
            )
    digest = value.get("sourceManifestSha256")
    if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
        raise AnnotationWorkbenchError(
            "draft sourceAdapter.sourceManifestSha256 must be a lowercase SHA-256 digest"
        )
    return value


def _validate_draft_shape(manifest: dict[str, Any]) -> None:
    expected_top = {
        "schemaVersion",
        "datasetId",
        "createdAt",
        "consent",
        "keypointOrder",
        "classNames",
        "splits",
        "sessions",
        "sourceAdapter",
        "canonicalSchemaVersion",
    }
    if set(manifest) != expected_top:
        raise AnnotationWorkbenchError(
            "draft manifest fields do not match the v1 contract"
        )
    source_adapter = _validate_source_adapter(manifest.get("sourceAdapter"))
    target_schema = manifest.get("canonicalSchemaVersion")
    if target_schema not in DATASET_SCHEMA_VERSIONS:
        raise AnnotationWorkbenchError("draft canonicalSchemaVersion is unsupported")
    sessions = manifest.get("sessions")
    if not isinstance(sessions, list):
        raise AnnotationWorkbenchError("draft sessions must be an array")
    split_groups = manifest.get("splits")
    holdout_groups = (
        set(split_groups.get("holdout", []))
        if isinstance(split_groups, dict)
        else set()
    )
    expected_session = {
        "sessionId",
        "captureGroupId",
        "visionSessionId",
        "actorId",
        "captureCategories",
        "source",
        "annotation",
        "frames",
    }
    expected_frame = {
        "frameId",
        "timestampMs",
        "categories",
        "reviewed",
        "image",
        "label",
    }
    vision_session_ids: set[str] = set()
    dataset_session_ids: set[str] = set()
    source_paths: set[str] = set()
    source_digests: set[str] = set()
    image_paths: set[str] = set()
    label_paths: set[str] = set()
    frame_identities: set[tuple[str, str]] = set()
    for session_index, session in enumerate(sessions):
        if not isinstance(session, dict) or set(session) != expected_session:
            raise AnnotationWorkbenchError(
                f"draft session {session_index} fields do not match the v1 contract"
            )
        vision_session_id = session.get("visionSessionId")
        if not isinstance(vision_session_id, str) or not EDITOR_ID_PATTERN.fullmatch(
            vision_session_id
        ):
            raise AnnotationWorkbenchError(
                f"draft session {session_index} visionSessionId is invalid"
            )
        session_id = session.get("sessionId")
        if vision_session_id in vision_session_ids:
            raise AnnotationWorkbenchError("draft visionSessionId must be unique")
        if not isinstance(session_id, str) or session_id in dataset_session_ids:
            raise AnnotationWorkbenchError("draft dataset sessionId must be unique")
        vision_session_ids.add(vision_session_id)
        dataset_session_ids.add(session_id)
        if session.get("actorId") != source_adapter["actorId"]:
            raise AnnotationWorkbenchError(
                "draft session actor must match the source adapter actor"
            )
        source = session.get("source")
        if not isinstance(source, dict):
            raise AnnotationWorkbenchError(
                f"draft session {session_index} source must be an object"
            )
        source_path = source.get("path")
        source_digest = source.get("sha256")
        if not isinstance(source_path, str) or source_path in source_paths:
            raise AnnotationWorkbenchError("draft source path must be unique")
        if not isinstance(source_digest, str) or source_digest in source_digests:
            raise AnnotationWorkbenchError("draft source identity must be unique")
        source_paths.add(source_path)
        source_digests.add(source_digest)
        annotation = session.get("annotation")
        if not isinstance(annotation, dict):
            raise AnnotationWorkbenchError(
                f"draft session {session_index} annotation must be an object"
            )
        if session.get("captureGroupId") in holdout_groups and (
            annotation.get("method") != "manual"
            or annotation.get("modelSha256") is not None
        ):
            raise AnnotationWorkbenchError(
                "draft holdout sessions must be manual and cannot use model prelabels"
            )
        frames = session.get("frames")
        if not isinstance(frames, list):
            raise AnnotationWorkbenchError(
                f"draft session {session_index} frames must be an array"
            )
        all_reviewed = True
        for frame_index, frame in enumerate(frames):
            if not isinstance(frame, dict) or set(frame) != expected_frame:
                raise AnnotationWorkbenchError(
                    f"draft frame {session_index}/{frame_index} fields do not match the v1 contract"
                )
            if not isinstance(frame.get("reviewed"), bool):
                raise AnnotationWorkbenchError(
                    f"draft frame {session_index}/{frame_index} reviewed must be boolean"
                )
            timestamp_ms = frame.get("timestampMs")
            expected_frame_id = (
                f"frame-{timestamp_ms:010d}"
                if isinstance(timestamp_ms, int) and not isinstance(timestamp_ms, bool)
                else None
            )
            expected_image_path = (
                f"images/{session_id}/{expected_frame_id}.png"
                if expected_frame_id is not None and isinstance(session_id, str)
                else None
            )
            expected_label_path = (
                f"labels/{session_id}/{expected_frame_id}.txt"
                if expected_frame_id is not None and isinstance(session_id, str)
                else None
            )
            image = frame.get("image")
            label = frame.get("label")
            if (
                frame.get("frameId") != expected_frame_id
                or not isinstance(image, dict)
                or image.get("path") != expected_image_path
                or not isinstance(label, dict)
                or label.get("path") != expected_label_path
            ):
                raise AnnotationWorkbenchError(
                    f"draft frame {session_index}/{frame_index} timestamp and asset paths do not match the bridge contract"
                )
            frame_id = frame["frameId"]
            frame_identity = (session_id, frame_id)
            if frame_identity in frame_identities:
                raise AnnotationWorkbenchError("draft frame identity must be unique")
            if image["path"] in image_paths:
                raise AnnotationWorkbenchError("draft image path must be unique")
            if label["path"] in label_paths:
                raise AnnotationWorkbenchError("draft label path must be unique")
            frame_identities.add(frame_identity)
            image_paths.add(image["path"])
            label_paths.add(label["path"])
            all_reviewed = all_reviewed and frame["reviewed"]
        if annotation.get("reviewed") is not all_reviewed:
            raise AnnotationWorkbenchError(
                f"draft session {session_index} reviewed state must equal its frame review states"
            )


_ALLOWED_DRAFT_VALIDATION_ERRORS = (
    re.compile(
        r"^sessions\[\d+\]\.frames\[\d+\] positive frame label must contain one or two hands$"
    ),
    re.compile(r"^holdout annotation at sessions\[\d+\] must be manual and reviewed$"),
)


def _validate_canonical_candidate(
    root: Path, manifest: dict[str, Any], *, allow_incomplete: bool
) -> dict[str, Any] | None:
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=".annotation-candidate-", suffix=".json", dir=root
    )
    candidate_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(canonical_json_bytes(manifest))
            output.flush()
            os.fsync(output.fileno())
        try:
            return validate_dataset(root, candidate_path)
        except DatasetValidationError as error:
            if not allow_incomplete:
                raise
            lines = str(error).splitlines()
            problems = [line[2:] for line in lines[1:] if line.startswith("- ")]
            if not problems or any(
                not any(
                    pattern.fullmatch(problem)
                    for pattern in _ALLOWED_DRAFT_VALIDATION_ERRORS
                )
                for problem in problems
            ):
                raise AnnotationWorkbenchError(str(error)) from error
            return None
    finally:
        candidate_path.unlink(missing_ok=True)


def validate_annotation_manifest(
    dataset_root: Path, manifest_path: Path, *, require_complete: bool = False
) -> dict[str, Any]:
    """Validate either a strict dataset or its private, reviewable draft."""

    root, manifest_file = _resolve_dataset_paths(dataset_root, manifest_path)
    manifest = _load_json_object(manifest_file)
    schema = manifest.get("schemaVersion")
    if schema in DATASET_SCHEMA_VERSIONS:
        validation = validate_dataset(root, manifest_file)
        return {
            "kind": "dataset",
            "complete": True,
            "reviewedFrameCount": validation["frameCount"],
            "frameCount": validation["frameCount"],
            "datasetValidation": validation,
        }
    if schema != DRAFT_SCHEMA_VERSION:
        raise AnnotationWorkbenchError(
            f"annotation manifest schemaVersion must be {DRAFT_SCHEMA_VERSION} or a supported strict dataset schema"
        )
    _validate_draft_shape(manifest)
    canonical = _draft_to_canonical(manifest)
    frames = [frame for session in manifest["sessions"] for frame in session["frames"]]
    reviewed_count = sum(1 for frame in frames if frame["reviewed"])
    for session in manifest["sessions"]:
        for frame in session["frames"]:
            categories = frame.get("categories")
            label = frame.get("label")
            if not isinstance(categories, list) or not isinstance(label, dict):
                continue
            label_path = _safe_asset(root, label.get("path"), location="frame label")
            hands = _parse_label(
                label_path,
                negative=categories == ["negative"],
                allow_empty_positive=not frame["reviewed"],
            )
            if frame["reviewed"] and categories != ["negative"] and not hands:
                raise AnnotationWorkbenchError(
                    "reviewed positive draft frame must contain one or two hands"
                )
    complete = reviewed_count == len(frames)
    if require_complete and not complete:
        raise AnnotationWorkbenchError(
            f"draft is not reviewed: {reviewed_count} of {len(frames)} frames complete"
        )
    dataset_validation = _validate_canonical_candidate(
        root, canonical, allow_incomplete=not require_complete
    )
    return {
        "kind": "draft",
        "complete": complete,
        "reviewedFrameCount": reviewed_count,
        "frameCount": len(frames),
        "datasetValidation": dataset_validation,
    }


def load_frame_annotation(
    dataset_root: Path,
    manifest_path: Path,
    session_id: str,
    frame_id: str,
) -> dict[str, Any]:
    """Load a frame and its exact current annotation with concurrency digests."""

    root, manifest_file = _resolve_dataset_paths(dataset_root, manifest_path)
    manifest = _load_json_object(manifest_file)
    draft = manifest.get("schemaVersion") == DRAFT_SCHEMA_VERSION
    session, frame = _find_frame(manifest, session_id, frame_id)
    categories = frame.get("categories")
    if not isinstance(categories, list):
        raise AnnotationWorkbenchError("frame categories must be an array")
    negative = categories == ["negative"]
    image = frame.get("image")
    label = frame.get("label")
    if not isinstance(image, dict) or not isinstance(label, dict):
        raise AnnotationWorkbenchError("frame image and label assets must be objects")
    image_path = _safe_asset(root, image.get("path"), location="frame image")
    label_path = _safe_asset(root, label.get("path"), location="frame label")
    return {
        "sessionId": session_id,
        "frameId": frame_id,
        "timestampMs": frame.get("timestampMs"),
        "categories": categories,
        "negative": negative,
        "hands": _parse_label(
            label_path, negative=negative, allow_empty_positive=draft
        ),
        "reviewed": frame.get("reviewed", True),
        "image": {
            "path": image.get("path"),
            "width": image.get("width"),
            "height": image.get("height"),
            "sha256": sha256_file(image_path),
        },
        "annotation": deepcopy(session.get("annotation")),
        "manifestSha256": sha256_file(manifest_file),
        "labelSha256": sha256_file(label_path),
    }


def _validate_editor_id(editor_id: Any) -> str:
    if not isinstance(editor_id, str) or not EDITOR_ID_PATTERN.fullmatch(editor_id):
        raise AnnotationWorkbenchError(
            "editor_id must be a stable non-secret identifier"
        )
    return editor_id


def _validate_categories(categories: Any, *, negative: bool) -> list[str]:
    if not isinstance(categories, list) or any(
        not isinstance(item, str) for item in categories
    ):
        raise AnnotationWorkbenchError("categories must be an array of strings")
    if negative:
        if categories != ["negative"]:
            raise AnnotationWorkbenchError(
                'no-hand annotations require categories ["negative"]'
            )
        return ["negative"]
    allowed = set(HARD_SUBSETS) - {"negative"}
    if (
        not categories
        or len(categories) != len(set(categories))
        or any(item not in allowed for item in categories)
    ):
        raise AnnotationWorkbenchError(
            "positive categories must be unique supported hard subsets"
        )
    return sorted(categories)


def _validated_hands(
    hands: Any, *, negative: bool
) -> list[list[tuple[float, float, int]]]:
    if not isinstance(hands, list):
        raise AnnotationWorkbenchError("hands must be an array")
    if negative:
        if hands:
            raise AnnotationWorkbenchError("no-hand annotations cannot contain hands")
        return []
    if not 1 <= len(hands) <= 2:
        raise AnnotationWorkbenchError("positive annotations require one or two hands")
    validated: list[list[tuple[float, float, int]]] = []
    for hand_index, hand in enumerate(hands):
        if not isinstance(hand, dict) or set(hand) != {"keypoints"}:
            raise AnnotationWorkbenchError(
                f"hand {hand_index + 1} must contain only keypoints"
            )
        keypoints = hand.get("keypoints")
        if not isinstance(keypoints, list) or len(keypoints) != 21:
            raise AnnotationWorkbenchError(
                f"hand {hand_index + 1} must contain exactly 21 keypoints"
            )
        normalized: list[tuple[float, float, int]] = []
        for point_index, point in enumerate(keypoints):
            if not isinstance(point, dict) or set(point) != {
                "x",
                "y",
                "visibility",
            }:
                raise AnnotationWorkbenchError(
                    f"hand {hand_index + 1} keypoint {point_index + 1} has invalid fields"
                )
            x = point.get("x")
            y = point.get("y")
            visibility = point.get("visibility")
            if (
                isinstance(x, bool)
                or not isinstance(x, (int, float))
                or isinstance(y, bool)
                or not isinstance(y, (int, float))
                or not math.isfinite(float(x))
                or not math.isfinite(float(y))
                or not 0 <= float(x) <= 1
                or not 0 <= float(y) <= 1
            ):
                raise AnnotationWorkbenchError(
                    f"hand {hand_index + 1} keypoint {point_index + 1} must be normalized"
                )
            if isinstance(visibility, bool) or visibility not in {0, 1, 2}:
                raise AnnotationWorkbenchError(
                    f"hand {hand_index + 1} keypoint {point_index + 1} visibility must be 0, 1, or 2"
                )
            normalized.append((float(x), float(y), int(visibility)))
        if not any(point[2] > 0 for point in normalized):
            raise AnnotationWorkbenchError(
                f"hand {hand_index + 1} has no visible keypoints"
            )
        validated.append(normalized)
    return validated


def _format_number(value: float) -> str:
    return f"{value:.6f}"


def _label_bytes(hands: Sequence[Sequence[tuple[float, float, int]]]) -> bytes:
    rows: list[str] = []
    for hand in hands:
        visible = [(x, y) for x, y, visibility in hand if visibility > 0]
        minimum_x = min(point[0] for point in visible)
        maximum_x = max(point[0] for point in visible)
        minimum_y = min(point[1] for point in visible)
        maximum_y = max(point[1] for point in visible)
        padding = 0.02
        left = max(0.0, minimum_x - padding)
        right = min(1.0, maximum_x + padding)
        top = max(0.0, minimum_y - padding)
        bottom = min(1.0, maximum_y + padding)
        if right <= left:
            right = min(1.0, left + 0.001)
        if bottom <= top:
            bottom = min(1.0, top + 0.001)
        tokens = [
            "0",
            _format_number((left + right) / 2),
            _format_number((top + bottom) / 2),
            _format_number(right - left),
            _format_number(bottom - top),
        ]
        for x, y, visibility in hand:
            tokens.extend((_format_number(x), _format_number(y), str(visibility)))
        if len(tokens) != 68:  # pragma: no cover - construction invariant
            raise AssertionError("YOLO hand-pose row must contain 68 tokens")
        rows.append(" ".join(tokens))
    return (("\n".join(rows) + "\n") if rows else "").encode("utf-8")


def _atomic_write_bytes(path: Path, contents: bytes) -> None:
    if path.is_symlink():
        raise AnnotationWorkbenchError(f"refusing to overwrite symlink: {path}")
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)


def _write_bytes_exclusive(path: Path, contents: bytes) -> None:
    """Create an immutable receipt without replacing a concurrent writer."""

    if path.exists() or path.is_symlink():
        raise FileExistsError(path)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def _load_finalization_receipt(path: Path, *, draft: bool) -> dict[str, Any]:
    expected = {
        "schemaVersion",
        "finalizedAt",
        "editorId",
        "datasetId",
        "manifestSha256",
        "editIds",
        "editReceiptSha256s",
        "datasetValidation",
        "eligibleForTraining",
        "productionEligible",
        "eligibilityScope",
        "receiptSha256",
    }
    if draft:
        expected.update(
            {
                "draftManifestSha256",
                "sourceAdapter",
                "visionSessionIds",
                "bridgeHandoff",
            }
        )
    if path.is_symlink() or not path.is_file():
        raise AnnotationWorkbenchError("finalization receipt path is unsafe")
    receipt = _load_json_object(path)
    if set(receipt) != expected:
        raise AnnotationWorkbenchError(
            "finalization receipt fields do not match the immutable contract"
        )
    if (
        receipt.get("schemaVersion") != FINALIZATION_SCHEMA_VERSION
        or not verify_digest(receipt, "receiptSha256")
        or receipt.get("eligibleForTraining") is not True
        or receipt.get("productionEligible") is not False
    ):
        raise AnnotationWorkbenchError("finalization receipt is invalid")
    return receipt


def _capture_categories(session: dict[str, Any]) -> list[str]:
    frames = session.get("frames")
    if not isinstance(frames, list):
        raise AnnotationWorkbenchError("session frames must be an array")
    return sorted(
        {
            category
            for frame in frames
            if isinstance(frame, dict) and isinstance(frame.get("categories"), list)
            for category in frame["categories"]
            if isinstance(category, str)
        }
    )


def save_frame_annotation(
    *,
    dataset_root: Path,
    manifest_path: Path,
    session_id: str,
    frame_id: str,
    editor_id: str,
    expected_manifest_sha256: str,
    expected_label_sha256: str,
    negative: bool,
    categories: list[str],
    hands: list[dict[str, object]],
) -> dict[str, Any]:
    """Save one corrected annotation and an immutable provenance receipt."""

    root, manifest_file = _resolve_dataset_paths(dataset_root, manifest_path)
    validate_private_workspace(root, Path(__file__).resolve().parents[4])
    editor = _validate_editor_id(editor_id)
    finalization_path = root / "annotation-finalization-receipt.json"
    if finalization_path.exists() or finalization_path.is_symlink():
        raise AnnotationWorkbenchError(
            "dataset is finalized and annotations are immutable"
        )
    if not isinstance(negative, bool):
        raise AnnotationWorkbenchError("negative must be boolean")
    normalized_categories = _validate_categories(categories, negative=negative)
    normalized_hands = _validated_hands(hands, negative=negative)
    if not SHA256_PATTERN.fullmatch(
        expected_manifest_sha256 or ""
    ) or not SHA256_PATTERN.fullmatch(expected_label_sha256 or ""):
        raise AnnotationWorkbenchError(
            "expected digests must be lowercase SHA-256 values"
        )

    manifest = _load_json_object(manifest_file)
    draft = manifest.get("schemaVersion") == DRAFT_SCHEMA_VERSION
    if not draft and manifest.get("schemaVersion") not in DATASET_SCHEMA_VERSIONS:
        raise AnnotationWorkbenchError("unsupported annotation manifest schema")
    session, frame = _find_frame(manifest, session_id, frame_id)
    label = frame.get("label")
    if not isinstance(label, dict):
        raise AnnotationWorkbenchError("frame label asset must be an object")
    label_path = _safe_asset(root, label.get("path"), location="frame label")
    current_manifest_sha = sha256_file(manifest_file)
    current_label_sha = sha256_file(label_path)
    if (
        current_manifest_sha != expected_manifest_sha256
        or current_label_sha != expected_label_sha256
    ):
        raise AnnotationConflict(
            "annotation changed since it was loaded; reload before saving"
        )

    previous_annotation = deepcopy(session.get("annotation"))
    previous_categories = deepcopy(frame.get("categories"))
    previous_reviewed = frame.get("reviewed", True)
    previous_manifest_bytes = manifest_file.read_bytes()
    previous_label_bytes = label_path.read_bytes()
    new_label_bytes = _label_bytes(normalized_hands)
    new_label_sha = sha256_bytes(new_label_bytes)
    frame["categories"] = normalized_categories
    if draft:
        frame["reviewed"] = True
    label["byteSize"] = len(new_label_bytes)
    label["sha256"] = new_label_sha
    session["captureCategories"] = _capture_categories(session)
    annotation = session.get("annotation")
    if not isinstance(annotation, dict):
        raise AnnotationWorkbenchError(
            "session annotation provenance must be an object"
        )
    annotation["reviewed"] = (
        all(
            isinstance(item, dict) and item.get("reviewed") is True
            for item in session.get("frames", [])
        )
        if draft
        else True
    )
    annotation["tool"] = WORKBENCH_TOOL
    annotation["toolVersion"] = WORKBENCH_VERSION
    new_manifest_bytes = canonical_json_bytes(manifest)
    if (
        new_label_bytes == previous_label_bytes
        and new_manifest_bytes == previous_manifest_bytes
    ):
        raise AnnotationWorkbenchError("annotation is unchanged")
    result_manifest_sha = sha256_bytes(new_manifest_bytes)

    edit_id = str(uuid4())
    edited_at = _utc_timestamp()
    relative_receipt = PurePosixPath(
        "annotation-receipts", f"{edited_at.replace(':', '-')}-{edit_id}.json"
    )
    receipt = attach_digest(
        {
            "schemaVersion": WORKBENCH_SCHEMA_VERSION,
            "editId": edit_id,
            "editedAt": edited_at,
            "editorId": editor,
            "sessionId": session_id,
            "frameId": frame_id,
            "negative": negative,
            "handCount": len(normalized_hands),
            "previousCategories": previous_categories,
            "resultCategories": normalized_categories,
            "previousFrameReviewed": previous_reviewed,
            "resultFrameReviewed": True,
            "previousAnnotation": previous_annotation,
            "resultAnnotation": deepcopy(annotation),
            "sourceManifestSha256": current_manifest_sha,
            "resultManifestSha256": result_manifest_sha,
            "sourceLabelSha256": current_label_sha,
            "resultLabelSha256": new_label_sha,
            "receiptPath": relative_receipt.as_posix(),
            "productionEligible": False,
        },
        "receiptSha256",
    )
    receipt_path = root.joinpath(*relative_receipt.parts)
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    if receipt_path.exists() or receipt_path.is_symlink():
        raise AnnotationWorkbenchError("annotation receipt path already exists")

    _atomic_write_bytes(label_path, new_label_bytes)
    _atomic_write_bytes(manifest_file, new_manifest_bytes)
    try:
        validate_annotation_manifest(root, manifest_file)
        write_canonical_json(receipt_path, receipt)
    except (DatasetValidationError, OSError, UnicodeError, ValueError) as error:
        _atomic_write_bytes(label_path, previous_label_bytes)
        _atomic_write_bytes(manifest_file, previous_manifest_bytes)
        receipt_path.unlink(missing_ok=True)
        raise AnnotationWorkbenchError(
            f"corrected annotation would invalidate dataset: {error}"
        ) from error
    return receipt


def finalize_annotations(
    *, dataset_root: Path, manifest_path: Path, editor_id: str
) -> dict[str, Any]:
    """Validate the complete dataset and bind every edit into one final receipt."""

    root, manifest_file = _resolve_dataset_paths(dataset_root, manifest_path)
    validate_private_workspace(root, Path(__file__).resolve().parents[4])
    editor = _validate_editor_id(editor_id)
    manifest = _load_json_object(manifest_file)
    draft = manifest.get("schemaVersion") == DRAFT_SCHEMA_VERSION
    if draft:
        validate_annotation_manifest(root, manifest_file, require_complete=True)
        canonical_manifest = _draft_to_canonical(manifest)
        canonical_bytes = canonical_json_bytes(canonical_manifest)
        canonical_manifest_file = root / "dataset-manifest.json"
        if canonical_manifest_file.exists():
            if (
                canonical_manifest_file.is_symlink()
                or not canonical_manifest_file.is_file()
            ):
                raise AnnotationWorkbenchError(
                    "canonical dataset manifest output path is unsafe"
                )
            if canonical_manifest_file.read_bytes() != canonical_bytes:
                raise AnnotationConflict(
                    "canonical dataset manifest already exists with different bytes"
                )
        validation = _validate_canonical_candidate(
            root, canonical_manifest, allow_incomplete=False
        )
        assert validation is not None
    else:
        canonical_manifest_file = manifest_file
        canonical_bytes = manifest_file.read_bytes()
        validation = validate_dataset(root, manifest_file)
    receipt_directory = root / "annotation-receipts"
    receipts: list[dict[str, Any]] = []
    if receipt_directory.exists():
        if receipt_directory.is_symlink() or not receipt_directory.is_dir():
            raise AnnotationWorkbenchError("annotation receipt directory is unsafe")
        for path in sorted(receipt_directory.glob("*.json")):
            if path.is_symlink() or not path.is_file():
                raise AnnotationWorkbenchError(
                    "annotation receipt must be a regular file"
                )
            receipt = _load_json_object(path)
            if receipt.get(
                "schemaVersion"
            ) != WORKBENCH_SCHEMA_VERSION or not verify_digest(
                receipt, "receiptSha256"
            ):
                raise AnnotationWorkbenchError(
                    f"invalid annotation receipt: {path.name}"
                )
            receipts.append(receipt)
    current_manifest_sha = sha256_file(manifest_file)
    receipts_by_result: dict[str, dict[str, Any]] = {}
    for receipt in receipts:
        source_sha = receipt.get("sourceManifestSha256")
        result_sha = receipt.get("resultManifestSha256")
        if not isinstance(source_sha, str) or not SHA256_PATTERN.fullmatch(source_sha):
            raise AnnotationWorkbenchError(
                "annotation receipt has invalid source manifest digest"
            )
        if not isinstance(result_sha, str) or not SHA256_PATTERN.fullmatch(result_sha):
            raise AnnotationWorkbenchError(
                "annotation receipt has invalid result manifest digest"
            )
        if result_sha in receipts_by_result:
            raise AnnotationWorkbenchError(
                "annotation receipts do not form a single manifest chain"
            )
        receipts_by_result[result_sha] = receipt
    reverse_chain: list[dict[str, Any]] = []
    cursor = current_manifest_sha
    while cursor in receipts_by_result:
        receipt = receipts_by_result.pop(cursor)
        reverse_chain.append(receipt)
        cursor = receipt["sourceManifestSha256"]
    if receipts_by_result:
        raise AnnotationWorkbenchError(
            "annotation receipts do not form a single manifest chain"
        )
    edit_receipts = list(reversed(reverse_chain))
    if draft:
        source_actor = manifest["sourceAdapter"]["actorId"]
        if editor != source_actor or any(
            receipt.get("editorId") != source_actor for receipt in edit_receipts
        ):
            raise AnnotationWorkbenchError(
                "draft editor and every edit receipt must preserve the source actor"
            )
        expected_reviews = {
            (session["sessionId"], frame["frameId"])
            for session in manifest["sessions"]
            for frame in session["frames"]
        }
        receipted_reviews = {
            (receipt.get("sessionId"), receipt.get("frameId"))
            for receipt in edit_receipts
            if receipt.get("resultFrameReviewed") is True
        }
        if receipted_reviews != expected_reviews:
            missing = len(expected_reviews - receipted_reviews)
            unexpected = len(receipted_reviews - expected_reviews)
            raise AnnotationWorkbenchError(
                "draft manual review requires an edit receipt for every frame "
                f"(missing {missing}, unexpected {unexpected})"
            )
    final_value: dict[str, Any] = {
        "schemaVersion": FINALIZATION_SCHEMA_VERSION,
        "finalizedAt": _utc_timestamp(),
        "editorId": editor,
        "datasetId": validation["datasetId"],
        "manifestSha256": sha256_bytes(canonical_bytes),
        "editIds": [item["editId"] for item in edit_receipts],
        "editReceiptSha256s": [item["receiptSha256"] for item in edit_receipts],
        "datasetValidation": validation,
        "eligibleForTraining": True,
        "productionEligible": False,
        "eligibilityScope": "dataset-for-training-only",
    }
    if draft:
        final_value.update(
            {
                "draftManifestSha256": current_manifest_sha,
                "sourceAdapter": deepcopy(manifest["sourceAdapter"]),
                "visionSessionIds": [
                    session["visionSessionId"] for session in manifest["sessions"]
                ],
                "bridgeHandoff": _bridge_handoff(manifest),
            }
        )
    finalization_path = root / "annotation-finalization-receipt.json"
    if finalization_path.exists() or finalization_path.is_symlink():
        existing = _load_finalization_receipt(finalization_path, draft=draft)
        existing_invariants = deepcopy(existing)
        existing_invariants.pop("finalizedAt")
        existing_invariants.pop("receiptSha256")
        expected_invariants = deepcopy(final_value)
        expected_invariants.pop("finalizedAt")
        if existing_invariants != expected_invariants:
            raise AnnotationConflict(
                "immutable finalization receipt does not match current dataset state"
            )
        return existing
    final = attach_digest(final_value, "receiptSha256")
    if draft and not canonical_manifest_file.exists():
        _atomic_write_bytes(canonical_manifest_file, canonical_bytes)
    try:
        _write_bytes_exclusive(finalization_path, canonical_json_bytes(final))
        return final
    except FileExistsError:
        existing = _load_finalization_receipt(finalization_path, draft=draft)
        existing_invariants = deepcopy(existing)
        existing_invariants.pop("finalizedAt")
        existing_invariants.pop("receiptSha256")
        expected_invariants = deepcopy(final_value)
        expected_invariants.pop("finalizedAt")
        if existing_invariants != expected_invariants:
            raise AnnotationConflict(
                "concurrent immutable finalization does not match current dataset state"
            )
        return existing


def validate_annotation_finalization(
    *, dataset_root: Path, receipt_path: Path
) -> dict[str, Any]:
    """Revalidate an immutable finalization receipt against all current draft bytes."""

    root = Path(dataset_root).resolve(strict=True)
    supplied = Path(receipt_path).resolve(strict=True)
    expected = (root / "annotation-finalization-receipt.json").resolve(strict=True)
    if supplied != expected or Path(receipt_path).is_symlink():
        raise AnnotationWorkbenchError(
            "finalization receipt must be the canonical file in the draft root"
        )
    draft_path = root / "annotation-draft.json"
    if draft_path.is_symlink() or not draft_path.is_file():
        raise AnnotationWorkbenchError(
            "annotation draft is missing beside the finalization receipt"
        )
    initial = _load_finalization_receipt(supplied, draft=True)
    editor = _validate_editor_id(initial.get("editorId"))
    current = finalize_annotations(
        dataset_root=root,
        manifest_path=draft_path,
        editor_id=editor,
    )
    if current != initial or canonical_json_bytes(current) != supplied.read_bytes():
        raise AnnotationWorkbenchError(
            "finalization receipt is not canonical or no longer matches the draft"
        )
    return current


def render_workbench_html(csrf_token: str, editor_id: str = "owner-daniel") -> str:
    """Return a self-contained editor; no external scripts, fonts, or assets."""

    if not csrf_token or any(character in csrf_token for character in "<>\"'"):
        raise AnnotationWorkbenchError("invalid workbench token")
    editor = _validate_editor_id(editor_id)
    names = json.dumps(KEYPOINT_NAMES)
    token = json.dumps(csrf_token)
    editor_json = json.dumps(editor)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CommandCanvas Hand Annotation</title>
  <style>
    :root {{ color-scheme: dark; font: 15px/1.4 ui-sans-serif, system-ui, sans-serif; }}
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; min-height: 100vh; background: #090b12; color: #f7f8ff; }}
    header {{ display:flex; gap:16px; align-items:center; justify-content:space-between; padding:14px 18px; border-bottom:1px solid #2a3044; }}
    h1 {{ font-size:18px; margin:0; }}
    main {{ display:grid; grid-template-columns:minmax(0,1fr) 330px; gap:14px; padding:14px; min-height:calc(100vh - 58px); }}
    .stage {{ display:grid; place-items:center; min-width:0; overflow:hidden; border:1px solid #2a3044; border-radius:16px; background:#02030a; }}
    canvas {{ display:block; max-width:100%; max-height:calc(100vh - 90px); touch-action:none; cursor:crosshair; }}
    aside {{ display:flex; flex-direction:column; gap:12px; overflow:auto; }}
    section {{ border:1px solid #2a3044; border-radius:14px; padding:12px; background:#111522; }}
    button, select {{ min-height:42px; border:1px solid #46506c; border-radius:10px; background:#1c2234; color:inherit; padding:8px 11px; }}
    button.primary {{ background:#6657ee; border-color:#8478ff; font-weight:700; }}
    button:disabled {{ opacity:.45; }}
    .row {{ display:flex; gap:8px; align-items:center; flex-wrap:wrap; }}
    .frames {{ max-height:180px; overflow:auto; display:grid; gap:4px; }}
    .frames button {{ text-align:left; }}
    .active {{ outline:2px solid #8e83ff; }}
    .muted {{ color:#aeb6ce; font-size:13px; }}
    .status {{ min-height:42px; white-space:pre-wrap; }}
    label {{ display:flex; align-items:center; gap:7px; }}
    @media (max-width:800px) {{ main {{ grid-template-columns:1fr; }} canvas {{ max-height:62vh; }} }}
  </style>
</head>
<body>
  <header><h1>CommandCanvas Hand Annotation</h1><div class="muted">Local only · exact 21-point review · {editor}</div></header>
  <main>
    <div class="stage"><canvas id="canvas" aria-label="Hand keypoint annotation canvas"></canvas></div>
    <aside>
      <section><strong id="counter">Frame 0 / 0</strong><div class="frames" id="frames"></div></section>
      <section>
        <div class="row"><button id="previous">Previous</button><button id="next">Next</button></div>
        <p id="pointName">Wrist · 1 / 21</p>
        <div class="row"><button id="addHand">Add hand</button><button id="removeHand">Remove hand</button></div>
        <div class="row"><button id="undoPoint">Undo point</button><label><input id="negative" type="checkbox"> Mark no hand</label></div>
        <label>Visibility <select id="visibility"><option value="2">Visible</option><option value="1">Occluded</option><option value="0">Absent</option></select></label>
      </section>
      <section><strong>Frame categories</strong><div id="categories"></div><p class="muted">Each hand must reach 21 / 21 points before save.</p></section>
      <section><div class="row"><button class="primary" id="save">Save correction</button><button id="finalize">Finalize dataset</button></div><div class="status muted" id="status">Loading…</div></section>
    </aside>
  </main>
<script>
(() => {{
  "use strict";
  const token = {token};
  const editorId = {editor_json};
  const pointNames = {names};
  const bones = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
  const canvas = document.getElementById("canvas"), context = canvas.getContext("2d");
  const status = document.getElementById("status"), framesNode = document.getElementById("frames");
  let listing = [], selectedIndex = 0, current = null, currentFrame = null, image = null, activeHand = 0, activePoint = 0, placing = false, drag = null;
  let loadGeneration = 0, loadAbortController = null;
  const request = async (path, options={{}}) => {{
    options.headers = {{...(options.headers || {{}}), "X-CommandCanvas-Workbench-Token": token}};
    if (options.body) options.headers["Content-Type"] = "application/json";
    const response = await fetch(path, options), payload = await response.json();
    if (!response.ok) throw new Error(payload.error || `Request failed (${{response.status}})`);
    return payload;
  }};
  const setStatus = (message, error=false) => {{ status.textContent = message; status.style.color = error ? "#ff9ca8" : "#aeb6ce"; }};
  const framePath = item => `/api/frame/${{encodeURIComponent(item.sessionId)}}/${{encodeURIComponent(item.frameId)}}`;
  const imagePath = item => `/api/image/${{encodeURIComponent(item.sessionId)}}/${{encodeURIComponent(item.frameId)}}`;
  async function loadListing(keepSelection=false) {{
    const payload = await request("/api/state"); listing = payload.frames; renderListing(); await loadFrame(keepSelection?selectedIndex:0);
  }}
  function renderListing() {{
    framesNode.replaceChildren(...listing.map((item,index) => {{ const button=document.createElement("button"); button.textContent=`${{item.reviewed?"✓":"○"}} ${{item.split}} · ${{item.frameId}}`; button.className=index===selectedIndex?"active":""; button.onclick=()=>loadFrame(index); return button; }}));
  }}
  async function loadFrame(index) {{
    if (!listing.length) return;
    const targetIndex=Math.max(0,Math.min(listing.length-1,index));
    const targetFrame=Object.freeze({{...listing[targetIndex]}});
    const generation=++loadGeneration;
    if(loadAbortController) loadAbortController.abort();
    const controller=new AbortController(); loadAbortController=controller;
    setStatus("Loading frame…");
    try {{
      const nextCurrent=await request(framePath(targetFrame),{{signal:controller.signal}});
      if(generation !== loadGeneration) return;
      const imageResponse=await fetch(imagePath(targetFrame),{{signal:controller.signal,headers:{{"X-CommandCanvas-Workbench-Token":token}}}});
      if(!imageResponse.ok) throw new Error(`Image failed (${{imageResponse.status}})`);
      const blob=await imageResponse.blob();
      if(generation !== loadGeneration) return;
      const imageUrl=URL.createObjectURL(blob), nextImage=new Image();
      try {{
        await new Promise((resolve,reject)=>{{
          const abort=()=>{{nextImage.src="";reject(new DOMException("Frame load aborted","AbortError"));}};
          controller.signal.addEventListener("abort",abort,{{once:true}});
          nextImage.onload=()=>{{controller.signal.removeEventListener("abort",abort);resolve();}};
          nextImage.onerror=()=>{{controller.signal.removeEventListener("abort",abort);reject(new Error("Frame image could not be decoded"));}};
          nextImage.src=imageUrl;
        }});
      }} finally {{ URL.revokeObjectURL(imageUrl); }}
      if(generation !== loadGeneration) return;
      selectedIndex=targetIndex; current=nextCurrent; image=nextImage;
      currentFrame = Object.freeze({{sessionId:targetFrame.sessionId,frameId:targetFrame.frameId,index:targetIndex}});
      activeHand=0; activePoint=0; placing=false; drag=null;
      canvas.width=image.naturalWidth; canvas.height=image.naturalHeight; draw();
      document.getElementById("counter").textContent=`Frame ${{selectedIndex+1}} / ${{listing.length}}`;
      document.getElementById("negative").checked=current.negative; renderCategories(); renderListing(); updateControls(); setStatus("Ready");
    }} catch(error) {{
      if(error.name !== "AbortError" && generation === loadGeneration) setStatus(error.message,true);
    }} finally {{
      if(loadAbortController === controller) loadAbortController=null;
    }}
  }}
  function renderCategories() {{
    const parent=document.getElementById("categories"), supported=["drawing","edge","pinch","two_hand"];
    parent.replaceChildren(...supported.map(name=>{{ const label=document.createElement("label"), input=document.createElement("input"); input.type="checkbox"; input.value=name; input.checked=current.categories.includes(name); input.disabled=current.negative; label.append(input,document.createTextNode(name.replace("_"," "))); return label; }}));
  }}
  function updateControls() {{
    const hand=current && current.hands[activeHand], points=hand?hand.keypoints:[]; activePoint=placing?points.length:Math.min(activePoint,Math.max(0,points.length-1));
    const pointLabel=pointNames[Math.min(activePoint,20)];
    document.getElementById("pointName").textContent=`${{pointLabel}} · ${{points.length}} / 21 · hand ${{activeHand+1}}`;
    document.getElementById("visibility").value=points[activePoint]?.visibility ?? 2;
    document.getElementById("addHand").disabled=!current||current.negative||current.hands.length>=2;
    document.getElementById("removeHand").disabled=!current||current.negative||!current.hands.length;
  }}
  function draw() {{
    if (!image) return; context.clearRect(0,0,canvas.width,canvas.height); context.drawImage(image,0,0);
    current.hands.forEach((hand,handIndex)=>{{
      context.strokeStyle=handIndex===0?"#55f2db":"#ffb45c"; context.fillStyle=context.strokeStyle; context.lineWidth=Math.max(2,canvas.width/500);
      bones.forEach(([a,b])=>{{ const p=hand.keypoints[a],q=hand.keypoints[b]; if(!p||!q||p.visibility===0||q.visibility===0)return; context.beginPath();context.moveTo(p.x*canvas.width,p.y*canvas.height);context.lineTo(q.x*canvas.width,q.y*canvas.height);context.stroke(); }});
      hand.keypoints.forEach((point,index)=>{{ context.save();context.globalAlpha=point.visibility===0?.3:1;context.beginPath();context.arc(point.x*canvas.width,point.y*canvas.height,index===activePoint&&handIndex===activeHand?8:5,0,Math.PI*2);context.fill();context.strokeStyle="#10131f";context.stroke();context.restore(); }});
    }});
  }}
  function coordinates(event) {{ const rect=canvas.getBoundingClientRect(); return {{x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))}}; }}
  function nearest(point) {{ let best=null,distance=Infinity; current.hands.forEach((hand,h)=>hand.keypoints.forEach((p,k)=>{{ const d=Math.hypot(p.x-point.x,p.y-point.y); if(d<distance){{distance=d;best={{h,k}};}} }})); return distance<0.04?best:null; }}
  canvas.addEventListener("pointerdown",event=>{{ if(!current||current.negative)return; canvas.setPointerCapture(event.pointerId); const point=coordinates(event); if(placing){{ current.hands[activeHand].keypoints.push({{...point,visibility:2}}); activePoint=current.hands[activeHand].keypoints.length; if(current.hands[activeHand].keypoints.length===21){{placing=false;activePoint=20;}} }} else {{ drag=nearest(point); if(drag){{activeHand=drag.h;activePoint=drag.k;}} }} updateControls();draw(); }});
  canvas.addEventListener("pointermove",event=>{{ if(!drag||!canvas.hasPointerCapture(event.pointerId))return; Object.assign(current.hands[drag.h].keypoints[drag.k],coordinates(event));draw(); }});
  canvas.addEventListener("pointerup",event=>{{ drag=null; if(canvas.hasPointerCapture(event.pointerId))canvas.releasePointerCapture(event.pointerId); }});
  document.getElementById("addHand").onclick=()=>{{current.hands.push({{keypoints:[]}});activeHand=current.hands.length-1;activePoint=0;placing=true;updateControls();draw();setStatus("Click the 21 named points in order.");}};
  document.getElementById("removeHand").onclick=()=>{{current.hands.splice(activeHand,1);activeHand=Math.max(0,activeHand-1);placing=false;updateControls();draw();}};
  document.getElementById("undoPoint").onclick=()=>{{if(!placing)return;current.hands[activeHand].keypoints.pop();activePoint=Math.max(0,current.hands[activeHand].keypoints.length-1);updateControls();draw();}};
  document.getElementById("negative").onchange=event=>{{current.negative=event.target.checked;if(current.negative){{current.hands=[];placing=false;current.categories=["negative"];}}else{{current.categories=["drawing"];}}renderCategories();updateControls();draw();}};
  document.getElementById("visibility").onchange=event=>{{const point=current.hands[activeHand]?.keypoints[activePoint];if(point){{point.visibility=Number(event.target.value);draw();}}}};
  document.getElementById("previous").onclick=()=>loadFrame(selectedIndex-1); document.getElementById("next").onclick=()=>loadFrame(selectedIndex+1);
  document.getElementById("save").onclick=async()=>{{try{{const saveFrame=currentFrame,saveCurrent=current;if(!saveFrame||!saveCurrent)throw new Error("Wait for the current frame to finish loading");const categories=saveCurrent.negative?["negative"]:[...document.querySelectorAll("#categories input:checked")].map(input=>input.value);const receipt=await request(framePath(saveFrame),{{method:"POST",body:JSON.stringify({{expectedManifestSha256:saveCurrent.manifestSha256,expectedLabelSha256:saveCurrent.labelSha256,negative:saveCurrent.negative,categories,hands:saveCurrent.hands.map(hand=>({{keypoints:hand.keypoints}}))}})}});setStatus(`Saved as ${{editorId}} · ${{receipt.receiptSha256.slice(0,12)}}`);await loadListing(true);}}catch(error){{setStatus(error.message,true);}}}};
  document.getElementById("finalize").onclick=async()=>{{try{{const receipt=await request("/api/finalize",{{method:"POST",body:JSON.stringify({{}})}});setStatus(`Dataset validated · ${{receipt.receiptSha256.slice(0,12)}}`);}}catch(error){{setStatus(error.message,true);}}}};
  loadListing().catch(error=>setStatus(error.message,true));
}})();
</script>
</body>
</html>"""


def _dataset_listing(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    group_splits = {
        group: split
        for split, groups in manifest.get("splits", {}).items()
        if isinstance(groups, list)
        for group in groups
    }
    listing: list[dict[str, Any]] = []
    for session in manifest.get("sessions", []):
        if not isinstance(session, dict):
            continue
        for frame in session.get("frames", []):
            if not isinstance(frame, dict):
                continue
            listing.append(
                {
                    "sessionId": session.get("sessionId"),
                    "frameId": frame.get("frameId"),
                    "timestampMs": frame.get("timestampMs"),
                    "split": group_splits.get(session.get("captureGroupId"), "unknown"),
                    "categories": frame.get("categories"),
                    "reviewed": frame.get("reviewed", True),
                }
            )
    return listing


def create_workbench_server(
    *,
    dataset_root: Path,
    manifest_path: Path,
    host: str = "127.0.0.1",
    port: int = 8765,
    editor_id: str = "owner-daniel",
) -> HTTPServer:
    """Create a loopback-only server without starting a background thread."""

    validate_loopback_host(host)
    if isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65535:
        raise AnnotationWorkbenchError("port must be an integer between 0 and 65535")
    root, manifest_file = _resolve_dataset_paths(dataset_root, manifest_path)
    validate_private_workspace(root, Path(__file__).resolve().parents[4])
    validate_annotation_manifest(root, manifest_file)
    editor = _validate_editor_id(editor_id)
    token = secrets.token_urlsafe(32)
    page = render_workbench_html(token, editor).encode("utf-8")

    class Handler(BaseHTTPRequestHandler):
        server_version = "CommandCanvasAnnotation/1.0"

        def log_message(self, format: str, *args: object) -> None:
            return

        def _headers(self, status: HTTPStatus, content_type: str, length: int) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self'; style-src 'unsafe-inline'; "
                "script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'",
            )
            self.end_headers()

        def _json(self, status: HTTPStatus, value: Any) -> None:
            contents = canonical_json_bytes(value)
            self._headers(status, "application/json; charset=utf-8", len(contents))
            self.wfile.write(contents)

        def _authorized(self) -> bool:
            if self.headers.get("X-CommandCanvas-Workbench-Token") != token:
                self._json(
                    HTTPStatus.FORBIDDEN,
                    {"error": "invalid local workbench token"},
                )
                return False
            origin = self.headers.get("Origin")
            if origin:
                parsed = urlparse(origin)
                try:
                    validate_loopback_host(parsed.hostname or "")
                except AnnotationWorkbenchError:
                    self._json(
                        HTTPStatus.FORBIDDEN,
                        {"error": "cross-origin request refused"},
                    )
                    return False
            return True

        def _trusted_request_host(self) -> bool:
            try:
                validate_request_host(self.headers.get("Host", ""))
            except AnnotationWorkbenchError as error:
                self._json(HTTPStatus.FORBIDDEN, {"error": str(error)})
                return False
            return True

        def _route_frame(self, prefix: str) -> tuple[str, str] | None:
            path = urlparse(self.path).path
            if not path.startswith(prefix):
                return None
            parts = [unquote(part) for part in path[len(prefix) :].split("/") if part]
            if len(parts) != 2:
                return None
            return parts[0], parts[1]

        def _body(self) -> dict[str, Any]:
            raw_length = self.headers.get("Content-Length")
            if raw_length is None:
                raise AnnotationWorkbenchError("Content-Length is required")
            try:
                length = int(raw_length)
            except ValueError as error:
                raise AnnotationWorkbenchError(
                    "Content-Length must be an integer"
                ) from error
            if not 0 < length <= MAX_REQUEST_BYTES:
                raise AnnotationWorkbenchError(
                    "request body is outside the allowed size"
                )
            try:
                value = json.loads(
                    self.rfile.read(length), object_pairs_hook=_strict_object
                )
            except json.JSONDecodeError as error:
                raise AnnotationWorkbenchError(
                    "request body must be strict JSON"
                ) from error
            if not isinstance(value, dict):
                raise AnnotationWorkbenchError("request body must be an object")
            return value

        def do_GET(self) -> None:
            try:
                if not self._trusted_request_host():
                    return
                path = urlparse(self.path).path
                if path == "/":
                    self._headers(HTTPStatus.OK, "text/html; charset=utf-8", len(page))
                    self.wfile.write(page)
                    return
                if not self._authorized():
                    return
                if path == "/api/state":
                    manifest = _load_json_object(manifest_file)
                    validation = validate_annotation_manifest(root, manifest_file)
                    self._json(
                        HTTPStatus.OK,
                        {
                            "datasetId": manifest.get("datasetId"),
                            "manifestSha256": sha256_file(manifest_file),
                            "frames": _dataset_listing(manifest),
                            "manifestKind": validation["kind"],
                            "reviewedFrameCount": validation["reviewedFrameCount"],
                            "frameCount": validation["frameCount"],
                        },
                    )
                    return
                frame_route = self._route_frame("/api/frame/")
                if frame_route:
                    self._json(
                        HTTPStatus.OK,
                        load_frame_annotation(root, manifest_file, *frame_route),
                    )
                    return
                image_route = self._route_frame("/api/image/")
                if image_route:
                    manifest = _load_json_object(manifest_file)
                    _, frame = _find_frame(manifest, *image_route)
                    image = frame.get("image")
                    if not isinstance(image, dict):
                        raise AnnotationWorkbenchError("frame image must be an object")
                    image_path = _safe_asset(
                        root, image.get("path"), location="frame image"
                    )
                    contents = image_path.read_bytes()
                    content_type = (
                        "image/png"
                        if image_path.suffix.lower() == ".png"
                        else "image/jpeg"
                    )
                    self._headers(HTTPStatus.OK, content_type, len(contents))
                    self.wfile.write(contents)
                    return
                self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            except (
                AnnotationWorkbenchError,
                DatasetValidationError,
                OSError,
                UnicodeError,
            ) as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

        def do_POST(self) -> None:
            try:
                if not self._trusted_request_host():
                    return
                if not self._authorized():
                    return
                body = self._body()
                path = urlparse(self.path).path
                if path == "/api/finalize":
                    if body:
                        raise AnnotationWorkbenchError(
                            "finalize body has unsupported fields"
                        )
                    self._json(
                        HTTPStatus.OK,
                        finalize_annotations(
                            dataset_root=root,
                            manifest_path=manifest_file,
                            editor_id=editor,
                        ),
                    )
                    return
                frame_route = self._route_frame("/api/frame/")
                expected = {
                    "expectedManifestSha256",
                    "expectedLabelSha256",
                    "negative",
                    "categories",
                    "hands",
                }
                if frame_route is None or set(body) != expected:
                    raise AnnotationWorkbenchError(
                        "annotation body or route has unsupported fields"
                    )
                self._json(
                    HTTPStatus.OK,
                    save_frame_annotation(
                        dataset_root=root,
                        manifest_path=manifest_file,
                        session_id=frame_route[0],
                        frame_id=frame_route[1],
                        editor_id=editor,
                        expected_manifest_sha256=body["expectedManifestSha256"],
                        expected_label_sha256=body["expectedLabelSha256"],
                        negative=body["negative"],
                        categories=body["categories"],
                        hands=body["hands"],
                    ),
                )
            except AnnotationConflict as error:
                self._json(HTTPStatus.CONFLICT, {"error": str(error)})
            except (
                AnnotationWorkbenchError,
                DatasetValidationError,
                OSError,
                UnicodeError,
            ) as error:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(error)})

    if ":" in host:
        import socket

        class IPv6HTTPServer(HTTPServer):
            address_family = socket.AF_INET6

        return IPv6HTTPServer((host, port, 0, 0), Handler)
    return HTTPServer((host, port), Handler)


def run_annotation_workbench(
    *,
    dataset_root: Path,
    manifest_path: Path,
    host: str,
    port: int,
    editor_id: str,
) -> None:
    """Serve the private workbench until interrupted by the local operator."""

    server = create_workbench_server(
        dataset_root=dataset_root,
        manifest_path=manifest_path,
        host=host,
        port=port,
        editor_id=editor_id,
    )
    bound_port = int(server.server_address[1])
    displayed_host = f"[{host}]" if ":" in host else host
    print(f"CommandCanvas annotation workbench: http://{displayed_host}:{bound_port}")
    print("Private frames remain on this machine. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
