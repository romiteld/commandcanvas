export interface NoSignupSession {
  access_token: string;
  user: {
    id: string;
    is_anonymous?: boolean;
  };
}

interface AuthOperationResult {
  data: { session: NoSignupSession | null };
  error: { message: string } | null;
}

export interface NoSignupAuthClient {
  auth: {
    getSession: () => Promise<AuthOperationResult>;
    signInAnonymously: () => Promise<AuthOperationResult>;
  };
}

export type NoSignupSessionResult =
  | {
      ok: true;
      session: NoSignupSession;
      created: boolean;
    }
  | {
      ok: false;
      code: "session_read_failed" | "anonymous_auth_unavailable";
      message: string;
    };

export async function ensureNoSignupSession(
  client: NoSignupAuthClient,
): Promise<NoSignupSessionResult> {
  const current = await client.auth.getSession();
  if (current.error)
    return {
      ok: false,
      code: "session_read_failed",
      message: current.error.message,
    };

  if (current.data.session)
    return { ok: true, session: current.data.session, created: false };

  const created = await client.auth.signInAnonymously();
  if (created.error || !created.data.session)
    return {
      ok: false,
      code: "anonymous_auth_unavailable",
      message: created.error?.message ?? "Anonymous sign-in returned no session.",
    };

  return { ok: true, session: created.data.session, created: true };
}
