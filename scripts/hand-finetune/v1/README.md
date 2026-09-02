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
interface. It accepts either a strict dataset or an incomplete annotation draft
located **outside this repository**. It never uploads images or loads remote
assets. A draft may contain empty positive labels and unreviewed frames; the
strict training validator remains unchanged and finalization refuses until every
frame has been reviewed.

```sh
PYTHONPATH=scripts/hand-finetune/v1 \
  python3 -m commandcanvas_hand_finetune annotate \
  --dataset-root /absolute/private/path/hand-dataset \
  --manifest /absolute/private/path/hand-dataset/annotation-draft.json \
  --editor-id owner-daniel
```

For each frame, drag existing points or add a hand by clicking the named
MediaPipe 21-keypoint order. A frame may contain one or two hands, or it may be
marked `no hand`, which emits an empty label with the `negative` category.
Every save uses optimistic digest checks, rewrites the YOLO pose label and draft
manifest canonically, verifies all immutable image, source-video, and label
digests, and writes an immutable edit receipt without copying the private image.
Review status is recorded per frame. A model-assisted training or validation
session preserves the prelabel model digest. A holdout draft must be manual and
cannot use model prelabels.

The adapter that extracts Vision Lab frames emits
`commandcanvas.hand-annotation-draft/v1`. The draft is the final dataset shape
plus these review-only fields:

- top-level `canonicalSchemaVersion`, declaring the strict manifest schema to
  emit;
- top-level `sourceAdapter` with stable adapter name/version and the SHA-256 of
  its source manifest;
- per-session `visionSessionId`, paired with the immutable `captureGroupId`;
- per-frame `reviewed`, while each `image` remains keyed by its safe relative
  path and SHA-256.

Draft frames use the bridge's exact deterministic paths:
`images/<datasetSessionId>/frame-<timestampMs padded to 10 digits>.png` and
`labels/<datasetSessionId>/frame-<timestampMs padded to 10 digits>.txt`.

The workbench emits a strict intermediate `commandcanvas.hand-dataset/v1`
manifest and a `commandcanvas.hand-annotation-handoff/v1` object in its final
receipt. The handoff binds every corrected label to its Vision Lab session,
dataset session, capture group, split, annotation record, source-video digest,
and source-adapter digest. The provenance-aware Vision Lab bridge consumes that
review evidence and the corrected labels, then produces the final
`commandcanvas.hand-dataset/v2` manifest from its canonical session map and
companion manifests. The workbench deliberately does not pass through or
invent v2 `producerChain` metadata: v2 binds `session.annotation` to the source
session map, so review must happen before that bridge is finalized.

After review, use the page's **Finalize dataset** action or the offline command:

```sh
PYTHONPATH=scripts/hand-finetune/v1 \
  python3 -m commandcanvas_hand_finetune finalize-annotations \
  --dataset-root /absolute/private/path/hand-dataset \
  --manifest /absolute/private/path/hand-dataset/annotation-draft.json \
  --editor-id owner-daniel
```

Finalization refuses unreviewed frames and missing, tampered, branched, or
orphaned edit receipts. It strips only the review fields, writes the canonical
`dataset-manifest.json`, invokes the unchanged strict dataset validator, and
emits `annotation-finalization-receipt.json`. The receipt binds the draft,
canonical manifest, Vision Lab session identities, source-adapter digest, and
every edit receipt. The receipt's bridge handoff is an adapter seam, not a claim
that the v2 bridge has run. It proves intermediate dataset validation only and
deliberately remains `productionEligible: false`.

## Vision Lab dataset bridge

Materialize a dataset only from locally downloaded Vision Lab WebM files,
their companion manifests, an explicit session/split map, and reviewed YOLO
labels:

```sh
PYTHONPATH=scripts/hand-finetune/v1 python3 -m commandcanvas_hand_finetune \
  prepare-dataset \
  --capture-root /private/captures \
  --session-map /private/session-map.json \
  --labels-root /private/corrected-labels \
  --output-dir /private/dataset-v1
```

`prepare-dataset` verifies each raw WebM digest, Vision Lab consent and protocol,
the ffprobe dimensions/duration, capture-group split isolation, and the exact
corrected-label set before publishing a canonical Task 2 manifest and receipt.
Frame extraction writes PNGs at the map's explicit cadence; the raw WebM is
copied byte-for-byte and is never replaced or transcoded.

Create a portable, deterministic archive only after that dataset revalidates:

```sh
PYTHONPATH=scripts/hand-finetune/v1 python3 -m commandcanvas_hand_finetune \
  archive-dataset \
  --dataset-root /private/dataset-v1 \
  --manifest /private/dataset-v1/dataset-manifest.json \
  --dataset-receipt /private/dataset-v1/dataset-receipt.json \
  --output /private/dataset-v1.tar \
  --archive-receipt /private/dataset-v1-archive-receipt.json
```

The archive contains only the validated sources, extracted images, corrected
labels, manifest, and dataset receipt. It uses sorted POSIX member names and
fixed metadata, then re-extracts and revalidates itself before publishing its
archive receipt.
