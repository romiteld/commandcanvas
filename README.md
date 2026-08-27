# CommandCanvas

CommandCanvas is a shared spatial workspace where people, collaborators, and ChatGPT manipulate the same live collection of semantic objects. Rough sketches become separate structured diagrams without destroying the source, and every supported canvas mutation remains attributable and reversible whether it was initiated by a human, participant, or agent.

**Live no-signup demo:** <https://commandcanvas.vercel.app/demo>

No signup, login form, password, third-party account, API key, or configuration is required to use the deployed judge route. Supabase Anonymous Auth creates a scoped authenticated browser identity behind the scenes.

## The product thesis

The canvas is not a document and the agent is not a detached chat panel. Notes, boards, schedules, sketches, and diagrams are typed application objects with stable identities, spatial geometry, versions, and payload schemas. WebMCP gives ChatGPT bounded tools over those same live objects and the same selected state that human participants see.

That makes the core interaction possible:

```text
Finger / mouse / touch / stylus strokes
                  │
                  ▼
             SketchObject
                  │
       browser renders selected strokes
                  ▼
                PNG
                  │
       vision + strict structured output
                  ▼
         validated DiagramPayload
                  │
                  ▼
    new DiagramObject beside preserved source
                  │
                  ▼
        revision + immutable receipt
```

## One-click judge path

1. Open <https://commandcanvas.vercel.app/demo>.
2. In **Human command**, type **Bring in our project board**, review the bounded interpretation, and press **Run**. Supported browsers may transcribe one voice command into the same reviewable field; speech never executes automatically.
3. Click **Sketch**, draw boxes and arrows, and click **Done**.
4. Select **Rough architecture** and click **Make usable**. The source remains visible while a structured diagram appears beside it.
5. Move, resize, pin, minimize, trash, recover, or undo through named pointer controls.
6. Click **Prepare meeting packet**, review the exact content and recipient, then approve it.
7. Click **Request email send**. The agent/site stages the action; only the host can press **SEND**. Without an allowlisted Resend configuration the result is explicitly **Preview only: not sent**.
8. Click **Copy invite** and open the link in a private window to exercise actual Supabase Presence, cursor Broadcast, and a participant mutation.

Use **Reset demo** to remove the current hosted demo room and return to a clean deterministic room.

Detailed instructions are in [docs/judge-instructions.md](docs/judge-instructions.md). The evidence ledger is in [docs/verification-ledger.md](docs/verification-ledger.md).

## WebMCP tool catalog

The site registers eight stable tools through `document.modelContext.registerTool(...)`:

| Tool | Capability | Human control |
| --- | --- | --- |
| `get_canvas_state` | Read a bounded semantic projection of current objects, selection, and recent receipts | Read-only |
| `create_object` | Create one validated note, board, schedule, sketch, or diagram | Canonical mutation + receipt |
| `transform_object` | Move or resize one unpinned object | Canonical mutation + receipt |
| `set_object_state` | Pin, unpin, minimize, or restore | Canonical mutation + receipt |
| `discard_object` | Move an object to recoverable trash | Reversible; no permanent delete |
| `transform_sketch` | Interpret the selected sketch into a new structured diagram | Source is preserved |
| `prepare_meeting_packet` | Create or refresh a reviewable packet draft | Does not approve or send |
| `request_packet_send` | Stage an approved packet for site confirmation | Explicit host **SEND** still required |

Descriptors use strict input schemas, `readOnlyHint`, `untrustedContentHint`, invocation cancellation signals, and registration lifecycle abort signals. Static registration is the default. Dynamic phase registration is available behind `NEXT_PUBLIC_WEBMCP_DYNAMIC_REGISTRATION=true`; both modes use the same execute-time room, phase, schema, selection, membership, and role guards.

The compact canvas projection has a hard 32,768-byte envelope. It prioritizes selected objects and excludes rough-sketch coordinates and reversible before/after snapshots from agent context.

## One command architecture

```text
Pointer · Touch · Stylus · Typed command · Reviewed voice transcript
Local hand landmarks · Collaborator · WebMCP
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

Pointer previews, hand landmarks, and remote cursors remain ephemeral. A stable spatial operation commits once through the same expected-revision mutation boundary used by WebMCP and collaborator actions.

## Realtime split

- **Postgres:** rooms, memberships, semantic object state, immutable canvas receipts, meeting packets, immutable packet activity, send requests, outbound-share records, and durable vision admission.
- **Presence:** actual connected participant identity, display name, color, and role.
- **Broadcast:** bounded high-frequency cursors and compact revision notifications. Cursor movement is never persisted to Postgres.
- **Late join/reload:** rebuild stable state from Postgres, then reconnect Presence and Broadcast.
- **Network recovery:** preserve the mounted canvas while offline, then replace the failed private channel, refresh Realtime authorization, and retrack Presence when the browser returns online. Terminal channel failures use a bounded, disposal-aware retry policy, and reloaded participants resume cursor ordering immediately.
- **Long-lived rooms:** Supabase token refresh rotates the room, vision, packet, and subsequent Realtime recovery credentials without a page reload.

## Camera and privacy

Hand tracking uses the pinned MediaPipe Tasks Vision runtime, same-origin WASM inside a module worker, and a versioned Hand Landmarker model fetched from Google only when the user enables the camera. The MVP vocabulary is intentionally small: stable index pointing and pinch. Pointing can author a sketch; pinch can select and move an unpinned object.

The camera panel includes a session-local self-check. It records point and pinch separately and reports success only after both observations actually occur in that camera session. This is a calibration aid, not a claim that every webcam, hand, or lighting condition has been validated.

Camera frames remain local to the browser. They are never sent to ChatGPT, OpenAI, Supabase, or a WebMCP tool. Only semantic canvas commands cross the application boundary. Every camera action has pointer and button equivalents.

Optional voice transcription is a separate browser capability: audio may be processed by the browser vendor's speech service under that browser's policy. CommandCanvas receives only the resulting text, places it in an editable field, and never executes it until the human presses **Run**. Typed commands remain the guaranteed fallback.

The model provenance, runtime package, retrieval boundary, and license references are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Human-authorized packet delivery

Packet preparation snapshots the exact semantic content. Approval snapshots exact recipients and hashes both content and recipients. WebMCP can stage an approved send but cannot change recipients or perform the external effect by itself.

```text
Prepare → edit recipients → inspect exact content → approve
        → agent/site stages request → host confirms SEND
        → Resend submission or honest preview-only outcome
        → immutable packet activity receipt
```

Cancellation is durable and idempotent. A cancelled request cannot later execute. Resend delivery is enabled only when the API key, verified sender, and recipient allowlist are all configured; otherwise no provider call occurs.

## Technology

- Next.js 16.3.3, React 19.2.8, TypeScript, Zustand, Zod, Tailwind CSS
- Custom DOM/SVG infinite canvas with explicit screen/world coordinate transforms
- Supabase Postgres, Anonymous Auth, Realtime Presence, and Broadcast
- WebMCP `document.modelContext.registerTool(...)`
- OpenAI Responses image input and strict structured output
- MediaPipe Tasks Vision in a same-origin worker
- Vercel Functions and deployment
- Optional Resend delivery

## Local development

Requirements:

- Node.js 22.14–22.x (`.nvmrc` pins 22.17.0)
- npm 11.5.2
- A Supabase project with Anonymous Auth enabled
- An OpenAI API key for live sketch interpretation

```bash
git clone https://github.com/romiteld/commandcanvas.git
cd commandcanvas
nvm use
npm ci
cp .env.example .env.local
```

Apply the SQL files in `supabase/migrations/` to a fresh project in filename order. Then populate `.env.local`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_replace_me
SUPABASE_SECRET_KEY=replace_me
OPENAI_API_KEY=replace_me
OPENAI_VISION_MODEL=gpt-5.6-terra
NEXT_PUBLIC_WEBMCP_DYNAMIC_REGISTRATION=false
```

The Supabase server credential and all provider keys are server-only. Do not prefix them with `NEXT_PUBLIC_`.

Start the app:

```bash
npm run dev
```

Open <http://localhost:3000/demo>.

### Optional Resend delivery

```dotenv
RESEND_API_KEY=replace_me
RESEND_FROM=CommandCanvas <verified-sender@example.com>
COMMANDCANVAS_EMAIL_ALLOWLIST=allowed-one@example.com,allowed-two@example.com
```

All approved recipients must be present in the allowlist. Missing or mismatched configuration produces an explicit preview-only result.

## Verification

The local build and unit gate is:

```bash
npm run check
```

Individual checks:

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run test:e2e
```

The test suite covers object schemas, command mutations, stale-revision refusal, undo, persistence projection, RLS/RPC contracts, WebMCP schemas and guards, bounded agent context, PNG validation, durable vision admission, packet approval/cancel/execute transitions, browser API validation, responsive rendering, Realtime adapters, and demo reset.

Environment-specific browser probes are separate so their claims stay narrow:

```bash
# Ordinary Chromium plus the focused iPhone-profile WebKit checks
npx playwright test e2e/realtime-input.spec.ts \
  --project=chromium-desktop \
  --project=webkit-mobile-safari

# Official Chrome 153 binary with WebMCP enabled
WEBMCP_CHROME_PATH=/path/to/chrome-153 \
WEBMCP_BASE_URL=https://commandcanvas.vercel.app \
WEBMCP_EXPECTED_MODE=static \
WEBMCP_LIVE_PROBE=true \
npx playwright test --config=playwright.webmcp153.config.ts
```

The Chrome 153 test refuses to run against another major version, defaults to loopback, and requires `WEBMCP_LIVE_PROBE=true` before it may target a public origin. Its optional local-to-production API proxy accepts only `https://commandcanvas.vercel.app` and only the exact room endpoints used by the probe. Dynamic mode uses the same probe with `WEBMCP_EXPECTED_MODE=dynamic` against a build created with `NEXT_PUBLIC_WEBMCP_DYNAMIC_REGISTRATION=true`. Hardware, ChatGPT built-in-browser, live speech-provider, and real Resend claims remain unverified until those exact boundaries are exercised.

The [verification ledger](docs/verification-ledger.md) distinguishes:

- **WORKING:** automated or local runtime evidence
- **VERIFIED IN BROWSER:** an observed named-browser interaction
- **UNVERIFIED:** implemented or designed but not exercised at the real boundary
- **CUT:** deliberately outside the submission scope

## Security boundaries

- Natural language never writes directly to database tables.
- Browser callers cannot invoke privileged room, mutation, packet, or vision RPCs.
- Server routes derive the actor from a verified Supabase bearer token and ignore client-supplied authority.
- Stable mutations use expected room revisions and fail closed on stale state.
- Destructive object actions use recoverable trash and universal undo.
- Packet content and recipients are immutable after approval.
- External delivery requires explicit host authorization and a server-side recipient allowlist.
- Paid vision work uses actor/room limits, one active room lease, exact-request caching, and compare-and-set completion.
- The complete vision JSON body is capped at 4 MB and decoded PNG data at 2 MB, below Vercel Functions' 4.5 MB payload ceiling.
- Raw camera frames and private credentials never enter WebMCP context.

## Deliberate scope cuts

This submission does not include video conferencing, conferencing-platform integrations, enterprise identity, broad document-suite integrations, billing, native mobile or headset apps, physical marker tracking, two-hand resize, swipe-to-discard, group/ungroup, complex multi-select, rotation, or gesture-only destructive actions.

Mouse, keyboard, touch, and named buttons remain the guaranteed interaction baseline.

## Submission material

- [Devpost description draft](docs/devpost-submission.md)
- [90-second video shot list](docs/video-shot-list.md)
- [One-click judge instructions](docs/judge-instructions.md)
- [Verification ledger](docs/verification-ledger.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

[MIT](LICENSE) © 2026 Daniel Romitelli
