from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Sequence

import numpy as np
from PIL import Image

from .model_manifest import (
    RTMDET_HAND_DETECTOR_CANDIDATE,
    RTMPOSE_HAND_REFINER_CANDIDATE,
)


MAX_HANDS = 2
HAND_LABEL = 0


class HybridPoseError(ValueError):
    """A pure detector/refiner boundary received an incompatible value."""


@dataclass(frozen=True)
class FrameBox:
    """Axis-aligned detector box in source-frame pixel coordinates."""

    x: float
    y: float
    width: float
    height: float
    confidence: float


@dataclass(frozen=True)
class DetectorResizeTransform:
    """Top-left letterbox transform used by the RTMDet export pipeline."""

    source_width: int
    source_height: int
    scale: float
    rendered_width: int
    rendered_height: int
    input_size: int

    @property
    def scale_x(self) -> float:
        return self.rendered_width / self.source_width

    @property
    def scale_y(self) -> float:
        return self.rendered_height / self.source_height


@dataclass(frozen=True)
class PoseCropTransform:
    """Axis-aligned affine map from one square pose crop to its source frame."""

    source_width: int
    source_height: int
    left: float
    top: float
    width: float
    height: float
    input_size: int
    detector_confidence: float

    @property
    def right(self) -> float:
        return self.left + self.width

    @property
    def bottom(self) -> float:
        return self.top + self.height


@dataclass(frozen=True)
class PoseLandmark:
    """One landmark mapped to normalized full-frame coordinates."""

    x: float
    y: float
    visibility: float


@dataclass(frozen=True)
class PoseEstimate:
    """Decoded pose evidence without inventing handedness or metric depth."""

    landmarks: tuple[PoseLandmark, ...]
    pose_confidence: float
    detector_confidence: float


def prepare_detector_input(
    frame_rgb: np.ndarray,
    *,
    input_size: int = 320,
) -> tuple[np.ndarray, DetectorResizeTransform]:
    """Resize RGB source pixels into RTMDet's verified BGR tensor contract."""

    height, width = _validate_rgb_frame(frame_rgb)
    if input_size <= 0:
        raise HybridPoseError("Detector input size must be positive.")
    scale = min(input_size / width, input_size / height)
    rendered_width = max(1, min(input_size, round(width * scale)))
    rendered_height = max(1, min(input_size, round(height * scale)))

    image = Image.fromarray(frame_rgb)
    resized = image.resize(
        (rendered_width, rendered_height),
        Image.Resampling.BILINEAR,
    )
    canvas = np.full((input_size, input_size, 3), 114, dtype=np.uint8)
    canvas[:rendered_height, :rendered_width] = np.asarray(resized, dtype=np.uint8)

    # The browser frame is RGB. The published RTMDet pipeline uses OpenCV BGR
    # order with ``to_rgb: false``, so reverse channels before normalization.
    bgr = canvas[..., ::-1].astype(np.float32)
    mean = np.asarray(RTMDET_HAND_DETECTOR_CANDIDATE.mean, dtype=np.float32)
    std = np.asarray(RTMDET_HAND_DETECTOR_CANDIDATE.std, dtype=np.float32)
    normalized = (bgr - mean) / std
    tensor = np.ascontiguousarray(normalized.transpose(2, 0, 1)[None, ...])
    return tensor, DetectorResizeTransform(
        source_width=width,
        source_height=height,
        scale=scale,
        rendered_width=rendered_width,
        rendered_height=rendered_height,
        input_size=input_size,
    )


def decode_detector_output(
    detections: np.ndarray,
    labels: np.ndarray,
    transform: DetectorResizeTransform,
    *,
    confidence_threshold: float = 0.3,
    max_hands: int = MAX_HANDS,
) -> tuple[FrameBox, ...]:
    """Decode the end-to-end RTMDet outputs into bounded source-frame boxes."""

    if detections.ndim != 3 or detections.shape[0] != 1 or detections.shape[2] != 5:
        raise HybridPoseError("RTMDet detection tensor must have shape [1,N,5].")
    if labels.ndim != 2 or labels.shape != detections.shape[:2]:
        raise HybridPoseError("RTMDet label tensor must have shape [1,N].")
    if not np.issubdtype(detections.dtype, np.floating):
        raise HybridPoseError("RTMDet detection tensor must be floating point.")
    if not np.issubdtype(labels.dtype, np.integer):
        raise HybridPoseError("RTMDet label tensor must contain integers.")
    if not np.all(np.isfinite(detections)):
        raise HybridPoseError("RTMDet outputs must contain only finite values.")
    if not math.isfinite(confidence_threshold):
        raise HybridPoseError("Detector confidence threshold must be finite.")
    _validate_detector_transform(transform)
    limit = _validate_hand_limit(max_hands)

    candidates: list[FrameBox] = []
    for row, label in zip(detections[0], labels[0]):
        if int(label) != HAND_LABEL:
            continue
        confidence = float(row[4])
        if confidence < confidence_threshold:
            continue
        x1, y1, x2, y2 = (float(value) for value in row[:4])
        left = _clamp(min(x1, x2) / transform.scale_x, 0.0, transform.source_width)
        right = _clamp(max(x1, x2) / transform.scale_x, 0.0, transform.source_width)
        top = _clamp(min(y1, y2) / transform.scale_y, 0.0, transform.source_height)
        bottom = _clamp(max(y1, y2) / transform.scale_y, 0.0, transform.source_height)
        if right <= left or bottom <= top:
            continue
        candidates.append(
            FrameBox(
                x=_rounded(left),
                y=_rounded(top),
                width=_rounded(right - left),
                height=_rounded(bottom - top),
                confidence=_rounded(_clamp(confidence, 0.0, 1.0)),
            )
        )
    candidates.sort(key=lambda box: box.confidence, reverse=True)
    return tuple(candidates[:limit])


def bounded_pose_crop(
    box: FrameBox,
    *,
    frame_width: int,
    frame_height: int,
    padding_ratio: float = 0.25,
    input_size: int = 256,
) -> PoseCropTransform:
    """Expand a visible detector box to a square that remains within the frame."""

    if frame_width <= 0 or frame_height <= 0 or input_size <= 0:
        raise HybridPoseError("Frame and pose input dimensions must be positive.")
    values = (box.x, box.y, box.width, box.height, box.confidence, padding_ratio)
    if not all(math.isfinite(value) for value in values):
        raise HybridPoseError("Pose crop inputs must contain only finite values.")
    if box.width <= 0 or box.height <= 0:
        raise HybridPoseError("Detector box dimensions must be positive.")
    if not 0.0 <= padding_ratio <= 1.0:
        raise HybridPoseError("Pose crop padding must be between zero and one.")

    visible_left = _clamp(box.x, 0.0, frame_width)
    visible_top = _clamp(box.y, 0.0, frame_height)
    visible_right = _clamp(box.x + box.width, 0.0, frame_width)
    visible_bottom = _clamp(box.y + box.height, 0.0, frame_height)
    if visible_right <= visible_left or visible_bottom <= visible_top:
        raise HybridPoseError("Detector box must intersect the source frame.")

    visible_width = visible_right - visible_left
    visible_height = visible_bottom - visible_top
    center_x = (visible_left + visible_right) / 2.0
    center_y = (visible_top + visible_bottom) / 2.0
    side = max(visible_width, visible_height) * (1.0 + padding_ratio)
    side = min(side, float(frame_width), float(frame_height))

    left = _clamp(center_x - side / 2.0, 0.0, frame_width - side)
    top = _clamp(center_y - side / 2.0, 0.0, frame_height - side)
    return PoseCropTransform(
        source_width=frame_width,
        source_height=frame_height,
        left=_rounded(left),
        top=_rounded(top),
        width=_rounded(side),
        height=_rounded(side),
        input_size=input_size,
        detector_confidence=_rounded(_clamp(box.confidence, 0.0, 1.0)),
    )


def prepare_pose_batch(
    frame_rgb: np.ndarray,
    boxes: Sequence[FrameBox],
    *,
    padding_ratio: float = 0.25,
    input_size: int = 256,
) -> tuple[np.ndarray, tuple[PoseCropTransform, ...]]:
    """Build a dynamic one- or two-hand RTMPose batch from an RGB frame."""

    height, width = _validate_rgb_frame(frame_rgb)
    if not 1 <= len(boxes) <= MAX_HANDS:
        raise HybridPoseError("RTMPose requires a dynamic batch of one or two hands.")
    transforms = tuple(
        bounded_pose_crop(
            box,
            frame_width=width,
            frame_height=height,
            padding_ratio=padding_ratio,
            input_size=input_size,
        )
        for box in boxes
    )
    image = Image.fromarray(frame_rgb)
    mean = np.asarray(RTMPOSE_HAND_REFINER_CANDIDATE.mean, dtype=np.float32)
    std = np.asarray(RTMPOSE_HAND_REFINER_CANDIDATE.std, dtype=np.float32)
    samples: list[np.ndarray] = []
    for transform in transforms:
        crop = image.transform(
            (input_size, input_size),
            Image.Transform.EXTENT,
            (
                transform.left,
                transform.top,
                transform.right,
                transform.bottom,
            ),
            Image.Resampling.BILINEAR,
        )
        pixels = np.asarray(crop, dtype=np.float32)
        normalized = (pixels - mean) / std
        samples.append(normalized.transpose(2, 0, 1))
    return np.ascontiguousarray(np.stack(samples, axis=0)), transforms


def decode_simcc(
    simcc_x: np.ndarray,
    simcc_y: np.ndarray,
    transforms: Sequence[PoseCropTransform],
    *,
    split_ratio: float = 2.0,
) -> tuple[PoseEstimate, ...]:
    """Decode paired SimCC axes and map all 21 points to their source frames."""

    _validate_simcc_tensors(simcc_x, simcc_y, transforms)
    if not math.isfinite(split_ratio) or split_ratio <= 0:
        raise HybridPoseError("SimCC split ratio must be finite and positive.")

    x_indices = np.argmax(simcc_x, axis=2)
    y_indices = np.argmax(simcc_y, axis=2)
    x_peaks = np.max(simcc_x, axis=2)
    y_peaks = np.max(simcc_y, axis=2)
    poses: list[PoseEstimate] = []
    for batch_index, transform in enumerate(transforms):
        landmarks: list[PoseLandmark] = []
        scores: list[float] = []
        for landmark_index in range(RTMPOSE_HAND_REFINER_CANDIDATE.keypoints):
            model_x = float(x_indices[batch_index, landmark_index]) / split_ratio
            model_y = float(y_indices[batch_index, landmark_index]) / split_ratio
            source_x = transform.left + (
                model_x / transform.input_size * transform.width
            )
            source_y = transform.top + (
                model_y / transform.input_size * transform.height
            )
            score = calibrate_simcc_confidence(
                float(x_peaks[batch_index, landmark_index]),
                float(y_peaks[batch_index, landmark_index]),
            )
            scores.append(score)
            landmarks.append(
                PoseLandmark(
                    x=_clamp(source_x / transform.source_width, 0.0, 1.0),
                    y=_clamp(source_y / transform.source_height, 0.0, 1.0),
                    visibility=score,
                )
            )
        poses.append(
            PoseEstimate(
                landmarks=tuple(landmarks),
                pose_confidence=_rounded(sum(scores) / len(scores)),
                detector_confidence=transform.detector_confidence,
            )
        )
    return tuple(poses)


def calibrate_simcc_confidence(x_peak: float, y_peak: float) -> float:
    """Conservatively bound a keypoint by its weaker one-dimensional peak."""

    if not math.isfinite(x_peak) or not math.isfinite(y_peak):
        raise HybridPoseError("SimCC confidence peaks must be finite.")
    return _rounded(_clamp(min(x_peak, y_peak), 0.0, 1.0))


def _validate_rgb_frame(frame_rgb: np.ndarray) -> tuple[int, int]:
    if (
        not isinstance(frame_rgb, np.ndarray)
        or frame_rgb.dtype != np.uint8
        or frame_rgb.ndim != 3
        or frame_rgb.shape[2] != 3
        or frame_rgb.shape[0] <= 0
        or frame_rgb.shape[1] <= 0
    ):
        raise HybridPoseError("Source frame must be a non-empty HWC RGB uint8 tensor.")
    return int(frame_rgb.shape[0]), int(frame_rgb.shape[1])


def _validate_detector_transform(transform: DetectorResizeTransform) -> None:
    if (
        transform.source_width <= 0
        or transform.source_height <= 0
        or transform.rendered_width <= 0
        or transform.rendered_height <= 0
        or transform.rendered_width > transform.input_size
        or transform.rendered_height > transform.input_size
        or transform.input_size <= 0
        or not math.isfinite(transform.scale)
        or transform.scale <= 0
    ):
        raise HybridPoseError("RTMDet resize transform is invalid.")


def _validate_simcc_tensors(
    simcc_x: np.ndarray,
    simcc_y: np.ndarray,
    transforms: Sequence[PoseCropTransform],
) -> None:
    if simcc_x.ndim != 3 or simcc_y.ndim != 3:
        raise HybridPoseError("SimCC outputs must be rank-three tensors.")
    if simcc_x.shape[0] not in {1, 2} or simcc_y.shape[0] not in {1, 2}:
        raise HybridPoseError("RTMPose outputs require a batch of one or two hands.")
    if simcc_x.shape[1] != 21 or simcc_y.shape[1] != 21:
        raise HybridPoseError("RTMPose outputs must contain exactly 21 landmarks.")
    if simcc_x.shape[2] != 512 or simcc_y.shape[2] != 512:
        raise HybridPoseError("RTMPose outputs must contain exactly 512 bins per axis.")
    if simcc_x.shape != simcc_y.shape:
        raise HybridPoseError("RTMPose paired SimCC tensor shapes must match.")
    if len(transforms) != simcc_x.shape[0]:
        raise HybridPoseError("RTMPose crop count must match the dynamic batch.")
    if not np.issubdtype(simcc_x.dtype, np.floating) or not np.issubdtype(
        simcc_y.dtype, np.floating
    ):
        raise HybridPoseError("SimCC outputs must be floating point tensors.")
    if not np.all(np.isfinite(simcc_x)) or not np.all(np.isfinite(simcc_y)):
        raise HybridPoseError("SimCC outputs must contain only finite values.")
    for transform in transforms:
        values = (
            transform.left,
            transform.top,
            transform.width,
            transform.height,
            transform.detector_confidence,
        )
        if (
            transform.source_width <= 0
            or transform.source_height <= 0
            or transform.input_size <= 0
            or transform.width <= 0
            or transform.height <= 0
            or not all(math.isfinite(value) for value in values)
        ):
            raise HybridPoseError("RTMPose crop transform is invalid.")


def _validate_hand_limit(max_hands: int) -> int:
    if not isinstance(max_hands, int) or not 1 <= max_hands <= MAX_HANDS:
        raise HybridPoseError("Hand limit must be one or two.")
    return max_hands


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


def _rounded(value: float) -> float:
    return round(float(value), 6)
