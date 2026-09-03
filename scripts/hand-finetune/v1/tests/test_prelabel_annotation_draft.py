from __future__ import annotations

import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from commandcanvas_hand_finetune.annotation_workbench import (  # noqa: E402
    finalize_annotations,
    load_frame_annotation,
    save_frame_annotation,
)
from commandcanvas_hand_finetune.canonical import (  # noqa: E402
    sha256_file,
)
from commandcanvas_hand_finetune.prepare_dataset import prepare_dataset  # noqa: E402
from commandcanvas_hand_finetune.prelabel_annotation_draft import (  # noqa: E402
    PrelabelPreparationError,
    prepare_prelabel_annotation_draft,
)
from commandcanvas_hand_finetune.training_spec import (  # noqa: E402
    UPSTREAM_CHECKPOINT,
)

from test_dataset_bridge import FakeMediaRunner, write_bridge_inputs  # noqa: E402


def hand_points(offset: float = 0.0) -> list[dict[str, float | int]]:
    return [
        {
            "x": 0.20 + offset + index * 0.02,
            "y": 0.25 + index * 0.015,
            "visibility": 2,
        }
        for index in range(21)
    ]


class RecordingPrelabelBackend:
    def __init__(self) -> None:
        self.loaded: Path | None = None
        self.calls: list[dict[str, str]] = []

    def load(self, checkpoint: Path) -> None:
        self.loaded = checkpoint

    def predict(
        self,
        image_path: Path,
        *,
        dataset_id: str,
        session_id: str,
        frame_id: str,
        image_sha256: str,
    ) -> list[dict[str, object]]:
        self.calls.append(
            {
                "imagePath": image_path.as_posix(),
                "datasetId": dataset_id,
                "sessionId": session_id,
                "frameId": frame_id,
                "imageSha256": image_sha256,
            }
        )
        return [{"keypoints": hand_points()}]


class FailingPrelabelBackend(RecordingPrelabelBackend):
    def predict(
        self,
        image_path: Path,
        *,
        dataset_id: str,
        session_id: str,
        frame_id: str,
        image_sha256: str,
    ) -> list[dict[str, object]]:
        del image_path, dataset_id, session_id, frame_id, image_sha256
        raise RuntimeError("synthetic local inference failure")


class MutatingCheckpointBackend(RecordingPrelabelBackend):
    def load(self, checkpoint: Path) -> None:
        super().load(checkpoint)
        checkpoint.write_bytes(b"checkpoint-changed-after-verification")


class PrelabelAnnotationDraftTests(unittest.TestCase):
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
        self.checkpoint = self.root / "yolo26-hand-pose.pt"
        self.checkpoint.write_bytes(b"synthetic-yolo26-pose-checkpoint")

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _prepare(
        self, output: Path, backend: RecordingPrelabelBackend
    ) -> dict[str, object]:
        with patch.dict(
            UPSTREAM_CHECKPOINT,
            {"sha256": sha256_file(self.checkpoint)},
        ):
            return prepare_prelabel_annotation_draft(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                output_dir=output,
                checkpoint_path=self.checkpoint,
                acknowledge_owner_only_license_boundary=True,
                command_runner=FakeMediaRunner(),
                backend=backend,
            )

    def test_prelabels_only_positive_train_and_validation_frames_with_pinned_model(
        self,
    ) -> None:
        output = self.root / "prelabel-draft"
        backend = RecordingPrelabelBackend()

        result = self._prepare(output, backend)

        draft = json.loads((output / "annotation-draft.json").read_text())
        split_for_group = {
            group: split
            for split, groups in draft["splits"].items()
            for group in groups
        }
        self.assertEqual(backend.loaded, self.checkpoint)
        self.assertEqual(result["prelabeledFrameCount"], 4)
        self.assertEqual(result["manualFrameCount"], 4)
        self.assertEqual(
            [(call["sessionId"], call["frameId"]) for call in backend.calls],
            sorted(
                (session["sessionId"], frame["frameId"])
                for session in draft["sessions"]
                if split_for_group[session["captureGroupId"]] in {"train", "validation"}
                and session["captureCategories"] != ["negative"]
                for frame in session["frames"]
            ),
        )
        frames_by_identity = {
            (session["sessionId"], frame["frameId"]): frame
            for session in draft["sessions"]
            for frame in session["frames"]
        }
        for call in backend.calls:
            frame = frames_by_identity[(call["sessionId"], call["frameId"])]
            image_path = output / frame["image"]["path"]
            self.assertEqual(call["datasetId"], draft["datasetId"])
            self.assertEqual(call["imageSha256"], sha256_file(image_path))
        for session in draft["sessions"]:
            split = split_for_group[session["captureGroupId"]]
            model_assisted = split in {"train", "validation"} and session[
                "captureCategories"
            ] != ["negative"]
            self.assertEqual(
                session["annotation"]["method"],
                "model_assisted" if model_assisted else "manual",
            )
            self.assertEqual(
                session["annotation"]["modelSha256"],
                sha256_file(self.checkpoint) if model_assisted else None,
            )
            for frame in session["frames"]:
                label = (output / frame["label"]["path"]).read_bytes()
                self.assertEqual(bool(label), model_assisted)
                self.assertFalse(frame["reviewed"])

    def test_refuses_any_checkpoint_other_than_the_pinned_yolo26_pose_bytes(
        self,
    ) -> None:
        backend = RecordingPrelabelBackend()

        with self.assertRaisesRegex(PrelabelPreparationError, "pinned.*SHA-256"):
            prepare_prelabel_annotation_draft(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                output_dir=self.root / "refused",
                checkpoint_path=self.checkpoint,
                acknowledge_owner_only_license_boundary=True,
                command_runner=FakeMediaRunner(),
                backend=backend,
            )

        self.assertIsNone(backend.loaded)
        self.assertEqual(backend.calls, [])
        self.assertFalse((self.root / "refused").exists())

    def test_requires_owner_only_license_acknowledgement_before_loading_model(
        self,
    ) -> None:
        backend = RecordingPrelabelBackend()
        with patch.dict(
            UPSTREAM_CHECKPOINT,
            {"sha256": sha256_file(self.checkpoint)},
        ):
            with self.assertRaisesRegex(PrelabelPreparationError, "license boundary"):
                prepare_prelabel_annotation_draft(
                    capture_root=self.captures,
                    session_map_path=self.session_map_path,
                    output_dir=self.root / "refused-license",
                    checkpoint_path=self.checkpoint,
                    acknowledge_owner_only_license_boundary=False,
                    command_runner=FakeMediaRunner(),
                    backend=backend,
                )
        self.assertIsNone(backend.loaded)
        self.assertFalse((self.root / "refused-license").exists())

    def test_local_inference_failure_is_bounded_and_leaves_no_partial_draft(
        self,
    ) -> None:
        backend = FailingPrelabelBackend()
        output = self.root / "failed-inference"
        with patch.dict(
            UPSTREAM_CHECKPOINT,
            {"sha256": sha256_file(self.checkpoint)},
        ):
            with self.assertRaisesRegex(
                PrelabelPreparationError, "local YOLO26 pose inference failed"
            ):
                prepare_prelabel_annotation_draft(
                    capture_root=self.captures,
                    session_map_path=self.session_map_path,
                    output_dir=output,
                    checkpoint_path=self.checkpoint,
                    acknowledge_owner_only_license_boundary=True,
                    command_runner=FakeMediaRunner(),
                    backend=backend,
                )
        self.assertFalse(output.exists())

    def test_refuses_checkpoint_bytes_that_change_before_inference(self) -> None:
        backend = MutatingCheckpointBackend()
        output = self.root / "changed-checkpoint"
        with patch.dict(
            UPSTREAM_CHECKPOINT,
            {"sha256": sha256_file(self.checkpoint)},
        ):
            with self.assertRaisesRegex(
                PrelabelPreparationError, "checkpoint changed during prelabeling"
            ):
                prepare_prelabel_annotation_draft(
                    capture_root=self.captures,
                    session_map_path=self.session_map_path,
                    output_dir=output,
                    checkpoint_path=self.checkpoint,
                    acknowledge_owner_only_license_boundary=True,
                    command_runner=FakeMediaRunner(),
                    backend=backend,
                )
        self.assertEqual(backend.calls, [])
        self.assertFalse(output.exists())

    def test_reviewed_prelabels_flow_through_finalization_and_v2_bridge(
        self,
    ) -> None:
        draft_root = self.root / "prelabel-review"
        backend = RecordingPrelabelBackend()
        self._prepare(draft_root, backend)
        draft_path = draft_root / "annotation-draft.json"
        draft = json.loads(draft_path.read_text())

        for session in draft["sessions"]:
            for frame in session["frames"]:
                state = load_frame_annotation(
                    draft_root, draft_path, session["sessionId"], frame["frameId"]
                )
                negative = frame["categories"] == ["negative"]
                existing_hands = [
                    {"keypoints": hand["keypoints"]} for hand in state["hands"]
                ]
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
                    hands=(
                        []
                        if negative
                        else existing_hands or [{"keypoints": hand_points(0.01)}]
                    ),
                )
        finalize_annotations(
            dataset_root=draft_root,
            manifest_path=draft_path,
            editor_id="owner-daniel",
        )

        dataset_root = self.root / "v2-dataset"
        prepare_dataset(
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
        archived_draft_asset = manifest["producerChain"]["annotationReview"][
            "draftManifest"
        ]
        archived_draft = json.loads(
            (dataset_root / archived_draft_asset["path"]).read_text()
        )
        split_for_group = {
            group: split
            for split, groups in manifest["splits"].items()
            for group in groups
        }
        for session in manifest["sessions"]:
            split = split_for_group[session["captureGroupId"]]
            if split in {"train", "validation"} and session["captureCategories"] != [
                "negative"
            ]:
                self.assertEqual(session["annotation"]["method"], "model_assisted")
                self.assertEqual(
                    session["annotation"]["modelSha256"],
                    sha256_file(self.checkpoint),
                )
            if split == "holdout":
                self.assertEqual(session["annotation"]["method"], "manual")
                self.assertIsNone(session["annotation"]["modelSha256"])
        self.assertEqual(
            sha256_file(dataset_root / archived_draft_asset["path"]),
            archived_draft_asset["sha256"],
        )
        self.assertEqual(archived_draft["datasetId"], manifest["datasetId"])


if __name__ == "__main__":
    unittest.main()
