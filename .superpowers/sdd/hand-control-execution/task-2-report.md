# Task 2 Report — Calibration, pinch voting, identity, and loss grace

## Scope completed

Task 2 adds a pure interaction-layer reliability boundary in
`lib/gesture/hand-calibration.ts`. It does not acquire canvas objects,
interpret edge zones, dispatch canonical commands, open UI, or alter detector
adapters/public observations.

- `HandCalibrationProfile` contains the device key, camera bounds, 24 CSS-pixel
  canvas safe inset, calibrated closed/open pinch ratios, mirror flag, and
  creation timestamp.
- Calibration derives the fifth/ninety-fifth percentile bounds, expands each
  side by 5%, accepts pre-expansion spans from 45% through 80% horizontally and
  85% vertically, and returns an explicit refusal plus fallback profile when
  the reach is implausible. The fallback camera region is `x=0.15..0.85` and
  `y=0.12..0.88`.
- The mapper sends the comfortable region over the canvas interior with a 24px
  inset and a smoothstep edge curve. Gain is 1.5 for hover, 1.25 for target,
  1.1 for held/draw, and 1.0 for two-hand work.
- Thresholds derive from calibration as `closed + .25 * (open - closed)` and
  `closed + .60 * (open - closed)`; missing/invalid calibration returns the
  required 0.38 engage / 0.52 release fallback. A two-of-three, 100ms
  confident-frame voter generates only `engaged`/`released` transitions.
- The reliability reducer makes stable `trackId`, per-hand real/predicted,
  confidence, per-hand tracking state, per-track last-valid times, active loss
  time, pinch vote, and safe-release provenance available to later work. It
  explicitly retains a pinched latch through 120ms uncertainty, exposes
  `reacquire` at 150ms, resumes only within 300ms and 120 CSS pixels, and
  otherwise releases at the last valid point.
- `edgeAction` is typed and emitted as `null` for every reliability result.
  Tracking loss cannot become minimize, maximize, discard, throw, approval, or
  another edge/canonical action. Task 3 remains the only owner of edge policy.

## Changed files

- `lib/gesture/hand-calibration.ts` — calibration profile/builder, safe mapping,
  calibrated temporal pinch voter, and additive hand reliability snapshot.
- `lib/gesture/hand-calibration.test.ts` — calibration acceptance/refusal,
  all nine viewport regions, gain states, threshold fallback, two-of-three
  voting, uncertainty latch, track identity, loss/reacquire, safe release, and
  no-edge-action coverage.
- `.superpowers/sdd/hand-control-execution/task-2-report.md` — this report.

## TDD evidence

All commands used Node `v22.14.0` with `TMPDIR=/tmp`, `TEMP=/tmp`, and
`TMP=/tmp`.

### RED — calibration and mapping contract

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-calibration.test.ts
```

Expected RED observed before any Task 2 production module existed:

```text
Test Files  1 failed (1)
Tests  no tests
Error: Failed to resolve import "@/lib/gesture/hand-calibration"
```

The test declared the required profile, fallback, and nine-region mapper
behavior; the unresolved import was the expected absence of the new module.

### GREEN — calibration and mapping contract

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-calibration.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests  11 passed (11)
```

### RED — calibrated temporal pinch voter

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-calibration.test.ts
```

Output before the voter was added:

```text
Test Files  1 failed (1)
Tests  2 failed | 11 passed (13)
TypeError: resolvePinchThresholds is not a function
TypeError: createInitialPinchVoteState is not a function
```

### GREEN — calibrated temporal pinch voter

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-calibration.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests  13 passed (13)
```

### RED — identity, loss, and safe-release snapshot

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-calibration.test.ts
```

Output before the reliability reducer was added:

```text
Test Files  1 failed (1)
Tests  4 failed | 13 passed (17)
TypeError: createInitialHandReliabilityState is not a function
```

The four failures covered label-flip/second-hand identity, uncertainty plus
reacquire, timeout release at the last valid point, and a near-time but
121-pixel-distant return.

### GREEN — identity, loss, and safe-release snapshot

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-calibration.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests  17 passed (17)
```

The first implementation attempt also exposed one focused failing assertion
(`pinched: false` rather than `true`) because the reliability adapter had not
passed the frame timestamp into the voter. Passing the timestamp was the
minimal correction; the same focused test then went green.

### Final focused coverage

Command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/hand-calibration.test.ts
```

Output:

```text
Test Files  1 passed (1)
Tests  19 passed (19)
```

The final two assertions add the maximum-span refusal, all required gain
states, and the exact no-calibration pinch fallback.

## Design decisions

- The new module is intentionally pure and reducer-oriented. Its state is
  serializable and testable without a browser, camera, canvas store, DOM event,
  or external service.
- Percentiles use sorted linear interpolation. Span acceptance happens before
  the 5% edge expansion so an otherwise valid comfortable trace is not
  rejected merely for adding the requested ergonomic padding.
- Invalid/missing pinch sample sets do not invalidate a usable reach profile;
  they use the conservative fallback closed/open pair (0.28/0.68), which
  derives the mandatory 0.38/0.52 operational thresholds.
- Identity is selected and retained by detector `trackId`. Handedness stays in
  the snapshot as evidence but is never used as the continuity key, so a
  mirrored-label flip or reordered second hand cannot steal the active hand.
- `HandReliabilitySnapshot` is additive and intentionally has no object ID,
  edge-zone, throw, mutation, receipt, or UI field. Its `edgeAction: null`
  invariant gives Task 3 sufficient reliable-loss provenance while retaining
  sole ownership of acquisition and edge policy there.
- Existing `HandTrackingObservation`, Task 1 measurement/filter primitives,
  detector adapters, controller behavior, spatial reducer, and canonical
  mutation paths were not changed.

## Verification

Focused tests, static checks, and the full suite were run after the final
coverage additions.

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm run typecheck
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm run lint
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test
```

Results:

```text
npm run typecheck: exit 0, no diagnostics
npm run lint: exit 0, no diagnostics
Test Files  98 passed (98)
Tests  983 passed (983)
```

`git diff --no-index --check /dev/null lib/gesture/hand-calibration.ts` and
the corresponding test-file check also exited 0 with no whitespace errors.

## Commit

Implementation commit:

```text
b2e29d12ddd5e3f1bc229da78166906a00af7498 Add calibrated hand reliability primitives
Author: Daniel Romitelli <danny.romitelli@gmail.com>
Committer: Daniel Romitelli <danny.romitelli@gmail.com>
```

This report is committed immediately afterward as a separate documentation
commit so the report can record the immutable implementation commit hash.

## Concerns and evidence boundary

- VERIFIED: deterministic percentile calibration/refusal, safe mapping,
  calibrated threshold derivation, temporal voting, active-track continuity,
  per-hand provenance, 120/150/300ms loss behavior, 120px reacquire refusal,
  safe last-point release, and the no-edge-action invariant.
- UNVERIFIED PHYSICAL: real camera reach ergonomics, device-specific pinch
  ratios, detector track-ID continuity under real occlusion/crossing, and
  target-browser motion quality. Unit tests do not establish physical hand
  performance.
- DEFERRED BY SCOPE: Task 3 consumes the snapshot to govern acquisition,
  transforms, and edge actions; Task 4 handles UI/state display and calibration
  collection flow. Neither is implemented or wired in this task.
