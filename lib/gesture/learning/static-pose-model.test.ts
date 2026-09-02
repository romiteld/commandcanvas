import { describe, expect, it } from "vitest";

import { classifyGestureSequence } from "@/lib/gesture/learning/model";
import {
  classifyStaticHandPose,
  compactTemporalModelToStaticPose,
  extractStaticHandPoseFeatures,
} from "@/lib/gesture/learning/static-pose-model";
import { makeNeutralTemporalModel } from "@/lib/gesture/learning/static-pose-model.test-support";
import {
  makeLandmarks,
  makeSequence,
} from "@/lib/gesture/learning/test-fixtures.test-support";

describe("compact static hand-pose model", () => {
  it("folds repeated temporal blocks without changing static-pose probabilities", () => {
    const sequence = makeSequence({
      context: {
        interactionMode: "manipulate",
        targetPresent: false,
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
            landmarks: makeLandmarks({ offsetX: 0.45 }),
          },
        ],
      })),
    });
    const temporal = makeNeutralTemporalModel(sequence);
    const compact = compactTemporalModelToStaticPose(temporal);

    expect(compact).toMatchObject({
      schemaVersion: "commandcanvas.static-hand-pose-model/v1",
      inputSize: 72,
      classes: ["open_palm", "pinch", "point"],
      productionEligible: true,
      sourceAttribution: temporal.sourceAttribution,
      compactionAudit: {
        sourceModelSchema: "commandcanvas.temporal-gesture-model/v1",
        sourceFrameCount: 8,
        maxNeutralStandardizedResidual: 0,
        maxNeutralLogitContribution: 0,
      },
    });
    const full = classifyGestureSequence(temporal, sequence);
    const hand = sequence.frames[0]!.hands[0]! as Parameters<
      typeof extractStaticHandPoseFeatures
    >[0];
    const reduced = classifyStaticHandPose(
      compact,
      extractStaticHandPoseFeatures(hand),
    );
    expect(reduced.label).toBe(full.label);
    for (const label of temporal.classes)
      expect(reduced.probabilities[label]).toBeCloseTo(
        full.probabilities[label]!,
        8,
      );
  });

  it("refuses compaction when non-hand features are not neutral in the source artifact", () => {
    const sequence = makeSequence();
    const temporal = makeNeutralTemporalModel(sequence);
    const corruptedMean = [...temporal.featureMean];
    corruptedMean[72] = corruptedMean[72]! + 0.25;

    expect(() =>
      compactTemporalModelToStaticPose({
        ...temporal,
        featureMean: corruptedMean,
      }),
    ).toThrowError(/neutral static feature residual/i);
  });
});
