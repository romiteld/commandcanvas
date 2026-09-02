# Optional private GPU hand relay

CommandCanvas is usable without a private GPU. The MIT browser application
uses MediaPipe Hand Landmarker locally by default and keeps camera frames in
the browser. A separately operated private relay may be enabled as an opt-in
performance path for a configured deployment; it is not a judge dependency.

## Processing boundary

```text
Camera
  |
  +-- default ----------------> MediaPipe worker in this browser
  |                                  |
  |                                  +--> same-model in-page recovery
  |
  +-- explicit relay consent -> bounded newest frame over TLS/WSS
                                      |
                                      v
                           separately operated GPU relay
                                      |
                                      v
                             semantic 21-point hands
                                      |
                                      v
                           canonical canvas intentions
```

The main repository contains only the MIT relay client, protocol, short-lived
session/token authorization, server route, and failure-to-local behavior. It
does not distribute the relay service, CUDA operations, model weights, model
detector, ONNX Runtime, or GPU deployment source.

The exact AGPL corresponding source for the current relay image is published at
[`ee5c2afcfbfc8427b39e2f13e170785c87bce2e3`](https://github.com/romiteld/commandcanvas/tree/ee5c2afcfbfc8427b39e2f13e170785c87bce2e3)
on the isolated `hand-relay-source` branch. That unrelated branch is a separate
source distribution from the MIT web application on `main`.

## Privacy and authorization

Private processing is attempted only when all of these conditions hold:

- the user explicitly enables camera upload for hand tracking;
- Hand input is active;
- the browser has a valid Supabase session and current room membership;
- that permanent actor UUID is present in the server-only owner allowlist;
- the server configuration names one exact HTTPS relay origin;
- durable actor, room, and global admission succeeds;
- a short-lived, one-use capability can be issued.

The capability is sent as the first WebSocket message, never in a URL. The
browser permits one in-flight frame and retains only the newest pending frame.
Disabling consent or Hand input, leaving the page, expiry, overload, network
failure, malformed output, or relay close terminates the remote path and
returns to local MediaPipe. Relay failure cannot stop the canvas.

The browser contract accepts at most two hands with exactly 21 finite,
normalized landmarks. Raw frames must not be sent to ChatGPT, OpenAI,
Supabase, or a WebMCP tool by this path. The separately operated service is
responsible for enforcing encoded/decompressed image limits, origin and token
checks, non-retention, and its own source-license obligations.

## Server-only configuration

```dotenv
PRIVATE_HAND_RELAY_ENABLED=true
PRIVATE_HAND_RELAY_ORIGIN=https://configured-relay.example
PRIVATE_HAND_RELAY_SIGNING_KEY=<independent 32-byte base64url secret>
PRIVATE_HAND_RELAY_TOKEN_TTL_SECONDS=60
PRIVATE_HAND_RELAY_ALLOWED_ACTOR_IDS=<comma-separated Supabase owner UUIDs>
```

The allowlist is default-deny and is never returned to the browser. Anonymous
no-signup actors and permanent non-owner room members always remain on local
MediaPipe. No reusable relay secret is exposed to the browser. No firewall, router,
provider, or deployment credential belongs in either repository.

## Verification boundary

Prior static-image CUDA measurements belong to the earlier combined release
and to the separately operated relay. Public source availability does not
verify the current MIT browser build, live end-to-end latency, or physical-hand
ergonomics. The current application requires a fresh target-browser camera
lifecycle and real-hand rehearsal before any smoothness or accuracy claim is
made.
