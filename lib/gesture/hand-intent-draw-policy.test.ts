import { describe, expect, it } from "vitest";

import {
  createInitialHandIntentState,
  interpretHandFrame,
} from "@/lib/gesture/hand-intent";
import { rawHandLandmarks } from "@/lib/testing/hand-landmark-fixtures";

function frame(
  pose: Parameters<typeof rawHandLandmarks>[0]["pose"],
  overrides: Partial<Parameters<typeof rawHandLandmarks>[0]> = {},
) {
  return {
    landmarks: rawHandLandmarks({ pose, ...overrides }),
    confidence: 0.98,
    timestamp: 1_000,
  };
}

describe("draw-index-led hand point policy", () => {
  it("accepts a reliable extended index even when support-finger evidence is incomplete", () => {
    const observation = frame("relaxed_index", { supportVisibility: 0.2 });
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        observation,
        1_010,
        { pointPolicy: "draw-index-led" },
      ).output,
    ).toMatchObject({
      accepted: true,
      mode: "point",
      pointer: { x: 0.5, y: 0.22 },
    });
    expect(
      interpretHandFrame(createInitialHandIntentState(), observation, 1_010).output,
    ).toMatchObject({ accepted: false, reason: "no_deliberate_gesture" });
  });

  it("keeps an open palm as pen-up and refuses a curled index", () => {
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        frame("open_palm"),
        1_010,
        { pointPolicy: "draw-index-led" },
      ).output,
    ).toMatchObject({ accepted: true, mode: "open_palm" });
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        frame("fist"),
        1_010,
        { pointPolicy: "draw-index-led" },
      ).output,
    ).toMatchObject({ accepted: false, reason: "no_deliberate_gesture" });
  });

  it("accepts a foreshortened index as ink only in explicit Draw mode", () => {
    const landmarks = [...rawHandLandmarks({ pose: "relaxed_index" })];
    landmarks[6] = { x: 0.43, y: 0.6, z: 0, visibility: 0.99 };
    landmarks[7] = { x: 0.5, y: 0.55, z: 0, visibility: 0.99 };
    landmarks[8] = { x: 0.46, y: 0.48, z: 0, visibility: 0.99 };
    const observation = {
      landmarks: landmarks as unknown as ReturnType<typeof rawHandLandmarks>,
      confidence: 0.98,
      timestamp: 1_000,
    };

    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        observation,
        1_010,
        { pointPolicy: "draw-index-led" },
      ).output,
    ).toMatchObject({ accepted: true, mode: "point" });
    expect(
      interpretHandFrame(createInitialHandIntentState(), observation, 1_010)
        .output,
    ).toMatchObject({ accepted: false, reason: "no_deliberate_gesture" });
  });

  it("still refuses predicted, stale, and unreliable index observations", () => {
    const predicted = { ...frame("relaxed_index"), predicted: true };
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        predicted,
        1_010,
        { pointPolicy: "draw-index-led" },
      ).output,
    ).toMatchObject({ accepted: false, reason: "predicted_sample" });
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        { ...frame("relaxed_index"), timestamp: 700 },
        1_010,
        { pointPolicy: "draw-index-led" },
      ).output,
    ).toMatchObject({ accepted: false, reason: "stale_frame" });
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        frame("relaxed_index", { indexVisibility: 0.2 }),
        1_010,
        { pointPolicy: "draw-index-led" },
      ).output,
    ).toMatchObject({ accepted: false, reason: "low_keypoint_confidence" });
  });
});
