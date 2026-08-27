import { describe, expect, it, vi } from "vitest";

import { ensureNoSignupSession } from "@/lib/supabase/session";

const existingSession = {
  access_token: "session-token",
  user: { id: "user-existing", is_anonymous: true },
};

describe("ensureNoSignupSession", () => {
  it("reuses an existing browser session without creating another anonymous identity", async () => {
    const signInAnonymously = vi.fn();
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: existingSession },
          error: null,
        }),
        signInAnonymously,
      },
    };

    const result = await ensureNoSignupSession(client);

    expect(result).toEqual({ ok: true, session: existingSession, created: false });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("creates one anonymous authenticated identity when no session exists", async () => {
    const createdSession = {
      access_token: "new-session-token",
      user: { id: "user-new", is_anonymous: true },
    };
    const signInAnonymously = vi.fn().mockResolvedValue({
      data: { session: createdSession },
      error: null,
    });
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
        signInAnonymously,
      },
    };

    const result = await ensureNoSignupSession(client);

    expect(result).toEqual({ ok: true, session: createdSession, created: true });
    expect(signInAnonymously).toHaveBeenCalledOnce();
  });

  it("returns an honest unavailable result when anonymous auth fails", async () => {
    const client = {
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: null,
        }),
        signInAnonymously: vi.fn().mockResolvedValue({
          data: { session: null },
          error: { message: "Anonymous sign-ins are disabled" },
        }),
      },
    };

    const result = await ensureNoSignupSession(client);

    expect(result).toEqual({
      ok: false,
      code: "anonymous_auth_unavailable",
      message: "Anonymous sign-ins are disabled",
    });
  });
});
