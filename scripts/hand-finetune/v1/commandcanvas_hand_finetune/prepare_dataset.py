"""Bridge local Vision Lab recordings into the strict training dataset contract."""

from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from statistics import median
from typing import Any, Protocol, Sequence
from uuid import UUID

from PIL import Image, UnidentifiedImageError

from .annotation_workbench import (
    AnnotationWorkbenchError,
    validate_annotation_finalization,
)
from .canonical import (
    canonical_json_bytes,
    sha256_bytes,
    sha256_file,
    write_canonical_json,
)
from .dataset import (
    HARD_SUBSETS,
    SPLITS,
    DatasetValidationError,
    VISION_CONSENT_VERSION,
    VISION_PROTOCOL,
    validate_dataset,
    validate_vision_companion,
)


SESSION_MAP_SCHEMA = "commandcanvas.hand-session-map/v1"
DATASET_CONSENT_VERSION = "commandcanvas-owner-training/v1"
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
MIN_CADENCE_MS = 20
MAX_CADENCE_MS = 5_000
MAX_FRAMES_PER_SESSION = 100_000
MAX_PROBE_PACKETS = MAX_FRAMES_PER_SESSION + 1
SESSION_MAP_SESSION_KEYS = {
    "visionSessionId",
    "datasetSessionId",
    "captureGroupId",
    "split",
    "categories",
    "videoPath",
    "manifestPath",
    "labelDir",
    "annotation",
}


class DatasetPreparationError(ValueError):
    """Raised when source evidence cannot safely become a training dataset."""


class CommandRunner(Protocol):
    def __call__(self, command: Sequence[str]) -> subprocess.CompletedProcess[str]: ...


def _default_command_runner(
    command: Sequence[str],
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(item) for item in command],
        check=False,
        capture_output=True,
        text=True,
    )


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DatasetPreparationError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _load_strict_json(path: Path, description: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise DatasetPreparationError(
            f"{description} must be an existing non-symlink regular file"
        )
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=_strict_object
        )
    except DatasetPreparationError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise DatasetPreparationError(
            f"{description} could not be read as strict JSON: {error}"
        ) from error
    if not isinstance(value, dict):
        raise DatasetPreparationError(f"{description} must be a JSON object")
    return value


def _require_exact_keys(
    value: Any, expected: set[str], description: str
) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise DatasetPreparationError(f"{description} must be an object")
    missing = expected - value.keys()
    unknown = value.keys() - expected
    if missing or unknown:
        details: list[str] = []
        if missing:
            details.append(f"missing {', '.join(sorted(missing))}")
        if unknown:
            details.append(f"unsupported {', '.join(sorted(unknown))}")
        raise DatasetPreparationError(f"{description} fields: {'; '.join(details)}")
    return value


def _validate_mapped_session(value: Any, description: str) -> dict[str, Any]:
    optional = (
        {"sampleTimestampsMs"}
        if isinstance(value, dict) and "sampleTimestampsMs" in value
        else set()
    )
    return _require_exact_keys(value, SESSION_MAP_SESSION_KEYS | optional, description)


def _resolve_sample_timestamps(
    session: dict[str, Any],
    *,
    description: str,
    duration_ms: int,
    cadence_ms: int,
) -> list[int]:
    selected = session.get("sampleTimestampsMs")
    if selected is None:
        timestamps = list(range(0, max(1, duration_ms), cadence_ms))
    else:
        if not isinstance(selected, list) or not selected:
            raise DatasetPreparationError(
                f"{description}.sampleTimestampsMs must be a nonempty array"
            )
        timestamps = []
        prior = -1
        for index, timestamp in enumerate(selected):
            if (
                isinstance(timestamp, bool)
                or not isinstance(timestamp, int)
                or timestamp < 0
                or timestamp >= duration_ms
            ):
                raise DatasetPreparationError(
                    f"{description}.sampleTimestampsMs[{index}] must be an integer "
                    "within the probed video duration"
                )
            if timestamp <= prior:
                raise DatasetPreparationError(
                    f"{description}.sampleTimestampsMs must be unique and strictly "
                    "increasing"
                )
            timestamps.append(timestamp)
            prior = timestamp
    if not timestamps or len(timestamps) > MAX_FRAMES_PER_SESSION:
        raise DatasetPreparationError("frame extraction count is outside safe bounds")
    return timestamps


def _canonical_uuid(value: Any, description: str) -> str:
    if not isinstance(value, str):
        raise DatasetPreparationError(f"{description} must be a canonical UUID")
    try:
        parsed = UUID(value)
    except ValueError as error:
        raise DatasetPreparationError(
            f"{description} must be a canonical UUID"
        ) from error
    if value != str(parsed):
        raise DatasetPreparationError(
            f"{description} must be a lowercase canonical UUID"
        )
    return value


def _nonempty_string(value: Any, description: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise DatasetPreparationError(f"{description} must be a nonempty string")
    return value


def _timestamp(value: Any, description: str) -> datetime:
    raw = _nonempty_string(value, description)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise DatasetPreparationError(f"{description} must be ISO-8601") from error
    if parsed.tzinfo is None:
        raise DatasetPreparationError(f"{description} must include a timezone")
    return parsed


def _root(path: Path, description: str) -> Path:
    path = Path(path)
    if path.is_symlink() or not path.is_dir():
        raise DatasetPreparationError(
            f"{description} must be an existing non-symlink directory"
        )
    return path.resolve(strict=True)


def _safe_relative(value: Any, description: str) -> PurePosixPath:
    if not isinstance(value, str):
        raise DatasetPreparationError(f"{description} must be a safe relative path")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise DatasetPreparationError(
            f"{description} may not contain control characters"
        )
    relative = PurePosixPath(value)
    if (
        not value
        or "\\" in value
        or relative.is_absolute()
        or any(part in {"", ".", ".."} for part in relative.parts)
    ):
        raise DatasetPreparationError(f"{description} must be a safe relative path")
    return relative


def _refuse_symlink_components(
    root: Path, relative: PurePosixPath, description: str
) -> None:
    candidate = root
    for part in relative.parts:
        candidate /= part
        if candidate.is_symlink():
            raise DatasetPreparationError(f"{description} may not traverse a symlink")


def _regular_file(root: Path, value: Any, description: str) -> tuple[Path, str]:
    relative = _safe_relative(value, description)
    _refuse_symlink_components(root, relative, description)
    candidate = root.joinpath(*relative.parts)
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise DatasetPreparationError(f"{description} does not exist") from error
    if candidate.is_symlink() or not resolved.is_file() or root not in resolved.parents:
        raise DatasetPreparationError(
            f"{description} must resolve to a regular file inside its declared root"
        )
    return resolved, relative.as_posix()


def _regular_directory(root: Path, value: Any, description: str) -> Path:
    relative = _safe_relative(value, description)
    _refuse_symlink_components(root, relative, description)
    candidate = root.joinpath(*relative.parts)
    try:
        resolved = candidate.resolve(strict=True)
    except OSError as error:
        raise DatasetPreparationError(f"{description} does not exist") from error
    if candidate.is_symlink() or not resolved.is_dir() or root not in resolved.parents:
        raise DatasetPreparationError(
            f"{description} must resolve to a directory inside its declared root"
        )
    return resolved


def _positive_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed > 0 else None


def _nonnegative_float(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) and parsed >= 0 else None


def _container_frame_rate(value: Any) -> float | None:
    try:
        numerator, denominator = str(value).split("/", 1)
        return _positive_float(float(numerator) / float(denominator))
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _probe_packet_timing(
    source: Path, command_runner: CommandRunner
) -> tuple[float, float]:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-read_intervals",
        f"%+#{MAX_PROBE_PACKETS}",
        "-show_entries",
        "packet=pts_time,duration_time",
        "-of",
        "json",
        str(source),
    ]
    completed = command_runner(command)
    if completed.returncode != 0:
        raise DatasetPreparationError(
            f"ffprobe packet timing failed for {source.name}: "
            f"{completed.stderr.strip()}"
        )
    try:
        payload = json.loads(completed.stdout, object_pairs_hook=_strict_object)
        packets = payload["packets"]
    except (
        DatasetPreparationError,
        KeyError,
        TypeError,
        json.JSONDecodeError,
    ) as error:
        raise DatasetPreparationError(
            f"ffprobe returned invalid packet timing for {source.name}"
        ) from error
    if (
        not isinstance(packets, list)
        or len(packets) < 2
        or len(packets) > MAX_FRAMES_PER_SESSION
    ):
        raise DatasetPreparationError(
            f"ffprobe returned unsupported packet timing for {source.name}"
        )

    timestamps: list[float] = []
    for packet in packets:
        if not isinstance(packet, dict):
            raise DatasetPreparationError(
                f"ffprobe returned invalid packet timing for {source.name}"
            )
        timestamp = _nonnegative_float(packet.get("pts_time"))
        if timestamp is None or (timestamps and timestamp <= timestamps[-1]):
            raise DatasetPreparationError(
                f"ffprobe returned invalid packet timing for {source.name}"
            )
        timestamps.append(timestamp)

    deltas = [
        current - previous for previous, current in zip(timestamps, timestamps[1:])
    ]
    typical_interval = median(deltas)
    frame_rate = _positive_float(1 / typical_interval)
    tail_duration = _positive_float(packets[-1].get("duration_time"))
    duration = _positive_float(timestamps[-1] + (tail_duration or typical_interval))
    if frame_rate is None or duration is None:
        raise DatasetPreparationError(
            f"ffprobe returned unsupported packet timing for {source.name}"
        )
    return duration, frame_rate


def _probe_video(
    source: Path, command_runner: CommandRunner
) -> tuple[int, int, float, float, str]:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height,avg_frame_rate:format=duration",
        "-of",
        "json",
        str(source),
    ]
    completed = command_runner(command)
    if completed.returncode != 0:
        raise DatasetPreparationError(
            f"ffprobe failed for {source.name}: {completed.stderr.strip()}"
        )
    try:
        payload = json.loads(completed.stdout, object_pairs_hook=_strict_object)
        streams = payload["streams"]
        stream = streams[0]
        width = int(stream["width"])
        height = int(stream["height"])
        codec = str(stream["codec_name"])
    except (
        DatasetPreparationError,
        KeyError,
        IndexError,
        TypeError,
        ValueError,
    ) as error:
        raise DatasetPreparationError(
            f"ffprobe returned an invalid video contract for {source.name}"
        ) from error
    if (
        not isinstance(streams, list)
        or len(streams) != 1
        or width <= 0
        or height <= 0
        or codec not in {"vp8", "vp9"}
    ):
        raise DatasetPreparationError(
            f"ffprobe returned an unsupported video contract for {source.name}"
        )
    format_metadata = payload.get("format")
    duration = (
        _positive_float(format_metadata.get("duration"))
        if isinstance(format_metadata, dict)
        else None
    )
    frame_rate = _container_frame_rate(stream.get("avg_frame_rate"))
    if duration is None or frame_rate is None:
        duration, frame_rate = _probe_packet_timing(source, command_runner)
    return width, height, duration, frame_rate, codec


def _extract_png(
    source: Path,
    timestamp_ms: int,
    destination: Path,
    command_runner: CommandRunner,
) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(source),
        "-ss",
        f"{timestamp_ms / 1000:.3f}",
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-an",
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-threads",
        "1",
        "-c:v",
        "png",
        "-compression_level",
        "9",
        "-y",
        str(destination),
    ]
    completed = command_runner(command)
    if completed.returncode != 0:
        raise DatasetPreparationError(
            f"ffmpeg failed for {source.name} at {timestamp_ms}ms: "
            f"{completed.stderr.strip()}"
        )
    if destination.is_symlink() or not destination.is_file():
        raise DatasetPreparationError(
            f"ffmpeg did not create the requested PNG at {timestamp_ms}ms"
        )


def _asset(path: Path, root: Path) -> dict[str, Any]:
    return {
        "path": path.relative_to(root).as_posix(),
        "byteSize": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def _image_asset(path: Path, root: Path) -> dict[str, Any]:
    try:
        with Image.open(path) as decoded:
            decoded.verify()
        with Image.open(path) as decoded:
            width, height = decoded.size
    except (OSError, UnidentifiedImageError) as error:
        raise DatasetPreparationError(
            f"extracted frame is not a valid image: {path}"
        ) from error
    return {**_asset(path, root), "width": width, "height": height}


def _validate_categories(capture_type: str, value: Any, description: str) -> list[str]:
    if (
        not isinstance(value, list)
        or not value
        or any(not isinstance(item, str) or item not in HARD_SUBSETS for item in value)
        or len(value) != len(set(value))
        or value != sorted(value)
    ):
        raise DatasetPreparationError(
            f"{description} must be a sorted unique list of supported categories"
        )
    categories = list(value)
    if "negative" in categories and categories != ["negative"]:
        raise DatasetPreparationError(
            f"{description} cannot combine negative with positive categories"
        )
    required_category = {
        "drawing": "drawing",
        "pinch": "pinch",
        "edges-corners": "edge",
        "two-hand-transforms": "two_hand",
    }.get(capture_type)
    if capture_type == "negative-no-hand" and categories != ["negative"]:
        raise DatasetPreparationError(
            f"{description} must be exactly negative for negative-no-hand capture"
        )
    if capture_type != "negative-no-hand" and categories == ["negative"]:
        raise DatasetPreparationError(
            f"{description} may use negative only for negative-no-hand capture"
        )
    if required_category and required_category not in categories:
        raise DatasetPreparationError(
            f"{description} must include {required_category} for {capture_type} capture"
        )
    return categories


def _validate_annotation(
    value: Any, description: str, *, split: str, allow_unreviewed_holdout: bool
) -> dict[str, Any]:
    annotation = _require_exact_keys(
        value,
        {"method", "reviewed", "tool", "toolVersion", "modelSha256"},
        description,
    )
    if not isinstance(annotation["method"], str) or annotation["method"] not in {
        "manual",
        "model_assisted",
    }:
        raise DatasetPreparationError(
            f"{description}.method must be manual or model_assisted"
        )
    if not isinstance(annotation["reviewed"], bool):
        raise DatasetPreparationError(f"{description}.reviewed must be boolean")
    _nonempty_string(annotation["tool"], f"{description}.tool")
    _nonempty_string(annotation["toolVersion"], f"{description}.toolVersion")
    model_sha = annotation["modelSha256"]
    if annotation["method"] == "model_assisted":
        if not isinstance(model_sha, str) or not SHA256_PATTERN.fullmatch(model_sha):
            raise DatasetPreparationError(
                f"{description}.modelSha256 must be a SHA-256 digest"
            )
    elif model_sha is not None:
        raise DatasetPreparationError(
            f"{description}.modelSha256 must be null for manual labels"
        )
    if split == "holdout" and (
        annotation["method"] != "manual"
        or (annotation["reviewed"] is not True and not allow_unreviewed_holdout)
    ):
        raise DatasetPreparationError(
            "holdout annotation must remain manual and reviewed"
        )
    return dict(annotation)


def _validate_companion(
    value: dict[str, Any], expected_session_id: str, source: Path
) -> tuple[str, int | None, int | None, float | None, datetime, datetime]:
    errors: list[str] = []
    facts = validate_vision_companion(
        value,
        location="Vision Lab companion manifest",
        errors=errors,
        expected_session_id=expected_session_id,
        actual_video_sha256=sha256_file(source),
    )
    if facts is None or errors:
        raise DatasetPreparationError("\n- ".join(errors))
    return (
        facts.capture_type,
        facts.width,
        facts.height,
        facts.frame_rate,
        facts.started_at,
        facts.stopped_at,
    )


def _validate_session_map(
    value: dict[str, Any],
) -> tuple[str, str, int, list[dict[str, Any]]]:
    _require_exact_keys(
        value,
        {"schemaVersion", "datasetId", "createdAt", "actorId", "cadenceMs", "sessions"},
        "session map",
    )
    if value["schemaVersion"] != SESSION_MAP_SCHEMA:
        raise DatasetPreparationError(
            f"session map schemaVersion must be {SESSION_MAP_SCHEMA}"
        )
    dataset_id = _canonical_uuid(value["datasetId"], "session map datasetId")
    _timestamp(value["createdAt"], "session map createdAt")
    actor_id = _nonempty_string(value["actorId"], "session map actorId")
    cadence = value["cadenceMs"]
    if (
        isinstance(cadence, bool)
        or not isinstance(cadence, int)
        or not MIN_CADENCE_MS <= cadence <= MAX_CADENCE_MS
    ):
        raise DatasetPreparationError(
            f"session map cadenceMs must be between {MIN_CADENCE_MS} and {MAX_CADENCE_MS}"
        )
    sessions = value["sessions"]
    if not isinstance(sessions, list) or not sessions:
        raise DatasetPreparationError("session map sessions must be a nonempty array")
    return dataset_id, actor_id, cadence, sessions


def _check_destination(output_dir: Path, roots: Sequence[Path]) -> Path:
    output_dir = Path(output_dir)
    if output_dir.exists() or output_dir.is_symlink():
        raise DatasetPreparationError("output directory must not already exist")
    parent = output_dir.parent
    if parent.is_symlink() or not parent.is_dir():
        raise DatasetPreparationError(
            "output parent must be an existing non-symlink directory"
        )
    resolved = output_dir.resolve(strict=False)
    for root in roots:
        if resolved == root or root in resolved.parents:
            raise DatasetPreparationError(
                "output directory must be outside input roots"
            )
    return resolved


def _validated_annotation_review(
    *,
    labels_root: Path,
    session_map_path: Path,
    receipt_path: Path,
) -> dict[str, Any]:
    receipt = Path(receipt_path)
    try:
        receipt_root = receipt.parent.resolve(strict=True)
    except OSError as error:
        raise DatasetPreparationError(
            "annotation finalization receipt root does not exist"
        ) from error
    if labels_root != receipt_root:
        raise DatasetPreparationError(
            "labels root must be the finalized annotation draft root"
        )
    try:
        finalization = validate_annotation_finalization(
            dataset_root=receipt_root, receipt_path=receipt
        )
    except (AnnotationWorkbenchError, OSError, ValueError) as error:
        raise DatasetPreparationError(
            f"annotation finalization receipt is invalid: {error}"
        ) from error
    source_adapter = finalization.get("sourceAdapter")
    canonical_session_map_sha = sha256_bytes(
        canonical_json_bytes(_load_strict_json(Path(session_map_path), "session map"))
    )
    if (
        not isinstance(source_adapter, dict)
        or source_adapter.get("sourceManifestSha256") != canonical_session_map_sha
    ):
        raise DatasetPreparationError(
            "annotation source adapter does not bind the supplied session map"
        )
    handoff = finalization.get("bridgeHandoff")
    sessions = handoff.get("sessions") if isinstance(handoff, dict) else None
    if not isinstance(sessions, list) or not sessions:
        raise DatasetPreparationError(
            "annotation finalization receipt has no bridge handoff sessions"
        )
    sessions_by_id: dict[str, dict[str, Any]] = {}
    for session in sessions:
        session_id = (
            session.get("datasetSessionId") if isinstance(session, dict) else None
        )
        if not isinstance(session_id, str) or session_id in sessions_by_id:
            raise DatasetPreparationError(
                "annotation handoff dataset session identities must be unique"
            )
        sessions_by_id[session_id] = session
    edit_directory = receipt_root / "annotation-receipts"
    edits_by_digest: dict[str, Path] = {}
    if edit_directory.is_symlink() or not edit_directory.is_dir():
        raise DatasetPreparationError("annotation edit receipt directory is missing")
    for path in sorted(edit_directory.glob("*.json")):
        value = _load_strict_json(path, "annotation edit receipt")
        digest = value.get("receiptSha256")
        if not isinstance(digest, str) or digest in edits_by_digest:
            raise DatasetPreparationError(
                "annotation edit receipt identities must be unique"
            )
        edits_by_digest[digest] = path
    ordered_digests = finalization.get("editReceiptSha256s")
    if not isinstance(ordered_digests, list) or set(ordered_digests) != set(
        edits_by_digest
    ):
        raise DatasetPreparationError(
            "annotation edit receipt files do not match the finalized edit chain"
        )
    return {
        "root": receipt_root,
        "receiptPath": receipt.resolve(strict=True),
        "draftPath": (receipt_root / "annotation-draft.json").resolve(strict=True),
        "finalization": finalization,
        "sessions": sessions_by_id,
        "editPaths": [edits_by_digest[digest] for digest in ordered_digests],
    }


def prepare_dataset(
    *,
    capture_root: Path,
    session_map_path: Path,
    labels_root: Path,
    output_dir: Path,
    annotation_finalization_receipt_path: Path | None = None,
    command_runner: CommandRunner = _default_command_runner,
) -> dict[str, Any]:
    """Validate evidence, extract deterministic PNGs, and publish one dataset."""

    capture_root = _root(capture_root, "capture root")
    labels_root = _root(labels_root, "labels root")
    destination = _check_destination(output_dir, (capture_root, labels_root))
    session_map = _load_strict_json(Path(session_map_path), "session map")
    dataset_id, actor_id, cadence_ms, mapped_sessions = _validate_session_map(
        session_map
    )
    annotation_review = (
        _validated_annotation_review(
            labels_root=labels_root,
            session_map_path=Path(session_map_path),
            receipt_path=annotation_finalization_receipt_path,
        )
        if annotation_finalization_receipt_path is not None
        else None
    )
    if annotation_review is not None:
        source_actor = annotation_review["finalization"]["sourceAdapter"]["actorId"]
        if source_actor != actor_id:
            raise DatasetPreparationError(
                "annotation source actor does not match the session-map actor"
            )

    parsed_sessions: list[dict[str, Any]] = []
    identifiers: dict[str, set[str]] = {
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
        dataset_session_id = _canonical_uuid(
            session["datasetSessionId"], f"{description}.datasetSessionId"
        )
        capture_group_id = _canonical_uuid(
            session["captureGroupId"], f"{description}.captureGroupId"
        )
        split = session["split"]
        if split not in SPLITS:
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
        source_annotation = _validate_annotation(
            session["annotation"],
            f"{description}.annotation",
            split=split,
            allow_unreviewed_holdout=annotation_review is not None,
        )
        review_session = (
            annotation_review["sessions"].get(dataset_session_id)
            if annotation_review is not None
            else None
        )
        if annotation_review is not None and review_session is None:
            raise DatasetPreparationError(
                f"{description} has no finalized annotation handoff"
            )
        if review_session is not None:
            expected_binding = {
                "visionSessionId": vision_session_id,
                "datasetSessionId": dataset_session_id,
                "captureGroupId": capture_group_id,
                "split": split,
                "labelDirectory": label_relative,
                "actorId": actor_id,
            }
            for field, expected_value in expected_binding.items():
                if review_session.get(field) != expected_value:
                    raise DatasetPreparationError(
                        f"annotation handoff {field} does not match {description}"
                    )
            if (
                source_annotation["method"] != "manual"
                or source_annotation["reviewed"] is not False
            ):
                raise DatasetPreparationError(
                    "review-bound source annotation must be unreviewed manual work"
                )
            annotation = _validate_annotation(
                review_session.get("annotation"),
                "annotation handoff annotation",
                split=split,
                allow_unreviewed_holdout=False,
            )
            label_directory = _regular_directory(
                labels_root,
                review_session["labelDirectory"],
                "annotation label directory",
            )
        else:
            annotation = source_annotation
            label_directory = _regular_directory(
                labels_root, session["labelDir"], f"{description}.labelDir"
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
        if (
            review_session is not None
            and review_session.get("captureCategories") != categories
        ):
            raise DatasetPreparationError(
                "annotation handoff capture categories do not match the session map"
            )
        width, height, duration_seconds, actual_rate, codec = _probe_video(
            source, command_runner
        )
        if review_session is not None:
            handoff_source = review_session.get("sourceVideo")
            if (
                not isinstance(handoff_source, dict)
                or handoff_source.get("sha256") != sha256_file(source)
                or handoff_source.get("width") != width
                or handoff_source.get("height") != height
            ):
                raise DatasetPreparationError(
                    "annotation handoff source video does not match Vision Lab evidence"
                )
        if declared_width is not None and width != declared_width:
            raise DatasetPreparationError(
                f"Vision Lab dimensions width {declared_width} does not match ffprobe width {width}"
            )
        if declared_height is not None and height != declared_height:
            raise DatasetPreparationError(
                f"Vision Lab dimensions height {declared_height} does not match ffprobe height {height}"
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
            raise DatasetPreparationError(
                "Vision Lab VP8 declaration does not match ffprobe"
            )
        if "codecs=vp9" in mime_type and codec != "vp9":
            raise DatasetPreparationError(
                "Vision Lab VP9 declaration does not match ffprobe"
            )

        for field, value in {
            "visionSessionId": vision_session_id,
            "datasetSessionId": dataset_session_id,
            "videoPath": video_relative,
            "manifestPath": manifest_relative,
            "labelDir": label_relative,
        }.items():
            if value in identifiers[field]:
                raise DatasetPreparationError(f"duplicate {field}: {value}")
            identifiers[field].add(value)

        duration_ms = int(round(duration_seconds * 1000))
        timestamps = _resolve_sample_timestamps(
            session,
            description=description,
            duration_ms=duration_ms,
            cadence_ms=cadence_ms,
        )
        parsed_sessions.append(
            {
                "visionSessionId": vision_session_id,
                "datasetSessionId": dataset_session_id,
                "captureGroupId": capture_group_id,
                "split": split,
                "categories": categories,
                "source": source,
                "sourceSha256": sha256_file(source),
                "labelDirectory": label_directory,
                "annotation": dict(annotation),
                "width": width,
                "height": height,
                "timestamps": timestamps,
                "companion": companion,
                "reviewSession": review_session,
            }
        )

    staging = Path(
        tempfile.mkdtemp(prefix=f".{destination.name}.", dir=destination.parent)
    )
    try:
        session_map_copy = staging / "provenance" / "session-map.json"
        write_canonical_json(session_map_copy, session_map)
        annotation_review_assets: dict[str, Any] | None = None
        if annotation_review is not None:
            review_root = staging / "provenance" / "annotation"
            draft_copy = review_root / "annotation-draft.json"
            finalization_copy = review_root / "annotation-finalization-receipt.json"
            draft_copy.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(annotation_review["draftPath"], draft_copy)
            shutil.copyfile(annotation_review["receiptPath"], finalization_copy)
            edit_assets: list[dict[str, Any]] = []
            for index, (digest, edit_path) in enumerate(
                zip(
                    annotation_review["finalization"]["editReceiptSha256s"],
                    annotation_review["editPaths"],
                )
            ):
                edit_copy = review_root / "edits" / f"{index:06d}-{digest}.json"
                edit_copy.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(edit_path, edit_copy)
                edit_assets.append(_asset(edit_copy, staging))
            annotation_review_assets = {
                "draftManifest": _asset(draft_copy, staging),
                "finalizationReceipt": _asset(finalization_copy, staging),
                "editReceipts": edit_assets,
            }
        manifest_sessions: list[dict[str, Any]] = []
        split_groups: dict[str, set[str]] = {split: set() for split in SPLITS}
        for session in sorted(
            parsed_sessions, key=lambda item: item["datasetSessionId"]
        ):
            session_id = session["datasetSessionId"]
            split_groups[session["split"]].add(session["captureGroupId"])
            source_destination = staging / "videos" / f"{session_id}.webm"
            source_destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(session["source"], source_destination)
            companion_destination = (
                staging / "provenance" / "companions" / f"{session_id}.json"
            )
            write_canonical_json(companion_destination, session["companion"])
            if sha256_file(session["source"]) != session["sourceSha256"]:
                raise DatasetPreparationError(
                    "raw WebM changed during frame extraction"
                )
            if sha256_file(source_destination) != session["sourceSha256"]:
                raise DatasetPreparationError(
                    "copied raw WebM does not match its source"
                )

            expected_labels = {
                f"frame-{timestamp:010d}.txt" for timestamp in session["timestamps"]
            }
            actual_labels: set[str] = set()
            for candidate in session["labelDirectory"].iterdir():
                if candidate.is_symlink() or not candidate.is_file():
                    raise DatasetPreparationError(
                        "corrected label directory may contain only regular label files"
                    )
                actual_labels.add(candidate.name)
            if actual_labels != expected_labels:
                raise DatasetPreparationError(
                    "corrected label files must exactly match extracted frame timestamps"
                )
            reviewed_labels = (
                {
                    item.get("frameId"): item
                    for item in session["reviewSession"].get("labels", [])
                    if isinstance(item, dict)
                }
                if isinstance(session["reviewSession"], dict)
                else None
            )
            if reviewed_labels is not None and set(reviewed_labels) != {
                f"frame-{timestamp:010d}" for timestamp in session["timestamps"]
            }:
                raise DatasetPreparationError(
                    "annotation handoff labels do not exactly match extracted frames"
                )

            frames: list[dict[str, Any]] = []
            for timestamp_ms in session["timestamps"]:
                frame_id = f"frame-{timestamp_ms:010d}"
                image_path = staging / "images" / session_id / f"{frame_id}.png"
                label_path = staging / "labels" / session_id / f"{frame_id}.txt"
                _extract_png(
                    session["source"], timestamp_ms, image_path, command_runner
                )
                label_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(
                    session["labelDirectory"] / f"{frame_id}.txt", label_path
                )
                if reviewed_labels is not None:
                    reviewed_label = reviewed_labels[frame_id]
                    if (
                        reviewed_label.get("timestampMs") != timestamp_ms
                        or reviewed_label.get("path")
                        != f"labels/{session_id}/{frame_id}.txt"
                        or reviewed_label.get("byteSize") != label_path.stat().st_size
                        or reviewed_label.get("sha256") != sha256_file(label_path)
                    ):
                        raise DatasetPreparationError(
                            "annotation handoff label bytes do not match the finalized review"
                        )
                image_asset = _image_asset(image_path, staging)
                if (image_asset["width"], image_asset["height"]) != (
                    session["width"],
                    session["height"],
                ):
                    raise DatasetPreparationError(
                        "extracted frame dimensions do not match ffprobe video dimensions"
                    )
                frames.append(
                    {
                        "frameId": frame_id,
                        "timestampMs": timestamp_ms,
                        "categories": session["categories"],
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
                    "annotation": session["annotation"],
                    "producer": {
                        "visionLabSessionId": session["visionSessionId"],
                        "captureType": session["companion"]["captureType"],
                        "observedVideoSha256": session["sourceSha256"],
                        "companionManifest": _asset(companion_destination, staging),
                    },
                    "frames": frames,
                }
            )

        producer_chain: dict[str, Any] = {
            "consentVersion": VISION_CONSENT_VERSION,
            "protocol": VISION_PROTOCOL,
            "sessionMap": _asset(session_map_copy, staging),
        }
        if annotation_review_assets is not None:
            producer_chain["annotationReview"] = annotation_review_assets
        manifest = {
            "schemaVersion": "commandcanvas.hand-dataset/v2",
            "datasetId": dataset_id,
            "createdAt": session_map["createdAt"],
            "consent": {"approved": True, "version": DATASET_CONSENT_VERSION},
            "keypointOrder": "mediapipe-hand-21",
            "classNames": ["hand"],
            "producerChain": producer_chain,
            "splits": {
                split: sorted(split_groups[split]) for split in sorted(split_groups)
            },
            "sessions": manifest_sessions,
        }
        manifest_path = staging / "dataset-manifest.json"
        write_canonical_json(manifest_path, manifest)
        try:
            receipt = validate_dataset(staging, manifest_path)
        except DatasetValidationError as error:
            raise DatasetPreparationError(str(error)) from error
        write_canonical_json(staging / "dataset-receipt.json", receipt)
        staging.rename(destination)
        return receipt
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
