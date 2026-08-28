import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { diagramPayloadSchema } from "@/lib/canvas/object-model";
import {
  createRoomService,
  type RoomServiceClient,
} from "@/lib/supabase/room-service";
import type { SupabaseUserVerifier } from "@/lib/supabase/server-auth";
import {
  createServerServiceClient,
  createServerUserVerifierClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";
import {
  createOpenAiDiagramTransformer,
  readOpenAiDiagramConfig,
  type OpenAiDiagramTransformer,
} from "@/lib/vision/openai-diagram";
import {
  type VisionAdmissionResult,
  type VisionCompletionInput,
  type VisionCompletionResult,
  type VisionReleaseInput,
  type VisionReleaseResult,
} from "@/lib/vision/admission";
import {
  createPrivacyPreservingSafetyIdentifier,
  type SketchTransformRouteDependencies,
} from "@/lib/vision/route-handler";

const memberRoleSchema = z
  .object({ role: z.enum(["host", "participant"]) })
  .strict();

type VisionServiceClient = RoomServiceClient & SupabaseUserVerifier;

const requestKeySchema = z
  .string()
  .regex(/^vision_v1_[0-9a-f]{64}$/);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const objectIdSchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);
const admissionInputSchema = z
  .object({
    roomId: z.uuid(),
    actorUserId: z.uuid(),
    sketchObjectId: objectIdSchema,
    sourceVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    outputKind: z.enum(["architecture", "flowchart"]),
    normalizedInstructionSha256: hashSchema,
    pngSha256: hashSchema,
    requestKey: requestKeySchema,
  })
  .strict();
const cachedTransformSchema = z
  .object({
    model: z.enum(["gpt-5.6-terra", "gpt-5.6-sol"]),
    responseId: z.string().trim().min(1).max(160),
    payload: diagramPayloadSchema,
  })
  .strict();
const admittedRpcSchema = z
  .object({
    outcome: z.literal("admitted"),
    requestKey: requestKeySchema,
    leaseToken: z.uuid(),
    leaseExpiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const cachedRpcSchema = z
  .object({
    outcome: z.literal("cached"),
    requestKey: requestKeySchema,
    transform: cachedTransformSchema,
  })
  .strict();
const deniedRpcSchema = z
  .object({
    outcome: z.literal("denied"),
    code: z.enum([
      "transform_rate_limited",
      "room_transform_busy",
      "demo_transform_limit",
      "demo_actor_daily_limit",
      "demo_global_daily_limit",
      "daily_transform_limit",
      "transform_in_progress",
    ]),
    retryAfterSeconds: z.number().int().min(1).max(86_400),
  })
  .strict();
const admissionRpcSchema = z.union([
  admittedRpcSchema,
  cachedRpcSchema,
  deniedRpcSchema,
]);
const completionInputSchema = z
  .object({
    requestKey: requestKeySchema,
    leaseToken: z.uuid(),
    model: z.enum(["gpt-5.6-terra", "gpt-5.6-sol"]),
    responseId: z.string().trim().min(1).max(160),
    payload: cachedTransformSchema.shape.payload,
  })
  .strict();
const releaseInputSchema = z
  .object({
    requestKey: requestKeySchema,
    leaseToken: z.uuid(),
    errorCode: z.enum([
      "vision_unconfigured",
      "provider_unavailable",
      "invalid_provider_response",
      "request_cancelled",
    ]),
  })
  .strict();

interface ServerSketchTransformDependencyOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  createClient?: (config: {
    supabaseUrl: string;
    publishableKey: string;
    secretKey: string;
  }) => VisionServiceClient;
  createTransformer?: (config: {
    apiKey: string;
    model: "gpt-5.6-terra" | "gpt-5.6-sol";
  }) => OpenAiDiagramTransformer;
  createLeaseToken?: () => string;
}

export type ServerSketchTransformDependenciesResult =
  | { ok: true; dependencies: SketchTransformRouteDependencies }
  | { ok: false };

export function createServerSketchTransformDependencies(
  options: ServerSketchTransformDependencyOptions = {},
): ServerSketchTransformDependenciesResult {
  const supabaseConfig = readServerSupabaseConfig(options.environment);
  if (!supabaseConfig.ok) return { ok: false };

  let client: VisionServiceClient;
  let verifier: SupabaseUserVerifier;
  try {
    client = options.createClient
      ? options.createClient(supabaseConfig.config)
      : createServerServiceClient<VisionServiceClient>(supabaseConfig.config);
    verifier = options.createClient
      ? client
      : createServerUserVerifierClient<SupabaseUserVerifier>(
          supabaseConfig.config,
        );
  } catch {
    return { ok: false };
  }
  const roomService = createRoomService(client);
  const openAiConfig = readOpenAiDiagramConfig(options.environment);
  const transformer: OpenAiDiagramTransformer | null = openAiConfig.ok
    ? options.createTransformer
      ? options.createTransformer(openAiConfig)
      : createOpenAiDiagramTransformer(openAiConfig)
    : null;
  const createLeaseToken = options.createLeaseToken ?? randomUUID;

  return {
    ok: true,
    dependencies: {
      verifier,
      async verifyMembership(roomId, actorUserId) {
        try {
          const response = await client
            .from("room_members")
            .select("role")
            .eq("room_id", roomId)
            .eq("user_id", actorUserId)
            .maybeSingle();
          if (response.error || response.data === null) return { ok: false };
          const member = memberRoleSchema.safeParse(response.data);
          return member.success
            ? { ok: true, role: member.data.role }
            : { ok: false };
        } catch {
          return { ok: false };
        }
      },
      async loadCanvas(roomId) {
        const result = await roomService.loadCanvas(roomId);
        return result.ok
          ? { ok: true, state: result.value }
          : { ok: false };
      },
      async admitTransform(rawInput): Promise<VisionAdmissionResult> {
        const input = admissionInputSchema.safeParse(rawInput);
        if (!input.success)
          return { ok: false, code: "admission_unavailable" };

        let leaseToken: string;
        try {
          leaseToken = z.uuid().parse(createLeaseToken());
          const response = await client.rpc("admit_sketch_transform", {
            p_room_id: input.data.roomId,
            p_actor_user_id: input.data.actorUserId,
            p_sketch_object_id: input.data.sketchObjectId,
            p_source_version: input.data.sourceVersion,
            p_output_kind: input.data.outputKind,
            p_normalized_instruction_sha256:
              input.data.normalizedInstructionSha256,
            p_png_sha256: input.data.pngSha256,
            p_request_key: input.data.requestKey,
            p_lease_token: leaseToken,
          });
          if (response.error) {
            const circuitBreakerCode = readDemoCircuitBreakerCode(
              response.error,
            );
            return circuitBreakerCode
              ? {
                  ok: false,
                  code: circuitBreakerCode,
                  retryAfterSeconds: secondsUntilNextUtcDay(),
                }
              : { ok: false, code: "admission_unavailable" };
          }
          const parsed = admissionRpcSchema.safeParse(response.data);
          if (!parsed.success)
            return { ok: false, code: "admission_unavailable" };
          if (parsed.data.outcome === "denied")
            return {
              ok: false,
              code: parsed.data.code,
              retryAfterSeconds: parsed.data.retryAfterSeconds,
            };
          if (parsed.data.requestKey !== input.data.requestKey)
            return { ok: false, code: "admission_unavailable" };
          if (parsed.data.outcome === "admitted") {
            if (parsed.data.leaseToken !== leaseToken)
              return { ok: false, code: "admission_unavailable" };
            return { ok: true, ...parsed.data };
          }
          if (
            parsed.data.transform.payload.sourceSketchId !==
              input.data.sketchObjectId ||
            parsed.data.transform.payload.kind !== input.data.outputKind
          )
            return { ok: false, code: "admission_unavailable" };
          return { ok: true, ...parsed.data } as VisionAdmissionResult;
        } catch {
          return { ok: false, code: "admission_unavailable" };
        }
      },
      async completeTransform(
        rawInput: VisionCompletionInput,
      ): Promise<VisionCompletionResult> {
        const input = completionInputSchema.safeParse(rawInput);
        if (!input.success)
          return { ok: false, code: "admission_unavailable" };
        try {
          const response = await client.rpc("complete_sketch_transform", {
            p_request_key: input.data.requestKey,
            p_lease_token: input.data.leaseToken,
            p_model: input.data.model,
            p_provider_response_id: input.data.responseId,
            p_payload: input.data.payload,
          });
          const parsed = z
            .object({ completed: z.literal(true) })
            .strict()
            .safeParse(response.data);
          return !response.error && parsed.success
            ? { ok: true }
            : { ok: false, code: "admission_unavailable" };
        } catch {
          return { ok: false, code: "admission_unavailable" };
        }
      },
      async releaseTransform(
        rawInput: VisionReleaseInput,
      ): Promise<VisionReleaseResult> {
        const input = releaseInputSchema.safeParse(rawInput);
        if (!input.success)
          return { ok: false, code: "admission_unavailable" };
        try {
          const response = await client.rpc("release_sketch_transform", {
            p_request_key: input.data.requestKey,
            p_lease_token: input.data.leaseToken,
            p_error_code: input.data.errorCode,
          });
          const parsed = z
            .object({ released: z.literal(true) })
            .strict()
            .safeParse(response.data);
          return !response.error && parsed.success
            ? { ok: true }
            : { ok: false, code: "admission_unavailable" };
        } catch {
          return { ok: false, code: "admission_unavailable" };
        }
      },
      safetyIdentifier: createPrivacyPreservingSafetyIdentifier,
      transform: transformer
        ? (input) => transformer.transform(input)
        : async () => ({
            ok: false,
            code: "vision_unconfigured",
            message: "Sketch interpretation is not configured.",
          }),
    },
  };
}

function readDemoCircuitBreakerCode(error: unknown) {
  if (!error || typeof error !== "object" || !("message" in error))
    return null;
  const message = (error as { message?: unknown }).message;
  return message === "demo_actor_daily_limit" ||
    message === "demo_global_daily_limit"
    ? message
    : null;
}

function secondsUntilNextUtcDay(now = new Date()) {
  const nextUtcDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.min(
    86_400,
    Math.max(1, Math.ceil((nextUtcDay - now.getTime()) / 1_000)),
  );
}
