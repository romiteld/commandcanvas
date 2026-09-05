// @vitest-environment node
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "./proxy";

const origin = "https://commandcanvas.vercel.app";

describe("public local preview and paused hosted access", () => {
  it.each(["/", "/demo?room=old-room&join=old-capability&signin=1"])(
    "opens the local preview from %s without carrying room credentials",
    (path) => {
      const response = proxy(new NextRequest(`${origin}${path}`));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe(`${origin}/local`);
    },
  );

  it.each([
    "/local", "/local?_rsc=preview",
    "/_next/static/chunks/app/local/page.js",
    "/mediapipe/wasm/vision_wasm_internal.wasm",
    "/mediapipe/wasm/vision_wasm_internal.js",
    "/workers/hand-landmarker.js", "/favicon.ico",
  ])("serves the browser-only workspace asset %s", (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(true);
    const response = proxy(new NextRequest(`${origin}${path}`));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-commandcanvas-mode")).toBe("local-preview");
  });

  it.each([
    "/meet", "/vision-lab", "/auth/callback", "/local/private",
    "/api", "/api/rooms", "/api/realtime/session", "/api/webhooks/resend",
    "/_next/data/build/meet.json", "/_next/data/build/local.json",
    "/_next/image?url=/api/rooms", "/mediapipe/wasm/private.json",
    "/models/private.onnx", "/workers/private-worker.js",
  ])("keeps hosted and unlisted routes closed at %s", async (path) => {
    const response = proxy(new NextRequest(`${origin}${path}`, {
      headers: {
        authorization: "Bearer stale-token",
        cookie: "sb-access-token=old; commandcanvas_access=old",
        "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy",
      },
    }));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(await response.text()).toContain("Sign-in");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "refuses %s even on a public page or asset",
    async (method) => {
      for (const path of ["/", "/demo", "/local", "/workers/hand-landmarker.js", "/api/rooms"]) {
        const response = proxy(new NextRequest(`${origin}${path}`, {
          method,
          headers: { "next-action": "old-server-action" },
        }));
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ error: "application_paused" });
      }
    },
  );

  it("keeps the hosted pause page self-contained and links the public preview", async () => {
    const response = proxy(new NextRequest(`${origin}/meet`));
    const html = await response.text();
    expect(html).toContain("Shared rooms are paused.");
    expect(html).toContain('href="/local"');
    expect(html).not.toMatch(/<script|<form|<iframe|<canvas/);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("supports HEAD on the preview while keeping private HEAD responses closed", async () => {
    expect(proxy(new NextRequest(`${origin}/local`, { method: "HEAD" })).headers.get("x-middleware-next")).toBe("1");
    const response = proxy(new NextRequest(`${origin}/meet`, { method: "HEAD" }));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});
