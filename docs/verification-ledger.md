# CommandCanvas verification ledger

This ledger records observed behavior only. An integration remains **UNVERIFIED** until it has been exercised against the named service or browser. “Working” means covered by automated checks or local runtime evidence; “Verified in browser” requires an observed browser interaction. Checkpoint sections are time-scoped; the newest checkpoint supersedes an earlier checkpoint's remaining-boundary list. Evidence from an earlier release does not transfer automatically to later source changes. In particular, local-only camera statements in historical checkpoints describe those earlier releases; Checkpoint 19 records the current explicit-consent private-relay boundary.

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

### CUT AT THIS CHECKPOINT

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
| 2026-08-27 | 3 | Chrome 152 testing feature exposed native `document.modelContext`; `getTools()` returned the exact then-current eight-tool catalog with no page errors | VERIFIED IN CHROME 152 TEST MODE |
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
| 2026-08-27 | 10 | Installed Chrome 152 loaded the public production page with its WebMCP feature and native `document.modelContext.getTools()` returned the exact then-current eight-tool catalog | VERIFIED IN PUBLIC CHROME 152 TEST MODE |
| 2026-08-27 | 10 | Public production Chrome drew a real four-stroke sketch, received HTTP 200 from the Vercel vision function and GPT-5.6 Terra, preserved the source, rendered a conservative two-node structured diagram, showed revision-5 provenance, emitted zero page/application console errors, and deleted the exact room | VERIFIED IN PUBLIC BROWSER + VERCEL + OPENAI + SUPABASE |
| 2026-08-27 | 10 | Public production Chrome prepared and approved the exact packet snapshot, staged and durably cancelled it, reloaded, re-staged it, explicitly authorized **SEND**, persisted **Preview only: not sent**, reloaded again, reset to a new revision-3 room, proved the original room absent, and cleaned the new room | VERIFIED IN PUBLIC BROWSER + VERCEL + SUPABASE; RESEND NOT CALLED |
| 2026-08-27 | 10 | Public production Chrome with a fake camera fetched the exact Google detector model plus same-origin worker and module WASM with HTTP 200, reached ready, then disabled input, detached the stream, ended the exact track, and emitted no failed requests, page errors, or unexpected application console errors | VERIFIED IN PUBLIC BROWSER; REAL HAND UNVERIFIED |
| 2026-08-27 | 10 | Final Supabase read-back returned zero room-scoped application rows after exact cleanup. One intentional `demo_vision_usage` aggregate remains because the successful public transform must count against the anti-abuse budget | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 10 | Vercel reported no production runtime errors or 5xx responses in the exercised window. The only 4xx entry was the deliberate GET probe of the POST-only `/api/rooms` boundary, which returned the expected HTTP 405 with the security headers | VERIFIED IN VERCEL PRODUCTION LOGS |
| 2026-08-27 | 10 | The first clean GitHub Actions run failed because `app/layout.tsx` referenced a Next-generated global type before `.next/types` existed. The layout now uses an explicit `ReactNode` contract; a clean typecheck with the entire `.next` directory moved aside passed | FAIL-BEFORE/FIXED; CLEAN TYPECHECK PASSED |
| 2026-08-27 | 10 | GitHub Actions reran the clean Node 22 checkout and passed the complete build/unit gate in 1m22s. GitHub's live release API identified `actions/checkout` v7.0.1 and `actions/setup-node` v7.0.0, so the workflow moved from v4 to the current v7 majors to remove the deprecated action-runtime annotation | GREEN CI; CURRENT ACTION MAJORS CONFIRMED |
| 2026-08-27 | 11 | An isolated official Chrome for Testing 153.0.8010.5 binary, launched with `--enable-features=WebMCP`, exercised native `document.modelContext.executeTool(...)` against public `/demo`: state read, durable note and sketch creation, visible `webmcp` receipt, client-side in-flight cancellation before server admission with `AbortError`, unchanged revision, and exact room cleanup | VERIFIED IN PUBLIC CHROME 153 + DEPLOYED SUPABASE |
| 2026-08-27 | 11 | The same Chrome 153 binary exercised a local production bundle built with `NEXT_PUBLIC_WEBMCP_DYNAMIC_REGISTRATION=true` while only allowlisted room APIs were proxied to the canonical production origin: six initial tools, selection-driven `transform_sketch` registration/removal, native `toolchange`, registration-lifecycle separation from an in-flight invocation, client-side invocation cancellation, and exact cleanup | VERIFIED IN CHROME 153 LOCAL PRODUCTION BUNDLE + DEPLOYED API; PUBLIC DYNAMIC ORIGIN PENDING |
| 2026-08-27 | 11 | Test-first direct human commands now create and manipulate semantic objects through the canonical `typed` or `voice` source. A production Chromium run injected a deterministic Web Speech provider, verified that the transcript remained reviewable and caused no mutation until **Run**, then observed `R1 · voice` | VERIFIED IN BROWSER WITH DETERMINISTIC SPEECH PROVIDER; REAL MICROPHONE/SPEECH SERVICE UNVERIFIED |
| 2026-08-27 | 11 | Chromium CDP emitted trusted browser touch and pen sequences into the real sketch surface, producing canonical `R1 · touch` and `R2 · stylus` receipts. An iPhone-profile WebKit run kept the ordinary-browser canvas usable with no horizontal overflow or page errors | VERIFIED IN CHROMIUM + PLAYWRIGHT WEBKIT PROFILE; PHYSICAL HARDWARE UNVERIFIED |
| 2026-08-27 | 11 | Two real no-signup browser sessions connected to deployed Supabase Realtime. The participant browser was forced offline and back online without reload; the current client replaced its private channel, returned to two-person Presence, resumed cursor Broadcast and durable mutation convergence, then deleted the exact room | VERIFIED IN LOCAL PRODUCTION CLIENT + DEPLOYED API + LIVE SUPABASE REALTIME |
| 2026-08-27 | 11 | A post-cleanup Supabase SQL read-back returned zero rows in every room-scoped public/private table; the single intentional `demo_vision_usage` aggregate remains | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 11 | Resend account metadata showed a verified sending domain, but neither the linked Vercel project nor this checkout contains the required Resend key/sender/recipient-allowlist configuration. The application therefore remains truthfully preview-only; no provider request was made | PROVIDER CONFIGURATION BLOCKED; NO DELIVERY CLAIM |
| 2026-08-27 | 12 | Exact Node 22.17.0 release gate: ESLint, TypeScript, 523 Vitest tests across 60 files, hand-worker bundle, optimized Next.js production build, `git diff --check`, and production dependency audit completed with zero failures or vulnerabilities | WORKING |
| 2026-08-27 | 12 | Fresh production build plus the ordinary Playwright matrix completed 15 exercised scenarios with 17 deliberate project/credential skips and zero failures: Chromium desktop/mobile, trusted touch and pen, deterministic reviewed speech, WebKit iPhone-profile fallback, Realtime recovery, and native-surface registration | VERIFIED IN BROWSER |
| 2026-08-27 | 12 | Two live no-signup Chromium sessions crossed an actual offline/online transition without reload, re-established two-person Presence, exchanged a cursor, converged on a durable participant mutation, reconstructed revision 4 after participant reload, accepted that reloaded participant's next cursor immediately, and deleted the exact room | VERIFIED IN LOCAL PRODUCTION CLIENT + DEPLOYED API + LIVE SUPABASE REALTIME |
| 2026-08-27 | 12 | Official Chrome for Testing 153.0.8010.5 exercised the exact source as both stable-static and feature-flagged-dynamic production bundles. Native execution, abort handling before server admission, selection-driven registration/removal, `toolchange`, lifecycle separation, and exact cleanup passed in both named modes | VERIFIED IN CHROME 153 LOCAL PRODUCTION BUNDLES + DEPLOYED API |
| 2026-08-27 | 12 | Final Supabase read-back returned zero rows across every room-scoped public/private table after the browser probes; one intentional aggregate `demo_vision_usage` row remains | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 13 | Public GitHub commit `88aad9b19add21c3ff6d3836655006ed637ebfbf` and GitHub Actions run `33113760297` completed the clean Node 22 CI gate successfully | VERIFIED IN PUBLIC GITHUB + GREEN CI |
| 2026-08-27 | 13 | Vercel production deployment `dpl_6gDpLPYRF1sRLsneEWUrZn55BhG5` reports the exact `88aad9b` implementation commit, Node.js lambdas, READY state, and the canonical `commandcanvas.vercel.app` alias. Public `/demo` returned HTTP 200 with HSTS, frame, MIME-sniffing, referrer, and camera/microphone policy headers | VERIFIED IN VERCEL PRODUCTION |
| 2026-08-27 | 13 | The exact public origin passed 10 focused desktop/mobile Chromium UI scenarios, one live two-browser Supabase offline/reload/cursor/durable-collaboration scenario, and one strict official Chrome 153 native WebMCP lifecycle scenario; all probe rooms were deleted | VERIFIED IN PUBLIC BROWSER + CHROME 153 + SUPABASE REALTIME |
| 2026-08-27 | 13 | Vercel reported no build errors, runtime error clusters, 4xx, or 5xx entries for the exact deployment during the exercised release window. Observed function requests were successful 200/201 responses | VERIFIED IN VERCEL PRODUCTION LOGS |
| 2026-08-27 | 13 | Supabase advisors returned no error-level finding. Security WARN/INFO entries reflect the intentional anonymous-auth demo policies, fail-closed private tables, and disabled leaked-password screening for an app with no password signup. Performance INFO entries identify two low-volume private foreign keys without covering indexes, one unused early index, and a fixed Auth connection allocation | REVIEWED; NON-BLOCKING HARDENING ITEMS RECORDED |
| 2026-08-27 | 13 | Post-release SQL read-back returned zero rows in all room-scoped public/private application tables; the single intentional `demo_vision_usage` aggregate remains | VERIFIED IN DEPLOYED SUPABASE |
| 2026-08-27 | 15 | The integrated Node 22 gate completed all 655 Vitest tests and an optimized Next.js production build with zero failures | WORKING |
| 2026-08-27 | 15 | Two independent no-signup Chromium contexts established real Supabase Presence and durable collaboration, then exchanged live local and remote WebRTC audio/video tracks after both opted in; camera disable, peer leave, and exact room cleanup passed | VERIFIED IN CONTROLLED TWO-BROWSER RUNTIME + DEPLOYED SUPABASE; PHYSICAL DEVICES AND CROSS-NETWORK PATH UNVERIFIED |
| 2026-08-27 | 15 | A real paid `gpt-realtime-2.1` WebRTC session heard the controlled audio request “Bring in our project board,” invoked the narrow `create_board` tool, created the canonical `R4 · voice` receipt, and left no browser error | VERIFIED IN CHROMIUM + OPENAI REALTIME + DEPLOYED SUPABASE; PHYSICAL MICROPHONE UNVERIFIED |
| 2026-08-27 | 15 | A standards-shaped injected `document.modelContext` invoked `get_canvas_state` and `transform_sketch`; the browser rasterized the selected sketch, the real OpenAI vision route returned schema-valid nodes and edges, and the preserved source plus `R5 · webmcp` diagram rendered together | VERIFIED IN CHROMIUM + OPENAI VISION + DEPLOYED SUPABASE; NATIVE SITE TOOLS HOST UNVERIFIED |
| 2026-08-27 | 15 | WebKit and Chromium initialized the DOM-free hand worker, including the explicit OffscreenCanvas fallback contract. Chromium fake-camera exercised permission, worker/WASM/model loading, live track attachment, disable, detachment, and exact track shutdown | VERIFIED IN PLAYWRIGHT WEBKIT/CHROMIUM; PHYSICAL IPHONE AND REAL HAND UNVERIFIED |

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

- The then-current central phase table controlled eight stable tools: canvas read, object create/transform/state/discard, sketch transformation, packet preparation, and staged packet-send request. Checkpoint 15 records the later ten-tool catalog.
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
- Installed Google Chrome 152.0.7977.64 launched with its WebMCP testing feature, exposed the native `document.modelContext` surface, displayed the then-current `8 Site Tools registered`, and returned that catalog from native `getTools()` with no page errors.
- The same native Chrome path returned the exact then-current eight-tool catalog from the public Vercel production page.
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

- The public GitHub repository is <https://github.com/romiteld/commandcanvas>.
- The canonical no-signup judge route is <https://commandcanvas.vercel.app/demo>. Vercel builds it with Node 22 from the linked public `main` branch.
- Production and preview contain the required Supabase, OpenAI, model, and WebMCP configuration. Private values remain server-side and were supplied without entering the repository or command output.
- Resend is intentionally absent from the public environment. The packet path therefore records **Preview only: not sent** after explicit host authorization and never claims delivery.
- GitHub Actions runs the locked Node 22 build and unit gate on `main` pushes and pull requests.

### VERIFIED IN BROWSER

- Ordinary public Chrome: no-signup anonymous room initialization, deterministic three-object fixture, accessible pointer controls, honest **Site Tools unavailable** state, packet workflow, preview-only send, reload, and reset.
- Two independent public browser contexts: actual Supabase Presence, cursor Broadcast, participant mutation, durable revision convergence, participant reload, and exact cleanup.
- Public Chrome with the WebMCP testing feature: native `document.modelContext` discovery and the exact then-current eight-tool catalog.
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

- At checkpoint 8, group/ungroup, redo, complex multi-select, frame hierarchy, rotation, two-hand resize, swipe/throw, gesture-only destructive actions, and physical pencil/marker tracking were cut. Checkpoint 15 records the later restoration of grouping, ungrouping, redo, multi-select, nested semantic frames, rotation, two-hand resize, and reviewed edge actions. Physical marker tracking and gesture-only destructive commits remain outside the release candidate.
- Video conferencing, conferencing-platform integrations, enterprise identity, broad document-suite integrations, billing, native apps, headsets, a plugin marketplace, and desktop automation.

## Checkpoint 11: environment-specific hardening

### WORKING

- The command rail now includes a deliberately bounded **Human command** control. Typed text and reviewed browser speech transcripts map only to the approved create/select-state/sketch/undo intents; agent, packet, and email actions remain on the WebMCP and explicit site-authorization path.
- Browser speech support is resolved after hydration so server rendering cannot permanently mark a capable browser as unsupported. Recognition produces one bounded final transcript, never auto-executes it, and retains typed input when permission, capture, provider access, or browser support fails.
- Direct discard requires a second confirmation bound to the exact object ID, title, and version the human reviewed. A changed or deleted target is refused; an accepted discard remains recoverable through the canonical receipt/undo path.
- The hand-input panel records point and pinch observations separately for the current camera session, including bounded confidence. It resets when the session stops or fails and reports only that the self-check completed after both gestures were detected.
- Realtime listens for browser offline/online lifecycle events. Recovery removes and untracks the failed private channel, refreshes Realtime authorization, recreates the exact room channel, retracks Presence, coalesces duplicate work, ignores stale asynchronous callbacks, and applies bounded retries to initial, terminal, track, and replacement failures.
- Cursor ordering starts from a per-controller time epoch so the first cursor after a participant reload is not rejected behind the prior session's sequence. Supabase `TOKEN_REFRESHED` rotates all room, vision, packet, and future Realtime-recovery credentials without reload.
- Live probes capture the created room from the earliest successful API response, recover the room ID again during teardown, close browser contexts even if deletion fails, default WebMCP probing to loopback, and require an explicit opt-in for a public target. API proxying is restricted to the canonical production origin and the probe's named room endpoints.
- Dedicated Playwright configurations cover ordinary Chromium, mobile Chromium, an iPhone-profile WebKit runtime, installed/native Chrome, and a strict official Chrome 153 release probe.

### VERIFIED IN BROWSER

- Official Chrome for Testing 153.0.8010.5: current `document.modelContext` present, deprecated navigator surface absent, native tool execution, cancellation, stable registration, dynamic registration, `toolchange`, and registration-lifecycle separation all passed in their explicitly named static or dynamic environment.
- Chromium production browser: a deterministic speech provider placed a transcript into the input without mutating the canvas; the later human **Run** action created the board with a `voice` receipt.
- Chromium production browser: browser-trusted touch and pen pointer sequences reached the sketch composer and produced distinct canonical source receipts.
- Playwright WebKit 26.5 under the iPhone 15 profile: ordinary-browser fallback, canvas visibility, tap creation, receipt visibility, no page error, and no horizontal document overflow passed.
- Live Supabase Realtime: two anonymous authenticated browsers established real Presence, one browser crossed an actual Playwright network outage without reload, then Presence, cursor Broadcast, durable Postgres mutation, and revision convergence resumed before exact cleanup.
- Public Chrome's fake-camera pipeline evidence remains valid for permission, worker/WASM/model loading, ready state, and shutdown. The new point/pinch self-check is component-tested, not represented as physical-hand evidence.

### UNVERIFIED

- ChatGPT built-in-browser Site Tools discovery, selection, confirmation UI, or invocation. No accessible built-in-browser rollout surface was available from this environment.
- Dynamic registration at a public HTTPS deployment origin. It passed in a local production bundle backed by deployed APIs; public production intentionally remains in stable static mode until a separate dynamic deployment is exercised.
- A real microphone plus the browser's external speech-recognition service. The production-browser test used an explicitly deterministic provider; typed commands are the guaranteed fallback.
- Physical human-hand pointing/pinch accuracy, camera-to-canvas latency, lighting/occlusion behavior, and actual camera hardware. This host exposes no `/dev/video*` capture device.
- Physical iPhone/iPad/Android touch, pressure/tilt/palm rejection on a real stylus, and mobile-camera inference. Playwright input and device profiles do not establish hardware ergonomics.
- Real Resend submission or delivery. Creating a least-privilege provider key and transferring it into Vercel without exposing the one-time token requires a secure dashboard action by the account owner.

### CUT

- At checkpoint 11, group/ungroup, redo, complex multi-select, hierarchy, rotation, two-hand resize, swipe/throw, gesture-only destructive action, physical marker tracking, conferencing, enterprise identity, broad integration, billing, native-app, headset, marketplace, and desktop-automation work remained outside that release.

## Checkpoint 12: release-candidate verification

### WORKING

- The bounded human-command parser, reviewed speech lifecycle, exact-target discard confirmation, session-local camera self-check, token-refresh propagation, bounded Realtime recovery, reload-safe cursor ordering, and guarded live-probe infrastructure are integrated in one release candidate.
- Duplicate browser `online` signals remain coalesced until a replacement channel reaches successful Presence tracking or a terminal outcome. The Chromium race was reproduced before the controller fix and is now covered by both unit and browser regressions without weakening the E2E assertion.
- The root gate was rerun from the pinned Node 22.17.0 binary after all integration changes: 60 test files and 523 tests passed, along with ESLint, TypeScript, the worker bundle, optimized production build, diff validation, and a zero-vulnerability production dependency audit.
- A credential-pattern scan found no credential-shaped addition in the release-candidate diff.

### VERIFIED IN BROWSER

- The fresh static production bundle passed 15 ordinary-browser scenarios with no failures. The exercised boundaries include desktop/mobile Chromium, deterministic reviewed speech, named pointer controls, trusted touch and pen input, WebKit iPhone-profile fallback, offline/online controller recovery, and native-surface registration.
- A fresh two-browser run against deployed Supabase verified real anonymous identities, private Presence, cursor Broadcast, transport recovery, durable collaboration, late reconstruction, post-reload cursor ordering, and exact room deletion.
- Official Chrome for Testing 153.0.8010.5 passed the strict native WebMCP probe against both fresh static and dynamic production bundles. The public API proxy was restricted to the canonical production origin and only the probe's exact room endpoints.
- Post-probe SQL read-back found no remaining room, membership, object, receipt, packet, share, send-request, capability, or sketch-attempt rows.

### UNVERIFIED

- The integrated release-candidate bytes have not yet been pushed and deployed. GitHub Actions, exact-commit Vercel deployment, the canonical public alias, and public-origin reruns remain release steps rather than completed evidence at this checkpoint.
- ChatGPT built-in-browser discovery or invocation remains unavailable in this environment.
- A real microphone/provider path, physical hand/camera behavior, physical touch/stylus hardware, and real Resend submission/delivery remain unverified at their named external boundaries.

### CUT

- The global scope lock remains unchanged; no cut feature was reintroduced during hardening.

## Checkpoint 13: public release verification

### WORKING

- The public repository is <https://github.com/romiteld/commandcanvas>, `main` contains implementation commit `88aad9b19add21c3ff6d3836655006ed637ebfbf`, and its clean GitHub Actions run is green.
- Vercel's production deployment metadata and canonical alias both resolve to that implementation commit. The deployment is READY and its exercised runtime window contains no build error, runtime error cluster, 4xx, or 5xx entry.
- The public route returns the expected no-signup title and security headers. Resend configuration remains absent, so explicit **SEND** continues to produce only the honest preview-only outcome and no provider call.
- Supabase's current advisor output contains WARN/INFO items but no error-level finding. Anonymous-auth access is intentional and remains constrained by the already-exercised membership/host RLS policies; private tables expose no client policies.

### VERIFIED IN BROWSER

- Public `https://commandcanvas.vercel.app` passed 10 focused Chromium UI scenarios on desktop/mobile, including bounded typed and reviewed voice commands, semantic creation, spatial interaction, exact-target recoverable discard, undo, and visible receipts.
- Two independent public `/demo` contexts established actual Supabase Presence, crossed an offline/online transition without reload, resumed cursor Broadcast, converged on a participant mutation, reconstructed durable state after reload, accepted the reloaded participant's next cursor immediately, and removed the exact room.
- Official Chrome for Testing 153.0.8010.5 loaded the public HTTPS origin with WebMCP enabled and passed native tool discovery/execution, client cancellation before server admission, lifecycle handling, visible receipt behavior, and exact cleanup in stable static-registration mode.

### UNVERIFIED

- ChatGPT built-in-browser Site Tools discovery or invocation remains unavailable in this environment.
- Dynamic registration has been verified in the fresh production bundle and Chrome 153 but not at a public HTTPS deployment origin. Public production remains intentionally static.
- A real microphone/provider path, physical hand/camera behavior, physical touch/stylus hardware, and real Resend submission/delivery remain unverified at their named boundaries.
- Supabase leaked-password screening is disabled and two private foreign keys lack covering indexes. Neither affects the anonymous-only judge path at current scale, but both should be revisited before adding password accounts or production-scale retention.

### CUT

- The final release retains the approved scope lock. No cut feature was added.

## Checkpoint 14: optional small-room meeting media hardening

### WORKING

- Meeting media is opt-in. The controller does not request a camera or microphone on mount, and the visible action names both devices before permission is requested.
- CommandCanvas reuses the canonical authenticated room-membership UUID and actual Presence participant set for the local and allowed peer identities. Signaling uses the dedicated private `room-media:<uuid>` topic; application clients strictly validate and size-bound SDP and ICE envelopes before processing them.
- Supabase Broadcast acknowledgements are enabled. A non-`ok` send result and terminal channel status both produce a truthful **Signaling lost** state instead of claiming that new peer negotiation remains available.
- Direct media refuses to start when more than four people are present and synchronously stops active tracks if a fifth participant joins. Per-peer pre-description ICE is deduplicated and capped at 128 candidates.
- Stop, unmount disposal, and capacity refusal synchronously detach the channel, close peers, and stop acquired local and remote tracks before best-effort departure signaling and channel removal. Those signaling operations are bounded to 500 ms each, and a stalled authorization attempt cannot keep acquired device tracks alive after disposal.
- React Strict Mode controller recreation and remote-video autoplay rejection/recovery have behavioral component coverage. The current focused gate passes 78 meeting, room-integration, and bootstrap tests, scoped ESLint, Playwright test discovery, and diff validation. A whole-repository TypeScript pass is not claimed at this checkpoint because concurrently added WebMCP test fixtures are temporarily ahead of their catalog types; the meeting-media files introduced no reported TypeScript diagnostic.

### VERIFIED IN BROWSER

- None for the integrated meeting-media slice yet. The opt-in Playwright scenario is discoverable but deliberately requires the live Supabase E2E environment before it will execute.

### UNVERIFIED

- Actual two-browser audio/video exchange through the integrated UI, audible remote playback, camera/microphone shutdown in a real browser, and the current public Vercel deployment.
- Physical camera and microphone behavior on desktop or mobile devices, including the reported iPhone environment.
- Connectivity across arbitrary networks. The current direct-peer configuration uses Google STUN and no TURN relay, so restrictive or symmetric NATs can prevent a connection. ICE negotiation can disclose network-address information to authorized room participants, and Google observes STUN traversal requests.
- Strong remote identity authentication. Private-topic RLS proves that a publisher is some authenticated room member, but the Broadcast payload's `senderId` is not cryptographically bound to that publisher's authenticated UUID.
- Perfect-negotiation glare handling, automatic ICE restart/reconnection after direct-peer failure, multi-tab same-identity collisions, and sharing one physical camera capture between meeting video and hand tracking.

### CUT

- TURN or SFU infrastructure, recording, screen sharing, production conferencing scale, more than four media participants, conferencing-platform integrations, and hidden media capture remain outside this slice.

## Checkpoint 15: canvas-first enhancement release candidate

### WORKING

- The current WebMCP catalog contains ten tools: `get_canvas_state`, `create_object`, `transform_object`, `set_object_state`, `discard_object`, `organize_objects`, `history_action`, `transform_sketch`, `prepare_meeting_packet`, and `request_packet_send`. Static and dynamic registration use the same execute-time guards.
- The optional Live voice control creates a regular `gpt-realtime-2.1` WebRTC session after an explicit user start. Its narrower tool catalog can create safe canvas objects, manipulate selected objects, focus locally, group, ungroup, rotate, undo, redo, and transform a selected sketch. It cannot discard objects, operate rooms, approve packets, stage email, or send email. Except for local-only focus, submitted tool output is not represented as completed until the shared mutation receipt arrives.
- Paid voice admission is server-only, restricted to demo-room members, durably rate-limited, and bounded to a ten-minute client session. The separately budgeted provider key never reaches the browser.
- Modifier and touch-friendly multi-selection, nested semantic grouping and ungrouping, 15-degree rotation, and shared undo/redo use the canonical command, revision, receipt, persistence, and collaboration paths. Moving or rotating an outer frame transforms its descendants in the same mutation and receipt.
- The spatial gesture engine maps index pointing to drawing, one-hand pinch to grab and move, two-hand pinch span to resize, and open-palm dwell to focus or restore. Fast held-object motion through either side edge commits recoverable trash after a visible exit animation without a drawer; the blue bottom dock minimizes. Universal Undo reverses either command.
- Optional meeting media uses a dedicated private `room-media:<uuid>` Broadcast topic, separate from the Presence/cursor channel. Media starts only after explicit camera-and-microphone consent and travels peer-to-peer. SDP and ICE inputs are schema- and size-bounded, pending ICE is capped and deduplicated, local teardown is synchronous, and signaling cleanup is best effort and bounded.
- Camera frames for hand tracking stay local. Live voice microphone audio reaches OpenAI only while Live voice is on. Meeting audio and video travel only between connected peers. Public Vercel remains preview-only for packet delivery, while a separately controlled local provider run used an allowlisted author address.
- The integrated Node 22 gate completed 693 of 693 unit tests and an optimized production build with zero failures.

### VERIFIED IN BROWSER

- Two independent no-signup Chromium contexts established actual Supabase Presence, shared durable mutations, and revision convergence. After both participants explicitly started meeting media, each rendered live local and remote audio/video tracks. Camera disable, peer leave, track cleanup, and exact room cleanup passed in the controlled test-host environment.
- A real paid `gpt-realtime-2.1` WebRTC session reached Listening, transcribed the controlled spoken request **Bring in our project board**, invoked `create_board`, rendered the board, and produced `R4 · voice` with no page error.
- An injected standards-shaped `document.modelContext` registered the current tools, read the selected sketch ID, invoked `transform_sketch`, and completed the real OpenAI vision path. The browser-generated PNG produced schema-valid nodes and edges, while the original sketch and `R5 · webmcp` diagram remained visible together.
- The DOM-free hand worker initialized in Playwright WebKit and Chromium. The explicit no-OffscreenCanvas fallback returned its named in-page fallback signal. Chromium fake-camera also exercised permission, worker/WASM/model retrieval, live track attachment, disable, detachment, and ended-track cleanup.
- Behavioral browser and component paths exercised visible open-palm and bimanual states, two-hand resize submission, direct side-edge recoverable trash, bottom-dock minimize, and universal Undo through the canonical mutation boundary. Ten independent hand-drawn lines remained one sketch and opened no drawers. This proves the browser state machine and feedback, not physical-hand accuracy.
- A no-signup host prepared a packet, edited the recipient to the exact allowlisted author address, saved the draft, approved the immutable snapshot, staged the request, and pressed explicit **SEND**. The route returned `mode: resend`, `status: submitted`, and a provider message ID. A fresh Resend account query then reported the **CommandCanvas meeting packet** as delivered. The exact test room was deleted afterward.

### UNVERIFIED

- The enhancement source has not been pushed and promoted to the canonical Vercel deployment. The public URL still represents the earlier verified release, not this checkpoint.
- Native Chrome 153 discovery, invocation, cancellation, or lifecycle behavior against the current ten-tool source is unverified. Earlier Chrome 153 evidence applies only to the earlier eight-tool release checkpoint.
- ChatGPT built-in-browser Site Tools discovery, selection, confirmation UI, and invocation remain unverified. The paid Realtime voice provider run is a different product boundary and does not establish Site Tools behavior.
- Physical iPhone or other mobile-device camera, microphone, touch, and media behavior remain unverified. The current browser evidence used emulated profiles, controlled audio, and fake-camera inputs.
- Physical human-hand pointing, pinch, bimanual resize, open-palm dwell, and edge-motion accuracy across lighting, occlusion, webcams, and mobile hardware remain unverified.
- Cross-network peer-to-peer media remains unverified. No TURN relay or SFU exists, so restrictive or symmetric NATs may fail. ICE can disclose network-address information to authorized room participants, and the configured STUN provider observes traversal requests.
- The media payload `senderId` is not cryptographically bound to the authenticated Realtime publisher. Private-topic RLS proves room membership, not strong remote participant identity.
- The canonical public Vercel origin remains preview-only because no dedicated CommandCanvas delivery key is installed there. The controlled allowlisted local provider run does not turn the public no-signup route into an email sender.

### CUT

- TURN or SFU infrastructure, production conferencing scale, recording, screen sharing, conferencing-platform integrations, physical marker tracking, permanent gesture deletion, enterprise identity, broad document-suite integrations, billing, native apps, headsets, plugin marketplaces, and desktop automation remain outside the release candidate. The formerly deferred group/ungroup, redo, multi-select, hierarchy, rotation, two-hand resize, edge throw, continuous voice, and small-room meeting filmstrip are implemented in this checkpoint.

## Checkpoint 16: mandatory YOLO and interaction-release gate

### WORKING

- The default spatial-vision plan starts the pinned `yolo26-hand-pose-2abb91` engine. Its same-origin 320×320 FP16 ONNX artifact is 21,447,188 bytes with SHA-256 `07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc`, input `[1,3,320,320]`, output `[1,300,69]`, and exactly 21 accepted keypoints. Bounding-box-only output is refused. No environment flag, query parameter, or production call site selects MediaPipe first.
- MediaPipe is a separately labeled recovery detector. The controller attempts it only after a YOLO initialization error, readiness timeout, or post-ready runtime error. A new post-ready regression proves YOLO is disposed, the UI returns to starting, and the fallback is reported before it becomes ready.
- Hand drawing occurs on the main canvas from the tracked index fingertip. Ten separate point/idle cycles remain ten strokes inside one active `SketchObject`, open no drawers, and create one gesture receipt only when the person finishes the sketch.
- One-hand pinch uses a screen-space magnetic acquisition margin, hysteresis, and brief tracking-loss grace. Two-hand pinch resizes. Open-palm dwell focuses or restores. A deliberate fast throw through either red side edge commits recoverable trash without a confirmation drawer; the blue bottom dock minimizes. Both paths use canonical commands, receipts, and universal Undo. Slow edge drags remain ordinary moves and pinned objects are protected.
- The expanded hand-calibration view occupies 52% of desktop viewport height and 56% of the mobile viewport. It renders the YOLO skeleton, index-tip highlight, tracked pointer, engine, hand count, pinch distance, handedness, confidence, and semantic state.
- The complete Node 22 release gate passed lint, TypeScript, 73 Vitest files with 693 of 693 tests, both generated hand-worker bundles, and the optimized Next.js production build.

### VERIFIED IN BROWSER

- Chromium loaded `/workers/yolo-hand-pose.js`, the same-origin ONNX Runtime WASM assets, and the pinned model, then completed one real inference over a CC0 bare-hand image with one accepted hand and 21 landmarks. The browser worker probe passed in 2.5 seconds.
- Controlled fake-camera sessions passed against the production bundle in both desktop and mobile Chromium. Each exercised permission, the YOLO worker/model path, a large calibration surface, explicit spatial-mode entry, canvas-level controls, disable, stream detachment, and ended-track cleanup with no page error.
- A measured 412-pixel mobile regression first failed after drawer focus scrolling shifted the infinite canvas from `x=0` to `x=-4`. After containment correction, the exact command-to-system sequence passed ten consecutive mobile runs and five desktop runs. Workspace `scrollLeft` remained zero, `scrollWidth` equaled `clientWidth`, and canvas `x` remained zero.
- Two no-signup Chromium contexts established real Supabase Presence, cursor Broadcast, durable object mutation, and revision convergence. Two opted-in peers also rendered local and remote WebRTC tracks through the dedicated media signaling topic.
- A paid `gpt-realtime-2.1` session heard the controlled spoken fixture, invoked the narrow board tool, and produced a canonical voice receipt without a Run click.
- The current production bundle rasterized a real browser sketch, completed the OpenAI vision request, validated the structured diagram, and preserved both the source sketch and new diagram in the room.

### UNVERIFIED

- This checkpoint has not yet been committed, pushed, promoted to the canonical Vercel alias, or rerun against the public HTTPS origin.
- ChatGPT built-in-browser Site Tools discovery, selection, confirmation UI, and invocation remain unverified because that rollout surface is not accessible from this environment. Native Chrome and ChatGPT are separate boundaries.
- A physical person has not yet exercised YOLO pointing, finger drawing, pinch acquisition, two-hand resize, open-palm dwell, or edge throws on an iPhone or webcam. Actual lighting, distance, occlusion, latency, thermals, and ergonomics remain unverified despite the real worker and controlled-camera evidence.
- Physical touch/stylus pressure, tilt, palm rejection, and device ergonomics remain unverified. Trusted browser touch and pen event paths are automated evidence only.
- Cross-network peer-to-peer media, restrictive NATs, TURN, and SFU behavior remain unverified. The slice has no TURN or SFU.
- The public environment remains preview-only for packet delivery. The earlier controlled allowlisted Resend delivery does not authorize anonymous production sends.

### CUT

- Production conferencing infrastructure, recording, screen sharing, conferencing-platform integrations, physical marker tracking, permanent gesture deletion, enterprise identity, broad office-suite integrations, billing, native apps, headsets, marketplaces, and desktop automation are not part of this release. Participant video tiles, continuous voice, YOLO finger input, rich spatial gestures, grouping, redo, multi-select, hierarchy, and rotation are implemented rather than cut.

## Checkpoint 17: final public spatial release

### WORKING

- The canonical public judge route is <https://commandcanvas.vercel.app/demo>. It is a no-signup flow backed by Supabase Anonymous Auth: each browser receives its own authenticated identity without a form, password, email prompt, or third-party account.
- Room admission uses a 256-bit capability token in the copied invite URL. Only its SHA-256 digest is stored in the private capability table. The join RPC refuses role escalation, verifies the authenticated Supabase user, and creates an exact participant membership; the participant URL is then scrubbed to `/demo`, and RLS authorizes subsequent state by user ID and membership.
- OTP is not part of the judge path. Resend is not used for sign-in or room invitations; it remains confined to the approved meeting-packet boundary. The public environment intentionally has no `RESEND_API_KEY`, so explicit **SEND** records an honest preview-only result.
- The source release includes the mandatory YOLO26 Hand Pose primary, the visibly labeled MediaPipe recovery engine, main-canvas finger drawing, one-hand magnetic pinch/grab, two-hand resize, open-palm state, recoverable side-edge throws, bottom-dock minimize, grouping, nested frames, rotation, multi-select, undo/redo, opt-in small-room meeting media, regular GPT Realtime voice, the ten-tool WebMCP catalog, vision transformation, packets, and receipts.
- The final source gate passed ESLint, TypeScript, 73 Vitest files with 694 of 694 tests, both generated hand-worker bundles, and the optimized Next.js production build. The Realtime server dependency is now explicitly covered by the server-only release contract.
- A read-only security audit found no runtime-authorization, secret-exposure, Realtime-admission, packet-send, or deployed-schema blocker. Browser bundles contain no Supabase, OpenAI, Realtime, or Resend private environment names or credential values.

### VERIFIED IN BROWSER

- The public `/demo` runtime passed its complete stateful browser probe in 21.2 seconds: anonymous room creation, persisted four-stroke sketch, browser PNG rasterization, real GPT-5.6 vision interpretation, preserved source, schema-valid structured diagram, packet preparation, immutable recipient snapshot, approval, cancellation, restaging, explicit host **SEND**, persisted preview-only outcome, reload reconstruction, YOLO worker/model/WASM loading, live local camera track, disable, detachment, ended-track shutdown, and exact room cleanup.
- Two genuine public browser contexts passed Supabase Presence, cursor Broadcast, offline recovery, durable participant mutation, revision convergence, reload reconstruction, invite-token URL scrubbing, and exact cleanup. In a separate opt-in run, both browsers rendered live local and remote WebRTC audio/video tracks through the dedicated meeting-media topic.
- A paid regular `gpt-realtime-2.1` WebRTC session heard the controlled spoken audio request, invoked its narrow semantic board tool, and created the shared board through the canonical command and receipt path without a Run click.
- The public YOLO worker fetched the pinned 21-keypoint model and completed browser inference. The public artifact returned 21,447,188 bytes with SHA-256 `07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc`.
- Official Chrome for Testing 153 passed `document.modelContext` discovery, absence of the deprecated navigator surface, the exact static ten-tool catalog, native execution, lifecycle changes, cancellation, visible receipts, and cleanup against the canonical public HTTPS origin.
- The ordinary-browser matrix passed 19 scenarios with 35 deliberate environment-gated skips and zero failures across desktop Chromium, mobile Chromium, an iPhone-profile WebKit runtime, and the normal Chrome WebMCP surface.
- The public response returned HTTP 200 plus COOP `same-origin`, COEP `require-corp`, HSTS, no-sniff, same-origin framing, no-referrer, and explicit self-only camera/microphone permission headers. The visible source link resolved to the exact Vercel deployment commit under the public AGPL-3.0 repository.

### UNVERIFIED

- ChatGPT's built-in-browser Site Tools discovery, selection, confirmation UI, or invocation remains unverified because that rollout surface is not available in this environment. Native Chrome 153 is verified; it is not evidence for the separate ChatGPT host.
- Public dynamic registration remains unverified at a second public dynamic HTTPS deployment. The canonical public environment intentionally uses the stable static catalog; dynamic registration is covered in a fresh production bundle and native Chrome 153, while execute-time guards remain authoritative in either mode.
- The microphone provider path is verified with controlled browser audio, not a physical microphone. A physical person has not yet calibrated and exercised YOLO pointing, finger drawing, one-hand pinch, two-hand resize, open-palm dwell, or edge throws on an iPhone or webcam. Lighting, distance, occlusion, latency, thermals, mirrored-camera ergonomics, and device-specific accuracy remain physical-device checks.
- Physical touch and stylus pressure, tilt, palm rejection, and device ergonomics remain unverified. Trusted browser touch/pen events and WebKit device profiles are automated evidence only.
- Real public Resend delivery remains intentionally disabled. An earlier controlled allowlisted provider submission was accepted and reported delivered, but the canonical judge route remains preview-only and never represents that earlier run as a public send.
- The small-room media run was same-host peer-to-peer. Cross-network restrictive-NAT behavior is unverified; there is no TURN relay or SFU, recording, screen sharing, or production conferencing infrastructure.
- Current copied room invites are strong but reusable until room reset/deletion. They are not person-bound, expiring, independently revocable, or OTP-verified. Optional email OTP/magic-link identity and expiring or rotatable invitations are a production-auth extension, not part of the no-signup judge path.
- The deployed Supabase catalog and all required RPC behavior are verified, but four remote migration version IDs differ from the corresponding local filename timestamps. A future raw `supabase db push` must not be used until the CLI migration ledger is reconciled.

### CUT

- Physical pencil or marker tracking, permanent gesture-only destruction, TURN/SFU infrastructure, production conferencing scale, recording, screen sharing, conferencing-platform integrations, enterprise identity, broad office-suite integrations, billing, native apps, headset support, plugin marketplaces, and desktop automation remain outside this release. Formerly deferred participant video, continuous Realtime voice, YOLO finger input, two-hand resize, side throws, grouping, ungrouping, redo, multi-select, nested frames, and rotation are implemented.

## Checkpoint 18: thought dictation and hand-navigation candidate

This checkpoint is a draft for the current source candidate. It does not replace Checkpoint 17's public-release evidence until the exact candidate has passed the full gate and has been promoted and exercised at the named boundaries below.

### WORKING

- Saying **Start a new thought** submits one canonical note creation and begins capture only after that command succeeds. Each later completed user turn is serialized into the same selected card through `object.append_note_text` with an exact expected object version. **Start a new thought**, **Finish thought**, assistant speech, interrupted speech, and cancelled responses are excluded. Other voice tools are refused while capture is active. Accepted appends produce immutable receipts and use the shared Undo path.
- Focused unit and component coverage exercises successful capture, refused creation, stale-version refusal, ordered multi-turn appends, interrupted-turn exclusion, both Realtime tool/transcript event orderings, and the boundary between dictated prose and an actual canvas command.
- The local spatial reducer supports blank-canvas open-palm pan and two-hand zoom without creating shared receipts. Object-targeted pinch remains grab/move, object-targeted bimanual input remains resize, and rotated or visually raised objects use their effective hit geometry and stacking order.
- The room surface shows distinct open-hand, pinch, held-object, resizing, panning, and canvas-zoom feedback. Starting hand drawing clears object chrome; temporary hand loss preserves the unfinished sketch and keeps Finish and Cancel available.
- The exact source candidate passed ESLint, TypeScript, 80 Vitest files with 843 of 843 tests, both generated hand-worker bundles, and `git diff --check`. The local optimized build remains an environment-specific boundary: Turbopack's PostCSS helper cannot bind an internal loopback port in this sandbox, so the exact Vercel build must pass before release promotion is claimed.
- The hosted `general_visual_transform_kinds` migration is applied. Catalog assertions passed; the legacy nine-argument admission overload is absent; the narration-aware ten-argument overload and column are present; `anon` and `authenticated` execution are absent; `service_role` execution is present. A transactional probe passed narration-aware `auto` admission, concrete pie-chart completion, the legacy no-narration key identity, malformed-input/key refusals, and explicit-kind mismatch refusal before rolling back.
- Thought capture now aborts both its room and Realtime state when a collaborator removes the active card or a canonical append/confirmation fails. A later voice command is no longer deadlocked behind a nonexistent thought.
- If a meeting-owned camera track ends while Hand input is active, the controller releases held state, stops its RAF/worker, detaches the preview without stopping externally owned media, and reports a visible retryable state. Meeting controls now say **Stop sharing video** / **Video not shared** and disclose when the camera may remain active locally for hand input.

### VERIFIED IN BROWSER

- Local Chromium exercised the current full-screen canvas on desktop (9 passing scenarios, 1 device-specific skip) and mobile (3 passing scenarios, 7 desktop-only skips). The checks cover object creation, overlay drawers without document scroll, pointer move/resize, canvas pan/zoom, minimize/restore, recoverable discard, Undo, visible receipts, and a standards-shaped live-page WebMCP invocation.
- Component and controller tests exercise the exact thought-card sequence, including creation, ordered multi-turn append, response/transcription event reordering, boundary-command exclusion, visible canonical receipts, Undo, collaborator deletion recovery, and durable room-service round-trip. A physical microphone and production-browser thought rehearsal remain unverified below.
- Hand-navigation reducers and components exercise open-palm pan, blank-canvas two-hand zoom, object pinch/move, bimanual resize, interrupted-sketch preservation, effective-z/rotated targeting, exact staged edge feedback, shared-camera shutdown, and truthful local-video publication state. This is browser state-machine evidence, not physical-hand ergonomics.
- **TODO: after deployment, rerun the public no-signup, Supabase collaboration, vision, packet, WebMCP, meeting-media, camera lifecycle, and cleanup probes against the exact promoted commit.**

### UNVERIFIED

- The Checkpoint 18 candidate has completed its integrated source gate and hosted general-visual migration, but has not yet completed commit, push, Vercel promotion, or exact public-origin rerun. Checkpoint 17 remains the latest public evidence; its results do not automatically verify this changed source.
- A physical microphone has not exercised the new thought-card flow. Component and controlled Realtime event coverage do not establish speech recognition accuracy, interruption behavior, latency, or ergonomics for a person speaking into a specific device.
- A physical person has not exercised the current hand-navigation candidate on an iPhone or webcam. Browser state-machine coverage does not establish pointing, pinch, open-palm, bimanual, edge, occlusion, lighting, distance, thermal, or mirrored-camera accuracy.
- ChatGPT built-in-browser Site Tools remains a separate unverified host boundary. In-page GPT Realtime behavior and native Chrome WebMCP behavior are not evidence of ChatGPT-host invocation.
- Public dynamic WebMCP registration, cross-network restrictive-NAT meeting media, physical touch/stylus ergonomics, and real public Resend delivery retain the honest boundaries recorded at Checkpoint 17.

### CUT

- No previously cut capability is reintroduced by this checkpoint. Physical pencil or marker tracking, permanent gesture-only destruction, TURN/SFU infrastructure, production conferencing scale, recording, screen sharing, conferencing-platform integrations, enterprise identity, broad office-suite integrations, billing, native apps, headset support, plugin marketplaces, and desktop automation remain outside this release.

## Checkpoint 19: full-canvas control, private CUDA relay, and standard-room candidate

### WORKING

- The hand interaction surface is the complete `.canvas-viewport`, not the camera preview. A comfortable central camera region maps across the full canvas, the system drawer closes when spatial activity begins, the canvas displays its active hand-control plane, and the collapsible preview is labeled as a sensor check. Repeated finger strokes remain one sketch. Target retention and a larger pinch reacquisition area reduce the precision required after an object has already been identified.
- One-hand pinch can target, hold, move, side-throw to recoverable trash, or drop into the bottom minimize dock. Two-hand pinch resizes an object or zooms blank canvas, and open-palm movement pans blank canvas. All stable actions converge on canonical commands, receipts, and Undo; no hand gesture permanently deletes data.
- The optional native hand relay is installed separately from AutoLensAI at loopback `127.0.0.1:8100` behind `hands.autolensai.com`. The public capability route reported ready and warm on `NVIDIA GeForce RTX 3090 (CUDA device 0)`, while an unrelated route returned 404. The relay requires explicit browser camera-upload consent, authenticated room admission, a short-lived one-use HMAC handshake capability, exact Origin checks, one in-flight frame, and newest-only queuing. An established connection has a separate 30-minute default authenticated-session bound, so capability expiry cannot terminate hand input mid-meeting; fake-clock tests cover both post-capability continuation and session-deadline closure. It does not retain raw frames and returns semantic 21-point landmarks. Local YOLO WebGPU, threaded WASM, and labeled MediaPipe recovery remain the fallback chain.
- The exact tracked YOLO artifact passed the native relay digest and tensor checks. A CC0 static hand produced one 21-landmark result at confidence `0.934082`; 200 warmed native repeats measured p50 `7.652 ms`, p95 `11.016 ms`, and `122.013` results per second. This is static-image CUDA evidence and not a live physical-hand latency claim.
- `/demo` remains a no-signup anonymous judge path. `/meet` adds passwordless six-digit Supabase Email OTP, verified standard-room hosts and participants, 24-hour exact-email invitations, fragment scrubbing, SHA-256 token storage, single-use transactional acceptance, durable rate limits, and uniform unavailable responses. The deployed migration catalog and rollback probes passed the host, wrong-email, acceptance, idempotency, bypass-refusal, and actor-limit cases without leaving probe rows.
- The `allow_verified_standard_realtime_voice` migration is live and verified. The live Supabase ledger entry is version `20260828101854`, corresponding by migration name to repository source `20260828100118_allow_verified_standard_realtime_voice.sql`. Direct catalog assertions verified `private.realtime_voice_admissions` with RLS, the admission RPC with `service_role` execution and no `authenticated` execution, and the permanent-auth guard in deployed function source. A transactional production probe admitted a confirmed permanent member in a temporary standard room, refused an anonymous member with `realtime_voice_permanent_member_required`, left the anonymous admission count at zero, rolled back, and left zero probe rooms. Demo-member eligibility and the actor, room, and global ceilings remain enforced by the same deployed admission function.
- The newer `restrict_legacy_room_capabilities_to_demo` forward migration is also live as ledger version `20260828105653`, corresponding to repository source `20260828104814_restrict_legacy_room_capabilities_to_demo.sql`; all 24 live migration names match all 24 repository migration names. Deployed function read-back confirms `SECURITY DEFINER`, an empty search path, `service_role`-only execution, demo-only legacy creation, demo-constrained legacy token joining, and direct dedicated standard-room creation with no legacy capability row. A rollback-only live probe refused legacy standard creation, created a standard room through the dedicated verified-email RPC, refused its legacy-token join without membership, preserved demo creation and joining, and returned `legacy_room_demo_boundary_probes_passed` without leaving fixtures.
- Email authority is split three ways: Supabase Auth owns OTP delivery through its mailer or custom SMTP; the CommandCanvas server owns exact-email invitation submission through a separately allowlisted Resend API path; and meeting packets use another allowlist plus immutable approval and explicit host **SEND**. Missing provider configuration produces copy-link, preview-only, or failed outcomes without a delivery claim.
- The repository CI definition runs the complete application gate, the reversible Caddy-route behavioral harness, and a separate deterministic non-GPU relay contract lane. Native CUDA benchmarking remains an explicit host-boundary command rather than a mocked CI claim.
- The integrated Node 22 candidate passed ESLint, TypeScript, 95 Vitest files with 930 of 930 tests, both generated hand-worker bundles, and the optimized 13-page Next.js production build. The relay lane passed 66 of 66 Python tests, Python compilation, rendered Compose configuration, and the reversible Caddy-route harness.
- The tested relay image replaced only the CommandCanvas service. Its live container is healthy with `PRIVATE_HAND_RELAY_AUTHENTICATED_SESSION_TIMEOUT_SECONDS=1800`; the public capability route remains ready and warm on the RTX 3090, the unrelated-route check remains 404, and AutoLensAI's separate local health route remained ready and warm after the replacement.

### VERIFIED IN BROWSER

- Danny's 52-second real screen recording showed the rendered hand-input UI receiving a physical camera, recognizing an open palm, and displaying pinch ratios between 0.22 and 0.28. The same recording showed that the former preview-shaped boundary made far-left, far-right, high, and low canvas reach impractical and that enlarging the preview obscured the workspace. It is evidence for real rendered recognition and for the reported defect, not for the revised full-canvas ergonomics.
- Earlier exact-release browser evidence for local YOLO worker/model loading, physical-camera permission lifecycle with controlled media, two-browser Supabase collaboration, peer-to-peer meeting tiles, GPT Realtime, real sketch vision, packet authorization, and native Chrome WebMCP remains time-scoped to the commits named in prior checkpoints. It is not silently transferred to this changed candidate.
- The exact candidate passed 18 focused desktop, mobile, touch/pen, deterministic speech-lifecycle, Supabase transport-recovery, and iPhone-profile WebKit scenarios with 17 deliberate project skips. A separate real Chromium worker probe loaded the pinned 21-keypoint YOLO artifact and completed inference.
- Official Chrome for Testing 153.0.8010.5 exercised the exact source as both static and feature-flagged dynamic production bundles. Both modes passed current `document.modelContext` discovery, absence of the deprecated navigator surface, the ten-tool phase catalog, native execution, visible WebMCP receipts, cancellation, registration lifecycle behavior, and exact temporary-room cleanup. The loopback bundle used the documented allowlisted proxy to the canonical production room APIs because no service-role secret is installed in the local browser-test environment.

### UNVERIFIED

- The exact Checkpoint 19 candidate has completed its integrated source, relay, local-browser, and native Chrome 153 gates, but has not yet been committed, pushed, promoted to Vercel production, or rerun against the canonical public origin. The new `/meet` route, current full-canvas plane, standard-room Realtime voice and packet parity, and private-relay consent UI remain unverified on the canonical public deployment.
- A person has not yet exercised the post-fix full-canvas mapping with the exact candidate. Far-edge reach, high/low reach, finger drawing continuity, pinch engage and release, target reacquisition, one-hand movement, two-hand resize and zoom, open-palm pan, recoverable throw, minimize dock, occlusion, lighting, network loss, local fallback, latency, and thermal behavior remain physical checks.
- The native relay's public capability route and static-image CUDA protocol are verified, but an exact public CommandCanvas browser has not yet completed the consented session route, one-use WebSocket capability, live camera frame, semantic result, visible canvas action, consent revocation, and automatic local fallback as one end-to-end run.
- Supabase delivered a real first-time OTP email containing the configured six-digit code, and the hosted SQL invitation probes passed. A real browser has not yet completed both new-address and returning-address OTP verification, host room creation, invitation delivery or copy fallback, invited-email acceptance, participant join, and reload reconstruction against the exact deployed candidate.
- The canonical Vercel project does not yet have a safely supplied CommandCanvas `RESEND_API_KEY`, verified sender, and final invitation and packet allowlists. Real invitation submission, custom Supabase SMTP through Resend, and real public packet delivery remain unclaimed. Existing credentials for another project were not copied or rotated.
- ChatGPT built-in-browser Site Tools, public dynamic WebMCP registration, physical touch and stylus ergonomics, and cross-network restrictive-NAT media remain separate unverified boundaries.

### CUT

- Physical pencil, marker, or arbitrary-object tracking; permanent gesture-only deletion; TURN or SFU infrastructure; production conferencing scale; call recording; screen sharing; conferencing-platform integrations; enterprise identity; broad office-suite integrations; billing; native apps; headset support; marketplaces; and desktop automation remain outside this release. Grouping, ungrouping, redo, multi-select, nested frames, rotation, two-hand control, side throws, continuous voice, participant video tiles, OTP rooms, and invitations are implemented rather than cut.

## Checkpoint 20: canvas-first landing, bounded calibration, and final public release

### WORKING

- The root route is now a semantic, indexable, fluid landing page rather than a redirect or flattened screenshot. It links to the no-signup `/demo`, passwordless OTP `/meet`, public documentation, and repository while preserving `/demo`, `/meet`, and `/local` as fixed full-viewport product surfaces.
- The hero uses the two supplied real iPhone captures as same-origin assets: `public/landing/hand-open-real.jpg` and `public/landing/hand-pinch-real.jpg`. The product mock labels them as real capture evidence rather than presenting an abstract hand illustration.
- Hand calibration is a temporary sensor-only surface. Calibration observations update the local preview and landmarks but cannot reach canvas mutations. Opening it clears transient target, held, feedback, and preview state and requires a neutral frame before control resumes. On mobile it is a bounded bottom sheet; the canvas remains visible, the hand-control HUD is hidden during calibration, and the former dashed camera boundary is absent.
- Normal hand input operates on the full canvas. The comfortable central camera region still maps across the complete canvas, while drawing, one-hand grab and move, two-hand resize, open-palm navigation, minimize, recoverable side throw, and Undo remain in the canonical gesture-to-command-to-receipt pipeline.
- The exact final source passed ESLint, TypeScript, 95 Vitest files with 934 of 934 tests, both generated hand-worker bundles, and an optimized Next.js build with 13 of 13 static-generation jobs complete.
- The integrated Playwright release matrix on the productization commit discovered 68 scenarios: 26 applicable scenarios passed, 42 hardware, provider, credential, or target-surface gates skipped intentionally, and none failed. The final responsive-heading follow-up added a rendered-text assertion across 320, 360, 390, 393, 768, and 1024 pixels; it failed on the original concatenation and passed after the explicit-whitespace fix.

### VERIFIED IN BROWSER

- Vercel production deployment `dpl_9j2s1FVZACTWWk21BJUt72SBxGnG` is READY from GitHub commit `381c4029f84bd8af50b762aa13dded9eaf484814`, with no alias error. The canonical alias is <https://commandcanvas.vercel.app>.
- The final canonical root returned HTTP 200 at 390 by 844 and 1440 by 900. At both sizes, the rendered heading normalized to **Where meetings become the deliverable**, document width equaled viewport width, both real hand captures loaded from the exact deployment, and there were no broken images or console errors.
- Public `/demo`, `/meet`, and `/local` loaded at the mobile viewport. The demo and local canvas shells stayed exactly one dynamic viewport with no document overflow; the meeting route showed the six-digit email-code flow.
- Local landing checks covered desktop, tablet, narrow mobile, reduced motion, keyboard semantics, and route contracts. Automated accessibility checks reported zero axe violations at 390 by 844 and 1440 by 900.
- The supplied physical iPhone captures visibly show a live camera frame, a 21-landmark open hand, and a pinch-shaped hand pose. They establish real capture and landmark rendering on that earlier UI; they do not establish successful object acquisition or the ergonomics of the new full-canvas calibration design.

### UNVERIFIED

- A fresh physical-device pass is still required for the final public release: sustained finger-drawing continuity, reliable one-hand pinch acquisition and release, object movement to every edge, two-hand resize and zoom, open-palm pan, recoverable throw, minimize docking, lighting, occlusion, latency, thermals, and relay-to-local fallback are not inferred from automated poses or the two still captures.
- ChatGPT built-in-browser Site Tools discovery, confirmation UI, and invocation remain unverified because that rollout surface was unavailable. Native Chrome 153 evidence remains a separate verified boundary.
- Real public Resend delivery remains intentionally unverified and disabled without the dedicated key, verified sender, and exact allowlists. The public packet path stages and records an honest preview-only result rather than claiming delivery.
- Public dynamic WebMCP registration, physical touch or stylus ergonomics, and cross-network restrictive-NAT meeting media remain separate unverified boundaries.

### CUT

- No approved hand-control capability was cut in this release. The former oversized camera-as-workspace panel and visible dashed camera boundary were removed because they misrepresented the control plane; calibration is temporary and the canvas is the interaction surface.
- Physical pencil, marker, or arbitrary-object tracking; permanent unrecoverable gesture deletion; TURN or SFU infrastructure; recording; screen sharing; production conferencing scale; conferencing-platform integrations; enterprise identity; broad office-suite integrations; billing; native apps; headset support; marketplaces; and desktop automation remain outside this release.

## Checkpoint 21: unmirrored index-pointer landing correction

### WORKING

- The landing workflow now uses one clearly extended index finger with the thumb and remaining fingers folded. The fingertip meets the dashed receipt stroke rather than pointing away from it.
- The SVG exposes a descriptive image label plus explicit index, orientation, pointer, receipt-path, and fingertip markers. A landing unit assertion prevents a mirrored or generic-finger substitution.
- The exact product commit passed ESLint, TypeScript, 95 Vitest files with 934 of 934 tests, both generated hand-worker bundles, the optimized 13-route Next.js build, and five applicable focused landing Playwright scenarios with three intentional project skips.

### VERIFIED IN BROWSER

- Local Chromium at 390 by 844 rendered the index-pointer card with no horizontal overflow. The pointer transform determinant was positive at 13.6900003528595, its transformed fingertip landed exactly on the receipt-path endpoint with distance 0 SVG units, and the fingertip remained upper-left of the palm.
- Vercel production deployment `dpl_CHgc6XvYMXeVkTNH6sp4dTs65HHc` is READY from GitHub commit `bf8d153458526eb07a294c2454fd9b99099e0505` with no alias error at <https://commandcanvas.vercel.app>.
- The canonical production page repeated the same 390 by 844 geometry checks, kept the illustration inside the viewport with zero horizontal overflow, and produced no browser console errors.

### UNVERIFIED

- This checkpoint corrects the landing illustration only. It does not add evidence for physical-hand detection, pointing accuracy, pinch ergonomics, camera behavior, or any other device boundary listed in Checkpoint 20.

### CUT

- No product capability was cut or changed by this landing-only correction.
