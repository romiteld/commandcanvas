# CommandCanvas

CommandCanvas is a shared spatial command surface where people, collaborators, and an agent manipulate the same live collection of semantic objects. Every supported input resolves through one validated mutation pipeline, producing visible, attributable, reversible receipts.

This repository is under active implementation for the 2026 Devpost WebMCP Challenge. The current checkpoint includes a verified local semantic canvas and native Chrome WebMCP registration; ChatGPT Site Tools invocation, Supabase Realtime, camera tracking, vision transformation, Resend, and the public no-signup `/demo` remain explicitly unverified until their integration checkpoints are exercised.

## Current working slice

- Strict, discriminated note, project-board, schedule, sketch, and diagram object types
- Visible creation and type-specific rendering for notes, project boards, and schedules
- Pointer creation, selection, move, and resize
- Canvas pan and pointer-anchored wheel zoom
- Pin/unpin, minimize/restore, and recoverable discard
- One canonical command engine for mutations
- Immutable revision receipts with actor and source attribution
- Universal undo for supported mutations
- Responsive desktop/mobile shell with non-gesture controls
- Honest service-status states for integrations not yet exercised
- Runtime rejection of malformed external commands before state or receipts change
- Eight stable WebMCP tools registered through `document.modelContext`
- Static registration by default with dynamic phase registration behind one flag
- Identical execute-time phase, role, and schema guards in both registration modes
- WebMCP object mutations attributed to ChatGPT in the same receipt stream

The running evidence ledger is in [`docs/verification-ledger.md`](docs/verification-ledger.md).

## Architecture direction

```text
Pointer · Touch · Stylus · Voice · Hand landmarks · Collaborator · WebMCP
                                │
                                ▼
                      Semantic Canvas Command
                                │
                                ▼
                    Validated Mutation Pipeline
                                │
                   ┌────────────┼────────────┐
                   ▼            ▼            ▼
              Object state   Receipt      Undo patch
                   │            │
                   └──────┬─────┘
                          ▼
                 Supabase persistence
                 and realtime delivery
```

High-frequency cursors and drag previews will remain ephemeral. Pointer-up object state and immutable receipts will be persisted canonically.

## Local development

Requirements:

- Node.js 22.14–22.x (`.nvmrc` pins 22.17.0)
- npm 11.5.2

```bash
nvm use
npm ci
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The Playwright suite runs desktop and mobile Chromium projects. Integration tests will be added alongside each service boundary; a unit test or mock will never be presented as proof that a live service worked.

The WebMCP browser project uses the installed Chrome testing feature and verifies that the browser’s native `document.modelContext.getTools()` surface discovers the exact registered catalog. It does not claim ChatGPT Site Tools invocation or Chrome 153 lifecycle behavior until those environments are exercised.

## Safety boundaries

- Natural language never writes directly to database tables.
- Destructive object actions use recoverable trash and universal undo.
- Camera frames stay local; semantic interaction events cross the mutation boundary.
- Sketch sources are preserved when a structured diagram is created.
- Packet recipients are snapshotted on approval; editing invalidates approval.
- A WebMCP packet-send request stages a human confirmation. It does not send email itself.
- Secrets and private credentials remain server-side.

## Status vocabulary

- **WORKING** — covered by automated checks or local runtime evidence.
- **VERIFIED IN BROWSER** — exercised in a named real browser.
- **UNVERIFIED** — designed or implemented but not yet exercised at the real boundary.
- **CUT** — deliberately outside the submission scope.

No signup, login form, password, third-party account, API key, or configuration will be required on the final `/demo` route.
