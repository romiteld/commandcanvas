import "server-only";

import { z } from "zod";

import {
  acceptMeetingInvitationRequestSchema,
  createMeetingInvitationRequestSchema,
  createMeetingRequestSchema,
} from "@/lib/supabase/meeting-contracts";
import {
  deliverMeetingInvitation,
  type InvitationDeliveryResult,
  type InvitationEmailInput,
} from "@/lib/supabase/invitation-email";
import {
  createMeetingService,
  type MeetingService,
  type MeetingServiceClient,
  type MeetingServiceResult,
} from "@/lib/supabase/meeting-service";
import {
  authenticatePermanentEmailUser,
  type SupabaseUserVerifier,
} from "@/lib/supabase/server-auth";
import {
  createServerServiceClient,
  createServerUserVerifierClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";

const REQUEST_MAX_BYTES = 8 * 1_024;

export interface MeetingRouteDependencies {
  verifier: SupabaseUserVerifier;
  service: MeetingService;
  deliverInvitation: (
    input: InvitationEmailInput,
  ) => Promise<InvitationDeliveryResult>;
  publicBaseUrl?: string;
}

export type ServerMeetingRouteDependenciesResult =
  | { ok: true; dependencies: MeetingRouteDependencies }
  | { ok: false };

export function createServerMeetingRouteDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ServerMeetingRouteDependenciesResult {
  const config = readServerSupabaseConfig(environment);
  if (!config.ok) return { ok: false };
  try {
    const client = createServerServiceClient<MeetingServiceClient>(config.config);
    const verifier = createServerUserVerifierClient<SupabaseUserVerifier>(
      config.config,
    );
    return {
      ok: true,
      dependencies: {
        verifier,
        service: createMeetingService(client),
        deliverInvitation: (input) =>
          deliverMeetingInvitation(input, environment),
        ...(validPublicBaseUrl(environment.COMMANDCANVAS_PUBLIC_URL)
          ? { publicBaseUrl: environment.COMMANDCANVAS_PUBLIC_URL!.trim() }
          : {}),
      },
    };
  } catch {
    return { ok: false };
  }
}

export async function handleCreateMeetingRequest(
  request: Request,
  dependencies: MeetingRouteDependencies,
) {
  const auth = await authenticate(request, dependencies);
  if (!auth.ok) return auth.response;
  const input = await parseJson(request, createMeetingRequestSchema);
  if (!input.ok) return input.response;
  try {
    const result = await dependencies.service.createMeeting(
      auth.actorUserId,
      input.value,
    );
    if (!result.ok) return serviceFailure(result);
    return json(201, { ok: true, meeting: result.value });
  } catch {
    return unavailable();
  }
}

export async function handleCreateMeetingInvitationRequest(
  request: Request,
  pathRoomId: string,
  dependencies: MeetingRouteDependencies,
) {
  const auth = await authenticate(request, dependencies);
  if (!auth.ok) return auth.response;
  if (!z.uuid().safeParse(pathRoomId).success) return invalidRequest();
  const input = await parseJson(request, createMeetingInvitationRequestSchema);
  if (!input.ok) return input.response;

  try {
    const result = await dependencies.service.createInvitation(
      auth.actorUserId,
      pathRoomId,
      input.value,
    );
    if (!result.ok) return serviceFailure(result);
    const baseUrl = dependencies.publicBaseUrl ?? safeRequestOrigin(request);
    const joinUrl = new URL("/meet", `${baseUrl}/`);
    joinUrl.hash = new URLSearchParams({ invite: result.value.token }).toString();
    const delivery = dependencies.publicBaseUrl
      ? await dependencies.deliverInvitation({
          recipientEmail: result.value.email,
          recipientName: result.value.displayName,
          roomName: "CommandCanvas meeting",
          joinUrl: joinUrl.toString(),
          expiresAt: result.value.expiresAt,
        })
      : {
          status: "preview_only" as const,
          message:
            "Invite created. Public email links are not configured; copy this link instead.",
        };

    return json(201, {
      ok: true,
      invitation: {
        invitationId: result.value.invitationId,
        roomId: result.value.roomId,
        expiresAt: result.value.expiresAt,
        joinUrl: joinUrl.toString(),
        delivery,
      },
    });
  } catch {
    return unavailable();
  }
}

export async function handleAcceptMeetingInvitationRequest(
  request: Request,
  dependencies: MeetingRouteDependencies,
) {
  const auth = await authenticate(request, dependencies);
  if (!auth.ok) return auth.response;
  const input = await parseJson(request, acceptMeetingInvitationRequestSchema);
  if (!input.ok) return input.response;
  try {
    const result = await dependencies.service.acceptInvitation(
      auth.actorUserId,
      input.value,
    );
    if (!result.ok) return serviceFailure(result);
    return json(200, { ok: true, meeting: result.value });
  } catch {
    return unavailable();
  }
}

export function meetingServiceUnavailableResponse() {
  return unavailable();
}

async function authenticate(
  request: Request,
  dependencies: MeetingRouteDependencies,
): Promise<
  | { ok: true; actorUserId: string; email: string }
  | { ok: false; response: Response }
> {
  const result = await authenticatePermanentEmailUser(
    request.headers.get("authorization"),
    dependencies.verifier,
  );
  if (result.ok) return result;
  return {
    ok: false,
    response: error(
      result.error.code === "permanent_email_auth_required" ? 403 : 401,
      result.error.code,
      result.error.message,
    ),
  };
}

async function parseJson<S extends z.ZodType>(request: Request, schema: S) {
  if (
    request.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase() !== "application/json"
  )
    return {
      ok: false as const,
      response: error(
        415,
        "unsupported_media_type",
        "Content-Type must be application/json.",
      ),
    };

  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > REQUEST_MAX_BYTES)
    return { ok: false as const, response: requestTooLarge() };
  if (!request.body) return { ok: false as const, response: invalidRequest() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!next.value) continue;
      length += next.value.byteLength;
      if (length > REQUEST_MAX_BYTES) {
        await reader.cancel();
        return { ok: false as const, response: requestTooLarge() };
      }
      chunks.push(next.value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    const parsed = schema.safeParse(raw);
    if (!parsed.success)
      return { ok: false as const, response: invalidRequest() };
    return { ok: true as const, value: parsed.data };
  } catch {
    return { ok: false as const, response: invalidRequest() };
  }
}

function serviceFailure(result: Extract<MeetingServiceResult<unknown>, { ok: false }>) {
  switch (result.error.code) {
    case "invalid_request":
      return invalidRequest();
    case "permanent_email_auth_required":
      return error(403, result.error.code, result.error.message);
    case "host_required":
      return error(403, result.error.code, result.error.message);
    case "rate_limited":
      return error(429, result.error.code, result.error.message, {
        "retry-after": "60",
      });
    case "invitation_unavailable":
      return error(404, result.error.code, result.error.message);
    case "service_unavailable":
      return unavailable();
  }
}

function validPublicBaseUrl(raw: string | undefined) {
  if (!raw) return false;
  try {
    const url = new URL(raw.trim());
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

function safeRequestOrigin(request: Request) {
  const origin = new URL(request.url).origin;
  return origin === "null" ? "https://commandcanvas.invalid" : origin;
}

function invalidRequest() {
  return error(400, "invalid_request", "Request body is invalid.");
}

function requestTooLarge() {
  return error(413, "request_too_large", "Request body is too large.");
}

function unavailable() {
  return error(503, "service_unavailable", "Meeting service is unavailable.");
}

function error(
  status: number,
  code: string,
  message: string,
  extraHeaders: Record<string, string> = {},
) {
  return json(status, { ok: false, error: { code, message } }, extraHeaders);
}

function json(
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "referrer-policy": "no-referrer",
      ...extraHeaders,
    },
  });
}
