"""Strict manifest, media, split, and YOLO hand-pose dataset validation."""

from __future__ import annotations

import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import UUID

from PIL import Image, UnidentifiedImageError

from .canonical import attach_digest, sha256_file


SCHEMA_VERSION = "commandcanvas.hand-dataset/v1"
HARD_SUBSETS = ("drawing", "edge", "negative", "pinch", "two_hand")
SPLITS = ("train", "validation", "holdout")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
MIN_SOURCE_DIMENSION = 64
MAX_SOURCE_DIMENSION = 8192


class DatasetValidationError(ValueError):
    """Raised after collecting every actionable dataset validation error."""


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
    pure = PurePosixPath(relative)
    if (
        not relative
        or "\\" in relative
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
    _exact_keys(
        manifest,
        {
            "schemaVersion",
            "datasetId",
            "createdAt",
            "consent",
            "keypointOrder",
            "classNames",
            "splits",
            "sessions",
        },
        "manifest",
        errors,
    )
    if manifest.get("schemaVersion") != SCHEMA_VERSION:
        errors.append(f"schemaVersion must be {SCHEMA_VERSION}")
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
    split_counts: Counter[str] = Counter()
    capture_group_counts: Counter[str] = Counter()
    hard_subset_counts: Counter[str] = Counter()
    annotation_counts: Counter[str] = Counter()
    total_frames = 0
    for session_index, session in enumerate(sessions):
        location = f"sessions[{session_index}]"
        if not _exact_keys(
            session,
            {
                "sessionId",
                "captureGroupId",
                "actorId",
                "captureCategories",
                "source",
                "annotation",
                "frames",
            },
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

        source = session.get("source")
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

        frames = session.get("frames")
        if not isinstance(frames, list) or not frames:
            errors.append(f"{location}.frames must be a non-empty array")
            continue
        frame_ids: set[str] = set()
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
        if session_split and capture_group:
            capture_group_counts[session_split] += 1

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
            split: capture_group_counts[split] for split in sorted(SPLITS)
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
