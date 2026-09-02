from __future__ import annotations

import json
import stat
import sys
import tempfile
import unittest
from decimal import Decimal
from pathlib import Path
from typing import Any

PACKAGE_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PACKAGE_ROOT))

from commandcanvas_hand_finetune.canonical import write_canonical_json  # noqa: E402
from commandcanvas_hand_finetune.dataset import validate_dataset  # noqa: E402
from commandcanvas_hand_finetune.runpod import (  # noqa: E402
    LaunchInputs,
    LaunchRefused,
    RunPodClient,
    RunPodHttpResponse,
    execute_launch,
    prepare_launch,
)
from commandcanvas_hand_finetune.training_spec import TRAINING_RUNTIME  # noqa: E402

from fixture_dataset import write_valid_dataset  # noqa: E402


class RecordingTransport:
    def __init__(self, responses: list[RunPodHttpResponse] | None = None):
        self.calls: list[dict[str, Any]] = []
        self.responses = list(responses or [])

    def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        body: bytes | None,
    ) -> RunPodHttpResponse:
        self.calls.append(
            {"method": method, "url": url, "headers": headers, "body": body}
        )
        if not self.responses:
            raise AssertionError("unexpected network request")
        return self.responses.pop(0)


class RunPodLauncherTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary_directory.name)
        self.dataset_root = self.root / "dataset"
        self.dataset_root.mkdir()
        self.manifest_path = write_valid_dataset(self.dataset_root)
        self.receipt = validate_dataset(self.dataset_root, self.manifest_path)
        self.receipt_path = self.root / "dataset-receipt.json"
        write_canonical_json(self.receipt_path, self.receipt)
        self.archive_path = self.root / "dataset.tar"
        self.archive_path.write_bytes(b"deterministic-private-dataset-archive")
        self.output_dir = self.root / "output"
        self.output_dir.mkdir()
        self.ssh_key_path = self.root / "id_ed25519"
        openssh_begin = "-----BEGIN " + "OPENSSH PRIVATE KEY-----"
        openssh_end = "-----END " + "OPENSSH PRIVATE KEY-----"
        self.ssh_key_path.write_text(
            f"{openssh_begin}\nsynthetic-private-key-fixture\n{openssh_end}\n",
            encoding="utf-8",
        )
        self.ssh_key_path.chmod(stat.S_IRUSR | stat.S_IWUSR)
        self.inputs = LaunchInputs(
            dataset_root=self.dataset_root,
            manifest_path=self.manifest_path,
            receipt_path=self.receipt_path,
            archive_path=self.archive_path,
            output_dir=self.output_dir,
            ssh_private_key=self.ssh_key_path,
            container_ref=TRAINING_RUNTIME["baseImage"],
            max_runtime_minutes=90,
            max_spend_usd=Decimal("10.00"),
        )

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_dry_run_is_network_free_and_redacts_credentials(self) -> None:
        transport = RecordingTransport()
        prepared = prepare_launch(self.inputs, transport=transport)
        rendered = json.dumps(prepared, sort_keys=True)

        self.assertEqual(transport.calls, [])
        self.assertEqual(prepared["mode"], "dry-run")
        self.assertEqual(
            prepared["request"]["gpuTypeIds"], ["NVIDIA H200", "NVIDIA H100 80GB HBM3"]
        )
        self.assertEqual(prepared["request"]["gpuTypePriority"], "custom")
        self.assertEqual(prepared["request"]["cloudType"], "SECURE")
        self.assertEqual(prepared["request"]["gpuCount"], 1)
        self.assertEqual(prepared["request"]["volumeInGb"], 0)
        self.assertEqual(prepared["request"]["allowedCudaVersions"], ["12.8"])
        self.assertEqual(prepared["request"]["minVCPUPerGPU"], 8)
        self.assertEqual(prepared["request"]["minRAMPerGPU"], 64)
        self.assertTrue(prepared["request"]["supportPublicIp"])
        self.assertIsInstance(prepared["request"]["env"], dict)
        self.assertNotIn("minVcpuCount", prepared["request"])
        self.assertNotIn("minMemoryInGb", prepared["request"])
        self.assertRegex(prepared["datasetArchive"]["sha256"], r"^[0-9a-f]{64}$")
        self.assertNotIn("RUNPOD_API_KEY", rendered)
        self.assertNotIn("synthetic-private-key-fixture", rendered)

    def test_tampered_receipt_floating_image_and_unsafe_ssh_key_are_refused(
        self,
    ) -> None:
        tampered = dict(self.receipt)
        tampered["splitCounts"] = {"train": 999}
        write_canonical_json(self.receipt_path, tampered)
        with self.assertRaisesRegex(LaunchRefused, "receipt"):
            prepare_launch(self.inputs)

        write_canonical_json(self.receipt_path, self.receipt)
        floating = LaunchInputs(
            **{**self.inputs.__dict__, "container_ref": "trainer:latest"}
        )
        with self.assertRaisesRegex(LaunchRefused, "digest-qualified"):
            prepare_launch(floating)

        self.ssh_key_path.chmod(stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP)
        with self.assertRaisesRegex(LaunchRefused, "private key permissions"):
            prepare_launch(self.inputs)

    def test_execute_requires_runtime_key_then_refuses_unresolved_transfer_before_network(
        self,
    ) -> None:
        transport = RecordingTransport()
        with self.assertRaisesRegex(LaunchRefused, "RUNPOD_API_KEY"):
            execute_launch(self.inputs, environ={}, transport=transport)
        self.assertEqual(transport.calls, [])

        with self.assertRaisesRegex(LaunchRefused, "secure SSH transfer"):
            execute_launch(
                self.inputs,
                environ={"RUNPOD_API_KEY": "not-printed-test-secret"},
                transport=transport,
            )
        self.assertEqual(transport.calls, [])

    def test_client_exposes_only_cleanup_until_execute_gates_exist(self) -> None:
        transport = RecordingTransport([RunPodHttpResponse(status=204, body=b"")])
        client = RunPodClient(api_key="not-printed-test-secret", transport=transport)
        client.delete_pod("pod-123")

        self.assertEqual(transport.calls[0]["method"], "DELETE")
        self.assertEqual(
            transport.calls[0]["url"], "https://rest.runpod.io/v1/pods/pod-123"
        )
        self.assertFalse(hasattr(client, "create_bounded_pod"))

    def test_prepared_request_uses_only_the_approved_openapi_contract(self) -> None:
        request = prepare_launch(self.inputs)["request"]
        self.assertEqual(
            set(request),
            {
                "allowedCudaVersions",
                "cloudType",
                "computeType",
                "containerDiskInGb",
                "env",
                "gpuCount",
                "gpuTypeIds",
                "gpuTypePriority",
                "imageName",
                "interruptible",
                "minRAMPerGPU",
                "minVCPUPerGPU",
                "name",
                "ports",
                "supportPublicIp",
                "volumeInGb",
            },
        )


if __name__ == "__main__":
    unittest.main()
