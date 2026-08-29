# Optional private GPU hand relay

Deployment boundary as of 2026-08-29: the true-640 source, container contract,
and dated local CUDA verification are ready. The edge route is configured for
`https://hands.autolensai.com`, but the production true-640 listener has not yet
been started and the public capability route must not be represented as ready
until a fresh probe succeeds. The relay remains an opt-in acceleration path,
not the privacy default and not a judge dependency. Local MediaPipe Hand
Landmarker remains the default and the automatic fallback.

## Processing choices

```text
Camera
  |
  +-- no private-GPU consent --> local MediaPipe worker
  |                                  |
  |                                  +--> in-page MediaPipe recovery
  |
  +-- explicit consent ------> bounded JPEG/WebP, newest frame only
                                      |
                                      v
                        hands.autolensai.com over TLS/WSS
                                      |
                                      v
                           native YOLO CUDA inference
                                      |
                                      v
                         semantic 21-point landmarks
                                      |
                                      v
                          canonical canvas intentions
```

In local mode, camera frames stay in the browser. In private-GPU mode, one
bounded frame at a time may leave the browser only while Hand input is active
and **Use private GPU hand tracking** remains selected. The relay accepts JPEG
or WebP, limits encoded bytes and decompressed dimensions, does not retain raw
frames, and returns at most two semantic hands with exactly 21 normalized
landmarks each. Camera frames are never sent to ChatGPT, OpenAI, Supabase, or a
WebMCP tool.

Disabling consent, disabling Hand input, hiding or leaving the page, an expired
session, a network failure, or an invalid relay result closes the remote path
and selects local MediaPipe. Private relay failure is not a reason to stop the
canvas.

## Target topology

```text
CommandCanvas browser
  -> authenticated Vercel session route
  -> short-lived one-use HMAC capability
  -> wss://hands.autolensai.com/v1/hand-pose
  -> existing WAN TCP 443 path
  -> Caddy virtual host selected by SNI
  -> 127.0.0.1:8100
  -> commandcanvas-hand-relay Docker service
  -> ONNX Runtime CUDAExecutionProvider, CUDA device 0
```

The intended public capability route is
`https://hands.autolensai.com/v1/capabilities`. Caddy exposes only
`/v1/capabilities` and `/v1/hand-pose`; unrelated paths return 404. The native
service remains loopback-bound at `127.0.0.1:8100`, uses
`restart: unless-stopped`, has no CPU inference mode, and copies the tracked
model artifact into its immutable image after checksum verification. The
existing AutoLensAI matte process, port, model, credentials, and lifecycle
remain separate.

The DNS A record points `hands.autolensai.com` to the existing public edge.
No pfSense mutation was needed because WAN TCP 443 already reached the Caddy
host and SNI selects the hand-relay virtual host. No firewall or management
credential is stored in this repository.

## Browser and server authorization

The browser never receives a reusable relay secret. It requests a session from
the no-store CommandCanvas route, which requires:

- a valid Supabase bearer token;
- current room membership;
- explicit `cameraUploadConsent: true`;
- enabled server configuration;
- a healthy exact HTTPS relay origin;
- successful durable actor, room, and global admission.

The server returns a short-lived capability containing room, actor, session,
nonce, issue time, expiry, issuer, audience, and JTI claims. The browser sends
that capability as the first WebSocket message, never in a URL. The relay
checks the HMAC, exact CommandCanvas Origin, claims, expiry, and unused JTI
before accepting a frame. A process-local TTL cache consumes each JTI once.

## Protocol limits

The installed v1 protocol enforces:

- `maxInFlight: 1` and newest-frame-only browser queuing;
- target encoding around 320 pixels and 65,536 bytes where possible;
- an absolute 262,144-byte encoded-frame ceiling;
- a 1280 by 720 decompressed-dimension ceiling;
- JPEG/WebP signature and declared-MIME agreement;
- bounded handshake, frame-idle, inference, and authenticated-session deadlines;
- one native inference worker and server-side frame pacing;
- at most two results with exactly 21 normalized landmarks;
- no token, frame, or request-body logging in the application service;
- no raw-frame persistence and zero advertised raw retention;
- policy close for invalid Origin, authentication, message order, or image;
- local browser fallback after timeout, overload, malformed output, or close.

The native model exposes x/y and per-keypoint visibility. The relay reports
`z: 0` and `handedness: "unknown"` rather than inventing depth or handedness.

## Required production configuration

Before the private relay can be enabled, the Vercel application must have these
server-only names:

```dotenv
PRIVATE_HAND_RELAY_ENABLED=true
PRIVATE_HAND_RELAY_ORIGIN=https://hands.autolensai.com
PRIVATE_HAND_RELAY_SIGNING_KEY=<independent 32-byte base64url secret>
PRIVATE_HAND_RELAY_TOKEN_TTL_SECONDS=60
```

The native service uses its own protected environment file. A public,
non-secret template is at
[`services/hand-relay/.env.example`](../services/hand-relay/.env.example). The
matching signing key is independent of Supabase, Vercel, Resend, pfSense,
AutoLensAI, and every other application secret.

## Historical 320 deployment evidence

The following evidence was recorded for the earlier 320 listener on 2026-08-28.
It does not establish the current availability of the true-640 listener:

- the public capability route returned HTTP 200, ready and warm;
- the runtime identified `NVIDIA GeForce RTX 3090 (CUDA device 0)` and
  `CUDAExecutionProvider`, FP16, 30 FPS advertised maximum, and one in-flight
  frame;
- the returned privacy contract reported semantic results only, no raw-frame
  persistence, and zero raw retention;
- an unrelated public route returned HTTP 404;
- the exact tracked ONNX model was 21,447,188 bytes with SHA-256
  `07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc`;
- a CC0 static bare-hand image produced one hand at confidence `0.934082` with
  21 finite landmarks;
- 200 warmed native repeats of that static image measured p50 `7.652 ms`, p95
  `11.016 ms`, and `122.013` results per second;
- the live GPU also had a light separate AutoLensAI workload. CommandCanvas
  does not claim exclusive GPU ownership.

These results prove the installed native CUDA inference path and its static
image protocol. They do not prove live camera cadence, end-to-end network
latency, or physical-hand ergonomics.

## Reversible edge installation

The route helper in [`ops/hand-relay`](../ops/hand-relay/README.md) created a
complete pre-install Caddy snapshot before replacing or reloading the live
file. The recorded snapshot is:

```text
/home/romiteld/matte-service/ops/caddy/commandcanvas-backups/
  20260828T093447Z-1738645-pre-install.Caddyfile
```

The pre-install file SHA-256 was
`58ec84209dce36faf498b7c14804ddb8fee8c38ad085aef070e34391c2ab5683`.
The installed file SHA-256 was
`5265d7eab968760b8c4959c6bb030897e68e4d1c3d9ac7d319377b449d264787`.
Rollback checks that the current file still matches the installed checksum,
restores the exact snapshot, validates it, and reloads Caddy. DNS removal is a
separate deliberate operation and must target the exact resolved record ID.

## Remaining physical verification

Danny's real screen recording showed the rendered UI receiving a physical
camera, recognizing open-palm state, and reporting pinch ratios between 0.22
and 0.28. It also showed why the old camera-preview boundary was unacceptable:
reaching the canvas edges required large physical motion while an enlarged
preview obscured the workspace.

The current source removes that preview boundary from the interaction model.
The complete canvas is the hand control plane, a comfortable central camera
region maps across its full width and height, the drawer closes when spatial
control begins, and the preview is only a collapsible sensor check. Pinch target
acquisition also retains a larger reacquisition area after a target is found.

That post-fix design is covered by reducers and component tests, but a person
has not yet completed the physical matrix against the exact release candidate.
Before claiming physical readiness, exercise far-left/right and high/low reach,
point, pinch engage and release, finger drawing continuity, one-hand movement,
two-hand resize and canvas zoom, open-palm pan, edge throw, bottom minimize,
occlusion, bright and dim light, visibility suspension, and network loss. Record
end-to-end p50, p95, result cadence, dropped frames, false grabs, false releases,
and whether local fallback remains usable.
