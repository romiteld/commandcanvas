import { describe, expect, it } from "vitest";

import {
  createInitialHandIntentState,
  interpretHandFrame,
  type HandFrame,
  type HandLandmarks,
} from "@/lib/gesture/hand-intent";

const TRUE_INDEX_POINT = [
  { x: 0.5, y: 0.91, z: 0.01, visibility: 0.99 },
  { x: 0.42, y: 0.81, z: 0.01, visibility: 0.99 },
  { x: 0.34, y: 0.72, z: 0, visibility: 0.99 },
  { x: 0.24, y: 0.67, z: -0.01, visibility: 0.99 },
  { x: 0.14, y: 0.65, z: -0.02, visibility: 0.99 },
  { x: 0.41, y: 0.69, z: -0.01, visibility: 0.99 },
  { x: 0.38, y: 0.52, z: -0.03, visibility: 0.99 },
  { x: 0.35, y: 0.35, z: -0.04, visibility: 0.99 },
  { x: 0.32, y: 0.18, z: -0.05, visibility: 0.99 },
  { x: 0.5, y: 0.68, z: -0.01, visibility: 0.99 },
  { x: 0.5, y: 0.54, z: -0.02, visibility: 0.99 },
  { x: 0.51, y: 0.64, z: -0.05, visibility: 0.99 },
  { x: 0.51, y: 0.75, z: -0.06, visibility: 0.99 },
  { x: 0.59, y: 0.7, z: 0, visibility: 0.99 },
  { x: 0.61, y: 0.58, z: -0.01, visibility: 0.99 },
  { x: 0.62, y: 0.68, z: -0.04, visibility: 0.99 },
  { x: 0.6, y: 0.78, z: -0.05, visibility: 0.99 },
  { x: 0.68, y: 0.74, z: 0.01, visibility: 0.99 },
  { x: 0.71, y: 0.65, z: 0, visibility: 0.99 },
  { x: 0.71, y: 0.74, z: -0.02, visibility: 0.99 },
  { x: 0.67, y: 0.81, z: -0.03, visibility: 0.99 },
] as unknown as HandLandmarks;

const OPEN_HAND_WITH_UNRELIABLE_RING = [
  { x: 0.5, y: 0.91, z: 0.01, visibility: 0.99 },
  { x: 0.41, y: 0.81, z: 0.01, visibility: 0.99 },
  { x: 0.32, y: 0.7, z: 0, visibility: 0.99 },
  { x: 0.24, y: 0.58, z: -0.01, visibility: 0.99 },
  { x: 0.18, y: 0.48, z: -0.02, visibility: 0.99 },
  { x: 0.39, y: 0.68, z: -0.01, visibility: 0.99 },
  { x: 0.36, y: 0.51, z: -0.02, visibility: 0.99 },
  { x: 0.33, y: 0.34, z: -0.03, visibility: 0.99 },
  { x: 0.3, y: 0.18, z: -0.04, visibility: 0.99 },
  { x: 0.49, y: 0.66, z: -0.01, visibility: 0.99 },
  { x: 0.48, y: 0.48, z: -0.02, visibility: 0.99 },
  { x: 0.47, y: 0.31, z: -0.03, visibility: 0.99 },
  { x: 0.46, y: 0.14, z: -0.04, visibility: 0.99 },
  { x: 0.59, y: 0.68, z: 0, visibility: 0.99 },
  { x: 0.61, y: 0.51, z: -0.01, visibility: 0.99 },
  { x: 0.63, y: 0.34, z: -0.02, visibility: 0.99 },
  { x: 0.65, y: 0.19, z: -0.03, visibility: 0.28 },
  { x: 0.68, y: 0.72, z: 0.01, visibility: 0.99 },
  { x: 0.72, y: 0.57, z: 0, visibility: 0.99 },
  { x: 0.75, y: 0.43, z: -0.01, visibility: 0.99 },
  { x: 0.78, y: 0.3, z: -0.02, visibility: 0.99 },
] as unknown as HandLandmarks;

const LOOSE_OPEN_HAND = [
  { x: 0.5, y: 0.91, z: 0.01, visibility: 0.98 },
  { x: 0.41, y: 0.81, z: 0.01, visibility: 0.98 },
  { x: 0.33, y: 0.72, z: 0, visibility: 0.98 },
  { x: 0.25, y: 0.65, z: -0.01, visibility: 0.98 },
  { x: 0.18, y: 0.61, z: -0.02, visibility: 0.98 },
  { x: 0.4, y: 0.69, z: -0.01, visibility: 0.98 },
  { x: 0.37, y: 0.52, z: -0.02, visibility: 0.98 },
  { x: 0.34, y: 0.35, z: -0.03, visibility: 0.98 },
  { x: 0.31, y: 0.18, z: -0.04, visibility: 0.98 },
  { x: 0.49, y: 0.68, z: -0.01, visibility: 0.98 },
  { x: 0.49, y: 0.52, z: -0.02, visibility: 0.98 },
  { x: 0.45, y: 0.5, z: -0.03, visibility: 0.98 },
  { x: 0.47, y: 0.49, z: -0.04, visibility: 0.98 },
  { x: 0.59, y: 0.7, z: 0, visibility: 0.98 },
  { x: 0.61, y: 0.55, z: -0.01, visibility: 0.98 },
  { x: 0.65, y: 0.53, z: -0.02, visibility: 0.98 },
  { x: 0.65, y: 0.51, z: -0.03, visibility: 0.98 },
  { x: 0.68, y: 0.74, z: 0.01, visibility: 0.98 },
  { x: 0.72, y: 0.61, z: 0, visibility: 0.98 },
  { x: 0.77, y: 0.61, z: -0.01, visibility: 0.98 },
  { x: 0.78, y: 0.59, z: -0.02, visibility: 0.98 },
] as unknown as HandLandmarks;

const NOISY_FIST = [
  { x: 0.5, y: 0.91, z: 0.01, visibility: 0.97 },
  { x: 0.42, y: 0.82, z: 0.01, visibility: 0.97 },
  { x: 0.34, y: 0.75, z: 0, visibility: 0.97 },
  { x: 0.27, y: 0.7, z: -0.01, visibility: 0.97 },
  { x: 0.22, y: 0.66, z: -0.02, visibility: 0.97 },
  { x: 0.39, y: 0.73, z: -0.01, visibility: 0.97 },
  { x: 0.33, y: 0.61, z: -0.02, visibility: 0.97 },
  { x: 0.45, y: 0.54, z: -0.05, visibility: 0.97 },
  { x: 0.38, y: 0.48, z: -0.06, visibility: 0.97 },
  { x: 0.49, y: 0.7, z: -0.01, visibility: 0.97 },
  { x: 0.49, y: 0.58, z: -0.02, visibility: 0.97 },
  { x: 0.51, y: 0.68, z: -0.05, visibility: 0.97 },
  { x: 0.52, y: 0.78, z: -0.06, visibility: 0.97 },
  { x: 0.59, y: 0.72, z: 0, visibility: 0.97 },
  { x: 0.61, y: 0.61, z: -0.01, visibility: 0.97 },
  { x: 0.62, y: 0.71, z: -0.04, visibility: 0.97 },
  { x: 0.61, y: 0.8, z: -0.05, visibility: 0.97 },
  { x: 0.68, y: 0.76, z: 0.01, visibility: 0.97 },
  { x: 0.7, y: 0.67, z: 0, visibility: 0.97 },
  { x: 0.69, y: 0.75, z: -0.02, visibility: 0.97 },
  { x: 0.66, y: 0.82, z: -0.03, visibility: 0.97 },
] as unknown as HandLandmarks;

function frame(landmarks: HandLandmarks): HandFrame {
  return { landmarks, confidence: 0.98, timestamp: 1_000 };
}

describe("deliberate index-point pose", () => {
  it("refuses an open hand when one non-index finger is unreliable", () => {
    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      frame(OPEN_HAND_WITH_UNRELIABLE_RING),
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: false,
      mode: "idle",
      reason: "no_deliberate_gesture",
    });
  });

  it("refuses a loose open hand that is neither a palm nor a point", () => {
    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      frame(LOOSE_OPEN_HAND),
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: false,
      mode: "idle",
      reason: "no_deliberate_gesture",
    });
  });

  it("refuses a noisy fist whose index tip alone appears far from the wrist", () => {
    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      frame(NOISY_FIST),
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: false,
      mode: "idle",
      reason: "no_deliberate_gesture",
    });
  });

  it("accepts a straight index point with folded fingers and a natural thumb", () => {
    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      frame(TRUE_INDEX_POINT),
      1_000,
    );

    expect(transition.output).toMatchObject({
      accepted: true,
      mode: "point",
      pointer: { x: 0.32, y: 0.18 },
    });
  });
});
