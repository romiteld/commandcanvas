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
  type InvitationDeliveryCompletion,
  type InvitationDeliveryStatus,
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

type InvitationResponseDelivery = {
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

    if (!invitationDeliveryMayResume(result.value.deliveryStatus)) {
      return invitationResponse(result.value.created ? 201 : 200, result.value, {
        ...durableInvitationDelivery(
          result.value.deliveryStatus,
          result.value.providerMessageId,
        ),
      }, joinUrl.toString());
    }

    const reservation = await dependencies.service.reserveInvitationDelivery(
      auth.actorUserId,
      pathRoomId,
      result.value.invitationId,
    );
    if (!reservation.ok) return serviceFailure(reservation);
    if (!invitationDeliveryMayResume(reservation.value.deliveryStatus)) {
      return invitationResponse(result.value.created ? 201 : 200, result.value, {
        ...durableInvitationDelivery(
          reservation.value.deliveryStatus,
          reservation.value.providerMessageId,
        ),
      }, joinUrl.toString());
    }

    const delivery = dependencies.publicBaseUrl
      ? await dependencies.deliverInvitation({
          idempotencyKey: result.value.idempotencyKey,
          recipientEmail: result.value.email,
          recipientName: result.value.displayName,
          roomName: result.value.roomName,
          joinUrl: joinUrl.toString(),
          expiresAt: result.value.expiresAt,
        })
      : {
          status: "preview_only" as const,
          message:
            "Invite created. Public email links are not configured; copy this link instead.",
        };

    const completion = await dependencies.service.completeInvitationDelivery(
      auth.actorUserId,
      pathRoomId,
      result.value.invitationId,
      invitationCompletion(delivery),
    );
    if (!completion.ok) {
      if (delivery.status === "submitted") {
        const reconciled = await dependencies.service.completeInvitationDelivery(
          auth.actorUserId,
          pathRoomId,
          result.value.invitationId,
          {
            status: "reconciling",
            errorCode: "delivery_recording_failed",
            providerId: delivery.providerId,
          },
        );
        if (reconciled.ok)
          return invitationResponse(
            result.value.created ? 201 : 200,
            result.value,
            {
              status: "reconciling",
              message:
                "Invitation submission is being reconciled; delivery is not confirmed.",
              providerId: delivery.providerId,
            },
            joinUrl.toString(),
          );
      }
      return serviceFailure(completion);
    }

    return invitationResponse(
      result.value.created ? 201 : 200,
      result.value,
      delivery,
      joinUrl.toString(),
    );
  } catch {
    return unavailable();
  }
}

function invitationDeliveryMayResume(
  status: InvitationDeliveryStatus,
): status is "created" | "sending" | "reconciling" {
  return status === "created" || status === "sending" || status === "reconciling";
}

function invitationCompletion(
  delivery: InvitationDeliveryResult,
): InvitationDeliveryCompletion {
  switch (delivery.status) {
    case "preview_only":
      return { status: "preview_only" };
    case "submitted":
      return { status: "submitted", providerId: delivery.providerId };
    case "reconciling":
      return { status: "reconciling", errorCode: delivery.errorCode };
    case "failed":
      return { status: "failed", errorCode: "resend_rejected" };
  }
}

function durableInvitationDelivery(
  status: Exclude<InvitationDeliveryStatus, "created" | "sending" | "reconciling">,
  providerMessageId: string | null,
): InvitationResponseDelivery {
  const provider = providerMessageId ? { providerId: providerMessageId } : {};
  switch (status) {
    case "preview_only":
      return {
        status,
        message: "Invite created. No email was sent; copy the link instead.",
      };
    case "submitted":
      return {
        status,
        message: "Invitation was submitted to the email provider; delivery is pending.",
        ...provider,
      };
    case "delivered":
      return { status, message: "Invitation delivery was confirmed.", ...provider };
    case "bounced":
      return { status, message: "Invitation email bounced.", ...provider };
    case "complained":
      return { status, message: "Invitation email was reported as spam.", ...provider };
    case "suppressed":
      return { status, message: "Invitation email was suppressed.", ...provider };
    case "failed":
      return {
        status,
        message: "Invite created, but email delivery failed. Copy the link instead.",
      };
  }
}

function invitationResponse(
  status: 200 | 201,
  invitation: {
    invitationId: string;
    roomId: string;
    expiresAt: string;
  },
  delivery: InvitationResponseDelivery,
  joinUrl: string,
) {
  return json(status, {
    ok: true,
    invitation: {
      invitationId: invitation.invitationId,
      roomId: invitation.roomId,
      expiresAt: invitation.expiresAt,
      joinUrl,
      delivery,
    },
  });
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
    case "invitation_conflict":
      return error(409, result.error.code, result.error.message);
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
