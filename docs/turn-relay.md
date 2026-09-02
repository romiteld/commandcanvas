# Optional coturn meeting-media relay

CommandCanvas can attempt direct peer-to-peer meeting media with STUN. A
separately operated coturn service is required before claiming reliable video
across cellular, restrictive NAT, or symmetric NAT networks. TURN is not an
anonymous judge-preview entitlement: credentials are issued only to a current
room member whose Supabase email identity is permanent and confirmed.

## Application boundary

The server issues coturn REST credentials only after all of these checks pass:

- verified permanent Supabase actor;
- active room membership;
- UUID idempotency key;
- atomic durable actor, room, and global admission in Postgres;
- bounded server-only TURN configuration.

The browser receives a short-lived username, HMAC credential, expiry, and ICE
server list. It never receives the shared secret or quota configuration. The
media controller refreshes credentials before creating a peer when less than 60
seconds remain and falls back to direct STUN rather than using stale TURN
credentials. Anonymous no-signup rooms remain direct-only.

## Required server configuration

```dotenv
TURN_ENABLED=true
TURN_URLS=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
TURN_SHARED_SECRET=<independent secret of at least 32 characters>
TURN_TOKEN_TTL_SECONDS=600
TURN_COTURN_USER_QUOTA=4
TURN_COTURN_TOTAL_QUOTA=32
TURN_COTURN_MAX_BPS=2000000
```

The three `TURN_COTURN_*` values are a deployment gate and must match the
separately managed coturn process. CommandCanvas cannot remotely prove that a
misconfigured coturn daemon honored them. The coturn release configuration must
therefore set equivalent allocation and bandwidth limits, including:

```text
user-quota=4
total-quota=32
max-bps=2000000
```

The coturn `static-auth-secret` must match `TURN_SHARED_SECRET`; only the relay
ports intended for ICE should be exposed. Router, firewall, DNS, TLS, and coturn
credentials stay outside this repository and browser bundle.

## Verification boundary

Local tests prove route guards, idempotency semantics, durable SQL contracts,
expiry propagation, and stale-credential refusal. They do not prove a live
coturn process, firewall policy, cellular relay candidate, or cross-network
video. Production acceptance requires one desktop on Wi-Fi and one phone on
cellular, plus observed relay candidates and the frozen deployment identity.
