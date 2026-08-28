// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const redirect = vi.fn(() => {
  throw new Error("NEXT_REDIRECT");
});

vi.mock("next/navigation", () => ({ redirect }));

describe("root entry route", () => {
  it("sends users to the normal OTP meeting lobby instead of local-only mode", async () => {
    const { default: Home } = await import("@/app/page");
    expect(() => Home()).toThrow("NEXT_REDIRECT");
    expect(redirect).toHaveBeenCalledExactlyOnceWith("/meet");
  });
});
