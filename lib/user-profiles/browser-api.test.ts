// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createBrowserUserProfileApi } from "@/lib/user-profiles/browser-api";

const JWT = "header.payload.signature";
const PROFILE = {
  displayName: "Daniel",
  color: "#0EA5E9",
  updatedAt: "2026-09-01T19:00:00.000Z",
};

describe("browser user profile API", () => {
  it("loads the current actor profile through an authenticated no-store GET", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ profile: PROFILE }));
    const api = createBrowserUserProfileApi({ accessToken: JWT, fetcher });

    await expect(api.load(signal)).resolves.toEqual({
      ok: true,
      value: PROFILE,
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/user-profile", {
      method: "GET",
      headers: { authorization: `Bearer ${JWT}` },
      cache: "no-store",
      signal,
    });
  });

  it("accepts an absent profile and refuses malformed responses", async () => {
    const absent = createBrowserUserProfileApi({
      accessToken: JWT,
      fetcher: vi.fn(async () => Response.json({ profile: null })),
    });
    await expect(absent.load()).resolves.toEqual({ ok: true, value: null });

    const malformed = createBrowserUserProfileApi({
      accessToken: JWT,
      fetcher: vi.fn(async () => Response.json({ profile: { name: "Daniel" } })),
    });
    await expect(malformed.load()).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_response" },
    });
  });

  it("upserts a normalized profile without accepting a caller identity", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ profile: PROFILE }));
    const api = createBrowserUserProfileApi({ accessToken: JWT, fetcher });

    await expect(
      api.save({ displayName: " Daniel ", color: "#0ea5e9" }),
    ).resolves.toEqual({ ok: true, value: PROFILE });
    const init = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({
      displayName: "Daniel",
      color: "#0ea5e9",
    });
    expect(String(init?.body)).not.toContain("userId");
  });
});
