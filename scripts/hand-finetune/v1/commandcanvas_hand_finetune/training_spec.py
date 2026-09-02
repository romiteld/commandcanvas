"""Neutral, bounded specification for an owner-only experimental training run."""

from __future__ import annotations

from typing import Any

from .canonical import attach_digest, verify_digest


class TrainingSpecError(ValueError):
    pass


UPSTREAM_CHECKPOINT = {
    "repository": "poptoz/yolo26-hand-pose-face-detection",
    "revision": "2abb91a7030e1aa5231ec900ccb2c07ab3f03460",
    "path": "checkpoints/yolo26_hand_pose.pt",
    "sha256": "39cb54e63cac0d8905d7cab2112430dc9bf60a26779e361165fc03bf9c6ca36d",
    "ownerOnlyExperimental": True,
    "licenseBoundary": "AGPL runtime and CC-BY-NC-SA dataset boundary; not redistributable in MIT app",
}


def build_training_spec(dataset_receipt: dict[str, Any]) -> dict[str, Any]:
    if dataset_receipt.get("eligibleForTraining") is not True:
        raise TrainingSpecError("dataset receipt is not eligible for training")
    if not verify_digest(dataset_receipt, "receiptSha256"):
        raise TrainingSpecError(
            "eligible dataset receipt digest is missing or tampered"
        )
    if dataset_receipt.get("eligibilityScope") != "dataset-for-training-only":
        raise TrainingSpecError("dataset receipt eligibility scope is invalid")
    spec = {
        "schemaVersion": "commandcanvas.hand-training-spec/v1",
        "datasetReceiptSha256": dataset_receipt["receiptSha256"],
        "sourceCheckpoint": dict(UPSTREAM_CHECKPOINT),
        "productionEligible": False,
        "promotionState": "owner-only-experimental",
        "seed": 20260902,
        "imageSize": 640,
        "batchSize": 64,
        "maxHands": 2,
        "amp": True,
        "augmentation": {
            "horizontalFlipProbability": 0.15,
            "degrees": 6.0,
            "translate": 0.08,
            "scale": 0.12,
            "perspective": 0.0002,
            "hsvHue": 0.01,
            "hsvSaturation": 0.25,
            "hsvValue": 0.20,
            "mosaicProbability": 0.20,
            "mixupProbability": 0.0,
            "note": "moderate target-domain augmentation; no synthetic hand articulation",
        },
        "phases": [
            {
                "name": "head-warmup",
                "epochs": 12,
                "timeHours": 0.35,
                "initialLearningRate": 0.001,
                "freezeBackbone": True,
                "earlyStoppingPatience": 5,
            },
            {
                "name": "bounded-finetune",
                "epochs": 36,
                "timeHours": 1.15,
                "initialLearningRate": 0.0002,
                "freezeBackbone": False,
                "earlyStoppingPatience": 8,
            },
        ],
        "wallTimeMinutes": 90,
        "outputVersion": "commandcanvas-hand-pose-candidate/v1",
        "gpuPreference": ["NVIDIA H200", "NVIDIA H100 80GB HBM3"],
        "export": {
            "format": "onnx",
            "opset": 17,
            "dynamic": False,
            "inputName": "images",
            "inputType": "tensor(float)",
            "inputShape": [1, 3, 640, 640],
            "outputName": "output0",
            "outputType": "tensor(float)",
            "outputShape": [1, 300, 69],
            "precision": "fp16-graph-fp32-io",
        },
    }
    return attach_digest(spec, "specSha256")
