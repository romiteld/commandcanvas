# YOLO26 Hand Pose model

`yolo26_hand_pose_320_fp16.onnx` is the self-hosted primary hand-pose model for
CommandCanvas. It emits 21 hand keypoints; it is not a generic bounding-box
detector.

- License: AGPL-3.0-only as distributed with this CommandCanvas release
- Source model: `poptoz/yolo26-hand-pose-face-detection`
- Pinned source revision: `2abb91a7030e1aa5231ec900ccb2c07ab3f03460`
- Artifact size: 21,447,188 bytes
- Artifact SHA-256: `07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc`
- Source checkpoint SHA-256: `39cb54e63cac0d8905d7cab2112430dc9bf60a26779e361165fc03bf9c6ca36d`

The exact source checkpoint, model card, training script, export recipe, and
runtime source paths are recorded in the repository's
[`SOURCE.md`](../../SOURCE.md). License and upstream attribution details are in
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md).
