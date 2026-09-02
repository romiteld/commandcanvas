import { describe, expect, it } from "vitest";

import {
  classifyGestureSequence,
  trainTemporalGestureClassifier,
} from "@/lib/gesture/learning/model";
import {
  makeLandmarks,
  makeSequence,
} from "@/lib/gesture/learning/test-fixtures.test-support";

function trainingRecords() {
  return Array.from({ length: 24 }, (_, index) => {
    const pinch = index % 2 === 1;
    return makeSequence({
      sequenceId: `training-${index}`,
      sessionId: `session-${Math.floor(index / 2)}`,
      label: pinch ? "pinch" : "open_palm",
      context: {
        interactionMode: "manipulate",
        targetPresent: pinch,
        selectedObjectPresent: false,
        edgeZone: "none",
      },
      frames: Array.from({ length: 5 }, (_, frameIndex) => ({
        elapsedMs: frameIndex * 16,
        hands: [
          {
            trackId: "right-1",
            handedness: "right",
            confidence: 0.98,
            landmarks: makeLandmarks(
              pinch
                ? { pinch: frameIndex >= 2, offsetX: 0.45 + frameIndex * 0.002 }
                : { openPalm: true, offsetX: 0.45 + frameIndex * 0.002 },
            ),
          },
        ],
      })),
    });
  });
}

describe("temporal gesture classifier", () => {
  it("trains a deterministic model and exports enough metadata for JS inference", () => {
    const first = trainTemporalGestureClassifier(trainingRecords(), {
      frameCount: 6,
      epochs: 160,
      learningRate: 0.12,
      seed: 17,
    });
    const second = trainTemporalGestureClassifier(trainingRecords(), {
      frameCount: 6,
      epochs: 160,
      learningRate: 0.12,
      seed: 17,
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: "commandcanvas.temporal-gesture-model/v1",
      featureContract: "commandcanvas.gesture-features/v1",
      frameCount: 6,
      classes: ["open_palm", "pinch"],
      productionEligible: false,
      training: {
        sourceKinds: ["first_party_consent"],
        sequenceCount: 24,
        sessionCount: 12,
      },
    });
    expect(first.weights).toHaveLength(2);
    expect(first.weights[0]).toHaveLength(first.inputSize);
  });

  it("classifies held-out pinch and open-palm sequences after training", () => {
    const model = trainTemporalGestureClassifier(trainingRecords(), {
      frameCount: 6,
      epochs: 180,
      learningRate: 0.12,
      seed: 21,
    });
    const pinch = makeSequence({
      sequenceId: "held-out-pinch",
      sessionId: "held-out-session-a",
      label: "pinch",
      context: {
        interactionMode: "manipulate",
        targetPresent: true,
        selectedObjectPresent: false,
        edgeZone: "none",
      },
      frames: Array.from({ length: 5 }, (_, frameIndex) => ({
        elapsedMs: frameIndex * 20,
        hands: [
          {
            trackId: "right-held-out",
            handedness: "right",
            confidence: 0.97,
            landmarks: makeLandmarks({ pinch: frameIndex >= 2, offsetX: 0.68 }),
          },
        ],
      })),
    });
    const openPalm = makeSequence({
      sequenceId: "held-out-open",
      sessionId: "held-out-session-b",
      label: "open_palm",
      frames: Array.from({ length: 5 }, (_, frameIndex) => ({
        elapsedMs: frameIndex * 20,
        hands: [
          {
            trackId: "left-held-out",
            handedness: "left",
            confidence: 0.97,
            landmarks: makeLandmarks({ openPalm: true, offsetX: 0.28 }),
          },
        ],
      })),
    });

    expect(classifyGestureSequence(model, pinch).label).toBe("pinch");
    expect(classifyGestureSequence(model, openPalm).label).toBe("open_palm");
  });

  it("refuses synthetic-only records unless the caller explicitly enables smoke training", () => {
    const synthetic = trainingRecords().map((record) => ({
      ...record,
      provenance: {
        kind: "synthetic",
        generator: "commandcanvas-test-fixture/v1",
        productionEligible: false,
      },
    }));

    expect(() =>
      trainTemporalGestureClassifier(synthetic, {
        frameCount: 6,
        epochs: 10,
        learningRate: 0.1,
        seed: 1,
      }),
    ).toThrowError(/non-production data/i);
  });
});
