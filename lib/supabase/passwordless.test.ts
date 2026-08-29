import { describe, expect, it, vi } from "vitest";

import {
  requestEmailOtp,
  verifyEmailOtp,
} from "@/lib/supabase/passwordless";

describe("Supabase email OTP flow", () => {
  it("requests a six-digit email OTP without a password or redirect login", async () => {
    const signInWithOtp = vi.fn(async () => ({ data: {}, error: null }));

    const result = await requestEmailOtp(
      { auth: { signInWithOtp } },
      " Danny@Example.com ",
    );

    expect(result).toEqual({ ok: true, email: "danny@example.com" });
    expect(signInWithOtp).toHaveBeenCalledExactlyOnceWith({
      email: "danny@example.com",
      options: { shouldCreateUser: true },
    });
  });

  it("reports a bounded actionable error when Supabase email delivery is rate limited", async () => {
    const signInWithOtp = vi.fn(async () => ({
      data: {},
      error: {
        code: "over_email_send_rate_limit",
        message: "429: email rate limit exceeded",
        status: 429,
      },
    }));

    const result = await requestEmailOtp(
      { auth: { signInWithOtp } },
      "danny@example.com",
    );

    expect(result).toEqual({
      ok: false,
      code: "otp_rate_limited",
      message: "Email limit reached. Please wait before requesting another code.",
    });
    expect(JSON.stringify(result)).not.toContain("429:");
  });

  it("verifies only a six-digit email token and canonical matching permanent user", async () => {
    const verifyOtp = vi.fn(async () => ({
      data: {
        session: { access_token: "header.payload.signature" },
        user: {
          id: "22222222-2222-4222-8222-222222222222",
          email: "danny@example.com",
          is_anonymous: false,
        },
      },
      error: null,
    }));

    const result = await verifyEmailOtp(
      { auth: { verifyOtp } },
      "DANNY@example.com",
      "123456",
    );

    expect(result.ok).toBe(true);
    expect(verifyOtp).toHaveBeenCalledExactlyOnceWith({
      email: "danny@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("refuses malformed OTPs, anonymous users, and canonical email mismatches", async () => {
    const verifyOtp = vi.fn();
    expect(
      await verifyEmailOtp(
        { auth: { verifyOtp } },
        "danny@example.com",
        "12345",
      ),
    ).toMatchObject({ ok: false, code: "invalid_otp" });
    expect(verifyOtp).not.toHaveBeenCalled();

    verifyOtp.mockResolvedValueOnce({
      data: {
        session: { access_token: "header.payload.signature" },
        user: {
          id: "22222222-2222-4222-8222-222222222222",
          email: "other@example.com",
          is_anonymous: false,
        },
      },
      error: null,
    });
    expect(
      await verifyEmailOtp(
        { auth: { verifyOtp } },
        "danny@example.com",
        "123456",
      ),
    ).toMatchObject({ ok: false, code: "otp_verification_failed" });
  });
});
