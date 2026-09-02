from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from commandcanvas_hand_finetune.canonical import write_canonical_json  # noqa: E402
from commandcanvas_hand_finetune.dataset import validate_dataset  # noqa: E402
from commandcanvas_hand_finetune.onnx_contract import OnnxInspection  # noqa: E402
from commandcanvas_hand_finetune.trainer import (  # noqa: E402
    TrainerRefused,
    run_owner_experiment,
)
from commandcanvas_hand_finetune.training_spec import (  # noqa: E402
    UPSTREAM_CHECKPOINT,
    build_training_spec,
)

from fixture_dataset import write_valid_dataset  # noqa: E402


class RecordingBackend:
    def __init__(self) -> None:
        self.loaded: Path | None = None
        self.phases: list[dict[str, object]] = []
        self.export_arguments: dict[str, object] | None = None

    def load(self, checkpoint: Path) -> None:
        self.loaded = checkpoint

    def train_phase(
        self,
        *,
        data_yaml: Path,
        output_dir: Path,
        phase: dict[str, object],
        common: dict[str, object],
    ) -> None:
        self.phases.append(
            {"data": data_yaml, "output": output_dir, "phase": phase, "common": common}
        )

    def export(self, *, output_dir: Path, export_spec: dict[str, object]) -> Path:
        self.export_arguments = export_spec
        path = output_dir / "commandcanvas-hand-pose-candidate-v1.onnx"
        path.write_bytes(b"synthetic-onnx-candidate")
        return path


def valid_inspection() -> OnnxInspection:
    return OnnxInspection(
        checker_passed=True,
        providers=("CUDAExecutionProvider",),
        input_name="images",
        input_type="tensor(float)",
        input_shape=(1, 3, 640, 640),
        output_name="output0",
        output_type="tensor(float)",
        output_shape=(1, 300, 69),
        outputs=(np.zeros((1, 300, 69), dtype=np.float32),),
    )


class TrainerEntrypointTests(unittest.TestCase):
    def test_executes_pinned_bounded_two_phase_recipe_and_non_promoting_export(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dataset_root = root / "dataset"
            dataset_root.mkdir()
            manifest_path = write_valid_dataset(dataset_root)
            receipt = validate_dataset(dataset_root, manifest_path)
            spec = build_training_spec(receipt)
            receipt_path = root / "receipt.json"
            spec_path = root / "spec.json"
            write_canonical_json(receipt_path, receipt)
            write_canonical_json(spec_path, spec)
            checkpoint = root / "upstream.pt"
            checkpoint.write_bytes(b"synthetic-pinned-checkpoint")
            output = root / "output"
            output.mkdir()
            backend = RecordingBackend()

            with patch(
                "commandcanvas_hand_finetune.trainer.sha256_file",
                return_value=UPSTREAM_CHECKPOINT["sha256"],
            ):
                candidate = run_owner_experiment(
                    dataset_root=dataset_root,
                    manifest_path=manifest_path,
                    dataset_receipt_path=receipt_path,
                    training_spec_path=spec_path,
                    checkpoint_path=checkpoint,
                    output_dir=output,
                    backend=backend,
                    inspection=valid_inspection(),
                    acknowledge_owner_only_license_boundary=True,
                )

        self.assertEqual(backend.loaded, checkpoint)
        self.assertEqual(
            [phase["phase"]["epochs"] for phase in backend.phases], [12, 36]
        )
        self.assertEqual(
            [phase["phase"]["freezeBackbone"] for phase in backend.phases],
            [True, False],
        )
        self.assertTrue(all(phase["common"]["amp"] for phase in backend.phases))
        self.assertTrue(
            all(phase["common"]["batchSize"] == 64 for phase in backend.phases)
        )
        self.assertEqual(
            [phase["phase"]["initialLearningRate"] for phase in backend.phases],
            [0.001, 0.0002],
        )
        self.assertEqual(backend.export_arguments["outputShape"], [1, 300, 69])
        self.assertFalse(candidate["productionEligible"])
        self.assertEqual(
            candidate["promotionState"],
            "candidate-requires-benchmark-license-and-human-acceptance",
        )

    def test_refuses_unpinned_checkpoint_or_missing_license_acknowledgement_before_backend(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            dataset_root = root / "dataset"
            dataset_root.mkdir()
            manifest_path = write_valid_dataset(dataset_root)
            receipt = validate_dataset(dataset_root, manifest_path)
            spec = build_training_spec(receipt)
            receipt_path = root / "receipt.json"
            spec_path = root / "spec.json"
            write_canonical_json(receipt_path, receipt)
            write_canonical_json(spec_path, spec)
            checkpoint = root / "upstream.pt"
            checkpoint.write_bytes(b"wrong-checkpoint")
            output = root / "output"
            output.mkdir()
            backend = RecordingBackend()

            with self.assertRaisesRegex(TrainerRefused, "license boundary"):
                run_owner_experiment(
                    dataset_root=dataset_root,
                    manifest_path=manifest_path,
                    dataset_receipt_path=receipt_path,
                    training_spec_path=spec_path,
                    checkpoint_path=checkpoint,
                    output_dir=output,
                    backend=backend,
                    inspection=valid_inspection(),
                    acknowledge_owner_only_license_boundary=False,
                )
            with self.assertRaisesRegex(TrainerRefused, "checkpoint SHA-256"):
                run_owner_experiment(
                    dataset_root=dataset_root,
                    manifest_path=manifest_path,
                    dataset_receipt_path=receipt_path,
                    training_spec_path=spec_path,
                    checkpoint_path=checkpoint,
                    output_dir=output,
                    backend=backend,
                    inspection=valid_inspection(),
                    acknowledge_owner_only_license_boundary=True,
                )

        self.assertIsNone(backend.loaded)


if __name__ == "__main__":
    unittest.main()
