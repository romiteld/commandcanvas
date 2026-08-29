import { describe, expect, it, vi } from "vitest";

import {
  createHandRuntimeProfile,
  type HandRuntimePreferenceStorage,
} from "@/lib/gesture/hand-runtime-profile";

function sample(
  capturedAtMs: number,
  receivedAtMs: number,
  overrides: Record<string, number> = {},
) {
  return {
    capturedAtMs,
    receivedAtMs,
    captureLatencyMs: 4,
    processingLatencyMs: 12,
    encodeLatencyMs: 0,
    relayLatencyMs: 0,
    ...overrides,
  };
}

describe("hand runtime profile", () => {
  it("uses literal nearest-rank percentiles and retains only the bounded newest window", () => {
    const profile = createHandRuntimeProfile({
      startedAtMs: 0,
      maxSamples: 4,
    });

    for (let index = 0; index < 6; index += 1) {
      profile.recordResult(
        sample(index * 50, index * 50 + 20, {
          captureLatencyMs: index + 1,
          processingLatencyMs: (index + 1) * 10,
        }),
      );
    }

    expect(profile.snapshot()).toMatchObject({
      sampleCount: 4,
      deliveredRateHz: 20,
      captureLatencyMs: { p50: 4, p95: 6 },
      processingLatencyMs: { p50: 40, p95: 60 },
      encodeLatencyMs: { p50: 0, p95: 0 },
      relayLatencyMs: { p50: 0, p95: 0 },
      captureToReceiveMs: { p50: 20, p95: 20 },
    });
  });

  it("rejects negative and non-finite timings without contaminating metrics", () => {
    const profile = createHandRuntimeProfile({ startedAtMs: 0 });

    expect(profile.recordResult(sample(0, 20))).toBe(true);
    expect(
      profile.recordResult(sample(50, 70, { processingLatencyMs: -1 })),
    ).toBe(false);
    expect(
      profile.recordResult(sample(100, 120, { captureLatencyMs: Number.NaN })),
    ).toBe(false);
    expect(profile.acknowledgeRendered(0, Number.POSITIVE_INFINITY)).toBe(false);

    expect(profile.snapshot()).toMatchObject({
      sampleCount: 1,
      processingLatencyMs: { p50: 12, p95: 12 },
      captureToRenderMs: null,
    });
  });

  it("ignores two warmups and retains YOLO only at 18 Hz or faster with p95 at most 100 ms", () => {
    const retained = createHandRuntimeProfile({ startedAtMs: 0 });
    retained.recordResult(sample(0, 200));
    retained.recordResult(sample(20, 220));
    for (let index = 0; index < 12; index += 1) {
      const receivedAtMs = 300 + index * 50;
      retained.recordResult(sample(receivedAtMs - 90, receivedAtMs));
    }
    expect(retained.startupDecision(900)).toEqual({
      state: "retain-yolo",
      measuredSamples: 12,
      deliveredRateHz: 20,
      captureToReceiveP95Ms: 90,
      reason: "startup-thresholds-met",
    });

    const slowTail = createHandRuntimeProfile({ startedAtMs: 0 });
    slowTail.recordResult(sample(0, 10));
    slowTail.recordResult(sample(10, 20));
    for (let index = 0; index < 12; index += 1) {
      const receivedAtMs = 100 + index * 50;
      slowTail.recordResult(
        sample(receivedAtMs - (index === 11 ? 100.001 : 90), receivedAtMs),
      );
    }
    expect(slowTail.startupDecision(700)).toMatchObject({
      state: "fallback-mediapipe",
      measuredSamples: 12,
      captureToReceiveP95Ms: 100.001,
      reason: "startup-thresholds-missed",
    });
  });

  it("decides at the 1200 ms deadline with six samples and fails closed below the minimum", () => {
    const sufficient = createHandRuntimeProfile({ startedAtMs: 100 });
    sufficient.recordResult(sample(100, 110));
    sufficient.recordResult(sample(110, 120));
    for (let index = 0; index < 6; index += 1) {
      const receivedAtMs = 200 + index * 50;
      sufficient.recordResult(sample(receivedAtMs - 80, receivedAtMs));
    }
    expect(sufficient.startupDecision(1_300)).toMatchObject({
      state: "retain-yolo",
      measuredSamples: 6,
    });

    const insufficient = createHandRuntimeProfile({ startedAtMs: 100 });
    insufficient.recordResult(sample(100, 110));
    insufficient.recordResult(sample(110, 120));
    for (let index = 0; index < 5; index += 1)
      insufficient.recordResult(sample(200 + index * 50, 220 + index * 50));
    expect(insufficient.startupDecision(1_300)).toEqual({
      state: "fallback-mediapipe",
      measuredSamples: 5,
      deliveredRateHz: 20,
      captureToReceiveP95Ms: 20,
      reason: "startup-insufficient-samples",
    });
  });

  it("accepts the literal 18 Hz and 100 ms startup boundaries", () => {
    const profile = createHandRuntimeProfile({ startedAtMs: 0 });
    profile.recordResult(sample(0, 10));
    profile.recordResult(sample(10, 20));
    for (let index = 0; index < 12; index += 1) {
      const receivedAtMs = 200 + index * (1_000 / 18);
      profile.recordResult(sample(receivedAtMs - 100, receivedAtMs));
    }

    expect(profile.startupDecision(900)).toMatchObject({
      state: "retain-yolo",
      deliveredRateHz: 18,
      captureToReceiveP95Ms: 100,
    });
  });

  it("counts drops, render acknowledgements, and throttles publications for 250 ms", () => {
    const profile = createHandRuntimeProfile({ startedAtMs: 0 });
    profile.recordResult(sample(100, 140));
    profile.recordDrop("superseded");
    profile.recordDrop("late-capture", 2);
    profile.recordDrop("stale");
    expect(profile.acknowledgeRendered(100, 155)).toBe(true);

    expect(profile.shouldPublish(140)).toBe(true);
    expect(profile.shouldPublish(389.999)).toBe(false);
    expect(profile.shouldPublish(390)).toBe(true);
    expect(profile.snapshot()).toMatchObject({
      droppedSuperseded: 1,
      droppedLateCapture: 2,
      droppedStale: 1,
      captureToRenderMs: { p50: 55, p95: 55 },
    });
  });

  it("matches a render acknowledgement to the normalized capture timestamp", () => {
    const profile = createHandRuntimeProfile({ startedAtMs: 0 });
    profile.recordResult(sample(100.123456789, 140.123456789));

    expect(profile.acknowledgeRendered(100.123456789, 155.123456789)).toBe(
      true,
    );
    expect(profile.snapshot().captureToRenderMs).toEqual({ p50: 55, p95: 55 });
  });

  it("persists only a versioned privacy-safe session/model choice", () => {
    const values = new Map<string, string>();
    const storage: HandRuntimePreferenceStorage = {
      getItem: vi.fn((key) => values.get(key) ?? null),
      setItem: vi.fn((key, value) => values.set(key, value)),
    };
    const identity = {
      engineId: "yolo26-hand-pose-2abb91",
      modelVersion: "2abb91",
      deviceClass: "high-performance-gpu" as const,
    };
    const profile = createHandRuntimeProfile({
      startedAtMs: 0,
      preferenceStorage: storage,
      preferenceIdentity: identity,
    });

    profile.savePreference("fallback-mediapipe");

    const serialized = [...values.values()][0]!;
    expect(serialized).toBe(
      '{"version":1,"engineId":"yolo26-hand-pose-2abb91","modelVersion":"2abb91","deviceClass":"high-performance-gpu","choice":"fallback-mediapipe"}',
    );
    expect(serialized).not.toMatch(/label|deviceId|landmark|frame/i);
    expect(profile.loadPreference()).toBe("fallback-mediapipe");
    expect(
      createHandRuntimeProfile({
        startedAtMs: 0,
        preferenceStorage: storage,
        preferenceIdentity: { ...identity, modelVersion: "different" },
      }).loadPreference(),
    ).toBeNull();
  });

  it("keeps tracking fail-safe when session preference storage is unavailable", () => {
    const storage: HandRuntimePreferenceStorage = {
      getItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("blocked", "SecurityError");
      },
    };
    const profile = createHandRuntimeProfile({
      startedAtMs: 0,
      preferenceStorage: storage,
      preferenceIdentity: {
        engineId: "yolo26-hand-pose-2abb91",
        modelVersion: "2abb91",
        deviceClass: "gpu",
      },
    });

    expect(() => profile.savePreference("retain-yolo")).not.toThrow();
    expect(profile.loadPreference()).toBeNull();
  });
});
