# Task 4 Report: full-canvas physical input and render-rate motion

## Outcome

`DONE_WITH_CONCERNS`

Task 4 replaces the camera-sized interaction boundary with a full-canvas hand
control surface, routes Task 2 reliability and landmark 8 into the Task 3
reducer, keeps transient cursor/object motion outside durable canvas history,
and makes repeated point-finger strokes one sketch session until an intentional
finish. The implementation is committed as
`4b7004d52db6617e431ab6cab4aa874e69b36a59`.

The six owned focused suites pass with 111 tests, including both room suites at
77 tests. Project lint and the staged whitespace check pass. The current full
suite and typecheck are not labeled green because a concurrent Resend lane has
an untracked test importing an implementation file that has not landed and an
in-progress migration-contract assertion. The production prebuild succeeds,
but Next/Turbopack rejects this sibling worktree's out-of-root `node_modules`
symlink; the Webpack fallback also fails before application compilation while
parsing TypeScript configuration.

No physical camera, physical hand, touch/stylus hardware, production browser,
deployment, or external provider was exercised in Task 4. Those remain Task 7
verification boundaries.

## Scope completed

- Added `spatialInputFromHandObservation` as the narrow Task 2 to Task 3
  adapter. Landmark 8 is the target/ink pointer, the palm MCP centroid is the
  held-object motion point, independent hand track IDs survive bimanual input,
  and confidence/real/predicted/tracking evidence is preserved.
- Added distance-or-time sampling at 1.75 CSS pixels or 12 ms. Non-finite,
  non-monotonic, and sub-threshold samples are rejected without advancing the
  sample baseline.
- Added a requestAnimationFrame motion layer for cursor and object previews.
  It coalesces pending samples, mutates only CSS variables/data attributes,
  never dispatches a command, and can clear/dispose pending work.
- Migrated room orchestration to the authoritative Task 3 phases and effects.
  The room consumes preview effects ephemerally and converts each completion
  through `spatialGestureCompletionToCommand` into one canonical command and
  one ordinary receipt.
- Added contextual `POINT`, `TARGET`, `PINCH`, `HELD`, `REACQUIRE`, `RESIZE`,
  and `THROW ARMED` feedback at the physical cursor/object boundary.
- Added visible top maximize, bottom minimize, and side soft-trash targets.
  Edge affordances are suppressed during two-hand pending, resize, and loss
  grace. A discard remains the existing recoverable canonical soft discard,
  not a gesture-only destructive path.
- Corrected point-finger drawing. Open palm ends only the current stroke; it
  does not add a point or pan while drawing. Ten independent lines remain one
  in-memory sketch and produce no receipt until the session is finished.
- Added stable 300 ms open-palm finish with a visible armed/progress preview.
  Existing button and voice `finish_sketch` paths use the same one-time sketch
  commit path.
- Kept drawing gestures from opening command, system, activity, or approval
  panels. Intermediate strokes and transient motion create zero receipts.
- Corrected local eraser state so the mutable sketch ref and rendered stroke
  state change together, preventing later commits from resurrecting erased
  lines.
- Corrected pointer/touch/stylus coalescing: non-empty coalesced children are
  processed exactly once and the parent event is skipped; otherwise the parent
  is processed once.
- Reworked camera UX into a brief full-canvas calibration overlay followed by
  a draggable, hideable, nonblocking sensor PiP. Calibration observations are
  sensor-only and cannot manipulate the canvas behind the overlay.
- Removed the 64 ms positional/size transition from held previews. React owns
  phases and committed state; CSS variables and requestAnimationFrame own
  transient position, size, rotation, and cursor samples.
- Preserved pointer, touch, pen, mobile layout, and reduced-motion paths.

## Task 2 and Task 3 boundaries consumed

Task 4 does not reinterpret landmarks, vote pinch state, associate hand
identity, or implement loss timing. It consumes Task 2's already classified
observation, filtered measurements, stable `trackId`, provenance, and
confidence. It maps those fields into the Task 3 input contract without
creating a second gesture state machine.

Task 4 does not decide targeting, ownership, second-hand dwell, transform
geometry, edge eligibility, or completion safety. Those remain in the Task 3
reducer. The room renders Task 3 phases and previews, then sends only its typed
completion effect through the canonical command engine. Task 3's follow-up
owner-track, bimanual-order, clamp, and terminal-loss corrections landed before
Task 4's final verification and the exported contract remained unchanged.

## Changed files

- `lib/gesture/spatial-room-input.ts`
  - Task 2 observation to Task 3 input adapter and tracked-stroke sampler.
- `lib/gesture/spatial-room-input.test.ts`
  - landmark 8, palm motion, provenance, bimanual identity, pen-up, and exact
    distance/time sampling tests.
- `lib/gesture/canvas-motion-layer.ts`
  - narrow requestAnimationFrame cursor/object preview layer.
- `lib/gesture/canvas-motion-layer.test.ts`
  - coalescing, CSS-variable preview, clear, disposal, and zero-durable-callback
    tests.
- `components/command-canvas/command-canvas-room.tsx`
  - Task 2/3 integration, drawing-session composition, contextual feedback,
    palm finish, canonical completions, ephemeral preview routing, and camera
    placement.
- `components/command-canvas/command-canvas-room.test.tsx`
  - room integration and migrated authoritative gesture contracts.
- `components/command-canvas/command-canvas-room-hand-navigation.test.tsx`
  - full-canvas pointing, sticky acquisition, bimanual state, and edge-feedback
    integration.
- `components/command-canvas/sketch-composer.tsx`
  - exactly-once coalesced pointer/touch/stylus sample consumption.
- `components/command-canvas/sketch-composer.test.tsx`
  - parent-versus-coalesced event contract.
- `components/command-canvas/spatial-camera-control.tsx`
  - full-canvas calibration and draggable/hideable sensor PiP.
- `components/command-canvas/spatial-camera-control.test.tsx`
  - overlay, PiP, dragging, hiding, and sensor-boundary semantics.
- `app/command-canvas-spatial.css`
  - full-canvas physical control plane, contextual states, edge targets,
    palm-finish preview, sensor PiP, mobile rules, and transition removal.
- `app/globals.css`
  - removed the superseded blocking camera-panel layout rules.

No Task 3 reducer, detector, Task 2 reliability implementation, command
engine, object model, Supabase, Resend, deployment, or provider file was
changed.

## TDD evidence

All commands used Node `v22.14.0` with `TMPDIR=/tmp`, `TEMP=/tmp`, and
`TMP=/tmp`.

### RED: inherited room contract

Before the Task 4 migration, the two room suites reproduced the Task 3 handoff
boundary:

```text
Test Files  2 failed
Tests       10 failed | 66 passed
```

The failures were the intended legacy integration gaps: immediate grab,
legacy zoom/resize labels, legacy move/resize/stage effects, permissive edge
actions, palm object restore, and immediate two-hand resize.

### RED: new Task 4 contracts

New tests were added before their production modules and UI behavior. The first
focused run failed for four independent reasons:

```text
Cannot find module '@/lib/gesture/spatial-room-input'
Cannot find module '@/lib/gesture/canvas-motion-layer'
expected coalesced pointer children, received the parent event as well
expected full-canvas calibration/sensor PiP classes, received the legacy panel
```

After the first integration pass, the expanded room contract remained red:

```text
Test Files  2 failed
Tests       15 failed | 61 passed
```

That intermediate RED exposed real integration defects rather than test-only
issues: eraser state could be resurrected from a stale ref, calibration labels
were ambiguous across the toolbar/PiP, edge targets survived into resize, and
the room's bimanual fixture did not satisfy the reducer's stable near-object
second-hand gate.

### GREEN: owned focused suites

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" \
TMPDIR=/tmp TEMP=/tmp TMP=/tmp \
npm test -- \
  lib/gesture/spatial-room-input.test.ts \
  lib/gesture/canvas-motion-layer.test.ts \
  components/command-canvas/sketch-composer.test.tsx \
  components/command-canvas/spatial-camera-control.test.tsx \
  components/command-canvas/command-canvas-room-hand-navigation.test.tsx \
  components/command-canvas/command-canvas-room.test.tsx \
  --reporter=dot
```

```text
Test Files  6 passed (6)
Tests       111 passed (111)
```

The two room suites independently finish green:

```text
Test Files  2 passed (2)
Tests       77 passed (77)
```

## Required behavior coverage

| Requirement | Direct automated evidence |
|---|---|
| Landmark 8 controls target and ink | Adapter unit test deliberately gives generic pointer, index tip, and palm centroid different coordinates; room sketch placement follows index tip. |
| Palm controls held motion only | Adapter distinguishes `pointer` from `motionPointer`; Task 3 owns the no-jump transform baseline. |
| Task 2 reliability reaches Task 3 | Tests cover stable IDs, separate index/thumb confidence, predicted provenance, loss mapping, and both bimanual hands. |
| Full canvas, not camera boundary | Room exposes `HAND CONTROL · FULL CANVAS`; calibration is a full-canvas overlay; ready state becomes a sensor PiP. |
| PiP does not own gestures | Room closes the system drawer after enable, keeps hand controls on the canvas, and ignores observations only during explicit calibration. |
| PiP drag/hide | Component test moves the sensor PiP to `60px, 80px`, hides it, and restores its visible control. |
| Point-finger repeated drawing | Ten point/open-palm lines remain one in-memory sketch session and commit as one SketchObject only at finish. |
| Open-palm pen-up | Adapter/reducer/room tests prove palm adds no ink and closes only the current stroke. |
| Stable 300 ms finish | Room test observes the armed progress before the boundary and exactly one object/receipt at 300 ms. |
| Voice/button finish | Live voice `finish_sketch` and the visible finish action both terminate the same session through the canonical sketch command. |
| No panel explosion | Multi-line gesture tests assert no complementary drawer and no receipt before finish. |
| Exactly-once coalesced pointer samples | Sketch composer test proves non-empty children replace the parent; empty children fall back to the parent once. |
| 1.75 px or 12 ms sampling | Unit tests cover below-both refusal, distance acceptance, interval acceptance, and monotonic timestamps. |
| Render-rate ephemeral motion | Motion-layer tests prove one rAF coalesces latest cursor/object samples into CSS variables and never calls durable dispatch. |
| No 64 ms transform lag | Held object layout reads CSS variables and the superseded position/size transition is removed; reduced-motion remains supported. |
| Contextual states | Room integration covers point/target/pinch/held/reacquire/resize and armed edge feedback. |
| Exactly one canonical completion | Move, two-hand transform, maximize, minimize, and soft discard tests assert one canonical receipt and shared Undo where applicable. |
| Mobile/touch/stylus fallback | Pointer composer remains pointer-type agnostic; mobile CSS and reduced-motion rules remain active. Physical ergonomics are not inferred from DOM tests. |

## Full-suite status

Fresh command after the Task 3 fixes and Task 4 commit:

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" \
TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- --reporter=dot
```

```text
Test Files  2 failed | 101 passed (103)
Tests       1 failed | 1026 passed (1027)
```

There are no Task 4 failures. Both failures belong to the concurrently edited
Resend/Supabase delivery lane:

- `lib/resend/webhook.test.ts` imports the not-yet-created
  `@/lib/resend/webhook` module, so its suite cannot load.
- `lib/supabase/resend-delivery-migration-contract.test.ts` has one assertion
  whose regex expects a literal packet-event action while the in-progress SQL
  constructs the action dynamically.

Task 4 did not edit, stage, or claim those files.

## Static checks

```bash
PATH="/home/romiteld/.nvm/versions/node/v22.14.0/bin:$PATH" \
TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm run lint
```

```text
exit 0, no diagnostics
```

Focused ESLint over every Task 4 TypeScript/TSX file also exits 0. CSS is not
part of the repository ESLint configuration and is reported as ignored rather
than linted.

```bash
git diff --cached --check
```

```text
exit 0, no whitespace errors
```

Current project typecheck:

```text
lib/resend/webhook.test.ts(8,8): error TS2307:
Cannot find module '@/lib/resend/webhook'
```

That is the only TypeScript diagnostic and is outside Task 4 ownership. It is
not suppressed and the project typecheck is not labeled green.

## Build status

The worker prebuild succeeds:

```text
public/workers/yolo-hand-pose.js   850.7kb
public/workers/hand-landmarker.js  152.4kb
Done in 70ms
```

Next/Turbopack then fails before application compilation because this sibling
worktree uses a shared dependency symlink outside the project root:

```text
Symlink [project]/node_modules is invalid, it points out of the filesystem root
```

The non-mutating Webpack fallback was also attempted and failed before
application compilation:

```text
Error: Could not parse output from TypeScript's --showConfig.
```

The build is therefore recorded as environment-blocked, not passing.

## Verification boundary and concerns

### VERIFIED IN AUTOMATION

- Task 2 observation adaptation, landmark 8 semantics, sampling thresholds,
  requestAnimationFrame coalescing, CSS-variable previews, and disposal.
- Room consumption of Task 3 phases/effects and exactly one canonical command
  for typed completions.
- Repeated-stroke sketch composition, pen-up, explicit/voice/palm finish,
  zero-drawer intermediate drawing, and bounded receipts.
- Full-canvas calibration semantics, draggable/hideable PiP behavior, edge
  feedback suppression during resize, and accessible fallback controls.
- All six owned suites: 111/111 tests.

### UNVERIFIED

- Physical index-finger drawing accuracy, latency, lighting, occlusion,
  two-hand ergonomics, throw discoverability, and real-device calibration.
- Real camera frames through the current room UI.
- Physical touch/stylus palm rejection, pressure, tilt, or device ergonomics.
- Frame-delivery cadence and motion smoothness on target mobile/desktop GPUs.
- Production Chrome, WebKit, or ChatGPT built-in-browser pixels and behavior.
- Production build artifact, deployed endpoint, or external provider behavior.

These boundaries require Task 7 replay, fake-media, real-device, target-browser,
and deployed-environment evidence. Unit/component tests do not close them.

---

## Review fix round 1

Independent review required six important corrections. They are implemented in
`cace387862679c9e4838e57c3775e14a8bbef289` without changing the Task 2 or Task 3
reducers.

### Corrections completed

1. Calibration is now operational rather than decorative. The full-canvas
   overlay collects reach, open-pinch, and closed-pinch samples; builds and
   retains a `HandCalibrationProfile` for the current camera component session;
   and sends observations through Task 2's `mapCalibratedPointer`, gain states,
   reliability reducer, calibrated thresholds, and temporal pinch vote before
   Task 3. Fallback calibration is used only after the visible Skip action.
2. Live ink moved to an isolated `HandInkPreview` leaf and the existing narrow
   `CanvasMotionLayer`. Twenty transient samples coalesce into one animation
   frame DOM write and produce zero additional React Profiler commits. React
   renders only completed stroke boundaries and the durable sketch commit.
3. Touch, stylus, and mouse drawing remain explicitly available while the
   camera is ready. Hand drawing is a separate visible action, and voice can
   select the pointer path instead of silently preferring the camera.
4. Authoritative asynchronous object transforms and exits retain the final
   ephemeral visual state until the command is applied. A refused command
   visibly rolls that state back; a pending preview is not cleared early by a
   following reducer cleanup effect.
5. The eraser latch re-arms whenever the semantic pose leaves `point`, so
   `point -> open_palm -> point` can erase two separate strokes without an
   idle-only dependency.
6. The hand-sensor PiP is clamped to the workspace and above the tool dock in
   all four drag directions. It is reclamped on resize and orientation change,
   keeping its drag handle reachable on compact viewports.

The round also integrated the concurrently landed generic object contract in
the room: standalone diagrams safely omit `sourceSketchId`, generic table,
reference, and meeting-card previews render through `SemanticObjectPreview`,
and `create_semantic_object` resolves to exactly one canonical `object.create`
command and receipt.

### TDD evidence for review fixes

The initial review-contract run was genuinely red:

```text
Test Files  4 failed
Tests       9 failed | 96 passed (105)
```

The final focused command is green:

```bash
env -u TEMP -u TMP npm test -- --run \
  lib/gesture/spatial-room-input.test.ts \
  lib/gesture/canvas-motion-layer.test.ts \
  components/command-canvas/hand-ink-preview.test.tsx \
  components/command-canvas/spatial-camera-control.test.tsx \
  components/command-canvas/command-canvas-room.test.tsx \
  components/command-canvas/command-canvas-room-hand-navigation.test.tsx
```

```text
Test Files  6 passed (6)
Tests       114 passed (114)
```

This includes direct tests that two retained profiles map the same physical
point differently, calibrated pinch thresholds alter the emitted semantic
state after the two-of-three vote, camera-ready pen input remains usable,
deferred authority retains the final preview, refusal rolls it back, the eraser
re-arms, extreme mobile PiP drags stay bounded, and twenty ink samples do not
rerender the React preview leaf.

### Final repository checks at commit time

- `npm run lint`: exit 0, no diagnostics.
- Task 4 explicit-path `git diff --check`: exit 0, no whitespace errors.
- Full suite: `108` files and `1117` tests passed; `7` tests failed only in
  concurrent, unstaged delivery work (`4` in
  `lib/packets/server-service.test.ts` and `3` in
  `lib/supabase/resend-reconciliation-migration-contract.test.ts`). No Task 4
  suite failed.
- Project typecheck was not green because concurrent
  `lib/supabase/meeting-api.test.ts:162` produced two diagnostics. There was no
  Task 4 diagnostic.
- The production build was not rerun or relabeled green in this round. The last
  attempt remains environment-blocked before application compilation because
  the shared `node_modules` symlink points outside Turbopack's filesystem root.

The concurrent delivery files were neither edited nor staged by Task 4. The
physical-device, target-browser, production-build, deployment, and provider
verification boundaries listed above remain intentionally unclaimed.
