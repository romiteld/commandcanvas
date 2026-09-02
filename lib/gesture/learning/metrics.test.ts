import { describe, expect, it } from "vitest";

import { evaluateGesturePredictions } from "@/lib/gesture/learning/metrics";

describe("gesture evaluation metrics", () => {
  it("reports literal per-class metrics, confusion, and false-grab rate", () => {
    const metrics = evaluateGesturePredictions(
      ["point", "point", "pinch", "open_palm", "open_palm"],
      ["point", "pinch", "pinch", "open_palm", "held"],
      { twoHandContinuity: [1, 0.5] },
    );

    expect(metrics.accuracy).toBe(0.6);
    expect(metrics.perClass.point).toEqual({
      precision: 1,
      recall: 0.5,
      f1: 0.666667,
      support: 2,
    });
    expect(metrics.confusionMatrix).toMatchObject({
      labels: ["held", "open_palm", "pinch", "point"],
      values: [
        [0, 0, 0, 0],
        [1, 1, 0, 0],
        [0, 0, 1, 0],
        [0, 0, 1, 1],
      ],
    });
    expect(metrics.falseGrabRate).toBe(0.5);
    expect(metrics.twoHandIdentityContinuity).toBe(0.75);
  });
});
