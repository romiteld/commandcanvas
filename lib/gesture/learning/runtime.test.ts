import { describe, expect, it } from "vitest";

import { extractGestureFeatureVector } from "@/lib/gesture/learning/features";
import type { TemporalGestureModel } from "@/lib/gesture/learning/model";
import { classifyGestureWithRefusal } from "@/lib/gesture/learning/runtime";
import { makeSequence } from "@/lib/gesture/learning/test-fixtures.test-support";

describe("learned gesture runtime refusal gate", () => {
  it("refuses a model that has not passed held-out promotion thresholds", () => {
    const sequence = makeSequence();
    const model = biasedModel(sequence, ["point", "pinch"], [0, 8], false);

    expect(classifyGestureWithRefusal(model, sequence, { minConfidence: 0.8 })).toEqual({
      accepted: false,
      reason: "model_not_promoted",
      prediction: { label: "pinch", confidence: 0.999665 },
    });
  });

  it("refuses an ambiguous prediction instead of acquiring a canvas object", () => {
    const sequence = makeSequence();
    const model = biasedModel(sequence, ["point", "pinch"], [0, 0.2], true);

    expect(classifyGestureWithRefusal(model, sequence, { minConfidence: 0.8 })).toEqual({
      accepted: false,
      reason: "low_confidence",
      prediction: { label: "pinch", confidence: 0.549834 },
    });
  });

  it("never converts a learned destructive label directly into an action", () => {
    const sequence = makeSequence();
    const model = biasedModel(sequence, ["point", "throw"], [0, 8], true);

    expect(classifyGestureWithRefusal(model, sequence, { minConfidence: 0.8 })).toEqual({
      accepted: false,
      reason: "requires_canonical_edge_state_machine",
      prediction: { label: "throw", confidence: 0.999665 },
    });
  });
});

function biasedModel(
  sequence: ReturnType<typeof makeSequence>,
  classes: TemporalGestureModel["classes"],
  bias: number[],
  productionEligible: boolean,
): TemporalGestureModel {
  const feature = extractGestureFeatureVector(sequence, { frameCount: 4 });
  return {
    schemaVersion: "commandcanvas.temporal-gesture-model/v1",
    featureContract: "commandcanvas.gesture-features/v1",
    frameCount: 4,
    inputSize: feature.inputSize,
    classes,
    featureMean: Array.from({ length: feature.inputSize }, () => 0),
    featureScale: Array.from({ length: feature.inputSize }, () => 1),
    weights: classes.map(() => Array.from({ length: feature.inputSize }, () => 0)),
    bias,
    productionEligible,
    training: {
      algorithm: "multinomial-logistic-regression",
      epochs: 1,
      learningRate: 0.1,
      l2: 0,
      seed: 1,
      sequenceCount: 2,
      sessionCount: 2,
      sourceKinds: ["synthetic"],
      datasetDigest: "fixture",
      validationStatus: productionEligible ? "held_out_evaluated" : "not_evaluated",
    },
  };
}
