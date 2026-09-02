# Drawing trajectory filter evaluation

Date: 2026-09-02

## Scope

This is a bounded causal-filter evaluation for index-tip drawing trajectories. It does not train or validate the camera hand detector, landmark estimator, gesture classifier, or physical-camera behavior.

The source data are real Kinect-captured in-air trajectories. Added jitter and short dropouts are deterministic synthetic corruptions. They are not represented as CommandCanvas camera noise.

The archive does not provide subject identifiers. Train, validation, and test are disjoint by example index, not by participant. Each split is balanced equally between the number and shape families.

## Reproduction

Prerequisites: Python 3.10 or newer, NumPy, SciPy, and the separately downloaded source archive whose checksum appears in `DATASET-ATTRIBUTION.md`.

Focused tests:

```bash
python3 -m unittest discover -s scripts/drawing-training -p 'test_*.py' -v
```

Observed result: 12 tests passed, 0 failed.

Bounded tuning and held-out evaluation:

```bash
python3 scripts/drawing-training/trajectory_tuning.py \
  --archive /path/to/InAirNumberShapeDataset.zip \
  --output artifacts/gesture/drawing/in-air-trajectory-filter-tuning-v1.json \
  --train-limit 240 \
  --validation-limit 120 \
  --test-limit 120 \
  --seed 20260902
```

Observed split composition:

| Split | Numbers | Shapes | Total |
| --- | ---: | ---: | ---: |
| Train | 120 | 120 | 240 |
| Validation | 60 | 60 | 120 |
| Test | 60 | 60 | 120 |

No sample ID overlaps between splits.

## Held-out result

Selected causal filter:

```json
{
  "kind": "alpha_beta",
  "alpha": 0.6,
  "beta": 0.2,
  "dropout_velocity_damping": 0.8
}
```

The frozen test split improved most drawing metrics but did not pass the strict short-gap gate:

| Metric | Test result | Gate |
| --- | ---: | ---: |
| Segment-jitter reduction | 35.63% | at least 20% |
| Position RMSE ratio | 1.0162 | no more than 1.10 |
| Corner RMSE | 0.0127 | no more than 0.04 |
| Clean path-length ratio | 1.0074 | 0.85–1.05 |
| Short-gap RMSE ratio | 1.0126 | no more than 1.00 |

The configuration is therefore marked `refused` and `production_eligible: false`. It is not a justified runtime default. The complete machine-readable result, thresholds, provenance, and limitations are in `in-air-trajectory-filter-tuning-v1.json`.

## Compute decision

This bounded scalar grid search completed on CPU in roughly 9–15 seconds across warm and cold archive reads, with under 100 MB peak resident memory. CUDA was intentionally not used because data transfer and kernel setup would not improve this workload. GPU compute remains appropriate for the separate hand detector and landmark inference path.
