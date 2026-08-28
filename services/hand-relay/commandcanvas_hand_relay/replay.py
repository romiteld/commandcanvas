from __future__ import annotations

import asyncio


class OneUseReplayCache:
    """In-memory, TTL-bounded one-use cache for short-lived relay JTIs."""

    def __init__(self, *, max_entries: int = 4096):
        if max_entries < 1:
            raise ValueError("Replay cache capacity must be positive.")
        self._max_entries = max_entries
        self._entries: dict[str, int] = {}
        self._lock = asyncio.Lock()

    async def consume(
        self,
        jti: str,
        *,
        expires_at: int,
        now_seconds: int,
    ) -> bool:
        async with self._lock:
            self._entries = {
                key: expiry
                for key, expiry in self._entries.items()
                if expiry > now_seconds
            }
            if expires_at <= now_seconds or jti in self._entries:
                return False
            if len(self._entries) >= self._max_entries:
                return False
            self._entries[jti] = expires_at
            return True
