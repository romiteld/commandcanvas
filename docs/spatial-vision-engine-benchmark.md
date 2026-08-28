# Spatial vision engine benchmark

## Decision boundary

CommandCanvas needs 21 normalized hand keypoints, handedness, confidence, and
two-hand continuity. A generic YOLO bounding-box detector cannot supply the
index fingertip, thumb-to-index distance, pinch hysteresis, or two-hand resize
geometry, so a bounding-box-only model is not an eligible replacement.

The engine plan now selects the pinned YOLO hand-pose engine as primary and
labels MediaPipe Hand Landmarker as the initialization/runtime fallback. The
primary designation is based on the requested product direction plus a real
Chromium worker/model inference smoke test. It is not a claim that YOLO has
better physical-device interaction quality; that still requires the protocol
below.

## Replaceable contract

`lib/gesture/spatial-vision-engine.ts` describes the detector/runtime boundary:

- engine identity and model version;
- `hand-pose-keypoints` output with exactly 21 keypoints;
- worker compatibility, when a compatible worker exists;
- detector load options and normalized detector loader;
- license-review and target-device-evidence status.

Engines without a compatible worker must use the controller's local in-page
detector endpoint. Camera frames still stay in the browser. Gesture
interpretation and canvas mutation code must not depend on the engine ID.

## Candidate review

The following Hugging Face artifacts were reviewed. The first supplies the
checkpoint used by the production YOLO engine; the others were not accepted as
production dependencies:

| Candidate | Relevant capability | Current blocker |
| --- | --- | --- |
| [poptoz/yolo26-hand-pose-face-detection](https://huggingface.co/poptoz/yolo26-hand-pose-face-detection) | The pinned checkpoint was exported as FP16 ONNX at `[1,3,320,320]`; output remains `[1,300,69]`. Real Chromium inference returned 21 keypoints for a CC0 bare-hand image. The release selects the model vendor's AGPL open-source path; exact provenance and Corresponding Source are recorded in `SOURCE.md`. | Live iPhone interaction quality is unverified. The release must expose a browser-visible link to the exact public source commit before deployment. |
| [opencv/handpose_estimation_mediapipe](https://huggingface.co/opencv/handpose_estimation_mediapipe) | 21-keypoint ONNX hand-pose model | Requires a separate palm detector and is derived from the same MediaPipe path, so it is not yet evidence of an interaction improvement. |
| [STMicroelectronics/hand_landmarks](https://huggingface.co/STMicroelectronics/hand_landmarks) | Quantized TFLite landmarks | Targeted at an embedded NPU workflow; no browser/iPhone adapter or target evidence is present. |

Before downloading or deploying another candidate, record the exact repository,
revision, artifact hash, model bytes, license source, and whether browser
redistribution is permitted. `unverified-do-not-ship` is a benchmarkable state,
not a release approval.

The primary source checkpoint is pinned to revision
`2abb91a7030e1aa5231ec900ccb2c07ab3f03460`, 25,228,590 bytes, SHA-256
`39cb54e63cac0d8905d7cab2112430dc9bf60a26779e361165fc03bf9c6ca36d`.
Ultralytics `8.4.33` exported the production graph with image size `320`,
opset `17`, simplification, and FP16 conversion. The same-origin artifact is
21,447,188 bytes with SHA-256
`07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc`.

## Target-device protocol

Use the recorder and schemas in
`lib/gesture/spatial-vision-benchmark.ts`. Fixture runs can validate the
calculation code but cannot support an engine replacement claim.

For a controlled recorded comparison:

1. Capture one front-camera iPhone video at the real CommandCanvas framing.
2. Include no-hand, acquisition, stationary point, slow movement, pinch-hold,
   release, rapid re-acquisition, partial occlusion, two-hand pinch, and the
   throw/minimize motion.
3. Label truth independently. Do not use MediaPipe-generated labels as the
   ground truth for a MediaPipe-versus-YOLO comparison.
4. Run both engines against the exact same bytes and store the recording
   SHA-256, device/browser/capture profile, and scripted protocol ID.
5. Export one validated benchmark run per engine.

Then repeat the scripted sequence live on the target iPhone. Live runs must use
the same device, browser, orientation, lighting class, distance, and protocol.
They are useful for startup, thermal, memory, and interaction-latency evidence;
they are not treated as the same underlying frames.

## Recorded metrics

The harness records and calculates:

- hand acquisition rate;
- longest-streak tracking continuity;
- stationary pointer jitter after removing constant bias;
- pinch latency median and p95;
- missed pinches;
- false grab and false release transitions;
- two-hand continuity;
- observed frame rate;
- inference latency median and p95;
- startup time;
- model bytes;
- peak memory when observable;
- explicit memory and device-heating notes.

The comparison output is candidate-minus-baseline metric deltas. It deliberately
has no aggregate score and no automatic winner. A candidate may replace the
default only after license review and real target-device evidence show that it
improves the difficult interaction states without regressing false grabs,
false releases, pinch latency, two-hand continuity, startup, or device thermal
behavior.

## Current evidence

- The engine plan makes YOLO primary and MediaPipe the labeled fallback.
- The new contract and metric calculations have deterministic unit coverage.
- ONNX Runtime Web and the dedicated YOLO worker are implemented. The optimized
  320-pixel model is served from the application origin.
- COOP/COEP isolation enables bounded multithreaded WASM inference when the
  browser permits it; WebGPU remains the preferred execution provider.
- A real Chromium worker/model smoke test loaded the exact production model
  and completed inference.
- Three controlled inferences on the same CC0 bare-hand image each returned one
  hand and exactly 21 keypoints at `0.92822265625` confidence. Startup measured
  `1,837.870 ms`; inference measured `261.035`, `109.505`, and `96.815 ms` in
  headless Chromium's threaded WASM path. The warm measurement is approximately
  `10.33 FPS`. This is real-image parser and runtime evidence, not a live-camera
  or target-device ergonomics claim.
- No candidate-versus-MediaPipe iPhone benchmark artifact has been recorded in
  this repository yet. Until that happens, physical accuracy, latency,
  occlusion behavior, and ergonomics remain unverified.
