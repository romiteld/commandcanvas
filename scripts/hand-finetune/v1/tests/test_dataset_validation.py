from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from commandcanvas_hand_finetune.dataset import (  # noqa: E402
    DatasetValidationError,
    validate_dataset,
)

from fixture_dataset import (  # noqa: E402
    CAPTURE_GROUP_IDS,
    read_manifest,
    sha256,
    write_manifest,
    write_valid_dataset,
)


class DatasetValidationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.manifest_path = write_valid_dataset(self.root)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_valid_target_dataset_emits_deterministic_eligible_receipt(self) -> None:
        first = validate_dataset(self.root, self.manifest_path)
        second = validate_dataset(self.root, self.manifest_path)

        self.assertEqual(first, second)
        self.assertTrue(first["eligibleForTraining"])
        self.assertTrue(first["productionEligible"])
        self.assertEqual(first["eligibilityScope"], "dataset-for-training-only")
        self.assertEqual(
            first["splitCounts"], {"holdout": 2, "train": 2, "validation": 2}
        )
        self.assertEqual(
            first["hardSubsetCounts"],
            {"drawing": 2, "edge": 2, "negative": 3, "pinch": 2, "two_hand": 2},
        )
        self.assertRegex(first["receiptSha256"], r"^[0-9a-f]{64}$")

    def test_overlay_derived_source_is_refused(self) -> None:
        manifest = read_manifest(self.manifest_path)
        manifest["sessions"][0]["source"]["overlayDerived"] = True
        write_manifest(self.manifest_path, manifest)

        with self.assertRaisesRegex(DatasetValidationError, "overlayDerived"):
            validate_dataset(self.root, self.manifest_path)

    def test_accepts_verified_actual_camera_dimensions_and_refuses_invalid_bounds(
        self,
    ) -> None:
        manifest = read_manifest(self.manifest_path)
        for session in manifest["sessions"]:
            session["source"]["width"] = 1280
            session["source"]["height"] = 720
        write_manifest(self.manifest_path, manifest)

        receipt = validate_dataset(self.root, self.manifest_path)
        self.assertTrue(receipt["eligibleForTraining"])

        manifest["sessions"][0]["source"]["width"] = 0
        manifest["sessions"][0]["source"]["height"] = 20000
        write_manifest(self.manifest_path, manifest)
        with self.assertRaises(DatasetValidationError) as caught:
            validate_dataset(self.root, self.manifest_path)
        self.assertIn("source dimensions", str(caught.exception))

    def test_mismatched_frame_hash_and_dimensions_are_refused(self) -> None:
        manifest = read_manifest(self.manifest_path)
        manifest["sessions"][0]["frames"][0]["image"]["sha256"] = "0" * 64
        manifest["sessions"][0]["frames"][0]["image"]["width"] = 63
        write_manifest(self.manifest_path, manifest)

        with self.assertRaises(DatasetValidationError) as caught:
            validate_dataset(self.root, self.manifest_path)

        message = str(caught.exception)
        self.assertIn("SHA-256", message)
        self.assertIn("dimensions", message)

    def test_capture_group_and_source_video_leakage_across_splits_are_refused(
        self,
    ) -> None:
        manifest = read_manifest(self.manifest_path)
        manifest["splits"]["validation"] = [CAPTURE_GROUP_IDS[0]]
        manifest["sessions"][1]["captureGroupId"] = CAPTURE_GROUP_IDS[0]
        train_source = manifest["sessions"][0]["source"]
        validation_source = manifest["sessions"][1]["source"]
        validation_path = self.root / validation_source["path"]
        train_path = self.root / train_source["path"]
        validation_path.write_bytes(train_path.read_bytes())
        validation_source["byteSize"] = validation_path.stat().st_size
        validation_source["sha256"] = sha256(validation_path)
        write_manifest(self.manifest_path, manifest)

        with self.assertRaises(DatasetValidationError) as caught:
            validate_dataset(self.root, self.manifest_path)

        message = str(caught.exception)
        self.assertIn("captureGroupId", message)
        self.assertIn("source video", message)

    def test_fewer_than_three_sessions_and_missing_hard_subsets_are_refused(
        self,
    ) -> None:
        manifest = read_manifest(self.manifest_path)
        manifest["sessions"] = manifest["sessions"][:2]
        manifest["splits"]["holdout"] = []
        for session in manifest["sessions"]:
            for frame in session["frames"]:
                frame["categories"] = ["negative"]
                label_path = self.root / frame["label"]["path"]
                label_path.write_text("", encoding="utf-8")
                frame["label"]["byteSize"] = 0
                frame["label"]["sha256"] = sha256(label_path)
        write_manifest(self.manifest_path, manifest)

        with self.assertRaises(DatasetValidationError) as caught:
            validate_dataset(self.root, self.manifest_path)

        message = str(caught.exception)
        self.assertIn("at least three sessions", message)
        self.assertIn("drawing", message)
        self.assertIn("pinch", message)
        self.assertIn("edge", message)
        self.assertIn("two_hand", message)

    def test_model_assisted_holdout_without_manual_review_is_refused(self) -> None:
        manifest = read_manifest(self.manifest_path)
        manifest["sessions"][2]["annotation"] = {
            "method": "model_assisted",
            "reviewed": False,
            "tool": "pose-labeler",
            "toolVersion": "1.0.0",
            "modelSha256": "1" * 64,
        }
        write_manifest(self.manifest_path, manifest)

        with self.assertRaisesRegex(DatasetValidationError, "holdout.*manual"):
            validate_dataset(self.root, self.manifest_path)

    def test_duplicate_json_keys_and_path_traversal_are_refused(self) -> None:
        raw = self.manifest_path.read_text(encoding="utf-8")
        self.manifest_path.write_text(
            raw.replace('"datasetId":', '"datasetId": "duplicate",\n  "datasetId":', 1),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(DatasetValidationError, "duplicate JSON key"):
            validate_dataset(self.root, self.manifest_path)

        self.manifest_path = write_valid_dataset(self.root)
        manifest = read_manifest(self.manifest_path)
        manifest["sessions"][0]["source"]["path"] = "../outside.webm"
        write_manifest(self.manifest_path, manifest)
        with self.assertRaisesRegex(DatasetValidationError, "safe relative path"):
            validate_dataset(self.root, self.manifest_path)

    def test_manifest_session_ids_are_canonical_uuids(self) -> None:
        manifest = read_manifest(self.manifest_path)
        manifest["sessions"][0]["sessionId"] = "AAAAAAAA-0000-4000-8000-000000000101"
        write_manifest(self.manifest_path, manifest)

        with self.assertRaisesRegex(DatasetValidationError, "sessionId"):
            validate_dataset(self.root, self.manifest_path)

    def test_receipt_uses_actual_manifest_bytes(self) -> None:
        receipt = validate_dataset(self.root, self.manifest_path)
        self.assertEqual(receipt["manifestSha256"], sha256(self.manifest_path))
        self.assertEqual(
            sorted(receipt["sourceVideoDigests"]),
            sorted(
                session["source"]["sha256"]
                for session in read_manifest(self.manifest_path)["sessions"]
            ),
        )


if __name__ == "__main__":
    unittest.main()
