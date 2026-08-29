#!/usr/bin/env python3
"""Acquire and verify the opt-in hybrid relay models from an immutable lock.

No command runs implicitly. ``check-lock`` and ``verify`` are offline; only the
explicit ``acquire`` command opens the pinned source URLs.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
from typing import Any, Iterable
from urllib.parse import unquote, urlsplit
from urllib.request import urlopen
import zipfile


SERVICE_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCK_PATH = SERVICE_ROOT / "models" / "hybrid-models.lock.json"
DEFAULT_MODEL_DIR = SERVICE_ROOT / "models"
SHA256 = re.compile(r"^[0-9a-f]{64}$")
REVISION = re.compile(r"^[0-9a-f]{40}$")
ARTIFACT_NAME = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
BUFFER_BYTES = 1024 * 1024


class ArtifactError(ValueError):
    """A lock, source, or output failed its immutable contract."""


@dataclass(frozen=True)
class Artifact:
    name: str
    role: str
    repository: str
    revision: str
    source_url: str
    source_filename: str
    source_byte_size: int
    source_sha256: str
    format: str
    output_filename: str
    output_byte_size: int
    output_sha256: str
    license: str
    archive_member: str | None = None


@dataclass(frozen=True)
class ModelLock:
    backend: str
    artifacts: tuple[Artifact, ...]


COMMON_FIELDS = frozenset(
    {
        "role",
        "repository",
        "revision",
        "source_url",
        "source_filename",
        "source_byte_size",
        "source_sha256",
        "format",
        "output_filename",
        "output_byte_size",
        "output_sha256",
        "license",
    }
)


def _object_without_duplicate_keys(pairs: Iterable[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ArtifactError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def _plain_filename(value: Any, field: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or value in {".", ".."}
        or "/" in value
        or "\\" in value
        or Path(value).name != value
    ):
        raise ArtifactError(f"{field} must be a plain filename")
    return value


def _positive_integer(value: Any, field: str) -> int:
    if type(value) is not int or value <= 0:
        raise ArtifactError(f"{field} must be a positive integer")
    return value


def _digest(value: Any, field: str) -> str:
    if not isinstance(value, str) or SHA256.fullmatch(value) is None:
        raise ArtifactError(f"{field} must be a lowercase SHA-256 digest")
    return value


def _required_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip() or value != value.strip():
        raise ArtifactError(f"{field} must be a non-empty canonical string")
    return value


def _source_url(value: Any, source_filename: str) -> str:
    value = _required_string(value, "source_url")
    parsed = urlsplit(value)
    if parsed.scheme not in {"https", "file"}:
        raise ArtifactError("source_url must use https or file")
    if parsed.username is not None or parsed.password is not None or parsed.fragment:
        raise ArtifactError("source_url must not contain credentials or a fragment")
    if parsed.scheme == "https" and not parsed.hostname:
        raise ArtifactError("HTTPS source_url must include a host")
    if parsed.scheme == "file" and parsed.netloc not in {"", "localhost"}:
        raise ArtifactError("file source_url must be local")
    if PurePosixPath(unquote(parsed.path)).name != source_filename:
        raise ArtifactError("source_url filename does not match source_filename")
    return value


def _archive_member(value: Any) -> str:
    value = _required_string(value, "archive_member")
    path = PurePosixPath(value)
    if (
        path.is_absolute()
        or "\\" in value
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise ArtifactError("archive_member must be a safe relative path")
    return value


def _artifact(name: Any, value: Any) -> Artifact:
    if not isinstance(name, str) or ARTIFACT_NAME.fullmatch(name) is None:
        raise ArtifactError("artifact names must be lowercase identifiers")
    if not isinstance(value, dict):
        raise ArtifactError(f"artifact {name} must be an object")
    format_value = value.get("format")
    expected_fields = (
        COMMON_FIELDS | {"archive_member"}
        if format_value == "zip_member"
        else COMMON_FIELDS
    )
    actual_fields = frozenset(value)
    if actual_fields != expected_fields:
        missing = sorted(expected_fields - actual_fields)
        extra = sorted(actual_fields - expected_fields)
        raise ArtifactError(
            f"artifact {name} fields do not match schema; "
            f"missing={missing}, extra={extra}"
        )
    if format_value not in {"file", "zip_member"}:
        raise ArtifactError(f"artifact {name} format is not supported")

    role = _required_string(value["role"], "role")
    if role not in {"detector", "pose_refiner"}:
        raise ArtifactError(f"artifact {name} role is not supported")
    repository = _required_string(value["repository"], "repository")
    if repository.count("/") != 1:
        raise ArtifactError(f"artifact {name} repository must be owner/name")
    revision = _required_string(value["revision"], "revision")
    if REVISION.fullmatch(revision) is None:
        raise ArtifactError(f"artifact {name} revision must be a 40-character commit")
    source_filename = _plain_filename(value["source_filename"], "source_filename")
    license_value = _required_string(value["license"], "license")
    if license_value != "Apache-2.0":
        raise ArtifactError(f"artifact {name} license must be Apache-2.0")

    return Artifact(
        name=name,
        role=role,
        repository=repository,
        revision=revision,
        source_url=_source_url(value["source_url"], source_filename),
        source_filename=source_filename,
        source_byte_size=_positive_integer(
            value["source_byte_size"], "source_byte_size"
        ),
        source_sha256=_digest(value["source_sha256"], "source_sha256"),
        format=format_value,
        archive_member=(
            _archive_member(value["archive_member"])
            if format_value == "zip_member"
            else None
        ),
        output_filename=_plain_filename(value["output_filename"], "output_filename"),
        output_byte_size=_positive_integer(
            value["output_byte_size"], "output_byte_size"
        ),
        output_sha256=_digest(value["output_sha256"], "output_sha256"),
        license=license_value,
    )


def load_lock(path: Path) -> ModelLock:
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = json.load(handle, object_pairs_hook=_object_without_duplicate_keys)
    except FileNotFoundError:
        raise ArtifactError(f"lock file missing: {path}") from None
    except json.JSONDecodeError as error:
        raise ArtifactError(f"lock file is not valid JSON: {error.msg}") from None
    if not isinstance(value, dict) or frozenset(value) != {
        "schema_version",
        "backend",
        "artifacts",
    }:
        raise ArtifactError("lock top-level fields do not match schema")
    if type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise ArtifactError("lock schema_version must be 1")
    if value["backend"] != "hybrid_rtmpose":
        raise ArtifactError("lock backend must be hybrid_rtmpose")
    if not isinstance(value["artifacts"], dict) or not value["artifacts"]:
        raise ArtifactError("lock artifacts must be a non-empty object")

    artifacts = tuple(
        _artifact(name, artifact) for name, artifact in value["artifacts"].items()
    )
    output_names = [artifact.output_filename for artifact in artifacts]
    if len(set(output_names)) != len(output_names):
        raise ArtifactError("lock output filenames must be unique")
    return ModelLock(backend=value["backend"], artifacts=artifacts)


def _hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(BUFFER_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_file(path: Path, size: int, sha256: str, label: str) -> None:
    if not path.exists():
        raise ArtifactError(f"missing artifact: {label}")
    if not path.is_file() or path.is_symlink():
        raise ArtifactError(f"artifact must be a regular file: {label}")
    actual_size = path.stat().st_size
    if actual_size != size:
        raise ArtifactError(
            f"byte-size mismatch for {label}: expected {size}, got {actual_size}"
        )
    actual_sha256 = _hash(path)
    if actual_sha256 != sha256:
        raise ArtifactError(
            f"SHA-256 mismatch for {label}: expected {sha256}, got {actual_sha256}"
        )


def verify(lock: ModelLock, model_dir: Path) -> None:
    for artifact in lock.artifacts:
        _verify_file(
            model_dir / artifact.output_filename,
            artifact.output_byte_size,
            artifact.output_sha256,
            artifact.output_filename,
        )


def _download(artifact: Artifact, destination: Path) -> None:
    try:
        with urlopen(artifact.source_url, timeout=60) as response:
            with destination.open("xb") as output:
                total = 0
                while chunk := response.read(BUFFER_BYTES):
                    total += len(chunk)
                    if total > artifact.source_byte_size:
                        raise ArtifactError(
                            f"byte-size mismatch for source {artifact.source_filename}: "
                            f"expected {artifact.source_byte_size}, got more"
                        )
                    output.write(chunk)
    except ArtifactError:
        raise
    except (OSError, ValueError) as error:
        raise ArtifactError(
            f"could not acquire source {artifact.source_filename}: {error}"
        ) from None
    _verify_file(
        destination,
        artifact.source_byte_size,
        artifact.source_sha256,
        f"source {artifact.source_filename}",
    )


def _copy_direct(source: Path, destination: Path) -> None:
    with source.open("rb") as input_file, destination.open("xb") as output_file:
        shutil.copyfileobj(input_file, output_file, length=BUFFER_BYTES)


def _copy_archive_member(
    source: Path,
    destination: Path,
    artifact: Artifact,
) -> None:
    assert artifact.archive_member is not None
    try:
        with zipfile.ZipFile(source) as archive:
            try:
                member = archive.getinfo(artifact.archive_member)
            except KeyError:
                raise ArtifactError(
                    f"archive member missing: {artifact.archive_member}"
                ) from None
            if member.is_dir():
                raise ArtifactError(
                    f"archive member is not a file: {artifact.archive_member}"
                )
            if member.file_size != artifact.output_byte_size:
                raise ArtifactError(
                    f"byte-size mismatch for {artifact.output_filename}: "
                    f"expected {artifact.output_byte_size}, got {member.file_size}"
                )
            with (
                archive.open(member) as input_file,
                destination.open("xb") as output_file,
            ):
                shutil.copyfileobj(input_file, output_file, length=BUFFER_BYTES)
    except ArtifactError:
        raise
    except (OSError, zipfile.BadZipFile, RuntimeError) as error:
        raise ArtifactError(
            f"invalid archive {artifact.source_filename}: {error}"
        ) from None


def acquire(lock: ModelLock, model_dir: Path) -> None:
    model_dir_parent = model_dir.parent
    model_dir_parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".hybrid-models-", dir=model_dir_parent
    ) as temporary:
        staging = Path(temporary)
        staged_outputs: list[tuple[Path, Path]] = []
        for index, artifact in enumerate(lock.artifacts):
            source = staging / f"source-{index}-{artifact.source_filename}"
            output = staging / f"output-{index}-{artifact.output_filename}"
            _download(artifact, source)
            if artifact.format == "file":
                _copy_direct(source, output)
            else:
                _copy_archive_member(source, output, artifact)
            _verify_file(
                output,
                artifact.output_byte_size,
                artifact.output_sha256,
                artifact.output_filename,
            )
            staged_outputs.append((output, model_dir / artifact.output_filename))

        model_dir.mkdir(parents=True, exist_ok=True)
        for staged, destination in staged_outputs:
            os.replace(staged, destination)

    verify(lock, model_dir)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate, acquire, or verify locked hybrid relay model artifacts."
    )
    subcommands = parser.add_subparsers(dest="command", required=True)
    for name in ("check-lock", "verify", "acquire"):
        command = subcommands.add_parser(name)
        command.add_argument("--lock", type=Path, default=DEFAULT_LOCK_PATH)
        if name != "check-lock":
            command.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    return parser


def main(arguments: list[str] | None = None) -> int:
    options = _parser().parse_args(arguments)
    try:
        lock = load_lock(options.lock)
        if options.command == "check-lock":
            print(f"lock valid: {lock.backend} ({len(lock.artifacts)} artifacts)")
            return 0
        if options.command == "verify":
            verify(lock, options.model_dir)
            print(f"verified {len(lock.artifacts)} artifacts in {options.model_dir}")
            return 0
        acquire(lock, options.model_dir)
        print(
            f"acquired and verified {len(lock.artifacts)} artifacts in {options.model_dir}"
        )
        return 0
    except ArtifactError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
