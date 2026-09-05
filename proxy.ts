import { NextRequest, NextResponse } from "next/server";

// Hosted rooms remain closed while authentication is unavailable. The public
// local preview authorizes no API, old session, room invite, or server action.
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
    <h1>Shared rooms are paused.</h1>
    <p>Sign-in and hosted collaboration are currently unavailable.</p>
    <p class="status"><a href="/local" style="color: #a8c9bd">Try the interactive preview</a>. Create, draw, and arrange objects in your browser without an account.</p>
  </main>
</body>
</html>`;

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const isRead = request.method === "GET" || request.method === "HEAD";
  const isFrameworkData = Boolean(request.nextUrl.buildId) ||
    new URL(request.url).pathname.startsWith("/_next/data/");
  if (isRead && !isFrameworkData && (path === "/" || path === "/demo")) {
    // Drop stale room capabilities and sign-in parameters at this public entry.
    const destination = request.nextUrl.clone();
    destination.pathname = "/local";
    destination.search = "";
    return NextResponse.redirect(destination);
  }
  if (
    isRead && !isFrameworkData &&
    (path === "/local" ||
      path.startsWith("/_next/static/") ||
      /^\/mediapipe\/wasm\/vision_wasm_(?:nosimd_|module_)?internal\.(?:js|wasm)$/.test(path) ||
      path === "/workers/hand-landmarker.js" ||
      path === "/favicon.ico" || path === "/icon.svg")
  ) {
    const response = NextResponse.next();
    response.headers.set("X-CommandCanvas-Mode", "local-preview");
    return response;
  }

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
