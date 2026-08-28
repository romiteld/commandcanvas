# Third-Party Notices

CommandCanvas includes third-party runtimes for local browser hand-landmark
detection and for the optional native CUDA relay. The same pinned YOLO model is
used in both paths.

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
separate licensing claim for it. MediaPipe is attempted only as a visibly
labeled recovery engine after local YOLO fails. Its model download request does
not contain a camera frame. Camera frames stay in the browser while a local
engine is selected. The separate private-GPU path is described below and is
used only after explicit camera-upload consent.

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

## Native CUDA relay runtime

The optional private hand relay uses these directly relevant native packages.
The complete exact dependency set is pinned in
`services/hand-relay/requirements.lock`.

| Package | Version | License | Upstream source |
| --- | --- | --- | --- |
| `onnxruntime-gpu` | `1.23.2` | MIT | <https://github.com/microsoft/onnxruntime> |
| `FastAPI` | `0.115.6` | MIT | <https://github.com/fastapi/fastapi> |
| `Starlette` | `0.41.3` | BSD-3-Clause | <https://github.com/encode/starlette> |
| `Uvicorn` | `0.34.0` | BSD-3-Clause | <https://github.com/encode/uvicorn> |
| `websockets` | `13.1` | BSD-3-Clause | <https://github.com/python-websockets/websockets> |
| `NumPy` | `2.2.6` | BSD-3-Clause | <https://github.com/numpy/numpy> |
| `Pillow` | `11.3.0` | HPND | <https://github.com/python-pillow/Pillow> |
| `Pydantic` | `2.10.6` | MIT | <https://github.com/pydantic/pydantic> |
| `nvidia-ml-py` | `13.580.82` | BSD-3-Clause | <https://github.com/gpuopenanalytics/pynvml> |

The relay requires ONNX Runtime's `CUDAExecutionProvider` and refuses CPU
execution-provider fallback. It receives at most one bounded JPEG or WebP frame
at a time after explicit browser consent, performs in-memory decode and native
inference, does not retain raw frames, and returns semantic landmarks. The
no-retention claim applies to the CommandCanvas relay process. The reverse
proxy, firewall, container runtime, and hosting edge remain separate trust
boundaries and are configured not to log WebSocket bodies or capability tokens.

## YOLO26 Hand Pose runtime model

CommandCanvas includes a 320 by 320 FP16 ONNX export derived from one pinned
Hugging Face checkpoint. The browser serves it from the application origin for
local ONNX Runtime Web inference. The native CUDA relay mounts the identical
tracked artifact read-only and verifies its digest and tensor shapes before
warmup. Both uses remain within the same AGPL-3.0-only CommandCanvas release.

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
