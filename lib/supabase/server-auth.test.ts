// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MAX_BEARER_JWT_LENGTH,
  authenticateRequestActor,
  parseBearerJwtHeader,
} from "@/lib/supabase/server-auth";
import {
  createServerServiceClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";

const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhY3Rvci0xIn0.signature";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseBearerJwtHeader", () => {
  it("rejects a missing Authorization header with a compact typed error", () => {
    expect(parseBearerJwtHeader(null)).toEqual({
      ok: false,
      error: {
        code: "authorization_missing",
        message: "Bearer authentication is required.",
      },
    });
  });

  it.each([
    `bearer ${jwt}`,
    `Bearer  ${jwt}`,
    `Basic ${jwt}`,
    "Bearer not-a-jwt",
    `Bearer ${jwt} trailing`,
  ])("rejects malformed authorization value %s", (header) => {
    expect(parseBearerJwtHeader(header)).toEqual({
      ok: false,
      error: {
        code: "authorization_malformed",
        message: "Authorization must use Bearer followed by one JWT.",
      },
    });
  });

  it("bounds the accepted bearer token length before authentication", () => {
    const oversized = `Bearer ${"a".repeat(MAX_BEARER_JWT_LENGTH + 1)}`;

    expect(parseBearerJwtHeader(oversized)).toEqual({
      ok: false,
      error: {
        code: "authorization_too_large",
        message: "Authorization token is too large.",
      },
    });
  });
});

describe("authenticateRequestActor", () => {
  it("returns one generic error when Supabase rejects the JWT", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: { message: `expired token ${jwt}` },
    });

    const result = await authenticateRequestActor(`Bearer ${jwt}`, {
      auth: { getUser },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "authentication_failed",
        message: "Authentication failed.",
      },
    });
    expect(JSON.stringify(result)).not.toContain(jwt);
    expect(JSON.stringify(result)).not.toContain("expired token");
    expect(getUser).toHaveBeenCalledExactlyOnceWith(jwt);
  });

  it("derives the actor ID only from the server-verified Supabase user", async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          id: "verified-user-id",
          user_metadata: { actorUserId: "spoofed-user-id" },
        },
      },
      error: null,
    });

    const result = await authenticateRequestActor(`Bearer ${jwt}`, {
      auth: { getUser },
    });

    expect(result).toEqual({ ok: true, actorUserId: "verified-user-id" });
  });

  it("does not call Supabase for a malformed header", async () => {
    const getUser = vi.fn();

    const result = await authenticateRequestActor(`Bearer  ${jwt}`, {
      auth: { getUser },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "authorization_malformed" },
    });
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("server Supabase configuration", () => {
  it("reports a missing secret explicitly without exposing configured values", () => {
    const result = readServerSupabaseConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-value",
      SUPABASE_SECRET_KEY: "",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "missing_supabase_server_config",
        missing: ["SUPABASE_SECRET_KEY"],
        message: "Missing server configuration: SUPABASE_SECRET_KEY.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("publishable-value");
    expect(JSON.stringify(result)).not.toContain("project.supabase.co");
  });

  it("creates a non-persistent service client with only the server secret", () => {
    const client = { marker: "service-client" };
    const createClient = vi.fn().mockReturnValue(client);
    const config = {
      supabaseUrl: "https://project.supabase.co",
      publishableKey: "publishable-value",
      secretKey: "server-secret-value",
    };

    const result = createServerServiceClient(config, createClient);

    expect(result).toBe(client);
    expect(createClient).toHaveBeenCalledExactlyOnceWith(
      config.supabaseUrl,
      config.secretKey,
      {
        auth: {
          autoRefreshToken: false,
          detectSessionInUrl: false,
          persistSession: false,
        },
      },
    );
    expect(createClient).not.toHaveBeenCalledWith(
      expect.anything(),
      config.publishableKey,
      expect.anything(),
    );
  });

  it("refuses to construct a service client in a browser runtime", () => {
    const createClient = vi.fn();
    vi.stubGlobal("window", {});

    expect(() =>
      createServerServiceClient(
        {
          supabaseUrl: "https://project.supabase.co",
          publishableKey: "publishable-value",
          secretKey: "server-secret-value",
        },
        createClient,
      ),
    ).toThrowError("The Supabase service client is server-only.");
    expect(createClient).not.toHaveBeenCalled();
  });
});
