import { describe, expect, it } from "vitest";

import {
  createInitialHandIntentState,
  interpretHandFrame,
  type HandFrame,
  type HandLandmark,
  type HandLandmarks,
} from "@/lib/gesture/hand-intent";
import { rawHandLandmarks } from "@/lib/testing/hand-landmark-fixtures";

const learnedPoint = {
  label: "point",
  confidence: 0.99,
  source: "hagrid-v2-static-pose-v1",
} as const;
const learnedPinch = {
  label: "pinch",
  confidence: 0.99,
  source: "hagrid-v2-static-pose-v1",
} as const;
const learnedOpenPalm = {
  label: "open_palm",
  confidence: 0.99,
  source: "hagrid-v2-static-pose-v1",
} as const;

function frame(
  landmarks: HandLandmarks,
  overrides: Partial<Omit<HandFrame, "landmarks">> = {},
): HandFrame {
  return {
    landmarks,
    confidence: 0.98,
    timestamp: 1_000,
    ...overrides,
  };
}

describe("learned static-pose supporting evidence", () => {
  it("accepts learned point support only when the index geometry and keypoints remain reliable", () => {
    const ambiguousSupport = frame(
      rawHandLandmarks({ pose: "relaxed_index", supportVisibility: 0.2 }),
    );

    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        ambiguousSupport,
        1_010,
      ).output,
    ).toMatchObject({ accepted: false, reason: "no_deliberate_gesture" });
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        ambiguousSupport,
        1_010,
        {},
        learnedPoint,
      ),
    ).toMatchObject({
      output: { accepted: true, mode: "point" },
      supportingEvidence: { assisted: "point", label: "point" },
    });

    const unreliableIndex = frame(
      rawHandLandmarks({ pose: "relaxed_index", indexVisibility: 0.2 }),
    );
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        unreliableIndex,
        1_010,
        {},
        learnedPoint,
      ).output,
    ).toMatchObject({ accepted: false, reason: "low_keypoint_confidence" });
  });

  it("refuses low-confidence, predicted, stale, and non-static learned evidence", () => {
    const observation = frame(
      rawHandLandmarks({ pose: "relaxed_index", supportVisibility: 0.2 }),
    );
    const lowConfidence = { ...learnedPoint, confidence: 0.7 };
    const unsupported = {
      ...learnedPoint,
      label: "throw",
    } as unknown as typeof learnedPoint;

    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        observation,
        1_010,
        {},
        lowConfidence,
      ).output,
    ).toMatchObject({ accepted: false, reason: "no_deliberate_gesture" });
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        { ...observation, predicted: true },
        1_010,
        {},
        learnedPoint,
      ).output,
    ).toMatchObject({ accepted: false, reason: "predicted_sample" });
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        { ...observation, timestamp: 700 },
        1_010,
        {},
        learnedPoint,
      ).output,
    ).toMatchObject({ accepted: false, reason: "stale_frame" });
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        observation,
        1_010,
        {},
        unsupported,
      ).output,
    ).toMatchObject({ accepted: false, reason: "no_deliberate_gesture" });
  });

  it("lets learned pinch evidence widen engage only within plausible physical geometry", () => {
    const plausible = frame(
      rawHandLandmarks({
        pose: "relaxed_index",
        thumbTip: { x: 0.41, y: 0.22 },
      }),
    );
    const canonical = interpretHandFrame(
      createInitialHandIntentState(),
      plausible,
      1_010,
    );
    expect(canonical.output).toMatchObject({ accepted: true, mode: "point" });
    expect(canonical.measurements?.pinchRatio).toBeGreaterThan(0.28);

    const assisted = interpretHandFrame(
      createInitialHandIntentState(),
      plausible,
      1_010,
      {},
      learnedPinch,
    );
    expect(assisted).toMatchObject({
      output: { accepted: true, mode: "pinch" },
      supportingEvidence: { assisted: "pinch", label: "pinch" },
    });

    const physicallyWide = frame(
      rawHandLandmarks({
        pose: "relaxed_index",
        thumbTip: { x: 0.2, y: 0.58 },
      }),
    );
    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        physicallyWide,
        1_010,
        {},
        learnedPinch,
      ).output,
    ).not.toMatchObject({ accepted: true, mode: "pinch" });
  });

  it("keeps release hysteresis authoritative after a learned-assisted pinch", () => {
    const engage = interpretHandFrame(
      createInitialHandIntentState(),
      frame(
        rawHandLandmarks({
          pose: "relaxed_index",
          thumbTip: { x: 0.41, y: 0.22 },
        }),
      ),
      1_010,
      {},
      learnedPinch,
    );
    expect(engage.output).toMatchObject({ accepted: true, mode: "pinch" });

    const heldByCanonicalHysteresis = interpretHandFrame(
      engage.state,
      frame(
        rawHandLandmarks({
          pose: "relaxed_index",
          thumbTip: { x: 0.39, y: 0.22 },
        }),
        { timestamp: 1_016 },
      ),
      1_020,
    );
    expect(heldByCanonicalHysteresis.output).toMatchObject({
      accepted: true,
      mode: "pinch",
    });

    const released = interpretHandFrame(
      heldByCanonicalHysteresis.state,
      frame(
        rawHandLandmarks({
          pose: "relaxed_index",
          thumbTip: { x: 0.2, y: 0.58 },
        }),
        { timestamp: 1_032 },
      ),
      1_040,
    );
    expect(released.output).not.toMatchObject({ accepted: true, mode: "pinch" });
  });

  it("uses learned open-palm evidence only to tolerate one noisy support finger", () => {
    const landmarks = [
      ...rawHandLandmarks({ pose: "open_palm" }),
    ] as HandLandmark[];
    landmarks[20] = { ...landmarks[20]!, x: 0.68, y: 0.78 };
    const observation = frame(landmarks as unknown as HandLandmarks);

    expect(
      interpretHandFrame(
        createInitialHandIntentState(),
        observation,
        1_010,
        {},
        learnedOpenPalm,
      ),
    ).toMatchObject({
      output: { accepted: true, mode: "open_palm" },
      supportingEvidence: { assisted: "open_palm", label: "open_palm" },
    });
  });
});
