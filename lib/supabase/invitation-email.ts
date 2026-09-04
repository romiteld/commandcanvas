import "server-only";

import { z } from "zod";

import {
  invitationTokenSchema,
  normalizedEmailSchema,
} from "@/lib/supabase/meeting-contracts";

const inputSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(256).regex(/^[\x21-\x7e]+$/),
    recipientEmail: normalizedEmailSchema,
    recipientName: z.string().trim().min(1).max(64),
    roomName: z.string().trim().min(1).max(120).regex(/^[^\r\n]+$/),
    joinUrl: z.url().refine(isSafeInvitationJoinUrl),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

function isSafeInvitationJoinUrl(value: string) {
  try {
    const url = new URL(value);
    const fragment = new URLSearchParams(url.hash.slice(1));
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/meet" &&
      !url.search &&
      fragment.size === 1 &&
      invitationTokenSchema.safeParse(fragment.get("invite")).success
    );
  } catch {
    return false;
  }
}

export type InvitationEmailInput = z.input<typeof inputSchema>;

export interface InvitationEmailEnvironment {
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
}

export type InvitationDeliveryResult =
  | { status: "preview_only"; message: string }
  | { status: "submitted"; message: string; providerId: string }
  | {
      status: "reconciling";
      message: string;
      errorCode: "resend_ambiguous";
    }
  | { status: "failed"; message: string };

export async function deliverMeetingInvitation(
  rawInput: InvitationEmailInput,
  environment: InvitationEmailEnvironment = process.env as InvitationEmailEnvironment,
  fetcher: typeof fetch = fetch,
): Promise<InvitationDeliveryResult> {
  const input = inputSchema.safeParse(rawInput);
  if (!input.success)
    return {
      status: "failed",
      message: "Invite created, but its email preview could not be prepared.",
    };

  const key = environment.RESEND_API_KEY?.trim() ?? "";
  const from = environment.RESEND_FROM?.trim() ?? "";
  if (!key || !from || /[\r\n]/.test(from))
    return {
      status: "preview_only",
      message:
        "Invite created. Email delivery is not configured; copy the link instead.",
    };
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        "idempotency-key": input.data.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [input.data.recipientEmail],
        subject: `Join ${input.data.roomName} in CommandCanvas`,
        html: invitationHtml(input.data),
        text: invitationText(input.data),
      }),
    });
    if (!response.ok)
      return response.status === 429 || response.status >= 500 || response.status === 409
        ? deliveryReconciling()
        : deliveryFailed();
    const parsed = z
      .object({ id: z.string().trim().min(1).max(256) })
      .passthrough()
      .safeParse(await response.json());
    if (!parsed.success) return deliveryReconciling();
    return {
      status: "submitted",
      message: "Invitation accepted by the email provider.",
      providerId: parsed.data.id,
    };
  } catch {
    return deliveryReconciling();
  }
}

function invitationHtml(input: z.output<typeof inputSchema>) {
  const name = escapeHtml(input.recipientName);
  const room = escapeHtml(input.roomName);
  const url = escapeHtml(input.joinUrl);
  const expires = escapeHtml(new Date(input.expiresAt).toUTCString());
  return `<main><h1>Join ${room}</h1><p>Hi ${name}, you were invited to a CommandCanvas meeting.</p><p><a href="${url}">Verify your email and join the room</a></p><p>This invitation expires ${expires}.</p></main>`;
}

function invitationText(input: z.output<typeof inputSchema>) {
  return `Hi ${input.recipientName},

You were invited to the ${input.roomName} CommandCanvas meeting.

Verify your email and join the room:
${input.joinUrl}

This invitation expires ${new Date(input.expiresAt).toUTCString()}.`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return entities[character]!;
  });
}

function deliveryFailed(): InvitationDeliveryResult {
  return {
    status: "failed",
    message: "Invite created, but email delivery failed. Copy the link instead.",
  };
}

function deliveryReconciling(): InvitationDeliveryResult {
  return {
    status: "reconciling",
    message:
      "Invitation submission is being reconciled; copy the link if needed.",
    errorCode: "resend_ambiguous",
  };
}
