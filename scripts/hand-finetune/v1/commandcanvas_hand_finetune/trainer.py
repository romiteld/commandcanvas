"""Owner-only YOLO adaptation entrypoint for a separately licensed container.

This module contains orchestration, validation, and an API adapter. It does not
vendor Ultralytics, the upstream checkpoint, training media, or output weights.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any, Protocol

from .canonical import canonical_json_bytes, sha256_file, write_canonical_json
from .dataset import DatasetValidationError, validate_dataset
from .onnx_contract import OnnxInspection, validate_onnx_contract
from .training_spec import TRAINING_RUNTIME, UPSTREAM_CHECKPOINT, build_training_spec


class TrainerRefused(RuntimeError):
    pass


class TrainingBackend(Protocol):
    def load(self, checkpoint: Path) -> None: ...

    def train_phase(
        self,
        *,
        data_yaml: Path,
        output_dir: Path,
        phase: dict[str, Any],
        common: dict[str, Any],
    ) -> None: ...

    def export(self, *, output_dir: Path, export_spec: dict[str, Any]) -> Path: ...


class UltralyticsBackend:
    """Thin runtime adapter, loaded only inside the separately licensed image."""

    def __init__(self) -> None:
        self._model: Any | None = None

    def load(self, checkpoint: Path) -> None:
        try:
            import torch
            import ultralytics  # type: ignore[import-not-found]
            from ultralytics import YOLO  # type: ignore[import-not-found]
        except ImportError as error:
            raise TrainerRefused(
                "Ultralytics is absent; run this entrypoint only inside the digest-pinned "
                "separately licensed owner training container"
            ) from error
        if ultralytics.__version__ != TRAINING_RUNTIME["ultralyticsVersion"]:
            raise TrainerRefused(
                "Ultralytics runtime version is not the pinned version"
            )
        if not torch.__version__.startswith(f"{TRAINING_RUNTIME['pytorchVersion']}+"):
            raise TrainerRefused("PyTorch runtime version is not the pinned version")
        if torch.version.cuda != TRAINING_RUNTIME["cudaVersion"]:
            raise TrainerRefused(
                "PyTorch CUDA runtime version is not the pinned version"
            )
        self._model = YOLO(str(checkpoint))

    def train_phase(
        self,
        *,
        data_yaml: Path,
        output_dir: Path,
        phase: dict[str, Any],
        common: dict[str, Any],
    ) -> None:
        if self._model is None:
            raise TrainerRefused("training backend has not loaded the checkpoint")
        augmentation = common["augmentation"]
        assert isinstance(augmentation, dict)
        self._model.train(
            data=str(data_yaml),
            project=str(output_dir),
            name=str(phase["name"]),
            exist_ok=False,
            epochs=int(phase["epochs"]),
            time=float(phase["timeHours"]),
            freeze=10 if bool(phase["freezeBackbone"]) else 0,
            patience=int(phase["earlyStoppingPatience"]),
            imgsz=int(common["imageSize"]),
            batch=int(common["batchSize"]),
            lr0=float(phase["initialLearningRate"]),
            amp=bool(common["amp"]),
            seed=int(common["seed"]),
            deterministic=True,
            device=0,
            workers=8,
            cache=False,
            fliplr=float(augmentation["horizontalFlipProbability"]),
            degrees=float(augmentation["degrees"]),
            translate=float(augmentation["translate"]),
            scale=float(augmentation["scale"]),
            perspective=float(augmentation["perspective"]),
            hsv_h=float(augmentation["hsvHue"]),
            hsv_s=float(augmentation["hsvSaturation"]),
            hsv_v=float(augmentation["hsvValue"]),
            mosaic=float(augmentation["mosaicProbability"]),
            mixup=float(augmentation["mixupProbability"]),
            val=True,
            plots=False,
            verbose=True,
        )

    def export(self, *, output_dir: Path, export_spec: dict[str, Any]) -> Path:
        if self._model is None:
            raise TrainerRefused("training backend has not loaded the checkpoint")
        exported = self._model.export(
            format="onnx",
            imgsz=int(export_spec["inputShape"][-1]),  # type: ignore[index]
            half=True,
            dynamic=False,
            opset=int(export_spec["opset"]),
            simplify=False,
            batch=1,
            device=0,
        )
        source = Path(str(exported))
        if source.is_symlink() or not source.is_file() or source.stat().st_size == 0:
            raise TrainerRefused(
                "Ultralytics export did not return a non-empty regular ONNX file"
            )
        destination = output_dir / "commandcanvas-hand-pose-candidate-v1.onnx"
        if source.resolve() != destination.resolve():
            shutil.copy2(source, destination)
        return destination


def _load_canonical_object(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise TrainerRefused(f"{label} must be a regular file")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise TrainerRefused(f"{label} is unreadable: {error}") from error
    if not isinstance(value, dict):
        raise TrainerRefused(f"{label} must be a JSON object")
    if path.read_bytes() != canonical_json_bytes(value):
        raise TrainerRefused(f"{label} must use deterministic canonical JSON")
    return value


def _write_dataset_descriptor(
    dataset_root: Path,
    manifest_path: Path,
    output_dir: Path,
) -> Path:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    group_to_split = {
        group: split for split, groups in manifest["splits"].items() for group in groups
    }
    image_lists: dict[str, list[str]] = {
        "train": [],
        "validation": [],
        "holdout": [],
    }
    for session in manifest["sessions"]:
        split = group_to_split[session["captureGroupId"]]
        image_lists[split].extend(
            str((dataset_root / frame["image"]["path"]).resolve())
            for frame in session["frames"]
        )
    list_paths: dict[str, Path] = {}
    for split, images in image_lists.items():
        path = output_dir / f"{split}-images.txt"
        path.write_text(
            "".join(f"{image}\n" for image in sorted(images)), encoding="utf-8"
        )
        list_paths[split] = path
    descriptor = output_dir / "commandcanvas-hand-dataset-v1.yaml"
    flip_indices = [
        0,
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10,
        11,
        12,
        13,
        14,
        15,
        16,
        17,
        18,
        19,
        20,
    ]
    descriptor.write_text(
        "\n".join(
            (
                f"path: {json.dumps(str(dataset_root.resolve()))}",
                f"train: {json.dumps(str(list_paths['train'].resolve()))}",
                f"val: {json.dumps(str(list_paths['validation'].resolve()))}",
                f"test: {json.dumps(str(list_paths['holdout'].resolve()))}",
                "kpt_shape: [21, 3]",
                f"flip_idx: {json.dumps(flip_indices)}",
                "names:",
                "  0: hand",
                "",
            )
        ),
        encoding="utf-8",
    )
    return descriptor


def run_owner_experiment(
    *,
    dataset_root: Path,
    manifest_path: Path,
    dataset_receipt_path: Path,
    training_spec_path: Path,
    checkpoint_path: Path,
    output_dir: Path,
    acknowledge_owner_only_license_boundary: bool,
    backend: TrainingBackend | None = None,
    inspection: OnnxInspection | None = None,
) -> dict[str, Any]:
    """Run the exact bounded recipe and emit a non-promoting candidate manifest."""

    if not acknowledge_owner_only_license_boundary:
        raise TrainerRefused(
            "explicit acknowledgement of the owner-only AGPL/CC-BY-NC-SA license boundary is required"
        )
    try:
        current_receipt = validate_dataset(dataset_root, manifest_path)
    except DatasetValidationError as error:
        raise TrainerRefused(f"dataset validation failed: {error}") from error
    stored_receipt = _load_canonical_object(dataset_receipt_path, "dataset receipt")
    if stored_receipt != current_receipt:
        raise TrainerRefused("dataset receipt does not match current dataset bytes")
    expected_spec = build_training_spec(current_receipt)
    stored_spec = _load_canonical_object(training_spec_path, "training spec")
    if stored_spec != expected_spec:
        raise TrainerRefused("training spec does not match the current bounded recipe")
    checkpoint = Path(checkpoint_path)
    if (
        checkpoint.is_symlink()
        or not checkpoint.is_file()
        or checkpoint.stat().st_size == 0
    ):
        raise TrainerRefused("upstream checkpoint must be a non-empty regular file")
    if sha256_file(checkpoint) != UPSTREAM_CHECKPOINT["sha256"]:
        raise TrainerRefused(
            "upstream checkpoint SHA-256 does not match the pinned revision"
        )
    destination = Path(output_dir)
    if destination.is_symlink() or not destination.is_dir():
        raise TrainerRefused(
            "output directory must be an existing non-symlink directory"
        )
    if any(destination.iterdir()):
        raise TrainerRefused("output directory must be empty")

    data_yaml = _write_dataset_descriptor(dataset_root, manifest_path, destination)
    selected_backend = backend or UltralyticsBackend()
    selected_backend.load(checkpoint)
    common: dict[str, Any] = {
        "seed": expected_spec["seed"],
        "imageSize": expected_spec["imageSize"],
        "batchSize": expected_spec["batchSize"],
        "amp": expected_spec["amp"],
        "augmentation": expected_spec["augmentation"],
        "wallTimeMinutes": expected_spec["wallTimeMinutes"],
    }
    for phase in expected_spec["phases"]:
        selected_backend.train_phase(
            data_yaml=data_yaml,
            output_dir=destination,
            phase=phase,
            common=common,
        )
    candidate_path = selected_backend.export(
        output_dir=destination,
        export_spec=expected_spec["export"],
    )
    candidate_manifest = validate_onnx_contract(
        candidate_path,
        dataset_receipt_sha256=current_receipt["receiptSha256"],
        training_spec_sha256=expected_spec["specSha256"],
        inspection=inspection,
    )
    write_canonical_json(destination / "dataset-receipt.json", current_receipt)
    write_canonical_json(destination / "training-spec.json", expected_spec)
    write_canonical_json(destination / "candidate-manifest.json", candidate_manifest)
    return candidate_manifest
