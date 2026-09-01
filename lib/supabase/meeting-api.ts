import { z } from "zod";

import {
  acceptMeetingInvitationRequestSchema,
  createMeetingInvitationRequestSchema,
  createMeetingRequestSchema,
  createMeetingDraftSchema,
  type AcceptMeetingInvitationRequest,
  type CreateMeetingInvitationRequest,
  type CreateMeetingInvitationDraft,
  type CreateMeetingDraft,
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
              "created",
              "sending",
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
      | "created"
      | "sending"
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

export interface BrowserMeetingInvitationDeliveryValue {
  invitationId: string;
  roomId: string;
  delivery: BrowserMeetingInvitationValue["delivery"];
}

export interface BrowserMeetingApi {
  createMeeting: (
    input: CreateMeetingDraft,
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
  loadInvitationDelivery: (
    roomId: string,
    invitationId: string,
    signal?: AbortSignal,
  ) => Promise<
    BrowserMeetingApiResult<BrowserMeetingInvitationDeliveryValue>
  >;
}

export function createBrowserMeetingApi(options: {
  accessToken: string;
  actorUserId?: string;
  fetcher?: typeof fetch;
  createRequestId?: () => string;
  invitationRequestStorage?: Pick<
    Storage,
    "getItem" | "setItem" | "removeItem"
  > | null;
  meetingRequestStorage?: Pick<
    Storage,
    "getItem" | "setItem" | "removeItem"
  > | null;
}): BrowserMeetingApi {
  const bearer = parseBearerJwtHeader(`Bearer ${options.accessToken}`);
  const actorUserId = z.uuid().safeParse(options.actorUserId).success
    ? options.actorUserId!
    : null;
  const fetcher = options.fetcher ?? fetch;
  const createRequestId =
    options.createRequestId ?? (() => globalThis.crypto.randomUUID());
  const invitationRequestStorage =
    options.invitationRequestStorage === undefined
      ? browserSessionStorage()
      : options.invitationRequestStorage;
  const pendingInvitationIds = new Map<string, string>();
  const pendingMeetingIds = new Map<string, string>();
  const invitationDraftSchema = createMeetingInvitationRequestSchema.omit({
    requestId: true,
  });
  const meetingRequestStorage =
    options.meetingRequestStorage === undefined
      ? browserSessionStorage()
      : options.meetingRequestStorage;
  const meetingDeliveryResponseSchema = z
    .object({
      ok: z.literal(true),
      invitation: z
        .object({
          invitationId: z.uuid(),
          roomId: z.uuid(),
          delivery: invitationResponseSchema.shape.invitation.shape.delivery,
        })
        .strict(),
    })
    .strict();

  return {
    createMeeting: async (rawInput: CreateMeetingDraft, signal?: AbortSignal) => {
      const input = createMeetingDraftSchema.safeParse(rawInput);
      if (!input.success) return invalidInput();
      const identity = JSON.stringify([actorUserId, input.data]);
      const storageKeys = await actorScopedRequestStorageKeys(
        MEETING_REQUEST_STORAGE_PREFIX,
        actorUserId,
        identity,
      );
      let requestId =
        pendingMeetingIds.get(identity) ??
        readPersistedRequestId(meetingRequestStorage, storageKeys.requestKey);
      if (!requestId) {
        const candidate = createRequestId();
        if (!z.uuid().safeParse(candidate).success) return invalidInput();
        requestId = candidate;
      }
      pendingMeetingIds.set(identity, requestId);
      persistRequestId(
        meetingRequestStorage,
        storageKeys.requestKey,
        requestId,
        storageKeys.manifestKey,
      );
      const result = await call(
        "/api/meetings",
        { requestId, ...input.data },
        createMeetingRequestSchema,
        meetingResponseSchema,
        (envelope) => envelope.meeting,
        signal,
      );
      if (result.ok) {
        pendingMeetingIds.delete(identity);
        removePersistedRequestId(
          meetingRequestStorage,
          storageKeys.requestKey,
          storageKeys.manifestKey,
        );
      }
      return result;
    },
    createInvitation: async (
      roomId: string,
      input: CreateMeetingInvitationDraft,
      signal?: AbortSignal,
    ) => {
      const parsed = invitationDraftSchema.safeParse(input);
      if (!z.uuid().safeParse(roomId).success || !parsed.success)
        return invalidInput();
      const inMemoryKey = JSON.stringify([actorUserId, roomId, parsed.data]);
      const storageKeys = await actorScopedRequestStorageKeys(
        INVITATION_REQUEST_STORAGE_PREFIX,
        actorUserId,
        inMemoryKey,
      );
      let requestId =
        pendingInvitationIds.get(inMemoryKey) ??
        readPersistedRequestId(
          invitationRequestStorage,
          storageKeys.requestKey,
        );
      if (!requestId) {
        const candidate = createRequestId();
        if (!z.uuid().safeParse(candidate).success) return invalidInput();
        requestId = candidate;
      }
      pendingInvitationIds.set(inMemoryKey, requestId);
      persistRequestId(
        invitationRequestStorage,
        storageKeys.requestKey,
        requestId,
        storageKeys.manifestKey,
      );
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
        removePersistedRequestId(
          invitationRequestStorage,
          storageKeys.requestKey,
          storageKeys.manifestKey,
        );
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
    loadInvitationDelivery: (roomId, invitationId, signal) => {
      if (
        !z.uuid().safeParse(roomId).success ||
        !z.uuid().safeParse(invitationId).success ||
        !bearer.ok
      )
        return invalidInput();
      return get(
        `/api/meetings/${roomId}/invitations?invitationId=${invitationId}`,
        meetingDeliveryResponseSchema,
        (envelope) => envelope.invitation,
        signal,
      );
    },
  };

  async function get<Envelope, Value>(
    path: string,
    outputSchema: z.ZodType<Envelope>,
    selectValue: (envelope: Envelope) => Value,
    signal?: AbortSignal,
  ): Promise<BrowserMeetingApiResult<Value>> {
    if (!bearer.ok) return invalidInput();
    try {
      const response = await fetcher(path, {
        method: "GET",
        headers: { authorization: `Bearer ${bearer.token}` },
        cache: "no-store",
        signal,
      });
      const raw: unknown = await response.json();
      if (!response.ok) return parseFailure(raw, response.status);
      const parsed = outputSchema.safeParse(raw);
      return parsed.success
        ? { ok: true, value: selectValue(parsed.data) }
        : invalidResponse();
    } catch {
      return requestFailed();
    }
  }

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
      return requestFailed();
    }
  }
}

const INVITATION_REQUEST_STORAGE_PREFIX =
  "commandcanvas:invitation-request:v2:";
const MEETING_REQUEST_STORAGE_PREFIX = "commandcanvas:meeting-request:v2:";
const MAX_ACTOR_REQUEST_KEYS = 64;

export async function clearBrowserMeetingRequestState(options: {
  actorUserId: string;
  invitationRequestStorage?: Pick<
    Storage,
    "getItem" | "setItem" | "removeItem"
  > | null;
  meetingRequestStorage?: Pick<
    Storage,
    "getItem" | "setItem" | "removeItem"
  > | null;
}) {
  if (!z.uuid().safeParse(options.actorUserId).success) return;
  const invitationStorage =
    options.invitationRequestStorage === undefined
      ? browserSessionStorage()
      : options.invitationRequestStorage;
  const meetingStorage =
    options.meetingRequestStorage === undefined
      ? browserSessionStorage()
      : options.meetingRequestStorage;
  const [invitationKeys, meetingKeys] = await Promise.all([
    actorScopedRequestStorageKeys(
      INVITATION_REQUEST_STORAGE_PREFIX,
      options.actorUserId,
      "",
    ),
    actorScopedRequestStorageKeys(
      MEETING_REQUEST_STORAGE_PREFIX,
      options.actorUserId,
      "",
    ),
  ]);
  clearPersistedActorRequests(invitationStorage, invitationKeys.manifestKey);
  clearPersistedActorRequests(meetingStorage, meetingKeys.manifestKey);
}

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

async function requestStorageKey(prefix: string, identity: string) {
  try {
    const digest = await globalThis.crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(identity),
    );
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return `${prefix}${hex}`;
  } catch {
    return null;
  }
}

async function actorScopedRequestStorageKeys(
  prefix: string,
  actorUserId: string | null,
  identity: string,
) {
  if (!actorUserId)
    return { requestKey: null, manifestKey: null } as const;
  const [requestKey, manifestKey] = await Promise.all([
    requestStorageKey(prefix, JSON.stringify([actorUserId, identity])),
    requestStorageKey(`${prefix}actor:`, actorUserId),
  ]);
  return { requestKey, manifestKey } as const;
}

function parseFailure(raw: unknown, status: number): BrowserMeetingApiResult<never> {
  const parsed = z
    .object({
      ok: z.literal(false),
      error: z.object({ code: z.string(), message: z.string() }).strict(),
    })
    .strict()
    .safeParse(raw);
  return parsed.success
    ? { ok: false, error: { ...parsed.data.error, status } }
    : invalidResponse();
}

function requestFailed(): BrowserMeetingApiResult<never> {
  return {
    ok: false,
    error: { code: "request_failed", message: "Meeting request failed." },
  };
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
  storage: Pick<Storage, "getItem" | "setItem"> | null,
  key: string | null,
  requestId: string,
  manifestKey: string | null,
) {
  if (!storage || !key || !manifestKey) return;
  try {
    const actorKeys = readActorRequestManifest(storage, manifestKey);
    const nextKeys = [...actorKeys.filter((candidate) => candidate !== key), key]
      .slice(-MAX_ACTOR_REQUEST_KEYS);
    storage.setItem(manifestKey, JSON.stringify(nextKeys));
    storage.setItem(key, requestId);
  } catch {
    // Session storage can be disabled; same-page in-memory idempotency remains.
  }
}

function removePersistedRequestId(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  key: string | null,
  manifestKey: string | null,
) {
  if (!storage || !key || !manifestKey) return;
  try {
    storage.removeItem(key);
    const remaining = readActorRequestManifest(storage, manifestKey).filter(
      (candidate) => candidate !== key,
    );
    if (remaining.length > 0)
      storage.setItem(manifestKey, JSON.stringify(remaining));
    else storage.removeItem(manifestKey);
  } catch {
    // A failed cleanup must not turn a completed invitation into a user error.
  }
}

function readActorRequestManifest(
  storage: Pick<Storage, "getItem">,
  manifestKey: string,
) {
  try {
    const value: unknown = JSON.parse(storage.getItem(manifestKey) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (candidate): candidate is string =>
          typeof candidate === "string" &&
          candidate.startsWith("commandcanvas:") &&
          candidate.length <= 160,
      )
      .slice(-MAX_ACTOR_REQUEST_KEYS);
  } catch {
    return [];
  }
}

function clearPersistedActorRequests(
  storage: Pick<Storage, "getItem" | "removeItem"> | null,
  manifestKey: string | null,
) {
  if (!storage || !manifestKey) return;
  try {
    for (const key of readActorRequestManifest(storage, manifestKey))
      storage.removeItem(key);
    storage.removeItem(manifestKey);
  } catch {
    // Browser storage is best-effort; actor scoping still prevents replay.
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
