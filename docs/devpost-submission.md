# Devpost submission draft

## Project name

CommandCanvas

## Tagline

A shared spatial workspace where people and agents turn rough thinking into structured, attributable output on the same live canvas.

## Public links

- Email-OTP workspace: <https://commandcanvas.vercel.app/meet>
- No-signup judge preview: <https://commandcanvas.vercel.app/demo>
- Source: <https://github.com/romiteld/commandcanvas>

## Inspiration

Meetings generate sketches, decisions, tasks, and commitments, but the useful output is usually reconstructed later in another tool. CommandCanvas explores a different model: people, collaborators, and an agent operate on the same live semantic objects while the discussion is still happening.

## What it does

CommandCanvas is an infinite spatial collaboration canvas built from structured objects rather than untyped pixels or documents. Durable workspace rooms use six-digit Supabase Email OTP and exact-email invitations without passwords. A secondary, temporary, bounded, no-signup judge preview opens a capped room with a project board, schedule, decision, live presence, and an activity trail only after the visitor explicitly chooses **Enter no-signup preview**. Participants can create, move, resize, rotate, pin, minimize, recover, group, ungroup, undo, and redo objects through pointer, touch, stylus, typed commands, optional hand landmarks, or agent tools. The hand-control surface is implemented but experimental until the exact deployed physical-camera rehearsal passes; pointer, touch, and typed controls remain the reliable baseline.

The competition interaction begins with WebMCP. CommandCanvas registers a bounded Site Tools catalog against the current page, selection, room revision, and approval state. Where the ChatGPT Site Tools rollout is available, ChatGPT can read the live canvas, create compact semantic objects, append bounded text to a selected note through `update_object_content`, change object state, recoverably discard or organize work, use shared history, transform a selected sketch, prepare a meeting packet, and stage an approved packet send. Every mutation uses the same validated command boundary as pointer and collaborator input and produces a visible receipt. CommandCanvas never receives the surrounding ChatGPT credential, and Site Tools cannot bypass normal room, role, phase, revision, or human-confirmation guards. Native Chrome discovery, ChatGPT desktop app’s built-in browser invocation, and in-page Realtime voice remain separate verification boundaries.

The defining competition workflow begins with a rough sketch and the person’s explanation of what it means. Mouse, touch, stylus, or local finger tracking produces a durable `SketchObject`. In a supported ChatGPT desktop app’s built-in browser Site Tools session, the person selects that sketch, gives the surrounding ChatGPT conversation the semantic explanation, and asks **Make that usable.** ChatGPT uses that conversation context plus `get_canvas_state`, then creates a linked structured object through WebMCP. The new diagram or chart appears beside the preserved source with `sourceSketchId` provenance and a receipt attributed to the authenticated room member with WebMCP source provenance. This semantic path does not send sketch pixels through WebMCP or claim that ChatGPT visually interpreted them. Voice-triggered Site Tools are used only if the exact host session verifies that behavior; current OpenAI guidance does not promise it.

CommandCanvas also includes a separate, optional image-interpretation path. It rasterizes selected strokes to PNG in the browser and sends the image with bounded narration and instruction to an image-capable model using the person's temporary or saved project-scoped API key. A strict structured-output schema is validated before a new semantic visual appears beside the preserved original. Auto selection can choose among a generic diagram, flowchart, pie chart, bar chart, or line chart; an architecture diagram is also available as an explicit supported kind. Architecture is one example rather than the product’s audience or subject boundary. This paid provider path supports ordinary browsers but is not the WebMCP competition proof.

Optional continuous voice is a separate, narrower supporting surface. The implemented integration remains experimental until an exact deployed BYOK microphone rehearsal passes. After the user presses **Start**, a regular `gpt-realtime-2.1` WebRTC session listens for natural canvas commands without another Run click. Its tools cover safe canvas creation, selected-object operations, local focus, grouping, rotation, history, recoverable trash, bounded thought capture, and sketch transformation. **Start a new thought** creates and selects one note card; later completed user turns are appended to that same card as speech-to-text until **Finish thought**. Those boundary commands and assistant speech are excluded, and unrelated voice tools are refused during capture. Every accepted transcript append is a version-checked canonical mutation with a receipt and Undo. An explicit spoken discard remains undoable and never permanently deletes data. Live voice cannot manage rooms, approve packets, or send email. It does not replace WebMCP and is not evidence that ChatGPT discovered the Site Tools catalog.

Meeting packets preserve human control over consequential actions. The host reviews the exact object snapshot, edits recipients, and approves a version that locks both content and recipient hashes. An agent can stage a send, but the site still requires an explicit host click. The no-signup judge preview always records an honest preview-only outcome and never calls Resend. Eligible standard-room packet recipients must match the server-side allowlist; missing or rejected provider configuration produces a preview-only or failed result rather than a delivery claim. Supabase Auth OTP mail, host-authorized exact-email meeting invitations, and allowlisted Resend packet delivery are separate paths with separate authority and configuration.

An optional meeting filmstrip lets up to four room members start peer-to-peer audio and video. Supabase carries schema-validated signaling on participant-bound private media topics, while WebRTC carries media directly when possible. The server can mint short-lived TURN credentials for authorized members when a separate relay is configured. It is intentionally not a conferencing replacement and does not include an SFU, recording, or screen sharing.

## How it was built

- Next.js 16, React 19, TypeScript, Zustand, Zod, and a custom DOM/SVG infinite-canvas engine
- `document.modelContext.registerTool(...)` with schemas, annotations, cancellation propagation, lifecycle abort signals, static registration by default, and optional dynamic phase registration
- Supabase Anonymous Auth for the no-signup `/demo` judge preview and Email OTP for standard `/meet` rooms
- Supabase Postgres for rooms, semantic objects, immutable receipts, packet snapshots, send requests, and vision-admission records
- Supabase Realtime Presence for connected participants and Broadcast for high-frequency cursors and compact revision notifications
- Browser WebRTC for an opt-in small-room meeting filmstrip, with signaling isolated on `room-media:<room-id>:<participant-id>`
- MediaPipe Hand Landmarker with exactly 21 landmarks, running locally in a browser worker with a same-model in-page recovery path
- An optional separately operated private CUDA relay, selected only after explicit camera-upload consent and always recoverable to local MediaPipe
- OpenAI `gpt-realtime-2.1` over WebRTC for opt-in continuous voice, with a narrower tool catalog and durable paid-session admission limits
- OpenAI Responses image input with strict structured output for sketch interpretation
- Vercel Functions for authenticated mutation, vision, and packet boundaries
- Optional host-authorized Resend invitation submission without a recipient allowlist, plus separately allowlisted packet submission that requires an immutable approval snapshot and explicit host authorization

Local hand tracking keeps camera frames in the browser. If a person explicitly
enables the private-GPU option, bounded newest-only JPEG/WebP frames go only to
the configured private relay while Hand input is active. The relay returns
semantic landmarks, does not retain raw frames, and falls back to local MediaPipe when it is
unavailable. The MIT application does not distribute that service, its model,
or its GPU operations source. Camera frames never enter ChatGPT, OpenAI,
Supabase, or WebMCP.

All supported input paths converge on one compact architecture:

```text
Hands / Voice / Pointer / ChatGPT -> semantic intent -> guarded command -> mutation + receipt -> Supabase room
```

Collaborator, touch, stylus, typed-command, and accessibility inputs enter the
same guarded command boundary.

## WebMCP leverage

WebMCP is the semantic boundary between a supported agent host and the live visual workspace. It lets that host inspect current objects and selection, then operate on stable object identities through a narrow application capability catalog. Where ChatGPT Site Tools are available, ChatGPT can use that same catalog. The agent does not receive camera frames, database credentials, or permission to bypass normal site controls. Tools are phase- and role-guarded again at execution time, regardless of whether registration is static or dynamic.

The optional `gpt-realtime-2.1` path does not replace that WebMCP boundary. It gives the page a fast hands-free control surface with less authority. Supported ChatGPT Site Tools retain the broader room-aware catalog and the packet workflow. The two surfaces share the canonical command and receipt pipeline, but they do not share provider credentials, tool catalogs, or verification claims.

This matters because the useful context is not a detached chat transcript. It is the same selected sketch, board, schedule, room revision, packet version, and approval state that people are currently manipulating. Human, collaborator, and WebMCP-sourced inputs enter one receipt stream and one undo architecture. WebMCP source provenance is retained while the persisted receipt actor is the authenticated room member whose session authorized the mutation.

## Judging criteria fit

### WebMCP leverage

The page exposes a bounded semantic WebMCP catalog against the same selected objects, live room revision, and approval state that people see. A supported ChatGPT Site Tools host can use this catalog without receiving a detached copy of the meeting. The primary transformation and packet sequence would be weaker as detached chat because the spatial selection, current object identities, realtime collaborators, and site-controlled confirmation are the product context.

### Technical execution

The demo connects WebMCP lifecycle-aware tools, a strict TypeScript object and command model, expected-revision Postgres mutations, immutable receipts, Supabase Presence/Broadcast, peer-to-peer browser media, experimental local hand tracking, experimental GPT Realtime voice, durable paid-work admission, structured image interpretation, responsive canvas geometry, and an explicit external-action authorization boundary. Named automated, browser, and live-service evidence is recorded in the verification ledger; exact deployed physical camera and BYOK microphone behavior are not claimed until their real-device rehearsals pass.

### Potential impact

CommandCanvas targets the expensive gap between discussion and usable follow-through. The same pattern can support planning, teaching, design critique, data review, technical interviews, and any collaborative session where a rough visual needs to become reusable output without replacing the meeting product a team already uses. Structured objects can become tasks, schedules, diagrams, charts, and packets while their provenance remains visible.

### Creativity

The memorable interaction is not gesture control by itself. A person can draw and explain a rough spatial artifact, then receive a separate structured diagram or chart on the shared canvas. The person can manipulate the result through the reliable pointer or touch controls and, after exact deployed physical verification, through the experimental hand-control surface; a collaborator can modify surrounding work, and ChatGPT can continue operating through explicit application capabilities. The preserved source and unified receipt stream keep that cinematic interaction inspectable and reversible.

## Technical execution

- Optimistic high-frequency motion remains local/ephemeral; stable state commits once at pointer release.
- Stable mutations use an expected room revision and fail on stale state.
- Object and packet schemas reject unknown or malformed data before mutation.
- Vision work uses durable leases, rate limits, exact-request caching, and compare-and-set completion so retries do not silently duplicate paid work.
- Packet approval snapshots exact content and recipients. Cancellation is durable and a cancelled request cannot later execute.
- Private credentials remain server-side. The no-signup judge preview presents no signup form, login form, or password. A no-signup visitor enters with one click and receives a temporary anonymous Supabase identity; a returning email-authenticated CommandCanvas user can resume automatically and use only credentials saved for that actor identity. Canvas, collaboration, hand input, typed commands, and deterministic transformations need no provider configuration; optional embedded Live voice and direct OpenAI image interpretation require the visitor's own OpenAI API key for that tab or an actor-owned saved credential.

## Challenges

The hard part was not drawing rectangles. It was preserving one trustworthy state model across pointer previews, durable collaboration, agent tools, image interpretation, undo, and external actions. We also had to make high-frequency realtime behavior feel immediate without writing cursor motion to Postgres, and make a camera interaction memorable without making it a dependency for core operation.

An additional browser constraint was experimental WebMCP lifecycle behavior. CommandCanvas keeps a stable tool catalog by default, puts dynamic registration behind one feature flag, and preserves identical execute-time guards in both modes.

## Accomplishments

- One mutation and receipt pipeline across human, collaborator, and WebMCP-sourced inputs, with authenticated-member actor attribution and retained tool provenance
- A rough-sketch-and-narration transformation into a schema-validated diagram or chart that preserves the source
- No-signup judge-preview, two-browser Supabase collaboration with actual Presence and Broadcast
- Passwordless standard rooms with six-digit Email OTP, 24-hour exact-email invitations, one-time transactional acceptance, and fragment scrubbing
- No-reload recovery after a browser network outage, with Presence and durable collaboration restored
- WebMCP tools that operate on the same live React page rather than a detached copy, including compact semantic creation and bounded selected-note updates
- Reversible, attributable canvas mutations
- Modifier and touch-friendly multi-selection, semantic grouping and ungrouping, 15-degree rotation, and shared undo/redo
- Nested semantic frames whose descendants move and rotate through one canonical mutation
- MediaPipe deliberate index-finger drawing, one-hand pinch grab, two-hand pinch resize, open-palm pen-up and blank-canvas pan, side-edge recoverable trash, and bottom-dock minimize
- A full-canvas hand control plane that maps a comfortable central camera region across the workspace, with the camera preview reduced to a sensor check
- Local open-palm canvas pan, two-hand canvas zoom, and visible target, open, pinch, held, resizing, panning, and zoom feedback
- Consent-gated application contracts for an optional separately operated CUDA hand-pose relay, with bounded newest-frame transport, semantic-only results, no raw retention, and automatic local fallback; the exact AGPL image source is public at commit [`ee5c2afcfbfc8427b39e2f13e170785c87bce2e3`](https://github.com/romiteld/commandcanvas/tree/ee5c2afcfbfc8427b39e2f13e170785c87bce2e3) on the isolated `hand-relay-source` branch
- Continuous `gpt-realtime-2.1` voice that submits narrow commands without a Run click
- No-mouse thought capture that keeps completed user speech inside one selected, receipt-backed note card
- Opt-in two-browser peer-to-peer meeting media, separate from Supabase Presence and cursor traffic
- Exact packet and recipient approval snapshots with durable cancellation and honest delivery fallback
- A deterministic resettable judge route that remains useful without WebMCP, camera permission, model access, Realtime, or Resend

## What was learned

Spatial interaction becomes reliable when gesture recognition produces the same small semantic intents as a pointer instead of owning separate business logic. WebMCP-sourced actions become trustworthy when every capability has a narrow schema, live-state guards, authenticated-member receipt attribution, retained source provenance, and a visible receipt. External effects become safer when an agent host requests an action but the site retains the final human authorization step.

## What is next

The immediate next work is measured real-hand calibration across webcams and lighting conditions, ChatGPT Site Tools verification where that rollout is available, physical iPhone testing, cross-network WebRTC and configured-TURN acceptance, and richer semantic object types built on the same contracts. Physical marker tracking, SFU infrastructure, broad document integrations, and enterprise identity remain deliberately outside this submission.

## Honest verification boundary

The repository’s `docs/verification-ledger.md` separates automated evidence, named browser evidence, live-service evidence, unverified integrations, and deliberate cuts. Earlier local YOLO/browser and native CUDA evidence belongs to the superseded combined AGPL build; it does not prove the current MIT browser engine. A named MediaPipe-only release completed controlled-media desktop and mobile camera lifecycle runs through the worker and model, including labeled desktop recovery and exact shutdown behavior. These controlled runs do not verify physical-hand accuracy or ergonomics. Controlled runs separately verified two-browser Supabase collaboration and peer-to-peer media, a paid `gpt-realtime-2.1` provider session, exact-production OpenAI vision that preserved the sketch beside a schema-validated structured visual, and one allowlisted Resend packet through the full approval and explicit-SEND path. The public no-signup judge preview remains preview-only. ChatGPT desktop app’s built-in browser Site Tools, post-fix physical iPhone interaction, cross-network media, and TURN behavior remain unverified.
