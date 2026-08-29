import "server-only";

import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

import { z } from "zod";

import {
  createServerServiceClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";

const MAX_BODY_BYTES = 64 * 1_024;
const MAX_SIGNATURE_AGE_SECONDS = 5 * 60;

const headerSchema = z
  .object({
    id: z.string().min(1).max(256).regex(/^[\x21-\x7e]+$/),
    timestamp: z.string().min(1).max(20).regex(/^\d+$/),
    signature: z.string().min(1).max(4_096).regex(/^[\x20-\x7e]+$/),
  })
  .strict();

const verifiedEventSchema = z
  .object({
    type: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_.-]*$/),
    created_at: z.iso.datetime({ offset: true }),
    data: z
      .object({
        email_id: z.string().trim().min(1).max(256).optional(),
        id: z.string().trim().min(1).max(256).optional(),
      })
      .passthrough(),
  })
  .passthrough()
  .refine((event) => Boolean(event.data.email_id ?? event.data.id));

const deliveryStatusSchema = z.enum([
  "submitted",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "suppressed",
]);

const applyInputSchema = z
  .object({
    providerEventId: z.string().min(1).max(256),
    eventType: z.string().min(1).max(80),
    providerMessageId: z.string().min(1).max(256),
    occurredAt: z.iso.datetime({ offset: true }),
    payloadSha256: z.string().regex(/^[0-9a-f]{64}$/),
    deliveryStatus: deliveryStatusSchema.nullable(),
  })
  .strict();

const applyResultSchema = z
  .object({
    processingResult: z.enum([
      "applied",
      "duplicate",
      "stale",
      "unmatched",
      "ambiguous",
      "ignored",
    ]),
    target: z.enum(["invitation", "packet", "none"]),
    deliveryStatus: deliveryStatusSchema.nullable(),
    changed: z.boolean(),
  })
  .strict();

export type ResendDeliveryEventInput = z.infer<typeof applyInputSchema>;
export type ResendDeliveryEventResult = z.infer<typeof applyResultSchema>;

export interface ResendWebhookDependencies {
  verify: (
    payload: string,
    headers: z.infer<typeof headerSchema>,
    secret: string,
  ) => unknown;
  apply: (
    event: ResendDeliveryEventInput,
  ) => Promise<ResendDeliveryEventResult>;
}

interface ResendWebhookServiceClient {
  rpc: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
}

type WebhookEnvironment = Readonly<Record<string, string | undefined>>;

export function createServerResendWebhookDependencies(
  environment: WebhookEnvironment = process.env,
): { ok: true; dependencies: ResendWebhookDependencies } | { ok: false } {
  const config = readServerSupabaseConfig(environment);
  if (!config.ok) return { ok: false };
  try {
    const client = createServerServiceClient<ResendWebhookServiceClient>(
      config.config,
    );
    return {
      ok: true,
      dependencies: {
        verify: verifyStandardWebhook,
        apply: async (event) => {
          const parsed = applyInputSchema.parse(event);
          const response = await client.rpc("apply_resend_delivery_event", {
            p_provider_event_id: parsed.providerEventId,
            p_event_type: parsed.eventType,
            p_provider_message_id: parsed.providerMessageId,
            p_occurred_at: parsed.occurredAt,
            p_payload_sha256: parsed.payloadSha256,
            p_delivery_status: parsed.deliveryStatus,
          });
          if (response.error) throw new Error("resend event persistence failed");
          return applyResultSchema.parse(response.data);
        },
      },
    };
  } catch {
    return { ok: false };
  }
}

export async function handleResendWebhookRequest(
  request: Request,
  dependencies: ResendWebhookDependencies,
  environment: WebhookEnvironment = process.env,
) {
  const secret = environment.RESEND_WEBHOOK_SECRET?.trim() ?? "";
  if (secret === "" || secret.length > 1_024)
    return error(503, "webhook_unavailable");

  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_BODY_BYTES
  )
    return error(413, "request_too_large");

  const headers = headerSchema.safeParse({
    id: request.headers.get("svix-id") ?? "",
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signature: request.headers.get("svix-signature") ?? "",
  });
  if (!headers.success) return error(400, "invalid_signature");

  const body = await readBoundedBody(request, MAX_BODY_BYTES);
  if (!body.ok) return error(body.status, body.code);

  let verified: unknown;
  try {
    verified = dependencies.verify(body.value, headers.data, secret);
  } catch {
    return error(400, "invalid_signature");
  }

  const event = verifiedEventSchema.safeParse(verified);
  if (!event.success) return error(400, "invalid_event");
  const providerMessageId = event.data.data.email_id ?? event.data.data.id;
  if (!providerMessageId) return error(400, "invalid_event");

  const deliveryStatus = mapDeliveryStatus(event.data.type);
  const input: ResendDeliveryEventInput = {
    providerEventId: headers.data.id,
    eventType: event.data.type,
    providerMessageId,
    occurredAt: event.data.created_at,
    payloadSha256: createHash("sha256").update(body.value).digest("hex"),
    deliveryStatus,
  };

  try {
    const result = applyResultSchema.parse(await dependencies.apply(input));
    return json(200, { ok: true, ...result });
  } catch {
    return error(503, "webhook_persistence_failed");
  }
}

export function verifyStandardWebhook(
  payload: string,
  rawHeaders: z.infer<typeof headerSchema>,
  rawSecret: string,
  now: () => number = Date.now,
) {
  const headers = headerSchema.parse(rawHeaders);
  const timestamp = Number(headers.timestamp);
  const nowSeconds = Math.floor(now() / 1_000);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > MAX_SIGNATURE_AGE_SECONDS
  )
    throw new Error("stale webhook signature");

  const encodedSecret = rawSecret.startsWith("whsec_")
    ? rawSecret.slice("whsec_".length)
    : "";
  if (
    encodedSecret.length < 16 ||
    encodedSecret.length > 256 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedSecret)
  )
    throw new Error("invalid webhook secret");
  const secret = Buffer.from(encodedSecret, "base64");
  if (secret.byteLength < 16 || secret.byteLength > 128)
    throw new Error("invalid webhook secret");

  const expected = createHmac("sha256", secret)
    .update(`${headers.id}.${headers.timestamp}.${payload}`)
    .digest();
  const candidates = headers.signature.split(/\s+/).slice(0, 8);
  const accepted = candidates.some((candidate) => {
    const separator = candidate.indexOf(",");
    if (separator < 1 || candidate.slice(0, separator) !== "v1") return false;
    try {
      const presented = Buffer.from(candidate.slice(separator + 1), "base64");
      return (
        presented.byteLength === expected.byteLength &&
        timingSafeEqual(presented, expected)
      );
    } catch {
      return false;
    }
  });
  if (!accepted) throw new Error("invalid webhook signature");
  return JSON.parse(payload) as unknown;
}

function mapDeliveryStatus(type: string) {
  switch (type) {
    case "email.sent":
      return "submitted" as const;
    case "email.delivered":
      return "delivered" as const;
    case "email.bounced":
      return "bounced" as const;
    case "email.complained":
      return "complained" as const;
    case "email.failed":
      return "failed" as const;
    case "email.suppressed":
      return "suppressed" as const;
    default:
      return null;
  }
}

async function readBoundedBody(
  request: Request,
  limit: number,
): Promise<
  | { ok: true; value: string }
  | { ok: false; status: 400 | 413; code: string }
> {
  if (!request.body) return { ok: false, status: 400, code: "invalid_event" };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      length += next.value.byteLength;
      if (length > limit) {
        await reader.cancel();
        return { ok: false, status: 413, code: "request_too_large" };
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return {
      ok: true,
      value: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch {
    return { ok: false, status: 400, code: "invalid_event" };
  }
}

function error(status: number, code: string) {
  return json(status, { ok: false, error: { code } });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
    },
  });
}
