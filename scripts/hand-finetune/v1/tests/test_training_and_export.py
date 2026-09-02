from __future__ import annotations

import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from commandcanvas_hand_finetune.canonical import (  # noqa: E402
    canonical_json_bytes,
    verify_digest,
)
from commandcanvas_hand_finetune.dataset import validate_dataset  # noqa: E402
from commandcanvas_hand_finetune.onnx_contract import (  # noqa: E402
    OnnxContractError,
    OnnxInspection,
    validate_onnx_contract,
)
from commandcanvas_hand_finetune.training_spec import (  # noqa: E402
    TrainingSpecError,
    build_training_spec,
)
from commandcanvas_hand_finetune import training_spec as training_spec_module  # noqa: E402

from fixture_dataset import write_valid_dataset  # noqa: E402


class TrainingSpecTests(unittest.TestCase):
    def test_runtime_lock_is_canonical_self_digested_and_dependency_complete(
        self,
    ) -> None:
        loader = getattr(training_spec_module, "load_training_runtime_lock", None)
        self.assertTrue(callable(loader))
        lock = loader()

        self.assertEqual(lock["schemaVersion"], "commandcanvas.hand-runtime-lock/v1")
        self.assertEqual(lock["pythonVersion"], "3.12.3")
        self.assertEqual(lock["ultralyticsVersion"], "8.4.33")
        self.assertEqual(lock["pytorchVersion"], "2.8.0+cu128")
        self.assertEqual(lock["cudaVersion"], "12.8")
        self.assertEqual(lock["onnxVersion"], "1.17.0")
        self.assertEqual(lock["onnxRuntimeVersion"], "1.23.2")
        self.assertEqual(lock["onnxRuntimeProvider"], "CUDAExecutionProvider")
        self.assertEqual(lock["baseImageRole"], "foundation-only")
        self.assertIsNone(lock["trainerImageDigest"])
        self.assertFalse(lock["executionEligible"])
        self.assertEqual(
            lock["buildDefinition"]["repository"], "commandcanvas-hand-relay"
        )
        self.assertEqual(lock["buildDefinition"]["license"], "AGPL-3.0-only")
        self.assertEqual(
            lock["buildDefinition"]["status"],
            "required-follow-up-not-in-mit-application",
        )
        self.assertTrue(verify_digest(lock, "runtimeLockSha256"))

        lock_path = training_spec_module.RUNTIME_LOCK_PATH
        self.assertEqual(lock_path.read_bytes(), canonical_json_bytes(lock))

        with tempfile.TemporaryDirectory() as directory:
            tampered_path = Path(directory) / "runtime.lock.json"
            tampered = dict(lock)
            tampered["pythonVersion"] = "0.0.0"
            tampered_path.write_text(
                json.dumps(tampered, sort_keys=True, separators=(",", ":")) + "\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(TrainingSpecError, "digest"):
                loader(tampered_path)

    def test_spec_is_bounded_pinned_and_never_production_eligible(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = validate_dataset(root, write_valid_dataset(root))

            spec = build_training_spec(receipt)

        self.assertEqual(
            spec["sourceCheckpoint"]["revision"],
            "2abb91a7030e1aa5231ec900ccb2c07ab3f03460",
        )
        self.assertEqual(
            spec["sourceCheckpoint"]["sha256"],
            "39cb54e63cac0d8905d7cab2112430dc9bf60a26779e361165fc03bf9c6ca36d",
        )
        self.assertTrue(spec["sourceCheckpoint"]["ownerOnlyExperimental"])
        self.assertEqual(
            spec["sourceCheckpoint"]["sourceDataset"]["license"],
            "CC-BY-NC-SA-4.0",
        )
        self.assertEqual(spec["runtime"]["ultralyticsVersion"], "8.4.33")
        self.assertEqual(spec["runtime"]["pytorchVersion"], "2.8.0+cu128")
        self.assertEqual(spec["runtime"]["onnxVersion"], "1.17.0")
        self.assertEqual(spec["runtime"]["onnxRuntimeVersion"], "1.23.2")
        self.assertFalse(spec["runtime"]["executionEligible"])
        self.assertTrue(verify_digest(spec["runtime"], "runtimeLockSha256"))
        self.assertRegex(
            spec["runtime"]["baseImage"],
            r"@sha256:[0-9a-f]{64}$",
        )
        self.assertFalse(spec["productionEligible"])
        self.assertEqual(spec["seed"], 20260902)
        self.assertEqual(spec["batchSize"], 64)
        self.assertEqual([phase["epochs"] for phase in spec["phases"]], [12, 36])
        self.assertEqual(
            [phase["initialLearningRate"] for phase in spec["phases"]],
            [0.001, 0.0002],
        )
        self.assertEqual(
            [phase["earlyStoppingPatience"] for phase in spec["phases"]],
            [5, 8],
        )
        self.assertTrue(spec["amp"])
        self.assertEqual(spec["augmentation"]["horizontalFlipProbability"], 0.15)
        self.assertEqual(spec["outputVersion"], "commandcanvas-hand-pose-candidate/v1")
        self.assertEqual(spec["wallTimeMinutes"], 90)
        self.assertEqual(spec["export"]["outputShape"], [1, 300, 69])
        self.assertEqual(
            spec["gpuPreference"], ["NVIDIA H200", "NVIDIA H100 80GB HBM3"]
        )
        self.assertRegex(spec["specSha256"], r"^[0-9a-f]{64}$")

    def test_ineligible_or_tampered_receipt_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = validate_dataset(root, write_valid_dataset(root))
        receipt["eligibleForTraining"] = False
        with self.assertRaisesRegex(TrainingSpecError, "eligible"):
            build_training_spec(receipt)


class OnnxContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.path = Path(self.temporary_directory.name) / "candidate.onnx"
        self.path.write_bytes(b"synthetic-onnx-contract-fixture")

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _valid_inspection(self) -> OnnxInspection:
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

    def test_exact_fp16_graph_contract_emits_non_promoting_manifest(self) -> None:
        manifest = validate_onnx_contract(
            self.path,
            inspection=self._valid_inspection(),
            dataset_receipt_sha256="a" * 64,
            training_spec_sha256="b" * 64,
        )
        self.assertEqual(
            manifest["input"],
            {"name": "images", "type": "tensor(float)", "shape": [1, 3, 640, 640]},
        )
        self.assertEqual(
            manifest["output"],
            {"name": "output0", "type": "tensor(float)", "shape": [1, 300, 69]},
        )
        self.assertEqual(manifest["precision"], "fp16-graph-fp32-io")
        self.assertFalse(manifest["productionEligible"])

    def test_wrong_tensor_contract_or_checker_failure_is_refused(self) -> None:
        inspection = self._valid_inspection()
        wrong = OnnxInspection(
            **{
                **inspection.__dict__,
                "checker_passed": False,
                "output_shape": (1, 69, 300),
            }
        )
        with self.assertRaises(OnnxContractError) as caught:
            validate_onnx_contract(
                self.path,
                inspection=wrong,
                dataset_receipt_sha256="a" * 64,
                training_spec_sha256="b" * 64,
            )
        self.assertIn("checker", str(caught.exception))
        self.assertIn("output tensor", str(caught.exception))

    def test_non_finite_output_is_refused(self) -> None:
        inspection = self._valid_inspection()
        bad_output = np.zeros((1, 300, 69), dtype=np.float32)
        bad_output[0, 0, 0] = math.nan
        wrong = OnnxInspection(**{**inspection.__dict__, "outputs": (bad_output,)})
        with self.assertRaisesRegex(OnnxContractError, "finite"):
            validate_onnx_contract(
                self.path,
                inspection=wrong,
                dataset_receipt_sha256="a" * 64,
                training_spec_sha256="b" * 64,
            )


if __name__ == "__main__":
    unittest.main()
