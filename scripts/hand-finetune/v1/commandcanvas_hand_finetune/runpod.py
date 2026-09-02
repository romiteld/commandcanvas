"""Bounded RunPod REST request preparation and explicit cleanup support."""

from __future__ import annotations

import json
import os
import re
import stat
import urllib.error
import urllib.request
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Mapping, Protocol

from .canonical import attach_digest, canonical_json_bytes, sha256_file
from .dataset import DatasetValidationError, validate_dataset


RUNPOD_BASE_URL = "https://rest.runpod.io/v1"
ALLOWED_GPU_IDS = ("NVIDIA H200", "NVIDIA H100 80GB HBM3")
CONTAINER_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._/:\-]*@sha256:[0-9a-f]{64}$")


class LaunchRefused(RuntimeError):
    pass


@dataclass(frozen=True)
class LaunchInputs:
    dataset_root: Path
    manifest_path: Path
    receipt_path: Path
    archive_path: Path
    output_dir: Path
    ssh_private_key: Path
    container_ref: str
    max_runtime_minutes: int
    max_spend_usd: Decimal


@dataclass(frozen=True)
class RunPodHttpResponse:
    status: int
    body: bytes


class RunPodTransport(Protocol):
    def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        body: bytes | None,
    ) -> RunPodHttpResponse: ...


class UrlLibTransport:
    def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        body: bytes | None,
    ) -> RunPodHttpResponse:
        request = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return RunPodHttpResponse(status=response.status, body=response.read())
        except urllib.error.HTTPError as error:
            return RunPodHttpResponse(status=error.code, body=error.read())


def _load_json_object(path: Path, label: str) -> dict[str, Any]:
    if path.is_symlink() or not path.is_file():
        raise LaunchRefused(f"{label} must be a regular file")
    try:

        def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
            result: dict[str, Any] = {}
            for key, item in pairs:
                if key in result:
                    raise LaunchRefused(f"{label} contains duplicate JSON key: {key}")
                result[key] = item
            return result

        value = json.loads(
            path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys
        )
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise LaunchRefused(f"{label} could not be read: {error}") from error
    if not isinstance(value, dict):
        raise LaunchRefused(f"{label} must be a JSON object")
    return value


def _validate_launch_inputs(inputs: LaunchInputs) -> dict[str, Any]:
    try:
        current_receipt = validate_dataset(inputs.dataset_root, inputs.manifest_path)
    except DatasetValidationError as error:
        raise LaunchRefused(f"dataset receipt revalidation failed: {error}") from error
    stored_receipt = _load_json_object(inputs.receipt_path, "dataset receipt")
    if stored_receipt != current_receipt:
        raise LaunchRefused("dataset receipt does not match the revalidated dataset")
    if inputs.receipt_path.read_bytes() != canonical_json_bytes(current_receipt):
        raise LaunchRefused(
            "dataset receipt is not in its deterministic canonical form"
        )
    if not CONTAINER_PATTERN.fullmatch(inputs.container_ref):
        raise LaunchRefused("container reference must be digest-qualified with @sha256")
    archive = Path(inputs.archive_path)
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size == 0:
        raise LaunchRefused("dataset archive must be a non-empty regular file")
    output = Path(inputs.output_dir)
    if output.is_symlink() or not output.is_dir():
        raise LaunchRefused(
            "output directory must be an existing non-symlink directory"
        )
    if any(output.iterdir()):
        raise LaunchRefused("output directory must be empty before launch")
    key = Path(inputs.ssh_private_key)
    if key.is_symlink() or not key.is_file() or key.stat().st_size == 0:
        raise LaunchRefused("SSH private key must be a non-empty regular file")
    key_mode = stat.S_IMODE(key.stat().st_mode)
    if key_mode & (stat.S_IRWXG | stat.S_IRWXO):
        raise LaunchRefused(
            "SSH private key permissions must not allow group or other access"
        )
    try:
        key_text = key.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise LaunchRefused(
            f"SSH private key is not readable OpenSSH text: {error}"
        ) from error
    openssh_begin = "-----BEGIN " + "OPENSSH PRIVATE KEY-----"
    openssh_end = "-----END " + "OPENSSH PRIVATE KEY-----"
    if not (
        key_text.startswith(f"{openssh_begin}\n")
        and key_text.rstrip().endswith(openssh_end)
    ):
        raise LaunchRefused("SSH private key must use OpenSSH private-key framing")
    if not 5 <= inputs.max_runtime_minutes <= 120:
        raise LaunchRefused(
            "max runtime must be explicitly set between 5 and 120 minutes"
        )
    if not inputs.max_spend_usd.is_finite() or not Decimal(
        "0.01"
    ) <= inputs.max_spend_usd <= Decimal("50.00"):
        raise LaunchRefused("max spend must be explicitly set between $0.01 and $50.00")
    return current_receipt


def prepare_launch(
    inputs: LaunchInputs,
    *,
    transport: RunPodTransport | None = None,
) -> dict[str, Any]:
    """Prepare and validate a request. This function never performs network I/O."""

    del transport
    receipt = _validate_launch_inputs(inputs)
    request = {
        "name": "commandcanvas-owner-hand-finetune-v1",
        "cloudType": "SECURE",
        "computeType": "GPU",
        "gpuCount": 1,
        "gpuTypeIds": list(ALLOWED_GPU_IDS),
        "gpuTypePriority": "custom",
        "imageName": inputs.container_ref,
        "containerDiskInGb": 30,
        "volumeInGb": 0,
        "interruptible": False,
        "minVcpuCount": 8,
        "minMemoryInGb": 64,
        "ports": ["22/tcp"],
        "env": [
            {"key": "COMMANDCANVAS_TRAINING_SPEC", "value": "hand-finetune/v1"},
            {
                "key": "COMMANDCANVAS_MAX_RUNTIME_MINUTES",
                "value": str(inputs.max_runtime_minutes),
            },
        ],
    }
    prepared = {
        "schemaVersion": "commandcanvas.runpod-launch-plan/v1",
        "mode": "dry-run",
        "datasetReceiptSha256": receipt["receiptSha256"],
        "datasetArchive": {
            "byteSize": inputs.archive_path.stat().st_size,
            "sha256": sha256_file(inputs.archive_path),
            "pathExposed": False,
        },
        "containerRef": inputs.container_ref,
        "maxRuntimeMinutes": inputs.max_runtime_minutes,
        "maxSpendUsd": format(inputs.max_spend_usd, ".2f"),
        "request": request,
        "unresolvedExecuteGates": [
            "secure SSH upload/download implementation and host-key pinning",
            "independent runtime guardian and forced pod termination",
        ],
    }
    return attach_digest(prepared, "planSha256")


def execute_launch(
    inputs: LaunchInputs,
    *,
    environ: Mapping[str, str] | None = None,
    transport: RunPodTransport | None = None,
) -> dict[str, Any]:
    """Refuse before billing until transfer and guardian gates are implemented."""

    prepare_launch(inputs, transport=transport)
    environment = os.environ if environ is None else environ
    if not environment.get("RUNPOD_API_KEY"):
        raise LaunchRefused("RUNPOD_API_KEY must be present in the current environment")
    raise LaunchRefused(
        "secure SSH transfer with host-key pinning and an independent termination guardian "
        "remain unresolved; refusing before POST /v1/pods"
    )


class RunPodClient:
    def __init__(self, *, api_key: str, transport: RunPodTransport | None = None):
        if not api_key:
            raise LaunchRefused("RunPod API key is required")
        self._api_key = api_key
        self._transport = transport or UrlLibTransport()

    def _request(
        self, method: str, path: str, payload: dict[str, Any] | None = None
    ) -> RunPodHttpResponse:
        body = canonical_json_bytes(payload) if payload is not None else None
        response = self._transport.request(
            method,
            f"{RUNPOD_BASE_URL}{path}",
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            body=body,
        )
        return response

    def delete_pod(self, pod_id: str) -> None:
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,128}", pod_id):
            raise LaunchRefused("pod id is invalid")
        response = self._request("DELETE", f"/pods/{pod_id}")
        if response.status not in {200, 202, 204, 404}:
            raise LaunchRefused(f"RunPod delete failed with HTTP {response.status}")

    def create_bounded_pod(
        self,
        request: dict[str, Any],
        *,
        max_runtime_minutes: int,
        cleanup_grace_minutes: int,
        max_spend_usd: Decimal,
        started_at: str,
    ) -> dict[str, Any]:
        if not 5 <= max_runtime_minutes <= 120:
            raise LaunchRefused("max runtime must be between 5 and 120 minutes")
        if not 1 <= cleanup_grace_minutes <= 15:
            raise LaunchRefused("cleanup grace must be between 1 and 15 minutes")
        if not max_spend_usd.is_finite() or not Decimal(
            "0.01"
        ) <= max_spend_usd <= Decimal("50.00"):
            raise LaunchRefused("max spend must be between $0.01 and $50.00")
        response = self._request("POST", "/pods", request)
        if response.status not in {200, 201, 202}:
            raise LaunchRefused(f"RunPod create failed with HTTP {response.status}")
        try:
            payload = json.loads(response.body)
            pod_id = payload["id"]
            selected_gpu = payload["gpu"]["id"]
            gpu_count = int(payload["gpu"]["count"])
            hourly_rate = Decimal(str(payload["adjustedCostPerHr"]))
        except (
            KeyError,
            TypeError,
            ValueError,
            InvalidOperation,
            json.JSONDecodeError,
        ) as error:
            raise LaunchRefused(
                f"RunPod create response did not satisfy the expected contract: {error}"
            ) from error
        estimated_spend = (
            hourly_rate
            * Decimal(max_runtime_minutes + cleanup_grace_minutes)
            / Decimal(60)
        ).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
        refusal: str | None = None
        if selected_gpu not in ALLOWED_GPU_IDS or gpu_count != 1:
            refusal = "RunPod selected an unexpected GPU allocation"
        elif estimated_spend > max_spend_usd:
            refusal = (
                f"RunPod estimated maximum spend {estimated_spend} exceeds "
                f"maximum spend {max_spend_usd}"
            )
        if refusal:
            try:
                self.delete_pod(str(pod_id))
            except LaunchRefused as cleanup_error:
                raise LaunchRefused(
                    f"{refusal}; immediate delete also failed: {cleanup_error}"
                ) from cleanup_error
            raise LaunchRefused(refusal)
        receipt = {
            "schemaVersion": "commandcanvas.runpod-run-receipt/v1",
            "podId": str(pod_id),
            "startedAt": started_at,
            "selectedGpuId": selected_gpu,
            "gpuCount": gpu_count,
            "hourlyRateUsd": format(hourly_rate, "f"),
            "maxRuntimeMinutes": max_runtime_minutes,
            "cleanupGraceMinutes": cleanup_grace_minutes,
            "estimatedMaximumSpendUsd": format(estimated_spend, ".6f"),
            "maxSpendUsd": format(max_spend_usd, ".2f"),
            "terminationRequired": True,
            "productionEligible": False,
        }
        return attach_digest(receipt, "runReceiptSha256")
