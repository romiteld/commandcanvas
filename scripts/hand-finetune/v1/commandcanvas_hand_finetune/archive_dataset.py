"""Create and revalidate a deterministic archive of one strict dataset."""

from __future__ import annotations

import io
import json
import os
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any

from .canonical import attach_digest, sha256_file, write_canonical_json
from .dataset import DatasetValidationError, validate_dataset


ARCHIVE_RECEIPT_SCHEMA = "commandcanvas.hand-dataset-archive-receipt/v1"


class DatasetArchiveError(ValueError):
    """Raised when the dataset cannot be safely archived and revalidated."""


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DatasetArchiveError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _load_strict_json(path: Path, description: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise DatasetArchiveError(
            f"{description} must be an existing non-symlink regular file"
        )
    try:
        value = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=_strict_object
        )
    except DatasetArchiveError:
        raise
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise DatasetArchiveError(
            f"{description} could not be read as strict JSON: {error}"
        ) from error
    if not isinstance(value, dict):
        raise DatasetArchiveError(f"{description} must be a JSON object")
    return value


def _safe_relative(path: Path, root: Path, description: str) -> str:
    try:
        relative = path.resolve(strict=True).relative_to(root).as_posix()
    except (OSError, ValueError) as error:
        raise DatasetArchiveError(
            f"{description} must be inside dataset root"
        ) from error
    pure = PurePosixPath(relative)
    if (
        path.is_symlink()
        or pure.is_absolute()
        or any(part in {"", ".", ".."} for part in pure.parts)
    ):
        raise DatasetArchiveError(f"{description} must be a safe regular file")
    return relative


def _manifest_members(manifest: dict[str, Any]) -> set[str]:
    members: set[str] = set()
    producer_chain = manifest.get("producerChain")
    if producer_chain is not None:
        if not isinstance(producer_chain, dict) or not isinstance(
            producer_chain.get("sessionMap"), dict
        ):
            raise DatasetArchiveError("dataset manifest producer chain is invalid")
        session_map_path = producer_chain["sessionMap"].get("path")
        if not isinstance(session_map_path, str):
            raise DatasetArchiveError("dataset manifest session-map path is invalid")
        members.add(session_map_path)
    sessions = manifest.get("sessions")
    if not isinstance(sessions, list):
        raise DatasetArchiveError("dataset manifest sessions must be an array")
    for session in sessions:
        if not isinstance(session, dict) or not isinstance(session.get("source"), dict):
            raise DatasetArchiveError("dataset manifest session source is invalid")
        source_path = session["source"].get("path")
        if not isinstance(source_path, str):
            raise DatasetArchiveError("dataset manifest source path is invalid")
        members.add(source_path)
        producer = session.get("producer")
        if producer is not None:
            if not isinstance(producer, dict) or not isinstance(
                producer.get("companionManifest"), dict
            ):
                raise DatasetArchiveError("dataset manifest producer is invalid")
            companion_path = producer["companionManifest"].get("path")
            if not isinstance(companion_path, str):
                raise DatasetArchiveError(
                    "dataset manifest companion-manifest path is invalid"
                )
            members.add(companion_path)
        frames = session.get("frames")
        if not isinstance(frames, list):
            raise DatasetArchiveError("dataset manifest frames must be an array")
        for frame in frames:
            if not isinstance(frame, dict):
                raise DatasetArchiveError("dataset manifest frame is invalid")
            for asset_name in ("image", "label"):
                asset = frame.get(asset_name)
                if not isinstance(asset, dict) or not isinstance(
                    asset.get("path"), str
                ):
                    raise DatasetArchiveError(
                        f"dataset manifest {asset_name} path is invalid"
                    )
                members.add(asset["path"])
    return members


def _walk_regular_files(root: Path) -> set[str]:
    files: set[str] = set()
    for directory, directory_names, file_names in os.walk(root, followlinks=False):
        directory_path = Path(directory)
        for name in directory_names:
            candidate = directory_path / name
            if candidate.is_symlink():
                raise DatasetArchiveError(f"dataset contains symlink: {candidate}")
        for name in file_names:
            candidate = directory_path / name
            if candidate.is_symlink():
                raise DatasetArchiveError(f"dataset contains symlink: {candidate}")
            if not candidate.is_file():
                raise DatasetArchiveError(
                    f"dataset contains a non-regular asset: {candidate}"
                )
            files.add(_safe_relative(candidate, root, "dataset asset"))
    return files


def _check_output(path: Path, root: Path, description: str) -> Path:
    path = Path(path)
    if path.exists() or path.is_symlink():
        raise DatasetArchiveError(f"{description} must not already exist")
    if path.parent.is_symlink() or not path.parent.is_dir():
        raise DatasetArchiveError(
            f"{description} parent must be an existing non-symlink directory"
        )
    resolved = path.resolve(strict=False)
    if resolved == root or root in resolved.parents:
        raise DatasetArchiveError(f"{description} must be outside dataset root")
    return resolved


def _write_deterministic_tar(output_path: Path, root: Path, members: list[str]) -> None:
    with tarfile.open(output_path, "w", format=tarfile.USTAR_FORMAT) as archive:
        for name in members:
            path = root.joinpath(*PurePosixPath(name).parts)
            content = path.read_bytes()
            information = tarfile.TarInfo(name=name)
            information.size = len(content)
            information.mode = 0o600
            information.uid = 0
            information.gid = 0
            information.uname = ""
            information.gname = ""
            information.mtime = 0
            archive.addfile(information, io.BytesIO(content))


def _publish_exclusive(temporary: Path, destination: Path) -> None:
    try:
        os.link(temporary, destination)
    except FileExistsError as error:
        raise DatasetArchiveError(
            f"refusing to overwrite concurrently created output: {destination}"
        ) from error
    temporary.unlink()


def _reextract_and_validate(
    archive_path: Path,
    members: list[str],
    member_receipts: dict[str, dict[str, Any]],
    manifest_name: str,
    expected_dataset_receipt: dict[str, Any],
) -> None:
    with tempfile.TemporaryDirectory(
        prefix="commandcanvas-dataset-recheck-"
    ) as temporary:
        extracted_root = Path(temporary)
        with tarfile.open(archive_path, "r:") as archive:
            archived_members = archive.getmembers()
            archived_names = [member.name for member in archived_members]
            if archived_names != members:
                raise DatasetArchiveError(
                    "archive members are not the validated sorted set"
                )
            for member in archived_members:
                if (
                    not member.isfile()
                    or member.uid != 0
                    or member.gid != 0
                    or member.uname != ""
                    or member.gname != ""
                    or member.mtime != 0
                    or member.mode != 0o600
                ):
                    raise DatasetArchiveError(
                        "archive member metadata is not deterministic"
                    )
                pure = PurePosixPath(member.name)
                if pure.is_absolute() or any(
                    part in {"", ".", ".."} for part in pure.parts
                ):
                    raise DatasetArchiveError("archive contains an unsafe path")
                handle = archive.extractfile(member)
                if handle is None:
                    raise DatasetArchiveError("archive member bytes could not be read")
                content = handle.read()
                receipt = member_receipts[member.name]
                if len(content) != receipt["byteSize"]:
                    raise DatasetArchiveError("archive member byte size changed")
                destination = extracted_root.joinpath(*pure.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)
                if sha256_file(destination) != receipt["sha256"]:
                    raise DatasetArchiveError("archive member SHA-256 changed")
        try:
            extracted_receipt = validate_dataset(
                extracted_root,
                extracted_root.joinpath(*PurePosixPath(manifest_name).parts),
            )
        except DatasetValidationError as error:
            raise DatasetArchiveError(
                f"re-extracted dataset failed validation: {error}"
            ) from error
        if extracted_receipt != expected_dataset_receipt:
            raise DatasetArchiveError(
                "re-extracted dataset receipt does not match the source receipt"
            )


def archive_dataset(
    *,
    dataset_root: Path,
    manifest_path: Path,
    dataset_receipt_path: Path,
    output_path: Path,
    archive_receipt_path: Path,
) -> dict[str, Any]:
    """Archive exactly the validated assets and prove the archive revalidates."""

    dataset_root = Path(dataset_root)
    if dataset_root.is_symlink() or not dataset_root.is_dir():
        raise DatasetArchiveError(
            "dataset root must be an existing non-symlink directory"
        )
    root = dataset_root.resolve(strict=True)
    manifest_name = _safe_relative(Path(manifest_path), root, "dataset manifest")
    receipt_name = _safe_relative(Path(dataset_receipt_path), root, "dataset receipt")
    manifest = _load_strict_json(Path(manifest_path), "dataset manifest")
    supplied_receipt = _load_strict_json(Path(dataset_receipt_path), "dataset receipt")
    try:
        current_receipt = validate_dataset(root, Path(manifest_path))
    except DatasetValidationError as error:
        raise DatasetArchiveError(str(error)) from error
    if supplied_receipt != current_receipt:
        raise DatasetArchiveError(
            "dataset receipt does not match current validated dataset bytes"
        )

    allowed = _manifest_members(manifest) | {manifest_name, receipt_name}
    actual = _walk_regular_files(root)
    extras = actual - allowed
    missing = allowed - actual
    if extras:
        raise DatasetArchiveError(
            f"dataset contains unvalidated asset: {', '.join(sorted(extras))}"
        )
    if missing:
        raise DatasetArchiveError(
            f"dataset is missing validated asset: {', '.join(sorted(missing))}"
        )

    archive_destination = _check_output(output_path, root, "archive output")
    receipt_destination = _check_output(archive_receipt_path, root, "archive receipt")
    if archive_destination == receipt_destination:
        raise DatasetArchiveError("archive output and receipt must be different files")

    members = sorted(allowed)
    member_receipts = {
        name: {
            "byteSize": root.joinpath(*PurePosixPath(name).parts).stat().st_size,
            "sha256": sha256_file(root.joinpath(*PurePosixPath(name).parts)),
        }
        for name in members
    }
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{archive_destination.name}.", dir=archive_destination.parent
    )
    os.close(descriptor)
    temporary_archive = Path(temporary_name)
    temporary_receipt: Path | None = None
    archive_published = False
    receipt_published = False
    try:
        _write_deterministic_tar(temporary_archive, root, members)
        _reextract_and_validate(
            temporary_archive,
            members,
            member_receipts,
            manifest_name,
            current_receipt,
        )
        receipt = attach_digest(
            {
                "schemaVersion": ARCHIVE_RECEIPT_SCHEMA,
                "datasetId": current_receipt["datasetId"],
                "datasetReceiptSha256": sha256_file(Path(dataset_receipt_path)),
                "archiveSha256": sha256_file(temporary_archive),
                "archiveByteSize": temporary_archive.stat().st_size,
                "members": member_receipts,
                "revalidatedAfterExtraction": True,
            },
            "receiptSha256",
        )
        receipt_descriptor, receipt_name_temp = tempfile.mkstemp(
            prefix=f".{receipt_destination.name}.", dir=receipt_destination.parent
        )
        os.close(receipt_descriptor)
        temporary_receipt = Path(receipt_name_temp)
        write_canonical_json(temporary_receipt, receipt)
        _publish_exclusive(temporary_archive, archive_destination)
        archive_published = True
        _publish_exclusive(temporary_receipt, receipt_destination)
        receipt_published = True
        return receipt
    except Exception:
        if archive_published:
            archive_destination.unlink(missing_ok=True)
        if receipt_published:
            receipt_destination.unlink(missing_ok=True)
        raise
    finally:
        temporary_archive.unlink(missing_ok=True)
        if temporary_receipt is not None:
            temporary_receipt.unlink(missing_ok=True)
