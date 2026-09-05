# Hosted rooms are paused; the local preview is public

The owner deleted the Supabase project and initially closed the application.
On September 5, 2026, the owner authorized a public interactive preview for
portfolio readers without login or an API key. `/local` now runs the existing
canvas in the visitor's tab; `/` and `/demo` redirect there. The page identifies
the local scope and links the owner's recorded demonstration.

`proxy.ts` allows only GET/HEAD for that page and its framework, worker, and
MediaPipe assets. Hosted pages, all APIs, and all mutating HTTP methods remain
closed with HTTP 503. Old sessions and invitations cannot authorize them.
The local preview does not create Supabase identities or rooms, call paid
providers, restore saved rooms, or send email. Its sample objects and local
receipts are not evidence of a current shared-room backend.

Vercel Standard Protection also protects deployment-specific URLs and previews
with Vercel Authentication. Production domains serve the public local preview;
hosted pages and APIs remain closed.

The two local containers `commandcanvas-hand-relay-640` and
`commandcanvas-hand-relay-cuda-640-proof` are stopped with restart policy `no`.
Their local GPU capacity is available for the portfolio. Preserve their images,
models, existing application worktrees, and private training artifacts.

Before restoring hosted rooms, restore a working authentication service and
verify authorized access and unauthorized refusal on every hosted page and API,
including framework data requests and stale credentials. Public local access
does not authorize reopening those services. Do not restart the GPU relays
without a new owner request.
