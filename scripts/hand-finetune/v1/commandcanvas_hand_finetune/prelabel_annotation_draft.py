"""Pinned, local-only YOLO26 pose prelabels for private annotation drafts."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from .annotation_workbench import _label_bytes, _validated_hands
from .canonical import sha256_file
from .prepare_annotation_draft import (
    AnnotationDraftPreparationError,
    CommandRunner,
    _default_command_runner,
    _materialize_annotation_draft,
)
from .training_spec import TRAINING_RUNTIME, UPSTREAM_CHECKPOINT


PRELABEL_ADAPTER = "commandcanvas-yolo26-pose-prelabel"
PRELABEL_ADAPTER_VERSION = "1.0.0"


class PrelabelPreparationError(ValueError):
    """Raised when the local prelabel boundary cannot be proven."""


class PosePrelabelBackend(Protocol):
    def load(self, checkpoint: Path) -> None: ...

    def predict(
        self,
        image_path: Path,
        *,
        dataset_id: str,
        session_id: str,
        frame_id: str,
        image_sha256: str,
    ) -> list[dict[str, object]]: ...


class UltralyticsPosePrelabelBackend:
    """Thin adapter for the separately licensed, locally installed runtime."""

    def __init__(self, *, device: str = "0") -> None:
        self._device = device
        self._model: Any | None = None

    def load(self, checkpoint: Path) -> None:
        try:
            import ultralytics  # type: ignore[import-not-found]
            from ultralytics import YOLO  # type: ignore[import-not-found]
        except ImportError as error:
            raise PrelabelPreparationError(
                "Ultralytics is absent; use the separately licensed local runtime"
            ) from error
        if ultralytics.__version__ != TRAINING_RUNTIME["ultralyticsVersion"]:
            raise PrelabelPreparationError(
                "Ultralytics runtime version is not the pinned version"
            )
        model = YOLO(str(checkpoint))
        if getattr(model, "task", None) != "pose":
            raise PrelabelPreparationError(
                "pinned checkpoint did not load as a YOLO pose model"
            )
        self._model = model

    def predict(
        self,
        image_path: Path,
        *,
        dataset_id: str,
        session_id: str,
        frame_id: str,
        image_sha256: str,
    ) -> list[dict[str, object]]:
        del dataset_id, session_id, frame_id, image_sha256
        if self._model is None:
            raise PrelabelPreparationError("prelabel backend is not loaded")
        results = self._model.predict(
            source=str(image_path),
            imgsz=640,
            conf=0.15,
            iou=0.45,
            max_det=2,
            augment=False,
            save=False,
            verbose=False,
            device=self._device,
            stream=False,
        )
        if len(results) != 1:
            raise PrelabelPreparationError(
                "YOLO pose inference must return exactly one image result"
            )
        keypoints = getattr(results[0], "keypoints", None)
        if keypoints is None:
            return []
        normalized = keypoints.xyn.cpu().tolist()
        confidences = (
            keypoints.conf.cpu().tolist()
            if getattr(keypoints, "conf", None) is not None
            else [[1.0] * len(points) for points in normalized]
        )
        hands: list[dict[str, object]] = []
        for points, scores in zip(normalized, confidences):
            if len(points) != 21 or len(scores) != 21:
                raise PrelabelPreparationError(
                    "YOLO pose output must contain exactly 21 hand keypoints"
                )
            hands.append(
                {
                    "keypoints": [
                        {
                            "x": float(point[0]),
                            "y": float(point[1]),
                            "visibility": 2 if float(score) >= 0.5 else 1,
                        }
                        for point, score in zip(points, scores)
                    ]
                }
            )
        return hands


def _canonical_prelabel_bytes(hands: list[dict[str, object]]) -> bytes:
    if not hands:
        return b""
    validated = _validated_hands(hands, negative=False)
    validated.sort(
        key=lambda hand: (
            sum(point[0] for point in hand) / len(hand),
            sum(point[1] for point in hand) / len(hand),
            tuple(point for keypoint in hand for point in keypoint),
        )
    )
    return _label_bytes(validated)


def prepare_prelabel_annotation_draft(
    *,
    capture_root: Path,
    session_map_path: Path,
    output_dir: Path,
    checkpoint_path: Path,
    acknowledge_owner_only_license_boundary: bool,
    command_runner: CommandRunner = _default_command_runner,
    backend: PosePrelabelBackend | None = None,
    device: str = "0",
) -> dict[str, Any]:
    """Create unreviewed train/validation suggestions and manual holdout labels."""

    checkpoint = Path(checkpoint_path)
    try:
        if not acknowledge_owner_only_license_boundary:
            raise PrelabelPreparationError(
                "explicit acknowledgement of the owner-only AGPL/CC-BY-NC-SA "
                "license boundary is required"
            )
        if (
            checkpoint.is_symlink()
            or not checkpoint.is_file()
            or checkpoint.stat().st_size == 0
        ):
            raise PrelabelPreparationError(
                "pinned YOLO26 pose checkpoint must be a non-empty regular file"
            )
        checkpoint_sha = sha256_file(checkpoint)
        if checkpoint_sha != UPSTREAM_CHECKPOINT["sha256"]:
            raise PrelabelPreparationError(
                "pinned YOLO26 pose checkpoint SHA-256 does not match"
            )
        selected = backend or UltralyticsPosePrelabelBackend(device=device)
        loaded = False

        def label_frame(image_path: Path, context: dict[str, str]) -> bytes:
            nonlocal loaded
            try:
                if not loaded:
                    selected.load(checkpoint)
                    loaded = True
                if sha256_file(checkpoint) != checkpoint_sha:
                    raise PrelabelPreparationError(
                        "pinned YOLO26 pose checkpoint changed during prelabeling"
                    )
                current_image_sha = sha256_file(image_path)
                if current_image_sha != context["imageSha256"]:
                    raise PrelabelPreparationError(
                        "frame SHA-256 changed before model prelabeling"
                    )
                hands = selected.predict(
                    image_path,
                    dataset_id=context["datasetId"],
                    session_id=context["sessionId"],
                    frame_id=context["frameId"],
                    image_sha256=context["imageSha256"],
                )
                if sha256_file(checkpoint) != checkpoint_sha:
                    raise PrelabelPreparationError(
                        "pinned YOLO26 pose checkpoint changed during prelabeling"
                    )
                return _canonical_prelabel_bytes(hands)
            except PrelabelPreparationError:
                raise
            except Exception as error:
                raise PrelabelPreparationError(
                    "local YOLO26 pose inference failed"
                ) from error

        return _materialize_annotation_draft(
            capture_root=capture_root,
            session_map_path=session_map_path,
            output_dir=output_dir,
            command_runner=command_runner,
            frame_labeler=label_frame,
            prelabel_model_sha256=checkpoint_sha,
            prelabel_tool=PRELABEL_ADAPTER,
            prelabel_tool_version=PRELABEL_ADAPTER_VERSION,
        )
    except (AnnotationDraftPreparationError, OSError, ValueError) as error:
        if isinstance(error, PrelabelPreparationError):
            raise
        raise PrelabelPreparationError(str(error)) from error
