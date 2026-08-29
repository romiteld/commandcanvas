# Third-Party Notices

CommandCanvas uses the following third-party browser package for local hand
landmark detection.

## MediaPipe Tasks Vision

- Package: `@mediapipe/tasks-vision`
- Version: `1.0.1`
- Copyright holder: Google LLC and the MediaPipe Authors
- License: Apache License 2.0
- Package: <https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.0.1>
- Source: <https://github.com/google-ai-edge/mediapipe>
- License text: <https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE>

MediaPipe is the browser hand-landmark engine. Its JavaScript and WebAssembly
runtime files are bundled or copied from the pinned package by
`scripts/build-hand-worker.mjs`, with upstream legal comments retained in the
generated worker.

## MediaPipe Hand Landmarker runtime model

The detector model is retrieved from Google at runtime only after the user
enables hand input.

- Runtime URL: <https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task>
- Official model documentation: <https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker>
- Official Google MediaPipe web sample using this URL: <https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/tasks/hand-landmarker.ts>

CommandCanvas does not bundle or redistribute the detector model and makes no
separate licensing claim for it. The model request contains no camera frame.
Camera frames remain in the browser while the local engine is selected.

The optional consent-gated private GPU relay is a separately distributed
service. Its native dependencies, model artifacts, license, corresponding
source, and operations are not part of this application repository or this
third-party inventory.
