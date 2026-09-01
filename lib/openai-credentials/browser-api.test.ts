// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createBrowserOpenAiCredentialApi } from "@/lib/openai-credentials/browser-api";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJob3N0In0.signature";
const OPENAI_API_KEY = `sk-proj-${"a".repeat(40)}`;
const STATUS = {
  configured: true,
  fingerprint: "sha256:0123456789abcdef",
  updatedAt: "2026-09-01T03:12:34.000Z",
};

describe("browser OpenAI credential API", () => {
  it("loads strict credential status through an authenticated no-store GET", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async () => Response.json(STATUS));
    const api = createBrowserOpenAiCredentialApi({
      accessToken: JWT,
      fetcher,
    });

    await expect(api.load(signal)).resolves.toEqual({
      ok: true,
      value: STATUS,
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/openai-credential",
      {
        method: "GET",
        headers: { authorization: `Bearer ${JWT}` },
        cache: "no-store",
        signal,
      },
    );
  });

  it("saves only an explicitly confirmed trimmed key and returns no raw credential", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(url).toBe("/api/openai-credential");
      expect(String(url)).not.toContain(OPENAI_API_KEY);
      expect(init).toEqual({
        method: "PUT",
        headers: {
          authorization: `Bearer ${JWT}`,
          "content-type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify({
          apiKey: OPENAI_API_KEY,
          confirmSave: true,
        }),
        signal: undefined,
      });
      return Response.json(STATUS);
    });
    const api = createBrowserOpenAiCredentialApi({ accessToken: JWT, fetcher });

    const result = await api.save({
      apiKey: `  ${OPENAI_API_KEY}  `,
      confirmSave: true,
    });

    expect(result).toEqual({ ok: true, value: STATUS });
    expect(JSON.stringify(result)).not.toContain(OPENAI_API_KEY);
  });

  it("clears the authenticated credential through DELETE without a request body", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async () => Response.json({ configured: false }));
    const api = createBrowserOpenAiCredentialApi({ accessToken: JWT, fetcher });

    await expect(api.clear(signal)).resolves.toEqual({
      ok: true,
      value: { configured: false },
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/openai-credential",
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${JWT}` },
        cache: "no-store",
        signal,
      },
    );
  });

  it.each([
    ["malformed", "bad token\r\ninjected: value"],
    ["oversized", `a.${"b".repeat(8_193)}.c`],
  ])("refuses %s authentication before fetch", async (_name, accessToken) => {
    const fetcher = vi.fn();
    const unauthenticated = createBrowserOpenAiCredentialApi({
      accessToken,
      fetcher,
    });
    await expect(unauthenticated.load()).resolves.toEqual({
      ok: false,
      error: {
        code: "authentication_unavailable",
        message: "OpenAI credential authentication is unavailable.",
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["too short", "sk-too-short", true],
    ["wrong prefix", `not-openai-${"a".repeat(40)}`, true],
    ["overlong", `sk-${"a".repeat(510)}`, true],
    ["unconfirmed", OPENAI_API_KEY, false],
  ])("refuses an %s save before fetch", async (_name, apiKey, confirmSave) => {
    const fetcher = vi.fn();
    const api = createBrowserOpenAiCredentialApi({ accessToken: JWT, fetcher });
    await expect(
      api.save({
        apiKey,
        confirmSave,
      } as unknown as { apiKey: string; confirmSave: true }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_request",
        message: "OpenAI credential request is invalid.",
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps cancellation and transport failures compact", async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelledFetcher = vi.fn();
    const cancelled = createBrowserOpenAiCredentialApi({
      accessToken: JWT,
      fetcher: cancelledFetcher,
    });
    await expect(cancelled.load(controller.signal)).resolves.toEqual({
      ok: false,
      error: {
        code: "request_cancelled",
        message: "OpenAI credential request was cancelled.",
      },
    });
    expect(cancelledFetcher).not.toHaveBeenCalled();

    const network = createBrowserOpenAiCredentialApi({
      accessToken: JWT,
      fetcher: async () => {
        throw new Error(`transport failed near ${OPENAI_API_KEY}`);
      },
    });
    const result = await network.load();
    expect(result).toEqual({
      ok: false,
      error: {
        code: "service_unavailable",
        message: "OpenAI credential service is temporarily unavailable.",
      },
    });
    expect(JSON.stringify(result)).not.toContain(OPENAI_API_KEY);
  });

  it("rejects malformed, oversized, and credential-leaking responses", async () => {
    const responses = [
      new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
      new Response(" ".repeat(1_000_001), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      Response.json({ ...STATUS, apiKey: OPENAI_API_KEY }),
      Response.json({
        ok: false,
        error: {
          code: "credential_unavailable",
          message: `Provider rejected ${OPENAI_API_KEY}`,
        },
      }, { status: 503 }),
    ];

    for (const response of responses) {
      const api = createBrowserOpenAiCredentialApi({
        accessToken: JWT,
        fetcher: vi.fn(async () => response),
      });
      const result = await api.load();
      expect(result).toEqual({
        ok: false,
        error: {
          code: "invalid_response",
          message: "OpenAI credential service returned an invalid response.",
          status: response.status,
        },
      });
      expect(JSON.stringify(result)).not.toContain(OPENAI_API_KEY);
    }
  });

  it("preserves a compact validated server error without private fields", async () => {
    const api = createBrowserOpenAiCredentialApi({
      accessToken: JWT,
      fetcher: vi.fn(async () =>
        Response.json(
          {
            ok: false,
            error: {
              code: "credential_unavailable",
              message: "OpenAI credential storage is temporarily unavailable.",
            },
          },
          { status: 503 },
        ),
      ),
    });

    await expect(api.load()).resolves.toEqual({
      ok: false,
      error: {
        code: "credential_unavailable",
        message: "OpenAI credential storage is temporarily unavailable.",
        status: 503,
      },
    });
  });
});
