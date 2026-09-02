# CommandCanvas

CommandCanvas is a shared spatial workspace where people, hands, voice, collaborators, and supported agent hosts operate on the same semantic objects. Rough sketches, notes, boards, schedules, diagrams, charts, and meeting packets remain visible, attributable, and reversible on one infinite canvas.

- Production: <https://commandcanvas.vercel.app>
- Email-OTP workspace: <https://commandcanvas.vercel.app/meet>
- No-signup judge preview: <https://commandcanvas.vercel.app/demo>
- Source: <https://github.com/romiteld/commandcanvas>

## Choose the right entry

**Email-OTP workspace:** `/meet` is the durable room path. A person verifies a
six-digit email code, chooses a display name, creates or joins a room, and can
send an exact-email invitation. There are no passwords.

**No-signup judge preview:** `/demo` presents no signup form, login form,
password, third-party account, or configuration. Supabase may create a bounded
temporary identity and room only after the visitor explicitly enters.

The preview cannot send production email. Provider-backed voice and direct image interpretation use the visitor's temporary key; verified users may choose a previously saved, encrypted account-owned key. There is no deployment-owner key fallback.

## Five-step workflow

1. Enter a durable room or the temporary judge preview.
2. Create semantic objects by pointer, touch, typed command, optional voice, optional local hand tracking, collaborator action, or supported Site Tools.
3. Select, move, resize, minimize, restore, pin, group, rotate, or recoverably
   discard work through the same guarded command system.
4. Preserve a rough sketch while creating a linked structured diagram or chart beside it, with provenance and an immutable receipt.
5. Prepare a meeting packet, review its exact content and recipients, approve that version, and explicitly authorize any eligible email submission.

## Why WebMCP matters

CommandCanvas registers a bounded Site Tools catalog against the live page,
current room revision, selected objects, member role, and packet state.
Where a compatible ChatGPT Site Tools host is available, ChatGPT can inspect
and operate on the same object identities that participants currently see.

The host does not receive camera frames, database credentials, or permission to
bypass application controls. Tools use explicit schemas, cancellation signals,
lifecycle cleanup, role and phase checks, expected revisions, and human approval
for consequential actions. Static registration is the production default;
dynamic phase registration is behind one feature flag. Execute-time guards are
identical in both modes.

The embedded Live voice surface is separate. It offers a narrower command
catalog for hands-free canvas control through a user-owned API key. It does not
prove Site Tools discovery and cannot manage rooms, approve packets, or send
email.

## What ships

- A custom full-viewport DOM and SVG infinite canvas.
- Typed semantic objects with shared spatial fields and discriminated payloads.
- Pointer, touch, stylus, keyboard, and command-menu access to primary actions.
- Create, select, move, resize, rotate, minimize, restore, pin, group, ungroup,
  recoverable discard, undo, and redo through one mutation pipeline.
- Freehand sketching that preserves the original artifact.
- Deterministic and provider-backed structured visual creation paths.
- Immutable receipts with actor, source, revision, affected objects, and patches.
- Supabase rooms, persisted objects, Presence, cursor Broadcast, and late join.
- Six-digit Email OTP, exact-email invitations, and display-name profiles.
- An opt-in small-room WebRTC filmstrip with Supabase signaling.
- Meeting packet snapshots, recipient snapshots, approval, cancellation, and
  explicit host authorization before eligible Resend submission.
- A resettable temporary judge preview with honest service-state fallbacks.

## Experimental and external boundaries

Browser hand input uses MediaPipe Hand Landmarker locally after explicit camera
permission. It supports index-finger drawing, one-hand pinch movement, two-hand
resize and canvas zoom, open-palm pan, and recoverable edge discard. Camera
frames stay out of ChatGPT, OpenAI, Supabase, and WebMCP on the local path.

A compact HaGRIDv2-derived classifier adds refusal-gated static-pose evidence after landmarks exist. It cannot acquire an object, perform bimanual or edge actions, or replace canonical geometry and temporal state. Its custom same-license boundary is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

After separate consent, an optional private CUDA relay can receive bounded newest-only frames and return semantic landmarks. It is not part of this MIT application; see [SOURCE.md](SOURCE.md) and [private relay documentation](docs/private-hand-relay.md).

Physical-hand accuracy, lighting tolerance, occlusion behavior, and ergonomics
remain experimental until named device rehearsals pass. Pointer, touch, typed,
and button controls remain available without camera access.

Live voice uses `gpt-realtime-2.1` only after the person presses Start and
provides or selects their own project API key. A ChatGPT subscription does not
fund OpenAI API use inside the page. The current verification boundary is
recorded in [the verification ledger](docs/verification-ledger.md).

Meeting media is a small opt-in peer-to-peer layer that attempts direct STUN.
An optional TURN relay uses short-lived, server-authorized credentials when
configured. Cross-network TURN remains unverified; there is no SFU, recording, screen sharing, or call moderation.

## One command architecture

```text
Hands / Voice / Pointer / ChatGPT -> semantic intent -> guarded command -> mutation + receipt -> Supabase room
```

Collaborator events, touch and stylus input, typed commands, and accessibility
controls enter the same boundary. High-frequency cursor and drag previews stay
ephemeral. Stable mutations commit against an expected room revision and create
the durable receipt used by collaboration and Undo.

Supabase responsibilities are deliberately split:

- Postgres stores rooms, memberships, objects, revisions, receipts, packets,
  invitations, outbound requests, and user-owned credential references.
- Presence represents connected participants and current participant state.
- Broadcast carries high-frequency cursors, drag previews, signaling, and
  compact revision notifications.
- Row Level Security scopes durable records to authenticated room members.

## Human control and privacy

- Arbitrary natural language never writes directly to the database.
- Every input becomes a validated semantic command first.
- Discard is recoverable; gesture input cannot permanently delete data.
- Packet approval freezes exact content and recipient hashes.
- An agent may stage a send, but the host must press Send on the site.
- Server routes derive authority from a verified Supabase bearer token.
- Private service credentials never use a `NEXT_PUBLIC_` environment name.
- Saved user keys are resolved only at the provider boundary and are never
  returned raw to the browser.
- Temporary preview keys remain in tab memory and are not written to URLs,
  browser storage, receipts, Supabase, or application logs.
- Raw camera frames never enter Site Tools context.

## Judge path

Open `/demo`, choose **Enter no-signup preview**, and follow the visible tour.
The fixture includes believable semantic objects and activity history so the
workspace is understandable before any optional service is enabled.

Try these reliable controls first:

- Create a note from the object dock.
- Drag and resize an object.
- Minimize it, then restore it from the tray.
- Draw a sketch with pointer or touch.
- Use the command drawer to create or organize objects.
- Open the activity drawer and inspect actor and revision receipts.
- Reset the preview to its deterministic starting state.

Optional Site Tools, camera, voice, collaboration, vision, meeting media, and
email surfaces report their actual availability. A failed or unconfigured
service does not display a success claim.

Full judge instructions are in [docs/judge-instructions.md](docs/judge-instructions.md).

## Local development

Requirements:

- Node.js 22.14 through 22.x (`.nvmrc` pins 22.17.0)
- npm 11.5.2
- Python 3.11 plus pinned dependencies for the complete release gate
- A Supabase project for durable rooms and `/demo`

Install and configure:

```bash
npm ci
python -m pip install -r scripts/requirements-training.txt
cp .env.example .env.local
```

Apply every file in `supabase/migrations/` to a fresh Supabase project in
filename order. Set the public Supabase URL and publishable key plus the
server-only Supabase secret in `.env.local`. Optional WebMCP mode, Resend,
Live voice, image interpretation, and private relay settings are documented in
[.env.example](.env.example).

Start the application:

```bash
npm run dev
```

Then open:

- <http://localhost:3000/meet> for Email OTP and durable rooms.
- <http://localhost:3000/demo> for the temporary no-signup judge preview.
- <http://localhost:3000/local> for the local-only canvas fallback.

## Verification

The local build and unit gate is:

```bash
npm run check
```

Focused commands are also available:

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run test:e2e
```

Automated tests, controlled browser evidence, deployed checks, provider checks,
and physical-device evidence are different proof layers. See
[docs/verification-ledger.md](docs/verification-ledger.md) for the current,
named boundary rather than inferring live behavior from a green unit test.

Submission references include the [Devpost draft](docs/devpost-submission.md),
[video shot list](docs/video-shot-list.md), [security policy](SECURITY.md),
[third-party notices](THIRD_PARTY_NOTICES.md), and [source boundary](SOURCE.md).

## License and authorship

CommandCanvas is authored by Daniel Romitelli and distributed under the
[MIT License](LICENSE) © 2026 Daniel Romitelli.

The application preserves all required third-party notices. Optional private
relay software is governed by the separate source and license boundary linked
above and is not relicensed by this repository.
