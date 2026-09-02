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

from fixture_dataset import read_manifest, sha256, write_manifest, write_valid_dataset  # noqa: E402


class YoloPoseLabelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.manifest_path = write_valid_dataset(self.root)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _replace_first_label(self, content: str) -> None:
        manifest = read_manifest(self.manifest_path)
        label = manifest["sessions"][0]["frames"][0]["label"]
        path = self.root / label["path"]
        path.write_text(content, encoding="utf-8")
        label["byteSize"] = path.stat().st_size
        label["sha256"] = sha256(path)
        write_manifest(self.manifest_path, manifest)

    def test_wrong_class_or_keypoint_count_is_refused(self) -> None:
        self._replace_first_label("1 0.5 0.5 0.8 0.8 " + " ".join(["0.5 0.5 2"] * 20))
        with self.assertRaises(DatasetValidationError) as caught:
            validate_dataset(self.root, self.manifest_path)
        self.assertIn("68 tokens", str(caught.exception))
        self.assertIn("class 0", str(caught.exception))

    def test_non_finite_or_out_of_range_coordinate_is_refused(self) -> None:
        values = ["0", "0.5", "0.5", "0.8", "0.8"] + ["0.5", "0.5", "2"] * 21
        values[5] = "nan"
        values[8] = "1.1"
        self._replace_first_label(" ".join(values) + "\n")
        with self.assertRaises(DatasetValidationError) as caught:
            validate_dataset(self.root, self.manifest_path)
        self.assertIn("finite", str(caught.exception))
        self.assertIn("normalized", str(caught.exception))

    def test_visibility_is_categorical_not_normalized_confidence(self) -> None:
        values = ["0", "0.5", "0.5", "0.8", "0.8"] + ["0.5", "0.5", "2"] * 21
        values[7] = "0.5"
        self._replace_first_label(" ".join(values) + "\n")
        with self.assertRaisesRegex(DatasetValidationError, "visibility.*0, 1, or 2"):
            validate_dataset(self.root, self.manifest_path)

    def test_negative_frame_must_have_empty_label(self) -> None:
        manifest = read_manifest(self.manifest_path)
        frame = manifest["sessions"][0]["frames"][0]
        frame["categories"] = ["negative"]
        write_manifest(self.manifest_path, manifest)
        with self.assertRaisesRegex(DatasetValidationError, "negative.*empty"):
            validate_dataset(self.root, self.manifest_path)

    def test_positive_frame_must_contain_one_or_two_hands(self) -> None:
        self._replace_first_label("")
        with self.assertRaisesRegex(DatasetValidationError, "positive.*hand"):
            validate_dataset(self.root, self.manifest_path)

    def test_more_than_two_hands_is_refused(self) -> None:
        manifest = read_manifest(self.manifest_path)
        label = manifest["sessions"][0]["frames"][0]["label"]
        path = self.root / label["path"]
        row = path.read_text(encoding="utf-8").strip()
        path.write_text(f"{row}\n{row}\n{row}\n", encoding="utf-8")
        label["byteSize"] = path.stat().st_size
        label["sha256"] = sha256(path)
        write_manifest(self.manifest_path, manifest)
        with self.assertRaisesRegex(DatasetValidationError, "at most two hands"):
            validate_dataset(self.root, self.manifest_path)


if __name__ == "__main__":
    unittest.main()
