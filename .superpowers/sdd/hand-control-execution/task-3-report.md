# Task 3 Report: authoritative spatial gesture state machine

## Outcome

`DONE_WITH_CONCERNS`

Task 3 now owns a pure authoritative spatial reducer for sticky targeting,
one-hand ownership, stable two-hand upgrade and complete transforms, loss
grace, edge-action eligibility, and typed completion effects. The focused
reducer and canonical-command suites pass, typecheck and lint pass, and the
implementation is committed as
`b08334d74a8b532a3de4321f52c0a9e53fa7351c`.

The full suite is not green before Task 4: 10 existing room tests still send
the legacy input shape, assume immediate acquisition, and consume the legacy
move/resize/stage effects. Task 3 intentionally did not edit the Task 4-owned
room, component tests, or CSS. The production build also remains unverified in
this sibling worktree because Next/Turbopack rejects the out-of-root
`node_modules` symlink; the Webpack fallback then failed inside Next while
parsing TypeScript configuration even though direct `tsc --showConfig` and the
repository typecheck both succeed.

## Scope completed

- Added the authoritative operational phases `idle`, `hover`,
  `pinch_pending`, `held_one`, `two_hand_pending`, `transforming_two`,
  `drawing`, `panning`, `edge_action_armed`, and `lost_grace`.
- Added a point-to-rotated-rectangle magnetic candidate with a radius of
  `clamp(28px, 4% of the shorter viewport dimension, 56px)`, a 100 ms stable
  dwell, a 12 px contender advantage, an 80 ms contender dwell, and 12 px exit
  hysteresis.
- Latched the reducer-owned candidate at pinch. Held ownership uses the Task 2
  `trackId` and cannot retarget before release.
- Captured the stable motion point separately from the index targeting point.
  One-hand movement is computed from motion-point displacement against the
  captured baseline, so index/thumb closure does not move the object at grab.
- Removed the reducer's neutral-pose wait. A tracked Task 2 release emits at
  most one completion effect and immediately returns to normal hover
  acquisition.
- Added a 100 ms stable second-hand gate. The original owner remains
  authoritative, and the second pinched hand must remain within 72 CSS pixels
  of the held object.
- Added a complete two-hand baseline and preview: centroid translation,
  log-space scale smoothing, exact scale bounds 0.25 through 4.0, angle
  rotation, and a 4.5 degree rotation deadband.
- Added asymmetric `lost_grace`. A transient one-hand dropout during a
  two-hand transform freezes completion and can resume the same two track IDs
  within 300 ms. Predicted, low-confidence, and loss evidence clear edge
  eligibility and its motion evidence.
- Added typed ephemeral `object.preview_transform` and
  `object.preview_edge_action` effects. One intentional release emits exactly
  one `object.complete_transform` or `object.complete_edge_action`; no preview
  maps to a durable command.
- Added distinct 64 CSS-pixel top, bottom, and side zones. Top and bottom
  require 100 ms slow placement at no more than 400 CSS px/s. A side throw
  requires speed strictly above 800 CSS px/s over an 80-120 ms sample window,
  outward direction cosine at least 0.85, three latest real tracked samples at
  confidence at least 0.80, presentation acknowledgement that the armed
  preview was visible, and tracked release within 120 ms.
- Added `spatialGestureCompletionToCommand`. It maps transform/maximize to the
  canonical `object.transform`, minimize to canonical `object.set_flags`, and
  discard to canonical `object.discard`. It does not create a hand-specific
  history or receipt.
- Preserved blank-canvas two-hand zoom as non-durable navigation under the
  authoritative `panning` phase.
- Preserved hand sketch command construction. Drawing mode gives point input
  precedence, and open palm ends the active stroke without adding a palm point
  or panning.

## Task 2 boundary consumed

Task 3 imports only Task 2's `HandReliabilityTrackingState` and accepts an
additive `SpatialReliabilityEvidence` shape containing `trackId`, `real`,
`predicted`, `confidence`, and `trackingState`. It consumes the already-voted
semantic input mode and stable track IDs. It does not implement detector
selection, identity matching, pinch ratios, calibration thresholds, temporal
pinch voting, or Task 2 reacquisition policy.

Inputs without additive reliability evidence remain structurally accepted so
the Task 4-owned room compiles during the landing sequence, but they cannot
qualify an edge action. Deprecated legacy phase and effect variants also
remain in the exported unions only as compile-time Task 4 migration shims; the
authoritative reducer does not emit those operational phases or durable-effect
variants.

## Changed files

- `lib/gesture/spatial-gesture.ts`
  - authoritative reducer state, inputs, effects, candidate/hold/transform/loss
    state, edge policy, completion-to-command mapping, and retained geometry
    and sketch helpers.
- `lib/gesture/spatial-gesture-recovery.test.ts`
  - Task 3 RED/GREEN contract suite, including the real canonical command
    engine and exact Undo restoration.
- `lib/gesture/spatial-gesture.test.ts`
  - retained non-superseded geometry and fallback tests: calibrated active-zone
    mapping, rotated/z-ordered targeting, blank-canvas zoom, and sketch command
    construction. Legacy assertions for immediate grab, resize-only
    bimanual work, permissive edge staging, palm object commands, and neutral
    waiting were removed because the binding Task 3 contract replaces them.

No room component, room test, CSS, detector, Task 2 reliability module,
canonical command engine, object model, store, deployment, credential,
external service, or infrastructure file was changed.

## TDD evidence

All commands used Node `v22.14.0` with `TMPDIR=/tmp`, `TEMP=/tmp`, and
`TMP=/tmp`.

### RED: authoritative reducer and command contract

The Task 3 tests were written before the production reducer replacement. The
initial run found 12 expected failures. The throw-gate cases were then
strengthened so each had a valid positive control and could not pass
vacuously; the final pre-production RED was:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/spatial-gesture-recovery.test.ts
```

```text
Test Files  1 failed (1)
Tests  18 failed | 2 passed (20)
```

Representative expected failures were:

```text
expected undefined to be null                         # no candidate state
expected phase grabbing to match phase held_one       # legacy phase
expected awaiting_neutral not to be awaiting_neutral  # release re-arm absent
expected resizing to be held_one                      # immediate second hand
expected transform preview, received undefined        # resize-only legacy path
expected lost_grace, received awaiting_neutral        # premature dropout commit
expected object.complete_edge_action maximize          # no top action
expected armed object.preview_edge_action              # throw gates absent
expected validated discard completion                 # no typed completion
```

The two already-green behaviors were retained drawing pen-up precedence and
blank-canvas open-palm pan precedence; those did not require a production
behavior change.

### GREEN: authoritative reducer suite

First complete GREEN after implementation and correction of local null guards,
minimum transform-span handling, and invalid-history clearing:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/spatial-gesture-recovery.test.ts
```

```text
Test Files  1 passed (1)
Tests  20 passed (20)
```

The final focused suite adds exact radius regimes, pinch-pending refusal, the
121 ms throw-window refusal, exact 800 px/s refusal, confidence 0.80
acceptance, and a direction cosine just above 0.85:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/spatial-gesture.test.ts lib/gesture/spatial-gesture-recovery.test.ts
```

```text
Test Files  2 passed (2)
Tests  25 passed (25)
```

## Required behavior coverage

| Requirement | Direct evidence |
|---|---|
| Magnetic radius, dwell, contender | Tests all three radius regimes (28 px minimum, 4% middle, 56 px maximum), 99/100 ms dwell boundary, early `pinch_pending`, 12 px advantage, and 79/80 ms contender boundary. |
| Stable latch and no retarget | A stable `note-a` candidate remains owned while the pinched pointer moves over `note-b`; no selection effect for `note-b` is emitted. |
| No grab jump | Index target changes during closure while the motion point remains fixed; the first complete transform preview exactly equals the original object transform. |
| Release re-arm | A tracked point release emits one completion and returns directly to hover, never `awaiting_neutral`. |
| Drawing precedence | Point samples create ink; open palm commits only the existing stroke, adds no palm point, and emits no pan. |
| Stable second-hand upgrade | A far hand is ignored; a near stable track remains pending at 99 ms and upgrades at 100 ms without changing the owner. |
| Complete two-hand transform | Tests centroid translation, 4.5 degree rotation deadband, rotation above the deadband, exact 0.25/4.0 clamps, and log-space smoothing for in-range scale. |
| Asymmetric loss and one completion | Single-pinched-hand dropout enters `lost_grace` without completion, the same track pair resumes, one tracked release emits one completion, and later frames emit none. |
| Top/bottom/side separation | Slow top completes maximize, slow bottom completes minimize, and valid fast left movement completes discard with distinct typed effects. |
| Every throw gate | Tests fail-zone 65 px versus chosen 64 px zone, 800 px/s exact refusal, valid greater-than-800 speed, 70 ms and 121 ms window refusal, valid 100 ms window, bad direction, just-above-0.85 direction, 0.79 confidence refusal, 0.80 acceptance, preview acknowledgement, 120/121 ms release boundary, and tracked release. |
| Unsafe cancellation | Predicted, low-confidence, and loss evidence each enter `lost_grace`, clear edge eligibility/history, and cannot complete discard on the following release. |
| Open-palm pan precedence | Blank canvas pans; drawing, held, transforming, and edge-owned states do not pan. |
| Canonical soft discard and Undo | A real reducer completion maps to `object.discard`; the command engine creates one discard receipt; shared `history.undo` restores the exact object including x/y, rotation, z-index, parent membership, metadata, version, and `deletedAt`. |

## Static checks

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm run typecheck
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm run lint
git diff --check
```

Results:

```text
npm run typecheck: exit 0, no diagnostics
npm run lint: exit 0, no diagnostics
git diff --check: exit 0, no whitespace errors
```

## Full-suite status and Task 4 boundary

Fresh full-suite command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- --reporter=dot
```

Result:

```text
Test Files  2 failed | 97 passed (99)
Tests  10 failed | 978 passed (988)
```

All failures are confined to the two Task 4-owned room suites:

- `components/command-canvas/command-canvas-room-hand-navigation.test.tsx`
  - legacy `CANVAS ZOOM` phase label;
  - immediate-grab `is-held` expectation;
  - legacy reducer `stagedExitAction`/edge DOM expectation.
- `components/command-canvas/command-canvas-room.test.tsx`
  - immediate `HELD` and point-to-pinch acquisition expectations;
  - legacy `object.commit_move`, `object.commit_resize`, and
    `object.stage_action` consumption;
  - legacy permissive throw/minimize timing;
  - removed open-palm object restore dwell;
  - immediate two-hand resize rather than stable held-object upgrade.

These are not hidden or labeled green. Task 4 must combine the Task 2
reliability snapshot with physical pointers, acknowledge visible edge previews,
render new phases/effects, and map exactly one completion effect through
`spatialGestureCompletionToCommand`. Editing those tests or the room in Task 3
would cross the explicit ownership boundary.

## Build status

Default production build:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm run build
```

The hand-worker prebuild succeeded, then Next/Turbopack failed before compiling
the application:

```text
public/workers/yolo-hand-pose.js   850.7kb
public/workers/hand-landmarker.js  152.4kb
Done in 104ms
FATAL: Symlink [project]/node_modules is invalid, it points out of the filesystem root
```

The non-mutating Webpack fallback was also attempted:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm exec -- next build --webpack
```

It failed inside Next before compilation:

```text
Error: Could not parse output from TypeScript's --showConfig.
```

Direct `./node_modules/.bin/tsc --showConfig` returned valid JSON, and
`npm run typecheck` is green. No dependency or worktree-symlink mutation was
made to bypass this environmental build boundary.

## Commit and diff checks

Implementation commit:

```text
b08334d74a8b532a3de4321f52c0a9e53fa7351c
Author: Daniel Romitelli <danny.romitelli@gmail.com>
Committer: Daniel Romitelli <danny.romitelli@gmail.com>
Subject: Add authoritative spatial gesture state machine
```

The report is committed separately immediately after this file is written so
the report can name the immutable implementation commit.

Only the three reducer/test files were present in the implementation commit.
No deploy, push, merge, credential access, external service call, billable
action, or infrastructure mutation occurred.

## Evidence boundary and concerns

- VERIFIED: deterministic reducer phases, target geometry and timing,
  ownership latch, no-jump baseline, tracked release re-arm, drawing pen-up,
  second-hand timing/proximity, centroid/scale/rotation transform, asymmetric
  loss freeze/resume, one completion effect, edge separation, every deliberate
  throw gate, unsafe cancellation, open-palm pan precedence, canonical command
  mapping, and exact command-engine Undo restoration.
- VERIFIED STATIC: TypeScript and ESLint pass for the repository.
- NOT GREEN: 10 Task 4 room integration tests remain on the old adapter/effect
  contract. The full repository suite is therefore not claimed green at this
  Task 3 commit.
- UNVERIFIED BUILD: the worktree symlink prevents the default Turbopack build;
  the Webpack fallback also failed inside Next before application compilation.
- UNVERIFIED PHYSICAL: real-camera targeting success, actual 100 ms ergonomic
  dwell, motion jitter, real second-hand crossing/dropout, real throw success
  and false-positive rates, visual preview acknowledgement, browser render
  cadence, RTX behavior, and mobile behavior require Task 4/7 browser and
  physical-device evidence. Deterministic unit tests do not establish those
  claims.
- DEFERRED BY SCOPE: React room wiring, calibration overlay/PiP, visual
  interpolation, new edge-zone presentation, completion consumption, and
  drawing presentation remain Task 4 work.

## Independent review fix round 1 — 2026-08-29

### Outcome

`DONE_WITH_CONCERNS`

The four Important findings from independent review were reproduced with real
reducer and command-engine tests, then fixed in implementation commit
`9aea7dafad589ebd2314dcfea0eb118d81f927c3`.

### Changes made

- Pinch-pending ownership is immutable. A different track cannot finish the
  owner's acquisition dwell.
- Every single-hand input to an owned object is checked against
  `held.ownerTrackId` before safety, movement, release, motion-history, or edge
  evaluation. This includes `lost_grace`; a trusted non-owner cannot finalize
  another hand's frozen transform. The only second-track admission path remains
  the explicit stable `bimanual_pinch` gate.
- Two-hand baseline and update geometry are ordered by the stored
  `ownerTrackId` and `secondTrackId`, independent of detector array order. A
  missing or replacement stored second track enters `lost_grace` and emits no
  transform preview.
- Captured object transforms are canonicalized before the first preview.
  Width is bounded to 160 through 2,000, height to 80 through 1,400, and
  rotation to -180 through 180.
- Uniform two-hand scaling intersects the relative 0.25 through 4.0 range with
  the absolute object bounds. For example, a 200 by 120 object bottoms out at
  160 by 96 rather than the schema-invalid 50 by 30. A 1,000 by 800 object
  tops out at 1,750 by 1,400, preserving its aspect ratio.
- The composed two-hand rotation is normalized after adding the baseline
  rotation. Maximize captures the viewport-derived world origin but clamps its
  dimensions to the same canonical object bounds.
- A changed transform frozen in `lost_grace` now emits exactly one
  `object.complete_transform` on terminal safe release or grace expiry. Edge
  eligibility and motion history are cleared before finalization, so loss
  cannot complete maximize, minimize, or discard. Reset ownership prevents a
  later terminal frame from duplicating the completion.

### Task 2 and Task 4 boundary

Task 2 remains the authority for stable track identity, confidence,
real/predicted provenance, pinch voting, loss, and safe-release provenance.
Task 3 consumes those fields and owns only spatial authorization and effects.

The Task 4 adapter is responsible for mapping a terminal Task 2 release to the
existing explicit reducer input `{ mode: "idle", reason: "release", timestamp }`.
Loss remains `{ mode: "idle", reason: "loss", timestamp }`. Task 3 does not
infer track identity from detector array position and does not edit the room,
adapter, presentation, CSS, or React tests in this fix round.

### Strict TDD evidence

Every behavior below was added to
`lib/gesture/spatial-gesture-recovery.test.ts` before its production change.
All focused commands used Node `v22.14.0`:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/spatial-gesture-recovery.test.ts
```

Owner authorization RED:

```text
Test Files  1 failed (1)
Tests  4 failed | 21 passed (25)
```

The four failures showed `hand-b` completing `hand-a`'s pending acquisition,
moving its object, releasing it, and arming a side throw. After the owner gate:

```text
Test Files  1 passed (1)
Tests  25 passed (25)
```

Stored two-hand identity RED:

```text
Test Files  1 failed (1)
Tests  2 failed | 25 passed (27)
```

Reversing the input array changed rotation from `18.530766` to
`-161.469234`, and replacing stored `hand-b` with `hand-c` incorrectly stayed
in `transforming_two`. After ID-ordered geometry and replacement refusal:

```text
Test Files  1 passed (1)
Tests  27 passed (27)
```

Canonical transform RED was deliberately advanced one boundary at a time:

```text
Tests  2 failed | 26 passed (28)  # 50x30 minimum and command boundary
Tests  1 failed | 27 passed (28)  # 4000x3200 maximum
Tests  1 failed | 27 passed (28)  # 191.801409-degree rotation
Tests  1 failed | 27 passed (28)  # 6000x4000 maximize
```

The rotation expectation was corrected before production work from a
normalized-coordinate estimate to the hand-derived 1,000 by 600 world-space
angle: approximately `-168.20` degrees. The maximize fixture was likewise
relocated into its zoomed viewport before accepting the intended 6,000 by
4,000 RED. After all canonical constraints:

```text
Test Files  1 passed (1)
Tests  28 passed (28)
```

Terminal loss finalization RED:

```text
Test Files  1 failed (1)
Tests  2 failed | 28 passed (30)
```

Terminal safe release emitted no completion; expiry emitted only
`preview.clear`. After the common loss finalizer:

```text
Test Files  1 passed (1)
Tests  30 passed (30)
```

Two additional defense-in-depth cycles were then run. A trusted non-owner
could finalize the owner's loss-grace transform:

```text
Test Files  1 failed (1)
Tests  1 failed | 30 passed (31)

Test Files  1 passed (1)
Tests  31 passed (31)
```

A stale undersized, 540-degree object emitted an invalid acquisition preview:

```text
Test Files  1 failed (1)
Tests  1 failed | 31 passed (32)

Test Files  1 passed (1)
Tests  32 passed (32)
```

### Real command-engine coverage

Reducer-generated minimum-size, maximum-size, rotated, minimize, maximize, and
discard completions are mapped with `spatialGestureCompletionToCommand` and
passed to the real `applyCanvasCommand`. The tests do not mock schema parsing or
command application. Minimum, maximum, rotation, minimize, and maximize all
return `ok: true`; the original discard test still proves exact shared Undo
restoration.

### Final verification

Focused reducer command:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- lib/gesture/spatial-gesture.test.ts lib/gesture/spatial-gesture-recovery.test.ts
```

Fresh result immediately before commit:

```text
Test Files  2 passed (2)
Tests  36 passed (36)
```

Lint:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm run lint
```

```text
exit 0, no diagnostics
```

Scoped staged diff:

```bash
git diff --cached --check
git diff --cached --name-only
```

```text
exit 0, no whitespace errors
lib/gesture/spatial-gesture-recovery.test.ts
lib/gesture/spatial-gesture.ts
```

Full repository typecheck was run after correcting the only Task 3 fixture
diagnostic (`amber` was replaced with canonical note tone `coral`):

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm run typecheck
```

It remained blocked by a concurrent, untracked Resend lane outside Task 3:

```text
lib/resend/webhook.test.ts(8,8): error TS2307: Cannot find module '@/lib/resend/webhook' or its corresponding type declarations.
```

No Task 3 diagnostic remained. The independent coordinator directed Task 3 to
commit without waiting on or editing that lane. A fresh full-suite run was not
claimed in this fix round because the shared tree simultaneously contained
uncommitted Task 4 and Resend work. The focused reducer suite is the bounded
verification evidence for this commit.

### Commit and evidence boundary

```text
9aea7dafad589ebd2314dcfea0eb118d81f927c3
Author: Daniel Romitelli <danny.romitelli@gmail.com>
Committer: Daniel Romitelli <danny.romitelli@gmail.com>
Subject: Harden spatial gesture ownership and completion
```

- VERIFIED: all owner authorization paths named in review; stable two-hand ID
  ordering and replacement refusal; canonical acquisition, two-hand, rotation,
  and maximize transforms; real canonical command application; terminal loss
  completion; edge cancellation; and no duplicate completion.
- BLOCKED OUTSIDE TASK 3: a full-repository typecheck is red only at the
  concurrent untracked Resend import quoted above.
- NOT RE-RUN ON SHARED DIRTY TREE: the full repository suite.
- UNVERIFIED PHYSICAL: camera ergonomics, detector reorder/dropout behavior on
  real frames, visual preview acknowledgement, real throw rates, render cadence,
  browser behavior, RTX behavior, and mobile behavior remain Task 4/7 physical
  evidence work.
- SCOPE PRESERVED: no room, React, CSS, Task 2, Task 4 adapter, canonical command
  engine, deployment, credential, service, or infrastructure file was edited or
  committed by Task 3 in this review round.
