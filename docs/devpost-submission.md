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

CommandCanvas is an infinite spatial collaboration canvas built from structured objects rather than untyped pixels or documents. A no-signup room opens with a project board, schedule, decision, live presence, and an activity trail. Participants can create, move, resize, rotate, pin, minimize, recover, group, ungroup, undo, and redo objects through pointer, touch, stylus, typed commands, optional hand landmarks, or continuous in-page voice.

The defining workflow begins with a rough sketch. Mouse, touch, stylus, or local finger tracking produces a durable `SketchObject`. CommandCanvas rasterizes the selected strokes to a PNG in the browser and sends that image with the user’s instruction to a vision-capable model. A strict structured-output schema is validated before a new `DiagramObject` appears beside the preserved original.

WebMCP lets ChatGPT collaborate on the same page and session. The site exposes ten bounded tools for reading the canvas, creating and transforming objects, changing object state, recoverable discard, grouping and ungrouping, undo and redo, transforming a selected sketch, preparing a meeting packet, and staging an approved packet send. Every mutation uses the same validated command boundary as pointer and collaborator input and produces a visible receipt.

Continuous voice is a separate, narrower surface. After the user presses **Start**, a regular `gpt-realtime-2.1` WebRTC session listens for natural canvas commands without another Run click. Its tools cover safe canvas creation, selected-object operations, local focus, grouping, rotation, history, and sketch transformation. It cannot discard objects, manage rooms, approve packets, or send email. Except for local-only focus, a tool result reports submission; the shared receipt proves completion.

Meeting packets preserve human control over consequential actions. The host reviews the exact object snapshot, edits recipients, and approves a version that locks both content and recipient hashes. An agent can stage a send, but the site still requires an explicit host click. When Resend is not configured or a recipient is outside the allowlist, CommandCanvas records and displays an honest preview-only outcome instead of claiming delivery.

An optional meeting filmstrip lets up to four room members start peer-to-peer audio and video. Supabase carries schema-validated signaling on a dedicated private media topic, while WebRTC carries the media directly between browsers. It is intentionally not a conferencing replacement and does not include TURN, an SFU, recording, or screen sharing.

## How it was built

- Next.js 16, React 19, TypeScript, Zustand, Zod, and a custom DOM/SVG infinite-canvas engine
- `document.modelContext.registerTool(...)` with schemas, annotations, cancellation propagation, lifecycle abort signals, static registration by default, and optional dynamic phase registration
- Supabase Anonymous Auth for no-signup identities
- Supabase Postgres for rooms, semantic objects, immutable receipts, packet snapshots, send requests, and vision-admission records
- Supabase Realtime Presence for connected participants and Broadcast for high-frequency cursors and compact revision notifications
- Browser WebRTC for an opt-in small-room meeting filmstrip, with signaling isolated on `room-media:<room-id>`
- Pinned YOLO26 Hand Pose exported to a same-origin 320×320 FP16 ONNX model, with ONNX Runtime Web and exactly 21 keypoints; camera frames remain in the browser
- A visibly labeled MediaPipe recovery detector that is attempted only after a YOLO initialization or runtime failure
- OpenAI `gpt-realtime-2.1` over WebRTC for opt-in continuous voice, with a narrower tool catalog and durable paid-session admission limits
- OpenAI Responses image input with strict structured output for sketch interpretation
- Vercel Functions for authenticated mutation, vision, and packet boundaries
- Optional Resend submission behind immutable approval snapshots, explicit host authorization, and an address allowlist

All input paths converge on one architecture:

```text
Pointer · Touch · Stylus · Typed command · Continuous GPT Realtime voice
Local hand landmarks · Collaborator · ChatGPT Site Tools through WebMCP
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

CommandCanvas targets the expensive gap between discussion and usable follow-through. The same pattern can support planning, architecture reviews, teaching, design critique, and technical interviews without replacing the meeting product a team already uses. Structured objects can become tasks, schedules, diagrams, and packets while their provenance remains visible.

### Creativity

The memorable interaction is not gesture control by itself. A rough spatial artifact becomes a separate structured object on a shared canvas; the person can physically manipulate the result, a collaborator can modify surrounding work, and ChatGPT can continue operating through explicit application capabilities. The preserved source and unified receipt stream keep that cinematic interaction inspectable and reversible.

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
- A real rough-sketch-to-structured-diagram transition that preserves the source
- No-signup, two-browser Supabase collaboration with actual Presence and Broadcast
- No-reload recovery after a browser network outage, with Presence and durable collaboration restored
- WebMCP tools that operate on the same live React page rather than a detached copy
- Reversible, attributable canvas mutations
- Modifier and touch-friendly multi-selection, semantic grouping and ungrouping, 15-degree rotation, and shared undo/redo
- Nested semantic frames whose descendants move and rotate through one canonical mutation
- YOLO index-fingertip drawing, one-hand pinch grab, two-hand pinch resize, open-palm focus or restore, side-edge recoverable trash, and bottom-dock minimize
- Continuous `gpt-realtime-2.1` voice that submits narrow commands without a Run click
- Opt-in two-browser peer-to-peer meeting media, separate from Supabase Presence and cursor traffic
- Exact packet and recipient approval snapshots with durable cancellation and honest delivery fallback
- A deterministic resettable judge route that remains useful without WebMCP, camera permission, model access, Realtime, or Resend

## What was learned

Spatial interaction becomes reliable when gesture recognition produces the same small semantic intents as a pointer instead of owning separate business logic. Agent actions become trustworthy when every capability has a narrow schema, live-state guards, and a visible receipt. External effects become safer when the agent requests an action but the site retains the final human authorization step.

## What is next

The immediate next work is measured real-hand calibration across webcams and lighting conditions, ChatGPT Site Tools verification where that rollout is available, physical iPhone testing, cross-network WebRTC testing, and richer semantic object types built on the same contracts. Physical marker tracking, TURN or SFU infrastructure, broad document integrations, and enterprise identity remain deliberately outside this submission.

## Honest verification boundary

The repository’s `docs/verification-ledger.md` separates automated evidence, named browser evidence, live-service evidence, unverified integrations, and deliberate cuts. The current source has 693 passing unit tests and a green production build. Controlled browser runs verified two-browser Supabase collaboration and peer-to-peer media, a paid `gpt-realtime-2.1` provider session, real vision through an injected standards-shaped `document.modelContext`, real YOLO worker inference, Chromium fake-camera lifecycle, and one allowlisted Resend packet through the full approval and explicit-SEND path. Resend reported that controlled packet delivered. The public no-signup environment remains preview-only. ChatGPT built-in-browser Site Tools, physical iPhone hardware, cross-network media, TURN behavior, and physical-hand accuracy remain unverified.
