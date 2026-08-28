# Devpost submission draft

## Project name

CommandCanvas

## Tagline

A shared spatial workspace where people and ChatGPT turn rough thinking into structured, attributable output on the same live canvas.

## Public links

- Live demo: <https://commandcanvas.vercel.app/demo>
- Source: <https://github.com/romiteld/commandcanvas>

## Inspiration

Meetings generate sketches, decisions, tasks, and commitments, but the useful output is usually reconstructed later in another tool. CommandCanvas explores a different model: people, collaborators, and an agent operate on the same live semantic objects while the discussion is still happening.

## What it does

CommandCanvas is an infinite spatial collaboration canvas built from structured objects rather than untyped pixels or documents. A no-signup judge room opens with a project board, schedule, decision, live presence, and an activity trail. Standard meetings use six-digit Supabase Email OTP and exact-email invitations without passwords. Participants can create, move, resize, rotate, pin, minimize, recover, group, ungroup, undo, and redo objects through pointer, touch, stylus, typed commands, optional hand landmarks, or continuous in-page voice.

The defining workflow begins with a rough sketch and the person’s explanation of what it means. Mouse, touch, stylus, or local finger tracking produces a durable `SketchObject`. CommandCanvas rasterizes the selected strokes to a PNG in the browser and sends that image with the user’s bounded prior narration and instruction to an image-capable model. A strict structured-output schema is validated before a new semantic visual appears beside the preserved original. Auto selection uses the sketch, narration, and instruction to choose among a generic diagram, flowchart, pie chart, bar chart, or line chart; an architecture diagram is also available as an explicit supported kind. Architecture is one example rather than the product’s audience or subject boundary.

WebMCP lets ChatGPT collaborate on the same page and session. The site exposes ten bounded tools for reading the canvas, creating and transforming objects, changing object state, recoverable discard, grouping and ungrouping, undo and redo, transforming a selected sketch, preparing a meeting packet, and staging an approved packet send. Every mutation uses the same validated command boundary as pointer and collaborator input and produces a visible receipt.

Continuous voice is a separate, narrower surface. After the user presses **Start**, a regular `gpt-realtime-2.1` WebRTC session listens for natural canvas commands without another Run click. Its tools cover safe canvas creation, selected-object operations, local focus, grouping, rotation, history, recoverable trash, bounded thought capture, and sketch transformation. **Start a new thought** creates and selects one note card; later completed user turns are appended to that same card as speech-to-text until **Finish thought**. Those boundary commands and assistant speech are excluded, and unrelated voice tools are refused during capture. Every accepted transcript append is a version-checked canonical mutation with a receipt and Undo. An explicit spoken discard remains undoable and never permanently deletes data. Live voice cannot manage rooms, approve packets, or send email. Except for local-only focus, a tool result reports submission; the shared receipt proves completion.

Meeting packets preserve human control over consequential actions. The host reviews the exact object snapshot, edits recipients, and approves a version that locks both content and recipient hashes. An agent can stage a send, but the site still requires an explicit host click. When Resend is not configured or a recipient is outside the allowlist, CommandCanvas records and displays an honest preview-only outcome instead of claiming delivery. Supabase Auth OTP mail, Resend meeting invitations, and Resend packet delivery are separate paths with separate authority and configuration.

An optional meeting filmstrip lets up to four room members start peer-to-peer audio and video. Supabase carries schema-validated signaling on a dedicated private media topic, while WebRTC carries the media directly between browsers. It is intentionally not a conferencing replacement and does not include TURN, an SFU, recording, or screen sharing.

## How it was built

- Next.js 16, React 19, TypeScript, Zustand, Zod, and a custom DOM/SVG infinite-canvas engine
- `document.modelContext.registerTool(...)` with schemas, annotations, cancellation propagation, lifecycle abort signals, static registration by default, and optional dynamic phase registration
- Supabase Anonymous Auth for the no-signup `/demo` path and Email OTP for standard `/meet` rooms
- Supabase Postgres for rooms, semantic objects, immutable receipts, packet snapshots, send requests, and vision-admission records
- Supabase Realtime Presence for connected participants and Broadcast for high-frequency cursors and compact revision notifications
- Browser WebRTC for an opt-in small-room meeting filmstrip, with signaling isolated on `room-media:<room-id>`
- Pinned YOLO26 Hand Pose exported to a same-origin 320×320 FP16 ONNX model, with ONNX Runtime Web and exactly 21 keypoints
- An installed optional native ONNX Runtime CUDA relay at `hands.autolensai.com`, selected only after explicit camera-upload consent; local YOLO remains the fallback
- A visibly labeled MediaPipe recovery detector that is attempted only after a YOLO initialization or runtime failure
- OpenAI `gpt-realtime-2.1` over WebRTC for opt-in continuous voice, with a narrower tool catalog and durable paid-session admission limits
- OpenAI Responses image input with strict structured output for sketch interpretation
- Vercel Functions for authenticated mutation, vision, and packet boundaries
- Optional Resend invitation and packet submissions behind separate address allowlists; packet delivery also requires an immutable approval snapshot and explicit host authorization

Local hand tracking keeps camera frames in the browser. If a person explicitly
enables the private-GPU option, bounded newest-only JPEG/WebP frames go only to
`hands.autolensai.com` while Hand input is active. The relay returns semantic
landmarks, does not retain raw frames, and falls back to local YOLO when it is
unavailable. Camera frames never enter ChatGPT, OpenAI, Supabase, or WebMCP.

All input paths converge on one architecture:

```text
Pointer · Touch · Stylus · Typed command · Continuous GPT Realtime voice
Local or consented private-GPU hand landmarks · Collaborator · ChatGPT Site Tools through WebMCP
                                  │
                                  ▼
                         Semantic intent
                                  │
                                  ▼
                    Validated canonical command
                                  │
                  ┌───────────────┼───────────────┐
                  ▼               ▼               ▼
              Object state     Revision        Receipt
                  │               │               │
                  └───────────────┴───────────────┘
                                  │
                                  ▼
                       Supabase persistence
                         and realtime sync
```

## WebMCP leverage

WebMCP is the semantic boundary between ChatGPT and a live visual workspace. It lets ChatGPT inspect current objects and selection, then operate on stable object identities through ten narrow application capabilities. ChatGPT does not receive camera frames, database credentials, or permission to bypass normal site controls. Tools are phase- and role-guarded again at execution time, regardless of whether registration is static or dynamic.

The continuous `gpt-realtime-2.1` path does not replace that WebMCP boundary. It gives the page a fast hands-free control surface with less authority. ChatGPT Site Tools retain the broader room-aware catalog and the packet workflow. The two surfaces share the canonical command and receipt pipeline, but they do not share provider credentials, tool catalogs, or verification claims.

This matters because the useful context is not a detached chat transcript. It is the same selected sketch, board, schedule, room revision, packet version, and approval state that people are currently manipulating. Human, collaborator, and agent changes enter one receipt stream and one undo architecture.

## Judging criteria fit

### WebMCP leverage

ChatGPT operates through ten semantic capabilities against the same selected objects, live room revision, and approval state that the people on the page see. The primary transformation and packet sequence would be weaker as detached chat because the spatial selection, current object identities, realtime collaborators, and site-controlled confirmation are the product context.

### Technical execution

The demo connects WebMCP lifecycle-aware tools, a strict TypeScript object and command model, expected-revision Postgres mutations, immutable receipts, Supabase Presence/Broadcast, peer-to-peer browser media, local hand tracking, continuous GPT Realtime voice, durable paid-work admission, structured image interpretation, responsive canvas geometry, and an explicit external-action authorization boundary. Named automated, browser, and live-service evidence is recorded in the verification ledger.

### Potential impact

CommandCanvas targets the expensive gap between discussion and usable follow-through. The same pattern can support planning, teaching, design critique, data review, technical interviews, and any collaborative session where a rough visual needs to become reusable output without replacing the meeting product a team already uses. Structured objects can become tasks, schedules, diagrams, charts, and packets while their provenance remains visible.

### Creativity

The memorable interaction is not gesture control by itself. A person can draw and explain a rough spatial artifact, then receive a separate structured diagram or chart on the shared canvas. The person can physically manipulate the result, a collaborator can modify surrounding work, and ChatGPT can continue operating through explicit application capabilities. The preserved source and unified receipt stream keep that cinematic interaction inspectable and reversible.

## Technical execution

- Optimistic high-frequency motion remains local/ephemeral; stable state commits once at pointer release.
- Stable mutations use an expected room revision and fail on stale state.
- Object and packet schemas reject unknown or malformed data before mutation.
- Vision work uses durable leases, rate limits, exact-request caching, and compare-and-set completion so retries do not silently duplicate paid work.
- Packet approval snapshots exact content and recipients. Cancellation is durable and a cancelled request cannot later execute.
- Private credentials remain server-side. The public demo uses a browser-created anonymous authenticated identity but presents no signup, login, password, third-party account, or configuration.

## Challenges

The hard part was not drawing rectangles. It was preserving one trustworthy state model across pointer previews, durable collaboration, agent tools, image interpretation, undo, and external actions. We also had to make high-frequency realtime behavior feel immediate without writing cursor motion to Postgres, and make a camera interaction memorable without making it a dependency for core operation.

An additional browser constraint was experimental WebMCP lifecycle behavior. CommandCanvas keeps a stable tool catalog by default, puts dynamic registration behind one feature flag, and preserves identical execute-time guards in both modes.

## Accomplishments

- One mutation and receipt pipeline across human, collaborator, and agent inputs
- A rough-sketch-and-narration transformation into a schema-validated diagram or chart that preserves the source
- No-signup, two-browser Supabase collaboration with actual Presence and Broadcast
- Passwordless standard rooms with six-digit Email OTP, 24-hour exact-email invitations, one-time transactional acceptance, and fragment scrubbing
- No-reload recovery after a browser network outage, with Presence and durable collaboration restored
- WebMCP tools that operate on the same live React page rather than a detached copy
- Reversible, attributable canvas mutations
- Modifier and touch-friendly multi-selection, semantic grouping and ungrouping, 15-degree rotation, and shared undo/redo
- Nested semantic frames whose descendants move and rotate through one canonical mutation
- YOLO index-fingertip drawing, one-hand pinch grab, two-hand pinch resize, open-palm focus or restore, side-edge recoverable trash, and bottom-dock minimize
- A full-canvas hand control plane that maps a comfortable central camera region across the workspace, with the camera preview reduced to a sensor check
- Local open-palm canvas pan, two-hand canvas zoom, and visible target, open, pinch, held, resizing, panning, and zoom feedback
- Optional consented CUDA hand-pose inference with bounded newest-frame transport, semantic-only results, no raw retention, and automatic local fallback
- Continuous `gpt-realtime-2.1` voice that submits narrow commands without a Run click
- No-mouse thought capture that keeps completed user speech inside one selected, receipt-backed note card
- Opt-in two-browser peer-to-peer meeting media, separate from Supabase Presence and cursor traffic
- Exact packet and recipient approval snapshots with durable cancellation and honest delivery fallback
- A deterministic resettable judge route that remains useful without WebMCP, camera permission, model access, Realtime, or Resend

## What was learned

Spatial interaction becomes reliable when gesture recognition produces the same small semantic intents as a pointer instead of owning separate business logic. Agent actions become trustworthy when every capability has a narrow schema, live-state guards, and a visible receipt. External effects become safer when the agent requests an action but the site retains the final human authorization step.

## What is next

The immediate next work is measured real-hand calibration across webcams and lighting conditions, ChatGPT Site Tools verification where that rollout is available, physical iPhone testing, cross-network WebRTC testing, and richer semantic object types built on the same contracts. Physical marker tracking, TURN or SFU infrastructure, broad document integrations, and enterprise identity remain deliberately outside this submission.

## Honest verification boundary

The repository’s `docs/verification-ledger.md` separates automated evidence, named browser evidence, live-service evidence, unverified integrations, and deliberate cuts. The integrated gates cover the complete current TypeScript suite, generated workers, the optimized application build, non-GPU relay contracts, and reversible edge operations without relying on a stale total in this description. Controlled browser runs verified two-browser Supabase collaboration and peer-to-peer media, a paid `gpt-realtime-2.1` provider session, real vision through an injected standards-shaped `document.modelContext`, real local YOLO worker inference, camera lifecycle, and one allowlisted Resend packet through the full approval and explicit-SEND path. The installed private relay separately returned ready CUDA capabilities and 21 landmarks from a CC0 static hand image. A real screen recording showed the UI recognizing open palm and pinch ratios between 0.22 and 0.28, but post-fix physical-hand ergonomics remain unverified. The public no-signup environment remains preview-only. ChatGPT built-in-browser Site Tools, post-fix physical iPhone interaction, cross-network media, and TURN behavior remain unverified.
