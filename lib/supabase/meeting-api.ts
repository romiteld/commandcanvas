import { z } from "zod";

import {
  acceptMeetingInvitationRequestSchema,
  createMeetingInvitationRequestSchema,
  createMeetingRequestSchema,
  type AcceptMeetingInvitationRequest,
  type CreateMeetingInvitationRequest,
  type CreateMeetingInvitationDraft,
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
            status: z.enum([
              "preview_only",
              "reconciling",
              "submitted",
              "delivered",
              "bounced",
              "complained",
              "failed",
              "suppressed",
            ]),
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
    status:
      | "preview_only"
      | "reconciling"
      | "submitted"
      | "delivered"
      | "bounced"
      | "complained"
      | "failed"
      | "suppressed";
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
    input: CreateMeetingInvitationDraft,
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
  createRequestId?: () => string;
  invitationRequestStorage?: Pick<
    Storage,
    "getItem" | "setItem" | "removeItem"
  > | null;
}): BrowserMeetingApi {
  const bearer = parseBearerJwtHeader(`Bearer ${options.accessToken}`);
  const fetcher = options.fetcher ?? fetch;
  const createRequestId =
    options.createRequestId ?? (() => globalThis.crypto.randomUUID());
  const invitationRequestStorage =
    options.invitationRequestStorage === undefined
      ? browserSessionStorage()
      : options.invitationRequestStorage;
  const pendingInvitationIds = new Map<string, string>();
  const invitationDraftSchema = createMeetingInvitationRequestSchema.omit({
    requestId: true,
  });

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
    createInvitation: async (
      roomId: string,
      input: CreateMeetingInvitationDraft,
      signal?: AbortSignal,
    ) => {
      const parsed = invitationDraftSchema.safeParse(input);
      if (!z.uuid().safeParse(roomId).success || !parsed.success)
        return invalidInput();
      const inMemoryKey = JSON.stringify([roomId, parsed.data]);
      const storageKey = await invitationStorageKey(inMemoryKey);
      let requestId =
        pendingInvitationIds.get(inMemoryKey) ??
        readPersistedRequestId(invitationRequestStorage, storageKey);
      if (!requestId) {
        const candidate = createRequestId();
        if (!z.uuid().safeParse(candidate).success) return invalidInput();
        requestId = candidate;
      }
      pendingInvitationIds.set(inMemoryKey, requestId);
      persistRequestId(invitationRequestStorage, storageKey, requestId);
      const requestInput: CreateMeetingInvitationRequest = {
        requestId,
        ...parsed.data,
      };
      const result = await call(
        `/api/meetings/${roomId}/invitations`,
        requestInput,
        createMeetingInvitationRequestSchema,
        invitationResponseSchema,
        (envelope) => envelope.invitation,
        signal,
      );
      if (result.ok && result.value.delivery.status !== "reconciling") {
        pendingInvitationIds.delete(inMemoryKey);
        removePersistedRequestId(invitationRequestStorage, storageKey);
      }
      return result;
    },
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

const INVITATION_REQUEST_STORAGE_PREFIX =
  "commandcanvas:invitation-request:v1:";

function browserSessionStorage(): Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
> | null {
  try {
    return typeof globalThis.sessionStorage === "undefined"
      ? null
      : globalThis.sessionStorage;
  } catch {
    return null;
  }
}

async function invitationStorageKey(identity: string) {
  try {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(identity),
    );
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `${INVITATION_REQUEST_STORAGE_PREFIX}${hex}`;
  } catch {
    return null;
  }
}

function readPersistedRequestId(
  storage: Pick<Storage, "getItem"> | null,
  key: string | null,
) {
  if (!storage || !key) return undefined;
  try {
    const requestId = storage.getItem(key);
    return requestId && z.uuid().safeParse(requestId).success
      ? requestId
      : undefined;
  } catch {
    return undefined;
  }
}

function persistRequestId(
  storage: Pick<Storage, "setItem"> | null,
  key: string | null,
  requestId: string,
) {
  if (!storage || !key) return;
  try {
    storage.setItem(key, requestId);
  } catch {
    // Session storage can be disabled; same-page in-memory idempotency remains.
  }
}

function removePersistedRequestId(
  storage: Pick<Storage, "removeItem"> | null,
  key: string | null,
) {
  if (!storage || !key) return;
  try {
    storage.removeItem(key);
  } catch {
    // A failed cleanup must not turn a completed invitation into a user error.
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
