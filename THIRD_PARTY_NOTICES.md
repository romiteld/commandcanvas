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

## HaGRIDv2 compact hand-pose classifier

CommandCanvas redistributes a compact, browser-side pose-classification
artifact at
`public/models/commandcanvas-hagrid-v2-static-pose-model-v1.json`. It was
trained from the auto-annotated 21-landmark records in HaGRIDv2 and then
losslessly compacted for static-pose inference. It recognizes supporting pose
evidence for pointing, open palm, pinch, held-like, and idle states; the
canonical CommandCanvas geometry and state machine remain responsible for
acquisition, temporal, bimanual, edge, destructive, and consequential actions.

- Dataset: HaGRIDv2-1M
- Dataset repository credits: Alexander Kapitanov, Andrey Makhlyarchuk,
  Karina Kvanchiani, Aleksandr Nagaev, Roman Kraynov, and Anton Nuzhdin
- HaGRIDv2 paper authors: Anton Nuzhdin, Alexander Nagaev, Alexander Sautin,
  Alexander Kapitanov, and Karina Kvanchiani
- Dataset repository and citation: <https://github.com/hukenovs/hagrid>
- Dataset and derived artifact license:
  `LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved`
- Exact pinned license text:
  <https://raw.githubusercontent.com/hukenovs/hagrid/080e18917376ec935e453cd0e599c23478c7e98f/license/en_us.pdf>
- Pinned license PDF SHA-256:
  `14f4845e9c8d3de875cbac4139491da368ab1040a7f565e02894477279134d22`
- Source annotation archive SHA-256:
  `ca27a177cc9f061e92d59f6a7d9b1b10fe2ee8289ab5f2068cde6ab197d2a286`
- Full evaluated source-model SHA-256:
  `0a91b4f3ba33fc76f8d41bd044e8b91125390c744d6f7d3628bca003c75d140f`
- Compact artifact SHA-256:
  `5ef015bdf99bbe1301beb6dd36616f8c9e2a9661fad042ac8e0e839691b4df42`

CommandCanvas made these changes to the licensed material: extracted the
provided hand landmarks, mapped a bounded subset of source labels into five
CommandCanvas pose-evidence labels, trained a neutral-context multinomial
logistic classifier on the official subject-separated partitions, and
losslessly compacted the evaluated static model from repeated-frame features
to one 72-feature pose vector. The resulting model artifact is distributed
under the same HaGRID Public License named above. It is provided as-is, without
warranty or endorsement by the HaGRID authors or licensors.

The root MIT license covers the CommandCanvas application code. It does not
replace or relicense this separately identified, same-license HaGRID-derived
model artifact.
