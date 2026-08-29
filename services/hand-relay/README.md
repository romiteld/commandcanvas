# CommandCanvas native CUDA hand relay

This optional service runs the pinned CommandCanvas YOLO26 hand-pose model
through ONNX Runtime's native `CUDAExecutionProvider`. It accepts one bounded
JPEG or WebP frame at a time over the private relay v1 WebSocket and returns
semantic 21-point hand landmarks. Camera upload requires explicit browser
consent. The browser falls back to local YOLO and then MediaPipe when this
service is unavailable.

The service has no CPU inference mode. Startup fails closed when CUDA, the
selected artifact, its exact bytes, its tensor contract, device identity, or a
finite warmup result does not match the immutable manifest. The existing
`commandcanvas.private-hand-relay.v1` capability and result payloads remain
unchanged. The 640 parser keeps normalized detector boxes inside the relay for
future reacquisition work, but v1 clients receive only the established
confidence, handedness, and 21-landmark fields.

## Model images

The production and rollback images are separate, tagged artifacts. Both copy
the model into the image and verify its byte count and SHA-256 during the build.
Neither service uses a runtime host bind mount.

| Image | Input | Build source | Bytes | SHA-256 | Host port |
| --- | ---: | --- | ---: | --- | ---: |
| `commandcanvas-hand-relay:yolo26-640-fp16` | 640 | tracked `services/hand-relay/models/yolo26_hand_pose_640_fp16.onnx` | 21,547,949 | `f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e` | 8100 |
| `commandcanvas-hand-relay:yolo26-320-fp16-rollback` | 320 | tracked `public/models/yolo26_hand_pose_320_fp16.onnx` | 21,447,188 | `07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc` | 8102 |

Both variants resolve to the same pinned model repository and revision:

```text
repository: poptoz/yolo26-hand-pose-face-detection
revision: 2abb91a7030e1aa5231ec900ccb2c07ab3f03460
output: output0 float32 [1,300,69]
keypoints: 21
release path: AGPL-3.0-only
```

The production artifact is the upstream file
`models/yolo26_hand_pose_fp16.onnx`. It was independently downloaded from the
pinned revision and inspected with ONNX Runtime 1.23.1: input `images`
`tensor(float) [1,3,640,640]`; output `output0 tensor(float) [1,300,69]`.
`onnx.checker` did not pass that upstream graph because it reported a
topological-sort validation error at `graph_input_cast_0`; this repository does
not claim otherwise. ONNX Runtime loaded the graph metadata. A real CUDA
session and finite warmup are required before the service becomes ready. One
local true-640 run has now exercised those checks on an RTX 3090; the dated
evidence and its limits are recorded in
[`../../docs/local-cuda-verification-2026-08-29.md`](../../docs/local-cuda-verification-2026-08-29.md).

## Verify the tracked true-640 build input

Normal tests never download or replace a model. The corresponding-source
repository tracks the exact pinned 640 artifact used by the production image.
Verify its bytes before building:

```bash
stat --printf='%s bytes\n' \
  services/hand-relay/models/yolo26_hand_pose_640_fp16.onnx
sha256sum services/hand-relay/models/yolo26_hand_pose_640_fp16.onnx
```

The expected output is `21547949 bytes` and the production SHA-256 in the table
above. A missing, modified, or substituted file makes the image build fail.
Runtime startup repeats the full byte, digest, tensor, provider, and warmup
checks.

## Container build and start

Prerequisites are Docker with the NVIDIA Container Toolkit and a working
NVIDIA device probe. Generate a new independent 32-byte signing key. Do not
reuse a Supabase, Vercel, Resend, router, firewall, or another service
credential.

```bash
cd services/hand-relay
export PRIVATE_HAND_RELAY_SIGNING_KEY='<unpadded base64url 32-byte key>'
export PRIVATE_HAND_RELAY_ALLOWED_ORIGINS='https://commandcanvas.vercel.app'
docker compose build hand-relay-640
docker compose up -d hand-relay-640
```

The default Compose service is the verified true-640 production listener and
binds it to `127.0.0.1:8100`, matching the installed Caddy route. The existing
320 image remains an explicit rollback profile on the isolated loopback port
`127.0.0.1:8102`:

```bash
docker compose --profile rollback-320 build hand-relay-320-rollback
docker compose --profile rollback-320 up -d hand-relay-320-rollback
```

Starting the rollback profile does not move Caddy away from the production
true-640 listener. A rollback requires an explicit, separately reviewed route
change after the rollback service is healthy. Building an image does not change
Caddy, DNS, pfSense, or the public service.

The ONNX Runtime CUDA arena defaults to 768 MiB
(`PRIVATE_HAND_RELAY_GPU_MEM_LIMIT_BYTES=805306368`), uses heuristic cuDNN
algorithm selection, and disables CPU execution-provider fallback. Compose
requests one configured NVIDIA device, two CPU cores, a 2 GiB RAM limit, and a
512 MiB RAM reservation. It does not enable exclusive GPU process mode.

## Capability, scheduling, and privacy properties

- exact `Origin` allowlist with no wildcard origins;
- HMAC-SHA256 issuer, audience, room, actor, session, JTI, and expiry checks;
- one-use, process-local, TTL-bounded handshake replay cache;
- separate bounded handshake and authenticated inference capacity;
- one global native inference worker and one submitted GPU job at a time;
- one frame in flight per client, newest waiting frame retained client-side;
- server-side pacing at the advertised frame-rate ceiling;
- two-second inference deadline by default;
- unhealthy circuit and process restart request after a native timeout or
  cancellation because Python cannot cancel a running CUDA call safely;
- 262,144-byte default frame cap and 1280 by 720 decompressed dimension cap;
- JPEG/WebP signature and declared-MIME agreement;
- at most two results with exactly 21 normalized landmarks;
- no application access logging, token logging, frame logging, raw-frame
  persistence, or response caching;
- immediate local browser fallback when private tracking is unavailable.

The model exposes x/y and keypoint visibility, not metric depth or handedness.
The relay reports `z: 0` and `handedness: "unknown"` instead of inventing those
values. The no-retention claim covers this relay process. Reverse-proxy,
firewall, container-runtime, and hosting-edge logs are separate trust
boundaries and must not record WebSocket headers, bodies, capability tokens, or
binary frames.

## Tests

```bash
PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 \
  python3 -m pytest services/hand-relay/tests -q
```

CI installs `requirements-ci.lock` and injects the CUDA session boundary. The
tests prove manifest, preprocessing, parser, protocol, admission, and packaging
behavior. They do not prove that a CUDA provider, physical camera, or public
relay is working.

## Native CUDA benchmark

After the exact candidate image reports ready on the actual NVIDIA host, use a
real consented hand image:

```bash
cd services/hand-relay
python3 -m commandcanvas_hand_relay.benchmark \
  --image /absolute/path/to/consented-hand.webp \
  --warmup 10 \
  --iterations 200
```

The script reports the selected manifest, artifact SHA-256, input size, device,
p50, p95, result rate, and detected-hand range. The exact true-640 image was
exercised locally on 2026-08-29. Across 200 warmed repeats of one static CC0
bare-hand fixture it measured p50 `6.874 ms`, p95 `9.272 ms`, and `140.376`
results per second, with one detected hand in every repeat. This is
static-image CUDA evidence. Live-camera smoothness, active shared-GPU
contention, private-network latency, and public edge behavior remain
unverified.

For historical context only, the prior 320 relay identified an actual
`NVIDIA GeForce RTX 3090` and measured 200 warmed repeats of one static CC0
bare-hand image at p50 `7.652 ms`, p95 `11.016 ms`, and `122.013` results per
second. That is 320 static-image evidence, not true-640, live-camera, network,
or physical-gesture evidence.
