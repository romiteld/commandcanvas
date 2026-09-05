// @vitest-environment node
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "./proxy";

describe("paused application access", () => {
  it.each([
    "/", "/demo", "/local", "/meet", "/vision-lab", "/auth/callback",
    "/api/rooms", "/api/realtime/session", "/api/webhooks/resend",
    "/_next/static/chunks/app/local/page.js", "/_next/data/build/local.json",
    "/models/hand_landmarker.task", "/workers/hand-landmarker.js",
  ])("closes %s before application code or assets can load", async (path) => {
    expect(unstable_doesMiddlewareMatch({ config, url: path })).toBe(true);
    const response = proxy(new NextRequest(`https://commandcanvas.vercel.app${path}`));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-middleware-next")).toBeNull();
    expect(await response.text()).toContain("Sign-in");
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])(
    "refuses %s, including old credentials and room capabilities",
    async (method) => {
      const response = proxy(new NextRequest("https://commandcanvas.vercel.app/api/rooms?invite=old", {
        method,
        headers: {
          authorization: "Bearer stale-token",
          cookie: "sb-access-token=old; commandcanvas_access=old",
          "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy",
        },
      }));
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: "application_paused" });
    },
  );

  it("serves a self-contained paused page without executable scripts or forms", async () => {
    const response = proxy(new NextRequest("https://commandcanvas.vercel.app/local"));
    const html = await response.text();
    expect(html).toContain("This workspace is paused.");
    expect(html).not.toMatch(/<script|<form|<iframe|<canvas/);
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("returns no body for HEAD", async () => {
    const response = proxy(new NextRequest("https://commandcanvas.vercel.app/", { method: "HEAD" }));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});
