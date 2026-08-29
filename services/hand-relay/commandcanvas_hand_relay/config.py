from __future__ import annotations

import base64
import os
import re
from dataclasses import dataclass, field
from typing import Mapping
from urllib.parse import urlsplit

from .model_manifest import (
    PRODUCTION_MODEL_MANIFEST,
    ModelManifest,
    model_manifest,
)


BASE64URL = re.compile(r"^[A-Za-z0-9_-]+$")


class SettingsError(ValueError):
    pass


@dataclass(frozen=True)
class RelaySettings:
    signing_key: bytes = field(repr=False)
    allowed_origins: frozenset[str]
    model_path: str
    model_manifest: ModelManifest = PRODUCTION_MODEL_MANIFEST
    bind_host: str = "127.0.0.1"
    bind_port: int = 8100
    max_frame_bytes: int = 262_144
    max_fps: int = 30
    max_width: int = 1280
    max_height: int = 720
    max_connections: int = 4
    max_handshakes: int = 8
    gpu_mem_limit_bytes: int = 805_306_368
    handshake_timeout_seconds: int | float = 5
    frame_idle_timeout_seconds: int | float = 5
    authenticated_session_timeout_seconds: int | float = 1_800
    inference_timeout_seconds: int | float = 2

    @property
    def model_variant(self) -> str:
        return self.model_manifest.variant


def load_settings(environment: Mapping[str, str] | None = None) -> RelaySettings:
    env = environment if environment is not None else os.environ
    signing_key = _signing_key(env.get("PRIVATE_HAND_RELAY_SIGNING_KEY", ""))
    origins_value = env.get("PRIVATE_HAND_RELAY_ALLOWED_ORIGINS", "")
    origins = frozenset(
        _exact_origin(item.strip()) for item in origins_value.split(",") if item.strip()
    )
    if not origins:
        raise SettingsError("Private relay origin allowlist is required.")
    model_path = env.get("PRIVATE_HAND_RELAY_MODEL_PATH", "").strip()
    if not model_path:
        raise SettingsError("Private relay model path is required.")
    try:
        selected_manifest = model_manifest(
            env.get(
                "PRIVATE_HAND_RELAY_MODEL_VARIANT",
                PRODUCTION_MODEL_MANIFEST.variant,
            ).strip()
        )
    except ValueError as error:
        raise SettingsError(str(error)) from None
    max_connections = _integer(env, "PRIVATE_HAND_RELAY_MAX_CONNECTIONS", 4, 1, 32)
    max_handshakes = _integer(env, "PRIVATE_HAND_RELAY_MAX_HANDSHAKES", 8, 1, 32)
    if max_handshakes < max_connections:
        raise SettingsError(
            "PRIVATE_HAND_RELAY_MAX_HANDSHAKES must be at least MAX_CONNECTIONS."
        )
    return RelaySettings(
        signing_key=signing_key,
        allowed_origins=origins,
        model_path=model_path,
        model_manifest=selected_manifest,
        bind_host=env.get("PRIVATE_HAND_RELAY_BIND_HOST", "127.0.0.1").strip()
        or "127.0.0.1",
        bind_port=_integer(env, "PRIVATE_HAND_RELAY_BIND_PORT", 8100, 1, 65535),
        max_frame_bytes=_integer(
            env,
            "PRIVATE_HAND_RELAY_MAX_FRAME_BYTES",
            262_144,
            16_384,
            1_048_576,
        ),
        max_fps=_integer(env, "PRIVATE_HAND_RELAY_MAX_FPS", 30, 1, 30),
        max_width=_integer(env, "PRIVATE_HAND_RELAY_MAX_WIDTH", 1280, 160, 1280),
        max_height=_integer(env, "PRIVATE_HAND_RELAY_MAX_HEIGHT", 720, 120, 720),
        max_connections=max_connections,
        max_handshakes=max_handshakes,
        gpu_mem_limit_bytes=_integer(
            env,
            "PRIVATE_HAND_RELAY_GPU_MEM_LIMIT_BYTES",
            805_306_368,
            268_435_456,
            2_147_483_648,
        ),
        handshake_timeout_seconds=_integer(
            env,
            "PRIVATE_HAND_RELAY_HANDSHAKE_TIMEOUT_SECONDS",
            5,
            1,
            30,
        ),
        frame_idle_timeout_seconds=_integer(
            env,
            "PRIVATE_HAND_RELAY_FRAME_IDLE_TIMEOUT_SECONDS",
            5,
            1,
            30,
        ),
        authenticated_session_timeout_seconds=_integer(
            env,
            "PRIVATE_HAND_RELAY_AUTHENTICATED_SESSION_TIMEOUT_SECONDS",
            1_800,
            60,
            7_200,
        ),
        inference_timeout_seconds=_integer(
            env,
            "PRIVATE_HAND_RELAY_INFERENCE_TIMEOUT_SECONDS",
            2,
            1,
            10,
        ),
    )


def _signing_key(encoded: str) -> bytes:
    if not encoded or not BASE64URL.fullmatch(encoded):
        raise SettingsError("Private relay signing key is invalid.")
    try:
        padding = "=" * ((4 - len(encoded) % 4) % 4)
        value = base64.b64decode(encoded + padding, altchars=b"-_", validate=True)
    except ValueError:
        raise SettingsError("Private relay signing key is invalid.") from None
    if len(value) != 32:
        raise SettingsError(
            "Private relay signing key must decode to exactly 32 bytes."
        )
    return value


def _exact_origin(value: str) -> str:
    if value == "*" or "*" in value:
        raise SettingsError("Private relay origin wildcards are forbidden.")
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"https", "http"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise SettingsError("Private relay origin must be an exact web origin.")
    if parsed.scheme == "http" and parsed.hostname not in {
        "localhost",
        "127.0.0.1",
        "::1",
    }:
        raise SettingsError("Private relay remote origins require HTTPS.")
    if value != f"{parsed.scheme}://{parsed.netloc}":
        raise SettingsError("Private relay origin must be canonical and exact.")
    return value


def _integer(
    env: Mapping[str, str],
    name: str,
    default: int,
    minimum: int,
    maximum: int,
) -> int:
    raw = env.get(name)
    try:
        value = default if raw is None else int(raw)
    except ValueError:
        raise SettingsError(f"{name} must be an integer.") from None
    if value < minimum or value > maximum:
        raise SettingsError(f"{name} is outside its allowed range.")
    return value
