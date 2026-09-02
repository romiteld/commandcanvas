from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
import statistics
import zipfile
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Iterable, Iterator, Mapping, Optional, Sequence

import numpy as np
from scipy.io import loadmat  # type: ignore[import-untyped]


Point2D = tuple[float, float]
Point3D = tuple[float, float, float]


@dataclass(frozen=True)
class Trajectory:
    sample_id: str
    family: str
    label: str
    example_index: int
    points_xyz: tuple[Point3D, ...]


@dataclass(frozen=True)
class NoiseConfig:
    jitter_sigma: float
    dropout_start_probability: float
    max_dropout_frames: int


@dataclass(frozen=True)
class FilterConfig:
    min_cutoff: float
    beta: float
    derivative_cutoff: float


@dataclass(frozen=True)
class AlphaBetaConfig:
    alpha: float
    beta: float
    dropout_velocity_damping: float


FilterCandidate = FilterConfig | AlphaBetaConfig


@dataclass(frozen=True)
class AcceptanceThresholds:
    minimum_error_reduction_ratio: float
    minimum_jitter_reduction_ratio: float
    maximum_position_rmse_ratio: float
    maximum_corner_rmse: float
    minimum_path_length_ratio: float
    maximum_path_length_ratio: float
    maximum_gap_rmse_ratio: float


@dataclass(frozen=True)
class SimulatedMeasurements:
    points: tuple[Optional[Point2D], ...]
    dropout_mask: tuple[bool, ...]
    provenance: str


@dataclass(frozen=True)
class EvaluationMetrics:
    observed_rmse: float
    filtered_rmse: float
    error_reduction_ratio: float
    filtered_path_length_ratio: float
    corner_rmse: float
    gap_rmse_ratio: float
    observed_jitter_rmse: float = 0.0
    filtered_jitter_rmse: float = 0.0
    jitter_reduction_ratio: float = 0.0


@dataclass(frozen=True)
class CandidateEvaluation:
    config: FilterCandidate
    metrics: Mapping[str, float]


def iter_dataset_trajectories(
    archive_path: Path, families: Sequence[str] = ("Numbers", "Shapes")
) -> Iterator[Trajectory]:
    """Yield raw trajectories one row at a time from the dataset's MAT arrays.

    SciPy materializes each coordinate matrix because MATLAB v5 files are not
    row-streamable. The iterator deliberately avoids building a second list of
    all 10,000 variable-length trajectories in memory.
    """

    with zipfile.ZipFile(archive_path) as bundle:
        for requested_family in families:
            family = requested_family.capitalize()
            if family not in {"Numbers", "Shapes"}:
                raise ValueError(f"Unsupported dataset family: {requested_family}")
            prefix = f"{family}/Matlab"
            x = _load_mat_array(bundle, f"{prefix}/X.mat", "X")
            y = _load_mat_array(bundle, f"{prefix}/Y.mat", "Y")
            z = _load_mat_array(bundle, f"{prefix}/Z.mat", "Z")
            labels = _load_mat_array(bundle, f"{prefix}/label.mat", "label").reshape(-1)
            if (
                x.shape != y.shape
                or x.shape != z.shape
                or x.shape[0] != labels.shape[0]
            ):
                raise ValueError(
                    f"Coordinate and label shapes do not align for {family}."
                )
            for row_index in range(x.shape[0]):
                last_non_padding = _last_non_padding_column(
                    x[row_index], y[row_index], z[row_index]
                )
                points = tuple(
                    (
                        float(x[row_index, column]),
                        float(y[row_index, column]),
                        float(z[row_index, column]),
                    )
                    for column in range(last_non_padding)
                )
                if len(points) < 2:
                    continue
                yield Trajectory(
                    sample_id=f"{family.lower()}:{row_index}",
                    family=family.lower(),
                    label=str(int(labels[row_index])),
                    example_index=row_index,
                    points_xyz=points,
                )


def split_for_example(example_index: int) -> str:
    if example_index < 0:
        raise ValueError("Example index must be non-negative.")
    residue = example_index % 10
    if residue <= 5:
        return "train"
    if residue <= 7:
        return "validation"
    return "test"


def synthesize_measurements(
    trajectory: Trajectory, config: NoiseConfig, seed: int
) -> SimulatedMeasurements:
    if config.jitter_sigma < 0:
        raise ValueError("Jitter sigma must be non-negative.")
    if not 0 <= config.dropout_start_probability <= 1:
        raise ValueError("Dropout probability must be between zero and one.")
    if config.max_dropout_frames < 1:
        raise ValueError("Maximum dropout frames must be positive.")
    normalized = normalize_xy(trajectory.points_xyz)
    rng = random.Random(seed)
    points: list[Optional[Point2D]] = [
        (x + rng.gauss(0, config.jitter_sigma), y + rng.gauss(0, config.jitter_sigma))
        for x, y in normalized
    ]
    dropout_mask = [False] * len(points)
    index = 1
    while index < len(points) - 1:
        if rng.random() < config.dropout_start_probability:
            length = rng.randint(1, config.max_dropout_frames)
            for dropped_index in range(index, min(index + length, len(points) - 1)):
                points[dropped_index] = None
                dropout_mask[dropped_index] = True
            index += length
        else:
            index += 1
    return SimulatedMeasurements(
        points=tuple(points),
        dropout_mask=tuple(dropout_mask),
        provenance="synthetic_noise_on_real_raw_trajectory",
    )


def apply_one_euro(
    observed: Sequence[Optional[Point2D]], config: FilterConfig, nominal_hz: float
) -> tuple[Point2D, ...]:
    _validate_filter_config(config)
    if nominal_hz <= 0 or not math.isfinite(nominal_hz):
        raise ValueError("Nominal frequency must be finite and positive.")
    if not observed:
        return ()
    first = next((point for point in observed if point is not None), None)
    if first is None:
        raise ValueError("At least one observed point is required.")
    state_x: Optional[tuple[float, float]] = None
    state_y: Optional[tuple[float, float]] = None
    output: list[Point2D] = []
    dt = 1.0 / nominal_hz
    for point in observed:
        if point is None:
            output.append(output[-1] if output else first)
            continue
        value_x, state_x = _filter_scalar(state_x, point[0], dt, config)
        value_y, state_y = _filter_scalar(state_y, point[1], dt, config)
        output.append((value_x, value_y))
    return tuple(output)


def apply_alpha_beta(
    observed: Sequence[Optional[Point2D]], config: AlphaBetaConfig, nominal_hz: float
) -> tuple[Point2D, ...]:
    if not 0 < config.alpha <= 1:
        raise ValueError("Alpha must be greater than zero and no greater than one.")
    if not 0 <= config.beta <= 1:
        raise ValueError("Beta must be between zero and one.")
    if not 0 <= config.dropout_velocity_damping <= 1:
        raise ValueError("Dropout velocity damping must be between zero and one.")
    if nominal_hz <= 0 or not math.isfinite(nominal_hz):
        raise ValueError("Nominal frequency must be finite and positive.")
    first = next((point for point in observed if point is not None), None)
    if first is None:
        raise ValueError("At least one observed point is required.")
    dt = 1.0 / nominal_hz
    position: Optional[Point2D] = None
    velocity: Point2D = (0.0, 0.0)
    result: list[Point2D] = []
    for measurement in observed:
        if position is None:
            if measurement is None:
                result.append(first)
                continue
            position = measurement
            result.append(position)
            continue
        predicted = (
            position[0] + velocity[0] * dt,
            position[1] + velocity[1] * dt,
        )
        if measurement is None:
            position = predicted
            velocity = (
                velocity[0] * config.dropout_velocity_damping,
                velocity[1] * config.dropout_velocity_damping,
            )
        else:
            residual = (
                measurement[0] - predicted[0],
                measurement[1] - predicted[1],
            )
            position = (
                predicted[0] + config.alpha * residual[0],
                predicted[1] + config.alpha * residual[1],
            )
            velocity = (
                velocity[0] + config.beta * residual[0] / dt,
                velocity[1] + config.beta * residual[1] / dt,
            )
        result.append(position)
    return tuple(result)


def compute_metrics(
    reference: Sequence[Point2D],
    observed: Sequence[Point2D],
    filtered: Sequence[Point2D],
    dropout_mask: Sequence[bool],
) -> EvaluationMetrics:
    if not (len(reference) == len(observed) == len(filtered) == len(dropout_mask)):
        raise ValueError("Metric inputs must have equal lengths.")
    if not reference:
        raise ValueError("Metric inputs must not be empty.")
    observed_rmse = _rmse(reference, observed)
    filtered_rmse = _rmse(reference, filtered)
    error_reduction_ratio = (
        (observed_rmse - filtered_rmse) / observed_rmse if observed_rmse > 0 else 0.0
    )
    reference_length = _path_length(reference)
    filtered_path_length_ratio = (
        _path_length(filtered) / reference_length if reference_length > 0 else 1.0
    )
    corner_indices = _corner_indices(reference)
    corner_rmse = (
        _rmse(
            tuple(reference[index] for index in corner_indices),
            tuple(filtered[index] for index in corner_indices),
        )
        if corner_indices
        else 0.0
    )
    gaps = tuple(index for index, dropped in enumerate(dropout_mask) if dropped)
    if gaps:
        observed_gap_rmse = _rmse(
            tuple(reference[index] for index in gaps),
            tuple(observed[index] for index in gaps),
        )
        filtered_gap_rmse = _rmse(
            tuple(reference[index] for index in gaps),
            tuple(filtered[index] for index in gaps),
        )
        gap_rmse_ratio = (
            filtered_gap_rmse / observed_gap_rmse if observed_gap_rmse > 0 else 1.0
        )
    else:
        gap_rmse_ratio = 1.0
    observed_jitter_rmse = _segment_delta_rmse(reference, observed)
    filtered_jitter_rmse = _segment_delta_rmse(reference, filtered)
    jitter_reduction_ratio = (
        (observed_jitter_rmse - filtered_jitter_rmse) / observed_jitter_rmse
        if observed_jitter_rmse > 0
        else 0.0
    )
    return EvaluationMetrics(
        observed_rmse=observed_rmse,
        filtered_rmse=filtered_rmse,
        error_reduction_ratio=error_reduction_ratio,
        filtered_path_length_ratio=filtered_path_length_ratio,
        corner_rmse=corner_rmse,
        gap_rmse_ratio=gap_rmse_ratio,
        observed_jitter_rmse=observed_jitter_rmse,
        filtered_jitter_rmse=filtered_jitter_rmse,
        jitter_reduction_ratio=jitter_reduction_ratio,
    )


def build_artifact(
    *,
    selected_config: FilterCandidate,
    dataset_sha256: str,
    split_counts: Mapping[str, int],
    test_metrics: Mapping[str, float],
    thresholds: AcceptanceThresholds,
):
    required_metric_names = {
        "error_reduction_ratio",
        "jitter_reduction_ratio",
        "position_rmse_ratio",
        "corner_rmse",
        "filtered_path_length_ratio",
        "gap_rmse_ratio",
    }
    missing = required_metric_names.difference(test_metrics)
    if missing:
        raise ValueError(f"Missing held-out metrics: {', '.join(sorted(missing))}")
    failed: list[str] = []
    if test_metrics["error_reduction_ratio"] < thresholds.minimum_error_reduction_ratio:
        failed.append("error_reduction_ratio")
    if (
        test_metrics["jitter_reduction_ratio"]
        < thresholds.minimum_jitter_reduction_ratio
    ):
        failed.append("jitter_reduction_ratio")
    if test_metrics["position_rmse_ratio"] > thresholds.maximum_position_rmse_ratio:
        failed.append("position_rmse_ratio")
    if test_metrics["corner_rmse"] > thresholds.maximum_corner_rmse:
        failed.append("corner_rmse")
    path_ratio = test_metrics["filtered_path_length_ratio"]
    if (
        not thresholds.minimum_path_length_ratio
        <= path_ratio
        <= thresholds.maximum_path_length_ratio
    ):
        failed.append("filtered_path_length_ratio")
    if test_metrics["gap_rmse_ratio"] > thresholds.maximum_gap_rmse_ratio:
        failed.append("gap_rmse_ratio")
    return {
        "schema_version": "commandcanvas.drawing-filter-tuning/v1",
        "decision": "promoted" if not failed else "refused",
        "production_eligible": not failed,
        "selected_filter": (
            {
                "kind": "one_euro",
                "min_cutoff": selected_config.min_cutoff,
                "beta": selected_config.beta,
                "derivative_cutoff": selected_config.derivative_cutoff,
            }
            if isinstance(selected_config, FilterConfig)
            else {
                "kind": "alpha_beta",
                "alpha": selected_config.alpha,
                "beta": selected_config.beta,
                "dropout_velocity_damping": selected_config.dropout_velocity_damping,
            }
        ),
        "dataset": {
            "name": "In-Air Hand-Drawn Number and Shape Dataset",
            "archive_sha256": dataset_sha256,
            "license": "CC-BY-4.0",
            "split_unit": "example_index_not_subject",
        },
        "split_counts": dict(split_counts),
        "test_metrics": dict(test_metrics),
        "acceptance_thresholds": {
            "minimum_error_reduction_ratio": thresholds.minimum_error_reduction_ratio,
            "minimum_jitter_reduction_ratio": thresholds.minimum_jitter_reduction_ratio,
            "maximum_position_rmse_ratio": thresholds.maximum_position_rmse_ratio,
            "maximum_corner_rmse": thresholds.maximum_corner_rmse,
            "minimum_path_length_ratio": thresholds.minimum_path_length_ratio,
            "maximum_path_length_ratio": thresholds.maximum_path_length_ratio,
            "maximum_gap_rmse_ratio": thresholds.maximum_gap_rmse_ratio,
        },
        "failed_thresholds": failed,
        "limitations": [
            "Noise and dropout corruption are synthetic; they are not captured CommandCanvas camera noise.",
            "The source archive provides no subject identifiers, so holdouts are example-disjoint, not subject-disjoint.",
            "The archive provides coordinate samples without timestamps; evaluation assumes a nominal 30 Hz cadence.",
            "This artifact tunes a causal trajectory filter and does not train hand detection or landmark estimation.",
        ],
    }


def normalize_xy(points_xyz: Sequence[Point3D]) -> tuple[Point2D, ...]:
    if len(points_xyz) < 2:
        raise ValueError("A trajectory must contain at least two points.")
    xs = [point[0] for point in points_xyz]
    ys = [point[1] for point in points_xyz]
    center_x = (min(xs) + max(xs)) / 2
    center_y = (min(ys) + max(ys)) / 2
    diagonal = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
    scale = diagonal if diagonal > 0 else 1.0
    return tuple(
        ((x - center_x) / scale, (y - center_y) / scale) for x, y in zip(xs, ys)
    )


def causal_fill(points: Sequence[Optional[Point2D]]) -> tuple[Point2D, ...]:
    first = next((point for point in points if point is not None), None)
    if first is None:
        raise ValueError("At least one observed point is required.")
    last = first
    result: list[Point2D] = []
    for point in points:
        if point is not None:
            last = point
        result.append(last)
    return tuple(result)


def evaluate_config(
    trajectories: Sequence[Trajectory],
    config: FilterCandidate,
    noise: NoiseConfig,
    *,
    base_seed: int,
    nominal_hz: float,
) -> Mapping[str, float]:
    if not trajectories:
        raise ValueError("At least one trajectory is required for evaluation.")
    evaluations: list[EvaluationMetrics] = []
    clean_distortion: list[EvaluationMetrics] = []
    for trajectory in trajectories:
        seed = _stable_sample_seed(base_seed, trajectory.sample_id)
        simulated = synthesize_measurements(trajectory, noise, seed)
        reference = normalize_xy(trajectory.points_xyz)
        observed = causal_fill(simulated.points)
        filtered = _apply_candidate(simulated.points, config, nominal_hz)
        evaluations.append(
            compute_metrics(reference, observed, filtered, simulated.dropout_mask)
        )
        clean_filtered = _apply_candidate(reference, config, nominal_hz)
        clean_distortion.append(
            compute_metrics(
                reference, reference, clean_filtered, (False,) * len(reference)
            )
        )
    return {
        "observed_rmse": statistics.fmean(value.observed_rmse for value in evaluations),
        "filtered_rmse": statistics.fmean(value.filtered_rmse for value in evaluations),
        "error_reduction_ratio": statistics.fmean(
            value.error_reduction_ratio for value in evaluations
        ),
        "observed_jitter_rmse": statistics.fmean(
            value.observed_jitter_rmse for value in evaluations
        ),
        "filtered_jitter_rmse": statistics.fmean(
            value.filtered_jitter_rmse for value in evaluations
        ),
        "jitter_reduction_ratio": statistics.fmean(
            value.jitter_reduction_ratio for value in evaluations
        ),
        "position_rmse_ratio": statistics.fmean(
            value.filtered_rmse / value.observed_rmse
            if value.observed_rmse > 0
            else 1.0
            for value in evaluations
        ),
        "corner_rmse": statistics.fmean(
            value.corner_rmse for value in clean_distortion
        ),
        "filtered_path_length_ratio": statistics.fmean(
            value.filtered_path_length_ratio for value in clean_distortion
        ),
        "gap_rmse_ratio": statistics.fmean(
            value.gap_rmse_ratio for value in evaluations
        ),
    }


def tune_filter(
    splits: Mapping[str, Sequence[Trajectory]],
    candidates: Sequence[FilterCandidate],
    noise: NoiseConfig,
    *,
    base_seed: int,
    nominal_hz: float,
) -> tuple[FilterCandidate, Mapping[str, Mapping[str, float]]]:
    if not candidates:
        raise ValueError("At least one filter candidate is required.")
    train_results = [
        CandidateEvaluation(
            config=candidate,
            metrics=evaluate_config(
                splits["train"],
                candidate,
                noise,
                base_seed=base_seed,
                nominal_hz=nominal_hz,
            ),
        )
        for candidate in candidates
    ]
    top_train = sorted(
        train_results, key=lambda result: _selection_score(result.metrics)
    )[:8]
    validation_results = [
        CandidateEvaluation(
            config=result.config,
            metrics=evaluate_config(
                splits["validation"],
                result.config,
                noise,
                base_seed=base_seed,
                nominal_hz=nominal_hz,
            ),
        )
        for result in top_train
    ]
    selected = min(
        validation_results, key=lambda result: _selection_score(result.metrics)
    )
    test_metrics = evaluate_config(
        splits["test"],
        selected.config,
        noise,
        base_seed=base_seed,
        nominal_hz=nominal_hz,
    )
    selected_train = next(
        result.metrics for result in train_results if result.config == selected.config
    )
    return selected.config, {
        "train": selected_train,
        "validation": selected.metrics,
        "test": test_metrics,
    }


def load_bounded_splits(
    archive_path: Path, limits: Mapping[str, int]
) -> Mapping[str, tuple[Trajectory, ...]]:
    return select_bounded_splits(iter_dataset_trajectories(archive_path), limits)


def select_bounded_splits(
    trajectories: Iterable[Trajectory], limits: Mapping[str, int]
) -> Mapping[str, tuple[Trajectory, ...]]:
    required_splits = {"train", "validation", "test"}
    if set(limits) != required_splits or any(
        limits[name] <= 0 for name in required_splits
    ):
        raise ValueError("Positive train, validation, and test limits are required.")
    buckets: dict[str, list[Trajectory]] = {"train": [], "validation": [], "test": []}
    family_counts = {
        split: {
            "numbers": (limits[split] + 1) // 2,
            "shapes": limits[split] // 2,
        }
        for split in required_splits
    }
    for trajectory in trajectories:
        if trajectory.family not in {"numbers", "shapes"}:
            continue
        split = split_for_example(trajectory.example_index)
        current_family_count = sum(
            value.family == trajectory.family for value in buckets[split]
        )
        if current_family_count < family_counts[split][trajectory.family]:
            buckets[split].append(trajectory)
        if all(len(buckets[name]) >= limits[name] for name in required_splits):
            break
    if any(len(buckets[name]) < limits[name] for name in required_splits):
        raise ValueError(
            "The dataset did not contain enough examples for the requested split limits."
        )
    return {name: tuple(values) for name, values in buckets.items()}


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Tune a causal drawing trajectory filter."
    )
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--train-limit", type=int, default=240)
    parser.add_argument("--validation-limit", type=int, default=120)
    parser.add_argument("--test-limit", type=int, default=120)
    parser.add_argument("--seed", type=int, default=20260902)
    arguments = parser.parse_args(argv)
    split_limits = {
        "train": arguments.train_limit,
        "validation": arguments.validation_limit,
        "test": arguments.test_limit,
    }
    splits = load_bounded_splits(arguments.archive, split_limits)
    one_euro_candidates: tuple[FilterCandidate, ...] = tuple(
        FilterConfig(min_cutoff, beta, derivative_cutoff)
        for min_cutoff in (1.0, 2.0, 4.0, 8.0, 12.0, 20.0)
        for beta in (0.0, 0.25, 0.5, 1.0, 2.0, 4.0, 8.0)
        for derivative_cutoff in (1.0,)
    )
    alpha_beta_candidates: tuple[FilterCandidate, ...] = tuple(
        AlphaBetaConfig(alpha, beta, damping)
        for alpha in (0.4, 0.5, 0.6, 0.7, 0.8)
        for beta in (0.05, 0.1, 0.2, 0.3)
        for damping in (0.8,)
    )
    candidates = one_euro_candidates + alpha_beta_candidates
    noise = NoiseConfig(
        jitter_sigma=0.012,
        dropout_start_probability=0.015,
        max_dropout_frames=2,
    )
    selected_config, split_metrics = tune_filter(
        splits,
        candidates,
        noise,
        base_seed=arguments.seed,
        nominal_hz=30.0,
    )
    thresholds = AcceptanceThresholds(
        minimum_error_reduction_ratio=-0.10,
        minimum_jitter_reduction_ratio=0.20,
        maximum_position_rmse_ratio=1.10,
        maximum_corner_rmse=0.04,
        minimum_path_length_ratio=0.85,
        maximum_path_length_ratio=1.05,
        maximum_gap_rmse_ratio=1.0,
    )
    artifact = build_artifact(
        selected_config=selected_config,
        dataset_sha256=_sha256(arguments.archive),
        split_counts={name: len(values) for name, values in splits.items()},
        test_metrics=split_metrics["test"],
        thresholds=thresholds,
    )
    artifact["selection"] = {
        "seed": arguments.seed,
        "nominal_hz_assumption": 30.0,
        "synthetic_noise": {
            "jitter_sigma_fraction_of_xy_diagonal": noise.jitter_sigma,
            "dropout_start_probability_per_frame": noise.dropout_start_probability,
            "maximum_dropout_frames": noise.max_dropout_frames,
        },
        "candidate_count": len(candidates),
        "procedure": "rank all candidates on train, choose among the top eight on validation, evaluate test once",
    }
    artifact["split_metrics"] = split_metrics
    arguments.output.parent.mkdir(parents=True, exist_ok=True)
    arguments.output.write_text(
        json.dumps(artifact, indent=2, sort_keys=True, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "decision": artifact["decision"],
                "failed_thresholds": artifact["failed_thresholds"],
                "output": str(arguments.output),
                "selected_filter": artifact["selected_filter"],
                "test_metrics": artifact["test_metrics"],
            },
            sort_keys=True,
        )
    )
    return 0


def _load_mat_array(bundle: zipfile.ZipFile, name: str, key: str) -> np.ndarray:
    try:
        payload = bundle.read(name)
    except KeyError as error:
        raise ValueError(f"Dataset archive is missing {name}.") from error
    values = loadmat(BytesIO(payload))
    if key not in values:
        raise ValueError(f"MAT file {name} does not contain {key}.")
    result = np.asarray(values[key])
    if result.ndim != 2:
        raise ValueError(f"MAT file {name} must contain a two-dimensional array.")
    return result


def _apply_candidate(
    observed: Sequence[Optional[Point2D]],
    config: FilterCandidate,
    nominal_hz: float,
) -> tuple[Point2D, ...]:
    if isinstance(config, FilterConfig):
        return apply_one_euro(observed, config, nominal_hz)
    return apply_alpha_beta(observed, config, nominal_hz)


def _last_non_padding_column(x: np.ndarray, y: np.ndarray, z: np.ndarray) -> int:
    non_padding = np.flatnonzero((x != 0) | (y != 0) | (z != 0))
    return int(non_padding[-1]) + 1 if non_padding.size else 0


def _filter_scalar(
    state: Optional[tuple[float, float]], value: float, dt: float, config: FilterConfig
) -> tuple[float, tuple[float, float]]:
    if state is None:
        return value, (value, 0.0)
    previous_value, previous_derivative = state
    raw_derivative = (value - previous_value) / dt
    derivative = _low_pass(
        raw_derivative,
        previous_derivative,
        _smoothing_factor(dt, config.derivative_cutoff),
    )
    cutoff = config.min_cutoff + config.beta * abs(derivative)
    filtered = _low_pass(value, previous_value, _smoothing_factor(dt, cutoff))
    return filtered, (filtered, derivative)


def _smoothing_factor(dt: float, cutoff: float) -> float:
    tau = 1.0 / (2.0 * math.pi * cutoff)
    return 1.0 / (1.0 + tau / dt)


def _low_pass(value: float, previous: float, alpha: float) -> float:
    return alpha * value + (1.0 - alpha) * previous


def _validate_filter_config(config: FilterConfig) -> None:
    if not math.isfinite(config.min_cutoff) or config.min_cutoff <= 0:
        raise ValueError("Minimum cutoff must be finite and positive.")
    if not math.isfinite(config.beta) or config.beta < 0:
        raise ValueError("Beta must be finite and non-negative.")
    if not math.isfinite(config.derivative_cutoff) or config.derivative_cutoff <= 0:
        raise ValueError("Derivative cutoff must be finite and positive.")


def _rmse(reference: Sequence[Point2D], candidate: Sequence[Point2D]) -> float:
    return math.sqrt(
        statistics.fmean(
            (reference_point[0] - candidate_point[0]) ** 2
            + (reference_point[1] - candidate_point[1]) ** 2
            for reference_point, candidate_point in zip(reference, candidate)
        )
    )


def _path_length(points: Sequence[Point2D]) -> float:
    return sum(
        math.hypot(current[0] - previous[0], current[1] - previous[1])
        for previous, current in zip(points, points[1:])
    )


def _segment_delta_rmse(
    reference: Sequence[Point2D], candidate: Sequence[Point2D]
) -> float:
    if len(reference) < 2:
        return 0.0
    return math.sqrt(
        statistics.fmean(
            (
                (reference[index][0] - reference[index - 1][0])
                - (candidate[index][0] - candidate[index - 1][0])
            )
            ** 2
            + (
                (reference[index][1] - reference[index - 1][1])
                - (candidate[index][1] - candidate[index - 1][1])
            )
            ** 2
            for index in range(1, len(reference))
        )
    )


def _corner_indices(points: Sequence[Point2D]) -> tuple[int, ...]:
    corners: list[int] = []
    for index in range(1, len(points) - 1):
        incoming = (
            points[index][0] - points[index - 1][0],
            points[index][1] - points[index - 1][1],
        )
        outgoing = (
            points[index + 1][0] - points[index][0],
            points[index + 1][1] - points[index][1],
        )
        incoming_length = math.hypot(*incoming)
        outgoing_length = math.hypot(*outgoing)
        if incoming_length <= 1e-9 or outgoing_length <= 1e-9:
            continue
        cosine = max(
            -1.0,
            min(
                1.0,
                (incoming[0] * outgoing[0] + incoming[1] * outgoing[1])
                / (incoming_length * outgoing_length),
            ),
        )
        if math.acos(cosine) >= math.radians(30):
            corners.append(index)
    return tuple(corners)


def _selection_score(metrics: Mapping[str, float]) -> float:
    path_penalty = abs(1.0 - metrics["filtered_path_length_ratio"])
    gap_penalty = max(0.0, metrics["gap_rmse_ratio"] - 1.10)
    position_penalty = max(0.0, metrics["position_rmse_ratio"] - 1.10)
    return (
        -metrics["jitter_reduction_ratio"]
        + 1.5 * metrics["corner_rmse"]
        + 0.25 * path_penalty
        + 0.5 * gap_penalty
        + 2.0 * position_penalty
    )


def _stable_sample_seed(base_seed: int, sample_id: str) -> int:
    digest = hashlib.sha256(f"{base_seed}:{sample_id}".encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
