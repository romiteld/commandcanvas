import { describe, expect, it } from "vitest";

import {
  parseGestureDatasetJsonl,
  serializeGestureDatasetJsonl,
  splitGestureDatasetBySession,
} from "@/lib/gesture/learning/dataset";
import { makeSequence } from "@/lib/gesture/learning/test-fixtures.test-support";

describe("gesture sequence dataset", () => {
  it("rejects a captured sequence that has no explicit training consent", () => {
    const sequence = makeSequence({
      provenance: {
        kind: "first_party_consent",
        productionEligible: true,
        consent: {
          explicit: false,
          purpose: "gesture_model_training",
          noticeVersion: "2026-09-02",
          grantedAt: "2026-09-02T11:59:50.000Z",
          rawFramesRetained: false,
        },
      },
    });

    expect(() =>
      parseGestureDatasetJsonl(JSON.stringify(sequence)),
    ).toThrowError(/explicit training consent/i);
  });

  it("round-trips strict JSONL records without retaining camera frames", () => {
    const sequence = makeSequence();
    const serialized = serializeGestureDatasetJsonl([sequence]);
    const parsed = parseGestureDatasetJsonl(serialized);

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      sequenceId: "sequence-1",
      sessionId: "session-1",
      label: "point",
      provenance: {
        kind: "first_party_consent",
        productionEligible: true,
        consent: { rawFramesRetained: false },
      },
    });
    expect(serialized).not.toMatch(/data:image|video\/|image\/|blob:/i);
  });

  it("splits whole recording sessions so no session leaks across partitions", () => {
    const records = Array.from({ length: 40 }, (_, index) =>
      makeSequence({
        sequenceId: `sequence-${index}`,
        sessionId: `session-${Math.floor(index / 2)}`,
      }),
    );

    const first = splitGestureDatasetBySession(records, {
      train: 0.7,
      validation: 0.15,
      test: 0.15,
      seed: "release-1",
    });
    const second = splitGestureDatasetBySession(records, {
      train: 0.7,
      validation: 0.15,
      test: 0.15,
      seed: "release-1",
    });

    expect(first).toEqual(second);
    const owner = new Map<string, string>();
    for (const [partition, items] of Object.entries(first)) {
      for (const item of items) {
        const prior = owner.get(item.sessionId);
        expect(prior ?? partition).toBe(partition);
        owner.set(item.sessionId, partition);
      }
    }
    expect(owner).toHaveLength(20);
    expect(first.train.length + first.validation.length + first.test.length).toBe(
      40,
    );
    expect(first.validation.length).toBeGreaterThan(0);
    expect(first.test.length).toBeGreaterThan(0);
  });
});
