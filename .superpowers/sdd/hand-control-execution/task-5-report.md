# Task 5 Report — Camera Scheduling, Runtime Profiling, and Relay Quality

## Scope completed

Implemented the approved runtime-performance slice without changing the Task 1 gesture reducer, Task 2 calibration, or Task 3 interaction state machine.

- Added a bounded hand-runtime profile with literal nearest-rank p50/p95 metrics for capture, detector processing, relay encoding, relay round trip, capture-to-receive, and capture-to-render.
- Added delivered-result rate, bounded sample counts, drop counters, non-finite/negative rejection, render acknowledgement, and a 250 ms publication throttle.
- Added YOLO startup measurement that ignores two warmups, evaluates 12 measured results or a 1,200 ms deadline with at least six results, retains local YOLO only at `>=18 Hz` and capture-to-receive p95 `<=100 ms`, and otherwise falls back one-way to MediaPipe.
- Added a privacy-safe, versioned, injected session-storage preference keyed only by engine, model version, and coarse device class. Storage refusal or quota failure cannot interrupt camera input. No raw device IDs, labels, landmarks, or frames are persisted.
- Changed the camera scheduler to prefer `requestVideoFrameCallback`, retain a deduplicated `requestAnimationFrame` fallback, and enforce one capture plus one active inference plus at most one newest pending bitmap.
- Added exact bitmap closure/drop accounting for superseded and late captures, engine epochs that prevent a YOLO-era capture entering MediaPipe after fallback, and lifecycle cleanup for scheduled callbacks, captures, pending bitmaps, worker timeouts, ended media, page hiding, and component unmount.
- Rejects semantic transitions only when result age is greater than 120 ms. Exactly 120 ms remains accepted; 120.001 ms is stale and follows the existing loss/grace path.
- Reports detector-call wall time from the worker using an injected monotonic clock.
- Raises the private relay browser source target to 640 by 480 and 131,072 bytes, preserves aspect ratio and capability caps, adapts quality before a 480-long-edge fallback and JPEG, and tries the prior successful profile first on later frames. The server model remains the pinned 320 input and is not relabeled as 640 inference.
- Replaced dashboard-style telemetry with one compact, accessible runtime chip while preserving truthful engine, provider, fallback, processing-location, and private-upload-consent copy.

## Files changed

- `lib/gesture/hand-runtime-profile.ts`
- `lib/gesture/hand-runtime-profile.test.ts`
- `lib/gesture/hand-tracking-controller.ts`
- `lib/gesture/hand-tracking-controller.test.ts`
- `lib/gesture/hand-tracking-worker-core.ts`
- `lib/gesture/hand-tracking-worker-core.test.ts`
- `lib/gesture/private-hand-relay-worker.ts`
- `lib/gesture/private-hand-relay-worker.test.ts`
- `components/command-canvas/spatial-camera-control.tsx`
- `components/command-canvas/spatial-camera-control.test.tsx`
- `app/globals.css`

## TDD evidence

All commands used Node `v22.14.0` with `TMPDIR=/tmp`, `TEMP=/tmp`, and `TMP=/tmp`.

### RED — approved runtime contract

Command:

```bash
npm test -- lib/gesture/hand-runtime-profile.test.ts lib/gesture/hand-tracking-controller.test.ts lib/gesture/hand-tracking-worker-core.test.ts lib/gesture/private-hand-relay-worker.test.ts components/command-canvas/spatial-camera-control.test.tsx
```

Observed before production edits:

```text
Test Files  5 failed (5)
Tests  11 failed | 51 passed (62)
```

The failures proved the missing runtime-profile module, detector wall-time metric, rVFC scheduling, rAF frame deduplication, first-plus-newest bitmap queue, engine-epoch closure, startup performance fallback, stale-result boundary, metric throttle/render acknowledgement, 640/131,072-byte relay target, adaptive encoder, and compact diagnostics.

### GREEN — approved runtime contract

The combined focused suite passed after the implementation:

```text
Test Files  5 passed (5)
Tests  69 passed (69)
```

### RED/GREEN — render timestamp normalization review

A fractional capture timestamp with more than six decimal places initially failed render acknowledgement:

```text
Test Files  1 failed (1)
Tests  1 failed | 7 passed (8)
```

The acknowledgement lookup now normalizes the timestamp identically to result ingestion:

```text
Test Files  1 passed (1)
Tests  8 passed (8)
```

### RED/GREEN — inaccessible session storage review

An injected storage adapter throwing `SecurityError` initially escaped from `savePreference`:

```text
Test Files  1 failed (1)
Tests  1 failed | 8 passed (9)
```

Preference reads and writes now fail safely without affecting tracking:

```text
Test Files  1 passed (1)
Tests  9 passed (9)
```

Final combined focused verification after both review fixes:

```text
Test Files  5 passed (5)
Tests  71 passed (71)
```

## Verification evidence

Static checks:

```text
npm run typecheck       exit 0
npm run lint -- --quiet exit 0
```

Full unit/component suite after the main implementation:

```text
Test Files  97 passed (97)
Tests  960 passed (960)
```

The two subsequent review cases were each exercised fail-before-fix and pass-after-fix as recorded above.

Worker build:

```text
public/workers/yolo-hand-pose.js   850.7kb
public/workers/hand-landmarker.js  152.4kb
Done in 80ms
```

Production build:

```text
next build --webpack
Compiled successfully in 4.7s
Finished TypeScript in 7.5s
Generating static pages (13/13)
```

The sibling worktree deliberately symlinks `node_modules` to the main checkout. Next 16 Turbopack refuses that out-of-root symlink before compiling source, so the production verification temporarily disabled the TypeScript CLI/build worker and used webpack. The first sandboxed run then truthfully failed only because `next/font` could not resolve `fonts.googleapis.com`; the permitted networked rerun fetched the configured Geist assets and passed. Both verification-only Next configuration changes were reverted and are not part of this task.

System-Chrome YOLO worker contract:

```text
1 passed — loads the pinned YOLO 21-keypoint model and completes one browser inference
```

The browser loaded the locally built worker, ONNX Runtime assets, and pinned 320 model, then completed one real browser inference. This is a worker/model contract check, not physical-hand or RTX evidence.

## Running verification ledger

### WORKING

- Bounded startup/runtime metrics, exact threshold decisions, safe session/model preference, and drop accounting.
- rVFC-first scheduling, rAF current-time deduplication, first-plus-newest queueing, bitmap cleanup, engine-epoch isolation, stale-result gating, and render acknowledgement.
- Detector-call wall-time reporting.
- Adaptive 640 browser relay source encoding with aspect/capability/byte bounds and successful-profile reuse.
- Compact truthful runtime diagnostics with accessible labeling.

### VERIFIED IN BROWSER

- System Chrome loaded the built YOLO worker, pinned model, and ONNX Runtime and returned a valid result from one inference.
- No claim is made that a blank synthetic canvas validates hand accuracy, smoothness, or gesture quality.

### UNVERIFIED

- Physical camera, physical hand, real lighting/occlusion, pinch ergonomics, two-hand behavior, touch/stylus hardware, and perceived smoothness.
- RTX 3090 Ti/private-relay throughput, shared-GPU behavior, and real network latency; those belong to Task 6 and Task 7.
- Fake-camera Playwright runtime because this worktree has no absolute `.y4m` fixture configured through `COMMANDCANVAS_FAKE_CAMERA_PATH`.
- A fresh WebKit worker run and public/ChatGPT built-in-browser behavior.
- Public deployment behavior; this task did not deploy or mutate external infrastructure.

### CUT / OUT OF TASK 5

- No gesture business-logic changes, calibration changes, sticky targeting, transform-state changes, new symbolic gestures, or destructive gesture semantics.
- No RTMPose promotion, private RTX model deployment, public release, push, migration, or secret handling.

## Evidence boundary

Task 5 verifies deterministic scheduling, metrics, fallback policy, relay encoding, cleanup, and browser worker execution. It does **not** verify or claim physical smoothness, user ergonomics, RTX performance, public deployment, or ChatGPT host behavior.
