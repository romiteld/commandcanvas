from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from repository_artifact_guard import (  # noqa: E402
    ArtifactGuardError,
    validate_tracked_artifacts,
)


class RepositoryArtifactGuardTests(unittest.TestCase):
    def test_refuses_private_media_models_archives_and_oversized_training_files(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            unsafe_paths = [
                "private/vision-lab/capture.webm",
                "scripts/hand-finetune/v1/datasets/frame.mp4",
                "scripts/hand-finetune/v1/models/candidate.onnx",
                "scripts/hand-finetune/v1/models/source.pt",
                "scripts/hand-finetune/v1/archives/dataset.tar.gz",
            ]
            for relative_path in unsafe_paths:
                path = root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(b"private")
            oversized = root / "scripts/hand-finetune/v1/generated/receipt.json"
            oversized.parent.mkdir(parents=True, exist_ok=True)
            oversized.write_bytes(b"x" * (1_048_576 + 1))

            with self.assertRaises(ArtifactGuardError) as context:
                validate_tracked_artifacts(
                    root, [*unsafe_paths, oversized.relative_to(root).as_posix()]
                )

            message = str(context.exception)
            for relative_path in unsafe_paths:
                self.assertIn(relative_path, message)
            self.assertIn("receipt.json exceeds 1048576 bytes", message)

    def test_allows_source_tests_and_small_public_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            safe_paths = [
                "scripts/hand-finetune/v1/commandcanvas_hand_finetune/trainer.py",
                "scripts/hand-finetune/v1/tests/test_training_and_export.py",
                "scripts/hand-finetune/v1/README.md",
                "scripts/hand-finetune/v1/public/model-card.json",
            ]
            for relative_path in safe_paths:
                path = root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("safe", encoding="utf-8")

            validate_tracked_artifacts(root, safe_paths)

    def test_refuses_missing_symlink_and_non_regular_tracked_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            regular = root / "scripts/hand-finetune/v1/README.md"
            regular.parent.mkdir(parents=True)
            regular.write_text("safe", encoding="utf-8")
            symlink = root / "scripts/hand-finetune/v1/link.md"
            symlink.symlink_to(regular)

            with self.assertRaisesRegex(ArtifactGuardError, "not a regular file"):
                validate_tracked_artifacts(
                    root,
                    [
                        "scripts/hand-finetune/v1/missing.md",
                        "scripts/hand-finetune/v1/link.md",
                    ],
                )

    def test_refuses_private_key_and_provider_secret_material(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            private_key = root / "scripts/hand-finetune/v1/config/trainer.pem"
            provider_key = root / "scripts/hand-finetune/v1/config/provider.txt"
            private_key.parent.mkdir(parents=True)
            private_key.write_text(
                "-----BEGIN " + "OPENSSH PRIVATE KEY-----\nnot-a-real-key",
                encoding="utf-8",
            )
            provider_key.write_text(
                "sk-" + "proj-" + "A" * 40,
                encoding="utf-8",
            )

            with self.assertRaises(ArtifactGuardError) as context:
                validate_tracked_artifacts(
                    root,
                    [
                        private_key.relative_to(root).as_posix(),
                        provider_key.relative_to(root).as_posix(),
                    ],
                )

            self.assertEqual(
                str(context.exception).count(
                    "contains private-key or provider-secret material"
                ),
                2,
            )

    def test_refuses_every_forced_tracked_private_training_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            private_paths = [
                "scripts/hand-finetune/v1/captures/session.json",
                "scripts/hand-finetune/v1/datasets/frame.jpg",
                "scripts/hand-finetune/v1/datasets/labels/frame.txt",
                "scripts/hand-finetune/v1/models/metadata.json",
                "scripts/hand-finetune/v1/outputs/metrics.csv",
                "scripts/hand-finetune/v1/runs/events.txt",
                "scripts/hand-finetune/v1/archives/member-manifest.json",
            ]
            for relative_path in private_paths:
                path = root / relative_path
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("private training artifact", encoding="utf-8")

            with self.assertRaises(ArtifactGuardError) as context:
                validate_tracked_artifacts(root, private_paths)

            message = str(context.exception)
            for relative_path in private_paths:
                self.assertIn(relative_path, message)
            self.assertEqual(
                message.count("private training artifact"), len(private_paths)
            )

    def test_refuses_hugging_face_token_material(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            relative_path = "scripts/hand-finetune/v1/config/provider.txt"
            provider_key = root / relative_path
            provider_key.parent.mkdir(parents=True, exist_ok=True)
            provider_key.write_text("hf_" + "A" * 40, encoding="utf-8")

            with self.assertRaisesRegex(ArtifactGuardError, "provider-secret material"):
                validate_tracked_artifacts(root, [relative_path])


if __name__ == "__main__":
    unittest.main()
