from __future__ import annotations

import importlib
from dataclasses import FrozenInstanceError
from types import ModuleType

import numpy as np
import pytest


def hybrid_pose() -> ModuleType:
    return importlib.import_module("commandcanvas_hand_relay.hybrid_pose")


def manifests() -> ModuleType:
    return importlib.import_module("commandcanvas_hand_relay.model_manifest")


def test_candidate_manifests_pin_verified_artifacts_without_changing_the_default() -> None:
    module = manifests()
    detector = module.RTMDET_HAND_DETECTOR_CANDIDATE
    refiner = module.RTMPOSE_HAND_REFINER_CANDIDATE

    assert detector.variant == "rtmdet_nano_hand_320_fp32_candidate"
    assert detector.source_archive == "rtmdet_nano_8xb32-300e_hand-267f9c8f.zip"
    assert detector.source_archive_byte_size == 3_840_129
    assert (
        detector.source_archive_sha256
        == "9c0370a43c02b2fe42b4382aba7383d97cfa3ed35623b655cac4f0c25cfde402"
    )
    assert detector.model_byte_size == 4_010_667
    assert (
        detector.model_sha256
        == "568d3ea97a5b142488366b67e036b6a5cb0a1fef9087a710cb8e66b6979fbac2"
    )
    assert detector.input_shape == (1, 3, 320, 320)
    assert detector.output_shapes == ((1, "detections", 5), (1, "detections"))
    assert detector.channel_order == "BGR"
    assert detector.mean == (103.53, 116.28, 123.675)
    assert detector.std == (57.375, 57.12, 58.395)

    assert refiner.variant == "rtmpose_m_distill_256_candidate"
    assert refiner.repository == "tasmulaev/rtmpose-m-distill"
    assert refiner.revision == "ec0d56fdf55a350106671e763338a4a76372a888"
    assert refiner.source_artifact == "onnx/rtmpose-m-distill-256x256.onnx"
    assert refiner.byte_size == 55_118_513
    assert (
        refiner.sha256
        == "6d50664e566fffee41a090c98f75e893b50846a753b802dbf5e2072a8dfd7784"
    )
    assert refiner.input_shape == ("batch", 3, 256, 256)
    assert refiner.output_shapes == (
        ("batch", 21, 512),
        ("batch", 21, 512),
    )
    assert refiner.keypoints == 21
    assert refiner.simcc_split_ratio == 2.0
    assert refiner.release_license == "Apache-2.0"

    assert set(module.MODEL_MANIFESTS) == {
        "yolo26_hand_pose_640_fp16",
        "yolo26_hand_pose_320_fp16",
    }
    assert module.PRODUCTION_MODEL_MANIFEST.variant == "yolo26_hand_pose_640_fp16"
    with pytest.raises(FrozenInstanceError):
        refiner.byte_size = 1


def test_rtmdet_preprocess_uses_top_left_padding_and_verified_bgr_normalization() -> None:
    module = hybrid_pose()
    frame = np.empty((2, 4, 3), dtype=np.uint8)
    frame[:, :] = [124, 116, 104]

    tensor, transform = module.prepare_detector_input(frame, input_size=4)

    assert tensor.shape == (1, 3, 4, 4)
    assert tensor.dtype == np.float32
    assert transform.source_width == 4
    assert transform.source_height == 2
    assert transform.rendered_width == 4
    assert transform.rendered_height == 2
    assert transform.scale == 1.0
    np.testing.assert_allclose(
        tensor[0, :, 0, 0],
        np.array(
            [
                (104 - 103.53) / 57.375,
                (116 - 116.28) / 57.12,
                (124 - 123.675) / 58.395,
            ],
            dtype=np.float32,
        ),
        rtol=0,
        atol=1e-6,
    )
    np.testing.assert_allclose(
        tensor[0, :, 3, 0],
        np.array(
            [
                (114 - 103.53) / 57.375,
                (114 - 116.28) / 57.12,
                (114 - 123.675) / 58.395,
            ],
            dtype=np.float32,
        ),
        rtol=0,
        atol=1e-6,
    )


def test_rtmdet_decode_maps_boxes_to_source_and_keeps_two_best_hands() -> None:
    module = hybrid_pose()
    transform = module.DetectorResizeTransform(
        source_width=640,
        source_height=360,
        scale=0.5,
        rendered_width=320,
        rendered_height=180,
        input_size=320,
    )
    detections = np.array(
        [
            [
                [10, 20, 110, 120, 0.6],
                [20, 30, 220, 170, 0.95],
                [0, 0, 50, 50, 0.4],
                [30, 30, 60, 60, 0.99],
            ]
        ],
        dtype=np.float32,
    )
    labels = np.array([[0, 0, 0, 1]], dtype=np.int64)

    boxes = module.decode_detector_output(
        detections,
        labels,
        transform,
        confidence_threshold=0.5,
        max_hands=2,
    )

    assert len(boxes) == 2
    assert boxes[0] == module.FrameBox(
        x=40.0,
        y=60.0,
        width=400.0,
        height=280.0,
        confidence=0.95,
    )
    assert boxes[1] == module.FrameBox(
        x=20.0,
        y=40.0,
        width=200.0,
        height=200.0,
        confidence=0.6,
    )


def test_rtmdet_decode_uses_the_actual_rounded_scale_on_each_axis() -> None:
    module = hybrid_pose()
    transform = module.DetectorResizeTransform(
        source_width=3,
        source_height=2,
        scale=4 / 3,
        rendered_width=4,
        rendered_height=3,
        input_size=4,
    )
    detections = np.array([[[0, 0, 2, 1.5, 0.9]]], dtype=np.float32)
    labels = np.array([[0]], dtype=np.int64)

    boxes = module.decode_detector_output(detections, labels, transform)

    assert boxes == (
        module.FrameBox(
            x=0.0,
            y=0.0,
            width=1.5,
            height=1.0,
            confidence=0.9,
        ),
    )


def test_bounded_pose_crop_pads_a_hand_without_creating_an_off_frame_box() -> None:
    module = hybrid_pose()
    box = module.FrameBox(
        x=-20.0,
        y=10.0,
        width=100.0,
        height=80.0,
        confidence=0.8,
    )

    crop = module.bounded_pose_crop(
        box,
        frame_width=640,
        frame_height=480,
        padding_ratio=0.25,
        input_size=256,
    )

    assert crop.left == 0.0
    assert crop.top == 0.0
    assert crop.width == 100.0
    assert crop.height == 100.0
    assert crop.right <= 640
    assert crop.bottom <= 480
    assert crop.detector_confidence == 0.8


def test_pose_preprocess_builds_only_dynamic_batches_of_one_or_two() -> None:
    module = hybrid_pose()
    frame = np.empty((300, 400, 3), dtype=np.uint8)
    frame[:, :] = [124, 116, 104]
    boxes = [
        module.FrameBox(40, 60, 80, 80, 0.9),
        module.FrameBox(220, 100, 100, 60, 0.8),
    ]

    one, one_transforms = module.prepare_pose_batch(frame, boxes[:1])
    two, two_transforms = module.prepare_pose_batch(frame, boxes)

    assert one.shape == (1, 3, 256, 256)
    assert two.shape == (2, 3, 256, 256)
    assert one.dtype == np.float32
    assert len(one_transforms) == 1
    assert len(two_transforms) == 2
    np.testing.assert_allclose(
        one[0, :, 128, 128],
        np.array(
            [
                (124 - 123.675) / 58.395,
                (116 - 116.28) / 57.12,
                (104 - 103.53) / 57.375,
            ],
            dtype=np.float32,
        ),
        rtol=0,
        atol=1e-6,
    )

    with pytest.raises(module.HybridPoseError, match="one or two"):
        module.prepare_pose_batch(frame, [])
    with pytest.raises(module.HybridPoseError, match="one or two"):
        module.prepare_pose_batch(frame, boxes + [boxes[0]])


def test_simcc_decode_returns_21_frame_normalized_landmarks_for_two_hands() -> None:
    module = hybrid_pose()
    transforms = (
        module.PoseCropTransform(400, 300, 100, 50, 200, 200, 256, 0.9),
        module.PoseCropTransform(400, 300, 0, 0, 100, 100, 256, 0.8),
    )
    simcc_x = np.zeros((2, 21, 512), dtype=np.float32)
    simcc_y = np.zeros((2, 21, 512), dtype=np.float32)
    simcc_x[:, :, 256] = 0.8
    simcc_y[:, :, 256] = 0.6

    poses = module.decode_simcc(simcc_x, simcc_y, transforms)

    assert len(poses) == 2
    assert all(len(pose.landmarks) == 21 for pose in poses)
    assert poses[0].landmarks[0] == module.PoseLandmark(
        x=0.5,
        y=0.5,
        visibility=0.6,
    )
    assert poses[0].pose_confidence == 0.6
    assert poses[0].detector_confidence == 0.9
    assert poses[1].landmarks[0] == module.PoseLandmark(
        x=0.125,
        y=1 / 6,
        visibility=0.6,
    )


def test_simcc_confidence_uses_the_weaker_axis_and_is_protocol_bounded() -> None:
    module = hybrid_pose()

    assert module.calibrate_simcc_confidence(0.8, 0.6) == 0.6
    assert module.calibrate_simcc_confidence(1.4, 1.2) == 1.0
    assert module.calibrate_simcc_confidence(-0.2, 0.7) == 0.0

    with pytest.raises(module.HybridPoseError, match="finite"):
        module.calibrate_simcc_confidence(float("nan"), 0.7)


@pytest.mark.parametrize(
    ("simcc_x", "simcc_y", "transforms", "message"),
    [
        (
            np.zeros((1, 20, 512), dtype=np.float32),
            np.zeros((1, 20, 512), dtype=np.float32),
            1,
            "21 landmarks",
        ),
        (
            np.zeros((1, 21, 256), dtype=np.float32),
            np.zeros((1, 21, 512), dtype=np.float32),
            1,
            "512 bins",
        ),
        (
            np.zeros((3, 21, 512), dtype=np.float32),
            np.zeros((3, 21, 512), dtype=np.float32),
            3,
            "one or two",
        ),
        (
            np.zeros((2, 21, 512), dtype=np.float32),
            np.zeros((2, 21, 512), dtype=np.float32),
            1,
            "crop count",
        ),
    ],
)
def test_simcc_decode_refuses_invalid_tensor_contracts(
    simcc_x: np.ndarray,
    simcc_y: np.ndarray,
    transforms: int,
    message: str,
) -> None:
    module = hybrid_pose()
    transform = module.PoseCropTransform(400, 300, 0, 0, 200, 200, 256, 0.9)

    with pytest.raises(module.HybridPoseError, match=message):
        module.decode_simcc(simcc_x, simcc_y, (transform,) * transforms)


def test_tensor_boundaries_reject_non_finite_values_and_invalid_rgb_frames() -> None:
    module = hybrid_pose()
    transform = module.PoseCropTransform(400, 300, 0, 0, 200, 200, 256, 0.9)
    simcc_x = np.zeros((1, 21, 512), dtype=np.float32)
    simcc_y = np.zeros((1, 21, 512), dtype=np.float32)
    simcc_x[0, 0, 0] = np.nan

    with pytest.raises(module.HybridPoseError, match="finite"):
        module.decode_simcc(simcc_x, simcc_y, (transform,))
    with pytest.raises(module.HybridPoseError, match="RGB uint8"):
        module.prepare_detector_input(np.zeros((10, 10), dtype=np.uint8))
    with pytest.raises(module.HybridPoseError, match="RGB uint8"):
        module.prepare_pose_batch(
            np.zeros((10, 10, 3), dtype=np.float32),
            [module.FrameBox(0, 0, 5, 5, 0.8)],
        )


def test_detector_decode_refuses_invalid_output_tensors() -> None:
    module = hybrid_pose()
    transform = module.DetectorResizeTransform(640, 360, 0.5, 320, 180, 320)

    with pytest.raises(module.HybridPoseError, match="detection tensor"):
        module.decode_detector_output(
            np.zeros((1, 2, 4), dtype=np.float32),
            np.zeros((1, 2), dtype=np.int64),
            transform,
        )
    invalid = np.zeros((1, 2, 5), dtype=np.float32)
    invalid[0, 0, 4] = np.inf
    with pytest.raises(module.HybridPoseError, match="finite"):
        module.decode_detector_output(
            invalid,
            np.zeros((1, 2), dtype=np.int64),
            transform,
        )
