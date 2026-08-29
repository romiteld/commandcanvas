from __future__ import annotations

import asyncio
import inspect
import json
import math
import os
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from functools import partial
from typing import Any, Callable, Protocol, cast

from fastapi import FastAPI, WebSocket
from fastapi.responses import JSONResponse
from starlette.websockets import WebSocketDisconnect, WebSocketState

from .auth import MAX_TOKEN_BYTES, TokenError, verify_capability
from .config import RelaySettings
from .inference import (
    BackendInputKind,
    CudaUnavailable,
    FrameRejected,
    ModelUnavailable,
    UnavailableBackend,
    YoloCudaBackend,
    decode_frame,
    decode_rgb_frame,
)
from .hybrid_backend import (
    HYBRID_RUNTIME_MANIFEST,
    HybridCudaBackend,
)
from .replay import OneUseReplayCache


PROTOCOL = "commandcanvas.private-hand-relay.v1"
SERVICE = "commandcanvas-private-hand-relay"
POLICY_CLOSE = 1008
INTERNAL_CLOSE = 1011
OVERLOADED_CLOSE = 1013
SAFE_INTEGER_MAX = 9_007_199_254_740_991


class HandshakeTimeout(Exception):
    pass


class FrameTimeout(Exception):
    pass


class SessionExpired(Exception):
    pass


class InferenceTimeout(Exception):
    pass


class CircuitUnhealthy(Exception):
    pass


class CapabilityManifest(Protocol):
    repository: str
    revision: str
    keypoints: int
    release_license: str
    precision: str


class Backend(Protocol):
    ready: bool
    warm: bool
    unavailable_reason: str | None
    device: str
    input_size: int
    input_kind: BackendInputKind
    manifest: CapabilityManifest


class TensorBackend(Backend, Protocol):
    def infer(self, tensor: Any, transform: Any) -> list[dict[str, Any]]: ...


class RgbFrameBackend(Backend, Protocol):
    def infer_rgb(self, frame_rgb: Any) -> list[dict[str, Any]]: ...


class InferenceRuntime:
    """One submitted job at a time on one dedicated worker thread.

    ThreadPoolExecutor itself owns an unbounded internal queue, so callers must
    acquire the submission lock before a job is submitted. Waiting callers are
    bounded by the authenticated connection limit and never enter that queue.
    """

    def __init__(
        self,
        *,
        timeout_seconds: float,
        restart_process: Callable[[], None],
    ):
        self._timeout_seconds = timeout_seconds
        self._restart_process = restart_process
        self._executor = ThreadPoolExecutor(
            max_workers=1,
            thread_name_prefix="commandcanvas-cuda",
        )
        self._submission_lock = asyncio.Lock()
        self._healthy = True
        self._reason: str | None = None

    @property
    def healthy(self) -> bool:
        return self._healthy

    @property
    def reason(self) -> str | None:
        return self._reason

    def trip(self, reason: str) -> None:
        self._healthy = False
        self._reason = reason

    async def run(self, callback: Callable[[], Any]) -> Any:
        if not self._healthy:
            raise CircuitUnhealthy
        async with self._submission_lock:
            if not self._healthy:
                raise CircuitUnhealthy
            loop = asyncio.get_running_loop()
            future = loop.run_in_executor(self._executor, callback)
            future.add_done_callback(_consume_executor_result)
            try:
                return await asyncio.wait_for(
                    asyncio.shield(future),
                    timeout=self._timeout_seconds,
                )
            except asyncio.TimeoutError:
                # Python cannot safely kill a native ORT call. Refuse all new
                # work and make /healthz fail so the container restart policy
                # replaces this process after the non-cancellable stall.
                self.trip("inference_timeout")
                raise InferenceTimeout from None
            except asyncio.CancelledError:
                # Cancellation cannot stop a native CUDA call either. Trip and
                # restart before releasing the submission gate; otherwise a
                # later request could be queued behind an orphaned ORT call.
                self.trip("inference_cancelled")
                self.request_restart()
                raise

    def shutdown(self) -> None:
        self._executor.shutdown(wait=False, cancel_futures=True)

    def request_restart(self) -> None:
        self._restart_process()


def create_app(
    *,
    settings: RelaySettings,
    backend: Backend | None = None,
    now_seconds: Callable[[], int] | None = None,
    monotonic_seconds: Callable[[], float] | None = None,
    sleep: Callable[[float], Any] | None = None,
    restart_process: Callable[[], None] | None = None,
) -> FastAPI:
    clock = now_seconds or (lambda: int(time.time()))
    service_clock = monotonic_seconds or time.perf_counter
    sleeper = sleep or asyncio.sleep
    replay = OneUseReplayCache()
    if restart_process is None:
        # Dependency-injected backends are test/embedding surfaces. The normal
        # service path must terminate after a native stall because Python
        # cannot cancel a CUDA call; Docker's restart policy then creates a
        # fresh process instead of leaving a permanently unhealthy container.
        restart_process = (lambda: os._exit(70)) if backend is None else (lambda: None)
    inference_runtime = InferenceRuntime(
        timeout_seconds=float(settings.inference_timeout_seconds),
        restart_process=restart_process,
    )
    active_handshakes = 0
    active_inference_connections = 0
    admission_lock = asyncio.Lock()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if backend is None:
            selected_manifest: CapabilityManifest = (
                HYBRID_RUNTIME_MANIFEST
                if settings.backend_variant == "hybrid_rtmpose"
                else settings.model_manifest
            )
            try:
                if settings.backend_variant == "hybrid_rtmpose":
                    if (
                        settings.hybrid_detector_model_path is None
                        or settings.hybrid_pose_model_path is None
                    ):
                        raise ModelUnavailable(
                            "Hybrid model paths were not configured."
                        )
                    app.state.backend = HybridCudaBackend.load(
                        settings.hybrid_detector_model_path,
                        settings.hybrid_pose_model_path,
                        gpu_mem_limit_bytes=settings.gpu_mem_limit_bytes,
                    )
                else:
                    if settings.model_path is None:
                        raise ModelUnavailable("YOLO model path was not configured.")
                    app.state.backend = YoloCudaBackend.load(
                        settings.model_path,
                        manifest=settings.model_manifest,
                        gpu_mem_limit_bytes=settings.gpu_mem_limit_bytes,
                    )
            except CudaUnavailable:
                app.state.backend = UnavailableBackend(
                    "gpu_unavailable",
                    manifest=selected_manifest,
                )
            except ModelUnavailable:
                app.state.backend = UnavailableBackend(
                    "model_unavailable",
                    manifest=selected_manifest,
                )
            except Exception:
                app.state.backend = UnavailableBackend(
                    "model_unavailable",
                    manifest=selected_manifest,
                )
        else:
            app.state.backend = backend
        try:
            yield
        finally:
            inference_runtime.shutdown()

    app = FastAPI(
        title="CommandCanvas private hand relay",
        version="1.0",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    if backend is not None:
        # Tests and dependency-injected hosts do not need to enter lifespan
        # merely to exercise the protocol. Normal service startup still loads
        # and warms the native CUDA backend inside lifespan.
        app.state.backend = backend
    app.state.inference_runtime = inference_runtime

    @app.get("/v1/capabilities")
    async def capabilities() -> JSONResponse:
        current: Backend = app.state.backend
        overloaded = active_inference_connections >= settings.max_connections
        payload = _capability(
            current,
            settings,
            overloaded=overloaded,
            runtime_healthy=inference_runtime.healthy,
        )
        return JSONResponse(payload, headers={"Cache-Control": "no-store"})

    @app.get("/healthz")
    async def healthz() -> JSONResponse:
        current: Backend = app.state.backend
        ready = current.ready and current.warm and inference_runtime.healthy
        payload: dict[str, Any] = {
            "ok": ready,
            "service": SERVICE,
            "ready": ready,
        }
        if not ready:
            payload["reason"] = (
                inference_runtime.reason or current.unavailable_reason or "model_cold"
            )
        return JSONResponse(
            payload,
            status_code=200 if ready else 503,
            headers={"Cache-Control": "no-store"},
        )

    @app.websocket("/v1/hand-pose")
    async def hand_pose(websocket: WebSocket) -> None:
        nonlocal active_handshakes, active_inference_connections
        handshake_reserved = False
        inference_reserved = False
        current: Backend = app.state.backend
        origin = websocket.headers.get("origin")
        if origin not in settings.allowed_origins:
            await websocket.close(code=POLICY_CLOSE, reason="origin_not_allowed")
            return
        if not current.ready or not current.warm or not inference_runtime.healthy:
            await websocket.close(code=OVERLOADED_CLOSE, reason="relay_not_ready")
            return
        async with admission_lock:
            if active_handshakes < settings.max_handshakes:
                active_handshakes += 1
                handshake_reserved = True
        if not handshake_reserved:
            await websocket.close(
                code=OVERLOADED_CLOSE,
                reason="relay_handshake_overloaded",
            )
            return
        try:
            await websocket.accept()
            message = await _receive_with_timeout(
                websocket,
                float(settings.handshake_timeout_seconds),
                HandshakeTimeout,
            )
            hello = _parse_hello(message)
            claims = verify_capability(hello["token"], settings.signing_key, clock())
            # Only a cryptographically verified capability may transition from
            # the larger, short-lived handshake pool into scarce inference
            # capacity. The transition is atomic and leaves an unconsumed token
            # retryable when all authenticated slots are busy.
            async with admission_lock:
                active_handshakes -= 1
                handshake_reserved = False
                if active_inference_connections < settings.max_connections:
                    active_inference_connections += 1
                    inference_reserved = True
            if not inference_reserved:
                await _close(websocket, OVERLOADED_CLOSE, "relay_overloaded")
                return
            if not await replay.consume(
                claims.jti,
                expires_at=claims.expires_at,
                now_seconds=clock(),
            ):
                await _close(websocket, POLICY_CLOSE, "capability_replayed")
                return
            session_expires_at = (
                clock() + settings.authenticated_session_timeout_seconds
            )
            await websocket.send_json({"type": "ready", "protocol": PROTOCOL})
            last_inference_started: float | None = None
            while True:
                message = await _receive_authenticated(
                    websocket,
                    session_expires_at=session_expires_at,
                    now_seconds=clock,
                    idle_timeout_seconds=float(settings.frame_idle_timeout_seconds),
                )
                if message.get("type") == "websocket.disconnect":
                    return
                frame_header = _parse_frame_header(message, settings)
                binary_message = await _receive_authenticated(
                    websocket,
                    session_expires_at=session_expires_at,
                    now_seconds=clock,
                    idle_timeout_seconds=float(settings.frame_idle_timeout_seconds),
                )
                if binary_message.get("type") == "websocket.disconnect":
                    return
                frame_bytes = binary_message.get("bytes")
                if not isinstance(frame_bytes, bytes):
                    await _close(websocket, POLICY_CLOSE, "binary_frame_required")
                    return
                if len(frame_bytes) != frame_header["byteLength"]:
                    await _close(websocket, POLICY_CLOSE, "frame_length_mismatch")
                    return
                try:
                    inference_started = service_clock()
                    if last_inference_started is not None:
                        wait_seconds = (
                            last_inference_started
                            + (1 / settings.max_fps)
                            - inference_started
                        )
                        if wait_seconds > 0:
                            await sleeper(wait_seconds)
                            if clock() >= session_expires_at:
                                raise SessionExpired
                            inference_started = service_clock()
                    last_inference_started = inference_started
                    hands = await inference_runtime.run(
                        partial(
                            _decode_and_infer,
                            current,
                            frame_bytes,
                            frame_header,
                            settings,
                        )
                    )
                    inference_finished = service_clock()
                except FrameRejected:
                    await _close(websocket, POLICY_CLOSE, "frame_rejected")
                    return
                except SessionExpired:
                    raise
                except InferenceTimeout:
                    await _close(websocket, INTERNAL_CLOSE, "inference_timeout")
                    inference_runtime.request_restart()
                    return
                except CircuitUnhealthy:
                    await _close(websocket, OVERLOADED_CLOSE, "relay_not_ready")
                    return
                except Exception:
                    inference_runtime.trip("inference_failed")
                    await _close(websocket, INTERNAL_CLOSE, "inference_failed")
                    inference_runtime.request_restart()
                    return
                if clock() >= session_expires_at:
                    await _close(websocket, POLICY_CLOSE, "session_expired")
                    return
                captured_at = frame_header["capturedAtMs"]
                inference_latency_ms = max(
                    0.0, (inference_finished - inference_started) * 1_000
                )
                # capturedAtMs originates from performance.now() in the
                # browser. Keep processedAtMs in that same clock domain so the
                # strict v1 result remains meaningful without mixing it with
                # Unix epoch milliseconds.
                processed_at = captured_at + inference_latency_ms
                await websocket.send_json(
                    {
                        "type": "result",
                        "protocol": PROTOCOL,
                        "frameId": frame_header["frameId"],
                        "capturedAtMs": captured_at,
                        "processedAtMs": processed_at,
                        "hands": hands,
                    }
                )
        except HandshakeTimeout:
            await _close(websocket, POLICY_CLOSE, "handshake_timeout")
        except FrameTimeout:
            await _close(websocket, POLICY_CLOSE, "frame_timeout")
        except SessionExpired:
            await _close(websocket, POLICY_CLOSE, "session_expired")
        except (TokenError, ValueError, json.JSONDecodeError):
            await _close(websocket, POLICY_CLOSE, "invalid_message")
        except WebSocketDisconnect:
            return
        finally:
            if handshake_reserved or inference_reserved:
                async with admission_lock:
                    if handshake_reserved:
                        active_handshakes -= 1
                    if inference_reserved:
                        active_inference_connections -= 1

    return app


def _capability(
    backend: Backend,
    settings: RelaySettings,
    *,
    overloaded: bool,
    runtime_healthy: bool,
) -> dict[str, Any]:
    manifest = backend.manifest
    ready = backend.ready and backend.warm and runtime_healthy and not overloaded
    value: dict[str, Any] = {
        "ok": True,
        "protocol": PROTOCOL,
        "service": SERVICE,
        "ready": ready,
        "warm": backend.warm,
        "model": {
            "id": manifest.repository,
            "revision": manifest.revision,
            "format": "onnx",
            "keypoints": manifest.keypoints,
            "license": manifest.release_license,
        },
        "runtime": {
            "provider": "cuda",
            "device": backend.device,
            "precision": manifest.precision,
        },
        "limits": {
            "maxFrameBytes": settings.max_frame_bytes,
            "maxFps": settings.max_fps,
            "maxWidth": settings.max_width,
            "maxHeight": settings.max_height,
            "maxInFlight": 1,
            "newestFrameOnly": True,
        },
        "privacy": {
            "rawFramesPersisted": False,
            "semanticResultsOnly": True,
            "maxRetentionSeconds": 0,
        },
    }
    if not ready:
        value["unavailableReason"] = (
            "maintenance"
            if not runtime_healthy
            else (
                "overloaded"
                if overloaded
                else backend.unavailable_reason or "model_cold"
            )
        )
    return value


def _decode_and_infer(
    backend: Backend,
    frame_bytes: bytes,
    frame_header: dict[str, Any],
    settings: RelaySettings,
) -> list[dict[str, Any]]:
    if backend.input_kind == BackendInputKind.RGB_FRAME:
        frame_rgb = decode_rgb_frame(
            frame_bytes,
            declared_mime=frame_header["mimeType"],
            max_frame_bytes=settings.max_frame_bytes,
            max_width=settings.max_width,
            max_height=settings.max_height,
        )
        internal_hands = cast(RgbFrameBackend, backend).infer_rgb(frame_rgb)
    elif backend.input_kind == BackendInputKind.LETTERBOXED_TENSOR:
        tensor, transform = decode_frame(
            frame_bytes,
            declared_mime=frame_header["mimeType"],
            max_frame_bytes=settings.max_frame_bytes,
            max_width=settings.max_width,
            max_height=settings.max_height,
            input_size=backend.input_size,
        )
        internal_hands = cast(TensorBackend, backend).infer(tensor, transform)
    else:
        raise ModelUnavailable("Relay backend input contract is not recognized.")
    # Protocol v1 intentionally remains byte-shape compatible with already
    # deployed clients. The 640 backend retains normalized detector boxes for
    # server-side tracking/reacquisition, but only the established semantic
    # hand fields cross the WebSocket boundary.
    hands = [
        {
            "confidence": hand["confidence"],
            "handedness": hand["handedness"],
            "landmarks": hand["landmarks"],
        }
        for hand in internal_hands
    ]
    _validate_hands(hands)
    return hands


def _consume_executor_result(future: asyncio.Future[Any]) -> None:
    try:
        future.exception()
    except (asyncio.CancelledError, Exception):
        # The protocol already translated submitted-job failures. This callback
        # only prevents a timed-out native call from surfacing later as an
        # unhandled future exception after its worker thread eventually exits.
        pass


def _parse_hello(message: dict[str, Any]) -> dict[str, str]:
    text = message.get("text")
    if not isinstance(text, str) or len(text.encode("utf-8")) > MAX_TOKEN_BYTES + 256:
        raise ValueError("invalid hello")
    value = json.loads(text)
    if (
        not isinstance(value, dict)
        or set(value) != {"type", "protocol", "token"}
        or value.get("type") != "hello"
        or value.get("protocol") != PROTOCOL
        or not isinstance(value.get("token"), str)
    ):
        raise ValueError("invalid hello")
    return value


def _parse_frame_header(
    message: dict[str, Any], settings: RelaySettings
) -> dict[str, Any]:
    text = message.get("text")
    if not isinstance(text, str) or len(text.encode("utf-8")) > 1024:
        raise ValueError("invalid frame header")
    value = json.loads(text)
    if not isinstance(value, dict) or set(value) != {
        "type",
        "protocol",
        "frameId",
        "capturedAtMs",
        "mimeType",
        "byteLength",
    }:
        raise ValueError("invalid frame header")
    if value.get("type") != "frame" or value.get("protocol") != PROTOCOL:
        raise ValueError("invalid frame header")
    frame_id = value.get("frameId")
    byte_length = value.get("byteLength")
    captured_at = value.get("capturedAtMs")
    if (
        type(frame_id) is not int
        or frame_id <= 0
        or frame_id > SAFE_INTEGER_MAX
        or type(byte_length) is not int
        or byte_length <= 0
        or byte_length > settings.max_frame_bytes
        or type(captured_at) not in {int, float}
        or not math.isfinite(captured_at)
        or captured_at < 0
        or value.get("mimeType") not in {"image/jpeg", "image/webp"}
    ):
        raise ValueError("invalid frame header")
    return value


def _validate_hands(hands: object) -> None:
    if not isinstance(hands, list) or len(hands) > 2:
        raise ValueError("invalid hands")
    for hand in hands:
        if not isinstance(hand, dict) or set(hand) != {
            "confidence",
            "handedness",
            "landmarks",
        }:
            raise ValueError("invalid hand")
        confidence = hand["confidence"]
        if (
            type(confidence) not in {int, float}
            or not math.isfinite(confidence)
            or not 0 <= confidence <= 1
            or hand["handedness"] not in {"left", "right", "unknown"}
            or not isinstance(hand["landmarks"], list)
            or len(hand["landmarks"]) != 21
        ):
            raise ValueError("invalid hand")
        for landmark in hand["landmarks"]:
            if not isinstance(landmark, dict) or set(landmark) != {
                "x",
                "y",
                "z",
                "visibility",
            }:
                raise ValueError("invalid landmark")
            for axis, minimum, maximum in (
                ("x", 0, 1),
                ("y", 0, 1),
                ("z", -2, 2),
                ("visibility", 0, 1),
            ):
                value = landmark[axis]
                if (
                    type(value) not in {int, float}
                    or not math.isfinite(value)
                    or value < minimum
                    or value > maximum
                ):
                    raise ValueError("invalid landmark")


async def _receive_with_timeout(
    websocket: WebSocket,
    timeout_seconds: float,
    timeout_error: type[Exception],
) -> dict[str, Any]:
    try:
        return await asyncio.wait_for(websocket.receive(), timeout=timeout_seconds)
    except asyncio.TimeoutError:
        raise timeout_error from None


async def _receive_authenticated(
    websocket: WebSocket,
    *,
    session_expires_at: int | float,
    now_seconds: Callable[[], int],
    idle_timeout_seconds: float,
) -> dict[str, Any]:
    now = now_seconds()
    remaining = session_expires_at - now
    if remaining <= 0:
        raise SessionExpired
    expiry_is_first = remaining <= idle_timeout_seconds
    try:
        message = await asyncio.wait_for(
            websocket.receive(),
            timeout=min(idle_timeout_seconds, float(remaining)),
        )
    except asyncio.TimeoutError:
        if expiry_is_first or now_seconds() >= session_expires_at:
            raise SessionExpired from None
        raise FrameTimeout from None
    if now_seconds() >= session_expires_at:
        raise SessionExpired
    return message


async def _close(websocket: WebSocket, code: int, reason: str) -> None:
    if websocket.application_state != WebSocketState.DISCONNECTED:
        result = websocket.close(code=code, reason=reason)
        if inspect.isawaitable(result):
            await result
