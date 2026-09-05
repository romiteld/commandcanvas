import { NextRequest, NextResponse } from "next/server";

// The authentication project has been deleted. Keep every route closed until
// working sign-in and server-side authorization have been restored and verified.
// This deliberately does not trust old cookies, bearer tokens, or room invites.
const pausedPage = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>CommandCanvas | Paused</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100svh; display: grid; place-items: center; background: #101416; color: #edf2f0; padding: 24px; }
    main { width: 100%; max-width: 480px; }
    .name { color: #a8c9bd; font-size: 14px; letter-spacing: .08em; }
    h1 { font-size: clamp(32px, 7vw, 44px); line-height: 1.15; font-weight: 550; margin: 24px 0 18px; }
    p { color: #b5bfbc; font-size: 17px; line-height: 1.6; }
    .status { margin-top: 32px; padding-top: 20px; border-top: 1px solid #303b36; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <div class="name">CommandCanvas</div>
    <h1>This workspace is paused.</h1>
    <p>Access requires sign-in. Sign-in is currently unavailable, so the application is closed.</p>
    <p class="status">The project will return when work resumes.</p>
  </main>
</body>
</html>`;

export function proxy(request: NextRequest) {
  const headers = {
    "Cache-Control": "private, no-store, max-age=0",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "Content-Security-Policy":
      "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  };

  if (
    request.nextUrl.pathname.startsWith("/api/") ||
    request.nextUrl.pathname === "/api" ||
    !["GET", "HEAD"].includes(request.method)
  ) {
    return NextResponse.json(
      {
        error: "application_paused",
        message:
          "Sign-in is required and currently unavailable. CommandCanvas is closed.",
      },
      { status: 503, headers },
    );
  }

  return new NextResponse(request.method === "HEAD" ? null : pausedPage, {
    status: 503,
    headers: { ...headers, "Content-Type": "text/html; charset=utf-8" },
  });
}

// Include application pages, API routes, assets, and framework data requests.
export const config = { matcher: "/:path*" };
