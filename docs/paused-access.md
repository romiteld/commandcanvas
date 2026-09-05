# CommandCanvas is paused

The owner deleted the Supabase project and requested that nobody use the
application without signing in. Authentication is unavailable, so `proxy.ts`
unconditionally closes every application page, API, and asset route with HTTP
503. The response is a self-contained paused page or an API error. It does not
load the canvas, accept old sessions or invitations, or offer an offline demo.

Vercel Standard Protection also protects deployment-specific URLs and previews
with Vercel Authentication. Production domains serve the closed application.

The two local containers `commandcanvas-hand-relay-640` and
`commandcanvas-hand-relay-cuda-640-proof` are stopped with restart policy `no`.
Their local GPU capacity is available for the portfolio. Preserve their images,
models, existing application worktrees, and private training artifacts.

Before reopening, restore a working authentication service and enforce verified
sign-in on every application route and API. Explicitly cover `/demo`, `/local`,
framework data requests, and stale credentials. Remove the unconditional pause
only after both authorized access and unauthorized refusal pass against the
release candidate. Do not restart the GPU relays without a new owner request.
