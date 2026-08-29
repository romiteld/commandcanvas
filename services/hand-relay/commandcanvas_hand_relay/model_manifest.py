from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping


TensorDimension = int | str


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


@dataclass(frozen=True)
class DetectorCandidateManifest:
    """Immutable evidence for an unselected detector candidate.

    Candidate manifests deliberately live outside ``MODEL_MANIFESTS``. That
    registry controls the active YOLO backend and remains the only source of
    runtime-selectable model variants until an end-to-end release gate chooses
    a replacement.
    """

    variant: str
    source_archive: str
    source_archive_byte_size: int
    source_archive_sha256: str
    model_member: str
    model_byte_size: int
    model_sha256: str
    input_name: str
    input_type: str
    input_shape: tuple[int, int, int, int]
    output_names: tuple[str, str]
    output_types: tuple[str, str]
    output_shapes: tuple[
        tuple[TensorDimension, TensorDimension, TensorDimension],
        tuple[TensorDimension, TensorDimension],
    ]
    precision: str
    channel_order: str
    mean: tuple[float, float, float]
    std: tuple[float, float, float]
    release_license: str


@dataclass(frozen=True)
class PoseRefinerCandidateManifest:
    """Immutable tensor and provenance contract for a pose-refiner candidate."""

    variant: str
    repository: str
    revision: str
    source_artifact: str
    local_filename: str
    byte_size: int
    sha256: str
    input_name: str
    input_type: str
    input_shape: tuple[TensorDimension, int, int, int]
    output_names: tuple[str, str]
    output_types: tuple[str, str]
    output_shapes: tuple[
        tuple[TensorDimension, int, int],
        tuple[TensorDimension, int, int],
    ]
    precision: str
    keypoints: int
    simcc_split_ratio: float
    channel_order: str
    mean: tuple[float, float, float]
    std: tuple[float, float, float]
    release_license: str


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


# Candidate-only evidence. The archive SHA-256 and contained model tensor
# contract were inspected locally; the bytes are intentionally not copied into
# this repository by the candidate manifest.
RTMDET_HAND_DETECTOR_CANDIDATE = DetectorCandidateManifest(
    variant="rtmdet_nano_hand_320_fp32_candidate",
    source_archive="rtmdet_nano_8xb32-300e_hand-267f9c8f.zip",
    source_archive_byte_size=3_840_129,
    source_archive_sha256=(
        "9c0370a43c02b2fe42b4382aba7383d97cfa3ed35623b655cac4f0c25cfde402"
    ),
    model_member=(
        "20230831/rtmdet_onnx/"
        "rtmdet_nano_8xb32-300e_hand-267f9c8f/end2end.onnx"
    ),
    model_byte_size=4_010_667,
    model_sha256=(
        "568d3ea97a5b142488366b67e036b6a5cb0a1fef9087a710cb8e66b6979fbac2"
    ),
    input_name="input",
    input_type="tensor(float)",
    input_shape=(1, 3, 320, 320),
    output_names=("dets", "labels"),
    output_types=("tensor(float)", "tensor(int64)"),
    output_shapes=((1, "detections", 5), (1, "detections")),
    precision="fp32",
    channel_order="BGR",
    mean=(103.53, 116.28, 123.675),
    std=(57.375, 57.12, 58.395),
    release_license="Apache-2.0",
)


RTMPOSE_HAND_REFINER_CANDIDATE = PoseRefinerCandidateManifest(
    variant="rtmpose_m_distill_256_candidate",
    repository="tasmulaev/rtmpose-m-distill",
    revision="ec0d56fdf55a350106671e763338a4a76372a888",
    source_artifact="onnx/rtmpose-m-distill-256x256.onnx",
    local_filename="rtmpose-m-distill-256x256.onnx",
    byte_size=55_118_513,
    sha256="6d50664e566fffee41a090c98f75e893b50846a753b802dbf5e2072a8dfd7784",
    input_name="input",
    input_type="tensor(float)",
    input_shape=("batch", 3, 256, 256),
    output_names=("simcc_x", "simcc_y"),
    output_types=("tensor(float)", "tensor(float)"),
    output_shapes=(("batch", 21, 512), ("batch", 21, 512)),
    precision="fp32",
    keypoints=21,
    simcc_split_ratio=2.0,
    channel_order="RGB",
    mean=(123.675, 116.28, 103.53),
    std=(58.395, 57.12, 57.375),
    release_license="Apache-2.0",
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
