import { z } from "zod";

import { normalizedEmailSchema } from "@/lib/supabase/meeting-contracts";

const emailOtpSchema = z.string().regex(/^\d{6}$/);

export interface PasswordlessAuthUser {
  id: string;
  email?: string;
  is_anonymous?: boolean;
}

export interface PasswordlessAuthSession {
  access_token: string;
}

export interface PasswordlessAuthClient {
  auth: {
    signInWithOtp?: (input: {
      email: string;
      options: { shouldCreateUser: true };
    }) => Promise<{
      data: unknown;
      error: {
        message: string;
        code?: string;
        status?: number;
      } | null;
    }>;
    verifyOtp?: (input: {
      email: string;
      token: string;
      type: "email";
    }) => Promise<{
      data: {
        session: PasswordlessAuthSession | null;
        user: PasswordlessAuthUser | null;
      };
      error: { message: string } | null;
    }>;
  };
}

export type PasswordlessResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message: string };

export async function requestEmailOtp(
  client: PasswordlessAuthClient,
  rawEmail: string,
): Promise<
  | { ok: true; email: string }
  | { ok: false; code: string; message: string }
> {
  const parsed = normalizedEmailSchema.safeParse(rawEmail);
  if (!parsed.success)
    return {
      ok: false,
      code: "invalid_email",
      message: "Enter a valid email address.",
    };

  try {
    if (!client.auth.signInWithOtp)
      return {
        ok: false,
        code: "otp_request_failed",
        message: "The sign-in code could not be sent.",
      };
    const response = await client.auth.signInWithOtp({
      email: parsed.data,
      options: { shouldCreateUser: true },
    });
    if (response.error) return otpRequestError(response.error);
    return { ok: true, email: parsed.data };
  } catch {
    return {
      ok: false,
      code: "otp_request_failed",
      message: "The sign-in code could not be sent.",
    };
  }
}

function otpRequestError(error: { code?: string; status?: number }) {
  if (
    error.code === "over_email_send_rate_limit" ||
    error.status === 429
  )
    return {
      ok: false as const,
      code: "otp_rate_limited",
      message: "Email limit reached. Please wait before requesting another code.",
    };
  return {
    ok: false as const,
    code: "otp_request_failed",
    message: "The sign-in code could not be sent.",
  };
}

export async function verifyEmailOtp(
  client: PasswordlessAuthClient,
  rawEmail: string,
  rawToken: string,
): Promise<
  PasswordlessResult<{
    email: string;
    session: PasswordlessAuthSession;
    user: PasswordlessAuthUser;
  }>
> {
  const email = normalizedEmailSchema.safeParse(rawEmail);
  const token = emailOtpSchema.safeParse(rawToken);
  if (!email.success || !token.success || !client.auth.verifyOtp)
    return { ok: false, code: "invalid_otp", message: "Enter the six-digit code." };

  try {
    const response = await client.auth.verifyOtp({
      email: email.data,
      token: token.data,
      type: "email",
    });
    const userEmail = normalizedEmailSchema.safeParse(response.data.user?.email);
    if (
      response.error ||
      !response.data.session ||
      !response.data.user ||
      response.data.user.is_anonymous === true ||
      !userEmail.success ||
      userEmail.data !== email.data
    )
      return {
        ok: false,
        code: "otp_verification_failed",
        message: "The code is invalid or expired.",
      };

    return {
      ok: true,
      value: {
        email: email.data,
        session: response.data.session,
        user: response.data.user,
      },
    };
  } catch {
    return {
      ok: false,
      code: "otp_verification_failed",
      message: "The code is invalid or expired.",
    };
  }
}
