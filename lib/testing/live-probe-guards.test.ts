import { describe, expect, it } from "vitest";

import {
  assertLiveProbeTarget,
  requireProductionApiProxyOrigin,
} from "@/lib/testing/live-probe-guards";

describe("live browser probe guards", () => {
  it("allows loopback without a production opt-in", () => {
    expect(() =>
      assertLiveProbeTarget("http://127.0.0.1:3000", false),
    ).not.toThrow();
    expect(() =>
      assertLiveProbeTarget("http://localhost:3000", false),
    ).not.toThrow();
  });

  it("requires an explicit opt-in for a non-loopback target", () => {
    expect(() =>
      assertLiveProbeTarget("https://commandcanvas.vercel.app", false),
    ).toThrow("WEBMCP_LIVE_PROBE=true");
    expect(() =>
      assertLiveProbeTarget("https://commandcanvas.vercel.app", true),
    ).not.toThrow();
  });

  it("refuses non-HTTPS public targets even with an opt-in", () => {
    expect(() =>
      assertLiveProbeTarget("http://example.com", true),
    ).toThrow("HTTPS");
  });

  it("allows API proxying only to the canonical production origin", () => {
    expect(
      requireProductionApiProxyOrigin("https://commandcanvas.vercel.app"),
    ).toBe("https://commandcanvas.vercel.app");
    expect(() =>
      requireProductionApiProxyOrigin("https://example.com"),
    ).toThrow("canonical CommandCanvas production origin");
    expect(() =>
      requireProductionApiProxyOrigin("http://commandcanvas.vercel.app"),
    ).toThrow("canonical CommandCanvas production origin");
  });
});
