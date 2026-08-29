# Task 6 delivery report: idempotent invitations and durable Resend truth

## Outcome

`DONE_WITH_RUNTIME_VERIFICATION_REQUIRED`

Task 6 hardens authenticated-room invitations and meeting-packet delivery from
request creation through provider reconciliation. It adds stable request and
provider idempotency, durable `submitted` versus `reconciling` truth, a signed
bounded Resend webhook, deduplicated/out-of-order provider event application,
real room titles in invite mail, and browser reload contracts that no longer
equate provider acceptance with delivery.

The implementation is committed as `1d37c04` under Daniel Romitelli. The two
forward migrations were created with the
installed Supabase CLI and were deliberately not applied to a local or remote
database. No Resend request, webhook delivery, Supabase remote mutation,
Vercel deployment, or other external provider action was performed.

## Scope completed

### Authenticated-room invitations

- Added a required browser-generated UUID `requestId` while keeping the form
  contract as an invitation draft.
- Retained one request ID after a lost HTTP response and while delivery is
  `reconciling`; terminal success/refusal clears it so a later deliberate
  invitation is a new request.
- Derived a stable 256-bit bearer invitation token with a server-only HMAC
  secret. The raw token remains only in the request/fragment path; PostgreSQL
  receives and stores only its SHA-256 digest.
- Added exact-payload idempotency in PostgreSQL. The same room, host, and
  request ID returns the existing reservation; a changed normalized payload
  returns a compact conflict.
- Added a stable Resend idempotency key, provider message ID, delivery status,
  bounded error code, submission/event timestamps, and recipient-digest
  cooldown state.
- Removed the old authenticated invitation recipient allowlist. Only a
  permanent confirmed room host can create the invitation, and existing
  actor/room/global limits plus the normalized recipient-digest cooldown remain
  authoritative.
- Returned the actual standard-room title from the issuance RPC and rendered
  it in the escaped invite subject/body.
- Rejected CR/LF subject injection, unsafe sender configuration, query-string
  invite capabilities, malformed provider responses, and provider diagnostics
  without leaking them across the boundary.
- Classified network loss, HTTP 409/429/5xx, and malformed accepted responses
  as `reconciling`; deterministic 4xx refusal becomes `failed`.
- If Resend acceptance succeeds but the first completion write response is
  lost, the route records the provider ID as `reconciling` and returns that
  honest state. A retry uses the same provider idempotency key.

### Meeting-packet submission and delivery

- Replaced active durable/UI `sent` state with `submitted` and added
  `reconciling` throughout provider transport, service, browser schemas, reload
  reconstruction, and packet UI state.
- Preserved the visible proposal -> exact approved recipient/content snapshot
  -> literal host `SEND` -> provider submission boundary.
- Treated network loss, 409/429/5xx, and malformed accepted responses as
  ambiguous rather than failed.
- Preserved one Resend idempotency key and provider ID across retries.
- Added recovery when provider acceptance is durable but both completion and
  reconciliation responses are lost: an exact authorization replay recovers
  the existing submitted provider ID without a second provider call.
- Reload now includes the provider message ID and outbound delivery status.
- UI truth distinguishes submitted, reconciling, delivered, provider-reported
  adverse outcomes, deterministic provider rejection, preview-only, and
  cancellation.
- The existing `COMMANDCANVAS_EMAIL_ALLOWLIST` remains the packet-recipient
  safeguard, including public `/demo`; it is not used by standard-room
  invitation delivery.

### Signed Resend webhook

- Added `POST /api/webhooks/resend` on the Node runtime.
- Requires a server-only signing secret and the bounded Standard Webhooks
  `svix-id`, `svix-timestamp`, and `svix-signature` headers.
- Reads at most 64 KiB of raw UTF-8, verifies HMAC and a five-minute timestamp
  window before parsing or writing, and caps signature candidates.
- Maps signed `email.sent`, `email.delivered`, `email.bounced`,
  `email.complained`, `email.failed`, and `email.suppressed` events to durable
  application truth. Other valid signed email events are recorded as ignored.
- Stores only the event/message identifiers, occurrence/receive times, payload
  SHA-256 digest, processing result, target reference, and bounded error code.
  No raw webhook body, invite token, recipient address, or bearer credential is
  persisted.
- Deduplicates by provider event ID; resolves exactly one invitation or packet
  share; records unmatched/ambiguous cases; refuses cross-table ambiguity;
  rejects stale/no-regression updates; and permits a newer adverse event to
  supersede delivered.
- Packet provider delivery changes append one immutable packet activity receipt
  without changing an already-submitted packet request into a false delivered
  state.

## Forward migrations

The installed CLI was inspected before creation:

```text
supabase --version
2.75.0
```

`supabase --help`, `supabase migration --help`, and
`supabase migration new --help` were read. The CLI generated:

- `supabase/migrations/20260829044744_harden_invitation_delivery.sql`
- `supabase/migrations/20260829044748_normalize_resend_delivery_truth.sql`

Neither migration was applied.

Security properties encoded in the migrations:

- private invitation/admission/webhook tables retain RLS;
- private webhook storage revokes public, anonymous, authenticated, and direct
  service-role table privileges;
- mutation/event RPCs are `SECURITY DEFINER` with empty `search_path`;
- human invitation RPCs independently verify a permanent confirmed user, host
  role, exact standard room, and owning host;
- RPC execute privileges are revoked from public/anon/authenticated and granted
  only to service role;
- no `auth.role()`, user metadata, raw recipient address, raw token, or raw
  webhook payload is used as authorization or durable state.

Upgrade safety explicitly covered:

- historical packet request/share `sent` rows become `submitted` before new
  constraints are installed;
- historical cancelled/expired packet requests are backfilled with
  `coalesce(completed_at, authorized_at, requested_at, clock_timestamp())`
  before the new lifecycle constraint requires a completion timestamp;
- historical submitted/preview rows retain the prior authorization/completion
  invariant;
- old invitation rows receive stable request/idempotency backfill values before
  defaults are removed and unique constraints are added;
- old invitation issuance rows retain a null recipient digest because the
  original raw recipient cannot and should not be reconstructed.

## TDD evidence

Behavioral tests were written RED before their corresponding implementation.
The initial expanded invitation/packet/webhook contract produced 31 failures,
27 passes, and an absent webhook module. Focused RED evidence subsequently
included:

- two browser packet failures for submitted provider truth and reconciling;
- four packet workflow/panel failures for submitted, reconciling, delivered,
  and adverse outcome presentation;
- one browser invitation failure proving a reconciling success incorrectly
  discarded its stable request ID;
- one route failure proving accepted provider mail returned 503 even after a
  successful reconciling write;
- one invite-rendering failure proving CR/LF room-title input reached provider
  work;
- one service failure proving unsafe delivery error codes reached the RPC;
- one packet service failure proving lost completion responses were shown as a
  false recording failure instead of recovered durable acceptance;
- one migration contract failure proving cancelled/expired historical rows had
  no pre-constraint completion backfill;
- one migration contract failure proving a stable read helper was declared
  volatile.

Each named RED was followed by a focused GREEN run.

### Final owned behavior suite

```bash
env -u TEMP -u TMP -u TMPDIR npm test -- \
  lib/supabase/meeting-contracts.test.ts \
  lib/supabase/meeting-service.test.ts \
  lib/supabase/meeting-route-handlers.test.ts \
  lib/supabase/invitation-email.test.ts \
  lib/supabase/meeting-api.test.ts \
  lib/supabase/resend-delivery-migration-contract.test.ts \
  lib/packets/resend.test.ts \
  lib/packets/server-service.test.ts \
  lib/packets/browser-api.test.ts \
  lib/packets/route-handlers.test.ts \
  lib/resend/webhook.test.ts \
  components/command-canvas/meeting-packet-workflow.test.tsx \
  components/command-canvas/meeting-packet-panel.test.tsx \
  components/command-canvas/demo-command-canvas.test.tsx
```

```text
Test Files  14 passed (14)
Tests       124 passed (124)
```

### All migration contracts

```text
Test Files  8 passed (8)
Tests       40 passed (40)
```

### Focused lint

ESLint over every owned TypeScript/TSX delivery file exits 0 with no
diagnostics.

### Typecheck boundary

`npm run typecheck` passed after the delivery implementation and browser/UI
contract update. The final repository-wide rerun, while the hand/room lane was
actively editing its files, was blocked only by three non-delivery diagnostics:

```text
components/command-canvas/command-canvas-room.tsx
components/command-canvas/spatial-camera-control.test.tsx
```

No delivery file appeared in that diagnostic set. The root integration lane
must rerun repository typecheck after the hand/room work completes; this report
does not label the concurrent snapshot globally green.

### Repository-wide unit boundary

The final concurrent repository snapshot ran 1,084 tests: 1,076 passed and
eight failed in `command-canvas-room.test.tsx`,
`spatial-camera-control.test.tsx`, and `lib/realtime-voice/tools.test.ts`. Those
are active hand/room/voice lane tests and do not import or exercise Task 6
delivery code. Because repository typecheck and full unit were already red in
those parallel files, a production build was not represented as a useful
Task 6 verification gate. The owned delivery suite and migration contracts
were rerun afterward and remained 124/124 and 40/40 green.

### Static diff and package state

```text
git diff --cached --check  exit 0
focused ESLint            exit 0
package.json diff         none
package-lock.json diff    none
```

## Official verifier dependency boundary

The current official `svix` package/version was checked during implementation
and `svix@2.1.0` was identified as the current package. A dependency install was
started, removed the shared `node_modules` symlink, and timed out before changing
either package manifest. The root lane restored the original shared toolchain
and explicitly prohibited further install/CI mutation while parallel lanes were
active.

Therefore this commit intentionally leaves `package.json` and
`package-lock.json` unchanged and uses a small dependency-free Standard
Webhooks-compatible verifier with direct HMAC/timestamp tests. Before release,
the root lane should add the exact reviewed Svix dependency in one coordinated
Node 22 maintenance window, replace or wrap the verifier with the official
library, and rerun the same raw-body/stale-signature/no-write tests. The current
verifier is tested; official-library integration is not claimed.

## Running verification ledger

### WORKING

- Stable invitation request ID and provider idempotency across lost responses,
  process interruption, and reconciling retry.
- Direct host-authorized standard-room invitation delivery without the removed
  invite recipient allowlist.
- Real escaped room title and participant details in invite rendering.
- Durable invitation/provider states and compact no-secret browser response.
- Packet submitted/reconciling/provider delivery truth, replay recovery,
  browser reload, and honest UI labels.
- Bounded signature-first webhook handler and private event application RPC.
- Static dedupe, cross-table ambiguity, out-of-order/no-regression, adverse
  transition, RLS, grant, and safe-search-path contracts.
- Server-only blank environment placeholders for invite HMAC and webhook
  signing secrets.

### VERIFIED IN AUTOMATION

- 124/124 focused invitation, packet, route, webhook, browser, and UI tests.
- 40/40 migration contracts across all current migration suites.
- Focused ESLint and staged whitespace checks.
- A clean delivery typecheck before concurrent Task 4 RED tests appeared.

### UNVERIFIED

- Applying either forward migration to a real Supabase/PostgreSQL database.
- SQL procedural behavior against a running local database. `supabase db lint
  --local` could not inspect Docker because this environment cannot access
  `/var/run/docker.sock`; no privilege escalation or database reset was used.
- Migration-ledger compatibility on the linked remote project.
- A real Resend submission, idempotency replay, signed webhook retry, delivery,
  bounce, complaint, failure, or suppression event.
- Official Svix package integration; the dependency-free compatible verifier is
  what was exercised.
- Vercel environment variables, deployed route behavior, public DNS/TLS, or
  production webhook configuration.
- End-to-end OTP invitation acceptance in two physical browsers.

### CUT / NOT PERFORMED

- No remote migration apply, remote migration-list probe, Supabase write, or
  project mutation.
- No Resend API call, SMTP call, webhook registration, or real email.
- No Vercel deployment or environment-variable mutation.
- No package install after the shared toolchain incident.
- No raw invite token, recipient email, provider response body, webhook body,
  or secret value persisted or printed.

## Release follow-ups

1. In one coordinated Node 22 maintenance window, pin the reviewed official
   Svix verifier and rerun webhook tests.
2. Start an isolated local Supabase stack, apply all migrations from zero and
   from a seeded pre-forward schema, then run `supabase db lint --local`.
3. Verify cancelled/expired historical backfill rows, submitted/preview rows,
   invitation same-request concurrency, webhook duplicate IDs, stale sent after
   delivered, newer complaint after delivered, unmatched IDs, and cross-table
   ambiguous IDs against real PostgreSQL.
4. Supply secrets only through the server environment, configure a verified
   Resend sender and signed webhook endpoint, and exercise provider test mode.
5. Rerun full repository test, lint, typecheck, and production build after the
   parallel gesture/voice lanes settle.

## Evidence boundary

Task 6 closes the source, schema, route, state-machine, UI truth, and automated
contract work for invitation and packet delivery. It does not claim a migration
has been applied, an email has been delivered, a provider webhook has reached a
deployed endpoint, or a linked environment has been verified. Those are
environment-specific release checks, not inferred from green mocks.
