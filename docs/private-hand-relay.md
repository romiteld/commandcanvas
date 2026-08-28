# Optional private GPU hand relay

Status: application-side contract and browser transport scaffold implemented;
GPU relay service, network exposure, UI opt-in, and physical-camera accuracy are
not deployed or claimed.

CommandCanvas remains local-first. Its in-browser YOLO hand-pose engine requests
WebGPU and falls back to WASM. The private relay is an explicit, separately
enabled acceleration option for a user who chooses to upload short-lived camera
frames to a GPU they control. It must never be an automatic failover because
that would silently change the camera privacy boundary.

## Why the matte service is a pattern, not the hand service

The existing `/home/romiteld/matte-service` proves a useful operational shape:
a warmed CUDA model behind a loopback FastAPI process, Caddy TLS, a stable DNS
name, an open liveness endpoint, and authenticated inference. Its measured
approximately 0.6–0.8 seconds per image is appropriate for still-photo
segmentation and categorically too slow for a cursor. It also uses a static
bearer contract intended for server-to-server still images.

Do not add hand frames to that process or route. Live hand tracking needs a
separate warmed ONNX Runtime CUDA/TensorRT process, a WebSocket, bounded image
dimensions, one in-flight frame, and expiring per-session authorization.

## Implemented application boundary

The following files are deliberately independent of the current local engine:

- `lib/gesture/private-hand-relay-contract.ts` validates capability, session,
  readiness, and semantic landmark messages.
- `lib/gesture/private-hand-relay-token.ts` creates and verifies HMAC-SHA256
  capabilities with room, actor, session, nonce, issue time, and expiry claims.
- `lib/gesture/private-hand-relay-route.ts` requires a Supabase-authenticated
  room member and explicit `cameraUploadConsent: true` before any relay work.
- `lib/gesture/private-hand-relay-server.ts` is disabled by default, probes the
  configured HTTPS readiness endpoint, then issues a 15–120 second token.
- `lib/gesture/private-hand-relay-client.ts` sends the ephemeral token as the
  first WebSocket message, never in the URL. It holds one in-flight frame and
  replaces a waiting frame with the newest one. Invalid output, timeout, or
  disconnection invokes the local fallback callback.
- `app/api/rooms/[roomId]/hand-relay/session/route.ts` is the no-store session
  endpoint. With the feature disabled or unhealthy it returns HTTP 503 and
  `fallback: "local"`.

No reusable relay secret is sent to the browser. The browser sees only a
short-lived signed capability. The relay must consume its `jti` once and keep a
TTL-bounded replay cache, so the same capability cannot open a second socket.

## Relay protocol v1

Capability probe:

```text
GET https://<relay-origin>/v1/capabilities
```

It must return the exact schema in
`privateHandRelayCapabilitySchema`. In particular:

- `ready: true` implies `warm: true`;
- the actual pinned model revision, license, CUDA device, and precision are
  reported;
- `maxInFlight` is exactly `1` and `newestFrameOnly` is `true`;
- `rawFramesPersisted` is `false`, `semanticResultsOnly` is `true`, and
  `maxRetentionSeconds` is `0`.

A cold or overloaded process reports `ready: false` with an
`unavailableReason`; it does not return a pretend-ready response.

WebSocket:

```text
wss://<relay-origin>/v1/hand-pose
```

Message order:

1. Browser opens the socket without query credentials.
2. Browser sends `{type:"hello", protocol, token}`.
3. Relay verifies signature, audience, issuer, room/user/session claims,
   expiration, an allowlisted CommandCanvas `Origin`, and unused `jti` before
   accepting any binary message.
4. Relay sends `{type:"ready", protocol}`.
5. Browser sends one JSON frame header followed by one WebP or JPEG binary
   message.
6. Relay returns the validated semantic result: at most two hands, confidence,
   handedness, and exactly 21 normalized landmarks per hand.
7. Only after that result does the browser send its newest waiting frame.

The relay should close with a policy error for authentication failure, token
replay, metadata/binary ordering violations, oversized input, wrong MIME,
decompression-bomb dimensions, or more than one in-flight frame. It must not
log tokens or frame bytes.

## Server configuration

All four values stay in the Vercel server environment. None is prefixed
`NEXT_PUBLIC_`.

```text
PRIVATE_HAND_RELAY_ENABLED=true
PRIVATE_HAND_RELAY_ORIGIN=https://hands.example.com
PRIVATE_HAND_RELAY_SIGNING_KEY=<32 random bytes encoded as unpadded base64url>
PRIVATE_HAND_RELAY_TOKEN_TTL_SECONDS=60
```

The GPU service receives the same signing key through its own local secret
manager or protected environment file. Generate a new independent key; do not
reuse a Supabase, Resend, pfSense, matte, or application secret.

## Exact deployment sequence still required

1. **Rotate the pfSense password exposed in chat.** Do not use it in a shell,
   commit, deployment log, browser URL, or automation. Full authorization does
   not make an exposed management password safe to reuse.
2. **Benchmark a separate warmed relay locally on the RTX 3090.** Pin the
   `poptoz/yolo26-hand-pose-face-detection` ONNX revision and its AGPL-3.0
   notices. Use ONNX Runtime CUDA first; compare TensorRT only after correctness
   matches. Warm with a real hand fixture, then require measured end-to-end p50,
   p95, output cadence, and dropped-frame counts. Do not infer readiness from
   `nvidia-smi` alone.
3. **Implement relay-side verification and the bounded socket.** Validate the
   v1 contract, enforce an exact production/staging Origin allowlist, consume
   each `jti` once until expiry, permit one in-flight frame, drop stale queued
   work, reject images above the advertised bytes/dimensions, and keep no raw
   frame or debug capture. Unit-test tampering, expiry, replay, cross-origin
   attempts, malformed images, queue pressure, disconnect, and semantic output
   shape.
4. **Bind inference to loopback**, for example `127.0.0.1:8100`. Run it under a
   dedicated unprivileged service account. Do not modify or share the matte
   process, virtual environment, bearer token, port, or model lifecycle.
5. **Add a separate Caddy virtual host** such as `hands.example.com` that
   reverse-proxies only `/v1/capabilities` and `/v1/hand-pose` to the new
   loopback port. Cap the request body, disable response caching, keep the token
   out of the URL, and ensure access logs never contain message bodies.
6. **Point DNS to the controlled public address.** Verify the certificate,
   WebSocket upgrade, and the capability JSON from outside the LAN before
   changing CommandCanvas.
7. **Use pfSense only for the minimum network path.** On pfSense Plus 25.07 or
   later, Netgate Nexus is enabled under **System > Advanced > Netgate Nexus**.
   If WAN TCP 443 already forwards to the Caddy host and Caddy selects virtual
   hosts by SNI, no new hand-relay NAT rule is required. Otherwise add only the
   specific TCP 443 path to that Caddy host. Prefer the GUI for this one-time
   rule. If automating, create a scoped Nexus API key after password rotation;
   never use an administrator username/password as an API credential.
8. **Set the four server variables in a non-production CommandCanvas
   deployment first.** The route must return a WSS session with a 60-second
   capability, and the browser must fall back locally when the service is
   stopped, cold, overloaded, malformed, or slow.
9. **Add a visible opt-in control.** Its copy must say that camera frames leave
   the browser for the named private GPU. Stopping spatial mode, closing the
   room, revoking consent, visibility suspension, or local fallback must close
   the socket and clear queued blobs.
10. **Exercise a physical-camera matrix** before production: far-left/right,
    high/low reach, point, pinch engage/release, finger drawing continuity,
    one-hand object move, two-hand resize, occlusion, bright/dim light, and
    network loss. Record local WebGPU, local WASM, and private-GPU p50/p95 rather
    than assuming the remote path is smoother.

Netgate’s supported interface is [Netgate Nexus for pfSense
Plus](https://docs.netgate.com/pfsense/en/latest/nexus/index.html), with its
enablement options documented in [Netgate Nexus
settings](https://docs.netgate.com/pfsense/en/latest/nexus/options.html).

## Release gate

Do not set `PRIVATE_HAND_RELAY_ENABLED=true` publicly until all of these are
true:

- HTTPS capability and WSS endpoints are externally exercised;
- a real CUDA inference result matches the 21-point schema;
- token expiry and one-use replay refusal are observed at the relay;
- no raw frame, token, or management credential appears in logs;
- local WebGPU/WASM still runs when consent is absent or the relay fails;
- physical hand testing demonstrates a material latency or reach improvement.

Until then, the accurate product status is: **secure opt-in contract scaffold;
private GPU inference not deployed**.
