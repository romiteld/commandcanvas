# Spatial vision engine benchmark record

## Decision boundary

CommandCanvas needs 21 normalized hand keypoints, handedness, confidence, and
two-hand continuity. A generic YOLO bounding-box detector cannot supply the
index fingertip, thumb-to-index distance, pinch hysteresis, or two-hand resize
geometry, so a bounding-box-only model is not an eligible replacement.

The current MIT application uses MediaPipe Hand Landmarker locally. The pinned
YOLO hand-pose engine exists only in this separately distributed AGPL relay and
is selected after explicit camera-upload consent. Relay failure returns to
local MediaPipe. Earlier browser-YOLO measurements below are retained as dated
model-selection evidence, not as a description of the shipping browser bundle
and not as proof that YOLO has better physical-device interaction quality.

## Replaceable contract

The application and relay share a versioned semantic boundary that describes:

- engine identity and model version;
- `hand-pose-keypoints` output with exactly 21 keypoints;
- worker compatibility, when a compatible worker exists;
- detector load options and normalized detector loader;
- license-review and target-device-evidence status.

The application runs MediaPipe in a worker with an in-page MediaPipe recovery
path. Camera frames stay in the browser in local mode. The native CUDA relay is
selected only after explicit camera-upload consent; it accepts bounded
newest-only JPEG/WebP frames while Hand input is active and returns semantic
landmarks without raw retention. Gesture interpretation and canvas mutation
code do not depend on the engine ID or processing location.

## Candidate review

The following Hugging Face artifacts were reviewed. The first supplies the
checkpoint used by the production YOLO engine; the others were not accepted as
production dependencies:

| Candidate | Relevant capability | Current blocker |
| --- | --- | --- |
| [poptoz/yolo26-hand-pose-face-detection](https://huggingface.co/poptoz/yolo26-hand-pose-face-detection) | The production relay pins the upstream FP16 ONNX artifact at `[1,3,640,640]`; output is `[1,300,69]`. A historical 320 export was also benchmarked in a browser candidate. The release selects the model vendor's AGPL open-source path; exact provenance and Corresponding Source are recorded in `SOURCE.md`. | Live iPhone interaction quality is unverified. The exact public source commit is linked from `SOURCE.md`. |
| [tasmulaev/rtmpose-m-distill](https://huggingface.co/tasmulaev/rtmpose-m-distill/tree/ec0d56fdf55a350106671e763338a4a76372a888) | Apache-2.0, motion-blur-tuned 21-landmark ONNX challenger. The pinned 55,118,513-byte artifact has SHA-256 `6d50664e566fffee41a090c98f75e893b50846a753b802dbf5e2072a8dfd7784` and accepts a batch of 256-pixel hand crops. | Top-down pose model, so it requires a separately verified detector and crop transform. Published jitter gains are self-reported against pseudo-labels rather than an independent CommandCanvas capture set. |
| [Tau-J/RTMPose RTMDet-nano hand detector](https://huggingface.co/Tau-J/RTMPose/tree/cd4d7095f5cfc9cfc4f46289bee91ea4a1e1d9fd/rtmposev1/onnx_sdk) | Apache-2.0 detector challenger. The pinned archive is 3,840,129 bytes with SHA-256 `9c0370a43c02b2fe42b4382aba7383d97cfa3ed35623b655cac4f0c25cfde402`; its ONNX input is `[1,3,320,320]` and outputs bounded boxes plus labels. | It is a detector, not a gesture model. It must be paired with a 21-landmark model, stable track IDs, ROI reuse, and measured end-to-end latency. |
| [opencv/handpose_estimation_mediapipe](https://huggingface.co/opencv/handpose_estimation_mediapipe) | 21-keypoint ONNX hand-pose model | Requires a separate palm detector and is derived from the same MediaPipe path, so it is not yet evidence of an interaction improvement. |
| [STMicroelectronics/hand_landmarks](https://huggingface.co/STMicroelectronics/hand_landmarks) | Quantized TFLite landmarks | Targeted at an embedded NPU workflow; no browser/iPhone adapter or target evidence is present. |

Before downloading or deploying another candidate, record the exact repository,
revision, artifact hash, model bytes, license source, and whether browser
redistribution is permitted. `unverified-do-not-ship` is a benchmarkable state,
not a release approval.

The source checkpoint is pinned to revision
`2abb91a7030e1aa5231ec900ccb2c07ab3f03460`, 25,228,590 bytes, SHA-256
`39cb54e63cac0d8905d7cab2112430dc9bf60a26779e361165fc03bf9c6ca36d`.
The production relay uses the tracked upstream 640-pixel FP16 artifact. Its
21,547,949 bytes have SHA-256
`f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e`.
The separately tracked 320-pixel rollback artifact is 21,447,188 bytes with
SHA-256
`07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc`.

## Target-device protocol

Use a recorder and versioned benchmark schema from the CommandCanvas
application. Fixture runs can validate calculation code but cannot support an
engine replacement claim.

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

- The MIT application ships local MediaPipe in a worker with an in-page
  MediaPipe recovery path. It does not distribute YOLO, ONNX Runtime Web, or a
  YOLO model.
- The AGPL relay ships the pinned YOLO hand-pose model and native CUDA service.
- The semantic engine contract and benchmark calculations have deterministic
  unit coverage.
- A historical browser-YOLO candidate loaded the 320-pixel rollback artifact
  and completed real Chromium inference before the license/runtime isolation.
- In that historical browser candidate, three controlled inferences on the same
  CC0 bare-hand image each returned one
  hand and exactly 21 keypoints at `0.92822265625` confidence. Startup measured
  `1,837.870 ms`; inference measured `261.035`, `109.505`, and `96.815 ms` in
  headless Chromium's threaded WASM path. The warm measurement is approximately
  `10.33 FPS`. This is real-image parser and runtime evidence, not a live-camera
  or target-device ergonomics claim.
- No candidate-versus-MediaPipe iPhone benchmark artifact has been recorded in
  this repository yet. Until that happens, physical accuracy, latency,
  occlusion behavior, and ergonomics remain unverified.
- Two user-supplied iPhone screenshots were used only as a harsh smoke test.
  They contain the existing UI and MediaPipe overlay and therefore are not raw
  ground truth. The current one-stage YOLO checkpoint returned no hand at the
  production `0.45` threshold on either cropped camera tile; its highest raw
  scores were `0.039337` for the open-hand image and `0.028061` for the pinch
  image. Lowering the threshold to those values would not be a defensible fix.
- On the same two contaminated tiles, pinned RTMDet-nano acquired the open hand
  at `0.481` and the pinched hand at `0.760`. Feeding the resulting padded ROI
  into pinned RTMPose-m Distill produced all 21 landmarks. The open-hand
  thumb-to-index distance normalized by palm length was `1.039`; the pinched
  state measured `0.369`. Twenty warmed detector-plus-pose runs on the RTX 3090
  measured `8.554 ms` p50 and `10.055 ms` p95 for open, and `8.228 ms` p50 and
  `9.667 ms` p95 for pinch. These values are candidate feasibility evidence,
  not physical-device accuracy or interaction proof.
- The packaged hybrid relay subsequently passed actual RTX 3090 startup and an
  authenticated v1 WebSocket smoke test against those same two crops. Twenty
  open frames and twenty pinch frames each returned at least one hand with
  exactly 21 landmarks. Warm service latency measured `19.660 ms` p50 and
  `30.119 ms` p95 for open, and `14.297 ms` p50 and `15.830 ms` p95 for pinch;
  authenticated in-container round trip measured approximately `33 ms` p50.
  The median normalized thumb/index ratio separated the two fixtures at
  `1.125` versus `0.311`. This confirms the packaged CUDA and protocol path,
  not live-camera continuity or physical interaction quality.
- The available 52.224-second, 1668-by-988 phone-session recording is a 30 FPS
  screen capture with the camera already downscaled, composited, H.264 encoded,
  and partly covered by landmark UI. It is unsuitable as raw model ground
  truth. A replacement decision requires a consented pre-overlay `getUserMedia`
  clip covering point, draw, pinch/release, edge reach, motion blur, occlusion,
  and two-hand crossing against identical decoded frames.
- The installed native relay reported a warmed
  `CUDAExecutionProvider` on `NVIDIA GeForce RTX 3090 (CUDA device 0)` using
  the exact same pinned model. A CC0 static hand image produced one hand at
  confidence `0.934082` with 21 finite landmarks. Across 200 warmed native
  repeats, p50 was `7.652 ms`, p95 was `11.016 ms`, and throughput was
  `122.013` results per second. These values exclude live capture, encode,
  network, decode scheduling, and physical interaction.
- The separately packaged true-640 relay was then rebuilt and exercised on the
  same RTX 3090. A bounded CC0 static hand fixture produced one hand in every
  one of 200 warmed repeats; p50 was `6.874 ms`, p95 was `9.272 ms`, and mean
  throughput was `140.376` results per second. An authenticated ten-frame v1
  WebSocket session returned one hand with 21 landmarks for every frame and
  reported p50 service latency of `22.181 ms`. The complete dated evidence and
  remaining boundaries are in
  [`local-cuda-verification-2026-08-29.md`](local-cuda-verification-2026-08-29.md).
- A real rendered-UI recording recognized open-palm state and displayed pinch
  ratios between 0.22 and 0.28. The recording also demonstrated that the old
  preview-shaped movement boundary was a usability failure. The current source
  instead maps a comfortable central camera region across the full canvas and
  treats the preview as a collapsible sensor check. Reducer and component tests
  cover that mapping; physical post-fix reach and pinch ergonomics remain
  unverified.
