# Corresponding Source

CommandCanvas Hand Relay is released under the GNU Affero General Public
License, version 3 only. This local repository contains the relay's service,
container configuration, operations, tests, pinned model artifacts, dependency
locks, and source manifest.

## Public corresponding source

- Repository: <https://github.com/romiteld/commandcanvas-hand-relay>
- Verified CUDA image source:
  <https://github.com/romiteld/commandcanvas-hand-relay/commit/9f652a67dbe2c824ee68f7985ab13bb0af56ae6f>
- Dated local CUDA evidence:
  <https://github.com/romiteld/commandcanvas-hand-relay/blob/main/docs/local-cuda-verification-2026-08-29.md>

The verified image was built from the exact source commit above. A newer or
older branch is not a substitute for the source of running relay bytes.

Private credentials, host configuration, firewall state, and deployment data
are not source artifacts. `services/hand-relay/.env.example` records only the
required configuration names and roles.

## Hand-pose model provenance

Both tracked ONNX artifacts originate from the same pinned Hugging Face model
repository:

- Repository: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection>
- Revision: `2abb91a7030e1aa5231ec900ccb2c07ab3f03460`
- Pinned model card: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/blob/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/README.md>
- Source checkpoint: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/resolve/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/checkpoints/yolo26_hand_pose.pt>
- Source checkpoint size: 25,228,590 bytes
- Source checkpoint SHA-256: `39cb54e63cac0d8905d7cab2112430dc9bf60a26779e361165fc03bf9c6ca36d`
- Base implementation: <https://github.com/ultralytics/ultralytics>
- Pinned training script: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/blob/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/scripts/train_hand_pose.sh>
- Pinned export script: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/blob/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/scripts/export_onnx.sh>

The model card identifies its training code as MIT and its Ultralytics YOLO26
base as AGPL-3.0 or available under an Ultralytics Enterprise License. It does
not separately identify the trained checkpoint or ONNX exports as MIT. This
repository therefore keeps the service and its distributed model artifacts on
the AGPL-3.0-only open-source path.

### Production 640-pixel model

- Artifact: `services/hand-relay/models/yolo26_hand_pose_640_fp16.onnx`
- Pinned download: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/resolve/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/models/yolo26_hand_pose_fp16.onnx>
- Size: 21,547,949 bytes
- SHA-256: `f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e`
- Input: `images tensor(float) [1,3,640,640]`
- Output: `output0 tensor(float) [1,300,69]`
- ONNX IR version: 8
- ONNX opset: 17

### Rollback 320-pixel model

- Artifact: `public/models/yolo26_hand_pose_320_fp16.onnx`
- Size: 21,447,188 bytes
- SHA-256: `07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc`
- Input: `[1,3,320,320]`
- Output: `[1,300,69]`
- Exporter: Ultralytics `8.4.33`, image size `320`, ONNX opset `17`,
  simplified FP16 graph

The upstream 640 graph was inspected with ONNX Runtime 1.23.1. `onnx.checker`
reported a topological-sort validation error at `graph_input_cast_0`; this
repository does not represent that separate check as passing. Container startup
still verifies exact bytes, digest, tensor names/shapes, active CUDA provider,
and finite warmup output before reporting ready.

## Runtime and operations source

- `services/hand-relay/commandcanvas_hand_relay/`
- `services/hand-relay/tests/`
- `services/hand-relay/Dockerfile`
- `services/hand-relay/compose.yaml`
- `services/hand-relay/requirements.lock`
- `services/hand-relay/requirements-ci.lock`
- `services/hand-relay/requirements-dev.lock`
- `services/hand-relay/.env.example`
- `ops/hand-relay/caddy/hand-relay.Caddyfile`
- `ops/hand-relay/manage-caddy-route.sh`
- `ops/hand-relay/tests/manage-caddy-route.test.sh`

The production image copies the exact tracked 640 artifact into an immutable
image after build-time size and SHA-256 checks. The separately tagged rollback
image does the same for the tracked 320 artifact. Neither image downloads or
substitutes a model at runtime.

The MIT-licensed CommandCanvas web application is deliberately not part of
this corresponding-source repository. Its separately distributed relay client
uses the documented `commandcanvas.private-hand-relay.v1` protocol and contains
none of these model or CUDA service artifacts.
