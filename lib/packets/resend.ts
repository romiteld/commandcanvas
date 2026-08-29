import "server-only";

import { z } from "zod";

import type {
  PacketContentSnapshot,
  PacketRecipient,
} from "@/lib/packets/contracts";
import {
  createPacketPresentation,
  renderPacketPresentationHtml,
  renderPacketPresentationText,
} from "@/lib/packets/presentation";

export type ResendPacketErrorCode =
  | "resend_ambiguous"
  | "resend_rejected"
  | "resend_unavailable"
  | "resend_invalid_response";

export interface ResendPacketEmailInput {
  apiKey: string;
  from: string;
  recipients: PacketRecipient[];
  subject: string;
  contentSnapshot: PacketContentSnapshot;
  idempotencyKey: string;
  signal?: AbortSignal;
}

export type ResendPacketEmailResult =
  | { ok: true; providerMessageId: string }
  | {
      ok: false;
      errorCode: "resend_ambiguous";
      reconciling: true;
    }
  | { ok: false; errorCode: ResendPacketErrorCode };

export type ResendFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const resendAcceptedSchema = z
  .object({ id: z.string().trim().min(1).max(240) })
  .passthrough();

export async function submitResendPacketEmail(
  input: ResendPacketEmailInput,
  fetcher: ResendFetch = fetch,
): Promise<ResendPacketEmailResult> {
  const rendered = renderApprovedPacket(input.contentSnapshot);

  let response: Response;
  try {
    response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: input.from,
        to: input.recipients.map(formatRecipient),
        subject: input.subject,
        html: rendered.html,
        text: rendered.text,
      }),
      signal: input.signal,
    });
  } catch {
    return ambiguousResult();
  }

  if (!response.ok)
    return response.status === 409 || response.status === 429 || response.status >= 500
      ? ambiguousResult()
      : { ok: false, errorCode: "resend_rejected" };

  try {
    const parsed = resendAcceptedSchema.safeParse(await response.json());
    if (!parsed.success) return ambiguousResult();
    return { ok: true, providerMessageId: parsed.data.id };
  } catch {
    return ambiguousResult();
  }
}

function ambiguousResult(): ResendPacketEmailResult {
  return {
    ok: false,
    errorCode: "resend_ambiguous",
    reconciling: true,
  };
}

function formatRecipient(recipient: PacketRecipient) {
  return `${recipient.name} <${recipient.email}>`;
}

function renderApprovedPacket(snapshot: PacketContentSnapshot) {
  const presentation = createPacketPresentation(snapshot);
  return {
    text: renderPacketPresentationText(presentation),
    html: renderPacketPresentationHtml(presentation),
  };
}
