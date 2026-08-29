from __future__ import annotations

import asyncio
import json
import logging
import threading
import time
from collections.abc import Callable
from contextlib import suppress
from dataclasses import replace
from typing import Any

import pytest
from fastapi import FastAPI
from starlette.websockets import WebSocketState

from helpers import PROTOCOL, SIGNING_KEY, FakeBackend, image_bytes, make_token

from commandcanvas_hand_relay import app as app_module
from commandcanvas_hand_relay.app import create_app
from commandcanvas_hand_relay.config import RelaySettings
from commandcanvas_hand_relay.inference import CudaUnavailable, ModelUnavailable


NOW = 1_800_000_000
ORIGIN = "https://commandcanvas.vercel.app"


def settings() -> RelaySettings:
    return RelaySettings(
        signing_key=SIGNING_KEY,
        allowed_origins=frozenset({ORIGIN}),
        model_path="/models/hand.onnx",
        bind_host="127.0.0.1",
        bind_port=8100,
        max_frame_bytes=262_144,
        max_fps=30,
        max_width=1280,
        max_height=720,
        max_connections=4,
        gpu_mem_limit_bytes=805_306_368,
    )


class FakeWebSocket:
    def __init__(self, messages: list[dict[str, Any]], *, origin: str = ORIGIN):
        self.headers = {"origin": origin}
        self.messages = list(messages)
        self.sent: list[dict[str, Any]] = []
        self.closed: tuple[int, str] | None = None
        self.application_state = WebSocketState.CONNECTING

    async def accept(self) -> None:
        self.application_state = WebSocketState.CONNECTED

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = (code, reason)
        self.application_state = WebSocketState.DISCONNECTED

    async def receive(self) -> dict[str, Any]:
        if self.messages:
            return self.messages.pop(0)
        return {"type": "websocket.disconnect", "code": 1000}

    async def send_json(self, value: dict[str, Any]) -> None:
        self.sent.append(value)


class HangingWebSocket(FakeWebSocket):
    def __init__(self, messages: list[dict[str, Any]], *, origin: str = ORIGIN):
        super().__init__(messages, origin=origin)
        self.waiting = asyncio.Event()

    async def receive(self) -> dict[str, Any]:
        if self.messages:
            return self.messages.pop(0)
        self.waiting.set()
        await asyncio.Event().wait()
        raise AssertionError("unreachable")


class MutableClock:
    def __init__(self, value: float):
        self.value = value
        self.sleeps: list[float] = []

    def __call__(self) -> float:
        return self.value

    async def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.value += seconds


class BlockingAcceptWebSocket(FakeWebSocket):
    def __init__(self, release: asyncio.Event):
        super().__init__([])
        self.release = release
        self.accept_started = asyncio.Event()

    async def accept(self) -> None:
        self.accept_started.set()
        await self.release.wait()
        self.application_state = WebSocketState.CONNECTED


def text_message(value: dict[str, object]) -> dict[str, object]:
    return {"type": "websocket.receive", "text": json.dumps(value)}


def binary_message(value: bytes) -> dict[str, object]:
    return {"type": "websocket.receive", "bytes": value}


def route_endpoint(app: FastAPI, path: str) -> Callable[..., Any]:
    for route in app.routes:
        if getattr(route, "path", None) == path:
            return route.endpoint
    raise AssertionError(f"route not found: {path}")


def run_socket(app: FastAPI, socket: FakeWebSocket) -> None:
    asyncio.run(route_endpoint(app, "/v1/hand-pose")(socket))


def hello(token: str | None = None) -> dict[str, object]:
    return {
        "type": "hello",
        "protocol": PROTOCOL,
        "token": token or make_token(now_seconds=NOW),
    }


def header(data: bytes, **overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "type": "frame",
        "protocol": PROTOCOL,
        "frameId": 1,
        "capturedAtMs": 1234.5,
        "mimeType": "image/jpeg",
        "byteLength": len(data),
    }
    value.update(overrides)
    return value


def test_capabilities_report_the_exact_warm_cuda_device_and_privacy_contract() -> None:
    app = create_app(
        settings=settings(), backend=FakeBackend(), now_seconds=lambda: NOW
    )

    response = asyncio.run(route_endpoint(app, "/v1/capabilities")())

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert json.loads(response.body) == FakeBackend().capability()


def test_capabilities_expose_an_honest_not_ready_state() -> None:
    backend = FakeBackend(
        ready=False,
        warm=False,
        unavailable_reason="gpu_unavailable",
        device="CUDA device unavailable",
    )
    app = create_app(settings=settings(), backend=backend, now_seconds=lambda: NOW)

    response = asyncio.run(route_endpoint(app, "/v1/capabilities")())

    assert response.status_code == 200
    payload = json.loads(response.body)
    assert payload["ready"] is False
    assert payload["warm"] is False
    assert payload["unavailableReason"] == "gpu_unavailable"


@pytest.mark.parametrize(
    ("startup_error", "expected_reason"),
    [
        (CudaUnavailable("CPU-only runtime"), "gpu_unavailable"),
        (ModelUnavailable("wrong bytes, tensors, or warmup"), "model_unavailable"),
    ],
)
def test_startup_failure_keeps_health_and_capabilities_not_ready(
    monkeypatch,
    startup_error: Exception,
    expected_reason: str,
) -> None:
    def refuse_startup(*_args: object, **_kwargs: object) -> object:
        raise startup_error

    monkeypatch.setattr(app_module.YoloCudaBackend, "load", refuse_startup)
    app = create_app(
        settings=settings(),
        now_seconds=lambda: NOW,
        restart_process=lambda: None,
    )

    async def exercise_startup() -> tuple[dict[str, Any], dict[str, Any]]:
        async with app.router.lifespan_context(app):
            health = await route_endpoint(app, "/healthz")()
            capability = await route_endpoint(app, "/v1/capabilities")()
            return json.loads(health.body), json.loads(capability.body)

    health, capability = asyncio.run(exercise_startup())

    assert health == {
        "ok": False,
        "service": "commandcanvas-private-hand-relay",
        "ready": False,
        "reason": expected_reason,
    }
    assert capability["ready"] is False
    assert capability["warm"] is False
    assert capability["unavailableReason"] == expected_reason


def test_private_health_is_independent_of_busy_availability() -> None:
    app = create_app(
        settings=settings(), backend=FakeBackend(), now_seconds=lambda: NOW
    )

    response = asyncio.run(route_endpoint(app, "/healthz")())

    assert response.status_code == 200
    assert json.loads(response.body) == {
        "ok": True,
        "service": "commandcanvas-private-hand-relay",
        "ready": True,
    }


def test_refuses_non_allowlisted_origins_before_authentication() -> None:
    token = make_token(now_seconds=NOW)
    app = create_app(
        settings=settings(), backend=FakeBackend(), now_seconds=lambda: NOW
    )
    socket = FakeWebSocket([text_message(hello(token))], origin="https://evil.example")

    run_socket(app, socket)

    assert socket.closed == (1008, "origin_not_allowed")
    assert socket.sent == []


def test_accepts_one_bounded_frame_and_returns_semantic_landmarks_only() -> None:
    backend = FakeBackend()
    service_clock = iter([1.0, 1.025])
    app = create_app(
        settings=settings(),
        backend=backend,
        now_seconds=lambda: NOW,
        monotonic_seconds=lambda: next(service_clock),
    )
    frame = image_bytes()
    socket = FakeWebSocket(
        [
            text_message(hello()),
            text_message(header(frame)),
            binary_message(frame),
        ]
    )

    run_socket(app, socket)
    assert socket.sent[0] == {"type": "ready", "protocol": PROTOCOL}
    result = socket.sent[1]

    assert result["type"] == "result"
    assert result["protocol"] == PROTOCOL
    assert result["frameId"] == 1
    assert result["capturedAtMs"] == 1234.5
    assert result["processedAtMs"] == pytest.approx(1259.5)
    assert result["processedAtMs"] - result["capturedAtMs"] == pytest.approx(25)
    assert result["hands"] == backend.results
    assert len(backend.calls) == 1


def test_v1_wire_projection_does_not_expose_internal_detector_boxes() -> None:
    backend = FakeBackend()
    backend.results = [
        {
            **backend.results[0],
            "boundingBox": {
                "x": 0.1,
                "y": 0.2,
                "width": 0.7,
                "height": 0.6,
            },
        }
    ]
    app = create_app(
        settings=settings(), backend=backend, now_seconds=lambda: NOW
    )
    frame = image_bytes()
    socket = FakeWebSocket(
        [
            text_message(hello()),
            text_message(header(frame)),
            binary_message(frame),
        ]
    )

    run_socket(app, socket)

    assert socket.sent[1]["hands"] == [
        {
            "confidence": 0.9,
            "handedness": "unknown",
            "landmarks": backend.results[0]["landmarks"],
        }
    ]


def test_times_out_an_unauthenticated_socket_that_never_sends_hello() -> None:
    relay_settings = replace(settings(), handshake_timeout_seconds=0.01)
    app = create_app(
        settings=relay_settings,
        backend=FakeBackend(),
        now_seconds=lambda: NOW,
    )
    socket = HangingWebSocket([])

    run_socket(app, socket)

    assert socket.closed == (1008, "handshake_timeout")
    assert socket.sent == []


def test_times_out_an_authenticated_socket_that_stops_sending_frames() -> None:
    relay_settings = replace(settings(), frame_idle_timeout_seconds=0.01)
    app = create_app(
        settings=relay_settings,
        backend=FakeBackend(),
        now_seconds=lambda: NOW,
    )
    socket = HangingWebSocket([text_message(hello())])

    run_socket(app, socket)

    assert socket.sent == [{"type": "ready", "protocol": PROTOCOL}]
    assert socket.closed == (1008, "frame_timeout")


def test_established_session_continues_after_handshake_capability_expiry() -> None:
    wall_clock = MutableClock(float(NOW))

    class TokenExpiringBackend(FakeBackend):
        def infer(self, tensor: Any, transform: Any) -> list[dict[str, Any]]:
            result = super().infer(tensor, transform)
            if len(self.calls) == 1:
                wall_clock.value = NOW + 61
            return result

    frame = image_bytes()
    app = create_app(
        settings=settings(),
        backend=TokenExpiringBackend(),
        now_seconds=lambda: int(wall_clock()),
    )
    socket = FakeWebSocket(
        [
            text_message(hello()),
            text_message(header(frame)),
            binary_message(frame),
            text_message(header(frame, frameId=2, capturedAtMs=1300)),
            binary_message(frame),
        ]
    )

    run_socket(app, socket)

    assert [message["type"] for message in socket.sent] == [
        "ready",
        "result",
        "result",
    ]
    assert [
        message["frameId"]
        for message in socket.sent
        if message["type"] == "result"
    ] == [1, 2]
    assert socket.closed is None


def test_authenticated_session_closes_at_its_independent_deadline() -> None:
    wall_clock = MutableClock(float(NOW))

    class SessionExpiringBackend(FakeBackend):
        def infer(self, tensor: Any, transform: Any) -> list[dict[str, Any]]:
            result = super().infer(tensor, transform)
            wall_clock.value = NOW + (59 if len(self.calls) == 1 else 60)
            return result

    frame = image_bytes()
    relay_settings = replace(
        settings(),
        authenticated_session_timeout_seconds=60,
    )
    token = make_token(now_seconds=NOW, ttl_seconds=120)
    app = create_app(
        settings=relay_settings,
        backend=SessionExpiringBackend(),
        now_seconds=lambda: int(wall_clock()),
    )
    socket = FakeWebSocket(
        [
            text_message(hello(token)),
            text_message(header(frame)),
            binary_message(frame),
            text_message(header(frame, frameId=2, capturedAtMs=1300)),
            binary_message(frame),
        ]
    )

    run_socket(app, socket)

    assert [message["type"] for message in socket.sent] == ["ready", "result"]
    assert socket.closed == (1008, "session_expired")


def test_server_paces_frames_to_its_advertised_maximum_fps() -> None:
    frame = image_bytes()
    monotonic_clock = MutableClock(10.0)
    app = create_app(
        settings=settings(),
        backend=FakeBackend(),
        now_seconds=lambda: NOW,
        monotonic_seconds=monotonic_clock,
        sleep=monotonic_clock.sleep,
    )
    socket = FakeWebSocket(
        [
            text_message(hello()),
            text_message(header(frame)),
            binary_message(frame),
            text_message(header(frame, frameId=2, capturedAtMs=1300)),
            binary_message(frame),
        ]
    )

    run_socket(app, socket)

    assert len([message for message in socket.sent if message["type"] == "result"]) == 2
    assert monotonic_clock.sleeps == [pytest.approx(1 / 30)]


def test_reserves_handshake_capacity_atomically_before_accept() -> None:
    async def scenario() -> None:
        app = create_app(
            settings=replace(settings(), max_connections=2, max_handshakes=1),
            backend=FakeBackend(),
            now_seconds=lambda: NOW,
        )
        endpoint = route_endpoint(app, "/v1/hand-pose")
        release = asyncio.Event()
        first = BlockingAcceptWebSocket(release)
        second = BlockingAcceptWebSocket(release)
        first_task = asyncio.create_task(endpoint(first))
        await first.accept_started.wait()
        second_task = asyncio.create_task(endpoint(second))
        await asyncio.sleep(0)
        try:
            assert second.closed == (1013, "relay_handshake_overloaded")
            assert second.accept_started.is_set() is False
        finally:
            release.set()
            await asyncio.gather(first_task, second_task)

    asyncio.run(scenario())


def test_unauthenticated_handshake_does_not_consume_an_inference_slot() -> None:
    async def scenario() -> None:
        app = create_app(
            settings=replace(
                settings(),
                max_connections=1,
                max_handshakes=2,
                handshake_timeout_seconds=1,
            ),
            backend=FakeBackend(),
            now_seconds=lambda: NOW,
        )
        endpoint = route_endpoint(app, "/v1/hand-pose")
        stalled = HangingWebSocket([])
        stalled_task = asyncio.create_task(endpoint(stalled))
        await stalled.waiting.wait()
        capability_response = await route_endpoint(app, "/v1/capabilities")()
        health_response = await route_endpoint(app, "/healthz")()
        valid = FakeWebSocket([text_message(hello())])
        await endpoint(valid)
        try:
            assert json.loads(capability_response.body)["ready"] is True
            assert health_response.status_code == 200
            assert valid.sent == [{"type": "ready", "protocol": PROTOCOL}]
        finally:
            stalled_task.cancel()
            with suppress(asyncio.CancelledError):
                await stalled_task

    asyncio.run(scenario())


def test_authenticated_inference_capacity_remains_bounded() -> None:
    async def scenario() -> None:
        app = create_app(
            settings=replace(settings(), max_connections=1, max_handshakes=2),
            backend=FakeBackend(),
            now_seconds=lambda: NOW,
        )
        endpoint = route_endpoint(app, "/v1/hand-pose")
        first = HangingWebSocket([text_message(hello())])
        first_task = asyncio.create_task(endpoint(first))
        await first.waiting.wait()
        second_token = make_token(
            now_seconds=NOW,
            overrides={"jti": "5ae0e1af-bbd1-4bc2-9d88-d73c57afc32d"},
        )
        second = FakeWebSocket([text_message(hello(second_token))])
        await endpoint(second)
        try:
            assert first.sent == [{"type": "ready", "protocol": PROTOCOL}]
            assert second.closed == (1013, "relay_overloaded")
            assert second.sent == []
        finally:
            first_task.cancel()
            with suppress(asyncio.CancelledError):
                await first_task

    asyncio.run(scenario())


def test_decode_and_inference_do_not_block_the_fastapi_event_loop() -> None:
    class SleepingBackend(FakeBackend):
        def infer(self, tensor: Any, transform: Any) -> list[dict[str, Any]]:
            self.calls.append(tensor)
            time.sleep(0.05)
            return self.results

    async def scenario() -> None:
        frame = image_bytes()
        app = create_app(
            settings=settings(),
            backend=SleepingBackend(),
            now_seconds=lambda: NOW,
        )
        socket = FakeWebSocket(
            [
                text_message(hello()),
                text_message(header(frame)),
                binary_message(frame),
            ]
        )
        started = time.perf_counter()
        task = asyncio.create_task(route_endpoint(app, "/v1/hand-pose")(socket))
        await asyncio.sleep(0.005)
        event_loop_delay = time.perf_counter() - started
        await task

        assert event_loop_delay < 0.03
        assert [message["type"] for message in socket.sent] == ["ready", "result"]

    asyncio.run(scenario())


def test_dedicated_executor_runs_only_one_inference_at_a_time() -> None:
    class ConcurrencyBackend(FakeBackend):
        def __post_init__(self) -> None:
            super().__post_init__()
            self.active = 0
            self.maximum_active = 0
            self.guard = threading.Lock()

        def infer(self, tensor: Any, transform: Any) -> list[dict[str, Any]]:
            with self.guard:
                self.active += 1
                self.maximum_active = max(self.maximum_active, self.active)
            try:
                time.sleep(0.02)
                self.calls.append(tensor)
                return self.results
            finally:
                with self.guard:
                    self.active -= 1

    async def scenario() -> None:
        backend = ConcurrencyBackend()
        app = create_app(
            settings=replace(settings(), max_connections=2),
            backend=backend,
            now_seconds=lambda: NOW,
        )
        frame = image_bytes()
        second_token = make_token(
            now_seconds=NOW,
            overrides={"jti": "5ae0e1af-bbd1-4bc2-9d88-d73c57afc32d"},
        )
        sockets = [
            FakeWebSocket(
                [
                    text_message(hello(token)),
                    text_message(header(frame)),
                    binary_message(frame),
                ]
            )
            for token in (make_token(now_seconds=NOW), second_token)
        ]
        endpoint = route_endpoint(app, "/v1/hand-pose")
        await asyncio.gather(*(endpoint(socket) for socket in sockets))

        assert backend.maximum_active == 1
        assert all(
            [message["type"] for message in socket.sent] == ["ready", "result"]
            for socket in sockets
        )

    asyncio.run(scenario())


def test_inference_timeout_trips_an_unhealthy_restart_circuit() -> None:
    class TimedOutBackend(FakeBackend):
        def infer(self, tensor: Any, transform: Any) -> list[dict[str, Any]]:
            self.calls.append(tensor)
            time.sleep(0.05)
            return self.results

    frame = image_bytes()
    restart_requests: list[str] = []
    app = create_app(
        settings=replace(settings(), inference_timeout_seconds=0.01),
        backend=TimedOutBackend(),
        now_seconds=lambda: NOW,
        restart_process=lambda: restart_requests.append("restart"),
    )
    socket = FakeWebSocket(
        [
            text_message(hello()),
            text_message(header(frame)),
            binary_message(frame),
        ]
    )

    run_socket(app, socket)
    capability_response = asyncio.run(route_endpoint(app, "/v1/capabilities")())
    health_response = asyncio.run(route_endpoint(app, "/healthz")())

    assert socket.closed == (1011, "inference_timeout")
    assert json.loads(capability_response.body)["unavailableReason"] == "maintenance"
    assert health_response.status_code == 503
    assert json.loads(health_response.body) == {
        "ok": False,
        "service": "commandcanvas-private-hand-relay",
        "ready": False,
        "reason": "inference_timeout",
    }
    assert restart_requests == ["restart"]


def test_cancelling_a_native_call_trips_the_circuit_instead_of_queueing_behind_it() -> (
    None
):
    class BlockingBackend(FakeBackend):
        def __post_init__(self) -> None:
            super().__post_init__()
            self.started = threading.Event()
            self.release = threading.Event()

        def infer(self, tensor: Any, transform: Any) -> list[dict[str, Any]]:
            self.calls.append(tensor)
            self.started.set()
            self.release.wait(timeout=1)
            return self.results

    async def scenario() -> None:
        frame = image_bytes()
        backend = BlockingBackend()
        restart_requests: list[str] = []
        app = create_app(
            settings=settings(),
            backend=backend,
            now_seconds=lambda: NOW,
            restart_process=lambda: restart_requests.append("restart"),
        )
        socket = FakeWebSocket(
            [
                text_message(hello()),
                text_message(header(frame)),
                binary_message(frame),
            ]
        )
        task = asyncio.create_task(route_endpoint(app, "/v1/hand-pose")(socket))
        try:
            for _attempt in range(200):
                if backend.started.is_set():
                    break
                await asyncio.sleep(0.001)
            assert backend.started.is_set()
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            health_response = await route_endpoint(app, "/healthz")()

            assert restart_requests == ["restart"]
            assert health_response.status_code == 503
            assert json.loads(health_response.body)["reason"] == "inference_cancelled"
        finally:
            backend.release.set()
            app.state.inference_runtime.shutdown()

    asyncio.run(scenario())


def test_consumes_a_jti_once_and_refuses_replay() -> None:
    token = make_token(now_seconds=NOW)
    app = create_app(
        settings=settings(), backend=FakeBackend(), now_seconds=lambda: NOW
    )
    first = FakeWebSocket([text_message(hello(token))])
    replay = FakeWebSocket([text_message(hello(token))])

    run_socket(app, first)
    run_socket(app, replay)

    assert first.sent[0]["type"] == "ready"
    assert replay.closed == (1008, "capability_replayed")


@pytest.mark.parametrize(
    "first_message",
    [
        {"type": "frame", "protocol": PROTOCOL},
        {"type": "hello", "protocol": "wrong", "token": "not-a-token"},
        hello(make_token(now_seconds=NOW) + "tampered"),
    ],
)
def test_refuses_malformed_or_unauthorized_handshakes(
    first_message: dict[str, object],
) -> None:
    app = create_app(
        settings=settings(), backend=FakeBackend(), now_seconds=lambda: NOW
    )
    socket = FakeWebSocket([text_message(first_message)])

    run_socket(app, socket)

    assert socket.closed == (1008, "invalid_message")


@pytest.mark.parametrize(
    "bad_header",
    [
        {"mimeType": "image/png"},
        {"byteLength": 0},
        {"byteLength": 262_145},
        {"frameId": 0},
        {"capturedAtMs": -1},
        {"extra": True},
    ],
)
def test_refuses_invalid_frame_metadata(bad_header: dict[str, object]) -> None:
    frame = image_bytes()
    app = create_app(
        settings=settings(), backend=FakeBackend(), now_seconds=lambda: NOW
    )
    socket = FakeWebSocket(
        [text_message(hello()), text_message(header(frame, **bad_header))]
    )

    run_socket(app, socket)

    assert socket.closed == (1008, "invalid_message")


def test_refuses_a_second_header_or_wrong_binary_length_while_frame_is_in_flight() -> (
    None
):
    frame = image_bytes()
    app = create_app(
        settings=settings(), backend=FakeBackend(), now_seconds=lambda: NOW
    )
    second_header = FakeWebSocket(
        [
            text_message(hello()),
            text_message(header(frame)),
            text_message(header(frame, frameId=2)),
        ]
    )

    run_socket(app, second_header)
    assert second_header.closed == (1008, "binary_frame_required")

    app = create_app(
        settings=settings(), backend=FakeBackend(), now_seconds=lambda: NOW
    )
    wrong_length = FakeWebSocket(
        [
            text_message(hello()),
            text_message(header(frame, byteLength=len(frame) + 1)),
            binary_message(frame),
        ]
    )
    run_socket(app, wrong_length)
    assert wrong_length.closed == (1008, "frame_length_mismatch")


def test_does_not_write_tokens_or_frame_bytes_to_logs(
    caplog: pytest.LogCaptureFixture,
) -> None:
    token = make_token(now_seconds=NOW)
    frame = image_bytes()
    app = create_app(
        settings=settings(), backend=FakeBackend(), now_seconds=lambda: NOW
    )
    socket = FakeWebSocket(
        [
            text_message(hello(token)),
            text_message(header(frame)),
            binary_message(frame),
        ]
    )

    caplog.set_level(logging.DEBUG)
    run_socket(app, socket)

    rendered = "\n".join(record.getMessage() for record in caplog.records)
    assert token not in rendered
    assert frame.hex() not in rendered
