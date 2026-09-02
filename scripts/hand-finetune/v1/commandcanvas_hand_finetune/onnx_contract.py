"""Strict candidate ONNX validation. Validation never promotes a candidate."""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .canonical import attach_digest, sha256_file


class OnnxContractError(ValueError):
    pass


@dataclass(frozen=True)
class OnnxInspection:
    checker_passed: bool
    providers: tuple[str, ...]
    input_name: str
    input_type: str
    input_shape: tuple[int, ...]
    output_name: str
    output_type: str
    output_shape: tuple[int, ...]
    outputs: tuple[Any, ...]


def _inspect_with_runtime(path: Path) -> OnnxInspection:
    try:
        import numpy as np
        import onnx
        import onnxruntime as ort  # type: ignore[import-untyped]
    except ImportError as error:
        raise OnnxContractError(
            f"ONNX validation dependencies are unavailable: {error}"
        ) from error
    try:
        model = onnx.load(str(path), load_external_data=True)
        onnx.checker.check_model(model, full_check=True)
        session = ort.InferenceSession(
            str(path), providers=["CUDAExecutionProvider", "CPUExecutionProvider"]
        )
        inputs = session.get_inputs()
        outputs = session.get_outputs()
        if len(inputs) != 1 or len(outputs) != 1:
            raise OnnxContractError(
                "model must expose exactly one input and one output"
            )
        input_info = inputs[0]
        output_info = outputs[0]
        actual_outputs = session.run(
            None,
            {input_info.name: np.zeros((1, 3, 640, 640), dtype=np.float32)},
        )
    except OnnxContractError:
        raise
    except Exception as error:
        raise OnnxContractError(
            f"ONNX checker or runtime inspection failed: {error}"
        ) from error
    return OnnxInspection(
        checker_passed=True,
        providers=tuple(session.get_providers()),
        input_name=input_info.name,
        input_type=input_info.type,
        input_shape=tuple(int(item) for item in input_info.shape),
        output_name=output_info.name,
        output_type=output_info.type,
        output_shape=tuple(int(item) for item in output_info.shape),
        outputs=tuple(actual_outputs),
    )


def validate_onnx_contract(
    path: Path,
    *,
    dataset_receipt_sha256: str,
    training_spec_sha256: str,
    inspection: OnnxInspection | None = None,
) -> dict[str, Any]:
    candidate = Path(path)
    errors: list[str] = []
    if (
        candidate.is_symlink()
        or not candidate.is_file()
        or candidate.stat().st_size == 0
    ):
        raise OnnxContractError("candidate ONNX must be a non-empty regular file")
    for name, digest in (
        ("dataset receipt", dataset_receipt_sha256),
        ("training spec", training_spec_sha256),
    ):
        if len(digest) != 64 or any(
            character not in "0123456789abcdef" for character in digest
        ):
            errors.append(f"{name} SHA-256 is invalid")
    observed = inspection or _inspect_with_runtime(candidate)
    if not observed.checker_passed:
        errors.append("ONNX checker did not pass")
    if observed.providers[:1] != ("CUDAExecutionProvider",):
        errors.append("CUDAExecutionProvider must be the primary validation provider")
    if (observed.input_name, observed.input_type, observed.input_shape) != (
        "images",
        "tensor(float)",
        (1, 3, 640, 640),
    ):
        errors.append("input tensor must be images tensor(float) [1,3,640,640]")
    if (observed.output_name, observed.output_type, observed.output_shape) != (
        "output0",
        "tensor(float)",
        (1, 300, 69),
    ):
        errors.append("output tensor must be output0 tensor(float) [1,300,69]")
    if len(observed.outputs) != 1:
        errors.append("runtime must return exactly one output")
    else:
        output = observed.outputs[0]
        shape = tuple(getattr(output, "shape", ()))
        if shape != (1, 300, 69):
            errors.append("runtime output tensor shape must be [1,300,69]")
        try:
            finite = bool(output.size) and all(
                math.isfinite(float(item)) for item in output.flat
            )
        except (AttributeError, TypeError, ValueError):
            finite = False
        if not finite:
            errors.append("runtime output values must all be finite")
    if errors:
        raise OnnxContractError(
            "ONNX contract validation failed:\n- " + "\n- ".join(errors)
        )
    manifest = {
        "schemaVersion": "commandcanvas.hand-candidate-manifest/v1",
        "modelSha256": sha256_file(candidate),
        "modelByteSize": candidate.stat().st_size,
        "datasetReceiptSha256": dataset_receipt_sha256,
        "trainingSpecSha256": training_spec_sha256,
        "input": {"name": "images", "type": "tensor(float)", "shape": [1, 3, 640, 640]},
        "output": {"name": "output0", "type": "tensor(float)", "shape": [1, 300, 69]},
        "precision": "fp16-graph-fp32-io",
        "validationProvider": "CUDAExecutionProvider",
        "productionEligible": False,
        "promotionState": "candidate-requires-benchmark-license-and-human-acceptance",
    }
    return attach_digest(manifest, "candidateManifestSha256")
