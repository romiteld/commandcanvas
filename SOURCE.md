# Corresponding Source

CommandCanvas Hand Relay is licensed under the GNU Affero General Public
License, version 3 only. This local repository contains the relay's service,
container configuration, operations, tests, pinned model artifacts, dependency
locks, and source manifest.

## Publication status

This checkout is local and unpublished. It is not currently a public
corresponding-source repository, and no public source-commit link exists.

The public service must remain disabled until a public corresponding-source
repository exists and this file links the exact source commit used to build the
image that would be served publicly. A branch reference, local commit hash, or
local verification record is not a substitute for that public source link.

The dated CUDA evidence remains a local verification record:
[`docs/local-cuda-verification-2026-08-29.md`](docs/local-cuda-verification-2026-08-29.md).
It does not establish public source availability.

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

## Opt-in RTMDet + RTMPose candidate provenance

The optional `hybrid_rtmpose` backend is not part of normal Compose startup and
does not replace the pinned YOLO production default. Its two Apache-2.0 model
artifacts are intentionally not committed to this repository. Their acquisition
contract is tracked in
`services/hand-relay/models/hybrid-models.lock.json`; the standard-library-only
`services/hand-relay/scripts/acquire_hybrid_models.py` tool verifies that lock
and the exact local bytes.

### RTMDet-nano hand detector

- Provenance repository: <https://huggingface.co/Tau-J/RTMPose>
- Repository revision: `cd4d7095f5cfc9cfc4f46289bee91ea4a1e1d9fd`
- Pinned repository tree: <https://huggingface.co/Tau-J/RTMPose/tree/cd4d7095f5cfc9cfc4f46289bee91ea4a1e1d9fd/rtmposev1/onnx_sdk>
- Source archive: `rtmdet_nano_8xb32-300e_hand-267f9c8f.zip`
- Source download: <https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/rtmdet_nano_8xb32-300e_hand-267f9c8f.zip>
- Source archive size: 3,840,129 bytes
- Source archive SHA-256: `9c0370a43c02b2fe42b4382aba7383d97cfa3ed35623b655cac4f0c25cfde402`
- Exact archive member: `20230831/rtmdet_onnx/rtmdet_nano_8xb32-300e_hand-267f9c8f/end2end.onnx`
- Local artifact: `services/hand-relay/models/rtmdet_nano_8xb32-300e_hand-267f9c8f.onnx`
- Local artifact size: 4,010,667 bytes
- Local artifact SHA-256: `568d3ea97a5b142488366b67e036b6a5cb0a1fef9087a710cb8e66b6979fbac2`
- License: Apache-2.0

The OpenMMLab download path does not embed a repository commit. Determinism is
therefore enforced by both the named repository revision recorded for
provenance and the exact source archive byte count and SHA-256. The extractor
accepts only the named archive member and separately gates its output bytes.

### RTMPose-m distilled hand refiner

- Repository: <https://huggingface.co/tasmulaev/rtmpose-m-distill>
- Revision: `ec0d56fdf55a350106671e763338a4a76372a888`
- Pinned repository tree: <https://huggingface.co/tasmulaev/rtmpose-m-distill/tree/ec0d56fdf55a350106671e763338a4a76372a888>
- Source artifact: `onnx/rtmpose-m-distill-256x256.onnx`
- Pinned download: <https://huggingface.co/tasmulaev/rtmpose-m-distill/resolve/ec0d56fdf55a350106671e763338a4a76372a888/onnx/rtmpose-m-distill-256x256.onnx>
- Local artifact: `services/hand-relay/models/rtmpose-m-distill-256x256.onnx`
- Size: 55,118,513 bytes
- SHA-256: `6d50664e566fffee41a090c98f75e893b50846a753b802dbf5e2072a8dfd7784`
- License: Apache-2.0

`check-lock` and `verify` are offline operations. Only an operator's explicit
`acquire` command opens either source URL. Acquisition downloads into a
temporary directory, validates both source contracts and both output contracts,
and only then replaces the ignored local files. CI never downloads these model
bytes. The candidate container build also performs exact local output size and
SHA-256 checks and does not download or mount a model at runtime.

## Runtime and operations source

- `services/hand-relay/commandcanvas_hand_relay/`
- `services/hand-relay/tests/`
- `services/hand-relay/Dockerfile`
- `services/hand-relay/compose.yaml`
- `services/hand-relay/models/hybrid-models.lock.json`
- `services/hand-relay/scripts/acquire_hybrid_models.py`
- `services/hand-relay/requirements.lock`
- `services/hand-relay/requirements-ci.lock`
- `services/hand-relay/requirements-dev.lock`
- `services/hand-relay/.env.example`
- `ops/hand-relay/caddy/hand-relay.Caddyfile`
- `ops/hand-relay/manage-caddy-route.sh`
- `ops/hand-relay/tests/manage-caddy-route.test.sh`

The production image copies the exact tracked 640 artifact into an immutable
image after build-time size and SHA-256 checks. The separately tagged rollback
image does the same for the tracked 320 artifact. The profile-only hybrid image
copies its two locally acquired, lock-verified artifacts and repeats their
output checks. No image downloads or substitutes a model at runtime.

The MIT-licensed CommandCanvas web application is deliberately not part of
this corresponding-source repository. Its separately distributed relay client
uses the documented `commandcanvas.private-hand-relay.v1` protocol and contains
none of these model or CUDA service artifacts.
