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
| 2026-08-27 | 3 | ESLint, TypeScript, 57 Vitest tests, and optimized Next.js build completed with zero failures | WORKING |
| 2026-08-27 | 3 | Three Playwright projects: 10 passed, 9 deliberately project-skipped, 0 failed | VERIFIED IN BROWSER |
| 2026-08-27 | 3 | Chrome 152 testing feature exposed native `document.modelContext`; `getTools()` returned the exact eight-tool catalog with no page errors | VERIFIED IN CHROME 152 TEST MODE |
| 2026-08-27 | 4 | Three migrations applied to the dedicated Supabase project; deployed catalog read-back found seven public tables with RLS, service-only mutation/bootstrap/join RPC grants, a private hashed join-capability table, and the composite outbound-share index | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 4 | Three real Anonymous Auth sessions exercised host, participant, and outsider paths: capability mismatch, direct privileged RPC, outsider reads, and authenticated stable writes were refused; host/participant durable reads and one atomic mutation succeeded | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 4 | Two authorized anonymous clients subscribed to one private room, each observed two Presence members, one received the other’s cursor Broadcast, both received the receipt-trigger revision Broadcast, and an outsider’s private-channel subscription was denied; a subsequent participant Data API read returned the durable object | VERIFIED IN DEPLOYED SUPABASE REALTIME |
| 2026-08-27 | 4 | Direct receipt deletion remained refused, while deletion of two exact failed-probe parent rooms cascaded their members, objects, receipts, and private capability hashes; deployed read-back found zero probe rooms remaining | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 4 | Deployed room-revision compare-and-swap wrapper read-back confirmed volatile/security-definer/empty-search-path behavior, service-only execution, and no `anon` or `authenticated` execution | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 4 | A Node 22 production server and real Supabase anonymous host/participant/outsider sessions exercised create, join, two durable commands, authoritative revisions 1 and 2, stale-revision HTTP 409, member reads, outsider isolation, and exact room cleanup | VERIFIED THROUGH LOCAL PRODUCTION HTTP + DEPLOYED SUPABASE |
| 2026-08-27 | 4 | Two isolated production-browser contexts opened `/demo`, created and joined the same real room without signup, observed two actual Presence members, exchanged a cursor Broadcast, persisted a participant-created note, reconciled revision 4 in both React canvases, scrubbed the participant capability URL, resumed the participant after reload, and completed exact server-side room cleanup | VERIFIED IN BROWSER + DEPLOYED SUPABASE REALTIME |

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

## Checkpoint 3 — WebMCP-native canvas operations

### WORKING

- A central phase table controls eight stable tools: canvas read, object create/transform/state/discard, sketch transformation, packet preparation, and staged packet-send request.
- Static mode registers the full stable catalog once. Dynamic mode adds or abort-unregisters the same stable descriptors by phase behind `NEXT_PUBLIC_WEBMCP_DYNAMIC_REGISTRATION=true`.
- Both modes call the same execute-time Zod, room-phase, membership, mutation-permission, and host-role guards.
- Registrations use one lifecycle `AbortController` each; invocation callbacks receive and propagate the browser-provided cancellation signal.
- Registered descriptors contain the current supported fields only: `name`, `description`, `inputSchema`, `annotations`, and `execute`.
- `readOnlyHint` and `untrustedContentHint` are set intentionally. No deprecated `navigator.modelContext`, `outputSchema`, `updateTool`, or `unregisterTool` surface is assumed.
- `request_packet_send` accepts only a packet ID and delegates only to a staging adapter; it cannot accept recipient overrides or perform delivery.
- Local object tools route through the canonical mutation pipeline with actor `ChatGPT`, source `webmcp`, one revision, and one visible receipt.
- Ordinary browsers display `Site Tools unavailable` while keeping every pointer and toolbar path functional.

### VERIFIED IN BROWSER

- An injected standards-shaped `document.modelContext` registered all eight descriptors, then invoked `create_object`; the exact live page rendered the object and an agent-attributed `R1 · webmcp` receipt.
- Installed Google Chrome 152.0.7977.64 launched with its WebMCP testing feature, exposed the native `document.modelContext` surface, displayed `8 Site Tools registered`, and returned the exact catalog from native `getTools()` with no page errors.
- Ordinary Playwright Chromium without WebMCP displayed the honest fallback and retained the full canvas interaction suite.

### UNVERIFIED

- ChatGPT built-in-browser discovery and invocation against this deployed page.
- Chrome 153’s non-disruptive registration-lifecycle behavior; the installed target is Chrome 152.
- Actual agent- or user-triggered invocation cancellation across a network operation; signal identity and refusal behavior are unit-verified only.
- Dynamic registration churn on native Chrome or ChatGPT; static registration remains the default.
- Sketch, packet, and send adapters beyond their guarded/staged contracts.

### CUT

- The checkpoint introduced none of the globally locked CUT features.

## Checkpoint 4 — Supabase persistence and realtime collaboration (in progress)

### WORKING

- The no-signup session helper reuses an existing browser session or creates one Supabase anonymous authenticated identity, and reports an honest unavailable state when Anonymous Auth fails.
- Server requests accept only a bounded exact `Bearer <JWT>` header, derive the actor only through `auth.getUser`, and collapse provider details into compact authentication failures.
- The privileged Supabase client is server-only, non-persistent, and requires an injected server credential; no privileged credential is stored in the repository or exposed to client code.
- The deployed relational schema persists rooms, self-visible memberships, typed canvas objects, immutable receipts, meeting packets, staged send requests, and outbound shares with RLS enabled.
- Room creation and joining run through service-only atomic RPCs. A raw 256-bit join capability is returned to the host once, while Supabase stores only its SHA-256 hash in a private, browser-inaccessible table.
- Browser roles cannot call room bootstrap, join, or canonical mutation RPCs directly. Stable browser writes remain denied; server mutations lock the room, version-check objects, derive prior/result/inverse state, and append one immutable revision receipt.
- Strict persistence mapping validates untrusted Data API rows, discriminated object payloads, room identity, revision order, receipt transitions, current state, and explicit soft-deletion before hydrating the Zustand store.
- The realtime client contract uses private `room:<uuid>` topics, Presence for actual connected clients, Broadcast for compact cursors, a 30 Hz cursor ceiling, and compact revision notifications that trigger stable-state reconciliation.
- A deployed contract migration aligns the database receipt trigger with the client’s `revision` event and `{roomId, revision, receiptId}` payload. The client also accepts only Supabase Realtime’s observed optional UUID message ID and rejects arbitrary extra state.
- Direct receipt mutation remains impossible, but an exact parent-room deletion can now cascade its owned immutable history. This was required for deterministic test cleanup and was verified without weakening the receipt guard.
- Stable command commits now require an exact expected room revision under a row lock. The deployed wrapper refuses stale or missing revisions before the canonical mutation function can write an object or receipt.
- The Next.js room boundary authenticates before reading request content, enforces exact JSON and bounded bodies, rejects client-supplied actor authority, and returns only compact non-secret errors. Successful commands return the post-commit authoritative canvas state.
- The public `/demo` boot path creates or resumes a per-tab no-signup room, commits three deterministic semantic fixtures through the canonical server mutation boundary, stores host capability access only in session storage, strips a successful participant join token from the address bar, and exposes copy-invite/reset controls.
- The React room uses authoritative server responses for stable mutations, actual Supabase Presence for participant chips, 30 Hz Broadcast for cursor motion, and receipt-trigger revision events for durable reloads. It does not optimistically claim a stable mutation or fabricate a collaborator.

### VERIFIED IN BROWSER

- A production Chromium host opened `/demo` with no signup or configuration, received a real anonymous identity, a three-object deterministic room at revision 3, a copyable participant capability, and one actual Presence member.
- A second isolated Chromium context followed that capability, joined as Sarah, had the capability query scrubbed to `/demo`, and rendered the same durable objects and receipts.
- Both browsers displayed two actual Presence members. The host rendered Sarah’s remote cursor after the participant moved across the canvas.
- Sarah created a note through the UI. Both browsers rendered the resulting participant-attributed receipt and authoritative revision 4. No application page errors were observed.
- Sarah then reloaded the scrubbed `/demo` URL. Her per-tab descriptor resumed the same anonymous membership, reconstructed revision 4, reconnected Presence, and restored the two-participant state in both browsers.
- The 1440×900 two-participant checkpoint screenshot was visually inspected for fixture layout, Presence, remote cursor, service honesty, participant receipt attribution, and revision agreement.

### UNVERIFIED

- A forced offline/online transport interruption without reloading. Reload-based session resume, durable reconstruction, and Realtime reconnection are verified.
- Outsider private-channel denial through the application UI. The equivalent deployed Supabase client path is verified; the React integration is not yet exercised.
- A production Vercel server credential and deployed `/demo` data path.

### CUT

- The checkpoint introduced none of the globally locked CUT features.
