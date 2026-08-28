# CommandCanvas native CUDA hand relay

This optional service runs the pinned CommandCanvas YOLO hand-pose model through
ONNX Runtime's native `CUDAExecutionProvider`. It is separate from the browser
WebGPU/WASM engine and from every other GPU process. It accepts one bounded JPEG
or WebP frame at a time over the private relay v1 WebSocket and returns only
semantic 21-point hand landmarks.

An instance is installed on the controlled NVIDIA host and exposed through the
separate `hands.autolensai.com` Caddy virtual host. The public instance remains
optional: the browser selects it only after explicit camera-upload consent and
falls back to local YOLO when consent is absent or the service is unavailable.

The service deliberately has no CPU inference mode. If CUDA, the exact model,
the device identity, or warmup fails, `/v1/capabilities` reports a truthful
`ready: false` state. CommandCanvas then retains its local browser fallback.

## Exact model artifact

The service mounts, rather than copies, this regular Git-tracked repository
blob read-only:

```text
public/models/yolo26_hand_pose_320_fp16.onnx
size: 21,447,188 bytes
sha256: 07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc
source: poptoz/yolo26-hand-pose-face-detection
source revision: 2abb91a7030e1aa5231ec900ccb2c07ab3f03460
input: images float32 [1,3,320,320]
output: output0 float32 [1,300,69]
license: AGPL-3.0
```

Startup verifies the full digest and exact session tensors before warmup. It
does not download or silently substitute a model.

## Local container start

Prerequisites are Docker with the NVIDIA Container Toolkit and a working
`docker run --gpus all ... nvidia-smi` probe. Generate a new independent 32-byte
signing key. Do not reuse a Supabase, Vercel, Resend, pfSense, or other service
credential.

```bash
cd services/hand-relay
export PRIVATE_HAND_RELAY_SIGNING_KEY='<unpadded base64url 32-byte key>'
export PRIVATE_HAND_RELAY_ALLOWED_ORIGINS='https://commandcanvas.vercel.app'
docker compose up --build
```

The host binding is exactly `127.0.0.1:8100`. The installed TLS reverse proxy
exposes only `/v1/capabilities` and `/v1/hand-pose`; `/healthz` stays private to
the host/container health probe. The installation reused the existing WAN TCP
443 path and required no pfSense mutation. The reversible edge operation is
documented in [`ops/hand-relay`](../../ops/hand-relay/README.md).

The ONNX Runtime CUDA arena defaults to 768 MiB
(`PRIVATE_HAND_RELAY_GPU_MEM_LIMIT_BYTES=805306368`), uses heuristic cuDNN
algorithm selection, and disables CPU execution-provider fallback. This is a
conservative coexistence default, not an assertion that all GPU memory use is
hard-capped by the arena. Compose requests only the configured NVIDIA device,
two CPU cores, a 2 GiB RAM limit, and a 512 MiB RAM reservation. It does not
enable exclusive GPU process mode. Tune only after measuring the actual shared
host workload.

## Capability and privacy properties

- exact `Origin` allowlist; no wildcard origins;
- HMAC-SHA256 issuer/audience/room/actor/session/JTI/expiry validation during
  the WebSocket handshake;
- one-use, process-local, TTL-bounded handshake replay cache; run one service
  process, or replace it with a shared atomic replay store before running
  multiple replicas;
- a five-second authentication deadline and five-second frame-idle deadline by
  default;
- a separate authenticated-session lifetime, defaulting to 1,800 seconds and
  bounded to 60-7,200 seconds. Capability expiry does not terminate an already
  authenticated connection; the one-use capability authorizes only its opening
  handshake;
- immediate client-side socket shutdown when camera-upload consent is revoked,
  the page becomes hidden, or hand tracking is stopped. The longer server
  session lifetime does not weaken those browser lifecycle controls;
- a larger, timed handshake pool that cannot consume the smaller authenticated
  inference pool until HMAC and claim verification succeeds;
- atomically reserved inference capacity and server-side pacing at the
  advertised frame-rate ceiling;
- JPEG/WebP decode and synchronous ORT CUDA execution on one dedicated worker;
  the submission gate permits only one executor job, so its internal queue does
  not accumulate frames;
- a two-second inference deadline by default; a non-cancellable native stall
  trips an unhealthy circuit, makes private `/healthz` fail, closes the active
  request, and exits the service process so Compose's `restart: unless-stopped`
  policy can replace the non-cancellable CUDA worker;
- one inference in flight; each client retains only its newest waiting frame;
- 262,144-byte default frame cap and 1280x720 decompressed dimension cap;
- JPEG/WebP signature and declared-MIME agreement;
- at most two results with exactly 21 normalized landmarks;
- no application access logging, token logging, frame logging, raw-frame
  persistence, or response caching;
- policy close on invalid origin/auth/message order/frame, and honest local
  fallback at the application layer.

The model exposes x/y and per-keypoint visibility, not metric depth or
handedness. The relay preserves normalized `visibility`, reports `z: 0`, and
reports `handedness: "unknown"` rather than dropping confidence, mislabeling
visibility as depth, or inventing handedness.

The no-logging property covers this application process. The TLS reverse proxy,
firewall, container runtime, and hosting edge are separate trust boundaries.
They must not log WebSocket headers or bodies, capability tokens, binary frame
payloads, or request samples. Minimal path/status/aggregate latency logs may be
enabled at the edge only after redaction has been verified. The application
never puts a capability token in a URL or query string.

## Tests

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python3 -m pytest services/hand-relay/tests -q
```

The explicit plugin-disable flag isolates this test suite from unrelated
globally installed pytest plugins. In a clean environment, install
`requirements-dev.lock` first. GitHub Actions instead installs the exact
non-GPU subset in `requirements-ci.lock`; tests inject the CUDA session boundary
and never claim that CI exercised a GPU. Native deployment still installs the
full `requirements.lock`.

## Native CUDA benchmark

Use a real, consented hand image that already satisfies the advertised byte and
dimension limits. The script reports device identity, model revision, p50, p95,
results per second, and detected-hand range.

```bash
cd services/hand-relay
python3 -m commandcanvas_hand_relay.benchmark \
  --image /absolute/path/to/consented-hand.webp \
  --warmup 10 \
  --iterations 200
```

An actual CUDA benchmark is not produced by unit tests or CPU emulation. Record
results only from the native host/container after `/v1/capabilities` identifies
the active CUDA provider and device.

The 2026-08-28 installed run identified
`NVIDIA GeForce RTX 3090 (CUDA device 0)`. A CC0 static bare-hand image returned
one hand at confidence `0.934082` and 21 finite landmarks. Two hundred warmed
native repeats measured p50 `7.652 ms`, p95 `11.016 ms`, and `122.013` results
per second. This is static-image CUDA evidence, not a live-camera, network, or
physical-hand ergonomics result.
