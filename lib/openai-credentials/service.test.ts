// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createOpenAiCredentialService,
  createServerOpenAiCredentialService,
  resolveSavedOpenAiApiKey,
  type OpenAiCredentialRpcClient,
} from "@/lib/openai-credentials/service";
import { createTestOpenAiApiKey } from "@/lib/testing/openai-key-fixture";

const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const VALID_KEY = createTestOpenAiApiKey("test-saved-user-owned-key");
const FINGERPRINT = `sha256:${createHash("sha256")
  .update(VALID_KEY)
  .digest("hex")
  .slice(0, 16)}`;
const SERVER_ENVIRONMENT = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  SUPABASE_SECRET_KEY: "server-secret-key-never-sent-to-the-browser",
};

function clientWith(
  implementation: OpenAiCredentialRpcClient["rpc"],
): OpenAiCredentialRpcClient {
  return { rpc: implementation };
}

describe("server-only OpenAI credential service", () => {
  it("reads only masked status for the exact verified actor", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        configured: true,
        key_fingerprint: FINGERPRINT,
        updated_at: "2026-09-01T01:02:03.000Z",
      },
      error: null,
    }));
    const service = createOpenAiCredentialService(clientWith(rpc));

    await expect(service.getStatus(ACTOR_ID)).resolves.toEqual({
      configured: true,
      fingerprint: FINGERPRINT,
      updatedAt: "2026-09-01T01:02:03.000Z",
    });
    expect(rpc).toHaveBeenCalledWith("get_user_openai_credential_status", {
      p_user_id: ACTOR_ID,
    });
  });

  it("upserts the raw key only into the actor-scoped Vault RPC", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        configured: true,
        key_fingerprint: FINGERPRINT,
        updated_at: "2026-09-01T01:02:03.000Z",
      },
      error: null,
    }));
    const service = createOpenAiCredentialService(clientWith(rpc));

    await expect(
      service.save(ACTOR_ID, VALID_KEY, FINGERPRINT),
    ).resolves.toEqual({
      configured: true,
      fingerprint: FINGERPRINT,
      updatedAt: "2026-09-01T01:02:03.000Z",
    });
    expect(rpc).toHaveBeenCalledWith("upsert_user_openai_credential", {
      p_api_key: VALID_KEY,
      p_key_fingerprint: FINGERPRINT,
      p_user_id: ACTOR_ID,
    });
  });

  it("deletes and resolves credentials only for the supplied verified actor", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "resolve_user_openai_credential")
        return { data: VALID_KEY, error: null };
      return { data: { configured: false }, error: null };
    });
    const service = createOpenAiCredentialService(clientWith(rpc));

    await expect(service.remove(OTHER_ACTOR_ID)).resolves.toEqual({
      configured: false,
    });
    await expect(service.resolve(OTHER_ACTOR_ID)).resolves.toBe(VALID_KEY);
    expect(rpc.mock.calls).toEqual([
      ["delete_user_openai_credential", { p_user_id: OTHER_ACTOR_ID }],
      ["resolve_user_openai_credential", { p_user_id: OTHER_ACTOR_ID }],
    ]);
  });

  it("sanitizes database failures instead of propagating raw error data", async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: `database rejected ${VALID_KEY}` },
    }));
    const service = createOpenAiCredentialService(clientWith(rpc));

    await expect(service.getStatus(ACTOR_ID)).rejects.toThrow(
      "OpenAI credential storage is unavailable.",
    );
    await expect(service.getStatus(ACTOR_ID)).rejects.not.toThrow(VALID_KEY);
  });

  it("constructs the Vault service only from server Supabase configuration", () => {
    expect(createServerOpenAiCredentialService({ environment: {} })).toEqual({
      ok: false,
    });

    const client = clientWith(vi.fn());
    const createClient = vi.fn(() => client);
    const result = createServerOpenAiCredentialService({
      environment: SERVER_ENVIRONMENT,
      createClient,
    });

    expect(result.ok).toBe(true);
    expect(createClient).toHaveBeenCalledWith({
      publishableKey: SERVER_ENVIRONMENT.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      secretKey: SERVER_ENVIRONMENT.SUPABASE_SECRET_KEY,
      supabaseUrl: SERVER_ENVIRONMENT.NEXT_PUBLIC_SUPABASE_URL,
    });
  });

  it("resolves a saved key server-side without returning status metadata and preserves storage failures", async () => {
    const rpc = vi.fn(async () => ({ data: VALID_KEY, error: null }));
    const options = {
      environment: SERVER_ENVIRONMENT,
      createClient: () => clientWith(rpc),
    };

    await expect(resolveSavedOpenAiApiKey(ACTOR_ID, options)).resolves.toBe(
      VALID_KEY,
    );
    await expect(
      resolveSavedOpenAiApiKey(ACTOR_ID, { environment: {} }),
    ).rejects.toThrow("OpenAI credential storage is unavailable.");
  });
});
