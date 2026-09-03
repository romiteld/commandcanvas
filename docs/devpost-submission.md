# CommandCanvas

## Tagline

A shared spatial workspace where people and agents turn rough thinking into structured, attributable output on the same live canvas.

## Public links

- Temporary no-signup judge preview: <https://commandcanvas.vercel.app/demo>
- Email-OTP meeting rooms: <https://commandcanvas.vercel.app/meet>
- Public source: <https://github.com/romiteld/commandcanvas>
- Demo video: **TODO: add the public YouTube URL after Danny approves the final recording**

## Inspiration

Meetings produce sketches, decisions, tasks, and commitments, but the useful deliverable is often reconstructed afterward in another application. We wanted the meeting itself to produce structured output.

CommandCanvas lets people, hands, collaborators, and ChatGPT work against the same live spatial objects. Instead of sending an agent a stale transcript, it gives the agent bounded capabilities over the canvas everyone is using.

## What it does

CommandCanvas is an infinite collaboration canvas built from semantic objects rather than untyped pixels. A participant can create notes, boards, schedules, sketches, diagrams, charts, tables, decisions, actions, and meeting packets; arrange them spatially; and see who changed what.

The central workflow starts with rough human thinking. A participant draws a multi-stroke sketch while explaining it, then asks the agent to make it usable. CommandCanvas preserves the original, creates a separate structured result beside it, records provenance, and adds a receipt. The output is not limited to architecture: the same object system supports flowcharts, generic diagrams, bar, line, and pie charts, tables, boards, and written summaries.

Every input follows one path:

```text
Hands / voice / pointer / collaborator / WebMCP
                         ↓
                validated capability
                         ↓
               canonical mutation
                         ↓
          revision + receipt + Supabase sync
```

This lets a hand gesture, a remote collaborator, and ChatGPT change the same durable workspace without creating separate sources of truth. Mutations are visible and attributable. Destructive actions are recoverable. Preparing a meeting packet is allowed; sending it remains staged until the host explicitly confirms the external action.

## WebMCP Leverage

WebMCP is the product boundary, not an integration badge. CommandCanvas registers a concise Site Tools catalog with `document.modelContext.registerTool(...)`. A supported host can read the current canvas and selection, create or update semantic objects, organize work, use shared history, transform a selected sketch, prepare a packet, and request a staged send.

Each tool has a strict schema, read/write annotations, cancellation support, lifecycle cleanup, phase requirements, role checks, revision guards, and compact results. Registration can remain stable or change by phase behind one feature flag, but execute-time authorization is identical in both modes. The agent never receives camera frames, database credentials, the user’s ChatGPT credential, or authority to approve an email send.

This is meaningfully better than detached chat because selection, object identity, room revision, collaborator activity, packet approval, and receipts are live application context. Native Chrome 153 has verified the deployed registration and lifecycle behavior. A real ChatGPT built-in-browser invocation is a mandatory recording gate and will not be claimed from Chrome evidence alone.

## Execution

CommandCanvas uses Next.js 16, React 19, TypeScript, Zustand, Zod, and a custom DOM/SVG spatial canvas. Pointer, touch, stylus, and hand input converge on one intent model. Stable object changes use expected revisions; high-frequency cursor and movement previews remain ephemeral.

Supabase Postgres stores rooms, objects, receipts, packet snapshots, and send requests. Supabase Presence represents connected participants, while Broadcast carries cursors, revision notices, and small-room WebRTC signaling on participant-bound topics named `room-media:<room-id>:<participant-id>`. Passwordless meeting rooms use six-digit email OTP; `/demo` creates a temporary anonymous identity behind a one-click no-signup entry.

Hand input uses local MediaPipe landmarks in a browser worker and keeps camera frames on the device. It supports index-finger drawing, pinch-to-grab, two-hand resize and canvas zoom, open-palm pan, minimize, recoverable side-edge trash, and visible interaction states. Pointer, touch, keyboard, and voice remain complete alternatives.

Optional Live Voice uses `gpt-realtime-2.1` over WebRTC with a narrower capability catalog. The current production build has completed a real provider run from spoken transcription through a `create_board` function call, visible board creation, and a voice receipt. A separate production provider test rasterized a sketch, sent the PNG to an image-capable OpenAI model, validated the structured result, and preserved the source beside the generated diagram. These controlled provider tests do not substitute for the final physical-microphone and physical-hand rehearsal.

## Potential Impact

The gap between discussion and follow-through appears in planning, teaching, design review, research, technical interviews, and team decision-making. CommandCanvas turns live spatial work into reusable objects while the context and participants are still present. Rough notes can become decisions and actions. A sketch can become a chart or diagram. The finished room can become a reviewable packet.

Because the system is domain-neutral, it can support a student drawing a study model, a team mapping a launch, or an analyst sketching a chart.

## Creativity & Ambition

The memorable interaction is not gesture control or generation alone. It is a shared semantic world in which a person can draw with an index finger, explain the idea aloud, receive a structured result, physically reposition it, watch a collaborator modify nearby work, and let ChatGPT continue through explicit capabilities. Human, collaborator, voice, and WebMCP actions appear in one receipt stream.

Preserving the rough source matters. It makes the transformation understandable, inspectable, and reversible instead of hiding the human contribution behind a generated replacement.

## Challenges and lessons

The hardest problem was maintaining one trustworthy state model across fluid previews, durable collaboration, agent tools, undo, and consequential external actions. Spatial input became more reliable when gestures produced the same small intents as a pointer instead of owning separate business logic. Agent actions became safer when registration was treated as discoverability, while every execution still rechecked current room authority and state.

We also learned to separate evidence boundaries. A green source test does not prove a physical hand, real email delivery, or a ChatGPT-hosted Site Tool call. CommandCanvas keeps an append-only verification ledger so public claims can name the release, host, device, action, and observed result.

## Verified accomplishments

- 1,723 automated tests across 164 files, plus lint, raw TypeScript checking, Python vision checks, hand-worker compilation, and a production build on release `212b6aa`.
- Production-responsive acceptance at nine viewport sizes from 320×568 through 1440×900.
- Two independent no-signup browsers proving Presence, remote cursors, durable collaborator mutations, receipts, and recovery.
- Browser-to-browser WebRTC media with controlled camera and microphone tracks.
- Native Chrome 153 WebMCP discovery, lifecycle, and cancellation.
- Real OpenAI Realtime object creation and real OpenAI vision sketch transformation on production.
- A deterministic resettable judge route that remains honest when camera, provider, WebMCP, or Resend capabilities are unavailable.

## Testing instructions

1. Open <https://commandcanvas.vercel.app/demo> and select **Enter no-signup preview**.
2. Create, move, resize, minimize, restore, discard, and undo a canvas object.
3. Start Draw, make several strokes, then finish. Confirm that one preserved sketch is created.
4. Open the same room in a second browser and confirm presence, cursor motion, object synchronization, and the collaborator receipt.
5. In a supported ChatGPT Site Tools host, ask: **Read this canvas, then create a note titled Site Tool proof saying ChatGPT changed the live canvas.** Confirm the object and WebMCP receipt.
6. Prepare a meeting packet, approve it, request email, and verify that the site still requires the host’s final **SEND** action. `/demo` must report preview-only rather than claim delivery.

## Known limitations and submission gate

The public no-signup route intentionally previews email instead of sending it. Cross-network TURN, a final live physical-hand run, a saved-key physical-microphone run, and ChatGPT built-in-browser Site Tool invocation remain separate manual acceptance items. None will be claimed from automated or historical evidence.

Nothing has been sent to Devpost. The project must not be submitted until Danny approves the final production hand flow, ChatGPT Site Tool proof, collaborator run, video, and public description.

## Built with

WebMCP, OpenAI, Next.js, React, TypeScript, Supabase, Supabase Realtime, PostgreSQL, MediaPipe, WebRTC, Vercel, Resend, Zustand, Zod, Vitest, and Playwright.
