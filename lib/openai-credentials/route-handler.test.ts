// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  handleDeleteOpenAiCredentialRequest,
  handleGetOpenAiCredentialRequest,
  handlePutOpenAiCredentialRequest,
  type OpenAiCredentialRouteDependencies,
} from "@/lib/openai-credentials/route-handler";
import { createTestOpenAiApiKey } from "@/lib/testing/openai-key-fixture";

const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const AUTHORIZATION = "Bearer header.payload.signature";
const VALID_KEY = createTestOpenAiApiKey("test-saved-user-owned-key");
const VALID_KEY_FINGERPRINT = `sha256:${createHash("sha256")
  .update(VALID_KEY)
  .digest("hex")
  .slice(0, 16)}`;
const STATUS = {
  configured: true as const,
  fingerprint: VALID_KEY_FINGERPRINT,
  updatedAt: "2026-09-01T01:02:03.000Z",
};

function dependencies(options?: {
  anonymous?: boolean;
  serviceError?: Error;
}): OpenAiCredentialRouteDependencies {
  const fail = () => {
    if (options?.serviceError) throw options.serviceError;
  };
  return {
    verifier: {
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: options?.anonymous
              ? { id: ACTOR_ID, is_anonymous: true }
              : {
                  id: ACTOR_ID,
                  email: "danny@example.com",
                  email_confirmed_at: "2026-09-01T00:00:00.000Z",
                  is_anonymous: false,
                },
          },
          error: null,
        })),
      },
    },
    service: {
      getStatus: vi.fn(async () => {
        fail();
        return STATUS;
      }),
      save: vi.fn(async () => {
        fail();
        return STATUS;
      }),
      remove: vi.fn(async () => {
        fail();
        return { configured: false as const };
      }),
      resolve: vi.fn(async () => null),
    },
  };
}

function request(
  method: "GET" | "PUT" | "DELETE",
  body?: Record<string, unknown>,
) {
  return new Request("https://commandcanvas.example/api/openai-credential", {
    method,
    headers: {
      authorization: AUTHORIZATION,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("OTP-user OpenAI credential API", () => {
  it("requires bearer authentication before any credential access", async () => {
    const deps = dependencies();
    const unauthenticated = new Request(
      "https://commandcanvas.example/api/openai-credential",
    );

    const response = await handleGetOpenAiCredentialRequest(
      unauthenticated,
      deps,
    );

    expect(response.status).toBe(401);
    expect(deps.service.getStatus).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "authorization_missing",
        message: "Bearer authentication is required.",
      },
    });
  });

  it("refuses an anonymous demo identity before any credential access", async () => {
    const deps = dependencies({ anonymous: true });

    const response = await handleGetOpenAiCredentialRequest(
      request("GET"),
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.service.getStatus).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "permanent_email_auth_required",
        message: "Verify your email before using a meeting room.",
      },
    });
  });

  it("returns only masked status for the verified OTP actor", async () => {
    const deps = dependencies();

    const response = await handleGetOpenAiCredentialRequest(
      request("GET"),
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.service.getStatus).toHaveBeenCalledWith(ACTOR_ID);
    await expect(response.json()).resolves.toEqual(STATUS);
  });

  it("requires explicit confirmation and saves only for the authenticated actor", async () => {
    const unconfirmed = dependencies();
    const unconfirmedResponse = await handlePutOpenAiCredentialRequest(
      request("PUT", { apiKey: VALID_KEY, confirmSave: false }),
      unconfirmed,
    );
    expect(unconfirmedResponse.status).toBe(400);
    expect(unconfirmed.service.save).not.toHaveBeenCalled();

    const deps = dependencies();
    const response = await handlePutOpenAiCredentialRequest(
      request("PUT", { apiKey: VALID_KEY, confirmSave: true }),
      deps,
    );
    expect(response.status).toBe(200);
    expect(deps.service.save).toHaveBeenCalledWith(
      ACTOR_ID,
      VALID_KEY,
      STATUS.fingerprint,
    );
    const serialized = await response.text();
    expect(serialized).toBe(JSON.stringify(STATUS));
    expect(serialized).not.toContain(VALID_KEY);
  });

  it("rejects caller-supplied user identity instead of allowing cross-user writes", async () => {
    const deps = dependencies();
    const response = await handlePutOpenAiCredentialRequest(
      request("PUT", {
        apiKey: VALID_KEY,
        confirmSave: true,
        userId: OTHER_ACTOR_ID,
      }),
      deps,
    );

    expect(response.status).toBe(400);
    expect(deps.service.save).not.toHaveBeenCalled();
  });

  it("deletes only the verified actor's saved credential", async () => {
    const deps = dependencies();
    const response = await handleDeleteOpenAiCredentialRequest(
      request("DELETE"),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.service.remove).toHaveBeenCalledWith(ACTOR_ID);
    await expect(response.json()).resolves.toEqual({ configured: false });
  });

  it("never echoes a raw key from malformed input or service failures", async () => {
    const invalid = dependencies();
    const invalidResponse = await handlePutOpenAiCredentialRequest(
      request("PUT", { apiKey: `${VALID_KEY}.bad`, confirmSave: true }),
      invalid,
    );
    expect(await invalidResponse.text()).not.toContain(VALID_KEY);
    expect(invalid.service.save).not.toHaveBeenCalled();

    const failed = dependencies({
      serviceError: new Error(`database rejected ${VALID_KEY}`),
    });
    const failedResponse = await handlePutOpenAiCredentialRequest(
      request("PUT", { apiKey: VALID_KEY, confirmSave: true }),
      failed,
    );
    expect(failedResponse.status).toBe(503);
    const serialized = await failedResponse.text();
    expect(serialized).not.toContain(VALID_KEY);
    expect(serialized).toBe(
      JSON.stringify({
        ok: false,
        error: {
          code: "credential_store_unavailable",
          message: "Saved OpenAI credentials are temporarily unavailable.",
        },
      }),
    );
  });
});
