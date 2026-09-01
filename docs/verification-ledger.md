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
- WebMCP registration or execution in Chrome 153 or ChatGPT desktop app’s built-in browser.
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
- WebMCP registration, discovery, invocation, cancellation, lifecycle, and phase behavior in Chrome 153 or ChatGPT desktop app’s built-in browser.
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

- ChatGPT desktop app’s built-in browser discovery and invocation against this deployed page.
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

- A ChatGPT desktop app’s built-in browser invocation of `transform_sketch` against the deployed public URL.
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

- ChatGPT desktop app’s built-in browser discovery or tool invocation. Rollout access was not available in this environment.
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

- ChatGPT desktop app’s built-in browser Site Tools discovery, selection, confirmation UI, or invocation. No accessible built-in-browser rollout surface was available from this environment.
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
- ChatGPT desktop app’s built-in browser discovery or invocation remains unavailable in this environment.
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

- ChatGPT desktop app’s built-in browser Site Tools discovery or invocation remains unavailable in this environment.
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

- The current WebMCP catalog contains eleven tools: `get_canvas_state`, `create_object`, `update_object_content`, `transform_object`, `set_object_state`, `discard_object`, `organize_objects`, `history_action`, `transform_sketch`, `prepare_meeting_packet`, and `request_packet_send`. Static and dynamic registration use the same execute-time guards.
- The optional Live voice control creates a regular `gpt-realtime-2.1` WebRTC session after an explicit user start. Its narrower tool catalog can create safe canvas objects, manipulate selected objects, focus locally, group, ungroup, rotate, undo, redo, and transform a selected sketch. It cannot discard objects, operate rooms, approve packets, stage email, or send email. Except for local-only focus, submitted tool output is not represented as completed until the shared mutation receipt arrives.
- Paid voice admission is server-only, restricted to demo-room members, durably rate-limited, and bounded to a ten-minute client session. The separately budgeted provider key never reaches the browser.
- Modifier and touch-friendly multi-selection, nested semantic grouping and ungrouping, 15-degree rotation, and shared undo/redo use the canonical command, revision, receipt, persistence, and collaboration paths. Moving or rotating an outer frame transforms its descendants in the same mutation and receipt.
- The spatial gesture engine maps deliberate index pointing to drawing, one-hand pinch to grab and move, and two-hand pinch span to resize. An open palm lifts the pen in drawing mode or pans blank canvas in move mode; it does not focus an object. Fast held-object motion through either side edge commits recoverable trash after a visible exit animation without a drawer; the blue bottom dock minimizes. Universal Undo reverses either command.
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
- Native Chrome 153 discovery, invocation, cancellation, or lifecycle behavior against the current eleven-tool source is unverified. Earlier Chrome 153 evidence applies only to the earlier eight-tool release checkpoint.
- ChatGPT desktop app’s built-in browser Site Tools discovery, selection, confirmation UI, and invocation remain unverified. The paid Realtime voice provider run is a different product boundary and does not establish Site Tools behavior.
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
- ChatGPT desktop app’s built-in browser Site Tools discovery, selection, confirmation UI, and invocation remain unverified because that rollout surface is not accessible from this environment. Native Chrome and ChatGPT are separate boundaries.
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

- ChatGPT desktop app’s built-in browser Site Tools discovery, selection, confirmation UI, or invocation remains unverified because that rollout surface is not available in this environment. Native Chrome 153 is verified; it is not evidence for the separate ChatGPT host.
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
- ChatGPT desktop app’s built-in browser Site Tools remains a separate unverified host boundary. In-page GPT Realtime behavior and native Chrome WebMCP behavior are not evidence of ChatGPT-host invocation.
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
- ChatGPT desktop app’s built-in browser Site Tools, public dynamic WebMCP registration, physical touch and stylus ergonomics, and cross-network restrictive-NAT media remain separate unverified boundaries.

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
- ChatGPT desktop app’s built-in browser Site Tools discovery, confirmation UI, and invocation remain unverified because that rollout surface was unavailable. Native Chrome 153 evidence remains a separate verified boundary.
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

## Checkpoint 22: MIT application and separately distributed GPU relay

### WORKING

- The CommandCanvas application manifest, lockfile, root license, notice, and
  browser-visible source label now identify the application as MIT. The local
  browser hand engine is MediaPipe Hand Landmarker in a worker, with the same
  MediaPipe package and model used in-page only as a labeled recovery path.
- The application no longer contains the YOLO detector or worker source, the
  same-origin YOLO model, ONNX Runtime Web dependency or public runtime assets,
  the native relay service, its Docker inputs, or its Caddy operations source.
  The generated browser asset inventory contains only the MediaPipe worker and
  MediaPipe WASM runtime.
- The MIT repository retains the consent-gated relay protocol, session, token,
  route, browser transport, semantic-result validation, and automatic local
  recovery contracts. Those contracts do not include a native inference
  implementation or model artifact.
- The former native CUDA service, operations material, notices, and both pinned
  model artifacts are preserved in a separate local AGPL repository named
  `commandcanvas-hand-relay`. It has no remote configured by this checkpoint.
  Its 320 and 640 artifacts retain SHA-256 values
  `07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc`
  and `f85eae141155d4de959051d3c7d44f68f1881dfe6b6e180e33d6c3fc3372c59e`.
- The application passed 109 Vitest files with 1,122 of 1,122 tests, TypeScript,
  ESLint, the MediaPipe worker build, and explicit source/dependency/artifact
  inventory checks. The separate relay passed 84 of 84 Python tests and its
  reversible Caddy-route harness without changing a live configuration.

### VERIFIED IN BROWSER

- No browser was exercised for this isolation checkpoint. Earlier browser
  evidence for the combined AGPL release is historical and is not transferred
  to the changed MIT/MediaPipe candidate.

### UNVERIFIED

- The optimized Next.js build was attempted but Turbopack rejected the shared
  development `node_modules` symlink because it points outside this worktree's
  filesystem root. This is an environment/tooling boundary after the worker
  build, not a successful application build claim.
- The current MediaPipe candidate still requires an exact-release browser
  camera lifecycle and real-hand rehearsal. Physical smoothness, index drawing,
  pinch acquisition, two-hand continuity, lighting, occlusion, latency,
  thermals, and mobile ergonomics remain unverified.
- The separate relay repository is local only. Its public source URL and exact
  source commit remain an explicit source-link follow-up before a public release
  offers that external processing path.

### CUT

- No gesture or canvas capability was removed. The isolation removes only the
  browser-distributed YOLO/ONNX implementation and the native service source
  from the MIT application. The optional private GPU protocol remains, with
  local MediaPipe as the no-consent and failure path.

## Current policy correction after Checkpoint 22

The following release policy supersedes older checkpoint descriptions without
rewriting their historical evidence:

- The no-signup `/demo` room is always preview-only for meeting-packet email. It
  never calls Resend, regardless of standard-room provider configuration.
- An authenticated host may submit one exact-email standard-room invitation
  through the server-side Resend path after durable admission. Invitation
  recipients do not use an address allowlist. Missing or rejected provider
  configuration leaves an honest copy-link fallback.
- Standard-room meeting packets use a separate Resend path and retain the exact
  packet-recipient allowlist, immutable approval snapshot, and explicit host
  **SEND** gate. Provider submission and provider-confirmed delivery are recorded
  as different states.
- The optional private GPU relay remains disabled for public release until its
  separate AGPL repository and exact public source commit are published and
  linked. Local MediaPipe remains the MIT application fallback.
- WebMCP Site Tools are exposed to supported agent hosts. Native Chrome,
  ChatGPT desktop app's built-in browser, and in-page Realtime voice remain separate
  verification boundaries.

## Checkpoint 23: exact MIT production and bounded provider verification

### WORKING

- Public application source commit
  `d331ccf565560fffdafb7ba0d5cdab8f97bddf2e` passed ESLint, TypeScript, 109
  Vitest files with 1,128 of 1,128 tests, the generated MediaPipe worker, and
  the optimized Next.js webpack build with all 13 routes generated.
- Vercel production deployment `dpl_7X5NA2H6tJaYeLn4Lkxs7QJhpvz9` is READY
  from that exact source commit. The canonical alias is
  <https://commandcanvas.vercel.app>.
- The source, runtime, and evidence changes preserve the MIT browser boundary:
  local hand input uses MediaPipe, while the optional private-GPU protocol
  remains disabled until its separate source-publication and service gates are
  complete.

### VERIFIED IN BROWSER

- The exact public deployment passed 23 applicable ordinary-browser scenarios
  with 16 deliberate provider, hardware, or target-surface skips and zero
  failures. The matrix covered fluid landing layouts, the ordinary Chromium
  canvas, deterministic transport recovery, trusted touch and pen input,
  iPhone-profile WebKit fallbacks, and genuine two-browser Supabase Presence,
  cursor Broadcast, durable mutation, and revision convergence. A separate
  reset probe deleted the exact prior demo room, created a distinct replacement,
  and cleaned up the replacement.
- Controlled-media production runs passed the MediaPipe worker path on desktop
  and mobile plus the visibly labeled same-model in-page recovery path on
  desktop. They exercised permission, exact model/worker/WASM loading,
  detachment, shutdown, and ended-track behavior. These runs used controlled
  media and do not establish physical-camera or human-hand accuracy.
- A paid `gpt-realtime-2.1` WebRTC run used controlled browser audio, heard
  **Bring in our project board**, created **Project Board** through the narrow
  voice tool, produced the canonical `R4 · voice` receipt, and cleaned up the
  exact room.
- The first exact-production vision run reached the authenticated
  `transform-sketch` route but returned HTTP 502; its exact temporary room was
  still cleaned up. One bounded retry then returned HTTP 200, preserved the
  selected rough sketch, created a separate schema-validated structured visual,
  and cleaned up its exact room. The passing retry is current OpenAI vision
  evidence for this deployed application. It is not evidence that ChatGPT's
  built-in browser discovered or invoked Site Tools.
- Official Chrome for Testing 153 exercised current static and feature-flagged
  dynamic production bundles with the current `document.modelContext` surface,
  absence of the deprecated navigator surface, the ten-tool phase catalog,
  execution, cancellation, registration lifecycle behavior, visible receipts,
  and cleanup. The canonical public deployment remains in static-registration
  mode; this does not establish a separate public dynamic HTTPS deployment.

### UNVERIFIED

- ChatGPT desktop app’s built-in browser Site Tools discovery, confirmation UI, and tool
  invocation remain unverified. Native Chrome 153 and in-page Realtime voice are
  separate boundaries.
- The microphone provider path is verified with controlled audio, not a
  physical microphone. Speech recognition accuracy, interruption behavior,
  latency, and room ergonomics with a person speaking into a device remain
  unverified.
- Controlled media verifies the camera runtime lifecycle, not a person's hand.
  Physical index drawing, pinch acquisition and release, one-hand movement,
  two-hand resize and zoom, open-palm pan, edge throw, minimize docking,
  lighting, occlusion, latency, thermals, mirrored-camera behavior, and
  relay-to-local ergonomics remain unverified.
- Physical touch and stylus pressure, tilt, palm rejection, and device
  ergonomics remain unverified. Trusted browser events and device profiles are
  automated evidence only.
- Public dynamic WebMCP registration remains unverified at a distinct public
  dynamic HTTPS deployment. Execute-time guards remain authoritative in static
  and dynamic modes.
- Real public Resend delivery remains disabled. The no-signup demo is always
  preview-only and never calls Resend. Earlier controlled allowlisted delivery
  does not establish current public invitation or packet delivery.
- The separate private-GPU relay source publication and production listener are
  still pending. Its public edge currently cannot establish readiness while no
  true-640 service is listening, so the application path remains disabled and
  local MediaPipe remains the fallback.
- Cross-network restrictive-NAT meeting media remains unverified; there is no
  TURN relay or SFU.

### CUT

- No approved hand-control or canvas capability was cut in this checkpoint.
  Physical pencil, marker, or arbitrary-object tracking; permanent
  unrecoverable gesture deletion; TURN or SFU infrastructure; recording;
  screen sharing; production conferencing scale; conferencing-platform
  integrations; enterprise identity; broad office-suite integrations; billing;
  native apps; headset support; marketplaces; and desktop automation remain
  outside this release.

## Checkpoint 24: hand-state recovery, shared agent authority, and release candidate

### WORKING

- The hand reducer now keeps its safe filter and pinch-release transition when a
  current, well-formed visible hand has no deliberate gesture. It still refuses
  malformed, stale, predicted, future, out-of-order, and low-confidence frames.
  A regression covers pinch, neutral visible hand, threshold-gap point, and a
  fresh pinch so a previous hold cannot remain latched into the next gesture.
  A neutral frame from the active pinch owner also takes release precedence over
  a simultaneous accepted gesture from a second hand, while a neutral bystander
  cannot release an owner that is temporarily inside tracking-loss grace.
- Index-point filtering drives targeting and drawing, while the filtered palm
  drives movement after an object is held. Open-palm and neutral states no
  longer create strokes. The full canvas remains the control plane; calibration
  is temporary and the mobile sensor preview can collapse to a 44-pixel control.
- Provisional GPT Realtime speech now appears inside the active thought card.
  Partial words do not persist or create receipts. Retryable transport,
  confirmation, busy, and stale-version failures preserve the visible draft so
  the next spoken turn can retry; deletion, type changes, text-limit failures,
  invalid commands, room mismatch, cancellation, and explicit interruption end
  the capture.
- The real standard-room adapter preserves an allowlisted command error code
  through the room service, HTTP response, browser API, and room session.
  Terminal refusals therefore end thought capture in production, while untyped
  transport, authentication, and connectivity failures remain retryable.
- Authenticated participants may use their own ChatGPT/WebMCP session for
  ordinary canvas mutations. The durable actor remains the participant user,
  with actor type `agent` and source `webmcp`. Packet preparation, approval,
  recipients, staged delivery, final SEND, invitations, and room lifecycle stay
  host-only at execute time in every mode and are omitted from participant
  registration when dynamic registration is enabled. Static compatibility mode
  intentionally advertises the full catalog while retaining identical
  authoritative execute-time guards.
- Packet presentation is a typed semantic projection rather than raw JSON.
  Notes, boards, schedules, node diagrams, charts, tables, reference cards, and
  meeting cards share one validated presentation model for the browser preview,
  plain text, and escaped email HTML. Chart axis units remain visible in all
  three outputs.
- Invitation delivery outcomes are visible and exhaustive: preview-only,
  reconciling, submitted, delivered, bounced, complained, failed, and
  suppressed. Provider or session failures are not collapsed into success.
- The in-page voice control gives a registered Site Tools host the distinct
  label **Open ChatGPT voice guidance**. An active local voice session always
  exposes **Stop CommandCanvas Live Voice**, including if Site Tools register
  after the local session begins.
- The exact Node 22.17.0 candidate passed ESLint, TypeScript, 112 Vitest files
  with 1,175 of 1,175 tests, the MediaPipe worker build, the optimized Next.js
  webpack build, all 13 generated routes, and `git diff --check`.
- Supabase migration `allow_participant_webmcp_canvas_mutations` is deployed.
  Catalog read-back confirms that the private mutation core no longer contains
  the agent-host restriction and remains unavailable to the authenticated role.
  A service-role transactional probe created a participant-authorized WebMCP
  note and agent receipt, asserted exact actor attribution, rolled back, and
  left no fixture room.
- The separately licensed native relay has an opt-in hybrid RTMDet-nano plus
  RTMPose-m Distill backend with pinned model revisions and hashes. Its clean
  CUDA image reported the RTX 3090, 21 landmarks, warm readiness, no raw-frame
  persistence, and semantic-only results. Controlled open-hand and pinch crops
  each returned 20 of 20 landmark results. This backend is not yet enabled on
  the public application.

### VERIFIED IN BROWSER

- The exact local production candidate passed the 74-scenario ordinary release
  matrix with 28 applicable scenarios passed, 46 explicit hardware, provider,
  credential, or project gates skipped, and zero failures. Covered targets were
  Chromium desktop, Chromium mobile, iPhone-profile WebKit, and native Chrome
  153 WebMCP registration against the then-current ten-tool catalog.
- A separate controlled-camera matrix passed the MediaPipe lifecycle on desktop
  and mobile plus classic-WASM recovery on desktop: 5 passed, 3 deliberate
  project skips, zero failures. It exercised camera permission, worker, WASM and
  model loading, live attachment, calibration layout, preview reopening,
  detachment, shutdown, and ended-track behavior.
- The first controlled-camera attempt could not launch Chromium inside the
  execution sandbox. The same command passed outside that sandbox against the
  exact production build. This was an environment boundary, not treated as app
  evidence until the outside-sandbox rerun succeeded.

### UNVERIFIED

- This candidate is not yet committed, pushed, deployed to Vercel, or exercised
  at the canonical public origin. The browser evidence above names the exact
  local production candidate only.
- A person still needs to exercise the final phone path. Controlled media and
  reducer tests do not prove physical index drawing, pinch acquisition and
  release, full-edge reach, one-hand movement, two-hand resize and zoom,
  open-palm pan, recoverable throw, minimize docking, mirrored-camera
  ergonomics, lighting, occlusion, latency, thermals, or relay-to-local fallback.
- The ChatGPT desktop app’s built-in browser remains unverified. Native Chrome 153 proves the
  current WebMCP API contract, not ChatGPT rollout, confirmation, or invocation.
- Real public Resend invitation and packet delivery remain disabled until the
  owner places a dedicated Resend key and webhook signing secret directly into
  Vercel and completes sender, allowlist, webhook, and Supabase SMTP setup. The
  no-signup demo remains preview-only by design.
- The relay repository is not public yet, the production listener is not
  running on port 8100, and the Vercel relay feature flag remains off. The
  hybrid CUDA measurements are controlled-crop evidence, not live phone-hand
  accuracy or network-latency evidence.

### CURRENT SCOPE

- No approved hand-control, voice, canvas, collaboration, invitation, packet,
  or WebMCP capability was removed. Physical arbitrary-object tracking,
  permanent unrecoverable gesture deletion, TURN or SFU infrastructure,
  recording, screen sharing, production conferencing scale, enterprise
  identity, broad document-suite integrations, billing, native applications,
  headset support, marketplaces, and desktop automation remain outside this
  release.

## Checkpoint 25: public release and canonical-origin verification

### WORKING

- Source release commit `13ac311e21e7383ae1dab4c5f67f2753daef5600`
  was pushed to the public `romiteld/commandcanvas` `main` branch. The GitHub
  repository reports public visibility, `main` as its default branch, and MIT
  as its recognized license. The commit has Daniel Romitelli as its only author
  and committer and contains no co-author or generator attribution.
- Vercel production deployment `dpl_EN2VKhRkrpjsXKhmWfpHQh7frKtr` built from
  that clean source release, reached `READY`, and was assigned to
  `https://commandcanvas.vercel.app`.
- The participant WebMCP migration remains deployed in Supabase. The native GPU
  relay remains deliberately disabled at the public boundary until its
  separately licensed source repository is public and linked from the service.

### VERIFIED IN BROWSER

- The canonical public origin passed the 74-scenario release matrix with 28
  applicable scenarios passed, 46 explicit project, provider, credential, or
  hardware skips, and zero failures. The applicable targets included Chromium
  desktop and mobile, iPhone-profile WebKit, and native Chrome 153 WebMCP
  registration against the ten-tool catalog.
- The canonical public origin passed the separate controlled-camera lifecycle
  matrix with 5 applicable scenarios passed, 3 deliberate project skips, and
  zero failures. The matrix covered desktop and mobile permission, worker,
  WASM/model loading, calibration layout, compact PiP return, detachment,
  shutdown, and classic-WASM desktop recovery.
- `/`, `/demo`, `/local`, `/meet`, and `/icon.svg` each returned HTTP 200 from
  the canonical alias. Vercel reported no error-level runtime logs during the
  public verification window.

### REMAINS UNVERIFIED

- A physical phone and person still need to exercise final index drawing,
  pinch acquisition/release, full-edge reach, one-hand movement, simultaneous
  two-hand release and resize, open-palm pan, recoverable throw, mirrored-camera
  ergonomics, lighting, occlusion, latency, and thermals. Controlled media and
  browser profiles are evidence for lifecycle and layout, not physical accuracy.
- The ChatGPT desktop app’s built-in browser Site Tools rollout and invocation surface remain
  unverified. Native Chrome 153 verifies the browser API contract only.
- Real GPT Realtime microphone/provider behavior, live two-browser media, and a
  current-release real vision-provider request were not rerun in this release
  gate. Their deterministic contracts and unchanged implementation remain
  tested, but this checkpoint does not present them as new physical/provider
  evidence.
- Real Resend invitation and packet delivery remain disabled because the Vercel
  project does not have an owner-supplied sending key or webhook signing secret.
  The application reports preview-only rather than claiming delivery.
- At this checkpoint the native relay source was not yet public, so production
  port 8100 and the Vercel relay feature flag remained disabled.

## Checkpoint 26: permanent meeting identity and verified transactional delivery

### WORKING

- Commit `c9a33e2ea2cad54ecedc5b54e7aa7aba71f7b017` adds a bounded
  `otp_rate_limited` result for Supabase's project email quota without exposing
  provider response text. The change was written test-first, passed the exact
  Node 22.17.0 release gate with 112 Vitest files and 1,176 of 1,176 tests, and
  has Daniel Romitelli as its only author and committer.
- A separate focused Node 22 audit passed 144 of 144 tests across passwordless
  identity, the meeting lobby, invitation issuance and acceptance, packet
  preparation and approval, explicit send authorization, Resend submission,
  and signed-webhook reconciliation.
- Vercel production built the exact commit, reached `READY`, and serves the canonical
  `https://commandcanvas.vercel.app` alias. The production `/meet` route returns
  HTTP 200 with camera and microphone permissions limited to the same origin.
- The public landing page passed its applicable Chromium-mobile and
  iPhone-profile WebKit checks with zero failures. A production iPhone-profile
  capture showed the six-digit passwordless meeting flow without horizontal
  document overflow. This is browser-profile evidence, not a physical-device
  claim.
- The standard meeting path uses permanent email OTP identities. The public
  `/demo` path remains no-signup and preview-only by design; it does not send
  invitations or meeting packets.

### VERIFIED IN PUBLIC BROWSER AND PROVIDERS

- Supabase Auth recorded one successful host OTP request and verification and
  one successful invited-participant OTP request and verification. The normal
  public UI used exactly one request per identity after the natural project
  quota windows opened, with no retries and no OTP or session token written to
  logs or chat.
- A permanent host created a standard room and submitted an exact-email-bound
  invitation. Resend reported the invitation delivered. A fresh second browser
  verified the exact invited address, accepted the opaque single-use
  capability, entered as `participant`, reloaded, and reconstructed the same
  room from durable membership after the URL fragment had been scrubbed.
- Supabase read-back shows exactly one host and one participant, the invitation
  as delivered and consumed by a member, and the signed `email.delivered`
  webhook applied to the exact invitation target.
- The host prepared packet version 1, saved one recipient, approved immutable
  content and recipient snapshots, staged the send, and explicitly selected
  **SEND**. Resend accepted and then reported the meeting packet delivered.
- Supabase read-back shows the outbound share as provider `resend`, status
  `delivered`, complete, and associated with a provider event. The signed
  `email.delivered` webhook was applied to the exact packet send-request target.
  Earlier `email.sent` webhook events were classified as stale after the
  authoritative delivered state, as designed.
- Vercel runtime logs show HTTP 200 or 201 for meeting creation, canvas
  persistence, invitation creation and acceptance, packet preparation, save,
  approval, staging, explicit execution, and targeted invitation and packet
  webhooks. The only webhook 503 retries in the window belong to unmatched
  Supabase OTP emails with no invitation or packet target; they did not affect
  either verified delivery.
- Private room, identity, invitation, packet, provider-message, webhook-event,
  capability, and recipient identifiers are intentionally omitted from this
  public ledger. They remain in the restricted provider/database evidence used
  for the read-back above.

### RELAY AND DEPLOYMENT BOUNDARIES

- The separate RTX relay remains fail-closed. Its public corresponding-source
  repository does not yet exist, production port 8100 is not listening, and
  `PRIVATE_HAND_RELAY_ENABLED` remains false. Preflight also found that the
  protected host key is valid while the Vercel signing-key value is malformed;
  the values must be aligned without disclosure before enablement. The public
  relay capability route therefore still returns 502 through the already-valid
  Caddy route. No DNS, firewall, pfSense, or router mutation is needed.
- The existing CUDA-verified YOLO26 640 FP16 image is tied to exact relay source
  commit `9f652a67dbe2c824ee68f7985ab13bb0af56ae6f`. Public source must expose that
  exact commit before the image can be served. Later documentation commits are
  not substitutes for the source of the running bytes.

### REMAINS UNVERIFIED

- A person still needs to exercise the exact release on a physical phone:
  index-finger drawing, full-edge reach, pinch acquire/hold/move/release,
  two-hand resize and canvas zoom, open-palm pan, minimize, recoverable edge
  throw, hand crossing, lighting, occlusion, sustained cadence, thermals, and
  local fallback during relay loss.
- ChatGPT desktop app’s built-in browser Site Tools discovery, confirmation, voice-guidance
  handoff, and live-page invocation remain unverified. Native Chrome 153 and
  in-page GPT Realtime are separate verified boundaries and are not substitutes
  for the ChatGPT host.
- Physical microphone speech recognition, interruption behavior, and
  conversational latency remain unverified. The paid Realtime provider was
  exercised previously with controlled browser audio.
- Public dynamic WebMCP registration remains unverified at a distinct public
  dynamic HTTPS deployment. The canonical public deployment intentionally uses
  static registration with identical execute-time guards.
- Cross-network restrictive-NAT peer media remains unverified; there is no TURN
  relay or SFU.

### CURRENT SCOPE

- No approved hand-control, object-creation, voice, canvas, collaboration,
  invitation, packet, or WebMCP capability was cut. Physical pencil, marker, or
  arbitrary-object tracking; permanent unrecoverable gesture deletion; TURN or
  SFU infrastructure; recording; screen sharing; production conferencing
  scale; broad office-suite integrations; enterprise identity; billing; native
  applications; headset support; marketplaces; and desktop automation remain
  outside this release.

## Checkpoint 27: raw-landmark interaction hardening

### WORKING

- Deliberate index pointing now fails closed unless the wrist, full index chain,
  and the middle, ring, and pinky fold evidence are reliable. A naturally
  extended thumb remains valid. This prevents a loose palm, a palm with one
  unreliable finger, or a noisy fist from falling through to point/draw.
- Calibrated pinch voting remains two-of-three with the same confidence guards
  and engage/release hysteresis. Its temporal window now follows observed frame
  cadence within a bounded 100 to 360 milliseconds, so slow mobile inference
  does not make a deliberate pinch impossible. Vote history clears after each
  engage or release so old evidence cannot cause an immediate re-grab.
- A production-shaped test-only frame source now exercises the complete seam:
  21 landmarks, controller interpretation, calibrated room input, spatial
  reduction, canonical command, mutation, and receipt. It is contained in a
  `*.test.tsx` module and adds no production debug surface.
- Three index-finger strokes through that seam remain one sketch, open zero
  drawers, and create one gesture receipt when finished. A landmark pinch,
  movement, and release creates one object transform and one gesture receipt.

### VERIFIED

- The deliberate-point regressions were observed failing before the production
  correction: three negative 21-landmark poses were incorrectly accepted as
  point while the real index-point fixture already passed.
- The cadence regressions were observed failing before the production
  correction at approximately 8, 12, 15, 24, and 30 results per second. They
  reproduced missed acquisition, lost release evidence, and stale-history
  re-grab respectively.
- The landmark-to-room test first failed with its worker result disconnected,
  then passed through the real controller. Bending the index-tip fixture caused
  both end-to-end actions to fail, confirming the test depends on actual pose
  interpretation rather than a mocked semantic gesture.
- The exact combined candidate passed Node 22.17.0 ESLint, TypeScript, 115
  Vitest files with 1,193 of 1,193 tests, the generated MediaPipe worker, the
  optimized Next.js webpack build, all 13 generated routes, and
  `git diff --check`.
- An earlier full-gate attempt inherited an invalid Windows temporary-directory
  path and used Node 20. It created no Vitest workers and is not treated as
  product evidence. The successful result above is the clean rerun with the
  project runtime and `/tmp`.

### ENVIRONMENT AND RELEASE BOUNDARIES

- The application repository, real OTP/invitation/packet delivery, and
  canonical public origin remain verified at the preceding release checkpoint.
  This interaction-hardening candidate is not a public deployment until its
  commits are pushed and Vercel reaches `READY` on the exact source revision.
- The protected host signing key was supplied to the existing Vercel secret
  definition without printing its value. Equality is not claimed from secret
  metadata; the authoritative proof remains a successful signed, one-use
  WebSocket handshake after the relay starts.
- The relay remains correctly disabled: its public corresponding-source
  repository has not been created, production port 8100 is not listening, the
  public capability route returns 502, and the application renders the private
  GPU feature as disabled. No pfSense, DNS, firewall, or Caddy change is needed.
- Physical phone drawing, pinch, two-hand transform, open-palm pan, edge throw,
  lighting, occlusion, thermal behavior, and private-relay fallback remain
  unverified. These deterministic corrections address proven state-machine
  defects but do not substitute for a physical rehearsal.

## Checkpoint 28: public interaction-hardening release

### VERIFIED IN PRODUCTION

- Public `main` commit `ecc2071153a0a5f2f307b10fb7330ebf4b01b3e8`
  contains the cadence-aware pinch vote, deliberate point-pose correction,
  landmark-to-room regression coverage, and Checkpoint 27. Every commit has
  Daniel Romitelli as its only author and committer and has no co-author or
  generator attribution.
- Vercel built that exact GitHub commit from the public `romiteld/commandcanvas`
  repository, reached `READY` as a production deployment, and assigned the
  canonical `https://commandcanvas.vercel.app` alias without an alias error.
- Fresh canonical requests to `/`, `/demo`, and `/meet` each returned HTTP 200
  with HTML content.
- The exact public landing page passed its applicable Chromium-mobile and
  iPhone-profile WebKit scenarios: 2 passed, 6 project-specific skips, and zero
  failures. Both profiles rendered the real destinations with no browser,
  console, or request failures and no horizontal document overflow.
- A fresh public two-browser run created a no-signup room, joined a real second
  browser, observed two Supabase Presence members, broadcast the participant
  cursor, persisted collaborator mutations and receipts, disconnected and
  reconnected Realtime, reloaded the participant, reconstructed revision 9,
  and deleted the exact temporary room. The single applicable scenario passed.
- A separate fresh public media run passed the 390-pixel mobile-control geometry
  check and a two-browser opt-in WebRTC exchange. Both local and remote audio
  and video tracks reached `live`, video-share and leave controls removed the
  correct tiles, and both temporary rooms were deleted. Two applicable
  scenarios passed and two project-inapplicable scenarios skipped.
### STILL GATED

- At this checkpoint the separate relay source publication still required a
  repository-owner action, so the relay remained disabled.
- Physical phone gesture accuracy and ChatGPT desktop app’s built-in browser Site Tools remain
  external target-surface checks. The public release is available for those
  rehearsals, but neither is inferred from unit, browser-profile, native Chrome,
  or provider evidence.

## Checkpoint 29: self-healing no-signup demo rooms

### ROOT CAUSE VERIFIED

- The reported **Demo room could not be created** state was not a Vercel,
  Supabase Auth, RLS, or Realtime outage. Production recorded ten consecutive
  `POST /api/rooms` HTTP 409 responses from 16:15:47 through 16:16:00 UTC, and
  PostgreSQL recorded `demo_room_limit_reached` for every corresponding RPC.
- The affected anonymous identity still existed in Supabase Auth and owned the
  maximum three durable demo rooms. Its Supabase identity persisted in
  `localStorage`, while the raw room capability deliberately lived only in the
  tab's `sessionStorage`. A fresh embedded tab therefore retained the identity,
  lost the room descriptor, attempted a fourth room, and reached the lifetime
  three-room guard.
- The browser session replaced the server's actionable bounded-room error with
  the generic message. The released path now preserves the validated server
  message rather than masking it.

### WORKING

- Commit `b5b4479452c975b604e5b9da87171eb97d679c8f` switches demo bootstrap to
  the atomic `open_demo_room_with_host` RPC. The RPC selects and row-locks the
  actor's latest demo room before cleanup, preserves that room even when its
  durable activity timestamp is old, deletes only older actor-owned rooms that
  have been inactive for more than 24 hours, and creates a room only when none
  exists.
- Open and exact host reset use the same per-actor transaction lock. The
  resumed host membership is revalidated, the new tab receives a newly rotated
  raw invite capability, and only hashes remain in Postgres. The immediately
  previous hash remains valid for one bounded hour so opening another host tab
  does not instantly invalidate the invite copied from the preceding tab.
- The receipt self-reference now uses `ON DELETE NO ACTION DEFERRABLE INITIALLY
  DEFERRED`, allowing one room-owned cascade to remove both an original receipt
  and its undo receipt without weakening the immutable-receipt trigger.
- The focused recovery suite first failed on the absent RPC, missing resume
  response, generic error, destructive delete order, invite continuity, reset
  serialization, and receipt cascade contract. The corrected implementation
  passes 62 focused tests.
- The exact Node 22.17.0 release gate passed ESLint, raw TypeScript, all 1,200
  Vitest tests across 115 files, the generated hand worker, the optimized
  Next.js webpack build with all 13 generated routes, and `git diff --check`.

### VERIFIED IN SUPABASE AND PUBLIC BROWSERS

- Supabase applied migration `20260831170235_open_or_reclaim_demo_room` to the
  active production project. Catalog read-back confirms the RPC exists,
  `service_role` can execute it, `anon` and `authenticated` cannot, the host
  activity index exists, the invite-grace column exists, and the undo receipt
  constraint is deferred.
- A production rollback-only SQL probe created an older room with an object,
  original receipt, and undo receipt; a newer stale room for the same host; and
  an equally stale control room for another actor. It proved that recovery
  preserved the newest room, removed the older graph, forced the deferred FK
  check, retained the other actor's room, accepted the immediately previous
  invite, rotated the capability, exercised exact reset, exercised the no-room
  creation branch, and retained the legacy three-room refusal. The transaction
  returned `rollback_probe_passed`; read-back confirmed zero fixture rooms for
  both probe users.
- Vercel deployment `dpl_B8cbMjcB6yeFdZUUdYRzzB1dLJM2` built the exact public
  code commit, reached `READY`, and assigned `commandcanvas.vercel.app` with no
  alias error.
- The focused public Chromium regression preserved one Supabase anonymous
  identity across two pages while the second page began with empty
  `sessionStorage`. `/demo` made exactly one open request, returned HTTP 201,
  resumed the exact same room ID and revision 3, restored the tab descriptor,
  rendered the existing fixtures, emitted no page error, and deleted the exact
  temporary room. The applicable scenario passed in 6.7 seconds.
- A separate public two-browser regression copied a real invite, joined a
  second no-signup browser, observed two Supabase Presence members, exchanged a
  cursor, persisted collaborator mutations and receipts, recovered Realtime,
  reconstructed revision 9 after reload, and deleted the exact room. The
  applicable scenario passed in 16.7 seconds.
- Deployment-scoped Vercel logs for those checks contain three HTTP 201 and 26
  HTTP 200 responses, no error status group, and no `/api/rooms` runtime error
  cluster.

### REMAINS UNVERIFIED

- The exact report-origin ChatGPT in-app browser tab still needs one human
  refresh after this deployment. The retained-identity/missing-tab-descriptor
  mechanism is verified in a public browser, but that does not constitute an
  observation of the user's physical phone session.
- ChatGPT desktop app’s built-in browser Site Tools invocation, physical phone hand-control
  accuracy, and other physical-device checks remain the honest external
  boundaries recorded in the preceding checkpoints. This room-lifecycle
  release does not change or reclassify them.
- One synthetic control room created while isolating the original outage was
  not manually deleted after the database tool refused that destructive action.
  It is actor-scoped, has no user content, and is eligible for the same bounded
  recovery cleanup; no deletion is claimed.

## Checkpoint 30: hand-calibration recovery candidate

### WORKING

- Calibration now consumes local raw detector measurements before semantic
  point or pinch classification. A physical pinch that sits above the default
  cutoff can therefore teach its own engage and release thresholds instead of
  being rejected by the threshold it is trying to replace.
- The flow is staged and bounded: comfortable reach, open fingers, closed
  pinch, then review. Reach samples freeze after stage one, and a comfortable
  central camera region as small as 18 percent per axis maps across the safe
  canvas. Stage one is validated before the user is asked for either pinch
  pose.
- Closing-motion samples no longer contaminate the learned pinch profile. The
  closed stage waits for a stable lower-ratio cluster, while implausible ratios,
  overlapping open/closed evidence, insufficient reach, and excessive reach
  remain explicit refusals.
- Calibration reacquires the only visible hand after detector track-ID churn,
  publishes zero-hand sensor frames to clear stale landmarks, and discards raw
  21-point sensor state when calibration closes or tracking stops. Raw sensor
  frames remain local and never enter the canvas mutation, receipt, or
  Supabase pipelines.
- The learned thresholds are installed in the canonical controller classifier.
  Removing a retained profile clears those personalized thresholds. Skipping
  uses bounded defaults and remains labeled `Default controls · calibration
  skipped` after the controlled room state round-trip; it is never presented
  as successful calibration.
- The enlarged mobile calibration surface preserves the exact rendered camera
  aspect ratio. The video, 21 landmarks, skeleton, and pointer now share one
  content rectangle instead of stretching landmarks across letterbox bars.

### VERIFIED IN BROWSER

- A 390 by 844 Chromium-mobile production-build run measured a large bounded
  calibration surface, a camera media frame matching the intrinsic stream
  aspect within 0.03, and an overlay rectangle identical to the media frame. It
  also exercised the real parent-controlled Skip round-trip, reopened the
  collapsed PiP, and displayed the default-controls label. The applicable
  scenario passed.
- The combined local production-build layout matrix passed its applicable
  Chromium-mobile and Chromium-desktop scenarios: 2 passed, 2
  project-specific skips, and zero failures. Neither viewport gained horizontal
  document overflow.
- A separate Chromium-mobile camera lifecycle run used a real browser media
  track with a deterministic Y4M source, loaded the same-origin worker, WASM,
  and versioned detector model, reached ready, returned to the canvas, disabled
  input, detached the stream, ended the exact track, and deleted its temporary
  production demo room. The one applicable scenario passed.
- The candidate passed Node 22.17.0 ESLint, raw TypeScript, all 1,217 Vitest
  tests across 115 files, `git diff --check`, the generated hand worker, and the
  optimized Next.js webpack build with all 13 generated routes.

### UNVERIFIED

- This checkpoint does not claim physical-hand acceptance. The browser camera
  lifecycle used deterministic media, so actual fingertip drawing, learned
  pinch ergonomics, left/right/top/bottom reach, occlusion, lighting, thermal
  behavior, and two-hand use still require a fresh human phone rehearsal after
  public deployment.
- The deterministic camera source proves permission, stream, worker, WASM,
  model-loading, shutdown, and layout behavior. It does not prove hand-pose
  accuracy or detector latency on a physical device.
- ChatGPT desktop app’s built-in browser Site Tools invocation remains a separate target-host
  check. Native browser and in-page tests do not substitute for that rollout
  surface.
- The candidate is not yet claimed public in this checkpoint. Public status
  requires a pushed exact commit, a Vercel `READY` deployment, the canonical
  alias, and fresh deployed-browser evidence.

### CUT

- Nothing was cut from the approved hand-control or object-creation behavior in
  this recovery. The change repairs calibration and its presentation; it does
  not remove finger drawing, one-hand move, two-hand resize/zoom, edge throw,
  realtime voice, WebMCP, collaboration, invitations, packets, or email.
- Physical pencil, marker, or arbitrary-object tracking; unrecoverable
  gesture-only deletion; TURN/SFU conferencing scale; recording; screen
  sharing; enterprise identity; billing; native applications; headset support;
  marketplaces; and desktop automation remain outside this release.

## Checkpoint 31: public hand-calibration recovery release

### WORKING

- Public GitHub `main` commit
  `e02957f4d6e3117f6c62162e3814f85e42a46d93` contains the raw-sensor staged
  calibration, calibrated classifier thresholds, single-hand reacquisition,
  stale-overlay clearing, controlled Skip state, and camera/overlay aspect-ratio
  correction described in Checkpoint 30.
- Vercel deployment `dpl_4cw4VgZKaqpCJRUZDUeV4vegvTgj` reports `READY` with
  production target, GitHub repository `romiteld/commandcanvas`, branch `main`,
  and that exact commit SHA. Its aliases include the canonical
  `https://commandcanvas.vercel.app` origin.
- Fresh canonical HTTP requests to `/`, `/demo`, and `/meet` each returned
  HTTP 200 with `text/html` content after the production alias was assigned.

### VERIFIED IN BROWSER

- The fresh public calibration layout matrix passed its applicable
  Chromium-mobile and Chromium-desktop scenarios: 2 passed, 2
  project-specific skips, and zero failures. The mobile path measured the large
  calibration surface, aligned intrinsic video and landmark overlays, completed
  the controlled Skip round-trip, and reopened the collapsed preview with the
  default-controls label. The desktop path remained bounded over a visible
  canvas.
- A separate fresh public Chromium-mobile camera lifecycle run used a real
  browser media track with a deterministic Y4M source. The deployed application
  loaded the same-origin worker, WASM, and detector model, reached ready,
  returned to the canvas, disabled input, ended the exact media track, and
  deleted its temporary production demo room. The applicable scenario passed
  in 10.1 seconds.
- A final read-only calibration review found no release blocker after both
  prior findings were corrected. The intentionally unsupported pre-container-
  unit fallback can distort, but every declared Next.js 16.3.3 minimum browser
  target supports the container units used by the released alignment path.

### UNVERIFIED

- Physical-hand acceptance remains explicitly unclaimed. Deterministic camera
  media proves the deployed permission, stream, worker, WASM, model-loading,
  layout, and shutdown path; it does not prove fingertip drawing accuracy,
  learned pinch ergonomics, full-canvas reach, two-hand behavior, device heat,
  occlusion tolerance, or latency on the user's phone and camera.
- ChatGPT desktop app’s built-in browser Site Tools invocation remains a distinct host-rollout
  boundary. The public Chromium checks do not substitute for a Site Tools call
  made by ChatGPT against the same live page and session.

### CUT

- Nothing from the approved hand-control, object-creation, collaboration,
  voice, WebMCP, packet, invitation, or email behavior was cut in this release.
- Physical pencil or arbitrary-object tracking, unrecoverable gesture deletion,
  TURN/SFU conferencing scale, recording, screen sharing, enterprise identity,
  billing, native applications, headset support, marketplaces, and desktop
  automation remain outside the public application release.

## Checkpoint 32: user-owned OpenAI credential boundary candidate

### WORKING

- The candidate removes deployment-owner OpenAI credential fallback from
  embedded Live Voice and direct sketch interpretation. On `/demo`, both paths
  require the user to enter an OpenAI API key in the current tab.
- The `/demo` key is held only in React memory and is cleared when the page
  unmounts.
  It is sent transiently in a bounded header to a same-origin authenticated
  route, where the server sees it only long enough to make the requested
  provider call. The application does not persist it in the URL,
  `localStorage`, `sessionStorage`, Supabase, receipts, or application logs.
- A missing or malformed key refuses before provider work. There is no owner
  environment-key fallback. A project-scoped key is recommended so the user
  controls the relevant API project, budget, and revocation boundary.
- ChatGPT Site Tools remain a separate path. They use the account already
  signed into the surrounding ChatGPT host. CommandCanvas does not receive the
  user's ChatGPT credential, and a ChatGPT subscription or login does not
  supply or pay for OpenAI API usage by embedded Live Voice or direct sketch
  interpretation.
- `.env.example` no longer declares `OPENAI_API_KEY` or
  `OPENAI_REALTIME_API_KEY`. `OPENAI_VISION_MODEL` selects a model, and
  `REALTIME_VOICE_ENABLED` controls feature exposure; neither supplies a
  credential.
- The source candidate adds an actor-scoped credential API and meeting UI so a
  verified non-anonymous `/meet` user can explicitly save, replace, or delete
  their own key. Anonymous users are refused from durable credential storage.
- The migration stores an actor-to-secret reference in a private table and the
  key itself through Supabase Vault. Browser roles cannot read the private
  mapping, Vault tables, or secret resolver. The browser receives status and a
  bounded fingerprint, never the raw saved value.
- Realtime and vision provider routes accept either one temporary request key
  or an explicit saved-credential selector. They refuse ambiguous input. A
  saved key is resolved server-side only at the provider boundary.

### VERIFIED LOCALLY AND AGAINST LINKED SUPABASE

- Under Node 22.17.0 with `TMPDIR=/tmp`, the integrated credential-boundary
  suite passed all 144 tests across 12 files with zero failures.
- The tests cover browser credential validation and handoff, missing and
  malformed key refusal, server dependencies without an owner-key fallback,
  embedded Live Voice UI state, direct sketch interpretation, and the
  ChatGPT-account boundary shown in the product surface.
- The same run covers the Vault migration contract, actor-scoped credential
  service and route, browser status/save/delete API, temporary-versus-saved
  provider selection, ambiguous-input refusal, and saved-key non-return.
- The meeting StrictMode suite passed all 22 tests. The combined meeting suite
  passed all 31 tests. Raw TypeScript type-checking passed with zero errors.
- The final Node 22.17.0 release gate passed ESLint, raw `tsc --noEmit`, all
  1,295 Vitest tests across 120 files, the generated hand worker, and the
  optimized Next.js 16.3.3 production build with all 14 pages and the
  `/api/openai-credential` route present. `npm audit --omit=dev
  --audit-level=high` reported zero vulnerabilities.
- Migration `20260901030350` is recorded in the linked Supabase project. It was
  applied from the exact reviewed SQL file without repairing or rewriting the
  project's unrelated historical migration versions.
- The remote catalog assertion passed against the linked project. It verifies
  the Vault extension, private mapping table, RLS, cleanup trigger,
  service-role RPC grants, and denial of browser-role access to the private and
  Vault schemas, both Vault tables, all four public credential wrappers, all
  private credential helpers, and the Vault create/update helpers.
- A transaction-scoped remote probe saved, resolved, and deleted a synthetic
  key through the deployed service-role RPC boundary, exercised direct mapping
  deletion and Vault-secret cleanup, and rolled back.
- A real Chromium browser lifecycle against the exact local optimized
  production build used a temporary verified-email Supabase session and
  synthetic key. It saved the key, asserted the exact SHA-256
  fingerprint, proved the raw key absent from the response, DOM,
  `localStorage`, and `sessionStorage`, reloaded and recovered saved status,
  required explicit delete confirmation, deleted the key, and verified zero
  room or credential residue. This test does not call OpenAI.
- The same optimized build passed the applicable responsive landing and
  Realtime-input browser matrix in desktop Chromium, mobile Chromium, and
  mobile WebKit profiles: 10 passed, 11 intentional project-specific skips,
  and zero failures.
- Final remote read-back reported the migration recorded, zero synthetic probe
  users, zero synthetic probe rooms, and zero stored credentials.
- Vault/RPC failure is now distinguished from an unconfigured account: missing
  credentials return the bounded configuration refusal, while an unavailable
  credential service returns the existing compact temporary-service response.
- Metadata-only Vercel inspection confirmed the obsolete `OPENAI_API_KEY` and
  `OPENAI_REALTIME_API_KEY` bindings were removed from both Production and
  Preview. Supabase, Resend, invitation, and private-relay bindings were not
  removed.
- A GitGuardian Generic Password alert against the first pushed candidate was
  traced to the E2E probe's generated test-login assignment, not a deployed or
  user credential. The detector-shaped assignment was replaced with a
  cryptographically random test value bound through a neutral fixture name;
  the complete account browser lifecycle and release gate then passed again.

### UNVERIFIED

- This candidate is not yet claimed as committed, pushed, or deployed. The
  canonical public origin remains the prior release until an exact candidate
  commit is deployed and fresh production evidence is collected.
- No real user-key OpenAI Realtime or vision provider call has been exercised
  against this candidate. Provider acceptance, project ownership and billing,
  physical-device behavior, and public no-owner-key behavior remain pending.
- No deployed browser has yet exercised `/meet` status, explicit save,
  replacement, deletion, raw-value non-return, or a provider operation resolved
  from the saved credential.
- The local browser lifecycle used an admin-created, confirmed test user and a
  programmatically installed Supabase session. It verifies the permanent-email
  account and credential lifecycle, not delivery or entry of an OTP email.
- ChatGPT desktop app’s built-in browser Site Tools invocation remains unverified. Native
  Chrome, API, and unit tests do not substitute for a call made by ChatGPT
  against the same live page and session.

### CUT

- Nothing was cut from product scope. This candidate changes credential
  authority and preserves the normal typed, pointer, touch, collaboration,
  hand-control, WebMCP, and deterministic fallback paths.

## Checkpoint 33: public user-owned credential release

### WORKING

- Public GitHub `main` code commit
  `f119daba2547ffb9b4a006ca418cede84bbe7249` contains the account-owned
  credential boundary described in Checkpoint 32. Its sole author is Daniel
  Romitelli and the commit contains no co-author or AI attribution.
- GitHub Actions run `33468060716` completed successfully for that exact SHA.
  The build-and-unit gate used Node 22 and finished with conclusion `success`.
- Vercel deployment `dpl_D3QzjuUQi6zq6s2KBWK3mT5dGasg` reports `READY`,
  production target, branch `main`, repository `commandcanvas`, and exact Git
  SHA `f119daba2547ffb9b4a006ca418cede84bbe7249`.
- The canonical `https://commandcanvas.vercel.app` alias resolves to that exact
  deployment. Metadata-only checks confirm `OPENAI_API_KEY` and
  `OPENAI_REALTIME_API_KEY` are absent from both Vercel Production and Preview.
- The linked Supabase project records migration `20260901030350`. The expanded
  live catalog assertion passes and the final read-only residue query reports
  zero probe users, zero probe rooms, and zero stored credentials.

### VERIFIED IN BROWSER

- A fresh Chromium run against the canonical public origin passed the complete
  verified-email account lifecycle with a synthetic key: save, exact
  fingerprint, raw-value non-return, DOM and Web Storage absence, reload,
  explicit deletion confirmation, deletion, and checked cleanup. It made no
  OpenAI provider call and passed in 6.2 seconds.
- The public responsive landing and Realtime-input matrix passed all applicable
  desktop Chromium, mobile Chromium, and mobile WebKit scenarios: 10 passed,
  11 intentional project-specific skips, and zero failures.
- Fresh canonical HTTP checks returned 200 for `/`, `/demo`, and `/meet`. An
  unauthenticated `GET /api/openai-credential` returned the expected compact
  401 `authorization_missing` refusal.
- The first pushed candidate triggered GitGuardian's Generic Password detector
  because its E2E probe assigned a generated test login string to a variable
  named `password`. No real credential was present. The detector-shaped source
  was replaced with a cryptographically random runtime fixture, public `main`
  was replaced using an exact force-with-lease, and the browser and complete
  source gates passed again on the replacement.

### UNVERIFIED

- A real user-owned OpenAI API key has not completed a Realtime or vision
  provider call through the new saved-key resolver on this exact release. The
  deployed account lifecycle proves storage, retrieval selection, and deletion;
  it does not prove provider billing or model access.
- The account browser probe installs a confirmed test session directly. It does
  not prove delivery or entry of a fresh Supabase OTP email, although the OTP
  flow remains implemented and separately covered by its existing tests.
- ChatGPT desktop app’s built-in browser Site Tools invocation remains a host-rollout check.
  Native browser tests do not substitute for a tool call made by ChatGPT against
  the same live page and session.
- Physical phone hand accuracy, fingertip drawing ergonomics, pinch reliability,
  two-hand resize, camera occlusion, thermal behavior, and cross-network media
  still require human-device acceptance. Controlled browser media and device
  profiles do not turn those boundaries into physical proof.
- GitGuardian dashboard incident-state dismissal was not automated. The
  detector-shaped source is absent from public `main`, but the external incident
  UI may still require marking the superseded synthetic occurrence resolved.

### CUT

- Nothing was cut from the implemented canvas, object creation, hand-control,
  collaboration, voice, WebMCP, invitation, packet, or Resend behavior in this
  release.
- Production conferencing scale, TURN/SFU relaying, recording, screen sharing,
  enterprise identity, billing, native applications, headset support,
  marketplaces, desktop automation, and arbitrary physical-object tracking
  remain outside this release.

## Checkpoint 34: hand-control recovery production candidate

### WORKING

- The application is canvas-first and retains one canonical command and receipt
  path for pointer, touch, hand landmarks, embedded Realtime voice, ChatGPT Site
  Tools, and collaborator mutations.
- Full-hand calibration records open-hand geometry and reach. Calibrated
  coordinates map to the full visible canvas rather than the camera-preview
  rectangle. One Euro filtering, confidence hysteresis, magnetic acquisition,
  pinch dwell, and relaxed index-led drawing are present in the shared gesture
  pipeline.
- The private hand-relay path is opt-in and falls back to local browser
  landmarks when it is disabled or unavailable. The public capability endpoint
  reports protocol version 1, 21 landmarks, newest-frame-only scheduling,
  zero raw-frame retention, CUDA FP16, and an NVIDIA RTX 3090 runtime.
- Realtime voice can create notes, boards, schedules, diagrams, charts, tables,
  references, and meeting cards through the canonical mutation layer. It can
  also append speech-to-text to the selected thought card and waits for the
  resulting persisted receipt before confirming success.
- `/meet` is account-first and uses Supabase email OTP. Invitations retain their
  token in memory while a recipient switches to the invited account. The
  limited `/demo` route creates a no-signup anonymous identity only after an
  explicit judge-preview gate.
- Verified non-anonymous users can save, replace, or delete their own OpenAI API
  key through the server-side Supabase Vault boundary. Production contains no
  deployment-owner OpenAI API key.
- Meeting invitations and host-approved packet sends use server-side Resend
  credentials. Packet approval freezes an exact recipient snapshot, and the
  external send still requires an explicit host action.
- Supabase migration `20260901093110` is recorded in the linked project. Its
  catalog checks confirm the fixed demo deadline, admission ledgers, access
  predicate, durable mutation guard, and voice, vision, hand-relay, and packet
  wrappers.
- Public-demo policy is bounded to a fixed 24-hour lifetime, 64 concurrently
  active rooms, 100 room admissions per UTC day, and bounded join attempts.
  Durable state and paid-provider operations fail closed after room expiry.
- Vercel configuration now has no Preview-only application bindings. Required
  Supabase, Resend, voice, WebMCP, model-selection, and private-relay values are
  present in Production. `OPENAI_API_KEY` and `OPENAI_REALTIME_API_KEY` are
  absent.

### VERIFIED LOCALLY

- Node 22.17.0 `npm run lint`: exit 0.
- Node 22.17.0 raw `npx tsc --noEmit`: exit 0 with no diagnostics.
- Node 22.17.0 `npm test -- --run`: 124 files and 1,348 tests passed with zero
  failures.
- Node 22.17.0 `npm run build`: the generated hand worker and optimized Next.js
  16.3.3 build completed, including all 14 static pages and dynamic API routes.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- The responsive optimized-build matrix passed all eight applicable desktop
  Chromium, mobile Chromium, and mobile WebKit scenarios. Twelve
  project-specific scenarios were intentionally skipped and none failed.
- The linked Supabase project has 34 historical demo-room rows, only two within
  their fixed active lifetime, and zero creation admissions recorded for the
  current UTC day at the time of the check. The bounded room failure was not a
  capacity failure.
- A controlled camera run could not enter the local demo because the local
  optimized server intentionally lacked `SUPABASE_SECRET_KEY`. The route failed
  closed with HTTP 503 before camera initialization. Production has that
  server-only binding; this local result is not presented as camera acceptance.

### VERIFIED IN BROWSER

- The pre-release optimized build passed its applicable responsive layout and
  hand-calibration browser matrix in desktop Chromium, mobile Chromium, and
  mobile WebKit profiles.
- Previous named-browser evidence remains historical evidence only. Fresh
  canonical Production checks for this exact candidate are pending its frozen
  Git SHA and deployment ID.

### UNVERIFIED

- This checkpoint does not yet claim a Git commit, GitHub Actions run, Vercel
  Production deployment, canonical alias, or public browser acceptance. Those
  receipts must be added only after the exact source SHA is pushed and deployed.
- Physical-device acceptance remains required for real index-finger drawing,
  pinch acquisition, one- and two-hand manipulation, camera occlusion, lighting,
  thermal behavior, and full-canvas ergonomics. Controlled media and emulated
  device profiles are not physical proof.
- A real user-owned key has not yet completed a public Realtime or vision call
  on this candidate. A real Resend invitation, OTP delivery and entry, approved
  packet delivery, and webhook reconciliation also require fresh Production
  acceptance.
- ChatGPT desktop app’s built-in browser Site Tools invocation remains a host-rollout check.
  Native Chrome registration does not substitute for a tool invocation made by
  ChatGPT against the same live page and session.
- Supabase Realtime may cache authorization for an already-open WebSocket. The
  normal client disconnects at the fixed deadline and all durable access and new
  subscriptions fail closed, but an intentionally modified client is not proven
  to receive exact wall-clock transport eviction.
- Public anonymous-auth identities are created before database room admission.
  Supabase Auth rate limits, CAPTCHA, and orphan-identity cleanup have not been
  independently exercised in this checkpoint.
- The superseded GitGuardian synthetic Generic Password incident may still need
  dismissal in the external dashboard. The detector-shaped test literal is not
  present on current `main`.

### CUT

- No implemented object-creation, voice, hand-control, WebMCP, collaboration,
  invitation, packet, or Resend path was removed from this candidate.
- Production TURN/SFU conferencing infrastructure, recording, screen sharing,
  enterprise identity, billing, native applications, headset support,
  marketplaces, desktop automation, and arbitrary physical-object tracking are
  not claimed by this release.

## Checkpoint 35: authenticated entry, demo reload, and public release closeout

### WORKING

- The verified-email meeting lobby now handles OTP request, OTP verification,
  host profile submission, and in-room invitation creation through explicit
  client submit handlers that synchronously prevent native form navigation.
  A mobile browser can no longer win a page reload against successful room
  creation and return the host to the display-name form.
- Production request logs and database membership checks showed that the
  reported display-name attempts had already returned HTTP 201 and created
  matching host memberships. The defect was the client navigation fallback,
  not a failed Supabase mutation. Existing user-created rooms were preserved.
- The limited judge preview still requires an explicit first entry. That choice
  is now remembered only for reloads in the same browser tab, allowing the
  current Supabase room and participant session to reconstruct. A new tab still
  presents the entry gate, and storage-disabled browsers retain the repeated
  gate rather than bypassing it.
- Public source commit
  `3dfe1c135cf00387c5b985d5c4ab5b0a68d36d60` contains the runtime fixes. It
  is authored and committed only by Daniel Romitelli, with no co-author or
  automated-author attribution.
- GitHub Actions run `33498110021` completed with conclusion `success` for that
  exact SHA. Vercel deployment `dpl_4CSdyfPnB3KDtJLWrsW7AWyJUpxD` is `Ready`,
  targets Production, contains the same Git SHA, and owned the canonical
  `https://commandcanvas.vercel.app` alias for the browser runs below. This
  checkpoint is necessarily recorded in a later documentation-only commit;
  that successor changes no runtime application file and requires its own final
  alias receipt in the release handoff.
- The linked Supabase migration ledger records both repository-matched release
  migrations `20260901030350` and `20260901093110`. Historical version-ID
  differences remain documented; fresh projects apply the repository files in
  filename order and raw linked `supabase db push` remains intentionally
  disallowed until that historical ledger is reconciled.
- Vercel has the required Supabase, Resend, voice, WebMCP, vision-model, and
  private-relay configuration names in Production. No deployment-owner OpenAI
  API key is present. Preview has zero environment bindings and zero
  deployments.

### VERIFIED LOCALLY

- `npm run lint`: exit 0 with no warnings.
- Raw `npx tsc --noEmit`: exit 0 with no diagnostics.
- `npm test -- --run`: 124 files and 1,351 tests passed with zero failures.
- `npm run build`: the generated hand worker and optimized Next.js 16.3.3
  webpack build completed, including all 14 static pages and dynamic API
  routes.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities.
- Regression coverage proves that the authenticated host form has no native
  action, prevents the submit event default, and forwards the exact room and
  display-name `FormData`. Separate coverage proves the first judge-preview
  entry is explicit and same-tab reload recognition is session-scoped.

### VERIFIED IN BROWSER

- Fresh canonical requests returned HTTP 200 for `/`, `/demo`, and `/meet`.
  An unauthenticated `GET /api/openai-credential` returned the required HTTP
  401 `authorization_missing` refusal.
- The exact Production deployment passed 10 applicable responsive landing,
  reduced-motion, trusted touch/stylus, offline-recovery, desktop Chromium,
  mobile Chromium, and mobile WebKit scenarios. Eleven inapplicable project
  combinations were intentionally skipped and none failed.
- The exact Production deployment passed 13 applicable spatial-object browser
  scenarios covering creation, selection, pointer movement, resize, minimize,
  restore, recoverable discard, undo, pan, zoom, direct speech transcription,
  WebMCP bridging, receipts, desktop layout, and mobile layout. Nine
  inapplicable project combinations were intentionally skipped and none failed.
- Two fresh production browsers joined one real no-signup Supabase room. The
  run verified Presence, two participant indicators, cursor broadcast,
  collaborator mutation persistence, activity receipts, offline recovery,
  grouping, transform, undo, redo, ungroup, participant reload, room-state
  reconstruction, and resumed cursor movement. A second scenario verified
  that a fresh tab retaining only the Supabase identity reopened the recent
  room rather than allocating a duplicate. Both scenarios passed and their
  temporary rooms were deleted in `finally` cleanup.
- The WebKit failures observed during this closeout were resolved as test
  contract defects, not hidden: toolbar-created objects are intentionally named
  `Project board` and `Schedule` without invented commitments, and WebKit's
  non-document `Load request cancelled` events during deliberate navigation
  are distinguished from real document or network failures.

### PUBLIC REPOSITORY CLEANUP

- The public default branch no longer contains internal `.superpowers`
  execution reports or an inoperative CodeRabbit configuration. The ignore
  contract prevents the internal reports from returning.
- The obsolete review pull request is closed and neutrally titled. Its review
  thread is resolved, its non-deletable bot comment is minimized as `outdated`,
  and it has zero issue comments. Both temporary review branches were deleted.
- Public branches are now exactly `main` and `hand-relay-source`. The latter is
  intentionally retained because commit
  `ee5c2afcfbfc8427b39e2f13e170785c87bce2e3` is the exact separate AGPL
  corresponding source for the optional GPU relay. `SOURCE.md` and the relay
  documentation link that exact commit.
- The obsolete Vercel deployment tied to the superseded synthetic-secret test
  commit was deleted. Current GitHub secret scanning reports no source alert,
  and the detector-shaped literal is absent from current `main`.

### UNVERIFIED OR EXTERNALLY BLOCKED

- The reported physical mobile OTP and display-name sequence still needs one
  user rerun against this exact release. The native-navigation regression is
  covered and the prior production API/database results are known, but an
  automated confirmed session is not a substitute for entering a newly
  delivered OTP on the user's device.
- ChatGPT desktop app’s built-in browser Site Tools invocation remains a host-rollout check.
  The application correctly distinguishes the surrounding ChatGPT account from
  CommandCanvas room identity, but native browser registration does not prove a
  tool call made by ChatGPT against the same live page and session.
- Physical camera, index-finger drawing, pinch acquisition, two-hand resize,
  throw ergonomics, lighting, occlusion, thermal behavior, and private RTX
  relay fallback require a real human and target device. Deterministic landmark
  media and browser profiles remain engineering evidence, not physical proof.
- A fresh billed Realtime or vision call with a real user-owned OpenAI key and a
  fresh real Resend invitation or approved packet delivery were not repeated on
  this closeout SHA. Their server boundaries and historical provider evidence
  remain intact, but are not presented as new provider evidence.
- GitHub rejected deletion of historical Actions run `33467667512` and changes
  to repository topics or vulnerability-alert settings with HTTP 403 for the
  available token. The run is not reachable from a current branch, its paired
  Vercel deployment is deleted, and the external GitGuardian dashboard incident
  may still require an owner-session dismissal or later GitHub cache cleanup.

### CUT

- No implemented object-creation, voice, hand-control, WebMCP, collaboration,
  invitation, authentication, packet, or Resend behavior was removed.
- Production TURN/SFU conferencing infrastructure, recording, screen sharing,
  enterprise identity, billing, native applications, headset support,
  marketplaces, desktop automation, and arbitrary physical-object tracking are
  not claimed by this release.

## Checkpoint 36: hydration-safe production and browser-host ratchet

### WORKING

- The no-signup preview entry is now disabled in server-rendered markup and
  becomes enabled only after React hydration. Its regression test performs an
  actual `renderToString` to `hydrateRoot` transition, records recoverable
  hydration errors, proves the post-hydration enablement, and proves that the
  first click reveals the canvas. This closes the reproduced race in which a
  browser clicked the SSR button before its handler existed and no room request
  was made.
- A production WebKit audit measured the footer **Source** target at 41.28125
  CSS pixels wide. A browser test was added first and observed that exact
  failure. The minimal landing-style change gives every footer link a 44 by 44
  CSS-pixel minimum; the isolated fresh-build Chromium and WebKit matrix then
  passed.
- Runtime source commit
  `c6105f472c09014c25fbe952600a4098fdcd44f7` is authored and committed only by
  Daniel Romitelli, with no co-author or automated-author attribution.
- GitHub Actions run `33517036262`, job `99886544358`, completed successfully
  for that exact SHA. Its integrated gate ran ESLint, TypeScript, 125 Vitest
  files with 1,386 passing tests, the 152.4 KiB hand-worker build, and the
  optimized Next.js 16.3.3 production build with 14 of 14 static pages.
- Vercel deployment `dpl_3FtsMvd3C4FU1rfFgBCJ4XrpziBL`, unique URL
  `commandcanvas-lxaq7virg-imaginovai.vercel.app`, is `READY`, targets
  Production, and contains the exact runtime SHA. The canonical
  `https://commandcanvas.vercel.app` alias, the project alias, and the main
  branch alias all resolve to that deployment.
- Production contains the required Supabase and Resend bindings plus the
  WebMCP, vision-model, voice, and private-relay configuration names. It has no
  deployment-owner `OPENAI_API_KEY` or `OPENAI_REALTIME_API_KEY`. Preview has
  zero environment bindings. The private GPU relay remains fail-closed because
  `PRIVATE_HAND_RELAY_SIGNING_KEY` has not been supplied to Vercel Production.

### VERIFIED IN BROWSER

- The exact Production release passed nine applicable landing, reduced-motion,
  touch-target, narrow-width, and full-viewport browser scenarios in desktop
  Chromium, mobile Chromium, and mobile WebKit. Six project-inapplicable cases
  were intentionally skipped and none failed. Widths from 320 through 1,440
  CSS pixels had no horizontal overflow, and every mobile footer link met the
  44 CSS-pixel minimum.
- Official Chrome for Testing 153.0.8010.5 passed the strict public static-mode
  WebMCP probe. The browser exposed `document.modelContext`, did not expose the
  deprecated navigator surface, discovered the eleven-tool catalog, completed
  native `get_canvas_state` and semantic `create_object`, rendered the
  Daniel-attributed `webmcp` receipt, preserved static registration lifecycle,
  honored client-side cancellation, emitted no unexpected page or console
  error, and deleted its exact temporary room.
- Two independent Production Chromium contexts passed both Supabase
  collaboration scenarios. They verified Presence, cursor Broadcast, durable
  collaborator mutation and receipt sync, grouping, rotation, undo, redo,
  ungrouping, offline state preservation, reconnect, reload reconstruction,
  same-identity recent-room recovery, and exact temporary-room cleanup.
- Production desktop and mobile Chromium passed the synthetic-camera local
  detector lifecycle. The real browser acquired a fake media track, loaded the
  same-origin worker, WASM, and MediaPipe hand-landmarker model, reached
  **Hand input ready · local only**, kept calibration geometry in bounds, and
  detached and ended the track on disable. Desktop also passed the classic-WASM
  recovery path. Three applicable scenarios passed, the deliberate
  desktop-only project mismatch skipped once, and no page error was observed.
- Querying the exact Vercel deployment after these probes returned no
  server-side error-level runtime log entry.

### UNVERIFIED OR EXTERNALLY BLOCKED

- A real ChatGPT desktop built-in-browser Site Tools invocation is still
  required. Chrome 153 proves the browser API and page implementation, but it
  cannot prove account rollout, model selection, the address-bar Available
  Site Tools list, ChatGPT safety review, Recently Used/Sources, or a live
  `get_canvas_state` and `create_object` call made by GPT-5.6 Sol or Terra
  against this page. No second ChatGPT login should appear inside CommandCanvas;
  the surrounding desktop application account is the host identity.
- Physical-camera acceptance remains required for index-finger drawing, pinch
  acquisition, one- and two-hand manipulation, throw-to-trash, smoothing,
  latency, lighting, occlusion, thermal behavior, and full-canvas ergonomics.
  Synthetic media proves runtime lifecycle, not a human hand.
- The optional RTX 3090 relay has a verified public origin and explicit-consent
  application contract, but the Production token route remains intentionally
  disabled until the existing relay signing key is explicitly authorized for
  the Vercel Production destination. Local MediaPipe remains the automatic
  fallback.
- Fresh physical OTP entry, a real Resend invitation or approved packet send,
  webhook reconciliation, a user-key-funded Realtime microphone session, and a
  user-key-funded vision transform were not executed on this exact release.
  Their implementation and historical provider evidence are retained, but no
  new provider success is claimed.
- Physical touch and stylus ergonomics remain separate device checks. Browser
  touch, pen, and WebKit profiles do not prove palm rejection, pressure, tilt,
  or device-specific comfort.

### CUT

- No implemented object-creation, Site Tools, continuous voice, hand-control,
  collaboration, participant-media, authentication, invitation, packet, or
  Resend path was removed.
- Production TURN/SFU infrastructure, recording, screen sharing, enterprise
  identity, billing, native applications, headset support, marketplaces,
  desktop automation, and arbitrary physical-object tracking are not claimed.
- No Devpost submission has been made. Submission remains blocked on the real
  ChatGPT-host and physical-hand acceptance capture requested by the owner.
