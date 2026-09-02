# CommandCanvas hand fine-tune v1

This package validates a private, raw-camera hand-pose dataset and produces
deterministic receipts for an owner-only experimental training run. It does not
contain Ultralytics or model bytes, camera footage, or a production model. Its
`train-owner-experiment` command is a bounded API adapter that runs only when
the separately licensed runtime and exact pinned checkpoint are supplied at
execution time.

The default RunPod path is a network-free dry run. The `--execute` path
currently refuses before creating a Pod because secure SSH transfer with host
key pinning and an independent termination guardian are not implemented. This
is an intentional cost and data-safety gate.

The pinned upstream checkpoint is isolated by an AGPL runtime and CC-BY-NC-SA
training-data license boundary. Every generated candidate begins with
`productionEligible: false`; benchmark, license, and physical acceptance are
separate gates.

Run the synthetic contract suite from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s scripts/hand-finetune/v1/tests -p 'test_*.py' -v
```

Show the CLI without touching the network:

```sh
PYTHONPATH=scripts/hand-finetune/v1 \
  python3 -m commandcanvas_hand_finetune --help
```

## Manual keypoint correction

The annotation workbench opens a self-contained page on the local loopback
interface. It accepts an already prepared, validator-compatible private dataset
located **outside this repository**. It never uploads images or loads remote
assets.

```sh
PYTHONPATH=scripts/hand-finetune/v1 \
  python3 -m commandcanvas_hand_finetune annotate \
  --dataset-root /absolute/private/path/hand-dataset \
  --manifest /absolute/private/path/hand-dataset/dataset-manifest.json \
  --editor-id owner-daniel
```

For each frame, drag existing points or add a hand by clicking the named
MediaPipe 21-keypoint order. A frame may contain one or two hands, or it may be
marked `no hand`, which emits an empty label with the `negative` category.
Every save uses optimistic digest checks, rewrites the YOLO pose label and
dataset manifest canonically, re-runs the strict dataset validator, and writes
an immutable edit receipt without copying the private image.

After review, use the page's **Finalize dataset** action or the offline command:

```sh
PYTHONPATH=scripts/hand-finetune/v1 \
  python3 -m commandcanvas_hand_finetune finalize-annotations \
  --dataset-root /absolute/private/path/hand-dataset \
  --manifest /absolute/private/path/hand-dataset/dataset-manifest.json \
  --editor-id owner-daniel
```

Finalization refuses missing, tampered, branched, or orphaned edit receipts and
emits `annotation-finalization-receipt.json`. That receipt proves dataset
validation only; it deliberately remains `productionEligible: false`.
