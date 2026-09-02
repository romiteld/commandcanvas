"""Bounded, receipt-driven CommandCanvas hand-pose training utilities."""

from .dataset import DatasetValidationError, validate_dataset

__all__ = ["DatasetValidationError", "validate_dataset"]
