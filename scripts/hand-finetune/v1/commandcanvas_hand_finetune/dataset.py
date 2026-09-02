"""Strict manifest, media, split, and YOLO hand-pose dataset validation."""

from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import UUID

from PIL import Image, UnidentifiedImageError

from .canonical import attach_digest, canonical_json_bytes, sha256_file, verify_digest


SCHEMA_VERSION = "commandcanvas.hand-dataset/v1"
PROVENANCE_SCHEMA_VERSION = "commandcanvas.hand-dataset/v2"
HARD_SUBSETS = ("drawing", "edge", "negative", "pinch", "two_hand")
SPLITS = ("train", "validation", "holdout")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
MIN_SOURCE_DIMENSION = 64
MAX_SOURCE_DIMENSION = 8192
VISION_CAPTURE_TYPES = {
    "acquisition",
    "drawing",
    "pinch",
    "edges-corners",
    "two-hand-transforms",
    "throws",
    "difficult-conditions",
    "negative-no-hand",
}
VISION_CONSENT_VERSION = "vision-lab-consent-v1"
VISION_PROTOCOL = {"id": "commandcanvas-hand-finetune", "version": 1}


class DatasetValidationError(ValueError):
    """Raised after collecting every actionable dataset validation error."""


@dataclass(frozen=True)
class VisionCompanionFacts:
    """Validated facts preserved from one canonical Vision Lab companion."""

    capture_type: str
    width: int | None
    height: int | None
    frame_rate: float | None
    started_at: datetime
    stopped_at: datetime


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise DatasetValidationError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _load_manifest(path: Path) -> dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8")
        value = json.loads(raw, object_pairs_hook=_strict_object)
    except DatasetValidationError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise DatasetValidationError(
            f"manifest could not be read as strict JSON: {error}"
        ) from error
    if not isinstance(value, dict):
        raise DatasetValidationError("manifest must be a JSON object")
    return value


def _exact_keys(
    value: Any,
    expected: set[str],
    location: str,
    errors: list[str],
) -> bool:
    if not isinstance(value, dict):
        errors.append(f"{location} must be an object")
        return False
    missing = expected - value.keys()
    unknown = value.keys() - expected
    if missing:
        errors.append(f"{location} missing fields: {', '.join(sorted(missing))}")
    if unknown:
        errors.append(
            f"{location} has unsupported fields: {', '.join(sorted(unknown))}"
        )
    return not missing and not unknown


def _allowed_keys(
    value: Any,
    required: set[str],
    optional: set[str],
    location: str,
    errors: list[str],
) -> bool:
    if not isinstance(value, dict):
        errors.append(f"{location} must be an object")
        return False
    missing = required - value.keys()
    unknown = value.keys() - required - optional
    if missing:
        errors.append(f"{location} missing fields: {', '.join(sorted(missing))}")
    if unknown:
        errors.append(
            f"{location} has unsupported fields: {', '.join(sorted(unknown))}"
        )
    return not missing and not unknown


def _zoned_timestamp(value: Any, location: str, errors: list[str]) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        errors.append(f"{location} must be a nonempty ISO-8601 timestamp")
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        errors.append(f"{location} must be ISO-8601")
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        errors.append(f"{location} must include a timezone")
        return None
    return parsed


def validate_vision_companion(
    value: Any,
    *,
    location: str,
    errors: list[str],
    expected_session_id: str | None = None,
    actual_video_sha256: str | None = None,
) -> VisionCompanionFacts | None:
    """Validate the exact Vision Lab companion contract for every consumer."""

    initial_error_count = len(errors)
    required = {
        "schemaVersion",
        "sessionId",
        "captureType",
        "startedAt",
        "stoppedAt",
        "media",
        "mirrorDisplay",
        "consentVersion",
        "protocol",
    }
    if not _allowed_keys(value, required, {"videoSha256"}, location, errors):
        return None
    assert isinstance(value, dict)

    if isinstance(value.get("schemaVersion"), bool) or value.get("schemaVersion") != 1:
        errors.append(f"{location}.schemaVersion must be 1")

    session_id = value.get("sessionId")
    if (
        not isinstance(session_id, str)
        or not session_id.strip()
        or any(ord(character) < 32 or ord(character) == 127 for character in session_id)
    ):
        errors.append(f"{location}.sessionId must be a nonempty safe string")
    elif expected_session_id is not None and session_id != expected_session_id:
        errors.append(f"{location}.sessionId does not match the expected session")

    capture_type = value.get("captureType")
    if not isinstance(capture_type, str) or capture_type not in VISION_CAPTURE_TYPES:
        errors.append(f"{location}.captureType is unsupported")

    started_at = _zoned_timestamp(
        value.get("startedAt"), f"{location}.startedAt", errors
    )
    stopped_at = _zoned_timestamp(
        value.get("stoppedAt"), f"{location}.stoppedAt", errors
    )
    if started_at is not None and stopped_at is not None and stopped_at <= started_at:
        errors.append(f"{location}.stoppedAt must be after startedAt")

    media = value.get("media")
    width: int | None = None
    height: int | None = None
    frame_rate: float | None = None
    if _allowed_keys(
        media,
        {"mimeType"},
        {"width", "height", "frameRate", "facingMode"},
        f"{location}.media",
        errors,
    ):
        assert isinstance(media, dict)
        mime_type = media.get("mimeType")
        if (
            not isinstance(mime_type, str)
            or re.fullmatch(r"video/webm(?:;codecs=(?:vp8|vp9))?", mime_type) is None
        ):
            errors.append(f"{location}.media.mimeType must be a supported WebM type")

        width_value = media.get("width")
        if width_value is not None:
            if (
                isinstance(width_value, bool)
                or not isinstance(width_value, int)
                or width_value <= 0
            ):
                errors.append(f"{location}.media.width must be a positive integer")
            else:
                width = width_value

        height_value = media.get("height")
        if height_value is not None:
            if (
                isinstance(height_value, bool)
                or not isinstance(height_value, int)
                or height_value <= 0
            ):
                errors.append(f"{location}.media.height must be a positive integer")
            else:
                height = height_value

        frame_rate_value = media.get("frameRate")
        if frame_rate_value is not None:
            if (
                isinstance(frame_rate_value, bool)
                or not isinstance(frame_rate_value, (int, float))
                or not math.isfinite(frame_rate_value)
                or frame_rate_value <= 0
            ):
                errors.append(f"{location}.media.frameRate must be a positive number")
            else:
                frame_rate = float(frame_rate_value)

        if "facingMode" in media and (
            not isinstance(media.get("facingMode"), str)
            or not str(media.get("facingMode", "")).strip()
        ):
            errors.append(f"{location}.media.facingMode must be a nonempty string")

    if not isinstance(value.get("mirrorDisplay"), bool):
        errors.append(f"{location}.mirrorDisplay must be boolean")
    if value.get("consentVersion") != VISION_CONSENT_VERSION:
        errors.append(f"{location}.consentVersion is not approved")

    protocol = value.get("protocol")
    if _exact_keys(protocol, {"id", "version"}, f"{location}.protocol", errors):
        assert isinstance(protocol, dict)
        if protocol.get("id") != VISION_PROTOCOL["id"] or (
            isinstance(protocol.get("version"), bool)
            or protocol.get("version") != VISION_PROTOCOL["version"]
        ):
            errors.append(f"{location}.protocol does not match Vision Lab")

    declared_sha = value.get("videoSha256")
    if declared_sha is not None:
        if not isinstance(declared_sha, str) or not SHA256_PATTERN.fullmatch(
            declared_sha
        ):
            errors.append(f"{location} video SHA-256 must be a lowercase digest")
        elif actual_video_sha256 is not None and declared_sha != actual_video_sha256:
            errors.append(f"{location} video SHA-256 does not match the raw WebM")

    if (
        len(errors) != initial_error_count
        or not isinstance(capture_type, str)
        or started_at is None
        or stopped_at is None
    ):
        return None
    return VisionCompanionFacts(
        capture_type=capture_type,
        width=width,
        height=height,
        frame_rate=frame_rate,
        started_at=started_at,
        stopped_at=stopped_at,
    )


def _canonical_uuid(value: Any, location: str, errors: list[str]) -> str | None:
    if not isinstance(value, str):
        errors.append(f"{location} must be a canonical UUID")
        return None
    try:
        parsed = UUID(value)
    except ValueError:
        errors.append(f"{location} must be a canonical UUID")
        return None
    if value != str(parsed):
        errors.append(f"{location} must be a lowercase canonical UUID")
        return None
    return value


def _safe_file(
    root: Path, relative: Any, location: str, errors: list[str]
) -> Path | None:
    if not isinstance(relative, str):
        errors.append(f"{location} must be a safe relative path")
        return None
    if any(ord(character) < 32 or ord(character) == 127 for character in relative):
        errors.append(f"{location} must not contain control characters")
        return None
    pure = PurePosixPath(relative)
    if pure.as_posix() != relative:
        errors.append(f"{location} must be a canonical POSIX path")
        return None
    if (
        not relative
        or "\\" in relative
        or any(ord(character) < 32 or ord(character) == 127 for character in relative)
        or pure.is_absolute()
        or any(part in {"", ".", ".."} for part in pure.parts)
    ):
        errors.append(f"{location} must be a safe relative path")
        return None
    candidate = root.joinpath(*pure.parts)
    try:
        resolved_root = root.resolve(strict=True)
        resolved = candidate.resolve(strict=True)
    except OSError:
        errors.append(f"{location} does not resolve to an existing regular file")
        return None
    if (
        candidate.is_symlink()
        or not resolved.is_file()
        or resolved_root not in resolved.parents
    ):
        errors.append(
            f"{location} must resolve to a regular file inside the dataset root"
        )
        return None
    return resolved


def _validate_asset(
    root: Path,
    value: Any,
    location: str,
    errors: list[str],
    *,
    image: bool,
) -> tuple[Path | None, str | None]:
    expected = {"path", "byteSize", "sha256"}
    if image:
        expected |= {"width", "height"}
    if not _exact_keys(value, expected, location, errors):
        return None, None
    path = _safe_file(root, value.get("path"), f"{location}.path", errors)
    declared_sha = value.get("sha256")
    if not isinstance(declared_sha, str) or not SHA256_PATTERN.fullmatch(declared_sha):
        errors.append(f"{location}.sha256 must be a lowercase SHA-256 digest")
    if path is None:
        return None, declared_sha if isinstance(declared_sha, str) else None
    actual_size = path.stat().st_size
    if isinstance(value.get("byteSize"), bool) or not isinstance(
        value.get("byteSize"), int
    ):
        errors.append(f"{location}.byteSize must be an integer")
    elif value["byteSize"] != actual_size:
        errors.append(f"{location} byteSize does not match file bytes")
    actual_sha = sha256_file(path)
    if declared_sha != actual_sha:
        errors.append(f"{location} SHA-256 does not match file bytes")
    if image:
        try:
            with Image.open(path) as decoded:
                decoded.verify()
            with Image.open(path) as decoded:
                actual_dimensions = decoded.size
        except (OSError, UnidentifiedImageError) as error:
            errors.append(f"{location} is not a decodable image: {error}")
        else:
            declared_dimensions = (value.get("width"), value.get("height"))
            if declared_dimensions != actual_dimensions:
                errors.append(
                    f"{location} dimensions {declared_dimensions!r} do not match {actual_dimensions!r}"
                )
    return path, actual_sha


def _canonical_json_asset(
    root: Path,
    value: Any,
    location: str,
    errors: list[str],
) -> tuple[dict[str, Any] | None, Path | None]:
    path, _digest = _validate_asset(root, value, location, errors, image=False)
    if path is None:
        return None, None
    try:
        parsed = _load_manifest(path)
    except DatasetValidationError as error:
        errors.append(f"{location} is not strict JSON: {error}")
        return None, path
    if path.read_bytes() != canonical_json_bytes(parsed):
        errors.append(f"{location} bytes must use canonical JSON")
    return parsed, path


def _validate_annotation_review(
    root: Path,
    value: Any,
    *,
    session_map: dict[str, Any] | None,
    session_map_sha256: str | None,
    errors: list[str],
) -> dict[str, dict[str, Any]]:
    """Validate the complete manual-edit chain archived with a v2 dataset."""

    if not _exact_keys(
        value,
        {"draftManifest", "finalizationReceipt", "editReceipts"},
        "producerChain.annotationReview",
        errors,
    ):
        return {}
    assert isinstance(value, dict)
    draft, _ = _canonical_json_asset(
        root,
        value.get("draftManifest"),
        "producerChain.annotationReview.draftManifest",
        errors,
    )
    finalization, _ = _canonical_json_asset(
        root,
        value.get("finalizationReceipt"),
        "producerChain.annotationReview.finalizationReceipt",
        errors,
    )
    draft_asset = value.get("draftManifest")
    draft_sha = draft_asset.get("sha256") if isinstance(draft_asset, dict) else None
    edit_assets = value.get("editReceipts")
    edits: list[dict[str, Any]] = []
    edit_asset_digests: list[str | None] = []
    if not isinstance(edit_assets, list) or not edit_assets:
        errors.append(
            "producerChain.annotationReview.editReceipts must be a nonempty array"
        )
    else:
        for index, asset in enumerate(edit_assets):
            edit, _ = _canonical_json_asset(
                root,
                asset,
                f"producerChain.annotationReview.editReceipts[{index}]",
                errors,
            )
            if edit is not None:
                edits.append(edit)
            edit_asset_digests.append(
                edit.get("receiptSha256") if isinstance(edit, dict) else None
            )
    if draft is None or finalization is None:
        return {}
    expected_finalization = {
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
        "draftManifestSha256",
        "sourceAdapter",
        "visionSessionIds",
        "bridgeHandoff",
        "receiptSha256",
    }
    if not _exact_keys(
        finalization,
        expected_finalization,
        "annotation finalization receipt",
        errors,
    ):
        return {}
    if (
        finalization.get("schemaVersion")
        != "commandcanvas.hand-annotation-finalization/v1"
        or not verify_digest(finalization, "receiptSha256")
        or finalization.get("eligibleForTraining") is not True
        or finalization.get("productionEligible") is not False
    ):
        errors.append("annotation finalization receipt is invalid")
    if draft.get("schemaVersion") != "commandcanvas.hand-annotation-draft/v1":
        errors.append("annotation draft schemaVersion is invalid")
    if session_map is not None and (
        finalization.get("datasetId") != session_map.get("datasetId")
        or draft.get("datasetId") != session_map.get("datasetId")
    ):
        errors.append("annotation review dataset identity does not match session map")
    if finalization.get("draftManifestSha256") != draft_sha:
        errors.append("annotation finalization does not bind the archived draft")
    source_adapter = finalization.get("sourceAdapter")
    if not _exact_keys(
        source_adapter,
        {"name", "version", "sourceManifestSha256", "actorId"},
        "annotation source adapter",
        errors,
    ):
        source_adapter = {}
    assert isinstance(source_adapter, dict)
    if source_adapter.get("sourceManifestSha256") != session_map_sha256:
        errors.append("annotation source adapter does not bind the session map")
    if session_map is not None and source_adapter.get("actorId") != session_map.get(
        "actorId"
    ):
        errors.append("annotation source actor does not match the session-map actor")
    if finalization.get("editorId") != source_adapter.get("actorId"):
        errors.append("annotation finalization editor does not match source actor")
    if draft.get("sourceAdapter") != source_adapter:
        errors.append("annotation draft source adapter does not match finalization")

    expected_edit_digests = finalization.get("editReceiptSha256s")
    expected_edit_ids = finalization.get("editIds")
    if (
        not isinstance(expected_edit_digests, list)
        or len(expected_edit_digests) != len(edits)
        or expected_edit_digests != edit_asset_digests
    ):
        errors.append("archived annotation edit assets do not match the edit chain")
    if not isinstance(expected_edit_ids, list) or len(expected_edit_ids) != len(edits):
        errors.append("annotation edit IDs do not match the edit chain")
    prior_result: str | None = None
    reviewed_frames: set[tuple[str, str]] = set()
    last_label_digests: dict[tuple[str, str], str] = {}
    expected_edit_fields = {
        "schemaVersion",
        "editId",
        "editedAt",
        "editorId",
        "sessionId",
        "frameId",
        "negative",
        "handCount",
        "previousCategories",
        "resultCategories",
        "previousFrameReviewed",
        "resultFrameReviewed",
        "previousAnnotation",
        "resultAnnotation",
        "sourceManifestSha256",
        "resultManifestSha256",
        "sourceLabelSha256",
        "resultLabelSha256",
        "receiptPath",
        "productionEligible",
        "receiptSha256",
    }
    for index, edit in enumerate(edits):
        _exact_keys(
            edit, expected_edit_fields, f"annotation edit receipt {index}", errors
        )
        if (
            edit.get("schemaVersion") != "commandcanvas.hand-annotation-edit/v1"
            or not verify_digest(edit, "receiptSha256")
            or edit.get("productionEligible") is not False
        ):
            errors.append(f"annotation edit receipt {index} is invalid")
            continue
        if edit.get("editorId") != source_adapter.get("actorId"):
            errors.append(f"annotation edit receipt {index} actor does not match")
        if isinstance(expected_edit_ids, list) and index < len(expected_edit_ids):
            if edit.get("editId") != expected_edit_ids[index]:
                errors.append(f"annotation edit receipt {index} ID does not match")
        if (
            prior_result is not None
            and edit.get("sourceManifestSha256") != prior_result
        ):
            errors.append("annotation edit receipts do not form one manifest chain")
        result_digest = edit.get("resultManifestSha256")
        prior_result = result_digest if isinstance(result_digest, str) else None
        session_id = edit.get("sessionId")
        frame_id = edit.get("frameId")
        if not isinstance(session_id, str) or not isinstance(frame_id, str):
            errors.append(f"annotation edit receipt {index} frame identity is invalid")
        else:
            reviewed_frames.add((session_id, frame_id))
            result_label_sha = edit.get("resultLabelSha256")
            if not isinstance(result_label_sha, str) or not SHA256_PATTERN.fullmatch(
                result_label_sha
            ):
                errors.append(
                    f"annotation edit receipt {index} label digest is invalid"
                )
            else:
                last_label_digests[(session_id, frame_id)] = result_label_sha
    if edits and prior_result != draft_sha:
        errors.append("annotation edit chain does not terminate at the archived draft")

    handoff = finalization.get("bridgeHandoff")
    if not _exact_keys(
        handoff,
        {
            "schemaVersion",
            "datasetId",
            "sourceAdapter",
            "sessions",
            "productionEligible",
        },
        "annotation bridge handoff",
        errors,
    ):
        return {}
    assert isinstance(handoff, dict)
    if (
        handoff.get("schemaVersion") != "commandcanvas.hand-annotation-handoff/v1"
        or handoff.get("sourceAdapter") != source_adapter
        or handoff.get("productionEligible") is not False
    ):
        errors.append("annotation bridge handoff is invalid")
    if handoff.get("datasetId") != finalization.get("datasetId"):
        errors.append("annotation bridge handoff dataset identity does not match")
    handoff_sessions = handoff.get("sessions")
    if not isinstance(handoff_sessions, list):
        errors.append("annotation bridge handoff sessions must be an array")
        return {}
    result: dict[str, dict[str, Any]] = {}
    expected_reviewed_frames: set[tuple[str, str]] = set()
    handoff_vision_ids: list[str] = []
    for index, session in enumerate(handoff_sessions):
        if not _exact_keys(
            session,
            {
                "visionSessionId",
                "datasetSessionId",
                "actorId",
                "captureGroupId",
                "split",
                "captureCategories",
                "sourceVideo",
                "labelDirectory",
                "labels",
                "annotation",
            },
            f"annotation bridge handoff sessions[{index}]",
            errors,
        ):
            continue
        assert isinstance(session, dict)
        session_id = session.get("datasetSessionId")
        if not isinstance(session_id, str) or session_id in result:
            errors.append(
                "annotation handoff dataset session identities must be unique"
            )
            continue
        if session.get("actorId") != source_adapter.get("actorId"):
            errors.append("annotation handoff actor does not match source actor")
        vision_session_id = session.get("visionSessionId")
        if not isinstance(vision_session_id, str):
            errors.append("annotation handoff vision session identity is invalid")
        else:
            handoff_vision_ids.append(vision_session_id)
        labels = session.get("labels")
        if not isinstance(labels, list):
            errors.append("annotation handoff labels must be an array")
        else:
            frame_ids: set[str] = set()
            for label in labels:
                frame_id = label.get("frameId") if isinstance(label, dict) else None
                _exact_keys(
                    label,
                    {"frameId", "timestampMs", "path", "byteSize", "sha256"},
                    "annotation handoff label",
                    errors,
                )
                if not isinstance(frame_id, str) or frame_id in frame_ids:
                    errors.append("annotation handoff label identities must be unique")
                else:
                    frame_ids.add(frame_id)
                    expected_reviewed_frames.add((session_id, frame_id))
                    if label.get("sha256") != last_label_digests.get(
                        (session_id, frame_id)
                    ):
                        errors.append(
                            "annotation handoff label digest does not match final edit"
                        )
        result[session_id] = session
    if (
        len(handoff_vision_ids) != len(set(handoff_vision_ids))
        or finalization.get("visionSessionIds") != handoff_vision_ids
    ):
        errors.append("annotation finalization vision session identities do not match")
    if reviewed_frames != expected_reviewed_frames:
        errors.append("annotation edit receipts do not exactly cover handoff labels")
    return result


def _validate_label_rows(
    path: Path | None,
    *,
    categories: list[str],
    location: str,
    errors: list[str],
) -> None:
    if path is None:
        return
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        errors.append(f"{location} label must be UTF-8 text: {error}")
        return
    rows = [row for row in content.splitlines() if row.strip()]
    negative = categories == ["negative"]
    if negative:
        if rows:
            errors.append(f"{location} negative frame label must be empty")
        return
    if not rows:
        errors.append(f"{location} positive frame label must contain one or two hands")
        return
    if len(rows) > 2:
        errors.append(f"{location} label may contain at most two hands")
    for row_index, row in enumerate(rows):
        tokens = row.split()
        row_location = f"{location} label row {row_index + 1}"
        if len(tokens) != 68:
            errors.append(f"{row_location} must contain exactly 68 tokens")
        if tokens and tokens[0] != "0":
            errors.append(f"{row_location} must use class 0")
        for token_index, token in enumerate(tokens[1:], start=1):
            try:
                number = float(token)
            except ValueError:
                errors.append(f"{row_location} token {token_index + 1} must be numeric")
                continue
            if not math.isfinite(number):
                errors.append(f"{row_location} token {token_index + 1} must be finite")
                continue
            is_visibility = token_index >= 7 and (token_index - 7) % 3 == 0
            if is_visibility:
                if number not in {0.0, 1.0, 2.0}:
                    errors.append(
                        f"{row_location} visibility must be categorical 0, 1, or 2"
                    )
            elif not 0.0 <= number <= 1.0:
                errors.append(f"{row_location} coordinate must be normalized to [0, 1]")
        if len(tokens) >= 5:
            try:
                width, height = float(tokens[3]), float(tokens[4])
            except ValueError:
                pass
            else:
                if (
                    math.isfinite(width)
                    and math.isfinite(height)
                    and (width <= 0 or height <= 0)
                ):
                    errors.append(
                        f"{row_location} bounding-box width and height must be positive"
                    )


def validate_dataset(dataset_root: Path, manifest_path: Path) -> dict[str, Any]:
    """Validate a complete private dataset and return a deterministic receipt."""

    root = Path(dataset_root)
    manifest_path = Path(manifest_path)
    errors: list[str] = []
    if not root.exists() or root.is_symlink() or not root.is_dir():
        raise DatasetValidationError(
            "dataset root must be an existing non-symlink directory"
        )
    try:
        resolved_root = root.resolve(strict=True)
        resolved_manifest = manifest_path.resolve(strict=True)
    except OSError as error:
        raise DatasetValidationError(
            f"dataset root and manifest must exist: {error}"
        ) from error
    if (
        resolved_manifest.is_symlink()
        or not resolved_manifest.is_file()
        or resolved_root not in resolved_manifest.parents
    ):
        raise DatasetValidationError(
            "manifest must be a regular file inside the dataset root"
        )
    manifest = _load_manifest(resolved_manifest)
    schema_version = manifest.get("schemaVersion")
    provenance_enabled = schema_version == PROVENANCE_SCHEMA_VERSION
    manifest_keys = {
        "schemaVersion",
        "datasetId",
        "createdAt",
        "consent",
        "keypointOrder",
        "classNames",
        "splits",
        "sessions",
    }
    if provenance_enabled:
        manifest_keys.add("producerChain")
    _exact_keys(
        manifest,
        manifest_keys,
        "manifest",
        errors,
    )
    if schema_version not in {SCHEMA_VERSION, PROVENANCE_SCHEMA_VERSION}:
        errors.append(
            f"schemaVersion must be {SCHEMA_VERSION} or {PROVENANCE_SCHEMA_VERSION}"
        )
    dataset_id = _canonical_uuid(manifest.get("datasetId"), "datasetId", errors)
    if manifest.get("keypointOrder") != "mediapipe-hand-21":
        errors.append("keypointOrder must be mediapipe-hand-21")
    if manifest.get("classNames") != ["hand"]:
        errors.append('classNames must be exactly ["hand"]')
    consent = manifest.get("consent")
    if _exact_keys(consent, {"approved", "version"}, "consent", errors):
        assert isinstance(consent, dict)
        if consent.get("approved") is not True:
            errors.append("consent.approved must be true")
        if consent.get("version") != "commandcanvas-owner-training/v1":
            errors.append("consent.version must be commandcanvas-owner-training/v1")

    producer_mappings: dict[str, dict[str, Any]] = {}
    producer_session_map: dict[str, Any] | None = None
    annotation_review_mappings: dict[str, dict[str, Any]] = {}
    producer_chain: dict[str, Any] | None = None
    if provenance_enabled:
        producer_chain_value = manifest.get("producerChain")
        if _allowed_keys(
            producer_chain_value,
            {"consentVersion", "protocol", "sessionMap"},
            {"annotationReview"},
            "producerChain",
            errors,
        ):
            producer_chain = producer_chain_value
        if producer_chain is not None:
            assert isinstance(producer_chain, dict)
            if producer_chain.get("consentVersion") != "vision-lab-consent-v1":
                errors.append(
                    "producerChain.consentVersion must be vision-lab-consent-v1"
                )
            protocol = producer_chain.get("protocol")
            if _exact_keys(
                protocol, {"id", "version"}, "producerChain.protocol", errors
            ):
                assert isinstance(protocol, dict)
                if protocol.get("id") != "commandcanvas-hand-finetune" or (
                    isinstance(protocol.get("version"), bool)
                    or protocol.get("version") != 1
                ):
                    errors.append("producerChain.protocol does not match Vision Lab")
            producer_session_map, _ = _canonical_json_asset(
                resolved_root,
                producer_chain.get("sessionMap"),
                "producerChain.sessionMap",
                errors,
            )
        if producer_session_map is not None:
            if _exact_keys(
                producer_session_map,
                {
                    "schemaVersion",
                    "datasetId",
                    "createdAt",
                    "actorId",
                    "cadenceMs",
                    "sessions",
                },
                "producer session map",
                errors,
            ):
                if (
                    producer_session_map.get("schemaVersion")
                    != "commandcanvas.hand-session-map/v1"
                ):
                    errors.append("producer session map schemaVersion is invalid")
                if producer_session_map.get("datasetId") != dataset_id:
                    errors.append(
                        "producer session map datasetId does not match manifest"
                    )
                if producer_session_map.get("createdAt") != manifest.get("createdAt"):
                    errors.append(
                        "producer session map createdAt does not match manifest"
                    )
                mapped_sessions = producer_session_map.get("sessions")
                if not isinstance(mapped_sessions, list):
                    errors.append("producer session map sessions must be an array")
                else:
                    for index, mapped in enumerate(mapped_sessions):
                        location = f"producer session map sessions[{index}]"
                        if not _exact_keys(
                            mapped,
                            {
                                "visionSessionId",
                                "datasetSessionId",
                                "captureGroupId",
                                "split",
                                "categories",
                                "videoPath",
                                "manifestPath",
                                "labelDir",
                                "annotation",
                            },
                            location,
                            errors,
                        ):
                            continue
                        assert isinstance(mapped, dict)
                        for path_field in ("videoPath", "manifestPath", "labelDir"):
                            declared_path = mapped.get(path_field)
                            pure = (
                                PurePosixPath(declared_path)
                                if isinstance(declared_path, str)
                                else None
                            )
                            if (
                                not isinstance(declared_path, str)
                                or not declared_path
                                or "\\" in declared_path
                                or any(
                                    ord(character) < 32 or ord(character) == 127
                                    for character in declared_path
                                )
                                or pure is None
                                or pure.is_absolute()
                                or any(part in {"", ".", ".."} for part in pure.parts)
                            ):
                                errors.append(
                                    f"{location}.{path_field} must be a safe relative path"
                                )
                        mapped_id = mapped.get("datasetSessionId")
                        if not isinstance(mapped_id, str):
                            errors.append(
                                f"{location}.datasetSessionId must be a string"
                            )
                        elif mapped_id in producer_mappings:
                            errors.append(
                                f"duplicate producer datasetSessionId: {mapped_id}"
                            )
                        else:
                            producer_mappings[mapped_id] = mapped
        if producer_chain is not None and "annotationReview" in producer_chain:
            session_map_asset = producer_chain.get("sessionMap")
            session_map_sha = (
                session_map_asset.get("sha256")
                if isinstance(session_map_asset, dict)
                else None
            )
            annotation_review_mappings = _validate_annotation_review(
                resolved_root,
                producer_chain.get("annotationReview"),
                session_map=producer_session_map,
                session_map_sha256=session_map_sha,
                errors=errors,
            )

    splits = manifest.get("splits")
    if not _exact_keys(splits, set(SPLITS), "splits", errors):
        splits = {}
    split_for_group: dict[str, str] = {}
    splits_for_group: dict[str, set[str]] = defaultdict(set)
    for split in SPLITS:
        groups = splits.get(split, []) if isinstance(splits, dict) else []
        if not isinstance(groups, list) or not groups:
            errors.append(f"splits.{split} must contain at least one captureGroupId")
            continue
        for index, group in enumerate(groups):
            canonical = _canonical_uuid(group, f"splits.{split}[{index}]", errors)
            if canonical is None:
                continue
            splits_for_group[canonical].add(split)
            if canonical in split_for_group:
                errors.append(
                    f"captureGroupId {canonical} leaks across {split_for_group[canonical]} and {split}"
                )
            else:
                split_for_group[canonical] = split

    sessions = manifest.get("sessions")
    if not isinstance(sessions, list):
        errors.append("sessions must be an array")
        sessions = []
    if len(sessions) < 3:
        errors.append("dataset must contain at least three sessions")

    session_ids: set[str] = set()
    capture_groups_seen: set[str] = set()
    source_digest_splits: dict[str, set[str]] = defaultdict(set)
    image_digest_splits: dict[str, set[str]] = defaultdict(set)
    source_digests: list[str] = []
    source_paths: set[str] = set()
    label_paths: set[str] = set()
    producer_vision_session_ids: set[str] = set()
    split_counts: Counter[str] = Counter()
    capture_groups_by_split: dict[str, set[str]] = {split: set() for split in SPLITS}
    hard_subset_counts: Counter[str] = Counter()
    annotation_counts: Counter[str] = Counter()
    total_frames = 0
    for session_index, session in enumerate(sessions):
        location = f"sessions[{session_index}]"
        session_keys = {
            "sessionId",
            "captureGroupId",
            "actorId",
            "captureCategories",
            "source",
            "annotation",
            "frames",
        }
        if provenance_enabled:
            session_keys.add("producer")
        if not _exact_keys(
            session,
            session_keys,
            location,
            errors,
        ):
            continue
        session_id = _canonical_uuid(
            session.get("sessionId"), f"{location}.sessionId", errors
        )
        capture_group = _canonical_uuid(
            session.get("captureGroupId"), f"{location}.captureGroupId", errors
        )
        if session_id is not None:
            if session_id in session_ids:
                errors.append(f"duplicate sessionId: {session_id}")
            session_ids.add(session_id)
        if capture_group is not None:
            capture_groups_seen.add(capture_group)
        session_split = split_for_group.get(capture_group or "")
        session_splits = splits_for_group.get(capture_group or "", set())
        if session_split is None:
            errors.append(
                f"{location}.captureGroupId is not assigned to exactly one split"
            )
        review_enabled = (
            producer_chain is not None and "annotationReview" in producer_chain
        )
        review_session = annotation_review_mappings.get(session_id or "")
        if review_enabled and review_session is None:
            errors.append(f"{location} has no annotation-review binding")

        source = session.get("source")
        actual_source_sha: str | None = None
        if _exact_keys(
            source,
            {
                "kind",
                "overlayDerived",
                "path",
                "byteSize",
                "sha256",
                "width",
                "height",
                "mimeType",
            },
            f"{location}.source",
            errors,
        ):
            if source.get("kind") != "raw_camera":
                errors.append(f"{location}.source.kind must be raw_camera")
            if source.get("overlayDerived") is not False:
                errors.append(f"{location}.source.overlayDerived must be false")
            if source.get("mimeType") != "video/webm":
                errors.append(f"{location}.source.mimeType must be video/webm")
            width = source.get("width")
            height = source.get("height")
            if (
                isinstance(width, bool)
                or not isinstance(width, int)
                or isinstance(height, bool)
                or not isinstance(height, int)
                or not MIN_SOURCE_DIMENSION <= width <= MAX_SOURCE_DIMENSION
                or not MIN_SOURCE_DIMENSION <= height <= MAX_SOURCE_DIMENSION
            ):
                errors.append(
                    f"{location}.source dimensions must be integer camera dimensions "
                    f"between {MIN_SOURCE_DIMENSION} and {MAX_SOURCE_DIMENSION} pixels"
                )
            source_asset = {key: source[key] for key in ("path", "byteSize", "sha256")}
            source_path_value = source.get("path")
            if isinstance(source_path_value, str):
                if source_path_value in source_paths:
                    errors.append(f"duplicate source path: {source_path_value}")
                source_paths.add(source_path_value)
            _, actual_source_sha = _validate_asset(
                resolved_root,
                source_asset,
                f"{location}.source",
                errors,
                image=False,
            )
            if actual_source_sha is not None:
                source_digests.append(actual_source_sha)
                source_digest_splits[actual_source_sha].update(session_splits)

        annotation = session.get("annotation")
        if _exact_keys(
            annotation,
            {"method", "reviewed", "tool", "toolVersion", "modelSha256"},
            f"{location}.annotation",
            errors,
        ):
            method = annotation.get("method")
            if method not in {"manual", "model_assisted"}:
                errors.append(
                    f"{location}.annotation.method must be manual or model_assisted"
                )
            if not isinstance(annotation.get("reviewed"), bool):
                errors.append(f"{location}.annotation.reviewed must be boolean")
            if method == "model_assisted":
                digest = annotation.get("modelSha256")
                if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
                    errors.append(
                        f"{location}.annotation.modelSha256 must identify the labeling model"
                    )
            elif annotation.get("modelSha256") is not None:
                errors.append(
                    f"{location}.annotation.modelSha256 must be null for manual annotation"
                )
            if session_split == "holdout" and (
                method != "manual" or annotation.get("reviewed") is not True
            ):
                errors.append(
                    f"holdout annotation at {location} must be manual and reviewed"
                )
            annotation_counts[
                f"{method}:{'reviewed' if annotation.get('reviewed') else 'unreviewed'}"
            ] += 1
            if review_session is not None and annotation != review_session.get(
                "annotation"
            ):
                errors.append(
                    f"{location}.annotation does not match the finalized review"
                )

        frames = session.get("frames")
        if not isinstance(frames, list) or not frames:
            errors.append(f"{location}.frames must be a non-empty array")
            continue
        frame_ids: set[str] = set()
        review_labels = (
            {
                label.get("frameId"): label
                for label in review_session.get("labels", [])
                if isinstance(label, dict) and isinstance(label.get("frameId"), str)
            }
            if review_session is not None
            and isinstance(review_session.get("labels"), list)
            else {}
        )
        timestamps: list[int] = []
        derived_categories: set[str] = set()
        for frame_index, frame in enumerate(frames):
            frame_location = f"{location}.frames[{frame_index}]"
            if not _exact_keys(
                frame,
                {"frameId", "timestampMs", "categories", "image", "label"},
                frame_location,
                errors,
            ):
                continue
            frame_id = frame.get("frameId")
            if not isinstance(frame_id, str) or not re.fullmatch(
                r"[a-z0-9][a-z0-9._-]{0,127}", frame_id
            ):
                errors.append(f"{frame_location}.frameId is invalid")
            elif frame_id in frame_ids:
                errors.append(f"duplicate frameId within session: {frame_id}")
            else:
                frame_ids.add(frame_id)
            timestamp = frame.get("timestampMs")
            if (
                isinstance(timestamp, bool)
                or not isinstance(timestamp, int)
                or timestamp < 0
            ):
                errors.append(
                    f"{frame_location}.timestampMs must be a nonnegative integer"
                )
            else:
                timestamps.append(timestamp)
            categories = frame.get("categories")
            if (
                not isinstance(categories, list)
                or not categories
                or any(
                    not isinstance(category, str) or category not in HARD_SUBSETS
                    for category in categories
                )
                or len(categories) != len(set(categories))
            ):
                errors.append(
                    f"{frame_location}.categories must be unique supported hard subsets"
                )
                categories = []
            if "negative" in categories and categories != ["negative"]:
                errors.append(
                    f"{frame_location}.negative cannot be combined with positive categories"
                )
            derived_categories.update(categories)
            image_value = frame.get("image")
            label_value = frame.get("label")
            if isinstance(image_value, dict) and isinstance(label_value, dict):
                image_relative = image_value.get("path")
                label_relative = label_value.get("path")
                if isinstance(image_relative, str):
                    image_parts = PurePosixPath(image_relative).parts
                    expected_label = (
                        PurePosixPath("labels", *image_parts[1:])
                        .with_suffix(".txt")
                        .as_posix()
                        if image_parts and image_parts[0] == "images"
                        else None
                    )
                    if expected_label is None or label_relative != expected_label:
                        errors.append(
                            f"{frame_location}.label.path must be the exact path "
                            "consumed by Ultralytics for the declared image"
                        )
                if isinstance(label_relative, str):
                    if label_relative in label_paths:
                        errors.append(f"duplicate label path: {label_relative}")
                    label_paths.add(label_relative)
            image_path, image_sha = _validate_asset(
                resolved_root,
                image_value,
                f"{frame_location}.image",
                errors,
                image=True,
            )
            label_path, _ = _validate_asset(
                resolved_root,
                label_value,
                f"{frame_location}.label",
                errors,
                image=False,
            )
            _validate_label_rows(
                label_path,
                categories=categories,
                location=frame_location,
                errors=errors,
            )
            if review_session is not None:
                reviewed_label = review_labels.get(frame_id)
                expected_review_label = (
                    {
                        "frameId": frame_id,
                        "timestampMs": timestamp,
                        "path": label_value.get("path"),
                        "byteSize": label_value.get("byteSize"),
                        "sha256": label_value.get("sha256"),
                    }
                    if isinstance(label_value, dict)
                    else None
                )
                if reviewed_label != expected_review_label:
                    errors.append(
                        f"{frame_location}.label does not match finalized review bytes"
                    )
            if session_split:
                split_counts[session_split] += 1
                total_frames += 1
                for category in categories:
                    hard_subset_counts[category] += 1
                if image_sha:
                    image_digest_splits[image_sha].update(session_splits)
        if timestamps != sorted(set(timestamps)):
            errors.append(
                f"{location}.timestampMs values must be unique and strictly increasing"
            )
        declared_capture_categories = session.get("captureCategories")
        if declared_capture_categories != sorted(derived_categories):
            errors.append(
                f"{location}.captureCategories must equal the sorted frame category union"
            )
        if provenance_enabled:
            producer = session.get("producer")
            if _exact_keys(
                producer,
                {
                    "visionLabSessionId",
                    "captureType",
                    "observedVideoSha256",
                    "companionManifest",
                },
                f"{location}.producer",
                errors,
            ):
                assert isinstance(producer, dict)
                vision_session_id = producer.get("visionLabSessionId")
                capture_type = producer.get("captureType")
                observed_sha = producer.get("observedVideoSha256")
                if not isinstance(vision_session_id, str) or not vision_session_id:
                    errors.append(
                        f"{location}.producer.visionLabSessionId must be nonempty"
                    )
                elif vision_session_id in producer_vision_session_ids:
                    errors.append(
                        f"duplicate producer visionSessionId: {vision_session_id}"
                    )
                else:
                    producer_vision_session_ids.add(vision_session_id)
                if (
                    not isinstance(capture_type, str)
                    or capture_type not in VISION_CAPTURE_TYPES
                ):
                    errors.append(f"{location}.producer.captureType is unsupported")
                if observed_sha != actual_source_sha:
                    errors.append(
                        f"{location}.producer observed video SHA-256 does not match source"
                    )
                companion, _ = _canonical_json_asset(
                    resolved_root,
                    producer.get("companionManifest"),
                    f"{location}.producer.companionManifest",
                    errors,
                )
                if companion is not None:
                    companion_facts = validate_vision_companion(
                        companion,
                        location=f"{location}.producer companion",
                        errors=errors,
                        expected_session_id=(
                            vision_session_id
                            if isinstance(vision_session_id, str)
                            else None
                        ),
                        actual_video_sha256=actual_source_sha,
                    )
                    if companion_facts is not None:
                        if companion_facts.capture_type != capture_type:
                            errors.append(
                                f"{location}.producer companion captureType does not match"
                            )
                        if isinstance(source, dict):
                            if (
                                companion_facts.width is not None
                                and companion_facts.width != source.get("width")
                            ):
                                errors.append(
                                    f"{location}.producer companion width does not match source"
                                )
                            if (
                                companion_facts.height is not None
                                and companion_facts.height != source.get("height")
                            ):
                                errors.append(
                                    f"{location}.producer companion height does not match source"
                                )
                mapping = producer_mappings.get(session_id or "")
                if mapping is None:
                    errors.append(f"{location}.producer has no session-map binding")
                else:
                    expected_binding = {
                        "visionSessionId": vision_session_id,
                        "captureGroupId": capture_group,
                        "split": session_split,
                        "categories": declared_capture_categories,
                    }
                    if review_session is None:
                        expected_binding["annotation"] = session.get("annotation")
                    else:
                        mapped_annotation = mapping.get("annotation")
                        if not isinstance(mapped_annotation, dict) or (
                            mapped_annotation.get("method") != "manual"
                            or mapped_annotation.get("reviewed") is not False
                            or mapped_annotation.get("modelSha256") is not None
                        ):
                            errors.append(
                                f"{location}.producer source annotation must be unreviewed manual work"
                            )
                    for key, expected_value in expected_binding.items():
                        if mapping.get(key) != expected_value:
                            errors.append(
                                f"{location}.producer session-map {key} does not match"
                            )
                    if producer_session_map is not None and session.get(
                        "actorId"
                    ) != producer_session_map.get("actorId"):
                        errors.append(
                            f"{location}.producer session-map actorId does not match"
                        )
                if review_session is not None:
                    review_binding = {
                        "visionSessionId": vision_session_id,
                        "datasetSessionId": session_id,
                        "actorId": session.get("actorId"),
                        "captureGroupId": capture_group,
                        "split": session_split,
                        "captureCategories": declared_capture_categories,
                        "annotation": session.get("annotation"),
                    }
                    for key, expected_value in review_binding.items():
                        if review_session.get(key) != expected_value:
                            errors.append(
                                f"{location}.annotation review {key} does not match"
                            )
                    review_source = review_session.get("sourceVideo")
                    if (
                        not isinstance(review_source, dict)
                        or review_source.get("sha256") != actual_source_sha
                    ):
                        errors.append(
                            f"{location}.annotation review source video does not match"
                        )
        if review_session is not None and set(review_labels) != frame_ids:
            errors.append(
                f"{location}.annotation review labels do not exactly match frames"
            )
        if session_split and capture_group:
            capture_groups_by_split[session_split].add(capture_group)

    assigned_groups = set(split_for_group)
    for group in sorted(assigned_groups - capture_groups_seen):
        errors.append(f"split captureGroupId {group} has no corresponding session")
    for digest, digest_splits in source_digest_splits.items():
        if len(digest_splits) > 1:
            errors.append(
                f"source video SHA-256 {digest} leaks across splits: {', '.join(sorted(digest_splits))}"
            )
    for digest, digest_splits in image_digest_splits.items():
        if len(digest_splits) > 1:
            errors.append(
                f"frame image SHA-256 {digest} leaks across splits: {', '.join(sorted(digest_splits))}"
            )
    for subset in HARD_SUBSETS:
        if hard_subset_counts[subset] == 0:
            errors.append(f"hard subset {subset} must contain at least one frame")
    if provenance_enabled and set(producer_mappings) != session_ids:
        errors.append(
            "producer session-map sessions do not exactly match dataset sessions"
        )
    if (
        producer_chain is not None
        and "annotationReview" in producer_chain
        and set(annotation_review_mappings) != session_ids
    ):
        errors.append(
            "annotation-review sessions do not exactly match dataset sessions"
        )

    if errors:
        raise DatasetValidationError(
            "dataset validation failed:\n- " + "\n- ".join(errors)
        )

    receipt = {
        "schemaVersion": "commandcanvas.hand-dataset-receipt/v1",
        "datasetId": dataset_id,
        "manifestSha256": sha256_file(resolved_manifest),
        "sourceVideoDigests": sorted(source_digests),
        "sessionCount": len(sessions),
        "frameCount": total_frames,
        "splitCounts": {split: split_counts[split] for split in sorted(SPLITS)},
        "captureGroupCounts": {
            split: len(capture_groups_by_split[split]) for split in sorted(SPLITS)
        },
        "hardSubsetCounts": {
            subset: hard_subset_counts[subset] for subset in HARD_SUBSETS
        },
        "annotationProvenance": dict(sorted(annotation_counts.items())),
        "eligibleForTraining": True,
        "productionEligible": False,
        "eligibilityScope": "dataset-for-training-only",
    }
    return attach_digest(receipt, "receiptSha256")
