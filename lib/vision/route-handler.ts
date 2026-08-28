import { createHash } from "node:crypto";

import type { CanvasState } from "@/lib/canvas/command-engine";
import type { SketchPayload } from "@/lib/canvas/object-model";
import {
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

export type SketchTransformMembershipResult =
  | { ok: true; role: "host" | "participant" }
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
  transform: (
    input: OpenAiDiagramTransformInput,
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
    });
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
