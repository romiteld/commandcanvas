# Task 5 Voice Report: ChatGPT Site Tools and Realtime voice

## Outcome

`DONE_WITH_CONCERNS`

Task 5 makes ChatGPT through the page's existing WebMCP Site Tools surface the
primary agent path and retains CommandCanvas Live Voice as an explicit,
ordinary-browser fallback using `gpt-realtime-2.1`. Both paths terminate in the
same semantic intent, command-policy, canonical mutation, immutable receipt,
and collaboration pipeline.

The core implementation is committed as
`bc112af8987dc7ffa0745eae45009efb57bfed57`. The room, route-wrapper, and
responsive UI integration is committed as
`ed9787529abf3e0e4fde9f5dfc7717e405870fb6`. Both commits are authored by
Daniel Romitelli without a coauthor or AI attribution.

The owned focused integration suites pass with 128 tests, and scoped ESLint
and commit whitespace checks pass. The aggregate project typecheck and full
suite are not labeled green because the shared working tree currently removes
Task 4 YOLO detector files while existing tests still import them. Task 5 does
not edit or claim those files.

No OpenAI provider session, physical microphone, ChatGPT built-in-browser
invocation, public deployment, Supabase service, or external side effect was
exercised by this task. The automated tests verify the local contracts and
browser-component behavior only.

## Scope completed

- Added one compact floating ChatGPT pill with two accessible segments:
  opening the unified drawer and using voice.
- Made Site Tools the primary in-ChatGPT behavior. In that mode the microphone
  segment shows honest guidance to use ChatGPT Voice in the surrounding app.
  The page does not claim or attempt to press, read, or control the host
  microphone or host transcript.
- Added explicit opt-in CommandCanvas Live Voice for ordinary browsers and as
  a user-selected fallback in Site Tools mode. The primary model remains
  `gpt-realtime-2.1`, not a Mini model.
- Kept the fallback controller mounted while its drawer is closed, exposed an
  imperative trusted-click start/stop path, and reported its actual active
  state to the shared surface.
- Kept the microphone segment reachable during drawing. A spoken
  `finish_sketch` completes the canonical sketch path without opening a
  drawer.
- Added a privacy-minimal WebMCP execution observer with one invocation ID and
  the lifecycle states `running`, `completed`, `awaiting_human_approval`,
  `refused`, and `cancelled`.
- Added a pure upsert helper that retains the last six unique invocations while
  replacing lifecycle updates for an existing invocation.
- Kept observer payloads deliberately narrow: tool name, lifecycle state,
  compact page-owned message, optional receipt ID, and invocation ID. Raw
  input, tool result data, camera data, landmarks, transcript data, recipient
  details, and provider secrets are not observed.
- Distinguished `registered_to_page` from `invoked`. Registration never renders
  as ChatGPT connection, discovery, or execution.
- Unified Site Tools activity, the active page-owned Realtime transcript,
  semantic canvas context, packet approval, and recent durable receipts in one
  drawer while retaining the complete Activity drawer.
- Added bounded Realtime `inspect_canvas` using the same
  `projectCanvasState(...)` semantic projection as WebMCP. It omits raw sketch
  coordinates and does not create a receipt.
- Added one strict `create_semantic_object` Realtime path that accepts a
  validated `NewCanvasObject` and dispatches exactly one canonical
  `object.create` command and one receipt. It supports the current generic
  semantic object union rather than architecture-only fixtures.
- Added item-correlated input-transcription deltas. A thought turn updates one
  latched card provisionally with zero delta receipts and commits one final
  `object.append_note_text` receipt after the completed turn settles.
- Clears provisional thought text on interruption, stop, error, cancellation,
  finish, conflict, deletion, and unmount rather than redirecting it to the
  current selection.
- Propagates one session cancellation signal through unresolved Realtime tool
  work and checks it before canonical commit. A committed result remains a
  completed receipt; cancellation does not relabel or undo it.
- Preserved the approved direct top-level
  `document.modelContext.registerTool(...)` integration. Task 5 did not migrate
  to a deprecated navigator surface or another SDK.
- Kept room operations, packet approval, packet sending, email, and arbitrary
  external tools out of embedded Realtime. Consequential packet sending remains
  the existing staged human-approval flow.

## Canonical input boundary

```text
ChatGPT through Site Tools ----> WebMCP schema/guard ----+
                                                       |
CommandCanvas Live Voice ------> bounded semantic intent+
                                                       v
                                             canonical command
                                                       v
                                                command policy
                                                       v
                                                   mutation
                                                       v
                                                   receipt
                                                       v
                                              room collaboration
```

The Realtime fallback is a conversational canvas input adapter. It is not a
second general-purpose agent and it does not bypass the WebMCP or room command
policy.

## Changed files

### Core commit `bc112af`

- `components/command-canvas/chatgpt-command-surface.tsx`
- `components/command-canvas/chatgpt-command-surface.test.tsx`
- `components/command-canvas/realtime-voice-control.tsx`
- `components/command-canvas/realtime-voice-control.test.tsx`
- `lib/canvas/direct-command.ts`
- `lib/canvas/direct-command.test.ts`
- `lib/realtime-voice/client.ts`
- `lib/realtime-voice/client.test.ts`
- `lib/realtime-voice/server-dependencies.test.ts`
- `lib/realtime-voice/tools.ts`
- `lib/realtime-voice/tools.test.ts`
- `lib/webmcp/execution-activity.ts`
- `lib/webmcp/execution-activity.test.ts`
- `lib/webmcp/registry.ts`
- `lib/webmcp/registry.test.ts`

### Integration commit `ed97875`

- `app/globals.css`
- `components/command-canvas/command-canvas-room.tsx`
- `components/command-canvas/command-canvas-room.test.tsx`
- `components/command-canvas/demo-command-canvas.tsx`
- `components/command-canvas/demo-command-canvas.test.tsx`
- `components/command-canvas/local-command-canvas.tsx`
- `components/command-canvas/local-command-canvas.test.tsx`
- `components/command-canvas/meeting-command-canvas.tsx`
- `components/command-canvas/meeting-command-canvas.test.tsx`
- `components/command-canvas/realtime-voice-control.tsx`
- `components/command-canvas/realtime-voice-control.test.tsx`

The integration did not edit `finishRemoteCommand`; its separately reported
stale-success race remains outside this commit.

## TDD evidence

All commands used the repository's Node environment with temporary files under
`/tmp`.

### RED: core contracts

Core tests were written before the corresponding implementation. The initial
focused failures covered the missing execution-activity module and lifecycle
observer, missing segmented ChatGPT surface, absent `inspect_canvas`, absent
transcription-delta and cancellation contracts, and the missing generic
semantic-object intent. No test was weakened to preserve the old behavior.

### GREEN: core contracts

The core focused verification completed with:

```text
Test Files  8 passed (8)
Tests       118 passed (118)
```

### RED: room and wrapper integration

Before the integration production edits, the focused room/wrapper run produced:

```text
Test Files  4 failed (4)
Tests       17 failed
```

The intended failures proved that the room still lacked the two-segment
ChatGPT control, route wrappers were not forwarding actual execution activity,
the live semantic projection was not connected, and stale drawer selectors
still expected the superseded command surface.

### GREEN: room and wrapper integration

Fresh post-commit command:

```bash
TMPDIR=/tmp TEMP=/tmp TMP=/tmp npm test -- \
  components/command-canvas/realtime-voice-control.test.tsx \
  components/command-canvas/command-canvas-room.test.tsx \
  components/command-canvas/local-command-canvas.test.tsx \
  components/command-canvas/meeting-command-canvas.test.tsx \
  components/command-canvas/demo-command-canvas.test.tsx \
  --reporter=dot
```

```text
Test Files  5 passed (5)
Tests       128 passed (128)
```

## Required behavior coverage

| Requirement | Direct automated evidence |
|---|---|
| One visual ChatGPT pill, two segments | Surface and room component tests query the two accessible controls inside one control group and reject the superseded trigger. |
| Site Tools primary | Registered-page mic tests show surrounding-Voice guidance and prove the embedded controller does not start. |
| Honest host boundary | Copy states that the page cannot press the surrounding microphone; tests never fabricate a host transcript. |
| Ordinary-browser fallback | Unavailable-mode mic tests synchronously invoke the controller from the trusted click and display the page-owned transcript surface. |
| Mic during drawing | Room tests keep the mic enabled during a drawing session and prove voice finish opens zero drawers. |
| Registration versus invocation | Route tests distinguish registered-page state from state reached only after an execution callback. |
| Last-six lifecycle observer | Registry and helper tests cover running/terminal replacement, six-invocation retention, approval, refusal, cancellation, observer isolation, and receipt IDs. |
| Observer privacy | Tests assert that raw input and recipient details never enter event rows or rendered output. |
| Shared semantic projection | Room tests compare the Realtime inspect result with the current `projectCanvasState` output and verify controller continuity after room updates. |
| Read-only inspect | Tool tests verify semantic observation, no raw sketch points, and no mutation/receipt. |
| Generic object creation | Direct-command and Realtime tests validate the `NewCanvasObject` union and one `object.create` dispatch/receipt. |
| One provisional thought card | Client/control/room tests cover correlated deltas, exact latched object, zero delta receipts, one final append, selection changes, interruption, and teardown. |
| Cancellation before commit | Client/control/tool tests carry the session signal, suppress late work, and preserve already committed receipts. |
| No embedded consequential tools | Realtime catalog tests reject room, packet approval/send, email, and external-operation tools. |

## Static and aggregate checks

Fresh scoped ESLint over all ten owned TypeScript/TSX integration files:

```text
exit 0, no diagnostics
```

CSS is outside the repository ESLint configuration. Commit whitespace check:

```bash
git show --check --oneline ed9787529abf3e0e4fde9f5dfc7717e405870fb6
```

```text
exit 0, no whitespace errors
```

The aggregate typecheck is currently blocked outside Task 5:

```text
e2e/hand-camera-runtime.spec.ts: Cannot find module '../lib/gesture/yolo-hand-pose-detector'
e2e/public-runtime.spec.ts: Cannot find module '../lib/gesture/yolo-hand-pose-detector'
lib/gesture/hand-tracking-controller.test.ts: Cannot find module '@/lib/gesture/yolo-hand-pose-detector'
```

Those modules are deleted in the shared Task 4 MIT/AGPL split at the time of
this report. Task 5 did not restore, suppress, or otherwise alter that work.

The most recent full-suite snapshot during integration was:

```text
Test Files  106 passed; 3 failed
Tests       1082 passed; 4 failed
```

The failures were the same unowned YOLO import boundary plus in-flight
release-hardening/license assertions. The full suite is therefore recorded as
blocked, not green.

A production build was not claimed. Running it against the same missing shared
imports would not add Task 5 evidence.

## Running verification ledger

### WORKING

- Compact unified ChatGPT control and responsive drawer integration.
- Honest Site Tools-primary and explicit ordinary-browser fallback selection.
- Privacy-minimal last-six WebMCP execution lifecycle.
- Coherent selection, tool, transcript, approval, and receipt presentation.
- Bounded shared semantic canvas inspection.
- Generic semantic object creation through one canonical mutation.
- Provisional single-card dictation with one final receipt.
- Realtime cancellation propagation before canonical commit.
- Drawing-compatible microphone control and drawer-free voice finish.

### VERIFIED IN BROWSER COMPONENT TESTS

- Trusted-click voice routing for registered and unavailable Site Tools states.
- Drawer persistence without controller remount.
- Drawing-state mic reachability and no-drawer finish.
- Mobile-size accessible segmented controls through rendered DOM and CSS
  contracts.

These tests use a browser DOM environment. They do not prove a physical
microphone, ChatGPT host invocation, or provider session.

### UNVERIFIED

- ChatGPT built-in browser discovery and invocation of the registered Site
  Tools.
- Surrounding ChatGPT Voice behavior, because a webpage cannot control or read
  that host surface.
- A real `gpt-realtime-2.1` WebRTC session, provider audio, VAD, and physical
  microphone behavior.
- Public deployment, mobile hardware, production Supabase collaboration, and
  any Resend action.
- Aggregate project typecheck, full suite, and production build while the
  shared Task 4 YOLO/license work is incomplete.

### CUT / OUT OF TASK 5 VOICE

- No migration away from top-level `document.modelContext`.
- No programmatic activation or scraping of ChatGPT Voice.
- No embedded Realtime room, membership, packet approval, email, or packet-send
  tools.
- No raw camera, landmark, recipient, tool-input, host-transcript, or provider
  data in execution activity.
- No provider call, browser microphone use, deployment, push, migration, or
  external side effect.
- No camera detector, gesture reducer, hand-state, delivery, Supabase schema,
  Resend implementation, or release-file change.

## Evidence boundary

Task 5 verifies that the two agent/input paths are unified at the semantic and
canonical command boundary and that the page represents Site Tools,
invocations, voice mode, approval, and receipts truthfully. It does not claim
that ChatGPT discovered the tools, that a provider voice session succeeded,
or that physical audio and public deployment behavior are verified.
