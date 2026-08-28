import { createHash } from "node:crypto";

import type { DiagramPayload } from "@/lib/canvas/object-model";
import type { SketchTransformRequest } from "@/lib/vision/diagram-transform";
import type { OpenAiDiagramModel } from "@/lib/vision/openai-diagram";
import type { SketchTransformOutputKind } from "@/lib/vision/diagram-transform";

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";

export const VISION_ADMISSION_KEY_VERSION = "v1";

export type VisionAdmissionDenialCode =
  | "transform_rate_limited"
  | "room_transform_busy"
  | "demo_transform_limit"
  | "demo_actor_daily_limit"
  | "demo_global_daily_limit"
  | "daily_transform_limit"
  | "transform_in_progress";

export interface VisionAdmissionInput {
  roomId: string;
  actorUserId: string;
  sketchObjectId: string;
  sourceVersion: number;
  outputKind: SketchTransformOutputKind;
  normalizedInstructionSha256: string;
  normalizedNarrationSha256: string | null;
  pngSha256: string;
  requestKey: string;
}

export interface VisionAdmissionIdentity {
  normalizedInstruction: string;
  normalizedNarration?: string;
  normalizedInstructionSha256: string;
  normalizedNarrationSha256: string | null;
  pngSha256: string;
  requestKey: string;
}

export interface VisionCachedTransform {
  model: OpenAiDiagramModel;
  responseId: string;
  payload: DiagramPayload;
}

export type VisionAdmissionResult =
  | {
      ok: true;
      outcome: "admitted";
      requestKey: string;
      leaseToken: string;
      leaseExpiresAt: string;
    }
  | {
      ok: true;
      outcome: "cached";
      requestKey: string;
      transform: VisionCachedTransform;
    }
  | {
      ok: false;
      code: VisionAdmissionDenialCode;
      retryAfterSeconds: number;
    }
  | {
      ok: false;
      code: "admission_unavailable";
    };

export interface VisionCompletionInput extends VisionCachedTransform {
  requestKey: string;
  leaseToken: string;
}

export type VisionCompletionResult =
  | { ok: true }
  | { ok: false; code: "admission_unavailable" };

export interface VisionReleaseInput {
  requestKey: string;
  leaseToken: string;
  errorCode:
    | "vision_unconfigured"
    | "provider_unavailable"
    | "invalid_provider_response"
    | "request_cancelled";
}

export type VisionReleaseResult =
  | { ok: true }
  | { ok: false; code: "admission_unavailable" };

export function createVisionAdmissionIdentity(
  input: SketchTransformRequest,
): VisionAdmissionIdentity {
  const normalizedInstruction = input.instruction
    .normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
  const normalizedNarration = input.narration
    ?.normalize("NFKC")
    .trim()
    .replace(/\s+/gu, " ");
  const normalizedInstructionSha256 = sha256Utf8(normalizedInstruction);
  const normalizedNarrationSha256 = normalizedNarration
    ? sha256Utf8(normalizedNarration)
    : null;
  const encodedPng = input.imageDataUrl.slice(PNG_DATA_URL_PREFIX.length);
  const pngSha256 = createHash("sha256")
    .update(Buffer.from(encodedPng, "base64"))
    .digest("hex");
  const canonicalIdentity = [
    VISION_ADMISSION_KEY_VERSION,
    input.roomId,
    input.sketchObjectId,
    String(input.sourceVersion),
    input.outputKind,
    normalizedInstructionSha256,
    ...(normalizedNarrationSha256 ? [normalizedNarrationSha256] : []),
    pngSha256,
  ].join("\n");

  return {
    normalizedInstruction,
    ...(normalizedNarration ? { normalizedNarration } : {}),
    normalizedInstructionSha256,
    normalizedNarrationSha256,
    pngSha256,
    requestKey: `vision_${VISION_ADMISSION_KEY_VERSION}_${sha256Utf8(canonicalIdentity)}`,
  };
}

function sha256Utf8(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
