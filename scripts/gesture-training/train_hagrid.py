#!/usr/bin/env python3
"""Train a bounded HaGRIDv2 landmark classifier and export browser JSON.

The source archive stays outside Git. The exported model is a linear temporal
classifier compatible with CommandCanvas' TypeScript inference path. HaGRIDv2
and derived artifacts remain under HaGRID's custom Public License with
attribution and conditions reserved; this script is part of the MIT app.
"""

from __future__ import annotations

import argparse
import hashlib
import heapq
import io
import json
import math
import os
import random
import tempfile
import zipfile
from collections import defaultdict
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterable, Iterator, TextIO

import numpy as np

# Required by PyTorch when deterministic CUDA training uses cuBLAS. This must
# be present before the first CUDA context is created.
os.environ.setdefault("CUBLAS_WORKSPACE_CONFIG", ":4096:8")

import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset


DATASET_ID = "hukenovs/hagrid-v2"
DATASET_REVISION = "Hagrid_v2-1M"
DATASET_LICENSE = (
    "LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved"
)
DATASET_LICENSE_URL = (
    "https://raw.githubusercontent.com/hukenovs/hagrid/"
    "080e18917376ec935e453cd0e599c23478c7e98f/license/en_us.pdf"
)
DATASET_URL = "https://github.com/hukenovs/hagrid"
MODEL_SCHEMA = "commandcanvas.temporal-gesture-model/v1"
FEATURE_CONTRACT = "commandcanvas.gesture-features/v1"
FRAME_FEATURE_SIZE = 152
CONTEXT_FEATURE_SIZE = 10
LABEL_MAP = {
    "point": "point",
    "palm": "open_palm",
    "thumb_index": "pinch",
    "thumb_index2": "pinch",
    "grip": "held",
    "grabbing": "held",
    "fist": "idle",
    "no_gesture": "idle",
}
DEFAULT_SOURCE_CLASSES = tuple(LABEL_MAP)
PARTITION_PATHS = {"train": "train", "validation": "val", "test": "test"}
GRAB_LABELS = {"pinch", "held"}


class DatasetError(RuntimeError):
    pass


class AnnotationSource:
    def __init__(self, source: Path):
        self.source = source
        self.archive = zipfile.ZipFile(source) if source.is_file() else None

    def close(self) -> None:
        if self.archive is not None:
            self.archive.close()

    @contextmanager
    def open_text(self, relative: str) -> Iterator[TextIO]:
        if self.archive is not None:
            try:
                raw = self.archive.open(relative, "r")
            except KeyError as error:
                raise DatasetError(
                    f"Missing HaGRIDv2 annotation file: {relative}"
                ) from error
            text = io.TextIOWrapper(raw, encoding="utf-8")
            try:
                yield text
            finally:
                text.close()
        else:
            path = self.source / relative
            if not path.is_file():
                raise DatasetError(f"Missing HaGRIDv2 annotation file: {path}")
            with path.open("r", encoding="utf-8") as handle:
                yield handle


def iter_json_object_items(
    handle: TextIO, chunk_size: int = 1 << 20
) -> Iterator[tuple[str, Any]]:
    """Incrementally decode a top-level JSON object without loading the file."""

    decoder = json.JSONDecoder()
    buffer = ""
    position = 0
    eof = False

    def fill() -> bool:
        nonlocal buffer, eof
        chunk = handle.read(chunk_size)
        if not chunk:
            eof = True
            return False
        buffer += chunk
        return True

    def compact() -> None:
        nonlocal buffer, position
        if position > chunk_size:
            buffer = buffer[position:]
            position = 0

    def skip_space() -> None:
        nonlocal position
        while True:
            while position < len(buffer) and buffer[position].isspace():
                position += 1
            if position < len(buffer) or eof:
                return
            fill()

    def expect(character: str) -> None:
        nonlocal position
        skip_space()
        while position >= len(buffer) and not eof:
            fill()
            skip_space()
        if position >= len(buffer) or buffer[position] != character:
            raise DatasetError(f"Expected {character!r} in annotation JSON.")
        position += 1

    def decode() -> Any:
        nonlocal position
        while True:
            skip_space()
            try:
                value, end = decoder.raw_decode(buffer, position)
                position = end
                return value
            except json.JSONDecodeError as error:
                if eof:
                    raise DatasetError(f"Invalid annotation JSON: {error}") from error
                if not fill():
                    continue

    fill()
    expect("{")
    first = True
    while True:
        skip_space()
        while position >= len(buffer) and not eof:
            fill()
            skip_space()
        if position < len(buffer) and buffer[position] == "}":
            position += 1
            return
        if not first:
            expect(",")
        key = decode()
        if not isinstance(key, str):
            raise DatasetError("HaGRIDv2 annotation object keys must be strings.")
        expect(":")
        value = decode()
        yield key, value
        first = False
        compact()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--metrics-output", required=True, type=Path)
    parser.add_argument(
        "--source-classes",
        default=",".join(DEFAULT_SOURCE_CLASSES),
        help="Comma-separated HaGRIDv2 annotation files to use.",
    )
    parser.add_argument("--max-per-class", type=int, default=2_000)
    parser.add_argument("--epochs", type=int, default=80)
    parser.add_argument("--batch-size", type=int, default=256)
    parser.add_argument("--frame-count", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=0.01)
    parser.add_argument("--weight-decay", type=float, default=0.0001)
    parser.add_argument("--seed", type=int, default=20260902)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--min-validation-accuracy", type=float, default=0.75)
    parser.add_argument("--min-test-accuracy", type=float, default=0.75)
    parser.add_argument("--min-class-recall", type=float, default=0.65)
    parser.add_argument("--max-false-grab-rate", type=float, default=0.05)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    validate_args(args)
    seed_everything(args.seed)
    source_classes = tuple(
        value.strip() for value in args.source_classes.split(",") if value.strip()
    )
    unsupported = sorted(set(source_classes) - set(LABEL_MAP))
    if unsupported:
        raise DatasetError(f"Unsupported source classes: {', '.join(unsupported)}")
    device = resolve_device(args.device)
    source = AnnotationSource(args.source)
    try:
        partitions, participant_sets, selection_manifest = load_partitions(
            source,
            source_classes,
            args.max_per_class,
            args.seed,
            args.frame_count,
        )
    finally:
        source.close()
    assert_no_participant_leakage(participant_sets)
    classes = sorted({sample["label"] for sample in partitions["train"]})
    if len(classes) < 2:
        raise DatasetError("Training requires at least two mapped gesture classes.")
    for partition, samples in partitions.items():
        missing = sorted(set(classes) - {sample["label"] for sample in samples})
        if missing:
            raise DatasetError(
                f"Official {partition} split is missing selected classes: {', '.join(missing)}"
            )

    model, means, scales, loss_history = train_model(
        partitions["train"],
        classes,
        device,
        args,
    )
    validation = evaluate(
        model, partitions["validation"], classes, means, scales, device
    )
    test = evaluate(model, partitions["test"], classes, means, scales, device)
    promotion_reasons = promotion_failures(validation, test, args)
    archive_digest = digest_source(args.source, source_classes)
    dataset_digest = hashlib.sha256(
        "\n".join(
            sorted(
                f"{partition}:{sample['source_id']}:{sample['label']}"
                for partition, samples in partitions.items()
                for sample in samples
            )
        ).encode("utf-8")
    ).hexdigest()
    device_name = torch.cuda.get_device_name(device) if device.type == "cuda" else "CPU"
    weights = model.weight.detach().cpu().numpy().astype(np.float64).tolist()
    bias = model.bias.detach().cpu().numpy().astype(np.float64).tolist()
    model_artifact = {
        "schemaVersion": MODEL_SCHEMA,
        "featureContract": FEATURE_CONTRACT,
        "frameCount": args.frame_count,
        "inputSize": args.frame_count * FRAME_FEATURE_SIZE + CONTEXT_FEATURE_SIZE,
        "classes": classes,
        "featureMean": means.astype(np.float64).tolist(),
        "featureScale": scales.astype(np.float64).tolist(),
        "weights": weights,
        "bias": bias,
        "productionEligible": not promotion_reasons,
        "sourceAttribution": {
            "datasetId": DATASET_ID,
            "revision": DATASET_REVISION,
            "license": DATASET_LICENSE,
            "licenseUrl": DATASET_LICENSE_URL,
            "url": DATASET_URL,
            "derivedArtifactLicense": DATASET_LICENSE,
            "sourceSha256": archive_digest,
        },
        "training": {
            "algorithm": "multinomial-logistic-regression",
            "epochs": args.epochs,
            "learningRate": args.learning_rate,
            "l2": args.weight_decay,
            "seed": args.seed,
            "sequenceCount": len(partitions["train"]),
            "sessionCount": len({s["participant"] for s in partitions["train"]}),
            "sourceKinds": ["public_dataset"],
            "datasetDigest": f"sha256:{dataset_digest}",
            "validationStatus": "held_out_evaluated",
            "featurePolicy": "pose_only_neutral_context",
            "deviceType": device.type,
            "deviceName": device_name,
            "devicePeakAllocatedBytes": (
                int(torch.cuda.max_memory_allocated(device))
                if device.type == "cuda"
                else 0
            ),
            "devicePeakReservedBytes": (
                int(torch.cuda.max_memory_reserved(device))
                if device.type == "cuda"
                else 0
            ),
            "maxPerClass": args.max_per_class,
            "selection": selection_manifest,
            "heldOut": {"validation": validation, "test": test},
            "promotion": {
                "eligible": not promotion_reasons,
                "reasons": promotion_reasons,
                "thresholds": {
                    "minValidationAccuracy": args.min_validation_accuracy,
                    "minTestAccuracy": args.min_test_accuracy,
                    "minClassRecall": args.min_class_recall,
                    "maxFalseGrabRate": args.max_false_grab_rate,
                },
            },
            "limitation": (
                "HaGRIDv2 provides static pose samples. Duplicated frames satisfy the "
                "runtime tensor shape but do not establish temporal gesture recognition."
            ),
        },
    }
    metrics_artifact = {
        "schemaVersion": "commandcanvas.gesture-training-metrics/v1",
        "sourceAttribution": model_artifact["sourceAttribution"],
        "device": {"type": device.type, "name": device_name},
        "participantLeakage": False,
        "promotion": model_artifact["training"]["promotion"],
        "training": {
            "sequenceCount": len(partitions["train"]),
            "lossFirst": loss_history[0],
            "lossLast": loss_history[-1],
        },
        "validation": validation,
        "test": test,
    }
    atomic_json_write(args.output, model_artifact)
    atomic_json_write(args.metrics_output, metrics_artifact)
    print(
        json.dumps(
            {
                "status": "trained",
                "device": device_name,
                "classes": classes,
                "train": len(partitions["train"]),
                "validation": len(partitions["validation"]),
                "test": len(partitions["test"]),
                "testAccuracy": test["accuracy"],
                "output": str(args.output),
            },
            separators=(",", ":"),
        )
    )
    return 0


def validate_args(args: argparse.Namespace) -> None:
    if not args.source.exists():
        raise DatasetError(f"HaGRIDv2 source does not exist: {args.source}")
    if args.max_per_class < 1:
        raise DatasetError("--max-per-class must be positive.")
    if args.epochs < 1 or args.batch_size < 1 or args.frame_count < 2:
        raise DatasetError(
            "Epochs and batch size must be positive; frame count must be at least two."
        )
    if args.learning_rate <= 0 or args.weight_decay < 0:
        raise DatasetError(
            "Learning rate must be positive and weight decay non-negative."
        )
    for name in (
        "min_validation_accuracy",
        "min_test_accuracy",
        "min_class_recall",
        "max_false_grab_rate",
    ):
        value = getattr(args, name)
        if not 0 <= value <= 1:
            raise DatasetError(f"--{name.replace('_', '-')} must be between 0 and 1.")


def resolve_device(requested: str) -> torch.device:
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise DatasetError(
                "CUDA training was requested but torch.cuda is unavailable."
            )
        return torch.device("cuda")
    return torch.device("cpu")


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(seed)
    torch.use_deterministic_algorithms(True)


def load_partitions(
    source: AnnotationSource,
    source_classes: tuple[str, ...],
    max_per_class: int,
    seed: int,
    frame_count: int,
) -> tuple[dict[str, list[dict[str, Any]]], dict[str, set[str]], dict[str, Any]]:
    partitions: dict[str, list[dict[str, Any]]] = {}
    users: dict[str, set[str]] = {name: set() for name in PARTITION_PATHS}
    selection_manifest: dict[str, Any] = {}
    for partition, source_partition in PARTITION_PATHS.items():
        heaps: dict[str, list[tuple[int, str, dict[str, Any]]]] = defaultdict(list)
        seen_by_label: dict[str, int] = defaultdict(int)
        skipped_invalid_landmarks = 0
        for source_class in source_classes:
            relative = f"annotations/{source_partition}/{source_class}.json"
            with source.open_text(relative) as handle:
                for image_id, annotation in iter_json_object_items(handle):
                    participant = str(annotation.get("user_id", "")).strip()
                    if not participant:
                        raise DatasetError(f"{relative}:{image_id} is missing user_id.")
                    users[partition].add(participant)
                    labels = annotation.get("labels")
                    landmark_sets = annotation.get("hand_landmarks")
                    if not isinstance(labels, list) or not isinstance(
                        landmark_sets, list
                    ):
                        raise DatasetError(
                            f"{relative}:{image_id} is missing labels or hand_landmarks."
                        )
                    if len(labels) != len(landmark_sets):
                        raise DatasetError(
                            f"{relative}:{image_id} label/landmark count mismatch."
                        )
                    for hand_index, hand_label in enumerate(labels):
                        if hand_label != source_class:
                            continue
                        mapped = LABEL_MAP.get(hand_label)
                        if mapped is None:
                            continue
                        try:
                            landmarks = validate_landmarks(
                                landmark_sets[hand_index],
                                f"{relative}:{image_id}:{hand_index}",
                            )
                        except DatasetError:
                            # HaGRIDv2 deliberately retains some annotations for
                            # which its landmark preprocessor produced no hand.
                            # They remain valid detection data but cannot train
                            # this landmark-only classifier.
                            skipped_invalid_landmarks += 1
                            continue
                        source_id = (
                            f"{partition}/{source_class}/{image_id}#hand-{hand_index}"
                        )
                        priority = stable_priority(seed, source_id)
                        sample = {
                            "label": mapped,
                            "participant": participant,
                            "source_id": source_id,
                            "features": static_features(landmarks, mapped, frame_count),
                        }
                        seen_by_label[mapped] += 1
                        heap = heaps[mapped]
                        item = (-priority, source_id, sample)
                        if len(heap) < max_per_class:
                            heapq.heappush(heap, item)
                        elif priority < -heap[0][0]:
                            heapq.heapreplace(heap, item)
        selected = [item[2] for heap in heaps.values() for item in heap]
        selected.sort(key=lambda sample: sample["source_id"])
        partitions[partition] = selected
        selection_manifest[partition] = {
            "seenByClass": dict(sorted(seen_by_label.items())),
            "selectedByClass": dict(
                sorted(
                    (label, sum(1 for sample in selected if sample["label"] == label))
                    for label in heaps
                )
            ),
            "participantsObserved": len(users[partition]),
            "skippedInvalidLandmarks": skipped_invalid_landmarks,
        }
    return partitions, users, selection_manifest


def validate_landmarks(value: Any, location: str) -> list[list[float]]:
    if not isinstance(value, list) or len(value) != 21:
        raise DatasetError(f"{location} must contain exactly 21 hand landmarks.")
    result: list[list[float]] = []
    for point in value:
        if not isinstance(point, list) or len(point) < 2:
            raise DatasetError(f"{location} contains an invalid hand landmark.")
        x, y = float(point[0]), float(point[1])
        if not math.isfinite(x) or not math.isfinite(y):
            raise DatasetError(f"{location} contains a non-finite hand landmark.")
        result.append([x, y, 0.0])
    return result


def static_features(
    landmarks: list[list[float]], label: str, frame_count: int
) -> list[float]:
    wrist = landmarks[0]
    scale = palm_scale(landmarks)
    normalized = [
        round((point[axis] - wrist[axis]) / scale, 6)
        for point in landmarks
        for axis in range(3)
    ]
    pinch_ratio = distance(landmarks[4], landmarks[8]) / scale
    openness = (
        sum(distance(landmarks[0], landmarks[index]) for index in (8, 12, 16, 20))
        / 4
        / scale
    )
    hand = [
        1.0,
        0.0,
        0.0,
        1.0,
        1.0,
        *normalized,
        round(pinch_ratio, 6),
        round(openness, 6),
        0.0,
        0.0,
    ]
    if len(hand) != 72:
        raise DatasetError(
            f"Feature contract produced {len(hand)} per-hand values, expected 72."
        )
    frame = [*hand, *([0.0] * 72), 0.5, *([0.0] * 7)]
    context = context_features()
    values = frame * frame_count + context
    expected = frame_count * FRAME_FEATURE_SIZE + CONTEXT_FEATURE_SIZE
    if len(values) != expected:
        raise DatasetError(
            f"Feature contract produced {len(values)} values, expected {expected}."
        )
    return values


def context_features() -> list[float]:
    # HaGRIDv2 labels describe only the visible hand pose. Canvas mode,
    # targeting, selection, and edge location are unknown and must never be
    # inferred from the ground-truth class.
    return [
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        1.0,
        0.0,
        0.0,
        0.0,
        0.0,
    ]


def palm_scale(landmarks: list[list[float]]) -> float:
    candidates = sorted(
        value
        for value in (
            distance(landmarks[5], landmarks[17]),
            distance(landmarks[0], landmarks[9]) * 0.9,
            distance(landmarks[0], landmarks[5]),
            distance(landmarks[0], landmarks[17]) * 0.7,
        )
        if math.isfinite(value) and value > 0.005
    )
    if not candidates:
        return 0.000001
    midpoint = len(candidates) // 2
    if len(candidates) % 2:
        return candidates[midpoint]
    return (candidates[midpoint - 1] + candidates[midpoint]) / 2


def distance(left: list[float], right: list[float]) -> float:
    return math.hypot(left[0] - right[0], left[1] - right[1])


def stable_priority(seed: int, source_id: str) -> int:
    digest = hashlib.sha256(f"{seed}:{source_id}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def assert_no_participant_leakage(participants: dict[str, set[str]]) -> None:
    for left, right in (
        ("train", "validation"),
        ("train", "test"),
        ("validation", "test"),
    ):
        overlap = participants[left] & participants[right]
        if overlap:
            example = sorted(overlap)[0]
            raise DatasetError(
                f"HaGRIDv2 participant leakage: {example} appears in {left} and {right}."
            )


def train_model(
    samples: list[dict[str, Any]],
    classes: list[str],
    device: torch.device,
    args: argparse.Namespace,
) -> tuple[nn.Linear, np.ndarray, np.ndarray, list[float]]:
    x = np.asarray([sample["features"] for sample in samples], dtype=np.float32)
    class_index = {label: index for index, label in enumerate(classes)}
    y = np.asarray([class_index[sample["label"]] for sample in samples], dtype=np.int64)
    means = x.mean(axis=0, dtype=np.float64).astype(np.float32)
    scales = x.std(axis=0, dtype=np.float64).astype(np.float32)
    scales[scales < 1e-6] = 1.0
    x = (x - means) / scales
    dataset = TensorDataset(torch.from_numpy(x), torch.from_numpy(y))
    generator = torch.Generator().manual_seed(args.seed)
    loader = DataLoader(
        dataset,
        batch_size=min(args.batch_size, len(dataset)),
        shuffle=True,
        generator=generator,
    )
    model = nn.Linear(x.shape[1], len(classes)).to(device)
    nn.init.zeros_(model.weight)
    nn.init.zeros_(model.bias)
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=args.learning_rate, weight_decay=args.weight_decay
    )
    criterion = nn.CrossEntropyLoss()
    history: list[float] = []
    model.train()
    for _ in range(args.epochs):
        epoch_loss = 0.0
        seen = 0
        for batch_x, batch_y in loader:
            batch_x = batch_x.to(device)
            batch_y = batch_y.to(device)
            optimizer.zero_grad(set_to_none=True)
            loss = criterion(model(batch_x), batch_y)
            loss.backward()
            optimizer.step()
            epoch_loss += float(loss.detach().cpu()) * len(batch_x)
            seen += len(batch_x)
        history.append(epoch_loss / seen)
    return model, means, scales, history


def evaluate(
    model: nn.Linear,
    samples: list[dict[str, Any]],
    classes: list[str],
    means: np.ndarray,
    scales: np.ndarray,
    device: torch.device,
) -> dict[str, Any]:
    x = np.asarray([sample["features"] for sample in samples], dtype=np.float32)
    x = (x - means) / scales
    with torch.no_grad():
        predictions = model(torch.from_numpy(x).to(device)).argmax(dim=1).cpu().numpy()
    class_index = {label: index for index, label in enumerate(classes)}
    truth = np.asarray(
        [class_index[sample["label"]] for sample in samples], dtype=np.int64
    )
    matrix = np.zeros((len(classes), len(classes)), dtype=np.int64)
    for expected, predicted in zip(truth, predictions, strict=True):
        matrix[expected, predicted] += 1
    per_class: dict[str, Any] = {}
    for index, label in enumerate(classes):
        tp = int(matrix[index, index])
        support = int(matrix[index, :].sum())
        predicted_count = int(matrix[:, index].sum())
        precision = tp / predicted_count if predicted_count else 0.0
        recall = tp / support if support else 0.0
        f1 = (
            2 * precision * recall / (precision + recall) if precision + recall else 0.0
        )
        per_class[label] = {
            "precision": round(precision, 6),
            "recall": round(recall, 6),
            "f1": round(f1, 6),
            "support": support,
        }
    non_grab = [
        index
        for index, expected in enumerate(truth)
        if classes[expected] not in GRAB_LABELS
    ]
    false_grabs = sum(
        classes[int(predictions[index])] in GRAB_LABELS for index in non_grab
    )
    return {
        "sequenceCount": len(samples),
        "accuracy": round(float((truth == predictions).mean()), 6),
        "perClass": per_class,
        "confusionMatrix": {"labels": classes, "values": matrix.tolist()},
        "falseGrabRate": round(false_grabs / len(non_grab), 6) if non_grab else 0.0,
        "twoHandIdentityContinuity": None,
    }


def promotion_failures(
    validation: dict[str, Any], test: dict[str, Any], args: argparse.Namespace
) -> list[str]:
    reasons: list[str] = []
    if validation["accuracy"] < args.min_validation_accuracy:
        reasons.append("validation_accuracy_below_threshold")
    if test["accuracy"] < args.min_test_accuracy:
        reasons.append("test_accuracy_below_threshold")
    if test["falseGrabRate"] > args.max_false_grab_rate:
        reasons.append("false_grab_rate_above_threshold")
    if any(
        metrics["recall"] < args.min_class_recall
        for metrics in test["perClass"].values()
    ):
        reasons.append("test_class_recall_below_threshold")
    return reasons


def digest_source(source: Path, source_classes: Iterable[str]) -> str:
    digest = hashlib.sha256()
    if source.is_file():
        with source.open("rb") as handle:
            while chunk := handle.read(1 << 20):
                digest.update(chunk)
    else:
        for partition in PARTITION_PATHS.values():
            for source_class in sorted(source_classes):
                path = source / "annotations" / partition / f"{source_class}.json"
                digest.update(str(path.relative_to(source)).encode("utf-8"))
                with path.open("rb") as handle:
                    while chunk := handle.read(1 << 20):
                        digest.update(chunk)
    return digest.hexdigest()


def atomic_json_write(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    file_descriptor, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.", suffix=".tmp", dir=path.parent
    )
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (DatasetError, ValueError, OSError, zipfile.BadZipFile) as error:
        print(
            json.dumps({"status": "error", "message": str(error)}), file=os.sys.stderr
        )
        raise SystemExit(2) from error
