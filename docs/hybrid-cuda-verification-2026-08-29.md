# Hybrid CUDA verification, 2026-08-29

## Scope

This record covers one isolated, loopback-only verification of the opt-in
RTMDet-nano plus RTMPose-m backend on the local NVIDIA host. It proves exact
artifact acquisition, container packaging, CUDA startup, finite warmup, the
authenticated relay protocol, and semantic 21-landmark output against two
previously supplied screenshot crops.

It does not prove live-camera continuity, physical drawing or pinch ergonomics,
phone capture/encode latency, WAN latency, public routing, or target-device
thermal behavior. The crops contain the old CommandCanvas UI and MediaPipe
overlay, so they are deliberately treated as contaminated smoke fixtures rather
than raw model ground truth.

No existing AutoLensAI, Supabase, Caddy, or CommandCanvas proof container was
stopped, restarted, removed, or reconfigured. The isolated proof container and
the temporary fixture-bearing derivative image were removed after verification.
The clean model image remains locally available.

## Source and image identity

- source commit: `487d46c010293a188b885b53c9e3103ecacbfeaf`
- clean proof image: `commandcanvas-hand-relay:hybrid-rtmpose-proof-5b4b85d`
- clean image ID: `sha256:61f56269b2e7e6fe18b7b3e65d18adc235e0eded70a804964315f929ec880baf`
- clean image size: 3,341,970,181 bytes
- detector: RTMDet-nano hand detector, FP32 ONNX
- detector SHA-256: `568d3ea97a5b142488366b67e036b6a5cb0a1fef9087a710cb8e66b6979fbac2`
- refiner: RTMPose-m Distill, FP32 ONNX
- refiner revision: `ec0d56fdf55a350106671e763338a4a76372a888`
- refiner SHA-256: `6d50664e566fffee41a090c98f75e893b50846a753b802dbf5e2072a8dfd7784`
- model release license: Apache-2.0
- relay source license: AGPL-3.0-only
- runtime: ONNX Runtime `CUDAExecutionProvider`
- device: `NVIDIA GeForce RTX 3090 (CUDA device 0)`

The build repeated exact byte-count and SHA-256 checks before either model was
included. The candidate model bytes remain ignored by Git; the repository
contains their immutable acquisition lock, provenance, hashes, and validation
tool.

## Runtime provider boundary

The first real container startup correctly remained unavailable. Both exported
graphs contain bookkeeping/control nodes that ONNX Runtime assigns to its CPU
execution provider, while the neural compute nodes use CUDA. The initial hybrid
session inherited the YOLO backend's absolute CPU-fallback prohibition and
therefore reported `gpu_unavailable` before warmup.

The source commit above applies a hybrid-only provider policy:

- request CUDA first and CPU second;
- refuse startup if CUDA is missing or not the primary provider;
- require both sessions to report the same CUDA device;
- retain strict artifact, tensor, finite-warmup, and concrete output checks;
- leave the established YOLO no-fallback session policy unchanged.

The corrected container reported healthy and warm. Its live capability response
identified `rtmdet-nano-hand+rtmpose-m-distill`, 21 keypoints, FP32, CUDA, the
RTX 3090, a 30 FPS service ceiling, one in-flight frame, newest-frame-only
scheduling, no raw-frame persistence, and semantic-results-only output.

## Authenticated protocol smoke

An in-container client created a one-use HMAC capability without printing its
key or token, connected from an allowlisted origin, completed the
`commandcanvas.private-hand-relay.v1` ready handshake, and sent 40 bounded JPEG
frames through the WebSocket endpoint.

| Fixture | Frames | Hand on every frame | 21 landmarks every frame | Service p50 | Service p95 | Round-trip p50 | Round-trip p95 | Minimum confidence | Median normalized pinch ratio |
| --- | ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Open hand | 20 | yes | yes | 19.660 ms | 30.119 ms | 32.769 ms | 44.807 ms | 0.479028 | 1.125 |
| Pinch | 20 | yes | yes | 14.297 ms | 15.830 ms | 33.449 ms | 34.916 ms | 0.540241 | 0.311 |

The service latency is reported by the relay around decode plus inference. The
round-trip measurement is in-container and includes WebSocket pacing, but not
browser capture, JPEG encoding, LAN/WAN transit, or UI rendering. The ratio is
thumb-to-index distance normalized by wrist-to-middle-MCP distance; it is
reported as fixture evidence, not a universal gesture threshold.

## Resource and isolation evidence

The proof container used:

- unique container name and loopback host port `127.0.0.1:18104`;
- requested CUDA device 0;
- two CPU cores, 2 GiB RAM, and 128 PID limits;
- a read-only root filesystem and 64 MiB temporary filesystem;
- all Linux capabilities dropped and privilege escalation disabled;
- no restart policy.

The host-wide post-benchmark sample reported 2,203 MiB of 24,576 MiB GPU memory
in use and 31% utilization. The pre-start sample reported 1,708 MiB and 33%.
Those are shared-host snapshots and are not attributed exclusively to this
container; the observed difference was approximately 495 MiB.

The temporary derivative image containing the two screenshot crops was deleted
after the benchmark. The clean proof image contains only the relay source,
runtime dependencies, and the two hash-verified model artifacts.

## Verification gates

- focused runtime tests observed intended failures before each provider and
  dynamic-tensor correction;
- complete deterministic relay suite: 129 passed;
- Python compilation: passed;
- whitespace check: passed;
- locked model artifact verification: passed;
- clean image build: passed;
- corrected container health: HTTP 200 and ready;
- capability identity: exact model, license, provider, device, and privacy
  contract returned;
- authenticated 40-frame protocol smoke: passed.

## Remaining unverified boundaries

- physical index-finger drawing, one-hand pinch/grab/release, and two-hand
  resize/zoom;
- hand continuity under blur, partial occlusion, two-hand crossing, lighting
  changes, and frame-edge reach;
- browser capture, image encoding, WSS edge transit, and landmark-to-render
  latency;
- shared-GPU behavior while AutoLensAI is actively running a GPU workload;
- public source availability, public TLS/WSS route, and server-to-relay token
  issuance;
- camera-consent revocation and automatic browser-local fallback;
- sustained phone FPS, thermals, battery use, and ergonomics.
