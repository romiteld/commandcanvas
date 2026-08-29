import { z } from "zod";

export const PRIVATE_HAND_RELAY_PROTOCOL =
  "commandcanvas.private-hand-relay.v1" as const;

const secureWebSocketUrlSchema = z
  .url()
  .refine((value) => new URL(value).protocol === "wss:", {
    message: "Private hand relay WebSockets require wss://.",
  });

const relayLandmarkSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
    z: z.number().finite().min(-2).max(2),
    visibility: z.number().finite().min(0).max(1),
  })
  .strict();

export const privateHandRelayCapabilitySchema = z
  .object({
    ok: z.literal(true),
    protocol: z.literal(PRIVATE_HAND_RELAY_PROTOCOL),
    service: z.literal("commandcanvas-private-hand-relay"),
    ready: z.boolean(),
    warm: z.boolean(),
    unavailableReason: z
      .enum([
        "model_cold",
        "model_unavailable",
        "gpu_unavailable",
        "overloaded",
        "maintenance",
      ])
      .optional(),
    model: z
      .object({
        id: z.string().trim().min(3).max(180),
        revision: z.string().regex(/^[A-Za-z0-9._-]{7,80}$/),
        format: z.literal("onnx"),
        keypoints: z.literal(21),
        license: z.enum(["AGPL-3.0", "Apache-2.0"]),
      })
      .strict(),
    runtime: z
      .object({
        provider: z.enum(["cuda", "tensorrt"]),
        device: z.string().trim().min(3).max(160),
        precision: z.enum(["fp16", "fp32", "int8"]),
      })
      .strict(),
    limits: z
      .object({
        maxFrameBytes: z.number().int().min(16_384).max(1_048_576),
        maxFps: z.number().int().min(1).max(30),
        maxWidth: z.number().int().min(160).max(1_280),
        maxHeight: z.number().int().min(120).max(720),
        maxInFlight: z.literal(1),
        newestFrameOnly: z.literal(true),
      })
      .strict(),
    privacy: z
      .object({
        rawFramesPersisted: z.literal(false),
        semanticResultsOnly: z.literal(true),
        maxRetentionSeconds: z.literal(0),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.ready && value.unavailableReason === undefined)
      context.addIssue({
        code: "custom",
        path: ["unavailableReason"],
        message: "An unavailable relay must state why.",
      });
    if (value.ready && !value.warm)
      context.addIssue({
        code: "custom",
        path: ["warm"],
        message: "A ready relay must already be warm.",
      });
  });

export const privateHandRelaySessionRequestSchema = z
  .object({ cameraUploadConsent: z.literal(true) })
  .strict();

export const privateHandRelaySessionSchema = z
  .object({
    protocol: z.literal(PRIVATE_HAND_RELAY_PROTOCOL),
    roomId: z.uuid(),
    actorUserId: z.uuid(),
    websocketUrl: secureWebSocketUrlSchema,
    token: z.string().regex(/^ccr1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
    expiresAt: z.iso.datetime({ offset: true }),
    capability: privateHandRelayCapabilitySchema,
  })
  .strict()
  .refine((value) => value.capability.ready && value.capability.warm, {
    path: ["capability", "ready"],
    message: "Sessions may only target a ready, warm relay.",
  });

export const privateHandRelaySessionResponseSchema = z
  .object({
    ok: z.literal(true),
    relay: privateHandRelaySessionSchema,
  })
  .strict();

export const privateHandRelayReadyMessageSchema = z
  .object({
    type: z.literal("ready"),
    protocol: z.literal(PRIVATE_HAND_RELAY_PROTOCOL),
  })
  .strict();

export const privateHandRelayResultSchema = z
  .object({
    type: z.literal("result"),
    protocol: z.literal(PRIVATE_HAND_RELAY_PROTOCOL),
    frameId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    capturedAtMs: z.number().finite().nonnegative(),
    processedAtMs: z.number().finite().nonnegative(),
    hands: z
      .array(
        z
          .object({
            confidence: z.number().finite().min(0).max(1),
            handedness: z.enum(["left", "right", "unknown"]),
            landmarks: z.array(relayLandmarkSchema).length(21),
          })
          .strict(),
      )
      .max(2),
  })
  .strict()
  .refine((value) => value.processedAtMs >= value.capturedAtMs, {
    path: ["processedAtMs"],
    message: "Relay processing cannot predate capture.",
  });

export type PrivateHandRelayCapability = z.infer<
  typeof privateHandRelayCapabilitySchema
>;
export type PrivateHandRelaySession = z.infer<
  typeof privateHandRelaySessionSchema
>;
export type PrivateHandRelayResult = z.infer<
  typeof privateHandRelayResultSchema
>;
