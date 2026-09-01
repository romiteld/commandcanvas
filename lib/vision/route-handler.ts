import { createHash } from "node:crypto";

import type { CanvasState } from "@/lib/canvas/command-engine";
import type { SketchPayload } from "@/lib/canvas/object-model";
import {
  authenticatePermanentEmailUser,
  authenticateRequestActor,
  type SupabaseUserVerifier,
} from "@/lib/supabase/server-auth";
import { sketchTransformRequestSchema } from "@/lib/vision/diagram-transform";
import {
  createVisionAdmissionIdentity,
  type VisionAdmissionInput,
  type VisionAdmissionResult,
  type VisionCompletionInput,
  type VisionCompletionResult,
  type VisionReleaseInput,
  type VisionReleaseResult,
} from "@/lib/vision/admission";
import type {
  OpenAiDiagramTransformInput,
  OpenAiDiagramTransformResult,
} from "@/lib/vision/openai-diagram";

// Leaves headroom below Vercel Functions' 4.5 MB request payload ceiling.
const MAX_TRANSFORM_REQUEST_BYTES = 4 * 1_024 * 1_024;
const openAiApiKeyPattern = /^sk-[A-Za-z0-9_-]{17,509}$/;

export type SketchTransformMembershipResult =
  | {
      ok: true;
      role: "host" | "participant";
      roomMode?: "standard" | "demo";
    }
  | { ok: false };

export type SketchTransformCanvasResult =
  | { ok: true; state: CanvasState }
  | { ok: false };

export interface SketchTransformRouteDependencies {
  verifier: SupabaseUserVerifier;
  verifyMembership: (
    roomId: string,
    actorUserId: string,
  ) => Promise<SketchTransformMembershipResult>;
  loadCanvas: (roomId: string) => Promise<SketchTransformCanvasResult>;
  admitTransform: (
    input: VisionAdmissionInput,
  ) => Promise<VisionAdmissionResult>;
  completeTransform: (
    input: VisionCompletionInput,
  ) => Promise<VisionCompletionResult>;
  releaseTransform: (
    input: VisionReleaseInput,
  ) => Promise<VisionReleaseResult>;
  safetyIdentifier: (actorUserId: string) => string;
  resolveSavedOpenAiApiKey: (actorUserId: string) => Promise<string | null>;
  transform: (
    input: OpenAiDiagramTransformInput,
    openAiApiKey: string,
  ) => Promise<OpenAiDiagramTransformResult>;
}

export async function handleSketchTransformRequest(
  request: Request,
  pathRoomId: string,
  dependencies: SketchTransformRouteDependencies,
): Promise<Response> {
  const actor = await authenticateRequestActor(
    request.headers.get("authorization"),
    dependencies.verifier,
  );
  if (!actor.ok) return jsonError(401, actor.error.code, actor.error.message);

  if (!isApplicationJson(request.headers.get("content-type")))
    return jsonError(
      415,
      "unsupported_media_type",
      "Content-Type must be application/json.",
    );

  const parsedBody = await readRequestJson(request, MAX_TRANSFORM_REQUEST_BYTES);
  if (!parsedBody.ok) return parsedBody.response;
  const parsed = sketchTransformRequestSchema.safeParse(parsedBody.value);
  if (!parsed.success)
    return jsonError(400, "invalid_request", "Request body is invalid.");
  const input = parsed.data;
  if (input.roomId !== pathRoomId)
    return jsonError(
      400,
      "room_mismatch",
      "Room ID does not match the request path.",
    );

  let membership: SketchTransformMembershipResult;
  try {
    membership = await dependencies.verifyMembership(
      input.roomId,
      actor.actorUserId,
    );
  } catch {
    membership = { ok: false };
  }
  if (!membership.ok)
    return jsonError(
      403,
      "member_required",
      "Join this room before interpreting its sketch.",
    );

  let canvas: SketchTransformCanvasResult;
  try {
    canvas = await dependencies.loadCanvas(input.roomId);
  } catch {
    canvas = { ok: false };
  }
  if (!canvas.ok)
    return jsonError(
      503,
      "canvas_unavailable",
      "Canvas state is temporarily unavailable.",
    );

  const source = canvas.state.objects[input.sketchObjectId];
  if (!source || source.deletedAt !== null || source.type !== "sketch")
    return jsonError(
      404,
      "sketch_unavailable",
      "The source sketch is unavailable.",
    );
  if (source.version !== input.sourceVersion)
    return jsonError(
      409,
      "source_changed",
      "The source sketch changed. Rasterize the current version and try again.",
    );

  const credential = await resolveOpenAiCredential(
    request,
    membership.roomMode,
    actor.actorUserId,
    dependencies,
  );
  if (!credential.ok) return credential.response;

  let identity: ReturnType<typeof createVisionAdmissionIdentity>;
  try {
    identity = createVisionAdmissionIdentity(input);
  } catch {
    return jsonError(400, "invalid_request", "Request body is invalid.");
  }

  let admission: VisionAdmissionResult;
  try {
    admission = await dependencies.admitTransform({
      roomId: input.roomId,
      actorUserId: actor.actorUserId,
      sketchObjectId: input.sketchObjectId,
      sourceVersion: input.sourceVersion,
      outputKind: input.outputKind,
      normalizedInstructionSha256: identity.normalizedInstructionSha256,
      normalizedNarrationSha256: identity.normalizedNarrationSha256,
      pngSha256: identity.pngSha256,
      requestKey: identity.requestKey,
    });
  } catch {
    admission = { ok: false, code: "admission_unavailable" };
  }
  if (!admission.ok) return admissionFailure(admission);
  if (admission.requestKey !== identity.requestKey)
    return jsonError(
      503,
      "admission_unavailable",
      "Sketch interpretation admission is unavailable.",
    );
  if (admission.outcome === "cached") {
    if (
      admission.transform.payload.sourceSketchId !== input.sketchObjectId ||
      (input.outputKind !== "auto" &&
        admission.transform.payload.kind !== input.outputKind)
    )
      return jsonError(
        503,
        "admission_unavailable",
        "Sketch interpretation admission is unavailable.",
      );
    return transformSuccess(input.sketchObjectId, admission.transform);
  }

  let transformed: OpenAiDiagramTransformResult;
  try {
    transformed = await dependencies.transform({
      ...input,
      instruction: identity.normalizedInstruction,
      ...(identity.normalizedNarration
        ? { narration: identity.normalizedNarration }
        : {}),
      sketch: source.payload as SketchPayload,
      safetyIdentifier: dependencies.safetyIdentifier(actor.actorUserId),
      signal: request.signal,
    }, credential.value);
  } catch {
    transformed = {
      ok: false,
      code: "provider_unavailable",
      message: "Sketch interpretation is temporarily unavailable.",
    };
  }
  if (!transformed.ok) {
    try {
      await dependencies.releaseTransform({
        requestKey: identity.requestKey,
        leaseToken: admission.leaseToken,
        errorCode: transformed.code,
      });
    } catch {
      // The database lease expires, so a failed cleanup cannot strand the room.
    }
    return transformFailure(transformed.code, transformed.message);
  }

  let completion: VisionCompletionResult;
  try {
    completion = await dependencies.completeTransform({
      requestKey: identity.requestKey,
      leaseToken: admission.leaseToken,
      model: transformed.model,
      responseId: transformed.responseId,
      payload: transformed.payload,
    });
  } catch {
    completion = { ok: false, code: "admission_unavailable" };
  }
  if (!completion.ok)
    return jsonError(
      503,
      "admission_unavailable",
      "Sketch interpretation could not be recorded.",
    );

  return transformSuccess(input.sketchObjectId, transformed);
}

async function resolveOpenAiCredential(
  request: Request,
  roomMode: "standard" | "demo" | undefined,
  actorUserId: string,
  dependencies: SketchTransformRouteDependencies,
): Promise<
  | { ok: true; value: string }
  | { ok: false; response: Response }
> {
  const rawKey = request.headers.get("x-commandcanvas-openai-key");
  const savedHeader = request.headers.get(
    "x-commandcanvas-openai-credential",
  );
  if (savedHeader !== null && savedHeader !== "saved")
    return {
      ok: false,
      response: jsonError(
        400,
        "invalid_openai_credential",
        "OpenAI credential selection is invalid.",
      ),
    };
  const useSaved = savedHeader === "saved";
  if (useSaved && rawKey !== null)
    return {
      ok: false,
      response: jsonError(
        400,
        "ambiguous_openai_credential",
        "Choose either a saved OpenAI credential or a temporary key.",
      ),
    };
  if (!useSaved) return readSessionOpenAiKey(rawKey);
  if (roomMode !== "standard" && roomMode !== "demo")
    return {
      ok: false,
      response: jsonError(
        403,
        "saved_credential_unavailable",
        "Saved credentials are available after email sign-in in a meeting room.",
      ),
    };
  const permanentActor = await authenticatePermanentEmailUser(
    request.headers.get("authorization"),
    dependencies.verifier,
  );
  if (!permanentActor.ok || permanentActor.actorUserId !== actorUserId)
    return {
      ok: false,
      response: jsonError(
        403,
        "permanent_email_auth_required",
        "Verify your email before using a saved OpenAI credential.",
      ),
    };
  try {
    const savedKey = await dependencies.resolveSavedOpenAiApiKey(actorUserId);
    const parsed = savedKey?.trim() ?? "";
    return openAiApiKeyPattern.test(parsed)
      ? { ok: true, value: parsed }
      : {
          ok: false,
          response: jsonError(
            409,
            "openai_credential_not_configured",
            "Save an OpenAI API key to your CommandCanvas account first.",
          ),
        };
  } catch {
    return {
      ok: false,
      response: jsonError(
        503,
        "openai_credential_unavailable",
        "Your saved OpenAI credential is temporarily unavailable.",
      ),
    };
  }
}

function readSessionOpenAiKey(value: string | null):
  | { ok: true; value: string }
  | { ok: false; response: Response } {
  if (value === null || value.trim().length === 0)
    return {
      ok: false,
      response: jsonError(
        400,
        "openai_key_required",
        "Enter an OpenAI API key for this browser session.",
      ),
    };
  const trimmed = value.trim();
  if (!openAiApiKeyPattern.test(trimmed))
    return {
      ok: false,
      response: jsonError(
        400,
        "invalid_openai_key",
        "The OpenAI API key for this browser session is invalid.",
      ),
    };
  return { ok: true, value: trimmed };
}

function transformSuccess(
  sourceSketchId: string,
  transformed: {
    model: "gpt-5.6-terra" | "gpt-5.6-sol";
    responseId: string;
    payload: unknown;
  },
) {
  return jsonResponse(200, {
    ok: true,
    transform: {
      provider: "openai",
      model: transformed.model,
      responseId: transformed.responseId,
      sourceSketchId,
      payload: transformed.payload,
    },
  });
}

function admissionFailure(
  admission: Extract<VisionAdmissionResult, { ok: false }>,
) {
  if (admission.code === "admission_unavailable")
    return jsonError(
      503,
      admission.code,
      "Sketch interpretation admission is unavailable.",
    );

  const messages = {
    transform_rate_limited: "Too many sketch transformations. Try again shortly.",
    room_transform_busy: "Another sketch transformation is running in this room.",
    demo_transform_limit: "This demo room has used its sketch transformation allowance.",
    demo_actor_daily_limit:
      "This judge session has used today's sketch transformation allowance.",
    demo_global_daily_limit:
      "The public demo has used today's sketch transformation allowance.",
    daily_transform_limit: "This room has used today's sketch transformation allowance.",
    transform_in_progress: "This sketch transformation is already running.",
  } as const;
  const retryAfterSeconds = Math.min(
    86_400,
    Math.max(1, Math.ceil(admission.retryAfterSeconds)),
  );
  return jsonError(429, admission.code, messages[admission.code], {
    "retry-after": String(retryAfterSeconds),
  });
}

export function createPrivacyPreservingSafetyIdentifier(actorUserId: string) {
  return `cc_${createHash("sha256").update(actorUserId).digest("hex").slice(0, 24)}`;
}

async function readRequestJson(
  request: Request,
  maxBytes: number,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; response: Response }
> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength)) {
    const bytes = Number(declaredLength);
    if (Number.isSafeInteger(bytes) && bytes > maxBytes)
      return {
        ok: false,
        response: jsonError(
          413,
          "request_too_large",
          "Request body is too large.",
        ),
      };
  }
  if (!request.body)
    return {
      ok: false,
      response: jsonError(400, "invalid_request", "Request body is invalid."),
    };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        return {
          ok: false,
          response: jsonError(
            413,
            "request_too_large",
            "Request body is too large.",
          ),
        };
      }
      chunks.push(value);
    }
  } catch {
    return {
      ok: false,
      response: jsonError(400, "invalid_request", "Request body is invalid."),
    };
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      response: jsonError(400, "invalid_request", "Request body is invalid."),
    };
  }
}

function transformFailure(
  code:
    | "vision_unconfigured"
    | "provider_unavailable"
    | "invalid_provider_response"
    | "request_cancelled",
  message: string,
) {
  switch (code) {
    case "request_cancelled":
      return jsonError(499, code, message);
    case "invalid_provider_response":
      return jsonError(502, code, message);
    case "vision_unconfigured":
    case "provider_unavailable":
      return jsonError(503, code, message);
  }
}

function isApplicationJson(contentType: string | null) {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function jsonError(
  status: number,
  code: string,
  message: string,
  headers?: Record<string, string>,
) {
  return jsonResponse(status, { ok: false, error: { code, message } }, headers);
}

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}
