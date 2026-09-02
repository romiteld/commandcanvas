from __future__ import annotations

import hashlib
from contextlib import redirect_stdout
from io import StringIO
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from typing import Any, Sequence

from PIL import Image

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from commandcanvas_hand_finetune.archive_dataset import (  # noqa: E402
    DatasetArchiveError,
    archive_dataset,
)
from commandcanvas_hand_finetune.canonical import (  # noqa: E402
    attach_digest,
    sha256_file,
    write_canonical_json,
)
from commandcanvas_hand_finetune.dataset import (  # noqa: E402
    DatasetValidationError,
    validate_dataset,
)
from commandcanvas_hand_finetune.prepare_dataset import (  # noqa: E402
    DatasetPreparationError,
    prepare_dataset,
)

from fixture_dataset import hand_label  # noqa: E402


DATASET_SESSION_IDS = (
    "10000000-0000-4000-8000-000000000001",
    "10000000-0000-4000-8000-000000000002",
    "10000000-0000-4000-8000-000000000003",
    "10000000-0000-4000-8000-000000000004",
)
CAPTURE_GROUP_IDS = (
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
    "20000000-0000-4000-8000-000000000003",
    "20000000-0000-4000-8000-000000000004",
)
VISION_SESSION_IDS = tuple(f"vision-lab-session-{index:04d}" for index in range(1, 5))
CAPTURE_TYPES = ("drawing", "negative-no-hand", "edges-corners", "two-hand-transforms")
CATEGORIES = (
    ["drawing", "pinch"],
    ["negative"],
    ["edge", "two_hand"],
    ["drawing", "edge", "pinch", "two_hand"],
)
SPLITS = ("train", "train", "validation", "holdout")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )


class FakeMediaRunner:
    def __init__(
        self,
        *,
        width: int = 1280,
        height: int = 720,
        duration: float = 0.24,
        frame_width: int | None = None,
    ):
        self.width = width
        self.height = height
        self.duration = duration
        self.frame_width = frame_width or width
        self.calls: list[list[str]] = []

    def __call__(self, command: Sequence[str]) -> subprocess.CompletedProcess[str]:
        arguments = [str(item) for item in command]
        self.calls.append(arguments)
        if Path(arguments[0]).name == "ffprobe":
            payload = {
                "streams": [
                    {
                        "codec_name": "vp9",
                        "width": self.width,
                        "height": self.height,
                        "avg_frame_rate": "30/1",
                    }
                ],
                "format": {"duration": f"{self.duration:.6f}"},
            }
            return subprocess.CompletedProcess(arguments, 0, json.dumps(payload), "")
        if Path(arguments[0]).name == "ffmpeg":
            output = Path(arguments[-1])
            output.parent.mkdir(parents=True, exist_ok=True)
            source = Path(arguments[arguments.index("-i") + 1])
            source_number = int(source.stem.rsplit("-", 1)[-1])
            Image.new(
                "RGB",
                (self.frame_width, self.height),
                (40 * source_number, 80, 120),
            ).save(output, format="PNG")
            return subprocess.CompletedProcess(arguments, 0, "", "")
        raise AssertionError(f"unexpected command: {arguments}")


def write_bridge_inputs(root: Path) -> tuple[Path, Path, Path, dict[str, Any]]:
    captures = root / "captures"
    labels = root / "corrected-labels"
    captures.mkdir(parents=True)
    labels.mkdir(parents=True)
    mapped_sessions: list[dict[str, Any]] = []
    for index, (
        vision_session_id,
        dataset_session_id,
        capture_group_id,
        capture_type,
        categories,
        split,
    ) in enumerate(
        zip(
            VISION_SESSION_IDS,
            DATASET_SESSION_IDS,
            CAPTURE_GROUP_IDS,
            CAPTURE_TYPES,
            CATEGORIES,
            SPLITS,
        )
    ):
        video_path = captures / f"session-{index + 1}.webm"
        video_path.write_bytes(f"synthetic-webm-source-{index + 1}".encode())
        companion_path = captures / f"session-{index + 1}.json"
        write_json(
            companion_path,
            {
                "schemaVersion": 1,
                "sessionId": vision_session_id,
                "captureType": capture_type,
                "startedAt": "2026-09-02T12:00:00.000Z",
                "stoppedAt": "2026-09-02T12:00:00.240Z",
                "media": {
                    "mimeType": "video/webm;codecs=vp9",
                    "width": 1280,
                    "height": 720,
                    "frameRate": 30,
                    "facingMode": "user",
                },
                "mirrorDisplay": True,
                "consentVersion": "vision-lab-consent-v1",
                "protocol": {"id": "commandcanvas-hand-finetune", "version": 1},
                "videoSha256": sha256(video_path),
            },
        )
        label_directory = labels / f"session-{index + 1}"
        label_directory.mkdir()
        for timestamp in (0, 120):
            (label_directory / f"frame-{timestamp:010d}.txt").write_text(
                "" if categories == ["negative"] else hand_label(), encoding="utf-8"
            )
        mapped_sessions.append(
            {
                "visionSessionId": vision_session_id,
                "datasetSessionId": dataset_session_id,
                "captureGroupId": capture_group_id,
                "split": split,
                "categories": categories,
                "videoPath": video_path.relative_to(captures).as_posix(),
                "manifestPath": companion_path.relative_to(captures).as_posix(),
                "labelDir": label_directory.relative_to(labels).as_posix(),
                "annotation": {
                    "method": "manual",
                    "reviewed": True,
                    "tool": "commandcanvas-corrected-labeler",
                    "toolVersion": "1.0.0",
                    "modelSha256": None,
                },
            }
        )
    session_map = {
        "schemaVersion": "commandcanvas.hand-session-map/v1",
        "datasetId": "00000000-0000-4000-8000-000000000001",
        "createdAt": "2026-09-02T12:30:00Z",
        "actorId": "owner-daniel",
        "cadenceMs": 120,
        "sessions": mapped_sessions,
    }
    session_map_path = root / "session-map.json"
    write_json(session_map_path, session_map)
    return captures, labels, session_map_path, session_map


class DatasetPreparationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.captures, self.labels, self.session_map_path, self.session_map = (
            write_bridge_inputs(self.root)
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_materializes_actual_camera_dimensions_and_validated_task2_receipt(
        self,
    ) -> None:
        source_hashes = {
            path.name: sha256(path) for path in sorted(self.captures.glob("*.webm"))
        }
        output = self.root / "dataset"
        runner = FakeMediaRunner()

        receipt = prepare_dataset(
            capture_root=self.captures,
            session_map_path=self.session_map_path,
            labels_root=self.labels,
            output_dir=output,
            command_runner=runner,
        )

        self.assertEqual(
            receipt, validate_dataset(output, output / "dataset-manifest.json")
        )
        self.assertEqual(receipt["frameCount"], 8)
        self.assertFalse(receipt["productionEligible"])
        self.assertEqual(
            receipt["splitCounts"], {"holdout": 2, "train": 4, "validation": 2}
        )
        manifest = json.loads((output / "dataset-manifest.json").read_text())
        self.assertTrue(
            all(session["source"]["width"] == 1280 for session in manifest["sessions"])
        )
        self.assertTrue(
            all(session["source"]["height"] == 720 for session in manifest["sessions"])
        )
        self.assertTrue(
            all(len(session["frames"]) == 2 for session in manifest["sessions"])
        )
        self.assertTrue(
            all(
                session["frames"][0]["timestampMs"] == 0
                for session in manifest["sessions"]
            )
        )
        self.assertTrue(
            all(
                session["frames"][1]["timestampMs"] == 120
                for session in manifest["sessions"]
            )
        )
        self.assertEqual(
            source_hashes,
            {path.name: sha256(path) for path in sorted(self.captures.glob("*.webm"))},
        )
        self.assertEqual(
            sum(Path(call[0]).name == "ffprobe" for call in runner.calls), 4
        )
        self.assertEqual(
            sum(Path(call[0]).name == "ffmpeg" for call in runner.calls), 8
        )
        self.assertTrue(
            all(
                "-frames:v" in call and "-c:v" in call and "png" in call
                for call in runner.calls
                if Path(call[0]).name == "ffmpeg"
            )
        )

    def test_accepts_task1_optional_metadata_absence_and_uses_probe_authority(
        self,
    ) -> None:
        for mapped in self.session_map["sessions"]:
            companion_path = self.captures / mapped["manifestPath"]
            companion = json.loads(companion_path.read_text())
            companion.pop("videoSha256")
            for optional in ("width", "height", "frameRate", "facingMode"):
                companion["media"].pop(optional)
            write_json(companion_path, companion)

        output = self.root / "optional-metadata"
        receipt = prepare_dataset(
            capture_root=self.captures,
            session_map_path=self.session_map_path,
            labels_root=self.labels,
            output_dir=output,
            command_runner=FakeMediaRunner(),
        )

        manifest = json.loads((output / "dataset-manifest.json").read_text())
        self.assertEqual(manifest["schemaVersion"], "commandcanvas.hand-dataset/v2")
        self.assertTrue(
            all(session["source"]["width"] == 1280 for session in manifest["sessions"])
        )
        self.assertEqual(len(receipt["sourceVideoDigests"]), 4)

    def test_preserves_and_binds_canonical_vision_lab_producer_chain(self) -> None:
        output = self.root / "provenance"
        prepare_dataset(
            capture_root=self.captures,
            session_map_path=self.session_map_path,
            labels_root=self.labels,
            output_dir=output,
            command_runner=FakeMediaRunner(),
        )

        manifest_path = output / "dataset-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        session_map_asset = manifest["producerChain"]["sessionMap"]
        self.assertEqual(
            session_map_asset["sha256"], sha256(output / session_map_asset["path"])
        )
        first = manifest["sessions"][0]
        producer = first["producer"]
        companion_path = output / producer["companionManifest"]["path"]
        self.assertEqual(producer["visionLabSessionId"], VISION_SESSION_IDS[0])
        self.assertEqual(producer["captureType"], "drawing")
        self.assertEqual(producer["observedVideoSha256"], first["source"]["sha256"])
        self.assertEqual(
            producer["companionManifest"]["sha256"], sha256(companion_path)
        )
        self.assertEqual(
            companion_path.read_bytes(),
            (
                json.dumps(
                    json.loads(companion_path.read_text()),
                    separators=(",", ":"),
                    sort_keys=True,
                )
                + "\n"
            ).encode(),
        )

        companion = json.loads(companion_path.read_text())
        companion["captureType"] = "pinch"
        write_json(companion_path, companion)
        producer["companionManifest"]["byteSize"] = companion_path.stat().st_size
        producer["companionManifest"]["sha256"] = sha256(companion_path)
        write_json(manifest_path, manifest)
        with self.assertRaisesRegex(Exception, "producer|captureType|companion"):
            validate_dataset(output, manifest_path)

    def test_refuses_control_characters_in_declared_paths(self) -> None:
        value = json.loads(self.session_map_path.read_text())
        value["sessions"][0]["videoPath"] = "session-1\u007f.webm"
        write_json(self.session_map_path, value)
        with self.assertRaisesRegex(DatasetPreparationError, "control"):
            prepare_dataset(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                labels_root=self.labels,
                output_dir=self.root / "control-path",
                command_runner=FakeMediaRunner(),
            )

    def test_refuses_duplicate_companion_keys_hash_and_probe_mismatch_without_output(
        self,
    ) -> None:
        companion = self.captures / self.session_map["sessions"][0]["manifestPath"]
        raw = companion.read_text()
        companion.write_text(
            raw.replace('"sessionId":', '"sessionId": "duplicate",\n  "sessionId":', 1)
        )
        with self.assertRaisesRegex(DatasetPreparationError, "duplicate JSON key"):
            prepare_dataset(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                labels_root=self.labels,
                output_dir=self.root / "duplicate",
                command_runner=FakeMediaRunner(),
            )
        self.assertFalse((self.root / "duplicate").exists())

        self.captures, self.labels, self.session_map_path, self.session_map = (
            write_bridge_inputs(self.root / "fresh")
        )
        companion = self.captures / self.session_map["sessions"][0]["manifestPath"]
        value = json.loads(companion.read_text())
        value["videoSha256"] = "0" * 64
        write_json(companion, value)
        with self.assertRaisesRegex(DatasetPreparationError, "video SHA-256"):
            prepare_dataset(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                labels_root=self.labels,
                output_dir=self.root / "bad-hash",
                command_runner=FakeMediaRunner(),
            )

        value["videoSha256"] = sha256(
            self.captures / self.session_map["sessions"][0]["videoPath"]
        )
        write_json(companion, value)
        with self.assertRaisesRegex(DatasetPreparationError, "dimensions"):
            prepare_dataset(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                labels_root=self.labels,
                output_dir=self.root / "bad-probe",
                command_runner=FakeMediaRunner(width=640),
            )

    def test_holdout_must_be_manual_reviewed_and_label_set_must_be_exact(self) -> None:
        value = json.loads(self.session_map_path.read_text())
        holdout = next(
            session for session in value["sessions"] if session["split"] == "holdout"
        )
        holdout["annotation"] = {
            "method": "model_assisted",
            "reviewed": False,
            "tool": "offline-prelabel",
            "toolVersion": "1.0.0",
            "modelSha256": "1" * 64,
        }
        write_json(self.session_map_path, value)
        with self.assertRaisesRegex(
            DatasetPreparationError, "holdout.*manual.*reviewed"
        ):
            prepare_dataset(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                labels_root=self.labels,
                output_dir=self.root / "unreviewed",
                command_runner=FakeMediaRunner(),
            )

        write_json(self.session_map_path, self.session_map)
        label_dir = self.labels / self.session_map["sessions"][0]["labelDir"]
        (label_dir / "extra.txt").write_text(hand_label())
        with self.assertRaisesRegex(
            DatasetPreparationError, "label files.*exactly match"
        ):
            prepare_dataset(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                labels_root=self.labels,
                output_dir=self.root / "extra-label",
                command_runner=FakeMediaRunner(),
            )

    def test_capture_group_may_span_sessions_only_within_one_split(self) -> None:
        value = json.loads(self.session_map_path.read_text())
        value["sessions"][1]["captureGroupId"] = value["sessions"][0]["captureGroupId"]
        write_json(self.session_map_path, value)

        receipt = prepare_dataset(
            capture_root=self.captures,
            session_map_path=self.session_map_path,
            labels_root=self.labels,
            output_dir=self.root / "shared-group",
            command_runner=FakeMediaRunner(),
        )

        self.assertEqual(receipt["captureGroupCounts"]["train"], 1)

        captures, labels, session_map_path, session_map = write_bridge_inputs(
            self.root / "cross-split"
        )
        session_map["sessions"][2]["captureGroupId"] = session_map["sessions"][0][
            "captureGroupId"
        ]
        write_json(session_map_path, session_map)
        runner = FakeMediaRunner()
        with self.assertRaisesRegex(DatasetPreparationError, "captureGroupId.*split"):
            prepare_dataset(
                capture_root=captures,
                session_map_path=session_map_path,
                labels_root=labels,
                output_dir=self.root / "leaked-group",
                command_runner=runner,
            )
        self.assertFalse(
            any(Path(call[0]).name == "ffmpeg" for call in runner.calls),
            "split leakage must be refused before extracting any frames",
        )

    def test_refuses_intermediate_symlinks_and_relative_path_traversal(self) -> None:
        (self.captures / "linked").symlink_to(self.captures, target_is_directory=True)
        value = json.loads(self.session_map_path.read_text())
        value["sessions"][0]["videoPath"] = "linked/session-1.webm"
        write_json(self.session_map_path, value)

        with self.assertRaisesRegex(DatasetPreparationError, "symlink"):
            prepare_dataset(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                labels_root=self.labels,
                output_dir=self.root / "linked-output",
                command_runner=FakeMediaRunner(),
            )

        value["sessions"][0]["videoPath"] = "../session-1.webm"
        write_json(self.session_map_path, value)
        with self.assertRaisesRegex(DatasetPreparationError, "safe relative path"):
            prepare_dataset(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                labels_root=self.labels,
                output_dir=self.root / "traversal-output",
                command_runner=FakeMediaRunner(),
            )

    def test_refuses_extracted_frame_dimensions_that_do_not_match_the_video(
        self,
    ) -> None:
        with self.assertRaisesRegex(DatasetPreparationError, "frame dimensions"):
            prepare_dataset(
                capture_root=self.captures,
                session_map_path=self.session_map_path,
                labels_root=self.labels,
                output_dir=self.root / "wrong-frame-size",
                command_runner=FakeMediaRunner(frame_width=640),
            )
        self.assertFalse((self.root / "wrong-frame-size").exists())

    def test_validator_refuses_malformed_companion_fields(self) -> None:
        cases = (
            ("startedAt", "2026-09-02T12:00:00", "startedAt"),
            ("stoppedAt", "2026-09-02T11:59:59.000Z", "stoppedAt"),
            ("mirrorDisplay", "true", "mirrorDisplay"),
            ("media.width", 1280.0, "width"),
            ("media.height", 720.0, "height"),
            ("media.frameRate", "30", "frameRate"),
            ("media.facingMode", "", "facingMode"),
            ("media.mimeType", "video/webm-danger", "WebM"),
        )
        for case_index, (field, invalid_value, expected_error) in enumerate(cases):
            with self.subTest(field=field):
                case_root = self.root / f"malformed-companion-{case_index}"
                captures, labels, session_map_path, _ = write_bridge_inputs(case_root)
                dataset = case_root / "dataset"
                prepare_dataset(
                    capture_root=captures,
                    session_map_path=session_map_path,
                    labels_root=labels,
                    output_dir=dataset,
                    command_runner=FakeMediaRunner(),
                )
                manifest_path = dataset / "dataset-manifest.json"
                manifest = json.loads(manifest_path.read_text())
                companion_asset = manifest["sessions"][0]["producer"][
                    "companionManifest"
                ]
                companion_path = dataset / companion_asset["path"]
                companion = json.loads(companion_path.read_text())
                if field.startswith("media."):
                    companion["media"][field.removeprefix("media.")] = invalid_value
                else:
                    companion[field] = invalid_value
                write_canonical_json(companion_path, companion)
                companion_asset["byteSize"] = companion_path.stat().st_size
                companion_asset["sha256"] = sha256_file(companion_path)
                write_canonical_json(manifest_path, manifest)

                with self.assertRaisesRegex(DatasetValidationError, expected_error):
                    validate_dataset(dataset, manifest_path)


class DatasetArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        captures, labels, session_map, _value = write_bridge_inputs(self.root)
        self.dataset = self.root / "dataset"
        prepare_dataset(
            capture_root=captures,
            session_map_path=session_map,
            labels_root=labels,
            output_dir=self.dataset,
            command_runner=FakeMediaRunner(),
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_archive_is_deterministic_fixed_metadata_and_revalidated(self) -> None:
        first = self.root / "first.tar"
        first_receipt = self.root / "first-receipt.json"
        second = self.root / "second.tar"
        second_receipt = self.root / "second-receipt.json"

        receipt_one = archive_dataset(
            dataset_root=self.dataset,
            manifest_path=self.dataset / "dataset-manifest.json",
            dataset_receipt_path=self.dataset / "dataset-receipt.json",
            output_path=first,
            archive_receipt_path=first_receipt,
        )
        receipt_two = archive_dataset(
            dataset_root=self.dataset,
            manifest_path=self.dataset / "dataset-manifest.json",
            dataset_receipt_path=self.dataset / "dataset-receipt.json",
            output_path=second,
            archive_receipt_path=second_receipt,
        )

        self.assertEqual(first.read_bytes(), second.read_bytes())
        self.assertEqual(receipt_one, receipt_two)
        self.assertEqual(receipt_one["archiveSha256"], sha256(first))
        self.assertTrue(receipt_one["revalidatedAfterExtraction"])
        with tarfile.open(first, "r:") as archive:
            members = archive.getmembers()
        self.assertEqual(
            [member.name for member in members],
            sorted(member.name for member in members),
        )
        self.assertTrue(all(member.isfile() for member in members))
        self.assertTrue(
            all(
                member.uid == 0 and member.gid == 0 and member.mtime == 0
                for member in members
            )
        )
        self.assertTrue(
            all(
                member.uname == "" and member.gname == "" and member.mode == 0o600
                for member in members
            )
        )
        self.assertIn("dataset-manifest.json", receipt_one["members"])
        self.assertIn("dataset-receipt.json", receipt_one["members"])
        self.assertIn("provenance/session-map.json", receipt_one["members"])
        self.assertTrue(
            any(
                name.startswith("provenance/companions/")
                for name in receipt_one["members"]
            )
        )

    def test_archive_refuses_unvalidated_extra_symlink_or_tampered_receipt(
        self,
    ) -> None:
        extra = self.dataset / "notes.txt"
        extra.write_text("not validated")
        with self.assertRaisesRegex(DatasetArchiveError, "unvalidated asset"):
            archive_dataset(
                dataset_root=self.dataset,
                manifest_path=self.dataset / "dataset-manifest.json",
                dataset_receipt_path=self.dataset / "dataset-receipt.json",
                output_path=self.root / "extra.tar",
                archive_receipt_path=self.root / "extra.json",
            )
        extra.unlink()

        link = self.dataset / "linked.png"
        link.symlink_to(self.dataset / "dataset-manifest.json")
        with self.assertRaisesRegex(DatasetArchiveError, "symlink"):
            archive_dataset(
                dataset_root=self.dataset,
                manifest_path=self.dataset / "dataset-manifest.json",
                dataset_receipt_path=self.dataset / "dataset-receipt.json",
                output_path=self.root / "link.tar",
                archive_receipt_path=self.root / "link.json",
            )
        link.unlink()

        receipt_path = self.dataset / "dataset-receipt.json"
        receipt = json.loads(receipt_path.read_text())
        receipt["frameCount"] = 999
        write_json(receipt_path, receipt)
        with self.assertRaisesRegex(DatasetArchiveError, "receipt"):
            archive_dataset(
                dataset_root=self.dataset,
                manifest_path=self.dataset / "dataset-manifest.json",
                dataset_receipt_path=receipt_path,
                output_path=self.root / "tampered.tar",
                archive_receipt_path=self.root / "tampered.json",
            )

    def test_archive_revalidation_refuses_semantically_invalid_companion(self) -> None:
        manifest_path = self.dataset / "dataset-manifest.json"
        receipt_path = self.dataset / "dataset-receipt.json"
        manifest = json.loads(manifest_path.read_text())
        companion_asset = manifest["sessions"][0]["producer"]["companionManifest"]
        companion_path = self.dataset / companion_asset["path"]
        companion = json.loads(companion_path.read_text())
        companion["mirrorDisplay"] = "true"
        write_canonical_json(companion_path, companion)
        companion_asset["byteSize"] = companion_path.stat().st_size
        companion_asset["sha256"] = sha256_file(companion_path)
        write_canonical_json(manifest_path, manifest)

        prior_receipt = json.loads(receipt_path.read_text())
        prior_receipt["manifestSha256"] = sha256_file(manifest_path)
        write_canonical_json(
            receipt_path, attach_digest(prior_receipt, "receiptSha256")
        )

        with self.assertRaisesRegex(DatasetArchiveError, "mirrorDisplay"):
            archive_dataset(
                dataset_root=self.dataset,
                manifest_path=manifest_path,
                dataset_receipt_path=receipt_path,
                output_path=self.root / "invalid-companion.tar",
                archive_receipt_path=self.root / "invalid-companion.json",
            )


class DatasetBridgeCliTests(unittest.TestCase):
    def test_help_exposes_prepare_and_archive_commands_without_running_media_tools(
        self,
    ) -> None:
        from commandcanvas_hand_finetune.__main__ import main

        output = StringIO()
        with redirect_stdout(output):
            with patch("sys.argv", ["commandcanvas-hand-finetune-v1", "--help"]):
                with self.assertRaises(SystemExit) as stopped:
                    main()

        self.assertEqual(stopped.exception.code, 0)
        self.assertIn("prepare-dataset", output.getvalue())
        self.assertIn("archive-dataset", output.getvalue())


if __name__ == "__main__":
    unittest.main()
