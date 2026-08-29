from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping


@dataclass(frozen=True)
class ModelManifest:
    variant: str
    repository: str
    revision: str
    source_artifact: str
    local_filename: str
    byte_size: int
    sha256: str
    input_name: str
    input_type: str
    input_shape: tuple[int, int, int, int]
    output_name: str
    output_type: str
    output_shape: tuple[int, int, int]
    precision: str
    keypoints: int
    release_license: str

    @property
    def input_size(self) -> int:
        return self.input_shape[-1]


PRODUCTION_MODEL_MANIFEST = ModelManifest(
    variant="yolo26_hand_pose_640_fp16",
    repository="poptoz/yolo26-hand-pose-face-detection",
    revision="2abb91a7030e1aa5231ec900ccb2c07ab3f03460",
    source_artifact="models/yolo26_hand_pose_fp16.onnx",
    local_filename="yolo26_hand_pose_640_fp16.onnx",
    byte_size=21_547_949,
    sha256="f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e",
    input_name="images",
    input_type="tensor(float)",
    input_shape=(1, 3, 640, 640),
    output_name="output0",
    output_type="tensor(float)",
    output_shape=(1, 300, 69),
    precision="fp16",
    keypoints=21,
    release_license="AGPL-3.0",
)


ROLLBACK_MODEL_MANIFEST = ModelManifest(
    variant="yolo26_hand_pose_320_fp16",
    repository="poptoz/yolo26-hand-pose-face-detection",
    revision="2abb91a7030e1aa5231ec900ccb2c07ab3f03460",
    source_artifact="checkpoints/yolo26_hand_pose.pt",
    local_filename="yolo26_hand_pose_320_fp16.onnx",
    byte_size=21_447_188,
    sha256="07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc",
    input_name="images",
    input_type="tensor(float)",
    input_shape=(1, 3, 320, 320),
    output_name="output0",
    output_type="tensor(float)",
    output_shape=(1, 300, 69),
    precision="fp16",
    keypoints=21,
    release_license="AGPL-3.0",
)


MODEL_MANIFESTS: Mapping[str, ModelManifest] = MappingProxyType(
    {
        PRODUCTION_MODEL_MANIFEST.variant: PRODUCTION_MODEL_MANIFEST,
        ROLLBACK_MODEL_MANIFEST.variant: ROLLBACK_MODEL_MANIFEST,
    }
)


def model_manifest(variant: str) -> ModelManifest:
    try:
        return MODEL_MANIFESTS[variant]
    except KeyError:
        raise ValueError("Private relay model variant is not recognized.") from None
