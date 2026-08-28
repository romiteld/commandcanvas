export const MAX_BEARER_JWT_LENGTH = 8_192;

const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export type RequestAuthenticationErrorCode =
  | "authorization_missing"
  | "authorization_malformed"
  | "authorization_too_large"
  | "authentication_failed"
  | "permanent_email_auth_required";

export interface RequestAuthenticationError {
  code: RequestAuthenticationErrorCode;
  message: string;
}

export type BearerJwtResult =
  | { ok: true; token: string }
  | { ok: false; error: RequestAuthenticationError };

export type RequestActorResult =
  | { ok: true; actorUserId: string }
  | { ok: false; error: RequestAuthenticationError };

export type PermanentEmailUserResult =
  | { ok: true; actorUserId: string; email: string }
  | { ok: false; error: RequestAuthenticationError };

export interface SupabaseUserVerifier {
  auth: {
    getUser: (token: string) => Promise<{
      data: { user: { id: string; [key: string]: unknown } | null };
      error: unknown;
    }>;
  };
}

export function parseBearerJwtHeader(
  authorizationHeader: string | null,
): BearerJwtResult {
  if (authorizationHeader === null || authorizationHeader === "") {
    return {
      ok: false,
      error: {
        code: "authorization_missing",
        message: "Bearer authentication is required.",
      },
    };
  }

  const bearerPrefix = "Bearer ";
  if (
    authorizationHeader.startsWith(bearerPrefix) &&
    authorizationHeader.length > bearerPrefix.length + MAX_BEARER_JWT_LENGTH
  ) {
    return {
      ok: false,
      error: {
        code: "authorization_too_large",
        message: "Authorization token is too large.",
      },
    };
  }

  if (!authorizationHeader.startsWith(bearerPrefix)) {
    return malformedAuthorization();
  }

  const token = authorizationHeader.slice(bearerPrefix.length);
  if (!jwtPattern.test(token)) return malformedAuthorization();

  return { ok: true, token };
}

export async function authenticateRequestActor(
  authorizationHeader: string | null,
  verifier: SupabaseUserVerifier,
): Promise<RequestActorResult> {
  const bearer = parseBearerJwtHeader(authorizationHeader);
  if (!bearer.ok) return bearer;

  try {
    const { data, error } = await verifier.auth.getUser(bearer.token);
    if (error || !data.user || data.user.id.trim() === "") {
      return authenticationFailed();
    }

    return { ok: true, actorUserId: data.user.id };
  } catch {
    return authenticationFailed();
  }
}

export async function authenticatePermanentEmailUser(
  authorizationHeader: string | null,
  verifier: SupabaseUserVerifier,
): Promise<PermanentEmailUserResult> {
  const bearer = parseBearerJwtHeader(authorizationHeader);
  if (!bearer.ok) return bearer;

  try {
    const { data, error } = await verifier.auth.getUser(bearer.token);
    const user = data.user;
    const email =
      typeof user?.email === "string" ? user.email.trim().toLowerCase() : "";
    const confirmedAt = user?.email_confirmed_at;
    if (
      error ||
      !user ||
      user.id.trim() === "" ||
      user.is_anonymous === true ||
      email.length < 3 ||
      email.length > 254 ||
      !email.includes("@") ||
      typeof confirmedAt !== "string" ||
      confirmedAt.trim() === ""
    )
      return permanentEmailRequired();

    return { ok: true, actorUserId: user.id, email };
  } catch {
    return permanentEmailRequired();
  }
}

function malformedAuthorization(): BearerJwtResult {
  return {
    ok: false,
    error: {
      code: "authorization_malformed",
      message: "Authorization must use Bearer followed by one JWT.",
    },
  };
}

function authenticationFailed(): RequestActorResult {
  return {
    ok: false,
    error: {
      code: "authentication_failed",
      message: "Authentication failed.",
    },
  };
}

function permanentEmailRequired(): PermanentEmailUserResult {
  return {
    ok: false,
    error: {
      code: "permanent_email_auth_required",
      message: "Verify your email before using a meeting room.",
    },
  };
}
