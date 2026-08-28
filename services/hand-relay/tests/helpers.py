from __future__ import annotations

import base64
import hashlib
import hmac
import json
from dataclasses import dataclass
from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image


PROTOCOL = "commandcanvas.private-hand-relay.v1"
ROOM_ID = "0046b81b-5406-4416-8574-8a144647dd7e"
ACTOR_ID = "9d7c0e38-3a57-47c7-a771-1b77fd24d02b"
SESSION_ID = "8eca1fa5-42a7-4796-99bc-0be1a4bb4c8f"
JTI = "1e8d73e2-f861-4fc6-bd07-402541a48f40"
SIGNING_KEY = bytes(range(32))


def b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def make_token(
    *,
    key: bytes = SIGNING_KEY,
    now_seconds: int = 1_800_000_000,
    ttl_seconds: int = 60,
    overrides: dict[str, Any] | None = None,
) -> str:
    claims: dict[str, Any] = {
        "version": 1,
        "issuer": "commandcanvas",
        "audience": "commandcanvas-private-hand-relay",
        "roomId": ROOM_ID,
        "actorUserId": ACTOR_ID,
        "sessionId": SESSION_ID,
        "jti": JTI,
        "issuedAt": now_seconds,
        "expiresAt": now_seconds + ttl_seconds,
    }
    claims.update(overrides or {})
    payload = b64url(
        json.dumps(claims, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    )
    signed = f"ccr1.{payload}"
    signature = b64url(hmac.new(key, signed.encode("utf-8"), hashlib.sha256).digest())
    return f"{signed}.{signature}"


def image_bytes(
    *,
    image_format: str = "JPEG",
    width: int = 96,
    height: int = 72,
) -> bytes:
    image = Image.new("RGB", (width, height), (40, 80, 120))
    output = BytesIO()
    image.save(output, format=image_format)
    return output.getvalue()


def hand(confidence: float = 0.9) -> dict[str, Any]:
    return {
        "confidence": confidence,
        "handedness": "unknown",
        "landmarks": [
            {
                "x": round(index / 20, 6),
                "y": 0.5,
                "z": 0.0,
                "visibility": 0.95,
            }
            for index in range(21)
        ],
    }


@dataclass
class FakeBackend:
    ready: bool = True
    warm: bool = True
    unavailable_reason: str | None = None
    device: str = "NVIDIA GeForce RTX 3090 (CUDA device 0)"

    def __post_init__(self) -> None:
        self.calls: list[np.ndarray] = []
        self.results = [hand()]

    def capability(self) -> dict[str, Any]:
        value: dict[str, Any] = {
            "ok": True,
            "protocol": PROTOCOL,
            "service": "commandcanvas-private-hand-relay",
            "ready": self.ready,
            "warm": self.warm,
            "model": {
                "id": "poptoz/yolo26-hand-pose-face-detection",
                "revision": "2abb91a7030e1aa5231ec900ccb2c07ab3f03460",
                "format": "onnx",
                "keypoints": 21,
                "license": "AGPL-3.0",
            },
            "runtime": {
                "provider": "cuda",
                "device": self.device,
                "precision": "fp16",
            },
            "limits": {
                "maxFrameBytes": 262_144,
                "maxFps": 30,
                "maxWidth": 1280,
                "maxHeight": 720,
                "maxInFlight": 1,
                "newestFrameOnly": True,
            },
            "privacy": {
                "rawFramesPersisted": False,
                "semanticResultsOnly": True,
                "maxRetentionSeconds": 0,
            },
        }
        if self.unavailable_reason:
            value["unavailableReason"] = self.unavailable_reason
        return value

    def infer(self, tensor: np.ndarray, _transform: object) -> list[dict[str, Any]]:
        self.calls.append(tensor)
        return self.results
