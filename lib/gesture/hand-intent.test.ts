import { describe, expect, it } from "vitest";

import {
  createInitialHandIntentState,
  interpretHandFrame,
  type HandFrame,
  type HandLandmark,
  type HandLandmarks,
} from "@/lib/gesture/hand-intent";

function frame(input?: {
  index?: { x: number; y: number };
  thumb?: { x: number; y: number };
  indexVisibility?: number;
  thumbVisibility?: number;
  confidence?: number;
  timestamp?: number;
}): HandFrame {
  const landmarks = pointingHand();
  const index = input?.index ?? { x: 0.5, y: 0.5 };
  landmarks[4] = {
    ...(input?.thumb ?? { x: 0.2, y: 0.5 }),
    z: 0,
    visibility: input?.thumbVisibility ?? 0.95,
  };
  landmarks[8] = {
    ...index,
    z: 0,
    visibility: input?.indexVisibility ?? 0.95,
  };
  const indexMcp = landmarks[5];
  landmarks[6] = {
    x: indexMcp.x + (index.x - indexMcp.x) * 0.34,
    y: indexMcp.y + (index.y - indexMcp.y) * 0.34,
    z: 0,
  };
  landmarks[7] = {
    x: indexMcp.x + (index.x - indexMcp.x) * 0.67,
    y: indexMcp.y + (index.y - indexMcp.y) * 0.67,
    z: 0,
  };
  return {
    landmarks: landmarks as unknown as HandLandmarks,
    confidence: input?.confidence ?? 0.96,
    timestamp: input?.timestamp ?? 1_000,
  };
}

function pointingHand(): HandLandmark[] {
  const landmarks = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.7,
    z: 0,
  }));
  landmarks[0] = { x: 0.5, y: 0.9, z: 0 };
  landmarks[5] = { x: 0.5, y: 0.68, z: 0 };
  landmarks[6] = { x: 0.5, y: 0.52, z: 0 };
  landmarks[7] = { x: 0.5, y: 0.4, z: 0 };
  landmarks[8] = { x: 0.5, y: 0.25, z: 0 };
  for (const [mcp, pip, dip, tip, x] of [
    [9, 10, 11, 12, 0.58],
    [13, 14, 15, 16, 0.65],
    [17, 18, 19, 20, 0.72],
  ] as const) {
    landmarks[mcp] = { x, y: 0.67, z: 0 };
    landmarks[pip] = { x, y: 0.55, z: 0 };
    landmarks[dip] = { x, y: 0.64, z: 0 };
    landmarks[tip] = { x, y: 0.72, z: 0 };
  }
  return landmarks;
}

function openPalmFrame(timestamp = 1_000): HandFrame {
  const landmarks = pointingHand();
  for (const [mcp, pip, dip, tip, x] of [
    [9, 10, 11, 12, 0.58],
    [13, 14, 15, 16, 0.65],
    [17, 18, 19, 20, 0.72],
  ] as const) {
    landmarks[mcp] = { x, y: 0.67, z: 0 };
    landmarks[pip] = { x, y: 0.51, z: 0 };
    landmarks[dip] = { x, y: 0.38, z: 0 };
    landmarks[tip] = { x, y: 0.24, z: 0 };
  }
  landmarks[4] = { x: 0.22, y: 0.5, z: 0 };
  return {
    landmarks: landmarks as unknown as HandLandmarks,
    confidence: 0.96,
    timestamp,
  };
}

function scaleFrameAroundWrist(input: HandFrame, scale: number): HandFrame {
  const wrist = input.landmarks[0];
  return {
    ...input,
    landmarks: input.landmarks.map((point) => ({
      x: wrist.x + (point.x - wrist.x) * scale,
      y: wrist.y + (point.y - wrist.y) * scale,
      z: point.z,
    })) as unknown as HandLandmarks,
  };
}

describe("hand intent validation", () => {
  it("maps a verified 21-landmark frame to a normalized index-tip pointer", () => {
    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      frame({ index: { x: 0.62, y: 0.28 } }),
      1_020,
    );

    expect(transition.output).toEqual({
      accepted: true,
      mode: "point",
      pointer: { x: 0.62, y: 0.28 },
      motionPointer: { x: 0.59, y: 0.718 },
      confidence: 0.96,
      timestamp: 1_000,
      pinchDistance: 0.474131,
      pinchRatio: 2.154029,
    });
  });

  it.each([
    ["malformed_landmarks", { ...frame(), landmarks: frame().landmarks.slice(0, 20) }],
    [
      "malformed_landmarks",
      {
        ...frame(),
        landmarks: frame().landmarks.map((point, index) =>
          index === 8 ? { ...point, x: Number.NaN } : point,
        ),
      },
    ],
    [
      "malformed_landmarks",
      {
        ...frame(),
        landmarks: frame().landmarks.map((point, index) =>
          index === 8 ? { ...point, y: 1.2 } : point,
        ),
      },
    ],
    ["low_confidence", frame({ confidence: 0.4 })],
    ["stale_frame", frame({ timestamp: 700 })],
    ["future_frame", frame({ timestamp: 1_200 })],
  ])("refuses %s input and fails closed to idle", (reason, input) => {
    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      input,
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: false,
      mode: "idle",
      pointer: null,
      reason,
    });
    expect(transition.state).toEqual(createInitialHandIntentState());
  });

  it("refuses a non-monotonic frame instead of replaying an old gesture", () => {
    const first = interpretHandFrame(
      createInitialHandIntentState(),
      frame({ timestamp: 1_000 }),
      1_010,
    );
    const replay = interpretHandFrame(
      first.state,
      frame({ timestamp: 1_000 }),
      1_020,
    );

    expect(replay.output).toMatchObject({
      accepted: false,
      mode: "idle",
      reason: "out_of_order_frame",
    });
  });

  it("recognizes an open palm without turning it into index-finger drawing", () => {
    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      openPalmFrame(),
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: true,
      mode: "open_palm",
      pointer: { x: 0.5, y: 0.25 },
    });
  });

  it("refuses a relaxed index pose instead of treating a fist as drawing", () => {
    const base = frame();
    const landmarks = [...base.landmarks] as HandLandmark[];
    landmarks[6] = { x: 0.5, y: 0.7, z: 0, visibility: 0.95 };
    landmarks[8] = { x: 0.5, y: 0.72, z: 0, visibility: 0.95 };
    const relaxed = {
      ...base,
      landmarks: landmarks as unknown as HandLandmarks,
    };

    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      relaxed,
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: false,
      mode: "idle",
      pointer: null,
      reason: "no_deliberate_gesture",
    });
  });

  it("keeps pinch authoritative even when the index is curled", () => {
    const base = frame({ thumb: { x: 0.5, y: 0.72 } });
    const landmarks = [...base.landmarks] as HandLandmark[];
    landmarks[6] = { x: 0.5, y: 0.7, z: 0, visibility: 0.95 };
    landmarks[8] = { x: 0.5, y: 0.72, z: 0, visibility: 0.95 };
    landmarks[4] = { x: 0.505, y: 0.72, z: 0, visibility: 0.95 };

    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      { ...base, landmarks: landmarks as unknown as HandLandmarks },
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: true,
      mode: "pinch",
    });
  });

  it("keeps physical measurements separate from the mode-dependent observation", () => {
    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      frame({ index: { x: 0.62, y: 0.28 } }),
      1_020,
    );

    expect(transition).toMatchObject({
      measurements: {
        indexTip: { x: 0.62, y: 0.28 },
        thumbTip: { x: 0.2, y: 0.5 },
        pinchMidpoint: { x: 0.41, y: 0.39 },
        palmMcpCentroid: { x: 0.59, y: 0.718 },
        pinchRatio: 2.154029,
        confidence: 0.96,
      },
    });
  });

  it("marks a predicted sample and refuses to let it enter semantic state", () => {
    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      { ...frame(), predicted: true },
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: false,
      mode: "idle",
      reason: "predicted_sample",
    });
    expect(transition.state).toEqual(createInitialHandIntentState());
  });

  it("leaves a latched pinch and filter state untouched for a predicted sample", () => {
    const latched = interpretHandFrame(
      createInitialHandIntentState(),
      frame({
        thumb: { x: 0.48, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_000,
      }),
      1_000,
    );
    expect(latched.output).toMatchObject({ accepted: true, mode: "pinch" });

    const predicted = interpretHandFrame(
      latched.state,
      {
        ...frame({
          thumb: { x: 0.2, y: 0.5 },
          index: { x: 0.8, y: 0.4 },
          timestamp: 1_016,
        }),
        predicted: true,
      },
      1_016,
    );

    expect(predicted.output).toMatchObject({
      accepted: false,
      mode: "idle",
      reason: "predicted_sample",
    });
    expect(predicted.prediction).toEqual({ predicted: true });
    expect(predicted.state).toEqual(latched.state);

    const resumed = interpretHandFrame(
      predicted.state,
      frame({
        thumb: { x: 0.44, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_016,
      }),
      1_016,
    );
    expect(resumed.output).toMatchObject({ accepted: true, mode: "pinch" });
  });
});

describe("pointer smoothing", () => {
  it("uses capture timestamps to apply the One Euro cutoff to index coordinates", () => {
    const first = interpretHandFrame(
      createInitialHandIntentState(),
      frame({ index: { x: 0.3, y: 0.4 }, timestamp: 1_000 }),
      1_000,
    );
    const next = interpretHandFrame(
      first.state,
      frame({ index: { x: 0.6, y: 0.4 }, timestamp: 1_016 }),
      1_016,
    );

    expect(next.output).toMatchObject({
      accepted: true,
      pointer: { x: expect.closeTo(0.3277, 3), y: 0.4 },
    });
  });

  it("suppresses index-tip jitter with the timestamp-aware One Euro filter", () => {
    const first = interpretHandFrame(
      createInitialHandIntentState(),
      frame({
        index: { x: 0.5, y: 0.5 },
        thumb: { x: 0.2, y: 0.5 },
        timestamp: 1_000,
      }),
      1_000,
    );
    const jittered = interpretHandFrame(
      first.state,
      frame({
        index: { x: 0.54, y: 0.46 },
        thumb: { x: 0.2, y: 0.5 },
        timestamp: 1_016,
      }),
      1_016,
    );

    expect(jittered.output).toMatchObject({
      accepted: true,
      mode: "point",
      pointer: {
        x: expect.closeTo(0.5037, 3),
        y: expect.closeTo(0.4963, 3),
      },
    });
  });

  it("optionally mirrors the normalized x coordinate without changing y", () => {
    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      frame({ index: { x: 0.2, y: 0.7 } }),
      1_000,
      { mirrorX: true },
    );

    expect(transition.output.pointer).toEqual({ x: 0.8, y: 0.7 });
  });

  it("adapts filtering to the capture interval while retaining stationary jitter suppression", () => {
    const first = interpretHandFrame(
      createInitialHandIntentState(),
      frame({ index: { x: 0.3, y: 0.4 }, timestamp: 1_000 }),
      1_000,
    );
    const jitter = interpretHandFrame(
      first.state,
      frame({ index: { x: 0.304, y: 0.396 }, timestamp: 1_016 }),
      1_016,
    );
    const fast = interpretHandFrame(
      jitter.state,
      frame({ index: { x: 0.65, y: 0.4 }, timestamp: 1_032 }),
      1_032,
    );

    expect(jitter.output).toMatchObject({
      accepted: true,
      pointer: {
        x: expect.closeTo(0.3004, 3),
        y: expect.closeTo(0.3996, 3),
      },
    });
    expect(fast.output.accepted && fast.output.pointer.x).toBeGreaterThan(0.33);
  });

  it("does not contaminate the next index pointer with an open-palm center", () => {
    const palm = interpretHandFrame(
      createInitialHandIntentState(),
      openPalmFrame(1_000),
      1_000,
    );
    const point = interpretHandFrame(
      palm.state,
      frame({ index: { x: 0.2, y: 0.25 }, timestamp: 1_016 }),
      1_016,
    );

    expect(point.output).toMatchObject({
      accepted: true,
      mode: "point",
      pointer: { x: expect.closeTo(0.4722, 3), y: 0.25 },
    });
  });
});

describe("pinch hysteresis", () => {
  const exact = {
    smoothingAlpha: 1,
    pinchEngageRatio: 0.2,
    pinchReleaseRatio: 0.4,
  } as const;

  it("engages the default pinch before fingertip-perfect contact", () => {
    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      frame({
        thumb: { x: 0.445, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_000,
      }),
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: true,
      mode: "pinch",
    });
  });

  it("recognizes the same pinch ratio near and far from the camera", () => {
    const near = frame({
      thumb: { x: 0.455, y: 0.5 },
      index: { x: 0.5, y: 0.5 },
      timestamp: 1_000,
    });
    const far = scaleFrameAroundWrist(
      { ...near, timestamp: 1_016 },
      0.55,
    );

    const nearResult = interpretHandFrame(
      createInitialHandIntentState(),
      near,
      1_000,
    );
    const farResult = interpretHandFrame(
      createInitialHandIntentState(),
      far,
      1_016,
    );

    expect(nearResult.output).toMatchObject({ accepted: true, mode: "pinch" });
    expect(farResult.output).toMatchObject({ accepted: true, mode: "pinch" });
    expect(
      nearResult.output.accepted ? nearResult.output.pinchRatio : null,
    ).toBeCloseTo(farResult.output.accepted ? farResult.output.pinchRatio : 0, 5);
  });

  it("engages a new pinch from the current geometry without waiting for pointer smoothing", () => {
    const open = interpretHandFrame(
      createInitialHandIntentState(),
      frame({
        thumb: { x: 0.2, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_000,
      }),
      1_000,
    );
    const pinched = interpretHandFrame(
      open.state,
      frame({
        thumb: { x: 0.47, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_016,
      }),
      1_016,
    );

    expect(pinched.output).toMatchObject({ accepted: true, mode: "pinch" });
  });

  it("does not engage a new pinch from an unreliable thumb or index tip", () => {
    const unreliableThumb = interpretHandFrame(
      createInitialHandIntentState(),
      frame({
        thumb: { x: 0.48, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        thumbVisibility: 0.2,
      }),
      1_000,
    );
    const unreliableIndex = interpretHandFrame(
      createInitialHandIntentState(),
      frame({
        thumb: { x: 0.48, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        indexVisibility: 0.2,
      }),
      1_000,
    );

    expect(unreliableThumb.output).toMatchObject({
      accepted: true,
      mode: "point",
    });
    expect(unreliableIndex.output).toMatchObject({
      accepted: false,
      mode: "idle",
      reason: "low_keypoint_confidence",
    });
  });

  it("does not release a latched pinch from a low-confidence thumb while retaining an index pointer", () => {
    const latched = interpretHandFrame(
      createInitialHandIntentState(),
      frame({
        thumb: { x: 0.48, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_000,
      }),
      1_000,
      exact,
    );
    expect(latched.output).toMatchObject({ accepted: true, mode: "pinch" });

    const uncertainThumb = interpretHandFrame(
      latched.state,
      frame({
        thumb: { x: 0.2, y: 0.5 },
        thumbVisibility: 0.2,
        index: { x: 0.7, y: 0.4 },
        indexVisibility: 0.95,
        timestamp: 1_016,
      }),
      1_016,
      exact,
    );

    expect(uncertainThumb.state.pinchLatched).toBe(true);
    expect(uncertainThumb.output).toMatchObject({
      accepted: true,
      mode: "pinch",
      pointer: { x: expect.any(Number), y: expect.any(Number) },
    });
  });

  it("refuses an open hand with unreliable non-index fingertips instead of drawing", () => {
    const base = openPalmFrame();
    const landmarks = [...base.landmarks] as HandLandmark[];
    for (const index of [12, 16, 20])
      landmarks[index] = { ...landmarks[index]!, visibility: 0.2 };

    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      { ...base, landmarks: landmarks as unknown as HandLandmarks },
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: false,
      mode: "idle",
      pointer: null,
      reason: "no_deliberate_gesture",
    });
    expect(transition.measurements).toMatchObject({
      indexTip: { x: expect.any(Number), y: expect.any(Number) },
      thumbTip: { x: expect.any(Number), y: expect.any(Number) },
      pinchRatio: expect.any(Number),
      palmScale: expect.any(Number),
    });
  });

  it("requires reliable wrist, MCP, and PIP geometry before classifying an open palm", () => {
    const base = openPalmFrame();
    const landmarks = [...base.landmarks] as HandLandmark[];
    landmarks[6] = { ...landmarks[6]!, visibility: 0.2 };

    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      { ...base, landmarks: landmarks as unknown as HandLandmarks },
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: false,
      mode: "idle",
      pointer: null,
      reason: "no_deliberate_gesture",
    });
  });

  it("engages below the close threshold, stays latched in the gap, and releases above the far threshold", () => {
    const unlatchedGap = interpretHandFrame(
      createInitialHandIntentState(),
      frame({
        thumb: { x: 0.44, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_000,
      }),
      1_000,
      exact,
    );
    expect(unlatchedGap.output.mode).toBe("point");

    const engaged = interpretHandFrame(
      unlatchedGap.state,
      frame({
        thumb: { x: 0.47, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_016,
      }),
      1_016,
      exact,
    );
    expect(engaged.output.mode).toBe("pinch");

    const heldInGap = interpretHandFrame(
      engaged.state,
      frame({
        thumb: { x: 0.44, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_032,
      }),
      1_032,
      exact,
    );
    expect(heldInGap.output.mode).toBe("pinch");

    const released = interpretHandFrame(
      heldInGap.state,
      frame({
        thumb: { x: 0.41, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_048,
      }),
      1_048,
      exact,
    );
    expect(released.output.mode).toBe("point");
  });

  it("does not latch a low-confidence false-positive pinch", () => {
    const refused = interpretHandFrame(
      createInitialHandIntentState(),
      frame({
        thumb: { x: 0.48, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        confidence: 0.3,
        timestamp: 1_000,
      }),
      1_000,
      exact,
    );
    expect(refused.output).toMatchObject({
      accepted: false,
      mode: "idle",
      reason: "low_confidence",
    });

    const thresholdGap = interpretHandFrame(
      refused.state,
      frame({
        thumb: { x: 0.44, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        confidence: 0.96,
        timestamp: 1_016,
      }),
      1_016,
      exact,
    );
    expect(thresholdGap.output.mode).toBe("point");
  });

  it("releases safely to idle when tracking becomes stale, then requires a fresh engage", () => {
    const pinched = interpretHandFrame(
      createInitialHandIntentState(),
      frame({
        thumb: { x: 0.48, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_000,
      }),
      1_000,
      exact,
    );
    expect(pinched.output.mode).toBe("pinch");

    const lost = interpretHandFrame(
      pinched.state,
      frame({ timestamp: 1_016 }),
      1_500,
      exact,
    );
    expect(lost.output).toMatchObject({
      accepted: false,
      mode: "idle",
      pointer: null,
      reason: "stale_frame",
    });

    const backInGap = interpretHandFrame(
      lost.state,
      frame({
        thumb: { x: 0.44, y: 0.5 },
        index: { x: 0.5, y: 0.5 },
        timestamp: 1_516,
      }),
      1_516,
      exact,
    );
    expect(backInGap.output.mode).toBe("point");
  });
});
