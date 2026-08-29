from __future__ import annotations

import pytest

from helpers import ACTOR_ID, JTI, ROOM_ID, SESSION_ID, SIGNING_KEY, make_token

from commandcanvas_hand_relay.auth import TokenError, verify_capability


NOW = 1_800_000_000


def test_accepts_the_exact_typescript_v1_hmac_claims() -> None:
    claims = verify_capability(make_token(now_seconds=NOW), SIGNING_KEY, NOW)

    assert claims.room_id == ROOM_ID
    assert claims.actor_user_id == ACTOR_ID
    assert claims.session_id == SESSION_ID
    assert claims.jti == JTI
    assert claims.issued_at == NOW
    assert claims.expires_at == NOW + 60


@pytest.mark.parametrize(
    ("token", "code"),
    [
        (make_token(now_seconds=NOW) + "x", "invalid_token"),
        (make_token(key=b"x" * 32, now_seconds=NOW), "invalid_token"),
        (make_token(now_seconds=NOW - 60, ttl_seconds=60), "expired_token"),
        (
            make_token(now_seconds=NOW, overrides={"issuer": "somewhere-else"}),
            "invalid_token",
        ),
        (
            make_token(now_seconds=NOW, overrides={"audience": "another-service"}),
            "invalid_token",
        ),
        (
            make_token(now_seconds=NOW, overrides={"roomId": "not-a-uuid"}),
            "invalid_token",
        ),
        (
            make_token(now_seconds=NOW, overrides={"sessionId": "not-a-uuid"}),
            "invalid_token",
        ),
        (make_token(now_seconds=NOW + 31), "not_yet_valid"),
        (make_token(now_seconds=NOW, ttl_seconds=121), "invalid_token"),
    ],
)
def test_rejects_tampered_expired_or_misbound_capabilities(
    token: str, code: str
) -> None:
    with pytest.raises(TokenError) as caught:
        verify_capability(token, SIGNING_KEY, NOW)

    assert caught.value.code == code


def test_requires_an_exact_32_byte_signing_key() -> None:
    with pytest.raises(ValueError, match="exactly 32 bytes"):
        verify_capability(make_token(now_seconds=NOW), b"short", NOW)
