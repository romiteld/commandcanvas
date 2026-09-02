from __future__ import annotations

import json
import math
import tempfile
import unittest
import zipfile
from pathlib import Path

import numpy as np
from scipy.io import savemat  # type: ignore[import-untyped]

from trajectory_tuning import (
    AcceptanceThresholds,
    AlphaBetaConfig,
    FilterConfig,
    NoiseConfig,
    Trajectory,
    apply_one_euro,
    apply_alpha_beta,
    build_artifact,
    compute_metrics,
    iter_dataset_trajectories,
    select_bounded_splits,
    split_for_example,
    synthesize_measurements,
)


class DatasetParserTests(unittest.TestCase):
    def test_streams_mat_rows_and_removes_only_trailing_zero_padding(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            archive = Path(temporary_directory) / "fixture.zip"
            x = np.array(
                [[10, 11, 0, 12, 0, 0], [20, 21, 22, 0, 0, 0]], dtype=np.uint16
            )
            y = np.array([[-4, -3, 0, -2, 0, 0], [-7, -6, -5, 0, 0, 0]], dtype=np.int16)
            z = np.array(
                [[30, 31, 0, 32, 0, 0], [40, 41, 42, 0, 0, 0]], dtype=np.uint16
            )
            labels = np.array([[7], [8]], dtype=np.uint8)
            with zipfile.ZipFile(archive, "w") as bundle:
                for name, key, value in (
                    ("Numbers/Matlab/X.mat", "X", x),
                    ("Numbers/Matlab/Y.mat", "Y", y),
                    ("Numbers/Matlab/Z.mat", "Z", z),
                    ("Numbers/Matlab/label.mat", "label", labels),
                ):
                    path = Path(temporary_directory) / Path(name).name
                    savemat(path, {key: value})
                    bundle.write(path, name)

            samples = list(iter_dataset_trajectories(archive, families=("Numbers",)))

        self.assertEqual(
            [sample.sample_id for sample in samples], ["numbers:0", "numbers:1"]
        )
        self.assertEqual(samples[0].label, "7")
        self.assertEqual(
            samples[0].points_xyz,
            (
                (10.0, -4.0, 30.0),
                (11.0, -3.0, 31.0),
                (0.0, 0.0, 0.0),
                (12.0, -2.0, 32.0),
            ),
        )

    def test_example_split_is_deterministic_and_disjoint(self) -> None:
        self.assertEqual(split_for_example(0), "train")
        self.assertEqual(split_for_example(5), "train")
        self.assertEqual(split_for_example(6), "validation")
        self.assertEqual(split_for_example(7), "validation")
        self.assertEqual(split_for_example(8), "test")
        self.assertEqual(split_for_example(9), "test")

    def test_bounded_selection_keeps_number_and_shape_families_in_every_split(
        self,
    ) -> None:
        trajectories = tuple(
            Trajectory(
                sample_id=f"{family}:{index}",
                family=family,
                label=str(index % 10),
                example_index=index,
                points_xyz=((0.0, 0.0, 0.0), (1.0, 1.0, 1.0)),
            )
            for family in ("numbers", "shapes")
            for index in range(10)
        )

        splits = select_bounded_splits(
            trajectories,
            {"train": 4, "validation": 4, "test": 4},
        )

        for split in ("train", "validation", "test"):
            families = [trajectory.family for trajectory in splits[split]]
            self.assertEqual(families.count("numbers"), 2)
            self.assertEqual(families.count("shapes"), 2)


class MeasurementSimulationTests(unittest.TestCase):
    def test_synthetic_noise_and_dropouts_are_reproducible_and_labeled(self) -> None:
        trajectory = Trajectory(
            sample_id="shapes:12",
            family="shapes",
            label="3",
            example_index=12,
            points_xyz=tuple(
                (float(index), float(index % 2), 0.0) for index in range(12)
            ),
        )
        config = NoiseConfig(
            jitter_sigma=0.02, dropout_start_probability=1.0, max_dropout_frames=2
        )

        first = synthesize_measurements(trajectory, config, seed=99)
        second = synthesize_measurements(trajectory, config, seed=99)

        self.assertEqual(first, second)
        self.assertEqual(len(first.points), 12)
        self.assertTrue(any(point is None for point in first.points[1:-1]))
        self.assertEqual(first.provenance, "synthetic_noise_on_real_raw_trajectory")


class OneEuroTests(unittest.TestCase):
    def test_short_dropout_holds_last_filtered_point_without_using_future_frames(
        self,
    ) -> None:
        observed = ((0.0, 0.0), (1.0, 0.0), None, (3.0, 0.0))

        filtered = apply_one_euro(
            observed, FilterConfig(1.0, 0.0, 1.0), nominal_hz=30.0
        )

        self.assertEqual(len(filtered), 4)
        self.assertEqual(filtered[2], filtered[1])
        self.assertTrue(
            all(math.isfinite(value) for point in filtered for value in point)
        )


class AlphaBetaTests(unittest.TestCase):
    def test_short_dropout_uses_only_estimated_past_velocity(self) -> None:
        observed = ((0.0, 0.0), (1.0, 0.0), None)

        filtered = apply_alpha_beta(
            observed,
            AlphaBetaConfig(alpha=1.0, beta=1.0, dropout_velocity_damping=1.0),
            nominal_hz=1.0,
        )

        self.assertEqual(filtered, ((0.0, 0.0), (1.0, 0.0), (2.0, 0.0)))


class MetricAndArtifactTests(unittest.TestCase):
    def test_metrics_report_literal_error_reduction_and_path_distortion(self) -> None:
        reference = ((0.0, 0.0), (1.0, 0.0), (2.0, 0.0))
        observed = ((0.1, 0.0), (1.1, 0.0), (2.1, 0.0))
        filtered = ((0.05, 0.0), (1.05, 0.0), (2.05, 0.0))

        metrics = compute_metrics(
            reference, observed, filtered, dropout_mask=(False, False, False)
        )

        self.assertAlmostEqual(metrics.observed_rmse, 0.1, places=9)
        self.assertAlmostEqual(metrics.filtered_rmse, 0.05, places=9)
        self.assertAlmostEqual(metrics.error_reduction_ratio, 0.5, places=9)
        self.assertAlmostEqual(metrics.filtered_path_length_ratio, 1.0, places=9)

    def test_metrics_separately_report_segment_jitter_reduction(self) -> None:
        reference = ((0.0, 0.0), (1.0, 0.0), (2.0, 0.0))
        observed = ((0.1, 0.0), (1.2, 0.0), (2.1, 0.0))
        filtered = ((0.05, 0.0), (1.1, 0.0), (2.05, 0.0))

        metrics = compute_metrics(
            reference, observed, filtered, dropout_mask=(False, False, False)
        )

        self.assertAlmostEqual(metrics.observed_jitter_rmse, 0.1, places=9)
        self.assertAlmostEqual(metrics.filtered_jitter_rmse, 0.05, places=9)
        self.assertAlmostEqual(metrics.jitter_reduction_ratio, 0.5, places=9)

    def test_artifact_refuses_promotion_when_corner_distortion_exceeds_threshold(
        self,
    ) -> None:
        artifact = build_artifact(
            selected_config=FilterConfig(2.0, 0.25, 1.0),
            dataset_sha256="a" * 64,
            split_counts={"train": 60, "validation": 20, "test": 20},
            test_metrics={
                "error_reduction_ratio": 0.40,
                "jitter_reduction_ratio": 0.40,
                "position_rmse_ratio": 0.80,
                "corner_rmse": 0.08,
                "filtered_path_length_ratio": 0.97,
                "gap_rmse_ratio": 0.80,
            },
            thresholds=AcceptanceThresholds(
                minimum_error_reduction_ratio=0.20,
                minimum_jitter_reduction_ratio=0.20,
                maximum_position_rmse_ratio=1.10,
                maximum_corner_rmse=0.04,
                minimum_path_length_ratio=0.85,
                maximum_path_length_ratio=1.05,
                maximum_gap_rmse_ratio=1.0,
            ),
        )

        self.assertEqual(artifact["decision"], "refused")
        self.assertIn("corner_rmse", artifact["failed_thresholds"])
        self.assertFalse(artifact["production_eligible"])

    def test_artifact_promotes_only_when_every_held_out_threshold_passes(self) -> None:
        artifact = build_artifact(
            selected_config=FilterConfig(2.0, 0.25, 1.0),
            dataset_sha256="b" * 64,
            split_counts={"train": 60, "validation": 20, "test": 20},
            test_metrics={
                "error_reduction_ratio": 0.30,
                "jitter_reduction_ratio": 0.30,
                "position_rmse_ratio": 0.70,
                "corner_rmse": 0.03,
                "filtered_path_length_ratio": 0.96,
                "gap_rmse_ratio": 0.90,
            },
            thresholds=AcceptanceThresholds(
                minimum_error_reduction_ratio=0.20,
                minimum_jitter_reduction_ratio=0.20,
                maximum_position_rmse_ratio=1.10,
                maximum_corner_rmse=0.04,
                minimum_path_length_ratio=0.85,
                maximum_path_length_ratio=1.05,
                maximum_gap_rmse_ratio=1.0,
            ),
        )

        self.assertEqual(
            artifact["schema_version"], "commandcanvas.drawing-filter-tuning/v1"
        )
        self.assertEqual(artifact["decision"], "promoted")
        self.assertTrue(artifact["production_eligible"])
        json.dumps(artifact, allow_nan=False)

    def test_artifact_refuses_when_jitter_improves_less_than_the_release_gate(
        self,
    ) -> None:
        artifact = build_artifact(
            selected_config=FilterConfig(8.0, 1.0, 1.0),
            dataset_sha256="c" * 64,
            split_counts={"train": 60, "validation": 20, "test": 20},
            test_metrics={
                "error_reduction_ratio": 0.05,
                "jitter_reduction_ratio": 0.10,
                "position_rmse_ratio": 0.95,
                "corner_rmse": 0.02,
                "filtered_path_length_ratio": 0.98,
                "gap_rmse_ratio": 0.90,
            },
            thresholds=AcceptanceThresholds(
                minimum_error_reduction_ratio=-0.10,
                minimum_jitter_reduction_ratio=0.20,
                maximum_position_rmse_ratio=1.10,
                maximum_corner_rmse=0.04,
                minimum_path_length_ratio=0.85,
                maximum_path_length_ratio=1.05,
                maximum_gap_rmse_ratio=1.10,
            ),
        )

        self.assertEqual(artifact["decision"], "refused")
        self.assertIn("jitter_reduction_ratio", artifact["failed_thresholds"])

    def test_artifact_serializes_the_selected_alpha_beta_filter(self) -> None:
        artifact = build_artifact(
            selected_config=AlphaBetaConfig(
                alpha=0.7,
                beta=0.3,
                dropout_velocity_damping=0.8,
            ),
            dataset_sha256="d" * 64,
            split_counts={"train": 60, "validation": 20, "test": 20},
            test_metrics={
                "error_reduction_ratio": 0.10,
                "jitter_reduction_ratio": 0.30,
                "position_rmse_ratio": 0.90,
                "corner_rmse": 0.02,
                "filtered_path_length_ratio": 1.01,
                "gap_rmse_ratio": 0.95,
            },
            thresholds=AcceptanceThresholds(
                minimum_error_reduction_ratio=-0.10,
                minimum_jitter_reduction_ratio=0.20,
                maximum_position_rmse_ratio=1.10,
                maximum_corner_rmse=0.04,
                minimum_path_length_ratio=0.85,
                maximum_path_length_ratio=1.05,
                maximum_gap_rmse_ratio=1.10,
            ),
        )

        self.assertEqual(
            artifact["selected_filter"],
            {
                "kind": "alpha_beta",
                "alpha": 0.7,
                "beta": 0.3,
                "dropout_velocity_damping": 0.8,
            },
        )


if __name__ == "__main__":
    unittest.main()
