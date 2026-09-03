# CommandCanvas hand fine-tune v1

This package validates a private, raw-camera hand-pose dataset and produces
deterministic receipts for an owner-only experimental training run. It does not
contain Ultralytics or model bytes, camera footage, or a production model. Its
`train-owner-experiment` command is a bounded API adapter that runs only when
the separately licensed runtime and exact pinned checkpoint are supplied at
execution time.

The canonical, self-digested `training-runtime.lock.json` records the exact
Python, Ultralytics, PyTorch/CUDA, ONNX, and ONNX Runtime contract. The pinned
RunPod image is explicitly a foundation image, not a finished trainer. The
executable Dockerfile and dependency installation lock belong in the separate
AGPL `commandcanvas-hand-relay` source boundary; they are not copied into this
MIT application.

The default RunPod path is a network-free dry run. The `--execute` path
currently refuses before creating a Pod because the separately licensed
trainer image, secure SSH transfer with host-key pinning, and an independent
termination guardian are not implemented. This is an intentional cost,
licensing, and data-safety gate.

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

Create the draft directly from the downloaded Vision Lab session map, companion
manifests, and raw WebM files. The source session map must describe unreviewed
manual annotation and use each final draft label directory, for example
`labels/<datasetSessionId>`:

```sh
PYTHONPATH=scripts/hand-finetune/v1 \
  python3 -m commandcanvas_hand_finetune prepare-annotation-draft \
  --capture-root /absolute/private/path/captures \
  --session-map /absolute/private/path/session-map.json \
  --output-dir /absolute/private/path/hand-review
```

This command performs the same Vision Lab consent, companion, WebM digest,
ffprobe, duration, dimension, split, and identifier checks used by the final
bridge. It copies the raw videos, extracts deterministic frames, creates empty
labels, and emits `annotation-draft.json`. It makes no model or provider call.
The destination must neither be inside this repository nor contain it.

For the bounded owner-only review run, the same source map can instead receive
local YOLO26 pose suggestions before the workbench opens:

```sh
PYTHONPATH=scripts/hand-finetune/v1 \
  python3 -m commandcanvas_hand_finetune \
  prepare-prelabeled-annotation-draft \
  --capture-root /absolute/private/path/captures \
  --session-map /absolute/private/path/session-map.json \
  --checkpoint /absolute/private/path/yolo26_hand_pose.pt \
  --output-dir /absolute/private/path/hand-review \
  --device 0 \
  --acknowledge-owner-only-license-boundary
```

This adapter is offline and local-only. It refuses any checkpoint whose bytes
do not match the pinned YOLO26 pose SHA-256 in `training_spec.py`, and it loads
Ultralytics only at execution time from the separately licensed runtime. The
The top-level Vision Lab cadence remains the compatible default frame sampler.
A session may instead declare `sampleTimestampsMs`, a nonempty, strictly
increasing list of unique millisecond offsets within the probed video duration.
Those exact timestamps are bound by the canonical session-map digest and must
match the annotation draft and final dataset frames. Positive train and
validation frames receive at most two 21-point suggestions; declared
negative/no-hand frames remain canonical empty manual labels, and every holdout
frame remains manual. No suggestion is marked reviewed.

The draft canonically binds the dataset ID, Vision Lab and dataset session IDs,
frame ID and timestamp, exact extracted-image digest, exact suggested-label
digest, and pinned model digest. The normal workbench must still review and save
every frame. Finalization and the v2 bridge then archive the original draft and
the complete human edit chain without relaxing the strict validator. Raw
captures, checkpoint bytes, generated drafts, and corrected labels must all
remain outside this repository.

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

The `prepare-annotation-draft` adapter emits
`commandcanvas.hand-annotation-draft/v1`. The draft is the final dataset shape
plus these review-only fields:

- top-level `canonicalSchemaVersion`, declaring the strict manifest schema to
  emit;
- top-level `sourceAdapter` with stable adapter name/version, the source actor,
  and the SHA-256 of the canonical source session map;
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
companion manifests. The workbench does not invent v2 `producerChain`
metadata; the downstream bridge validates and archives that source provenance
along with the review provenance.

After review, use the page's **Finalize dataset** action or the offline command:

```sh
PYTHONPATH=scripts/hand-finetune/v1 \
  python3 -m commandcanvas_hand_finetune finalize-annotations \
  --dataset-root /absolute/private/path/hand-dataset \
  --manifest /absolute/private/path/hand-dataset/annotation-draft.json \
  --editor-id owner-daniel
```

Finalization refuses unreviewed frames, a changed actor, and missing, tampered, branched, or
orphaned edit receipts. It strips only the review fields, writes the canonical
`dataset-manifest.json`, invokes the unchanged strict dataset validator, and
emits `annotation-finalization-receipt.json`. The receipt binds the draft,
canonical manifest, Vision Lab session identities, source-adapter digest, and
every edit receipt. The receipt's bridge handoff is an adapter seam, not a claim
that the v2 bridge has run. It proves intermediate dataset validation only and
deliberately remains `productionEligible: false`. A successful finalization is
immutable and idempotent; later annotation edits are refused.

## Vision Lab dataset bridge

Materialize a dataset only from locally downloaded Vision Lab WebM files,
their companion manifests, an explicit session/split map, and reviewed YOLO
labels:

```sh
PYTHONPATH=scripts/hand-finetune/v1 python3 -m commandcanvas_hand_finetune \
  prepare-dataset \
  --capture-root /private/captures \
  --session-map /private/session-map.json \
  --labels-root /absolute/private/path/hand-review \
  --annotation-finalization-receipt \
    /absolute/private/path/hand-review/annotation-finalization-receipt.json \
  --output-dir /private/dataset-v1
```

`prepare-dataset` derives each raw WebM digest locally, verifies any digest or
camera metadata supplied by Vision Lab, verifies Vision Lab consent and
protocol, and treats ffprobe dimensions/duration as media authority. Task 1's
optional digest, width, height, frame-rate, and facing-mode fields may remain
absent. Capture-group split isolation and the exact corrected-label set are
verified before publishing a canonical Task 2 manifest and receipt.
Frame extraction writes PNGs at each session's exact timestamp selection, or
at the map's global cadence when no selection is present; the raw WebM is copied
byte-for-byte and is never replaced or transcoded.

The emitted `commandcanvas.hand-dataset/v2` manifest preserves the canonical
session map at `provenance/session-map.json` and each canonical Vision Lab
companion at `provenance/companions/<datasetSessionId>.json`. Their byte sizes
and SHA-256 digests are part of the manifest, and every session binds those
records to the copied WebM, Vision Lab session, consent, protocol, capture type,
capture group, split, categories, annotation record, and actor.

When the finalization receipt is supplied, `producerChain.annotationReview`
also archives the exact reviewed draft, immutable finalization receipt, and
every ordered edit receipt. Validation proves the actor and source-adapter
binding, edit-manifest chain, Vision Lab and dataset session identities, exact
frame coverage, and final label hashes. A labels directory without that
receipt remains supported only for the older direct bridge workflow; it does
not claim manual-workbench provenance.

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
labels, source and annotation provenance, manifest, and dataset receipt. It
uses sorted POSIX member names and fixed metadata, then re-extracts and
revalidates itself before publishing its archive receipt.
