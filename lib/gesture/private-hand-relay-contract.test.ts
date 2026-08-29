import { describe, expect, it } from "vitest";

import {
  PRIVATE_HAND_RELAY_PROTOCOL,
  privateHandRelayCapabilitySchema,
  privateHandRelayResultSchema,
  privateHandRelaySessionResponseSchema,
} from "@/lib/gesture/private-hand-relay-contract";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

function capability() {
  return {
    ok: true,
    protocol: PRIVATE_HAND_RELAY_PROTOCOL,
    service: "commandcanvas-private-hand-relay",
    ready: true,
    warm: true,
    model: {
      id: "openmmlab/rtmdet-rtmpose-hand",
      revision: "1234567890abcdef1234567890abcdef12345678",
      format: "onnx",
      keypoints: 21,
      license: "Apache-2.0",
    },
    runtime: {
      provider: "cuda",
      device: "NVIDIA GeForce RTX 3090",
      precision: "fp16",
    },
    limits: {
      maxFrameBytes: 262_144,
      maxFps: 15,
      maxWidth: 640,
      maxHeight: 480,
      maxInFlight: 1,
      newestFrameOnly: true,
    },
    privacy: {
      rawFramesPersisted: false,
      semanticResultsOnly: true,
      maxRetentionSeconds: 0,
    },
  } as const;
}

function landmarks() {
  return Array.from({ length: 21 }, (_, index) => ({
    x: index / 20,
    y: 1 - index / 20,
    z: 0,
    visibility: 0.95,
  }));
}

describe("private hand relay contract", () => {
  it("accepts only an honestly ready, one-frame, no-retention relay", () => {
    expect(privateHandRelayCapabilitySchema.parse(capability())).toEqual(
      capability(),
    );

    expect(
      privateHandRelayCapabilitySchema.safeParse({
        ...capability(),
        privacy: {
          ...capability().privacy,
          rawFramesPersisted: true,
        },
      }).success,
    ).toBe(false);
    expect(
      privateHandRelayCapabilitySchema.safeParse({
        ...capability(),
        limits: { ...capability().limits, maxInFlight: 2 },
      }).success,
    ).toBe(false);
    expect(
      privateHandRelayCapabilitySchema.safeParse({
        ...capability(),
        model: { ...capability().model, license: "MIT" },
      }).success,
    ).toBe(false);
  });

  it("requires an unavailable reason whenever readiness is false", () => {
    expect(
      privateHandRelayCapabilitySchema.safeParse({
        ...capability(),
        ready: false,
        warm: false,
      }).success,
    ).toBe(false);

    expect(
      privateHandRelayCapabilitySchema.safeParse({
        ...capability(),
        ready: false,
        warm: false,
        unavailableReason: "model_cold",
      }).success,
    ).toBe(true);
  });

  it("binds an issued browser session to one room and actor", () => {
    const value = {
      ok: true,
      relay: {
        protocol: PRIVATE_HAND_RELAY_PROTOCOL,
        roomId: ROOM_ID,
        actorUserId: ACTOR_ID,
        websocketUrl: "wss://hand.example.test/v1/hand-pose",
        token: "ccr1.payload.signature",
        expiresAt: "2026-08-28T15:01:00.000Z",
        capability: capability(),
      },
    };

    expect(privateHandRelaySessionResponseSchema.parse(value)).toEqual(value);
    expect(
      privateHandRelaySessionResponseSchema.safeParse({
        ...value,
        relay: {
          ...value.relay,
          websocketUrl: "ws://hand.example.test/v1/hand-pose",
        },
      }).success,
    ).toBe(false);
    expect(
      privateHandRelaySessionResponseSchema.safeParse({
        ...value,
        relay: {
          ...value.relay,
          capability: {
            ...value.relay.capability,
            ready: false,
            warm: false,
            unavailableReason: "model_cold",
          },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts semantic 21-point results and rejects malformed landmarks", () => {
    const result = {
      type: "result",
      protocol: PRIVATE_HAND_RELAY_PROTOCOL,
      frameId: 7,
      capturedAtMs: 100,
      processedAtMs: 120,
      hands: [
        {
          confidence: 0.91,
          handedness: "right",
          landmarks: landmarks(),
        },
      ],
    };
    expect(privateHandRelayResultSchema.parse(result)).toEqual(result);
    expect(
      privateHandRelayResultSchema.safeParse({
        ...result,
        hands: [{ ...result.hands[0], landmarks: landmarks().slice(1) }],
      }).success,
    ).toBe(false);
    expect(
      privateHandRelayResultSchema.safeParse({
        ...result,
        hands: [
          {
            ...result.hands[0],
            landmarks: result.hands[0].landmarks.map(({ x, y, z }) => ({
              x,
              y,
              z,
            })),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      privateHandRelayResultSchema.safeParse({
        ...result,
        hands: [
          {
            ...result.hands[0],
            landmarks: result.hands[0].landmarks.map((landmark, index) =>
              index === 8 ? { ...landmark, visibility: 1.1 } : landmark,
            ),
          },
        ],
      }).success,
    ).toBe(false);
  });
});
