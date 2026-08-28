from __future__ import annotations

import asyncio

from commandcanvas_hand_relay.replay import OneUseReplayCache


def test_consumes_each_jti_once_until_its_expiry() -> None:
    cache = OneUseReplayCache(max_entries=8)

    async def scenario() -> None:
        assert await cache.consume("one", expires_at=120, now_seconds=100) is True
        assert await cache.consume("one", expires_at=120, now_seconds=101) is False
        assert await cache.consume("one", expires_at=121, now_seconds=120) is True

    asyncio.run(scenario())


def test_refuses_expired_entries_and_stays_bounded() -> None:
    cache = OneUseReplayCache(max_entries=2)

    async def scenario() -> None:
        assert await cache.consume("expired", expires_at=100, now_seconds=100) is False
        assert await cache.consume("one", expires_at=200, now_seconds=100) is True
        assert await cache.consume("two", expires_at=200, now_seconds=100) is True
        assert await cache.consume("three", expires_at=200, now_seconds=100) is False

    asyncio.run(scenario())
