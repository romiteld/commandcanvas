// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createServerUserProfileService,
  createUserProfileService,
  type UserProfileRpcClient,
} from "@/lib/user-profiles/service";

const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const PROFILE = {
  displayName: "Daniel",
  color: "#0EA5E9",
  updatedAt: "2026-09-01T19:00:00.000Z",
};
const SERVER_ENVIRONMENT = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  SUPABASE_SECRET_KEY: "server-secret-key-never-sent-to-the-browser",
};

function clientWith(
  implementation: UserProfileRpcClient["rpc"],
): UserProfileRpcClient {
  return { rpc: implementation };
}

describe("server-only user profile service", () => {
  it("loads only the exact actor's bounded profile", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        configured: true,
        display_name: PROFILE.displayName,
        color: PROFILE.color,
        updated_at: PROFILE.updatedAt,
      },
      error: null,
    }));
    const service = createUserProfileService(clientWith(rpc));

    await expect(service.get(ACTOR_ID)).resolves.toEqual(PROFILE);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_user_profile", {
      p_user_id: ACTOR_ID,
    });
  });

  it("returns null for a new user without inventing profile values", async () => {
    const service = createUserProfileService(
      clientWith(vi.fn(async () => ({ data: { configured: false }, error: null }))),
    );

    await expect(service.get(ACTOR_ID)).resolves.toBeNull();
  });

  it("upserts normalized values only for the verified actor", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        configured: true,
        display_name: PROFILE.displayName,
        color: PROFILE.color,
        updated_at: PROFILE.updatedAt,
      },
      error: null,
    }));
    const service = createUserProfileService(clientWith(rpc));

    await expect(
      service.upsert(ACTOR_ID, { displayName: " Daniel ", color: "#0ea5e9" }),
    ).resolves.toEqual(PROFILE);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("upsert_user_profile", {
      p_user_id: ACTOR_ID,
      p_display_name: "Daniel",
      p_color: "#0EA5E9",
    });
  });

  it("sanitizes provider failures", async () => {
    const service = createUserProfileService(
      clientWith(
        vi.fn(async () => ({
          data: null,
          error: { message: "database leaked private details" },
        })),
      ),
    );

    await expect(service.get(ACTOR_ID)).rejects.toThrow(
      "User profile storage is unavailable.",
    );
  });

  it("constructs only from server Supabase configuration", () => {
    expect(createServerUserProfileService({ environment: {} })).toEqual({
      ok: false,
    });
    const createClient = vi.fn(() => clientWith(vi.fn()));
    expect(
      createServerUserProfileService({
        environment: SERVER_ENVIRONMENT,
        createClient,
      }).ok,
    ).toBe(true);
    expect(createClient).toHaveBeenCalledWith({
      supabaseUrl: SERVER_ENVIRONMENT.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: SERVER_ENVIRONMENT.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      secretKey: SERVER_ENVIRONMENT.SUPABASE_SECRET_KEY,
    });
  });
});
