from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from commandcanvas_hand_finetune.annotation_workbench import (  # noqa: E402
    AnnotationConflict,
    AnnotationWorkbenchError,
    finalize_annotations,
    load_frame_annotation,
    render_workbench_html,
    save_frame_annotation,
    validate_annotation_manifest,
    validate_loopback_host,
    validate_private_workspace,
    validate_request_host,
)
from commandcanvas_hand_finetune.canonical import (  # noqa: E402
    attach_digest,
    canonical_json_bytes,
    sha256_file,
    verify_digest,
)
from commandcanvas_hand_finetune.dataset import (  # noqa: E402
    DatasetValidationError,
    validate_dataset,
)

from fixture_dataset import (  # noqa: E402
    hand_label,
    read_manifest,
    write_annotation_draft,
    write_manifest,
    write_valid_dataset,
)


def keypoints(offset: float = 0.0) -> list[dict[str, float | int]]:
    return [
        {
            "x": min(0.95, 0.18 + offset + index * 0.02),
            "y": min(0.95, 0.26 + index * 0.015),
            "visibility": 2,
        }
        for index in range(21)
    ]


class AnnotationWorkbenchTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name) / "private-dataset"
        self.root.mkdir()
        self.manifest_path = write_valid_dataset(self.root)
        self.manifest = read_manifest(self.manifest_path)
        self.session = self.manifest["sessions"][0]
        self.frame = self.session["frames"][0]

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def _save(
        self,
        *,
        negative: bool = False,
        hands: list[dict[str, object]] | None = None,
        categories: list[str] | None = None,
    ) -> dict[str, object]:
        state = load_frame_annotation(
            self.root,
            self.manifest_path,
            self.session["sessionId"],
            self.frame["frameId"],
        )
        return save_frame_annotation(
            dataset_root=self.root,
            manifest_path=self.manifest_path,
            session_id=self.session["sessionId"],
            frame_id=self.frame["frameId"],
            editor_id="owner-daniel",
            expected_manifest_sha256=state["manifestSha256"],
            expected_label_sha256=state["labelSha256"],
            negative=negative,
            categories=categories or ["drawing", "pinch"],
            hands=hands if hands is not None else [{"keypoints": keypoints()}],
        )

    def test_loads_exactly_21_keypoints_from_each_existing_yolo_row(self) -> None:
        state = load_frame_annotation(
            self.root,
            self.manifest_path,
            self.session["sessionId"],
            self.frame["frameId"],
        )

        self.assertFalse(state["negative"])
        self.assertEqual(len(state["hands"]), 1)
        self.assertEqual(len(state["hands"][0]["keypoints"]), 21)
        self.assertEqual(state["hands"][0]["keypoints"][0]["visibility"], 2)
        self.assertEqual(state["image"]["width"], 64)
        self.assertEqual(state["image"]["height"], 48)

    def test_opens_an_unreviewed_draft_with_empty_positive_labels(self) -> None:
        draft = write_annotation_draft(self.root)
        manifest = read_manifest(draft)
        session = manifest["sessions"][0]
        frame = session["frames"][0]

        validation = validate_annotation_manifest(self.root, draft)
        state = load_frame_annotation(
            self.root, draft, session["sessionId"], frame["frameId"]
        )

        self.assertEqual(validation["kind"], "draft")
        self.assertFalse(validation["complete"])
        self.assertEqual(validation["reviewedFrameCount"], 0)
        self.assertEqual(state["hands"], [])
        self.assertFalse(state["reviewed"])

    def test_draft_save_marks_only_one_frame_reviewed_without_weakening_validator(
        self,
    ) -> None:
        draft = write_annotation_draft(self.root)
        manifest = read_manifest(draft)
        session = manifest["sessions"][0]
        frame = session["frames"][0]
        state = load_frame_annotation(
            self.root, draft, session["sessionId"], frame["frameId"]
        )

        save_frame_annotation(
            dataset_root=self.root,
            manifest_path=draft,
            session_id=session["sessionId"],
            frame_id=frame["frameId"],
            editor_id="owner-daniel",
            expected_manifest_sha256=state["manifestSha256"],
            expected_label_sha256=state["labelSha256"],
            negative=False,
            categories=frame["categories"],
            hands=[{"keypoints": keypoints()}],
        )

        updated = read_manifest(draft)
        self.assertTrue(updated["sessions"][0]["frames"][0]["reviewed"])
        self.assertFalse(updated["sessions"][0]["frames"][1]["reviewed"])
        self.assertFalse(updated["sessions"][0]["annotation"]["reviewed"])
        self.assertEqual(
            validate_annotation_manifest(self.root, draft)["kind"], "draft"
        )
        with self.assertRaises(DatasetValidationError):
            validate_dataset(self.root, draft)

    def test_draft_finalization_requires_every_frame_then_emits_strict_manifest(
        self,
    ) -> None:
        draft = write_annotation_draft(self.root)
        manifest = read_manifest(draft)

        with self.assertRaisesRegex(AnnotationWorkbenchError, "not reviewed"):
            finalize_annotations(
                dataset_root=self.root,
                manifest_path=draft,
                editor_id="owner-daniel",
            )

        for session in manifest["sessions"]:
            for frame in session["frames"]:
                state = load_frame_annotation(
                    self.root, draft, session["sessionId"], frame["frameId"]
                )
                negative = frame["categories"] == ["negative"]
                save_frame_annotation(
                    dataset_root=self.root,
                    manifest_path=draft,
                    session_id=session["sessionId"],
                    frame_id=frame["frameId"],
                    editor_id="owner-daniel",
                    expected_manifest_sha256=state["manifestSha256"],
                    expected_label_sha256=state["labelSha256"],
                    negative=negative,
                    categories=frame["categories"],
                    hands=[] if negative else [{"keypoints": keypoints()}],
                )

        final = finalize_annotations(
            dataset_root=self.root,
            manifest_path=draft,
            editor_id="owner-daniel",
        )
        canonical_path = self.root / "dataset-manifest.json"
        canonical = read_manifest(canonical_path)

        self.assertEqual(canonical["schemaVersion"], "commandcanvas.hand-dataset/v1")
        self.assertNotIn("sourceAdapter", canonical)
        self.assertNotIn("visionSessionId", canonical["sessions"][0])
        self.assertNotIn("reviewed", canonical["sessions"][0]["frames"][0])
        self.assertTrue(canonical["sessions"][0]["annotation"]["reviewed"])
        self.assertTrue(
            validate_dataset(self.root, canonical_path)["eligibleForTraining"]
        )
        self.assertEqual(final["draftManifestSha256"], sha256_file(draft))
        self.assertEqual(final["manifestSha256"], sha256_file(canonical_path))
        self.assertEqual(final["sourceAdapter"]["sourceManifestSha256"], "d" * 64)
        self.assertEqual(
            final["visionSessionIds"],
            ["vision-lab-session-1", "vision-lab-session-2", "vision-lab-session-3"],
        )
        handoff = final["bridgeHandoff"]
        self.assertEqual(
            handoff["schemaVersion"], "commandcanvas.hand-annotation-handoff/v1"
        )
        self.assertEqual(handoff["datasetId"], canonical["datasetId"])
        self.assertEqual(len(handoff["sessions"]), 3)
        self.assertEqual(
            handoff["sessions"][0]["visionSessionId"], "vision-lab-session-1"
        )
        self.assertEqual(
            handoff["sessions"][0]["datasetSessionId"],
            canonical["sessions"][0]["sessionId"],
        )
        self.assertEqual(handoff["sessions"][0]["actorId"], "owner-daniel")
        self.assertTrue(handoff["sessions"][0]["annotation"]["reviewed"])
        self.assertEqual(len(handoff["sessions"][0]["labels"]), 2)
        self.assertEqual(
            handoff["sessions"][0]["labels"][0]["sha256"],
            canonical["sessions"][0]["frames"][0]["label"]["sha256"],
        )

    def test_draft_refuses_tampered_frame_bytes_before_review(self) -> None:
        draft = write_annotation_draft(self.root)
        manifest = read_manifest(draft)
        image_path = self.root / manifest["sessions"][0]["frames"][0]["image"]["path"]
        image_path.write_bytes(b"tampered")

        with self.assertRaisesRegex(AnnotationWorkbenchError, "SHA-256|decodable"):
            validate_annotation_manifest(self.root, draft)

    def test_draft_requires_bridge_compatible_timestamp_and_asset_paths(self) -> None:
        draft = write_annotation_draft(self.root)
        manifest = read_manifest(draft)
        frame = manifest["sessions"][0]["frames"][0]
        frame["frameId"] = "frame-friendly-but-not-canonical"
        write_manifest(draft, manifest)

        with self.assertRaisesRegex(AnnotationWorkbenchError, "timestamp|path"):
            validate_annotation_manifest(self.root, draft)

    def test_draft_rejects_duplicate_capture_and_asset_identities(self) -> None:
        duplicate_mutations = (
            lambda manifest: manifest["sessions"][1].__setitem__(
                "visionSessionId", manifest["sessions"][0]["visionSessionId"]
            ),
            lambda manifest: manifest["sessions"][1]["source"].update(
                {
                    "path": manifest["sessions"][0]["source"]["path"],
                    "sha256": manifest["sessions"][0]["source"]["sha256"],
                    "byteSize": manifest["sessions"][0]["source"]["byteSize"],
                }
            ),
            lambda manifest: manifest["sessions"][1]["frames"][0]["label"].update(
                manifest["sessions"][0]["frames"][0]["label"]
            ),
        )
        for mutate in duplicate_mutations:
            with self.subTest(mutate=mutate):
                draft = write_annotation_draft(self.root)
                manifest = read_manifest(draft)
                mutate(manifest)
                write_manifest(draft, manifest)
                with self.assertRaisesRegex(
                    AnnotationWorkbenchError, "unique|duplicate|path"
                ):
                    validate_annotation_manifest(self.root, draft)
                self.root = Path(self.temporary_directory.name) / f"retry-{id(mutate)}"
                self.root.mkdir()
                self.manifest_path = write_valid_dataset(self.root)

    def test_draft_preserves_the_source_actor_in_every_handoff_session(self) -> None:
        draft = write_annotation_draft(self.root)
        manifest = read_manifest(draft)
        manifest["sessions"][0]["actorId"] = "different-actor"
        write_manifest(draft, manifest)

        with self.assertRaisesRegex(AnnotationWorkbenchError, "actor"):
            validate_annotation_manifest(self.root, draft)

    def test_draft_cannot_claim_manual_review_without_frame_edit_receipts(self) -> None:
        draft = write_annotation_draft(self.root)
        manifest = read_manifest(draft)
        for session in manifest["sessions"]:
            session["annotation"]["reviewed"] = True
            for frame in session["frames"]:
                frame["reviewed"] = True
                if frame["categories"] != ["negative"]:
                    label_path = self.root / frame["label"]["path"]
                    label_path.write_text(hand_label(), encoding="utf-8")
                    frame["label"]["byteSize"] = label_path.stat().st_size
                    frame["label"]["sha256"] = sha256_file(label_path)
        write_manifest(draft, manifest)

        with self.assertRaisesRegex(AnnotationWorkbenchError, "edit receipt"):
            finalize_annotations(
                dataset_root=self.root,
                manifest_path=draft,
                editor_id="owner-daniel",
            )

    def test_saves_two_hands_as_canonical_yolo_pose_and_valid_manifest(self) -> None:
        original_manifest_sha = sha256_file(self.manifest_path)
        original_label_sha = self.frame["label"]["sha256"]
        original_annotation = dict(self.session["annotation"])

        receipt = self._save(
            hands=[
                {"keypoints": keypoints(0.0)},
                {"keypoints": keypoints(0.15)},
            ],
            categories=["drawing", "two_hand"],
        )

        manifest = read_manifest(self.manifest_path)
        frame = manifest["sessions"][0]["frames"][0]
        label_path = self.root / frame["label"]["path"]
        rows = label_path.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(len(row.split()) == 68 for row in rows))
        self.assertEqual(frame["label"]["sha256"], sha256_file(label_path))
        self.assertEqual(
            self.manifest_path.read_bytes(), canonical_json_bytes(manifest)
        )
        self.assertTrue(
            validate_dataset(self.root, self.manifest_path)["eligibleForTraining"]
        )
        self.assertEqual(receipt["sourceManifestSha256"], original_manifest_sha)
        self.assertEqual(receipt["sourceLabelSha256"], original_label_sha)
        self.assertEqual(receipt["previousAnnotation"], original_annotation)
        self.assertEqual(receipt["handCount"], 2)
        self.assertTrue(verify_digest(receipt, "receiptSha256"))
        receipt_path = self.root / receipt["receiptPath"]
        self.assertEqual(receipt_path.read_bytes(), canonical_json_bytes(receipt))

    def test_marks_a_frame_negative_with_an_empty_label_and_auditable_provenance(
        self,
    ) -> None:
        receipt = self._save(negative=True, hands=[], categories=["negative"])

        manifest = read_manifest(self.manifest_path)
        frame = manifest["sessions"][0]["frames"][0]
        label_path = self.root / frame["label"]["path"]
        self.assertEqual(label_path.read_bytes(), b"")
        self.assertEqual(frame["categories"], ["negative"])
        self.assertTrue(receipt["negative"])
        self.assertEqual(receipt["handCount"], 0)
        self.assertTrue(
            validate_dataset(self.root, self.manifest_path)["eligibleForTraining"]
        )

    def test_refuses_wrong_keypoint_or_hand_count_without_mutating_files(self) -> None:
        state = load_frame_annotation(
            self.root,
            self.manifest_path,
            self.session["sessionId"],
            self.frame["frameId"],
        )
        manifest_before = self.manifest_path.read_bytes()
        label_path = self.root / self.frame["label"]["path"]
        label_before = label_path.read_bytes()

        invalid_cases = [
            [{"keypoints": keypoints()[:20]}],
            [{"keypoints": keypoints() + [keypoints()[0]]}],
            [
                {"keypoints": keypoints()},
                {"keypoints": keypoints(0.1)},
                {"keypoints": keypoints(0.2)},
            ],
        ]
        for hands in invalid_cases:
            with self.subTest(hand_count=len(hands), points=len(hands[0]["keypoints"])):
                with self.assertRaises(AnnotationWorkbenchError):
                    save_frame_annotation(
                        dataset_root=self.root,
                        manifest_path=self.manifest_path,
                        session_id=self.session["sessionId"],
                        frame_id=self.frame["frameId"],
                        editor_id="owner-daniel",
                        expected_manifest_sha256=state["manifestSha256"],
                        expected_label_sha256=state["labelSha256"],
                        negative=False,
                        categories=["drawing"],
                        hands=hands,
                    )
        self.assertEqual(self.manifest_path.read_bytes(), manifest_before)
        self.assertEqual(label_path.read_bytes(), label_before)

    def test_rejects_stale_editor_save_instead_of_overwriting_newer_work(self) -> None:
        state = load_frame_annotation(
            self.root,
            self.manifest_path,
            self.session["sessionId"],
            self.frame["frameId"],
        )
        self._save(hands=[{"keypoints": keypoints(0.05)}])

        with self.assertRaisesRegex(AnnotationConflict, "changed since it was loaded"):
            save_frame_annotation(
                dataset_root=self.root,
                manifest_path=self.manifest_path,
                session_id=self.session["sessionId"],
                frame_id=self.frame["frameId"],
                editor_id="owner-daniel",
                expected_manifest_sha256=state["manifestSha256"],
                expected_label_sha256=state["labelSha256"],
                negative=False,
                categories=["drawing"],
                hands=[{"keypoints": keypoints(0.1)}],
            )

    def test_refuses_a_noop_resave_without_creating_a_broken_receipt(self) -> None:
        self._save(hands=[{"keypoints": keypoints(0.05)}])
        state = load_frame_annotation(
            self.root,
            self.manifest_path,
            self.session["sessionId"],
            self.frame["frameId"],
        )
        receipt_count = len(list((self.root / "annotation-receipts").glob("*.json")))

        with self.assertRaisesRegex(AnnotationWorkbenchError, "unchanged"):
            save_frame_annotation(
                dataset_root=self.root,
                manifest_path=self.manifest_path,
                session_id=self.session["sessionId"],
                frame_id=self.frame["frameId"],
                editor_id="owner-daniel",
                expected_manifest_sha256=state["manifestSha256"],
                expected_label_sha256=state["labelSha256"],
                negative=False,
                categories=["drawing", "pinch"],
                hands=[{"keypoints": keypoints(0.05)}],
            )

        self.assertEqual(
            len(list((self.root / "annotation-receipts").glob("*.json"))),
            receipt_count,
        )

    def test_model_assisted_provenance_is_preserved_when_reviewed(self) -> None:
        manifest = read_manifest(self.manifest_path)
        model_sha = "a" * 64
        manifest["sessions"][0]["annotation"] = {
            "method": "model_assisted",
            "reviewed": False,
            "tool": "commandcanvas-yolo-prelabeler",
            "toolVersion": "1.0.0",
            "modelSha256": model_sha,
        }
        write_manifest(self.manifest_path, manifest)
        self.manifest = manifest
        self.session = manifest["sessions"][0]
        self.frame = self.session["frames"][0]

        receipt = self._save()

        updated = read_manifest(self.manifest_path)["sessions"][0]["annotation"]
        self.assertEqual(updated["method"], "model_assisted")
        self.assertEqual(updated["modelSha256"], model_sha)
        self.assertTrue(updated["reviewed"])
        self.assertEqual(
            receipt["previousAnnotation"]["tool"], "commandcanvas-yolo-prelabeler"
        )

    def test_finalize_emits_a_canonical_receipt_bound_to_every_edit(self) -> None:
        edit_receipt = self._save(hands=[{"keypoints": keypoints(0.03)}])

        final = finalize_annotations(
            dataset_root=self.root,
            manifest_path=self.manifest_path,
            editor_id="owner-daniel",
        )

        self.assertEqual(final["manifestSha256"], sha256_file(self.manifest_path))
        self.assertEqual(final["editReceiptSha256s"], [edit_receipt["receiptSha256"]])
        self.assertTrue(final["datasetValidation"]["eligibleForTraining"])
        self.assertFalse(final["productionEligible"])
        self.assertTrue(verify_digest(final, "receiptSha256"))
        output_path = self.root / "annotation-finalization-receipt.json"
        self.assertEqual(output_path.read_bytes(), canonical_json_bytes(final))

    def test_finalization_is_idempotent_and_locks_later_edits(self) -> None:
        self._save(hands=[{"keypoints": keypoints(0.03)}])
        first = finalize_annotations(
            dataset_root=self.root,
            manifest_path=self.manifest_path,
            editor_id="owner-daniel",
        )
        receipt_path = self.root / "annotation-finalization-receipt.json"
        first_bytes = receipt_path.read_bytes()

        second = finalize_annotations(
            dataset_root=self.root,
            manifest_path=self.manifest_path,
            editor_id="owner-daniel",
        )
        state = load_frame_annotation(
            self.root,
            self.manifest_path,
            self.session["sessionId"],
            self.frame["frameId"],
        )

        self.assertEqual(second, first)
        self.assertEqual(receipt_path.read_bytes(), first_bytes)
        with self.assertRaisesRegex(AnnotationWorkbenchError, "finalized|immutable"):
            save_frame_annotation(
                dataset_root=self.root,
                manifest_path=self.manifest_path,
                session_id=self.session["sessionId"],
                frame_id=self.frame["frameId"],
                editor_id="owner-daniel",
                expected_manifest_sha256=state["manifestSha256"],
                expected_label_sha256=state["labelSha256"],
                negative=False,
                categories=["drawing"],
                hands=[{"keypoints": keypoints(0.1)}],
            )

    def test_finalize_refuses_a_branched_or_orphaned_edit_receipt(self) -> None:
        receipt = self._save(hands=[{"keypoints": keypoints(0.03)}])
        orphan = dict(receipt)
        orphan["editId"] = "00000000-0000-4000-8000-000000000999"
        orphan.pop("receiptSha256")
        orphan = attach_digest(orphan, "receiptSha256")
        orphan_path = self.root / "annotation-receipts" / "orphan.json"
        orphan_path.write_bytes(canonical_json_bytes(orphan))

        with self.assertRaisesRegex(AnnotationWorkbenchError, "single manifest chain"):
            finalize_annotations(
                dataset_root=self.root,
                manifest_path=self.manifest_path,
                editor_id="owner-daniel",
            )

    def test_private_workspace_and_local_server_boundaries_are_mandatory(self) -> None:
        repository_root = Path(__file__).resolve().parents[4]
        with self.assertRaisesRegex(AnnotationWorkbenchError, "outside the repository"):
            validate_private_workspace(
                repository_root / "private-data", repository_root
            )
        with self.assertRaisesRegex(AnnotationWorkbenchError, "outside the repository"):
            validate_private_workspace(repository_root.parent, repository_root)
        validate_private_workspace(self.root, repository_root)

        for host in ("127.0.0.1", "::1", "localhost"):
            self.assertEqual(validate_loopback_host(host), host)
        for host in ("0.0.0.0", "192.168.50.20", "example.com"):
            with self.subTest(host=host):
                with self.assertRaisesRegex(AnnotationWorkbenchError, "loopback"):
                    validate_loopback_host(host)

        for host_header in ("127.0.0.1:8765", "localhost:8765", "[::1]:8765"):
            self.assertEqual(validate_request_host(host_header), host_header)
        for host_header in ("", "attacker.example:8765", "127.0.0.1@attacker:8765"):
            with self.subTest(host_header=host_header):
                with self.assertRaisesRegex(AnnotationWorkbenchError, "Host"):
                    validate_request_host(host_header)

    def test_ui_is_self_contained_and_names_the_21_point_review_contract(self) -> None:
        html = render_workbench_html("csrf-test-token")

        self.assertIn("CommandCanvas Hand Annotation", html)
        self.assertIn("Wrist", html)
        self.assertIn("Index tip", html)
        self.assertIn("21 / 21", html)
        self.assertIn("Mark no hand", html)
        self.assertIn("X-CommandCanvas-Workbench-Token", html)
        self.assertIn("await fetch(imagePath", html)
        self.assertIn("URL.createObjectURL", html)
        self.assertNotIn("https://", html)
        self.assertNotIn("http://", html)

    def test_ui_aborts_stale_frame_loads_and_saves_the_loaded_frame_snapshot(
        self,
    ) -> None:
        html = render_workbench_html("csrf-test-token")

        self.assertIn("new AbortController()", html)
        self.assertIn("loadGeneration", html)
        self.assertIn("generation !== loadGeneration", html)
        self.assertIn("currentFrame = Object.freeze", html)
        self.assertIn("framePath(saveFrame)", html)
        self.assertNotIn("framePath(listing[selectedIndex])", html)

    def test_cli_exposes_local_annotate_and_offline_finalize_commands(self) -> None:
        environment = dict(os.environ)
        environment["PYTHONPATH"] = str(PACKAGE_ROOT)
        for command in ("annotate", "finalize-annotations"):
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "commandcanvas_hand_finetune",
                    command,
                    "--help",
                ],
                check=False,
                capture_output=True,
                text=True,
                env=environment,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("--dataset-root", result.stdout)
            self.assertIn("--manifest", result.stdout)


if __name__ == "__main__":
    unittest.main()
