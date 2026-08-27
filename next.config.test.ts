import { describe, expect, it } from "vitest";

import nextConfig from "./next.config";

describe("application response headers", () => {
  it("applies the release security headers to every route without a broad CSP", async () => {
    const rules = await nextConfig.headers?.();
    const globalRule = rules?.find((rule) => rule.source === "/:path*");
    const headers = new Map(
      globalRule?.headers.map(({ key, value }) => [key.toLowerCase(), value]),
    );

    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(headers.get("permissions-policy")).toBe(
      "camera=(self), microphone=(self), accelerometer=(), autoplay=(), geolocation=(), gyroscope=(), magnetometer=(), payment=(), usb=(), xr-spatial-tracking=()",
    );
    expect(headers.has("content-security-policy")).toBe(false);
  });
});
