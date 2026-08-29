# Local CUDA verification, 2026-08-29

## Scope

This record covers one local, loopback-only verification of the separately
licensed CommandCanvas Hand Relay. It does not claim live-camera ergonomics,
browser capture or JPEG encoding latency, target-phone behavior, WAN behavior,
router configuration, production key distribution, or public availability.

No existing container was stopped, removed, restarted, or reconfigured. The
proof relay was started under the unique name
`commandcanvas-hand-relay-cuda-640-proof` on `127.0.0.1:18101`. Its signing key
was generated ephemerally and was not printed or written to the repository.

## Source and artifact identity

- source commit: `9f652a67dbe2c824ee68f7985ab13bb0af56ae6f`
- proof image: `commandcanvas-hand-relay:yolo26-640-fp16-proof-9f652a6`
- proof image ID: `sha256:291bd5218ae39e5ff01db3f40606a11ff3ce5561b2ea175e8234a45f7301f9d7`
- model: `poptoz/yolo26-hand-pose-face-detection`
- model revision: `2abb91a7030e1aa5231ec900ccb2c07ab3f03460`
- model variant: `yolo26_hand_pose_640_fp16`
- model SHA-256: `f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e`
- model input: 640 pixels, FP16 ONNX
- execution provider: ONNX Runtime `CUDAExecutionProvider`
- device: `NVIDIA GeForce RTX 3090 (CUDA device 0)`

The model byte-count and SHA-256 check passed during the fresh Docker build.
Startup also passed the relay's runtime provider, tensor, device, and finite
warmup checks before health changed to ready.

## Isolation and resource boundary

- host binding: `127.0.0.1:18101 -> 8100/tcp`
- requested GPU device: 0
- CPU limit: 2 cores
- RAM limit: 2 GiB
- PID limit: 128
- CUDA arena limit: 768 MiB
- root filesystem: read-only
- capabilities: all dropped
- privilege escalation: disabled
- restart policy: `unless-stopped`

At the post-benchmark snapshot the healthy container had zero restarts, used
907.9 MiB of host RAM, and reported 32 processes. The shared GPU snapshot
reported 1,772 MiB of 24,576 MiB in use, 45% utilization, and 39 C. Those GPU
values are a host-wide instant and are not attributed exclusively to this
container.

## Health and capability evidence

Both the WSL host and the container queried `/healthz` successfully:

```json
{"ok":true,"ready":true,"service":"commandcanvas-private-hand-relay"}
```

`/v1/capabilities` reported the exact pinned model revision, 21 keypoints,
AGPL-3.0 release path, CUDA/RTX 3090 runtime, FP16 precision, one frame in
flight, newest-frame-only scheduling, a 30 FPS ceiling, no raw-frame
persistence, and semantic-results-only output.

## Native inference benchmark

The accepted static fixture was a 939 by 720 JPEG derived from the previously
used CC0 bare-hand image. Its benchmark-input SHA-256 was
`7518ebceff035fa13dc25a8fd701dfc979de97ae4c2853a90817b7e76672bd46`.

After 10 warmup runs, 200 native repeats produced:

| Metric | Result |
| --- | ---: |
| Samples | 200 |
| Minimum hands | 1 |
| Maximum hands | 1 |
| p50 inference | 6.874 ms |
| p95 inference | 9.272 ms |
| Mean throughput | 140.376 results/s |

This benchmark covers decode performed once before the timed loop plus native
model inference inside the running image. It excludes browser capture, frame
encoding, network transit, WebSocket scheduling, UI rendering, and physical
gesture accuracy.

## Authenticated protocol evidence

An in-container client created a one-use HMAC capability without printing the
key, connected with the allowlisted production origin, sent the same bounded
JPEG through `commandcanvas.private-hand-relay.v1`, and received:

- ready handshake;
- frame ID 1;
- one hand at confidence 0.932129;
- exactly 21 semantic landmarks.

A second authenticated session sent ten frames through one WebSocket. Every
frame returned one hand with 21 landmarks. Relay-reported service latency was
p50 22.181 ms; the first and maximum result in that session was 88.173 ms.
This is an in-container protocol check, not browser-to-relay or WAN latency.

## Existing-workload audit

The running Docker workload contained the CommandCanvas local Supabase stack
and multiple `github-chat` MCP containers with no published ports and no GPU
device requests. Exact AutoLens filters found stopped Postgres contract-test
containers and cached AutoLens worker images, but no running AutoLens container
at the time of the audit. No existing workload was modified.

## Remaining unverified boundaries

- live front-camera frames and actual hand continuity;
- fingertip jitter, pinch false positives/negatives, and two-hand continuity;
- browser encode plus private-network round trip;
- shared-GPU latency while an AutoLens GPU worker is actively executing;
- public routing, TLS, pfSense, DNS, and production key distribution;
- iPhone thermal behavior and sustained interaction FPS.
