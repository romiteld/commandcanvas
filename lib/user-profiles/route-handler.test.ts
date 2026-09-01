// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  handleGetUserProfileRequest,
  handlePutUserProfileRequest,
  type UserProfileRouteDependencies,
} from "@/lib/user-profiles/route-handler";

const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const JWT = "header.payload.signature";

function dependencies(anonymous = false): UserProfileRouteDependencies {
  return {
    verifier: {
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: anonymous
              ? { id: ACTOR_ID, is_anonymous: true }
              : {
                  id: ACTOR_ID,
                  email: "danny@example.com",
                  email_confirmed_at: "2026-09-01T18:00:00.000Z",
                  is_anonymous: false,
                },
          },
          error: null,
        })),
      },
    },
    service: {
      get: vi.fn(async () => ({
        displayName: "Daniel",
        color: "#0EA5E9",
        updatedAt: "2026-09-01T19:00:00.000Z",
      })),
      upsert: vi.fn(async (_actor, profile) => ({
        ...profile,
        color: profile.color.toUpperCase(),
        updatedAt: "2026-09-01T19:00:00.000Z",
      })),
    },
  };
}

function request(method: "GET" | "PUT", body?: unknown) {
  return new Request("https://commandcanvas.example/api/user-profile", {
    method,
    headers: {
      authorization: `Bearer ${JWT}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("verified user profile route", () => {
  it("returns only the authenticated permanent user's profile", async () => {
    const deps = dependencies();
    const response = await handleGetUserProfileRequest(request("GET"), deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.service.get).toHaveBeenCalledWith(ACTOR_ID);
    await expect(response.json()).resolves.toEqual({
      profile: {
        displayName: "Daniel",
        color: "#0EA5E9",
        updatedAt: "2026-09-01T19:00:00.000Z",
      },
    });
  });

  it("refuses an anonymous demo identity before storage access", async () => {
    const deps = dependencies(true);
    const response = await handleGetUserProfileRequest(request("GET"), deps);

    expect(response.status).toBe(403);
    expect(deps.service.get).not.toHaveBeenCalled();
  });

  it("rejects caller-supplied identity and upserts for only the authenticated actor", async () => {
    const invalid = dependencies();
    const invalidResponse = await handlePutUserProfileRequest(
      request("PUT", {
        displayName: "Daniel",
        color: "#0ea5e9",
        userId: "33333333-3333-4333-8333-333333333333",
      }),
      invalid,
    );
    expect(invalidResponse.status).toBe(400);
    expect(invalid.service.upsert).not.toHaveBeenCalled();

    const deps = dependencies();
    const response = await handlePutUserProfileRequest(
      request("PUT", { displayName: " Daniel ", color: "#0ea5e9" }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(deps.service.upsert).toHaveBeenCalledWith(ACTOR_ID, {
      displayName: "Daniel",
      color: "#0ea5e9",
    });
  });
});
