# Third-Party Notices

CommandCanvas includes the following third-party runtime for local,
browser-based hand landmark detection.

## MediaPipe Tasks Vision

- Package: `@mediapipe/tasks-vision`
- Version: `1.0.1`
- Copyright holder: Google LLC and the MediaPipe Authors
- License: Apache License 2.0
- Package: <https://www.npmjs.com/package/@mediapipe/tasks-vision/v/1.0.1>
- Source: <https://github.com/google-ai-edge/mediapipe>
- License text: <https://github.com/google-ai-edge/mediapipe/blob/master/LICENSE>

The hand-tracking worker is bundled with legal comments preserved at the end
of the generated JavaScript bundle. The package's WebAssembly runtime files
are copied unchanged from the pinned npm dependency.

## MediaPipe Hand Landmarker runtime model

The detector model is retrieved from Google at runtime only after the user
enables hand input.

- Runtime URL: <https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task>
- Official model documentation: <https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker>
- Official Google MediaPipe web sample using this exact URL: <https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/tasks/hand-landmarker.ts>

CommandCanvas does not bundle or redistribute the detector model and makes no
separate licensing claim for it. Camera frames remain in the browser; the model
request goes from the user's browser to Google only when hand input is enabled.
