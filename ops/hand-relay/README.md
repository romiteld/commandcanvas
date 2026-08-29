# Installed private hand-relay edge route

This directory contains the tested, reversible Caddy slice used by the optional
CommandCanvas CUDA hand relay. The route was installed on 2026-08-28. The
helper does not change DNS, pfSense, Docker, or application secrets.

## Live path

```text
hands.autolensai.com:443
  -> existing pfSense WAN TCP 443 forward
  -> existing Caddy host, selected by TLS SNI
  -> 127.0.0.1:8100
  -> commandcanvas-hand-relay native CUDA service
```

AutoLensAI's matte service, port `8099`, model, virtual-host block, and
credentials remain separate. CommandCanvas uses the existing shared 443 edge;
no additional pfSense NAT rule was installed.

## Exposed route surface

`caddy/hand-relay.Caddyfile` defines only this virtual host:

- `GET /v1/capabilities` proxies to `127.0.0.1:8100`;
- `GET /v1/hand-pose` supports the WebSocket upgrade to the same loopback
  service;
- every unrelated method or path returns HTTP 404;
- responses carry `Cache-Control: no-store`;
- access logging is separate and excludes message bodies.

The capability token is sent as the first WebSocket message, never in the URL,
so it is not part of a Caddy request target or ordinary access-log line.

## Recorded installation

The helper snapshots the complete live Caddyfile, checks that the candidate
preserves the previous bytes, provisions and validates the candidate, replaces
the file atomically, and reloads Caddy. A failed reload automatically restores
and reloads the pre-install snapshot.

The 2026-08-28 installation recorded:

```text
snapshot:
  /home/romiteld/matte-service/ops/caddy/commandcanvas-backups/
  20260828T093447Z-1738645-pre-install.Caddyfile

pre-install SHA-256:
  58ec84209dce36faf498b7c14804ddb8fee8c38ad085aef070e34391c2ab5683

installed SHA-256:
  5265d7eab968760b8c4959c6bb030897e68e4d1c3d9ac7d319377b449d264787
```

The public capability route subsequently returned HTTP 200 with the warmed
CUDA provider and the unrelated-route probe returned HTTP 404. DNS resolves
`hands.autolensai.com` through the existing public edge.

## Status, validation, and rollback

Run these commands from the repository root:

```bash
ops/hand-relay/manage-caddy-route.sh status
ops/hand-relay/manage-caddy-route.sh validate
bash ops/hand-relay/tests/manage-caddy-route.test.sh
```

`status` is read-only. Before installation, `validate` builds and validates a
temporary candidate. After installation, it validates the installed Caddyfile
in place. Neither path replaces or reloads the live Caddyfile. The behavioral
test covers both states with a fake Caddy binary and temporary paths; it never
touches the installed edge.

Rollback is destructive to the current hand-relay route and must be deliberate:

```bash
ops/hand-relay/manage-caddy-route.sh rollback
```

Rollback refuses to overwrite the file if its checksum no longer matches the
recorded installed checksum. When it is safe, it restores the exact pre-install
snapshot, validates the restored file, and reloads Caddy. It does not stop the
Docker service or remove DNS.

To remove public DNS separately, first resolve the exact current record ID:

```bash
vercel dns ls autolensai.com --limit 100
vercel dns rm <exact-hands-record-id>
dig A hands.autolensai.com +short @ns1.vercel-dns.com
```

Do not guess or reuse a stale record ID. Restoring Caddy and removing DNS are
separate operations so either can be audited and reversed independently.

## pfSense Plus boundary

The appliance exposes the installed pfSense REST API package under `/api/v2`.
No appliance credential is stored in this repository and no management URL
contains a credential. The installed hand route required no firewall change
because the existing WAN TCP 443 forward already reached Caddy.

If the shared edge is later changed, inspect the current NAT state with a
scoped read-only API key created in the pfSense UI. Only a verified topology
change should lead to a separately reviewed REST mutation. Do not infer an
interface, source, destination, address family, or associated rule from this
runbook.

## External read-only checks

These checks do not authorize a deployment or configuration change:

```bash
curl --fail --silent --show-error \
  https://hands.autolensai.com/v1/capabilities

curl --silent --show-error --output /dev/null --write-out '%{http_code}\n' \
  https://hands.autolensai.com/not-a-relay-route
```

The capability response must identify the real warmed CUDA provider and device,
the pinned model and license, `maxInFlight: 1`, newest-frame-only behavior,
semantic-results-only output, and zero raw retention. The unrelated path must
return `404`.

These route checks do not prove a physical hand works well. Authorized
WebSocket expiry and replay refusal, static-image CUDA inference, and local
fallback are separate protocol checks. Live reach, drawing, pinch, bimanual
control, lighting, occlusion, and device ergonomics remain the physical release
matrix described in [`docs/private-hand-relay.md`](../../docs/private-hand-relay.md).
