# Task 1 Report — Landmark Contract, Pointer Semantics, and Adaptive Filtering

## Scope completed

Implemented the physical hand-measurement foundation without changing detector adapters or engine selection.

- Added a normalized landmark contract with focused types for source, capture/receive timestamps, track ID, handedness, ROI, prediction marker, confidence, and the fixed raw 21-point landmark tuple.
- Added independent measurements for index tip, thumb tip, pinch midpoint, palm/MCP centroid, palm scale, palm-scale-normalized pinch ratio, and hand/keypoint confidence.
- Kept the visible pointer tied to the filtered index fingertip for pointing, pinch, relaxed, and open-palm samples. Open-palm remains a semantic mode but no longer redirects the pointer to the palm centroid.
- Replaced the position EMA with pure timestamp-aware One Euro scalar/2D filter primitives. Defaults are `minCutoff=1.0`, `beta=0.007`, and `dCutoff=1.0`.
- Added a prediction marker to the transition contract. A predicted frame is explicitly refused with `predicted_sample`, retains its prior semantic/filter state, and cannot trigger a gesture transition.
- Preserved public observation compatibility by making the newly surfaced physical metadata additive/optional on `HandTrackingObservation`; its established `mode`, `pointer`, `confidence`, landmarks, pinch fields, and timestamp remain available.
- Wired capture/receive timestamp, engine ID, stable track key, prediction marker, and physical measurements through the controller for downstream tasks.

Deferred intentionally: calibration, temporal pinch voting, loss/reacquire policy changes, sticky targeting, room/UI behavior, scheduling/engine selection changes, and RTMPose work. YOLO remains the default engine and was not altered.

## Files changed

- `lib/gesture/hand-landmark-contract.ts` — raw hand sample contract and pure physical measurement derivation.
- `lib/gesture/one-euro-filter.ts` — pure scalar and 2D One Euro filters.
- `lib/gesture/hand-intent.ts` — applies physical measurement derivation, One Euro state, relaxed index-pointer behavior, and predicted-sample refusal.
- `lib/gesture/hand-tracking-controller.ts` — carries additive physical metadata into public tracked observations.
- `lib/gesture/hand-intent.test.ts` — regression coverage for relaxed pointer availability, open-palm index coordinates, separated measurements, prediction refusal, and timestamp-aware filtering.
- `lib/gesture/hand-tracking-controller.test.ts` — controller-level assertion for source, timestamps, track ID, prediction marker, and measurements.
- `lib/gesture/one-euro-filter.test.ts` — multi-step scalar reference vector that distinguishes the raw-previous and filtered-previous derivative recurrences.

## TDD evidence

All commands used Node `v22.14.0` with `TMPDIR=/tmp`, `TEMP=/tmp`, and `TMP=/tmp`.

### RED — hand intent behavior

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-intent.test.ts
```

Expected failure observed before reducer/filter production changes:

```text
Test Files  1 failed (1)
Tests  8 failed | 16 passed (24)
```

The failures established the required deltas: open-palm pointer was the palm center (`0.59, 0.718`) rather than the index tip (`0.5, 0.25`); relaxed valid-index data was refused as idle; no separate measurements were exposed; predicted input was accepted; and EMA output was `0.57` rather than the timestamp-aware One Euro expectation near `0.3277`.

### GREEN — hand intent behavior

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-intent.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests  24 passed (24)
```

### RED — controller metadata propagation

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-tracking-controller.test.ts
```

Expected failure observed before controller production changes:

```text
Test Files  1 failed (1)
Tests  1 failed | 24 passed (25)
```

The verified observation lacked `capturedAt`, `receivedAt`, `source`, `trackId`, `prediction`, and `measurements`.

### GREEN — controller metadata propagation

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-intent.test.ts lib/gesture/hand-tracking-controller.test.ts lib/gesture/hand-tracking-worker-core.test.ts
```

Output:

```text
Test Files  3 passed (3)
Tests  53 passed (53)
```

## Follow-up review fixes

### RED — confidence gating and predicted-state retention

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-intent.test.ts lib/gesture/one-euro-filter.test.ts
```

Expected failure observed before the follow-up reducer change:

```text
Test Files  1 failed | 1 passed (2)
Tests  3 failed | 25 passed (28)
```

The failures proved that predicted input reset a latched reducer, an unreliable thumb released a latched pinch, and low-confidence non-index fingertips still produced `open_palm`.

### GREEN — confidence gating and predicted-state retention

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-intent.test.ts lib/gesture/one-euro-filter.test.ts
```

Output:

```text
Test Files  2 passed (2)
Tests  28 passed (28)
```

The reducer now retains a latched pinch when the thumb becomes unreliable while still rendering an adequate index pointer; requires reliable index, middle, ring, and little fingertips for `open_palm`; and returns the exact prior reducer state for a predicted sample.

### One Euro reference conclusion

No One Euro production correction was required. The primary paper's Appendix Algorithm 1 computes `dx` from `xfilt.hatxprev`, and Algorithm 2 defines that value as the previous filtered result, not the previous raw input: [Casiez, Roussel, and Vogel (2012), Appendix A](https://direction.bordeaux.inria.fr/~roussel/publications/2012-CHI-one-euro-filter.pdf). The maintained canonical C++ source is consistent and explicitly says its August 2023 correction uses `lastFilteredValue`: [OneEuroFilter.cpp](https://chromium.googlesource.com/chromium/src/%2B/141.0.7390.54/third_party/one_euro_filter/src/OneEuroFilter.cpp).

The committed multi-step vector uses values `0 → 1 → 0.5` at `0/16/32ms` with `{ minCutoff: 1, beta: 0.5, dCutoff: 1 }`. The canonical filtered-previous recurrence yields `0.345071` at the third sample; a raw-previous recurrence yields `0.318759`, so the test detects either implementation. The present filter matches the canonical value; no prior-raw state was added.

## Verification

Focused detector-adapter verification:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-tracking-controller.test.ts lib/gesture/hand-tracking-worker-core.test.ts lib/gesture/mediapipe-hand-detector.test.ts lib/gesture/yolo-hand-pose-detector.test.ts
```

```text
Test Files  4 passed (4)
Tests  41 passed (41)
```

Static checks:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm run lint
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm run typecheck
```

Both commands exited `0` with no diagnostics.

Full unit suite (run once after the implementation):

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test
```

```text
Test Files  96 passed (96)
Tests  942 passed (942)
```

## Self-review

- The index coordinate is selected independently of semantic mode; open palm is classified but never changes `pointer` away from landmark 8.
- Pinch geometry remains raw-current geometry, so One Euro filtering does not alter engage/release hysteresis inputs.
- Predicted samples are carried as marked contract data and rejected without mutating prior state/filter data; they cannot participate in semantic transitions.
- A low-confidence thumb cannot release an existing pinch latch, while an adequate index remains renderable. `open_palm` requires reliable extended finger tips rather than geometry alone.
- The One Euro implementation tracks values, derivative, and timestamps as reducer state. Its filtered-previous derivative recurrence is covered by a reference vector matching the paper appendix and maintained canonical source.
- Existing MediaPipe and YOLO detector result shapes are unchanged. Added controller observation fields are optional and additive.
- `git diff --check`, lint, typecheck, focused tests, detector-adapter tests, and the full unit suite are clean.

## Evidence boundaries

VERIFIED: unit-level contract, timestamp arithmetic, controller propagation, typechecking, linting, and all current unit tests.

UNVERIFIED PHYSICAL: real-camera smoothness, per-device latency, and target-browser motion quality. Those require the later browser/device evidence task and were not represented as verified here.
