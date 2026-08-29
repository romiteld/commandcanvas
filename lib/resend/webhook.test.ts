// @vitest-environment node

import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  handleResendWebhookRequest,
  verifyStandardWebhook,
  type ResendWebhookDependencies,
} from "@/lib/resend/webhook";

const EVENT_ID = "msg_01J123456789ABCDEFGHJKMNPQ";
const EMAIL_ID = "56761188-7520-42d8-8898-ff6fc54ce618";
const payload = JSON.stringify({
  type: "email.delivered",
  created_at: "2026-08-29T12:00:00.000Z",
  data: { email_id: EMAIL_ID },
});

function request(body = payload, headers: Record<string, string> = {}) {
  return new Request("https://commandcanvas.test/api/webhooks/resend", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "svix-id": EVENT_ID,
      "svix-timestamp": "1788004800",
      "svix-signature": "v1,signature",
      ...headers,
    },
    body,
  });
}

function dependencies(input?: {
  verify?: ResendWebhookDependencies["verify"];
  apply?: ResendWebhookDependencies["apply"];
}) {
  return {
    verify:
      input?.verify ??
      vi.fn(() => ({
        type: "email.delivered",
        created_at: "2026-08-29T12:00:00.000Z",
        data: { email_id: EMAIL_ID },
      })),
    apply:
      input?.apply ??
      vi.fn(async () => ({
        processingResult: "applied" as const,
        target: "packet" as const,
        deliveryStatus: "delivered" as const,
        changed: true,
      })),
  } satisfies ResendWebhookDependencies;
}

describe("signed Resend webhook boundary", () => {
  it("fails closed without a server signing secret and writes nothing", async () => {
    const deps = dependencies();
    const response = await handleResendWebhookRequest(request(), deps, {});
    expect(response.status).toBe(503);
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it("rejects missing or invalid signatures before database work", async () => {
    const missing = dependencies();
    const missingResponse = await handleResendWebhookRequest(
      request(payload, { "svix-signature": "" }),
      missing,
      { RESEND_WEBHOOK_SECRET: "whsec_test" },
    );
    expect(missingResponse.status).toBe(400);
    expect(missing.apply).not.toHaveBeenCalled();

    const invalid = dependencies({
      verify: vi.fn(() => {
        throw new Error("invalid or stale signature");
      }),
    });
    const invalidResponse = await handleResendWebhookRequest(
      request(),
      invalid,
      { RESEND_WEBHOOK_SECRET: "whsec_test" },
    );
    expect(invalidResponse.status).toBe(400);
    expect(invalid.apply).not.toHaveBeenCalled();
  });

  it("rejects a body above 64 KiB before signature or provider work", async () => {
    const deps = dependencies();
    const response = await handleResendWebhookRequest(
      request("x".repeat(64 * 1024 + 1)),
      deps,
      { RESEND_WEBHOOK_SECRET: "whsec_test" },
    );
    expect(response.status).toBe(413);
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.apply).not.toHaveBeenCalled();
  });

  it("applies a verified bounded event using only its digest and provider identifiers", async () => {
    const deps = dependencies();
    const response = await handleResendWebhookRequest(request(), deps, {
      RESEND_WEBHOOK_SECRET: "whsec_test",
    });
    expect(response.status).toBe(200);
    expect(deps.verify).toHaveBeenCalledWith(
      payload,
      {
        id: EVENT_ID,
        timestamp: "1788004800",
        signature: "v1,signature",
      },
      "whsec_test",
    );
    expect(deps.apply).toHaveBeenCalledExactlyOnceWith({
      providerEventId: EVENT_ID,
      eventType: "email.delivered",
      providerMessageId: EMAIL_ID,
      occurredAt: "2026-08-29T12:00:00.000Z",
      payloadSha256:
        "af82d856563c2607547d3156acfcddf8732e01d3a35e26c5e10a47ad677145e9",
      deliveryStatus: "delivered",
    });
    expect(JSON.stringify(vi.mocked(deps.apply).mock.calls)).not.toContain(
      "recipient",
    );
  });

  it("verifies the raw Standard Webhooks message and rejects stale timestamps", () => {
    const secretBytes = Buffer.alloc(32, 7);
    const secret = `whsec_${secretBytes.toString("base64")}`;
    const timestamp = "1788004800";
    const signature = createHmac("sha256", secretBytes)
      .update(`${EVENT_ID}.${timestamp}.${payload}`)
      .digest("base64");
    expect(
      verifyStandardWebhook(
        payload,
        { id: EVENT_ID, timestamp, signature: `v1,${signature}` },
        secret,
        () => 1_788_004_800_000,
      ),
    ).toMatchObject({ type: "email.delivered" });
    expect(() =>
      verifyStandardWebhook(
        payload,
        { id: EVENT_ID, timestamp, signature: `v1,${signature}` },
        secret,
        () => 1_788_005_101_000,
      ),
    ).toThrow();
  });

  it("returns idempotent success for a verified duplicate event", async () => {
    const deps = dependencies({
      apply: vi.fn(async () => ({
        processingResult: "duplicate" as const,
        target: "packet" as const,
        deliveryStatus: "delivered" as const,
        changed: false,
      })),
    });
    const response = await handleResendWebhookRequest(request(), deps, {
      RESEND_WEBHOOK_SECRET: "whsec_test",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      processingResult: "duplicate",
    });
  });

  it("records a signed unknown email event as ignored without changing delivery truth", async () => {
    const deps = dependencies({
      verify: vi.fn(() => ({
        type: "email.opened",
        created_at: "2026-08-29T12:00:00.000Z",
        data: { email_id: EMAIL_ID },
      })),
      apply: vi.fn(async () => ({
        processingResult: "ignored" as const,
        target: "none" as const,
        deliveryStatus: null,
        changed: false,
      })),
    });
    const response = await handleResendWebhookRequest(request(), deps, {
      RESEND_WEBHOOK_SECRET: "whsec_test",
    });
    expect(response.status).toBe(200);
    expect(deps.apply).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "email.opened",
        deliveryStatus: null,
      }),
    );
  });
});
