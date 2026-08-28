import "server-only";

import { z } from "zod";

import {
  invitationTokenSchema,
  normalizedEmailSchema,
} from "@/lib/supabase/meeting-contracts";

const inputSchema = z
  .object({
    recipientEmail: normalizedEmailSchema,
    recipientName: z.string().trim().min(1).max(64),
    roomName: z.string().trim().min(1).max(120),
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
  COMMANDCANVAS_INVITE_EMAIL_ALLOWLIST?: string;
}

export type InvitationDeliveryResult =
  | { status: "preview_only"; message: string }
  | { status: "submitted"; message: string; providerId: string }
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
  const allowlist = parseAllowlist(
    environment.COMMANDCANVAS_INVITE_EMAIL_ALLOWLIST,
  );
  if (!key || !from || allowlist.size === 0)
    return {
      status: "preview_only",
      message:
        "Invite created. Email delivery is not configured; copy the link instead.",
    };
  if (!allowlist.has(input.data.recipientEmail))
    return {
      status: "preview_only",
      message:
        "Invite created. This recipient is not allowlisted; copy the link instead.",
    };

  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [input.data.recipientEmail],
        subject: `Join ${input.data.roomName} in CommandCanvas`,
        html: invitationHtml(input.data),
      }),
    });
    if (!response.ok) return deliveryFailed();
    const parsed = z
      .object({ id: z.string().trim().min(1).max(256) })
      .passthrough()
      .safeParse(await response.json());
    if (!parsed.success) return deliveryFailed();
    return {
      status: "submitted",
      message: "Invitation accepted by the email provider.",
      providerId: parsed.data.id,
    };
  } catch {
    return deliveryFailed();
  }
}

function parseAllowlist(raw: string | undefined) {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((candidate) => normalizedEmailSchema.safeParse(candidate))
      .filter((candidate) => candidate.success)
      .map((candidate) => candidate.data),
  );
}

function invitationHtml(input: z.output<typeof inputSchema>) {
  const name = escapeHtml(input.recipientName);
  const room = escapeHtml(input.roomName);
  const url = escapeHtml(input.joinUrl);
  const expires = escapeHtml(new Date(input.expiresAt).toUTCString());
  return `<main><h1>Join ${room}</h1><p>Hi ${name}, you were invited to a CommandCanvas meeting.</p><p><a href="${url}">Verify your email and join the room</a></p><p>This invitation expires ${expires}.</p></main>`;
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
