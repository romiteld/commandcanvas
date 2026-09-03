from __future__ import annotations

import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from commandcanvas_hand_finetune.annotation_workbench import (  # noqa: E402
    finalize_annotations,
    load_frame_annotation,
    save_frame_annotation,
    validate_annotation_manifest,
)
from commandcanvas_hand_finetune.archive_dataset import archive_dataset  # noqa: E402
from commandcanvas_hand_finetune.canonical import (  # noqa: E402
    canonical_json_bytes,
    sha256_bytes,
    sha256_file,
    write_canonical_json,
)
from commandcanvas_hand_finetune.dataset import (  # noqa: E402
    DatasetValidationError,
    validate_dataset,
)
from commandcanvas_hand_finetune.prepare_annotation_draft import (  # noqa: E402
    AnnotationDraftPreparationError,
    prepare_annotation_draft,
)
from commandcanvas_hand_finetune.prepare_dataset import (  # noqa: E402
    DatasetPreparationError,
    prepare_dataset,
)

from test_dataset_bridge import FakeMediaRunner, write_bridge_inputs  # noqa: E402


class AnnotationDraftPreparationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.captures, _, self.session_map_path, self.session_map = write_bridge_inputs(
            self.root
        )
        for session in self.session_map["sessions"]:
            session["annotation"]["reviewed"] = False
            session["labelDir"] = f"labels/{session['datasetSessionId']}"
        self.session_map_path.write_text(
            json.dumps(self.session_map, sort_keys=True) + "\n", encoding="utf-8"
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_prepares_real_vision_lab_sources_as_an_unreviewed_draft(self) -> None:
        output = self.root / "annotation-draft"
        runner = FakeMediaRunner()

        result = prepare_annotation_draft(
            capture_root=self.captures,
            session_map_path=self.session_map_path,
            output_dir=output,
            command_runner=runner,
        )

        draft_path = output / "annotation-draft.json"
        draft = json.loads(draft_path.read_text())
        validation = validate_annotation_manifest(output, draft_path)
        self.assertEqual(result["manifestSha256"], sha256_file(draft_path))
        self.assertFalse(result["productionEligible"])
        self.assertEqual(validation["kind"], "draft")
        self.assertFalse(validation["complete"])
        self.assertEqual(draft["sourceAdapter"]["actorId"], "owner-daniel")
        self.assertEqual(
            draft["sourceAdapter"]["sourceManifestSha256"],
            sha256_bytes(canonical_json_bytes(self.session_map)),
        )
        self.assertEqual(
            [session["visionSessionId"] for session in draft["sessions"]],
            sorted(
                session["visionSessionId"] for session in self.session_map["sessions"]
            ),
        )
        self.assertTrue(
            all(
                session["actorId"] == self.session_map["actorId"]
                and session["annotation"]["reviewed"] is False
                for session in draft["sessions"]
            )
        )
        self.assertTrue(
            all(
                frame["reviewed"] is False
                and (output / frame["label"]["path"]).read_bytes() == b""
                for session in draft["sessions"]
                for frame in session["frames"]
            )
        )
        self.assertEqual(
            sum(Path(call[0]).name == "ffprobe" for call in runner.calls), 4
        )
        self.assertEqual(
            sum(Path(call[0]).name == "ffmpeg" for call in runner.calls), 8
        )

    def test_refuses_a_draft_root_inside_or_containing_the_repository(self) -> None:
        repository = PACKAGE_ROOT.parents[2]
        for output in (repository / ".private-annotation-output-never",):
            with self.subTest(output=output):
                with self.assertRaisesRegex(
                    AnnotationDraftPreparationError, "outside the repository"
                ):
                    prepare_annotation_draft(
                        capture_root=self.captures,
                        session_map_path=self.session_map_path,
                        output_dir=output,
                        command_runner=FakeMediaRunner(),
                    )
                self.assertFalse(output.exists())

    def test_refuses_nonmanual_source_annotations_without_prelabels(self) -> None:
        session_map = json.loads(self.session_map_path.read_text())
        session_map["sessions"][0]["annotation"] = {
            "method": "model_assisted",
            "reviewed": False,
            "tool": "unbound-prelabeler",
            "toolVersion": "1.0.0",
            "modelSha256": "a" * 64,
        }
        self.session_map_path.write_text(
            json.dumps(session_map, sort_keys=True) + "\n", encoding="utf-8"
        )

        with self.assertRaisesRegex(AnnotationDraftPreparationError, "manual|prelabel"):
            prepare_annotation_draft(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                output_dir=self.root / "refused",
                command_runner=FakeMediaRunner(),
            )

    def test_capture_review_bridge_and_archive_preserve_the_exact_edit_chain(
        self,
    ) -> None:
        draft_root = self.root / "draft"
        prepare_annotation_draft(
            capture_root=self.captures,
            session_map_path=self.session_map_path,
            output_dir=draft_root,
            command_runner=FakeMediaRunner(),
        )
        draft_path = draft_root / "annotation-draft.json"
        draft = json.loads(draft_path.read_text())
        points = [
            {
                "x": 0.2 + index * 0.02,
                "y": 0.3 + index * 0.01,
                "visibility": 2,
            }
            for index in range(21)
        ]
        for session in draft["sessions"]:
            for frame in session["frames"]:
                state = load_frame_annotation(
                    draft_root, draft_path, session["sessionId"], frame["frameId"]
                )
                negative = frame["categories"] == ["negative"]
                save_frame_annotation(
                    dataset_root=draft_root,
                    manifest_path=draft_path,
                    session_id=session["sessionId"],
                    frame_id=frame["frameId"],
                    editor_id="owner-daniel",
                    expected_manifest_sha256=state["manifestSha256"],
                    expected_label_sha256=state["labelSha256"],
                    negative=negative,
                    categories=frame["categories"],
                    hands=[] if negative else [{"keypoints": points}],
                )
        finalization = finalize_annotations(
            dataset_root=draft_root,
            manifest_path=draft_path,
            editor_id="owner-daniel",
        )

        dataset_root = self.root / "reviewed-dataset"
        dataset_receipt = prepare_dataset(
            capture_root=self.captures,
            session_map_path=self.session_map_path,
            labels_root=draft_root,
            annotation_finalization_receipt_path=(
                draft_root / "annotation-finalization-receipt.json"
            ),
            output_dir=dataset_root,
            command_runner=FakeMediaRunner(),
        )
        manifest = json.loads((dataset_root / "dataset-manifest.json").read_text())
        review = manifest["producerChain"]["annotationReview"]
        self.assertFalse(dataset_receipt["productionEligible"])
        self.assertEqual(
            review["draftManifest"]["sha256"], finalization["draftManifestSha256"]
        )
        self.assertEqual(
            review["finalizationReceipt"]["sha256"],
            sha256_file(draft_root / "annotation-finalization-receipt.json"),
        )
        self.assertEqual(
            [
                json.loads((dataset_root / asset["path"]).read_text())["receiptSha256"]
                for asset in review["editReceipts"]
            ],
            finalization["editReceiptSha256s"],
        )
        self.assertTrue(
            all(
                session["actorId"] == "owner-daniel"
                and session["annotation"]["reviewed"] is True
                for session in manifest["sessions"]
            )
        )

        archive_path = self.root / "reviewed-dataset.tar"
        archive_receipt_path = self.root / "reviewed-dataset-archive.json"
        archive_dataset(
            dataset_root=dataset_root,
            manifest_path=dataset_root / "dataset-manifest.json",
            dataset_receipt_path=dataset_root / "dataset-receipt.json",
            output_path=archive_path,
            archive_receipt_path=archive_receipt_path,
        )
        with tarfile.open(archive_path, "r:") as archive:
            names = set(archive.getnames())
        self.assertIn(review["draftManifest"]["path"], names)
        self.assertIn(review["finalizationReceipt"]["path"], names)
        self.assertTrue(all(asset["path"] in names for asset in review["editReceipts"]))

        positive = next(
            frame
            for session in manifest["sessions"]
            for frame in session["frames"]
            if frame["categories"] != ["negative"]
        )
        label_path = dataset_root / positive["label"]["path"]
        label_path.write_bytes(label_path.read_bytes() + b"\n")
        positive["label"]["byteSize"] = label_path.stat().st_size
        positive["label"]["sha256"] = sha256_file(label_path)
        write_canonical_json(dataset_root / "dataset-manifest.json", manifest)
        with self.assertRaisesRegex(DatasetValidationError, "finalized review"):
            validate_dataset(dataset_root, dataset_root / "dataset-manifest.json")

    def test_bridge_refuses_a_tampered_finalization_before_extracting_frames(
        self,
    ) -> None:
        draft_root = self.root / "draft"
        prepare_annotation_draft(
            capture_root=self.captures,
            session_map_path=self.session_map_path,
            output_dir=draft_root,
            command_runner=FakeMediaRunner(),
        )
        finalization_path = draft_root / "annotation-finalization-receipt.json"
        finalization_path.write_text('{"forged":true}\n', encoding="utf-8")
        runner = FakeMediaRunner()

        with self.assertRaisesRegex(DatasetPreparationError, "finalization|receipt"):
            prepare_dataset(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                labels_root=draft_root,
                annotation_finalization_receipt_path=finalization_path,
                output_dir=self.root / "must-not-exist",
                command_runner=runner,
            )
        self.assertFalse(any(Path(call[0]).name == "ffmpeg" for call in runner.calls))


if __name__ == "__main__":
    unittest.main()
