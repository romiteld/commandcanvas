#!/usr/bin/env python3
"""Refuse tracked private capture, model, archive, and oversized training artifacts."""

from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path, PurePosixPath
from typing import Iterable, Sequence


MAX_TRACKED_BYTES = 1_048_576
PRIVATE_CAPTURE_PREFIX = PurePosixPath("private/vision-lab")
TRAINING_PREFIX = PurePosixPath("scripts/hand-finetune/v1")
PRIVATE_TRAINING_PREFIXES = tuple(
    TRAINING_PREFIX / directory
    for directory in (
        "captures",
        "datasets",
        "models",
        "outputs",
        "runs",
        "archives",
    )
)
FORBIDDEN_SUFFIXES = (
    ".webm",
    ".mp4",
    ".mov",
    ".avi",
    ".mkv",
    ".pt",
    ".pth",
    ".onnx",
    ".engine",
    ".plan",
    ".trt",
    ".tar",
    ".tar.gz",
    ".tgz",
    ".zip",
    ".7z",
)
SECRET_PATTERNS = (
    re.compile(rb"-----BEGIN (?:OPENSSH|RSA|EC|DSA) PRIVATE KEY-----"),
    re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b"),
    re.compile(rb"\brpa_[A-Za-z0-9]{20,}\b"),
    re.compile(rb"\bre_[A-Za-z0-9_-]{20,}\b"),
    re.compile(rb"\bsb_secret_[A-Za-z0-9_-]{20,}\b"),
    re.compile(rb"\bhf_[A-Za-z0-9]{20,}\b"),
)


class ArtifactGuardError(RuntimeError):
    """Raised when tracked repository content crosses the privacy boundary."""


def _is_within(path: PurePosixPath, prefix: PurePosixPath) -> bool:
    return path == prefix or prefix in path.parents


def _normalize_relative_path(raw_path: str) -> PurePosixPath:
    path = PurePosixPath(raw_path)
    if path.is_absolute() or ".." in path.parts or not path.parts:
        raise ArtifactGuardError(f"unsafe tracked path: {raw_path}")
    return path


def validate_tracked_artifacts(
    repository_root: Path,
    tracked_paths: Iterable[str],
) -> None:
    root = repository_root.resolve(strict=True)
    violations: list[str] = []
    for raw_path in sorted(set(tracked_paths)):
        relative = _normalize_relative_path(raw_path)
        if not (
            _is_within(relative, PRIVATE_CAPTURE_PREFIX)
            or _is_within(relative, TRAINING_PREFIX)
        ):
            continue
        path = root.joinpath(*relative.parts)
        if path.is_symlink() or not path.is_file():
            violations.append(f"{relative.as_posix()} is not a regular file")
            continue
        lowered = relative.as_posix().lower()
        if _is_within(relative, PRIVATE_CAPTURE_PREFIX):
            violations.append(
                f"{relative.as_posix()} is private Vision Lab material and cannot be tracked"
            )
        if any(_is_within(relative, prefix) for prefix in PRIVATE_TRAINING_PREFIXES):
            violations.append(
                f"{relative.as_posix()} is a private training artifact and cannot be tracked"
            )
        if any(lowered.endswith(suffix) for suffix in FORBIDDEN_SUFFIXES):
            violations.append(
                f"{relative.as_posix()} is a forbidden tracked media, model, or archive artifact"
            )
        size = path.stat().st_size
        if size > MAX_TRACKED_BYTES:
            violations.append(
                f"{relative.as_posix()} exceeds {MAX_TRACKED_BYTES} bytes ({size})"
            )
        if size <= MAX_TRACKED_BYTES:
            contents = path.read_bytes()
            if any(pattern.search(contents) for pattern in SECRET_PATTERNS):
                violations.append(
                    f"{relative.as_posix()} contains private-key or provider-secret material"
                )
    if violations:
        raise ArtifactGuardError("\n".join(violations))


def _git_tracked_paths(repository_root: Path) -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=repository_root,
        check=True,
        capture_output=True,
    )
    return [item.decode("utf-8") for item in result.stdout.split(b"\0") if item]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository-root", type=Path, default=Path.cwd())
    arguments = parser.parse_args(argv)
    validate_tracked_artifacts(
        arguments.repository_root,
        _git_tracked_paths(arguments.repository_root),
    )
    print("tracked hand-capture/training artifact guard passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
