# CommandCanvas verification ledger

This ledger records observed behavior only. An integration remains **UNVERIFIED** until it has been exercised against the named service or browser. “Working” means covered by automated checks or local runtime evidence; “Verified in browser” requires an observed browser interaction.

## Checkpoint 0 — repository shell

### WORKING

- Next.js 16.3.3, React 19.2.8, TypeScript, Tailwind CSS, and ESLint were installed into a new `commandcanvas` repository with an npm lockfile.
- The project contains no client-exposed service credentials.

### VERIFIED IN BROWSER

- None yet.

### UNVERIFIED

- Production build and local browser startup.
- Infinite canvas interaction and canonical mutation pipeline.
- WebMCP registration or execution in Chrome 153 or ChatGPT’s built-in browser.
- Supabase Anonymous Auth, persistence, Presence, Broadcast, or two-browser synchronization.
- Camera permission, local hand tracking, finger drawing, or pinch movement.
- Sketch rasterization, vision-model interpretation, and structured diagram creation.
- Resend domain configuration, send staging, authorization, or delivery.
- Vercel preview/production deployment and public `/demo` route.

### CUT

- Group and ungroup.
- Redo.
- Complex multi-selection.
- Frame child-management or hierarchical containment.
- Rotation.
- Camera-based pencil, marker, or arbitrary physical-object tracking.
- Two-hand resize gestures, swipe-to-discard, and gesture-only destructive actions.
- Video conferencing and conferencing-platform integrations.
- Full calendar, spreadsheet, document-suite, OAuth, enterprise identity, billing, native mobile, headset, plugin-marketplace, and desktop-automation integrations.

## Verification log

| Date | Checkpoint | Evidence | Result |
| --- | --- | --- | --- |
| 2026-08-27 | 0 | `create-next-app` completed; dependency audit reported zero vulnerabilities | WORKING |
| 2026-08-27 | 1 | `npm run lint`, `npm run typecheck`, 16 Vitest tests, and optimized `next build` completed with zero failures | WORKING |
| 2026-08-27 | 1 | Production server plus Playwright Chromium desktop/mobile projects: 7 passed, 5 deliberately project-skipped, 0 failed | VERIFIED IN BROWSER |
| 2026-08-27 | 1 | Supabase project resource created; initial read-only status probe returned `COMING_UP` | PROVISIONING / UNVERIFIED |
| 2026-08-27 | 1 | Public GitHub API and `git ls-remote` both resolved `romiteld/commandcanvas`; remote `main` matched local commit `ee61027` | WORKING |
| 2026-08-27 | 2 | ESLint, TypeScript, 23 Vitest tests, and optimized Next.js build completed with zero failures | WORKING |
| 2026-08-27 | 2 | Production server plus Playwright Chromium projects: 8 passed, 6 deliberately project-skipped, 0 failed | VERIFIED IN BROWSER |
| 2026-08-27 | 2 | Supabase project status read-back returned `ACTIVE_HEALTHY` on Postgres 17 in `us-east-1` | RESOURCE READY; DATA PATH UNVERIFIED |

## Checkpoint 1 — local semantic canvas

### WORKING

- Node.js is pinned to 22.17.0 because current Supabase JavaScript packages no longer support Node.js 20.
- A typed canonical command engine handles object creation, spatial transforms, pin/unpin, minimize/restore, recoverable discard, stale-revision refusal, and universal undo.
- Every successful canonical mutation increments the room revision and creates an attributable receipt with before/after object snapshots.
- Zustand keeps canonical canvas state separate from ephemeral selection and viewport state.
- Coordinate helpers round-trip world/screen points and preserve the pointer anchor during clamped zoom.
- Pointer drag and resize use local previews, then commit exactly one canonical transform on pointer release.
- Canvas pan and wheel zoom update only the local viewport and do not create object receipts.
- The responsive application shell exposes accessible named controls for every currently supported operation.
- The optimized Next.js production build completes under Node.js 22.
- A dedicated Supabase project resource named `commandcanvas` is `ACTIVE_HEALTHY` in `us-east-1`; no application data path is claimed yet.

### VERIFIED IN BROWSER

- Chromium desktop at 1440×900: page load, semantic note creation, selection, pin, universal undo, pointer move, pointer resize, canvas pan, pointer-anchored wheel zoom, minimize, restore, recoverable trash, and trash recovery.
- Chromium mobile using the Playwright Pixel 7 profile: canvas and primary create action remain visible; note creation and its receipt are visible.
- Browser runs emitted no application page errors in the exercised primary flow.
- The 1440×900 checkpoint screenshot was visually inspected for layout, canvas geometry, selection treatment, activity chronology, and honest integration-status copy.

### UNVERIFIED

- Supabase project readiness, Anonymous Auth, schema, RLS, persistence, Presence, Broadcast, Postgres Changes, reconnect, late join, and two-real-browser synchronization.
- WebMCP registration, discovery, invocation, cancellation, lifecycle, and phase behavior in Chrome 153 or ChatGPT’s built-in browser.
- Physical touch device, stylus device, camera permission, local hand tracking, finger drawing, and pinch movement.
- Sketch rasterization, vision-model interpretation, structured-output validation, and structured diagram creation.
- Packet preparation, recipient snapshot, approval invalidation, staged send authorization, Resend delivery, and honest preview-only fallback.
- Vercel project, public deployment, public no-signup `/demo`, and ordinary-browser deployment behavior.

### CUT

- The checkpoint introduced none of the globally locked CUT features.

## Checkpoint 2 — semantic object system

### WORKING

- A strict Zod boundary validates the common spatial geometry and typed payloads for notes, project boards, schedules, sketches, and structured diagrams.
- Unknown fields, unsafe dimensions, broken diagram references, malformed dates/times, and empty semantic structures are rejected before canonical state changes.
- The canonical command engine validates every command at execution time, including inputs cast through TypeScript or received from an external agent boundary.
- The object toolbar creates a structured project board and an explicit-dated schedule through the same command, revision, receipt, and undo pipeline as notes.
- Type-specific renderers present board columns/tasks and schedule days/commitments without weakening the shared spatial object contract.
- The public GitHub repository exists at `romiteld/commandcanvas`; its published `main` branch is updated only after a checkpoint passes its complete gate, with commits authored by Daniel Romitelli.

### VERIFIED IN BROWSER

- Production Chromium desktop created a project board and schedule from accessible toolbar controls, rendered their structured payloads, produced two canonical receipts, and reached revision 2 without page errors.
- The full prior desktop and mobile interaction suite remained green against the optimized production build.
- The 1440×900 structured-object screenshot was visually inspected for object chrome, structured content, rail chronology, canvas clipping, and service-status honesty.

### UNVERIFIED

- Direct creation of sketch and diagram objects in the browser; these types are schema- and renderer-covered only until the sketch checkpoint.
- Every integration listed as unverified in Checkpoint 1 unless explicitly updated above.

### CUT

- The checkpoint introduced none of the globally locked CUT features.
