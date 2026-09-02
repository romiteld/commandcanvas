import { describe, expect, it } from "vitest";

import {
  computeTwoHandIdentityContinuity,
  extractGestureFeatureVector,
} from "@/lib/gesture/learning/features";
import {
  makeLandmarks,
  makeSequence,
} from "@/lib/gesture/learning/test-fixtures.test-support";

describe("temporal hand feature extraction", () => {
  it("normalizes one-hand pose and motion against camera translation and hand scale", () => {
    const base = makeSequence();
    const transformed = makeSequence({
      sequenceId: "sequence-transformed",
      frames: Array.from({ length: 5 }, (_, index) => ({
        elapsedMs: index * 16,
        hands: [
          {
            trackId: "right-1",
            handedness: "right",
            confidence: 0.98,
            landmarks: makeLandmarks({
              offsetX: 0.65 + index * 0.02,
              offsetY: 0.42,
              scale: 0.36,
            }),
          },
        ],
      })),
    });

    const left = extractGestureFeatureVector(base, { frameCount: 8 });
    const right = extractGestureFeatureVector(transformed, { frameCount: 8 });

    expect(left.values).toHaveLength(right.values.length);
    expect(left.frameFeatureSize).toBe(152);
    expect(left.values).toEqual(right.values);
  });

  it("preserves temporal pinch change instead of reducing a sequence to one pose", () => {
    const open = makeSequence();
    const closing = makeSequence({
      label: "pinch",
      context: {
        interactionMode: "manipulate",
        targetPresent: true,
        selectedObjectPresent: false,
        edgeZone: "none",
      },
      frames: Array.from({ length: 5 }, (_, index) => ({
        elapsedMs: index * 16,
        hands: [
          {
            trackId: "right-1",
            handedness: "right",
            confidence: 0.98,
            landmarks: makeLandmarks({ pinch: index >= 2 }),
          },
        ],
      })),
    });

    expect(extractGestureFeatureVector(open, { frameCount: 8 }).values).not.toEqual(
      extractGestureFeatureVector(closing, { frameCount: 8 }).values,
    );
  });

  it("measures stable two-hand identities across crossing trajectories", () => {
    const stable = makeSequence({
      label: "bimanual_resize",
      frames: Array.from({ length: 4 }, (_, index) => ({
        elapsedMs: index * 16,
        hands: [
          {
            trackId: "hand-a",
            handedness: "left",
            confidence: 0.98,
            landmarks: makeLandmarks({ offsetX: 0.25 + index * 0.2 }),
          },
          {
            trackId: "hand-b",
            handedness: "right",
            confidence: 0.98,
            landmarks: makeLandmarks({ offsetX: 0.75 - index * 0.2 }),
          },
        ],
      })),
    });
    const broken = makeSequence({
      ...stable,
      sequenceId: "sequence-broken",
      frames: stable.frames.map((frame: { hands: Array<Record<string, unknown>> }, index: number) => ({
        ...frame,
        hands:
          index === 2
            ? frame.hands.map((hand, handIndex) => ({
                ...hand,
                trackId: handIndex === 0 ? "replacement" : hand.trackId,
              }))
            : frame.hands,
      })),
    });

    expect(computeTwoHandIdentityContinuity(stable)).toBe(1);
    expect(computeTwoHandIdentityContinuity(broken)).toBeLessThan(1);
  });
});
