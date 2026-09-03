"""Network-free-by-default command line entrypoint."""

from __future__ import annotations

import argparse
import json
import os
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Sequence

from .archive_dataset import DatasetArchiveError, archive_dataset
from .canonical import canonical_json_bytes, write_canonical_json
from .annotation_workbench import (
    AnnotationWorkbenchError,
    finalize_annotations,
    run_annotation_workbench,
)
from .dataset import DatasetValidationError, validate_dataset
from .onnx_contract import OnnxContractError, validate_onnx_contract
from .prepare_annotation_draft import (
    AnnotationDraftPreparationError,
    prepare_annotation_draft,
)
from .prelabel_annotation_draft import (
    PrelabelPreparationError,
    prepare_prelabel_annotation_draft,
)
from .prepare_dataset import DatasetPreparationError, prepare_dataset
from .runpod import (
    LaunchInputs,
    LaunchRefused,
    RunPodClient,
    execute_launch,
    prepare_launch,
)
from .trainer import TrainerRefused, run_owner_experiment
from .training_spec import TrainingSpecError, build_training_spec


def _print(value: Any) -> None:
    print(canonical_json_bytes(value).decode("utf-8"), end="")


def _launch_inputs(arguments: argparse.Namespace) -> LaunchInputs:
    try:
        max_spend = Decimal(arguments.max_spend_usd)
    except InvalidOperation as error:
        raise LaunchRefused("--max-spend-usd must be a decimal amount") from error
    return LaunchInputs(
        dataset_root=arguments.dataset_root,
        manifest_path=arguments.manifest,
        receipt_path=arguments.receipt,
        archive_path=arguments.archive,
        output_dir=arguments.output_dir,
        ssh_private_key=arguments.ssh_private_key,
        container_ref=arguments.container_ref,
        max_runtime_minutes=arguments.max_runtime_minutes,
        max_spend_usd=max_spend,
    )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="commandcanvas-hand-finetune-v1")
    subcommands = parser.add_subparsers(dest="command", required=True)

    dataset = subcommands.add_parser("validate-dataset")
    dataset.add_argument("--dataset-root", required=True, type=Path)
    dataset.add_argument("--manifest", required=True, type=Path)
    dataset.add_argument("--output", required=True, type=Path)

    prepare = subcommands.add_parser("prepare-dataset")
    prepare.add_argument("--capture-root", required=True, type=Path)
    prepare.add_argument("--session-map", required=True, type=Path)
    prepare.add_argument("--labels-root", required=True, type=Path)
    prepare.add_argument("--output-dir", required=True, type=Path)
    prepare.add_argument("--annotation-finalization-receipt", type=Path)

    prepare_draft = subcommands.add_parser(
        "prepare-annotation-draft",
        help="extract Vision Lab frames into a local manual-review draft",
    )
    prepare_draft.add_argument("--capture-root", required=True, type=Path)
    prepare_draft.add_argument("--session-map", required=True, type=Path)
    prepare_draft.add_argument("--output-dir", required=True, type=Path)

    prepare_prelabel = subcommands.add_parser(
        "prepare-prelabeled-annotation-draft",
        help="apply the pinned local YOLO26 pose checkpoint before manual review",
    )
    prepare_prelabel.add_argument("--capture-root", required=True, type=Path)
    prepare_prelabel.add_argument("--session-map", required=True, type=Path)
    prepare_prelabel.add_argument("--output-dir", required=True, type=Path)
    prepare_prelabel.add_argument("--checkpoint", required=True, type=Path)
    prepare_prelabel.add_argument(
        "--device",
        default="0",
        help="local Ultralytics inference device (default: first CUDA GPU)",
    )
    prepare_prelabel.add_argument(
        "--acknowledge-owner-only-license-boundary",
        action="store_true",
        required=True,
    )

    archive = subcommands.add_parser("archive-dataset")
    archive.add_argument("--dataset-root", required=True, type=Path)
    archive.add_argument("--manifest", required=True, type=Path)
    archive.add_argument("--dataset-receipt", required=True, type=Path)
    archive.add_argument("--output", required=True, type=Path)
    archive.add_argument("--archive-receipt", required=True, type=Path)

    spec = subcommands.add_parser("build-training-spec")
    spec.add_argument("--receipt", required=True, type=Path)
    spec.add_argument("--output", required=True, type=Path)

    onnx = subcommands.add_parser("validate-onnx")
    onnx.add_argument("--model", required=True, type=Path)
    onnx.add_argument("--dataset-receipt-sha256", required=True)
    onnx.add_argument("--training-spec-sha256", required=True)
    onnx.add_argument("--output", required=True, type=Path)

    train = subcommands.add_parser("train-owner-experiment")
    train.add_argument("--dataset-root", required=True, type=Path)
    train.add_argument("--manifest", required=True, type=Path)
    train.add_argument("--receipt", required=True, type=Path)
    train.add_argument("--training-spec", required=True, type=Path)
    train.add_argument("--checkpoint", required=True, type=Path)
    train.add_argument("--output-dir", required=True, type=Path)
    train.add_argument(
        "--acknowledge-owner-only-license-boundary",
        action="store_true",
        required=True,
    )

    launch = subcommands.add_parser("launch")
    launch.add_argument("--dataset-root", required=True, type=Path)
    launch.add_argument("--manifest", required=True, type=Path)
    launch.add_argument("--receipt", required=True, type=Path)
    launch.add_argument("--archive", required=True, type=Path)
    launch.add_argument("--output-dir", required=True, type=Path)
    launch.add_argument("--ssh-private-key", required=True, type=Path)
    launch.add_argument("--container-ref", required=True)
    launch.add_argument("--max-runtime-minutes", required=True, type=int)
    launch.add_argument("--max-spend-usd", required=True)
    launch.add_argument(
        "--execute",
        action="store_true",
        help="request a real launch; currently refuses before network until transfer gates are complete",
    )

    cleanup = subcommands.add_parser("cleanup-pod")
    cleanup.add_argument("--pod-id", required=True)
    cleanup.add_argument("--execute", action="store_true", required=True)

    annotate = subcommands.add_parser(
        "annotate",
        help="run the manual hand-keypoint workbench on loopback only",
    )
    annotate.add_argument("--dataset-root", required=True, type=Path)
    annotate.add_argument("--manifest", required=True, type=Path)
    annotate.add_argument("--editor-id", required=True)
    annotate.add_argument("--host", default="127.0.0.1")
    annotate.add_argument("--port", default=8765, type=int)

    finalize = subcommands.add_parser(
        "finalize-annotations",
        help="validate corrected labels and write the final annotation receipt",
    )
    finalize.add_argument("--dataset-root", required=True, type=Path)
    finalize.add_argument("--manifest", required=True, type=Path)
    finalize.add_argument("--editor-id", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    try:
        if arguments.command == "validate-dataset":
            result = validate_dataset(arguments.dataset_root, arguments.manifest)
            write_canonical_json(arguments.output, result)
        elif arguments.command == "prepare-annotation-draft":
            result = prepare_annotation_draft(
                capture_root=arguments.capture_root,
                session_map_path=arguments.session_map,
                output_dir=arguments.output_dir,
            )
        elif arguments.command == "prepare-prelabeled-annotation-draft":
            result = prepare_prelabel_annotation_draft(
                capture_root=arguments.capture_root,
                session_map_path=arguments.session_map,
                output_dir=arguments.output_dir,
                checkpoint_path=arguments.checkpoint,
                acknowledge_owner_only_license_boundary=(
                    arguments.acknowledge_owner_only_license_boundary
                ),
                device=arguments.device,
            )
        elif arguments.command == "prepare-dataset":
            result = prepare_dataset(
                capture_root=arguments.capture_root,
                session_map_path=arguments.session_map,
                labels_root=arguments.labels_root,
                output_dir=arguments.output_dir,
                annotation_finalization_receipt_path=(
                    arguments.annotation_finalization_receipt
                ),
            )
        elif arguments.command == "archive-dataset":
            result = archive_dataset(
                dataset_root=arguments.dataset_root,
                manifest_path=arguments.manifest,
                dataset_receipt_path=arguments.dataset_receipt,
                output_path=arguments.output,
                archive_receipt_path=arguments.archive_receipt,
            )
        elif arguments.command == "build-training-spec":
            receipt = json.loads(arguments.receipt.read_text(encoding="utf-8"))
            result = build_training_spec(receipt)
            write_canonical_json(arguments.output, result)
        elif arguments.command == "validate-onnx":
            result = validate_onnx_contract(
                arguments.model,
                dataset_receipt_sha256=arguments.dataset_receipt_sha256,
                training_spec_sha256=arguments.training_spec_sha256,
            )
            write_canonical_json(arguments.output, result)
        elif arguments.command == "train-owner-experiment":
            result = run_owner_experiment(
                dataset_root=arguments.dataset_root,
                manifest_path=arguments.manifest,
                dataset_receipt_path=arguments.receipt,
                training_spec_path=arguments.training_spec,
                checkpoint_path=arguments.checkpoint,
                output_dir=arguments.output_dir,
                acknowledge_owner_only_license_boundary=(
                    arguments.acknowledge_owner_only_license_boundary
                ),
            )
        elif arguments.command == "launch":
            inputs = _launch_inputs(arguments)
            result = (
                execute_launch(inputs) if arguments.execute else prepare_launch(inputs)
            )
        elif arguments.command == "cleanup-pod":
            api_key = os.environ.get("RUNPOD_API_KEY")
            if not api_key:
                raise LaunchRefused(
                    "RUNPOD_API_KEY must be present in the current environment"
                )
            RunPodClient(api_key=api_key).delete_pod(arguments.pod_id)
            result = {"deleted": True, "podId": arguments.pod_id}
        elif arguments.command == "annotate":
            run_annotation_workbench(
                dataset_root=arguments.dataset_root,
                manifest_path=arguments.manifest,
                host=arguments.host,
                port=arguments.port,
                editor_id=arguments.editor_id,
            )
            result = {"stopped": True}
        elif arguments.command == "finalize-annotations":
            result = finalize_annotations(
                dataset_root=arguments.dataset_root,
                manifest_path=arguments.manifest,
                editor_id=arguments.editor_id,
            )
        else:  # pragma: no cover - argparse enforces the choices
            raise AssertionError(arguments.command)
    except (
        DatasetArchiveError,
        AnnotationDraftPreparationError,
        PrelabelPreparationError,
        DatasetPreparationError,
        DatasetValidationError,
        AnnotationWorkbenchError,
        LaunchRefused,
        OnnxContractError,
        TrainerRefused,
        TrainingSpecError,
        OSError,
        UnicodeError,
        json.JSONDecodeError,
    ) as error:
        _print({"ok": False, "error": str(error)})
        return 2
    _print({"ok": True, "result": result})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
