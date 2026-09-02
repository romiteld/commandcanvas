"""Deterministic JSON and hashing helpers used by every training receipt."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from pathlib import Path
from typing import Any


def canonical_json_bytes(value: Any) -> bytes:
    """Return one portable JSON representation and reject non-finite numbers."""

    return (
        json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n"
    ).encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def attach_digest(value: dict[str, Any], field: str) -> dict[str, Any]:
    """Return a copy with a digest over the canonical object excluding that digest."""

    unsigned = {key: item for key, item in value.items() if key != field}
    result = dict(unsigned)
    result[field] = sha256_bytes(canonical_json_bytes(unsigned))
    return result


def verify_digest(value: dict[str, Any], field: str) -> bool:
    expected = value.get(field)
    if not isinstance(expected, str):
        return False
    unsigned = {key: item for key, item in value.items() if key != field}
    return expected == sha256_bytes(canonical_json_bytes(unsigned))


def write_canonical_json(path: Path, value: Any) -> None:
    """Atomically write canonical JSON without following a destination symlink."""

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError(f"refusing to overwrite symlink: {path}")
    descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", dir=path.parent
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(canonical_json_bytes(value))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
    finally:
        temporary_path.unlink(missing_ok=True)
