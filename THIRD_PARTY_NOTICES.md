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

## ONNX Runtime Web

- Package: `onnxruntime-web`
- Version: `1.29.0`
- Copyright holder: Microsoft Corporation
- License: MIT
- Package: <https://www.npmjs.com/package/onnxruntime-web/v/1.29.0>
- Source: <https://github.com/microsoft/onnxruntime>
- License text: <https://github.com/microsoft/onnxruntime/blob/main/LICENSE>

The generated YOLO worker uses ONNX Runtime Web locally. Its WebAssembly
runtime files are copied unchanged from the pinned npm dependency during the
application build.

## YOLO26 Hand Pose runtime model

CommandCanvas includes a 320 by 320 FP16 ONNX export derived from one pinned
Hugging Face checkpoint. Serving the artifact from the application origin
removes a runtime model-host dependency and enables cross-origin-isolated,
multithreaded ONNX Runtime Web inference.

- Repository: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection>
- Revision: `2abb91a7030e1aa5231ec900ccb2c07ab3f03460`
- Pinned model card: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/blob/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/README.md>
- Source checkpoint: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/resolve/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/checkpoints/yolo26_hand_pose.pt>
- Pinned training script: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/blob/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/scripts/train_hand_pose.sh>
- Pinned upstream export script: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/blob/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/scripts/export_onnx.sh>
- Source checkpoint size: 25,228,590 bytes
- Source checkpoint SHA-256: `39cb54e63cac0d8905d7cab2112430dc9bf60a26779e361165fc03bf9c6ca36d`
- Exporter: Ultralytics `8.4.33`, image size `320`, ONNX opset `17`,
  simplified FP16 graph
- Local artifact: `public/models/yolo26_hand_pose_320_fp16.onnx`
- Local artifact size: 21,447,188 bytes
- Local artifact SHA-256: `07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc`
- Output: 21 hand keypoints, according to the repository model card and the
  inspected ONNX tensor shape `[1,300,69]`
- Base implementation: <https://github.com/ultralytics/ultralytics>
- Ultralytics licensing guidance: <https://www.ultralytics.com/license>
- Ultralytics AGPL text: <https://www.ultralytics.com/legal/agpl-3-0-software-license>
- License: AGPL-3.0-only for the CommandCanvas distribution
- CommandCanvas source: <https://github.com/romiteld/commandcanvas>
- Export and Corresponding Source manifest: [SOURCE.md](SOURCE.md)

The pinned repository contains no separate `LICENSE` file or repository-level
license metadata. Its model card states that its training code is MIT licensed
and that its YOLO26 base model is available under AGPL-3.0 or an Ultralytics
Enterprise License. CommandCanvas does not apply the training-code MIT label to
the trained checkpoint or its ONNX export.

Ultralytics' current published guidance says all Ultralytics trained models are
AGPL-3.0 by default and directs projects using those models to open-source the
entire project under AGPL-3.0 or obtain an Enterprise License. CommandCanvas
uses that stated open-source path: this release, including the embedded ONNX
export and its larger application, is licensed under AGPL-3.0-only. The full
license text is in [LICENSE](LICENSE), and the exact model inputs, export
recipe, runtime source paths, and public source repository are in
[SOURCE.md](SOURCE.md).
