from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID


TOKEN_PREFIX = "ccr1"
TOKEN_ISSUER = "commandcanvas"
TOKEN_AUDIENCE = "commandcanvas-private-hand-relay"
MAX_TOKEN_BYTES = 4_096
MIN_TTL_SECONDS = 15
MAX_TTL_SECONDS = 120
BASE64URL = re.compile(r"^[A-Za-z0-9_-]+$")
CLAIM_KEYS = {
    "version",
    "issuer",
    "audience",
    "roomId",
    "actorUserId",
    "sessionId",
    "jti",
    "issuedAt",
    "expiresAt",
}


@dataclass(frozen=True)
class CapabilityClaims:
    room_id: str
    actor_user_id: str
    session_id: str
    jti: str
    issued_at: int
    expires_at: int


class TokenError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def verify_capability(
    token: str,
    signing_key: bytes,
    now_seconds: int,
) -> CapabilityClaims:
    """Verify the exact token emitted by private-hand-relay-token.ts.

    Exceptions intentionally contain only a compact error code. The presented
    token and its claims are never copied into logs or exception messages.
    """

    if len(signing_key) != 32:
        raise ValueError("Private relay signing keys must contain exactly 32 bytes.")
    if type(now_seconds) is not int:  # bool is not accepted as an integer clock.
        raise TokenError("invalid_token")
    if not isinstance(token, str) or len(token.encode("utf-8")) > MAX_TOKEN_BYTES:
        raise TokenError("invalid_token")

    parts = token.split(".")
    if (
        len(parts) != 3
        or parts[0] != TOKEN_PREFIX
        or not BASE64URL.fullmatch(parts[1])
        or not BASE64URL.fullmatch(parts[2])
    ):
        raise TokenError("invalid_token")
    signed = f"{TOKEN_PREFIX}.{parts[1]}".encode("utf-8")
    expected = hmac.new(signing_key, signed, hashlib.sha256).digest()
    try:
        presented = _decode_base64url(parts[2])
    except (ValueError, UnicodeError):
        raise TokenError("invalid_token") from None
    if not hmac.compare_digest(presented, expected):
        raise TokenError("invalid_token")

    try:
        payload = _decode_base64url(parts[1])
        claims = json.loads(payload.decode("utf-8"), object_pairs_hook=_strict_object)
    except (ValueError, UnicodeError, json.JSONDecodeError):
        raise TokenError("invalid_token") from None
    if not isinstance(claims, dict) or set(claims) != CLAIM_KEYS:
        raise TokenError("invalid_token")
    if (
        claims["version"] != 1
        or type(claims["version"]) is not int
        or claims["issuer"] != TOKEN_ISSUER
        or claims["audience"] != TOKEN_AUDIENCE
    ):
        raise TokenError("invalid_token")
    for key in ("roomId", "actorUserId", "sessionId", "jti"):
        if not _canonical_uuid(claims[key]):
            raise TokenError("invalid_token")
    issued_at = claims["issuedAt"]
    expires_at = claims["expiresAt"]
    if (
        type(issued_at) is not int
        or type(expires_at) is not int
        or issued_at < 0
        or expires_at <= 0
        or not MIN_TTL_SECONDS <= expires_at - issued_at <= MAX_TTL_SECONDS
    ):
        raise TokenError("invalid_token")
    if now_seconds >= expires_at:
        raise TokenError("expired_token")
    if now_seconds + 30 < issued_at:
        raise TokenError("not_yet_valid")
    return CapabilityClaims(
        room_id=claims["roomId"],
        actor_user_id=claims["actorUserId"],
        session_id=claims["sessionId"],
        jti=claims["jti"],
        issued_at=issued_at,
        expires_at=expires_at,
    )


def _decode_base64url(value: str) -> bytes:
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.b64decode(value + padding, altchars=b"-_", validate=True)


def _canonical_uuid(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return str(UUID(value)) == value
    except ValueError:
        return False


def _strict_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate JSON key")
        value[key] = item
    return value
