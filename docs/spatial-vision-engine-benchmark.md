# Spatial vision engine benchmark

## Release decision

CommandCanvas needs 21 normalized hand landmarks, confidence, and stable
two-hand continuity. A bounding-box detector is not enough: index-fingertip
drawing, pinch hysteresis, resize geometry, reacquisition, and open-palm state
all depend on landmark geometry.

The MIT browser release therefore uses MediaPipe Hand Landmarker as its local
default. It starts in a worker and uses the same permissively licensed
MediaPipe package and model in-page only when the worker path fails. The
browser bundle does not ship a YOLO detector, YOLO worker, ONNX Runtime Web, or
model weights.

An optional private GPU relay is a separate processing location selected only
after explicit camera-upload consent. The browser retains the protocol,
authorization, semantic-result validation, and local recovery client. The GPU
service, model, and operations source live outside this MIT repository.

## Replaceable contract

`lib/gesture/spatial-vision-engine.ts` defines:

- engine identity, role, runtime, and model version;
- `hand-pose-keypoints` output with exactly 21 landmarks;
- detector load options;
- an optional worker entry point;
- license-review and target-device-evidence status.

Gesture interpretation and canvas mutations consume normalized observations,
not an engine ID. A future detector may replace the local default only after
its redistribution license and target-device evidence are both reviewed.

## Target-device protocol

Use `lib/gesture/spatial-vision-benchmark.ts` for calculations. Fixture tests
validate the math but cannot support an engine-quality claim.

For a controlled comparison:

1. Record one front-camera sequence at actual CommandCanvas framing.
2. Include no-hand, acquisition, stationary point, slow movement, pinch hold
   and release, rapid reacquisition, partial occlusion, two-hand pinch, and
   throw/minimize motion.
3. Label truth independently from every candidate engine.
4. Run every engine over identical bytes and record the source SHA-256,
   browser/device/capture profile, exact dependency/model revision, license,
   model bytes, and protocol ID.
5. Repeat the same sequence live on the target phone and desktop camera to
   measure startup, thermal, memory, and interaction behavior.

Record acquisition rate, tracking continuity, stationary jitter, pinch latency
median and p95, missed pinches, false grabs/releases, two-hand continuity,
delivered result rate, inference latency, startup, model bytes, memory when
observable, and device-heating notes. Do not collapse these into one score.

## Current evidence boundary

- Unit tests cover the MediaPipe worker default and same-model in-page recovery.
- Generated browser assets contain the MediaPipe worker and WASM runtime only.
- Earlier local YOLO and native CUDA measurements belong to a superseded
  combined AGPL build and do not prove the current MIT browser release.
- Exact-release desktop and mobile browser runs exercised camera permission,
  MediaPipe worker/model/WASM loading, labeled desktop recovery, detachment, and
  track shutdown with controlled media.
- No current MediaPipe physical-iPhone human-hand benchmark has been recorded.
- Pointer, touch, and stylus remain explicit always-available fallbacks.

Until the target-device protocol is recorded against the exact release,
physical accuracy, smoothness, lighting behavior, occlusion handling, latency,
thermals, and ergonomics remain unverified.
