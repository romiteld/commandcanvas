# Corresponding Source

CommandCanvas is released under the GNU Affero General Public License,
version 3 only. The canonical public source repository is:

<https://github.com/romiteld/commandcanvas>

The source for a deployed release is the exact public commit or tag linked by
that running release, not an unrelated newer or older branch. A release must
not be promoted until its browser-visible source link resolves to the public
commit containing the deployed application, build configuration, database
migrations, tests, runtime worker source, model artifact, and this manifest.

Private credentials and deployment data are not part of the repository. The
included `.env.example` records the names and roles of required configuration
without publishing secret values.

## Embedded hand-pose model source

The browser's primary hand-pose engine uses this artifact:

- Distributed artifact: `public/models/yolo26_hand_pose_320_fp16.onnx`
- Size: 21,447,188 bytes
- SHA-256: `07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc`
- Input: `[1,3,320,320]`
- Output: `[1,300,69]`, including 21 hand keypoints

It was exported from the following pinned source material:

- Model repository: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection>
- Pinned revision: `2abb91a7030e1aa5231ec900ccb2c07ab3f03460`
- Source checkpoint: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/resolve/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/checkpoints/yolo26_hand_pose.pt>
- Source checkpoint size: 25,228,590 bytes
- Source checkpoint SHA-256: `39cb54e63cac0d8905d7cab2112430dc9bf60a26779e361165fc03bf9c6ca36d`
- Pinned model card: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/blob/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/README.md>
- Pinned training script: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/blob/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/scripts/train_hand_pose.sh>
- Pinned upstream export script: <https://huggingface.co/poptoz/yolo26-hand-pose-face-detection/blob/2abb91a7030e1aa5231ec900ccb2c07ab3f03460/scripts/export_onnx.sh>
- Base implementation: <https://github.com/ultralytics/ultralytics>
- Hand Keypoints dataset documentation: <https://docs.ultralytics.com/datasets/pose/hand-keypoints/>

The pinned Hugging Face model card identifies its training code as MIT and its
Ultralytics YOLO26 base model as AGPL-3.0 or available under an Ultralytics
Enterprise License. It does not identify the trained checkpoint as MIT.
Ultralytics' published open-source path says projects using its trained models
must release the whole project under AGPL-3.0. CommandCanvas selects that
open-source path and licenses this release as `AGPL-3.0-only`.

## Export recipe

The distributed ONNX graph was produced with Ultralytics `8.4.33`, image size
`320`, ONNX opset `17`, graph simplification, and FP16 conversion. Starting
from the pinned checkpoint above, the material transformation is:

```bash
python -m venv .model-export-venv
. .model-export-venv/bin/activate
python -m pip install 'ultralytics==8.4.33' onnx onnxslim
```

```python
from ultralytics import YOLO

model = YOLO("checkpoints/yolo26_hand_pose.pt")
model.export(
    format="onnx",
    imgsz=320,
    opset=17,
    simplify=True,
    half=True,
)
```

Rename the resulting ONNX file to
`public/models/yolo26_hand_pose_320_fp16.onnx` and verify it with:

```bash
sha256sum public/models/yolo26_hand_pose_320_fp16.onnx
```

The exact output hash can vary if exporter dependencies or graph-optimization
tooling differ. The distributed artifact and its source checkpoint are both
identified by byte size and SHA-256 so a recipient can verify the release
inputs rather than treating an unpinned model name as source.

## Runtime source

The browser worker, tensor preprocessing, output parser, gesture state machine,
and build script are in the same public repository:

- `lib/gesture/yolo-hand-pose.worker.ts`
- `lib/gesture/yolo-hand-pose-detector.ts`
- `lib/gesture/spatial-vision-engine.ts`
- `lib/gesture/hand-tracking-controller.ts`
- `lib/gesture/spatial-gesture.ts`
- `scripts/build-hand-worker.mjs`

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party package
copyrights, licenses, and upstream source locations.
