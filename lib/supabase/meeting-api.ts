import { z } from "zod";

import {
  acceptMeetingInvitationRequestSchema,
  createMeetingInvitationRequestSchema,
  createMeetingRequestSchema,
  type AcceptMeetingInvitationRequest,
  type CreateMeetingInvitationRequest,
  type CreateMeetingRequest,
} from "@/lib/supabase/meeting-contracts";
import { parseBearerJwtHeader } from "@/lib/supabase/server-auth";

const meetingResponseSchema = z
  .object({
    ok: z.literal(true),
    meeting: z
      .object({
        roomId: z.uuid(),
        role: z.enum(["host", "participant"]),
        joined: z.boolean(),
      })
      .strict(),
  })
  .strict();
const invitationResponseSchema = z
  .object({
    ok: z.literal(true),
    invitation: z
      .object({
        invitationId: z.uuid(),
        roomId: z.uuid(),
        expiresAt: z.iso.datetime({ offset: true }),
        joinUrl: z
          .url()
          .refine((value) => value.startsWith("https://") && value.includes("#invite=")),
        delivery: z
          .object({
            status: z.enum(["preview_only", "submitted", "failed"]),
            message: z.string().trim().min(1).max(300),
            providerId: z.string().trim().min(1).max(256).optional(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type BrowserMeetingApiResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string; status?: number } };

export interface BrowserMeetingValue {
  roomId: string;
  role: "host" | "participant";
  joined: boolean;
}

export interface BrowserMeetingInvitationValue {
  invitationId: string;
  roomId: string;
  expiresAt: string;
  joinUrl: string;
  delivery: {
    status: "preview_only" | "submitted" | "failed";
    message: string;
    providerId?: string;
  };
}

export interface BrowserMeetingApi {
  createMeeting: (
    input: CreateMeetingRequest,
    signal?: AbortSignal,
  ) => Promise<BrowserMeetingApiResult<BrowserMeetingValue>>;
  createInvitation: (
    roomId: string,
    input: CreateMeetingInvitationRequest,
    signal?: AbortSignal,
  ) => Promise<BrowserMeetingApiResult<BrowserMeetingInvitationValue>>;
  acceptInvitation: (
    input: AcceptMeetingInvitationRequest,
    signal?: AbortSignal,
  ) => Promise<BrowserMeetingApiResult<BrowserMeetingValue>>;
}

export function createBrowserMeetingApi(options: {
  accessToken: string;
  fetcher?: typeof fetch;
}): BrowserMeetingApi {
  const bearer = parseBearerJwtHeader(`Bearer ${options.accessToken}`);
  const fetcher = options.fetcher ?? fetch;

  return {
    createMeeting: (input: CreateMeetingRequest, signal?: AbortSignal) =>
      call(
        "/api/meetings",
        input,
        createMeetingRequestSchema,
        meetingResponseSchema,
        (envelope) => envelope.meeting,
        signal,
      ),
    createInvitation: (
      roomId: string,
      input: CreateMeetingInvitationRequest,
      signal?: AbortSignal,
    ) =>
      z.uuid().safeParse(roomId).success
        ? call(
            `/api/meetings/${roomId}/invitations`,
            input,
            createMeetingInvitationRequestSchema,
            invitationResponseSchema,
            (envelope) => envelope.invitation,
            signal,
          )
        : invalidInput(),
    acceptInvitation: (
      input: AcceptMeetingInvitationRequest,
      signal?: AbortSignal,
    ) =>
      call(
        "/api/meeting-invitations/accept",
        input,
        acceptMeetingInvitationRequestSchema,
        meetingResponseSchema,
        (envelope) => envelope.meeting,
        signal,
      ),
  };

  async function call<Input, Envelope, Value>(
    path: string,
    input: Input,
    inputSchema: z.ZodType<Input>,
    outputSchema: z.ZodType<Envelope>,
    selectValue: (envelope: Envelope) => Value,
    signal?: AbortSignal,
  ): Promise<BrowserMeetingApiResult<Value>> {
    if (!bearer.ok) return invalidInput();
    const parsedInput = inputSchema.safeParse(input);
    if (!parsedInput.success) return invalidInput();
    try {
      const response = await fetcher(path, {
        method: "POST",
        headers: {
          authorization: `Bearer ${bearer.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(parsedInput.data),
        signal,
      });
      const raw: unknown = await response.json();
      if (!response.ok) {
        const parsedError = z
          .object({
            ok: z.literal(false),
            error: z.object({ code: z.string(), message: z.string() }).strict(),
          })
          .strict()
          .safeParse(raw);
        return parsedError.success
          ? {
              ok: false,
              error: { ...parsedError.data.error, status: response.status },
            }
          : invalidResponse();
      }
      const parsed = outputSchema.safeParse(raw);
      if (!parsed.success) return invalidResponse();
      return { ok: true, value: selectValue(parsed.data) };
    } catch {
      return {
        ok: false,
        error: { code: "request_failed", message: "Meeting request failed." },
      };
    }
  }
}

function invalidInput() {
  return Promise.resolve({
    ok: false as const,
    error: { code: "invalid_request", message: "Request is invalid." },
  });
}

function invalidResponse() {
  return {
    ok: false as const,
    error: {
      code: "invalid_response",
      message: "Meeting response could not be verified.",
    },
  };
}
