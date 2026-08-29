import { describe, expect, it } from "vitest";

import { filterOneEuroScalar } from "@/lib/gesture/one-euro-filter";

describe("One Euro scalar filter", () => {
  it("matches the canonical filtered-previous-value derivative reference vector", () => {
    const config = { minCutoff: 1, beta: 0.5, dCutoff: 1 } as const;
    const first = filterOneEuroScalar(null, 0, 0, config);
    const second = filterOneEuroScalar(first.state, 1, 16, config);
    const third = filterOneEuroScalar(second.state, 0.5, 32, config);

    // With a raw-previous-value derivative recurrence, the final value is
    // 0.318759 instead; the canonical filtered-previous-value recurrence is
    // intentionally distinguishable at this third sample.
    expect(second.value).toBeCloseTo(0.279284, 6);
    expect(third.value).toBeCloseTo(0.345071, 6);
  });
});
