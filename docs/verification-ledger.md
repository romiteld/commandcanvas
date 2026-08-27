# CommandCanvas verification ledger

This ledger records observed behavior only. An integration remains **UNVERIFIED** until it has been exercised against the named service or browser. “Working” means covered by automated checks or local runtime evidence; “Verified in browser” requires an observed browser interaction.

## Checkpoint 0: repository shell

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
| 2026-08-27 | 5 | Node 22: ESLint, TypeScript, 318 Vitest tests across 43 files, hand-worker bundle, optimized Next.js build, and diff check completed with zero failures | WORKING |
| 2026-08-27 | 5 | Production Chrome drew five strokes, rendered the real selected sketch to PNG, received HTTP 200 from the authenticated live GPT vision route, preserved the source, created one structured diagram through the canonical Supabase mutation path, and verified exact room cleanup | VERIFIED IN BROWSER + OPENAI + DEPLOYED SUPABASE |
| 2026-08-27 | 5 | Deployed migration catalog and function read-back confirmed durable non-null actor-consistent receipt sources and service-only source-aware mutation RPCs; a full browser reload preserved `R5 · typed` and `R4 · pointer` | VERIFIED IN DEPLOYED SUPABASE + BROWSER RELOAD |
| 2026-08-27 | 6 | Before release hardening, Production Chrome fake-media exercised the same-origin hand worker, SIMD JavaScript/WASM, and then-bundled hand-landmarker model with HTTP 200, reached the truthful ready/no-hand state, and returned to pointer fallback on disable | HISTORICAL BROWSER PIPELINE EVIDENCE; CURRENT MODEL FETCH REVERIFIED BELOW |
| 2026-08-27 | 7 | Eleven forward migrations are present in the deployed Supabase migration ledger; deployed catalog assertions and the durable vision-admission SQL probe passed after the packet-storage, vision-admission, and packet-authorization migrations | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 7 | Two independent browser contexts created separate `/demo` rooms with three fixtures and revision 3; room-scoped fixture IDs prevented the formerly reproduced global primary-key collision, and all five exact probe rooms were removed with zero rows remaining | VERIFIED IN BROWSER + DEPLOYED SUPABASE |
| 2026-08-27 | 7 | A live host prepared and visibly reviewed the exact three-object packet snapshot, approved one immutable recipient, staged a send, durably cancelled it, and received HTTP 409 `send_request_unavailable` when the cancelled request was explicitly re-executed | VERIFIED IN BROWSER + DEPLOYED SUPABASE |
| 2026-08-27 | 7 | A second live host approved and staged the same workflow, explicitly pressed SEND, and received the honest persisted `preview_only` result with provider `preview`, no provider message ID, and the message `Preview only: no email was sent.` | VERIFIED IN BROWSER + DEPLOYED SUPABASE; RESEND NOT CALLED |
| 2026-08-27 | 8 | At 420×900, Playwright Chromium drew ten pointer strokes, persisted the rough sketch, rasterized it to PNG, passed the deployed admission guard, received a real GPT-5.6 Terra structured result, and rendered a three-node/two-edge diagram beside the preserved source at revision 5 | VERIFIED IN BROWSER + OPENAI + DEPLOYED SUPABASE |
| 2026-08-27 | 8 | Deployed admission read-back showed one completed attempt, one recorded attempt, a provider response ID, and matching source sketch/kind. The original and diagram both intersected the 420×611 canvas viewport; the responsive screenshot was visually inspected | VERIFIED IN BROWSER + DEPLOYED SUPABASE |
| 2026-08-27 | 8 | A fail-before-fix boundary test reproduced the deployment mismatch between the former 8 MB application request limit and Vercel Functions' documented 4.5 MB payload ceiling. The route now rejects above 4 MB and raw PNGs above 2 MB; 28 focused tests pass | WORKING; PUBLIC VERCEL ROUTE UNVERIFIED |
| 2026-08-27 | 9 | Node 22.17.0: ESLint, TypeScript, 472 Vitest tests across 56 files, hand-worker bundle, and optimized Next.js production build completed with zero failures; the production dependency audit reported zero vulnerabilities | WORKING |
| 2026-08-27 | 9 | A clean PostgreSQL 17 integration run applied all 15 migrations in filename order and passed all 13 catalog, RLS, mutation, realtime, packet, lifecycle, storage-cap, and vision-admission probes; the isolated container was removed | VERIFIED IN ISOLATED POSTGRES 17 |
| 2026-08-27 | 9 | The dedicated Supabase project reports all 15 forward migrations. Remote catalog assertions and exact transactional rollback probes passed for packet restaging, demo storage caps, demo vision spend, and demo-room lifecycle | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 9 | Local production Chrome prepared and approved a packet, staged and durably cancelled it, re-staged it, explicitly authorized the preview-only execution, preserved both terminal states across reloads, then reset the room and proved the exact former room was deleted | VERIFIED IN BROWSER + DEPLOYED SUPABASE; RESEND NOT CALLED |
| 2026-08-27 | 9 | A strict live residue audit identified two deterministic seed-only browser rooms, deleted only those exact UUIDs through `delete_demo_room_as_host`, and independently read zero rows across all 12 public/private application tables at 2026-08-27T18:12:57Z | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 9 | Production Chrome authored a real four-stroke pointer sketch, received a deliberately forced schema-valid HTTP 503 from only the transform route, preserved the revision-4 source with no diagram, then created a separate revision-5 **Prepared demo fallback** only after the user clicked its honestly labeled fallback control | VERIFIED IN BROWSER + DEPLOYED SUPABASE; NO VISION SUCCESS CLAIMED |
| 2026-08-27 | 9 | Production Chrome with a fake camera granted permission, fetched the exact versioned Google detector model with HTTP 200, loaded the same-origin worker and module WASM with HTTP 200, reached **Hand input ready · local only**, then disabled input, detached the video stream, ended its media track, and returned to pointer mode | CURRENT BROWSER PIPELINE VERIFIED; REAL HAND UNVERIFIED |
| 2026-08-27 | 9 | A fail-before-fix browser run found Next.js development tooling intercepting the fixed mobile toolbar. The Playwright-owned server was changed to the production build; the rerun completed 10 browser tests with 11 intentional project/credential skips and zero failures, including mobile controls and native Chrome WebMCP | VERIFIED IN PRODUCTION BROWSER HARNESS |
| 2026-08-27 | 10 | Vercel deployed exact Git commit `0ea75f6` on Node 22 as production deployment `dpl_x3LQvo8wWbWJhpto3LYU3sJm5viS`; `https://commandcanvas.vercel.app/demo` returned HTTP 200 with HSTS, MIME-sniffing, referrer, frame, and camera permissions headers | VERIFIED IN VERCEL PRODUCTION |
| 2026-08-27 | 10 | Two independent public HTTPS browser contexts created and joined one no-signup room, observed two actual Presence members, exchanged a cursor Broadcast, converged on a participant mutation and revision, resumed after reload, and deleted the exact room | VERIFIED IN PUBLIC BROWSER + SUPABASE REALTIME |
| 2026-08-27 | 10 | Installed Chrome 152 loaded the public production page with its WebMCP feature and native `document.modelContext.getTools()` returned the exact eight-tool catalog | VERIFIED IN PUBLIC CHROME 152 TEST MODE |
| 2026-08-27 | 10 | Public production Chrome drew a real four-stroke sketch, received HTTP 200 from the Vercel vision function and GPT-5.6 Terra, preserved the source, rendered a conservative two-node structured diagram, showed revision-5 provenance, emitted zero page/application console errors, and deleted the exact room | VERIFIED IN PUBLIC BROWSER + VERCEL + OPENAI + SUPABASE |
| 2026-08-27 | 10 | Public production Chrome prepared and approved the exact packet snapshot, staged and durably cancelled it, reloaded, re-staged it, explicitly authorized **SEND**, persisted **Preview only: not sent**, reloaded again, reset to a new revision-3 room, proved the original room absent, and cleaned the new room | VERIFIED IN PUBLIC BROWSER + VERCEL + SUPABASE; RESEND NOT CALLED |
| 2026-08-27 | 10 | Public production Chrome with a fake camera fetched the exact Google detector model plus same-origin worker and module WASM with HTTP 200, reached ready, then disabled input, detached the stream, ended the exact track, and emitted no failed requests, page errors, or unexpected application console errors | VERIFIED IN PUBLIC BROWSER; REAL HAND UNVERIFIED |
| 2026-08-27 | 10 | Final Supabase read-back returned zero room-scoped application rows after exact cleanup. One intentional `demo_vision_usage` aggregate remains because the successful public transform must count against the anti-abuse budget | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 10 | Vercel reported no production runtime errors or 5xx responses in the exercised window. The only 4xx entry was the deliberate GET probe of the POST-only `/api/rooms` boundary, which returned the expected HTTP 405 with the security headers | VERIFIED IN VERCEL PRODUCTION LOGS |
| 2026-08-27 | 10 | The first clean GitHub Actions run failed because `app/layout.tsx` referenced a Next-generated global type before `.next/types` existed. The layout now uses an explicit `ReactNode` contract; a clean typecheck with the entire `.next` directory moved aside passed | FAIL-BEFORE/FIXED; CLEAN TYPECHECK PASSED |
| 2026-08-27 | 10 | GitHub Actions reran the clean Node 22 checkout and passed the complete build/unit gate in 1m22s. GitHub's live release API identified `actions/checkout` v7.0.1 and `actions/setup-node` v7.0.0, so the workflow moved from v4 to the current v7 majors to remove the deprecated action-runtime annotation | GREEN CI; CURRENT ACTION MAJORS CONFIRMED |

## Checkpoint 1: local semantic canvas

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

## Checkpoint 2: semantic object system

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

## Checkpoint 3: WebMCP-native canvas operations

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
- The same native Chrome path returned the exact eight-tool catalog from the public Vercel production page.
- Ordinary Playwright Chromium without WebMCP displayed the honest fallback and retained the full canvas interaction suite.

### UNVERIFIED

- ChatGPT built-in-browser discovery and invocation against this deployed page.
- Chrome 153’s non-disruptive registration-lifecycle behavior; the installed target is Chrome 152.
- Actual agent- or user-triggered invocation cancellation across a network operation; signal identity and refusal behavior are unit-verified only.
- Dynamic registration churn on native Chrome or ChatGPT; static registration remains the default.
- Sketch, packet, and send adapters beyond their guarded/staged contracts.

### CUT

- The checkpoint introduced none of the globally locked CUT features.

## Checkpoint 4: Supabase persistence and realtime collaboration

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
- The complete two-browser room, Presence, cursor, participant mutation, revision, reload, and exact-cleanup sequence also passed against the public Vercel HTTPS route.

### UNVERIFIED

- A forced offline/online transport interruption without reloading. Reload-based session resume, durable reconstruction, and Realtime reconnection are verified.
- Outsider private-channel denial through the application UI. The equivalent deployed Supabase client path is verified; the React integration is not yet exercised.

### CUT

- The checkpoint introduced none of the globally locked CUT features.

## Checkpoint 5: preserved sketch to structured diagram

### WORKING

- Mouse, touch, and stylus strokes resolve to one typed `SketchObject` through the canonical create-command boundary. The original stroke coordinates remain part of the durable object payload.
- The browser renders a selected sketch to a bounded PNG locally. The server authenticates the anonymous room member, verifies current room membership and the exact active sketch version, and sends the PNG plus the bounded instruction to the configured vision model.
- The OpenAI Responses request uses image input, strict structured output, `store: false`, a privacy-preserving actor hash, cancellation propagation, and an allowlisted GPT-5.6 Sol/Terra model. Provider output is projected and Zod-validated before it can become a canvas object.
- A successful interpretation creates a separate typed diagram beside the source via the same authoritative room mutation service. It never overwrites or deletes the rough sketch.
- If live interpretation fails, the browser preserves the source and shows the exact provider-safe error before offering an optional deterministic demo interpretation. The fallback is a separate canonical object labeled **not generated by the vision model** and is never presented as provider output.
- The UI and WebMCP adapter share one transformation orchestrator. The UI is attributed as `typed`; a WebMCP invocation is attributed as `webmcp` and requires the exact selected active sketch.
- Durable receipt provenance now includes a non-null, actor-consistent `source` column. The source-aware service-only mutation RPC migration is deployed, and receipt reload no longer depends on request-local context.
- The complete Node 22 checkpoint gate passes: ESLint, TypeScript, 318 Vitest tests across 43 files, the separately bundled worker build, optimized Next.js production build, and `git diff --check`.

### VERIFIED IN BROWSER

- A production Chrome session created a real no-signup Supabase demo room, drew five pointer strokes, persisted one rough sketch, rasterized it to PNG, received HTTP 200 from the real authenticated transform route, and rendered one structured architecture diagram beside the still-present source.
- The live model described the unlabeled three-box source conservatively, returned a schema-valid three-node architecture, and did not invent a success fallback.
- Before and after a full page reload, the latest durable receipt remained `R5 · typed`; the source sketch receipt remained `R4 · pointer`. This closes the transient Realtime-versus-command-response provenance race discovered during the first live run.
- Both real vision runs emitted no page errors or application console errors. Each exact test room was identified, deleted through the privileged cleanup path, and verified absent.
- The resulting 1440×900 screenshots were visually inspected for source preservation, diagram structure, activity chronology, selection treatment, and rail overlap. A later narrow-viewport run verified automatic framing for both source and result.
- A forced HTTP 503 browser run stayed at revision 4 with the original sketch and no diagram, displayed **Sketch interpretation failed**, and offered **Load prepared demo interpretation**. Clicking it created a distinct revision-5 diagram and typed receipt while preserving the pointer-authored source; the final screenshot was visually inspected.
- The public Vercel route completed the real transform with HTTP 200, created a conservative schema-valid two-node diagram beside the four-stroke source, kept both objects visible at revision 5, and emitted no page or application console errors. The screenshot was visually inspected.

### UNVERIFIED

- A ChatGPT built-in-browser invocation of `transform_sketch` against the deployed public URL.
- Real WebMCP cancellation while an OpenAI request is in flight. Signal identity and cancellation refusal remain unit-verified only.
- Vision interpretation of handwriting or a camera-authored multi-stroke sketch; the live source used unlabeled geometric strokes.

### CUT

- The checkpoint introduced none of the globally locked CUT features.

## Checkpoint 6: local hand input (browser pipeline verified; real hand pending)

### WORKING

- `@mediapipe/tasks-vision@1.0.1` is pinned. The worker and required WASM variants are served from same-origin public assets; the versioned Hand Landmarker model is fetched from the exact Google-hosted URL used by the official sample only after the user enables hand input.
- Runtime inference remains inside the browser. Camera frames are not uploaded to Google, the application server, Supabase, OpenAI, ChatGPT, or WebMCP; the only third-party camera-path request is the disclosed detector-model download.
- A separately bundled module worker initializes `FilesetResolver` and `HandLandmarker` in `VIDEO` mode for one hand. Only one transferred `ImageBitmap` may be in flight, and each worker frame is closed after inference.
- Camera access begins only after the accessible **Enable hand input** action. Disable/unmount stops media tracks, clears the video source, disposes the detector, terminates the worker, and leaves pointer input active.
- The landmark reducer recognizes only the locked MVP vocabulary: stable index pointing and pinch. Point observations become a canonical gesture-authored sketch command; pinch selects, previews, and commits one canonical object move on release. Pinned objects are selected but not moved.
- The visible camera panel states that frames stay in the browser and distinguishes off, starting, ready, permission-refused, and unavailable states. A ready detector with no recognized hand says **Show one hand to begin** rather than claiming detection.

### VERIFIED IN BROWSER

- Production Chrome with a fake camera device exercised actual permission, one `getUserMedia` call, one live video track, the same-origin worker, local module JavaScript/WASM, and the versioned Google-hosted detector model. Every required network response returned HTTP 200, and the model response allowed cross-origin use.
- The real worker reached **Hand input ready · local only**. Disable returned the UI to **Camera off · pointer active**, detached the video stream, and changed the exact media track from `live` to `ended`.
- The browser run emitted no page errors, failed requests, or unexpected application console errors. MediaPipe's CPU delegate informational line was classified as provider diagnostics, not an application error.

### UNVERIFIED

- Recognition accuracy, stability, latency, point drawing, and pinch movement with an actual human hand and physical webcam. These are not claimed from the fake-media readiness test.
- Camera behavior on Safari, mobile Chrome, a low-power device, or a browser without module-worker/WASM support.

### CUT

- Two-hand resize, swipe or throw, gesture erase, gesture-only discard, physical pencil or marker tracking, and continuous raw-camera upload remain cut.

## Checkpoint 7: durable vision admission and human-authorized packet delivery

### WORKING

- Vision transforms use a deterministic request key derived from room, sketch identity/version, output kind, normalized instruction hash, and PNG-byte hash. A service-only admission boundary enforces one active lease per room, a two-per-minute actor limit, three lifetime demo transforms, twenty daily standard-room transforms, exact-result caching, and lease-token compare-and-set completion/release.
- The vision route caps its complete JSON request at 4 MB and decoded PNG bytes at 2 MB, leaving explicit headroom below [Vercel Functions' documented 4.5 MB request limit](https://vercel.com/docs/functions/limitations#request-body-size).
- Packet preparation persists an exact semantic-object content snapshot. Host approval locks that content hash and an editable recipient snapshot; staging copies the approved packet version, hashes, and recipients into a durable send request.
- The WebMCP send operation stages an external action only. The site renders the authoritative snapshot and requires the host to press **SEND** before the server can authorize delivery.
- Cancellation is a durable, idempotent state transition with one immutable `packet_send_cancelled` receipt. A cancelled request cannot later be authorized.
- With Resend configuration absent, execution persists and displays an honest preview-only record. No UI or receipt claims that an email was delivered.
- Cancelled, failed, expired, or preview-only send requests can be re-staged from the same still-approved immutable packet snapshot. A successfully submitted packet requires a changed draft and new approval before another send can be staged.
- Deterministic demo fixture IDs include the room ID, so independent rooms cannot collide on the global canvas-object primary key.

### VERIFIED IN BROWSER

- Exact packet content and recipient snapshots were visible before approval and again at send confirmation.
- The cancel path persisted `cancelled`, rendered `Send request cancelled: no email was sent`, and refused a deliberately attempted post-cancel execute with HTTP 409.
- The explicit-send path persisted `preview_only`, rendered `Preview only: not sent`, and created packet activity in this order: prepared, draft updated, approved, send staged, send previewed.
- The full cancel, re-stage, explicit preview execution, reload, and reset sequence completed in one production-browser run. The cancelled request and preview-only request both survived reload, and reset deleted the exact former hosted room before creating a new revision-3 fixture room.
- The same full packet path passed against public Vercel HTTPS. The public environment retained the explicit host confirmation and persisted the honest preview-only outcome; no Resend request was made.
- The narrow 420×900 vision run kept both rough and structured artifacts visibly inside the canvas viewport. The live provider output was admitted once and stored as a schema-valid three-node/two-edge architecture diagram.
- One earlier local `host.docker.internal` test used an initialization shim because that insecure harness origin withholds `crypto.randomUUID`; product code was not changed. The public Vercel HTTPS runs required no shim and passed through the browser-native secure-context path.

### UNVERIFIED

- Real Resend provider submission or delivery. No Resend credentials are configured in the current environment, so only the truthful preview-only contract is verified.
- Concurrent Vercel instances contending for the same vision lease; the database serialization contract is SQL- and unit-verified.

### CUT

- The checkpoint introduced none of the globally locked CUT features.

## Checkpoint 8: public judge release

### WORKING

- The public GitHub repository is <https://github.com/romiteld/commandcanvas>. Release commits are authored only by Daniel Romitelli and contain no coauthor or AI-attribution trailers.
- The canonical no-signup judge route is <https://commandcanvas.vercel.app/demo>. Vercel builds it with Node 22 from the linked public `main` branch.
- Production and preview contain the required Supabase, OpenAI, model, and WebMCP configuration. Private values remain server-side and were supplied without entering the repository or command output.
- Resend is intentionally absent from the public environment. The packet path therefore records **Preview only: not sent** after explicit host authorization and never claims delivery.
- GitHub Actions runs the locked Node 22 build and unit gate on `main` pushes and pull requests.

### VERIFIED IN BROWSER

- Ordinary public Chrome: no-signup anonymous room initialization, deterministic three-object fixture, accessible pointer controls, honest **Site Tools unavailable** state, packet workflow, preview-only send, reload, and reset.
- Two independent public browser contexts: actual Supabase Presence, cursor Broadcast, participant mutation, durable revision convergence, participant reload, and exact cleanup.
- Public Chrome with the WebMCP testing feature: native `document.modelContext` discovery and the exact eight-tool catalog.
- Public Chrome vision path: pointer sketch, browser PNG, Vercel function, real GPT-5.6 Terra structured output, validated diagram beside preserved source, visible revision receipts, and exact cleanup.
- Production Chrome failure path before deployment: explicit transform failure, preserved source, opt-in prepared interpretation labeled as not model-generated, separate mutation, and receipt.
- Public Chrome fake-camera path: permission, Google model fetch, same-origin worker/WASM, ready state, exact media-track shutdown, and pointer fallback.
- Public `/demo` and API refusal responses include the intended security headers. Vercel reported no runtime errors or 5xx responses during the exercised release window.

### UNVERIFIED

- ChatGPT built-in-browser discovery or tool invocation. Rollout access was not available in this environment.
- Chrome 153 lifecycle behavior. The installed target is Chrome 152 with its WebMCP testing feature.
- Real human-hand pointing/pinch accuracy and physical-camera latency across lighting, webcams, and devices.
- Real Resend submission or delivery. The public environment is intentionally preview-only.
- Physical touch/stylus hardware, Safari, mobile Chrome camera inference, and a forced network transport outage without reload.

### CUT

- Group/ungroup, redo, complex multi-select, frame hierarchy, rotation, two-hand resize, swipe/throw, gesture-only destructive actions, and physical pencil/marker tracking.
- Video conferencing, conferencing-platform integrations, enterprise identity, broad document-suite integrations, billing, native apps, headsets, a plugin marketplace, and desktop automation.
