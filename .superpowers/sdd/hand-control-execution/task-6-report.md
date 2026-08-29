# Task 6 Report — True-640 All-YOLO Native CUDA Baseline

## Scope completed

Implemented the decision-locked true-640 all-YOLO private-relay source baseline. This slice does not add, download, bundle, or promote RTMPose. It does not deploy, start, restore, or route any external service.

- Added an immutable manifest and immutable variant registry for the production true-640 upstream ONNX artifact and the existing 320 rollback artifact.
- Made true-640 the default relay configuration. An unknown or ambiguous model label is refused instead of being treated as production.
- Required the exact artifact byte count and SHA-256 before ONNX Runtime session creation.
- Required `CUDAExecutionProvider` to be available and active first; enabled `session.disable_cpu_ep_fallback=1`; did not configure a CPU provider.
- Required the exact input and output names, types, and shapes from the selected manifest.
- Required an identified CUDA device and a finite, shape-correct warmup before the backend can report ready.
- Changed preprocessing to use the selected manifest's real 640 or rollback 320 input size. No 320 artifact is labeled as 640.
- Added true-640 letterbox inversion and internal normalized detector boxes while retaining exactly 21 normalized landmarks.
- Preserved the strict `commandcanvas.private-hand-relay.v1` wire shape. Internal boxes are explicitly projected out before a result crosses the WebSocket boundary.
- Preserved one globally bounded native inference job, the client-side newest-only queue, and immediate browser fallback when the relay is unavailable.
- Replaced the runtime host model bind mount with checksum-gated `COPY` into immutable candidate and rollback images.
- Defined the true-640 image as the default Compose service on loopback port 8101 and the separately tagged 320 rollback image behind the `rollback-320` profile on loopback port 8100.
- Kept the 21.5 MB true-640 build input ignored. Normal tests do not download a model.

## Independently verified artifact facts

The production manifest is pinned to:

```text
repository: poptoz/yolo26-hand-pose-face-detection
revision: 2abb91a7030e1aa5231ec900ccb2c07ab3f03460
artifact: models/yolo26_hand_pose_fp16.onnx
bytes: 21547949
sha256: f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e
ONNX IR: 8
opset: 17
input: images tensor(float) [1,3,640,640]
output: output0 tensor(float) [1,300,69]
```

The exact file was downloaded from that revision, independently counted and hashed, and loaded with ONNX Runtime 1.23.1 on CPU for metadata inspection. `onnx.checker` did **not** pass the upstream graph; it returned a topological-sort validation error at `graph_input_cast_0`. The source and third-party notices state this explicitly. No CUDA readiness claim is derived from the CPU metadata load.

The local build-context copy is:

```text
services/hand-relay/models/yolo26_hand_pose_640_fp16.onnx
```

It has the exact verified byte count and remains ignored and uncommitted. The public source contains the manifest, pinned source URL, staging instructions, build-time checks, and startup checks rather than committing the 21.5 MB binary.

## TDD evidence

### Baseline

Before Task 6 production edits:

```text
66 passed in 22.41s
```

### RED — manifest, true-640 preprocessing, parser, and image packaging

The initial focused contract failed before implementation:

```text
6 failed, 21 passed
```

The failures proved the missing manifest/variant contract, unknown-variant refusal, 640 preprocessing, normalized detector boxes, and immutable image packaging.

### Compatibility RED — rejected protocol expansion

An attempted addition of model capability fields and detector boxes to the strict v1 client contract failed all four existing strict-schema tests:

```text
4 tests, 4 failed
```

That attempted wire change was reverted. The server now retains boxes internally and projects only the legacy v1 semantic fields. The strict client schema was not weakened.

### GREEN — initial focused contract

```text
27 passed
```

### RED/GREEN — byte, tensor, provider, finite warmup, and v1 projection guards

With the protections deliberately removed, the targeted mutation suite reported:

```text
5 failed, 4 passed, 42 deselected
```

After restoring the protections:

```text
9 passed, 42 deselected
```

### RED/GREEN — rollback preprocessing identity

The benchmark initially decoded a selected rollback model at 640:

```text
1 failed, 1 passed
```

After preprocessing became manifest driven:

```text
2 passed
```

## Final verification

Python relay suite and bytecode compilation:

```text
84 passed
python compileall exit 0
```

The strict private-relay browser contracts plus release/license contracts:

```text
Test Files  8 passed (8)
Tests       55 passed (55)
```

Full TypeScript unit/component suite:

```text
Test Files  97 passed (97)
Tests       964 passed (964)
```

Static gates:

```text
npm run typecheck       exit 0
npm run lint -- --quiet exit 0
git diff --check        exit 0
```

Compose source contract:

```text
default services:
hand-relay-640

rollback-320 profile services:
hand-relay-320-rollback
hand-relay-640
```

The source test rejects runtime `volumes`, verifies both immutable tags, exact build inputs/hashes/byte counts, separate loopback ports, one NVIDIA device, and bounded CPU/RAM/PID/GPU-memory configuration.

## Running verification ledger

### WORKING

- Immutable exact production and rollback manifests.
- True-640 production default and explicit 320 rollback identity.
- Exact bytes, SHA-256, tensor name/type/shape, active CUDA-first provider, CPU-fallback-disable, device identity, and finite-warmup fail-closed guards.
- True-640 preprocessing and inverse letterbox mapping.
- Internal normalized boxes plus 21 normalized landmarks.
- Strict backward-compatible v1 result and capability payloads.
- Checksum-gated in-image model packaging with no host bind mount.
- Separate candidate and rollback image/port/profile contracts.
- Existing bounded global native job and browser fallback behavior.

### VERIFIED IN BROWSER

Task 6 adds no new browser-runtime claim. Task 5's real system-Chrome check covered the committed local 320 browser worker only; it is not evidence for the true-640 native relay.

### UNVERIFIED

- A real `CUDAExecutionProvider` session and finite warmup using the true-640 artifact on the actual NVIDIA host.
- Container image build/start because the local Docker daemon was unavailable.
- Candidate capability/health behavior over loopback port 8101.
- Reverse-proxy promotion, public service restoration, DNS/pfSense behavior, or any external deployment.
- True-640 latency, live-camera smoothness, physical hand accuracy, two-hand identity, corner reach, pinch cycles, shared-GPU behavior, and AutoLensAI light-load coexistence.
- ChatGPT built-in-browser behavior.

The existing public private-hand endpoint was observed down before this source slice because the old runtime bind-mounted 320 path resolved as a directory/missing file across the Docker/WSL boundary. This task removes that bind-mount failure mode in source but does not claim to have restored the public service.

### CUT / OUT OF TASK 6

- RTMPose integration, evaluation adapter, download, image layer, production selection, or release claim.
- CPU execution-provider fallback.
- TensorRT conversion or runtime engine build.
- Cross-user batching or a second native inference queue.
- Protocol-v1 schema expansion.
- Deployment, Caddy/DNS/pfSense changes, public cutover, push, credentials, or external infrastructure mutation.

## Evidence boundary

Task 6 closes the source, parser, manifest, packaging, compatibility, and fail-closed test contracts for the true-640 all-YOLO baseline. It does not prove that the candidate image builds on the unavailable Docker daemon, starts on CUDA, improves physical interaction, or is reachable publicly. Those require deliberate Task 7 runtime evidence and separate release authorization.
