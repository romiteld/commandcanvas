import { describe, expect, it } from "vitest";

import {
  createInitialHandIntentState,
  interpretHandFrame,
  type HandLandmarks,
} from "@/lib/gesture/hand-intent";
import { rawHandLandmarks } from "@/lib/testing/hand-landmark-fixtures";

function frame(landmarks: HandLandmarks, timestamp = 1_000) {
  return { landmarks, confidence: 0.98, timestamp };
}

describe("spatial index-led point policy", () => {
  it("uses reliable landmark 8 as the pointer when support-finger pose evidence is imperfect", () => {
    const landmarks = [
      ...rawHandLandmarks({
        pose: "relaxed_index",
        indexTip: { x: 0.37, y: 0.24 },
        supportVisibility: 0.18,
      }),
    ];
    landmarks[12] = { x: 0.77, y: 0.63, z: 0, visibility: 0.18 };
    landmarks[16] = { x: 0.12, y: 0.75, z: 0, visibility: 0.18 };
    landmarks[20] = { x: 0.86, y: 0.8, z: 0, visibility: 0.18 };

    const transition = interpretHandFrame(
      createInitialHandIntentState(),
      frame(landmarks as unknown as HandLandmarks),
      1_010,
      { pointPolicy: "spatial-index-led" },
    );

    expect(transition.output).toMatchObject({
      accepted: true,
      mode: "point",
      pointer: { x: 0.37, y: 0.24 },
    });
    expect(transition.measurements).toMatchObject({
      indexTip: { x: 0.37, y: 0.24 },
      middleTip: { x: 0.77, y: 0.63 },
    });
    if (!transition.output.accepted)
      throw new Error("The index-led spatial fixture must be accepted.");
    expect(transition.output.pointer).not.toEqual(
      transition.measurements?.middleTip,
    );
    expect(transition.output.pointer).not.toEqual(
      transition.measurements?.palmMcpCentroid,
    );
  });

  it("keeps canonical pinch and open-palm modes ahead of spatial pointing", () => {
    const pinch = interpretHandFrame(
      createInitialHandIntentState(),
      frame(rawHandLandmarks({ pose: "pinch" })),
      1_010,
      {
        pointPolicy: "spatial-index-led",
        pinchEngageRatio: 0.4,
        pinchReleaseRatio: 0.6,
      },
    );
    const openPalm = interpretHandFrame(
      createInitialHandIntentState(),
      frame(rawHandLandmarks({ pose: "open_palm" })),
      1_010,
      { pointPolicy: "spatial-index-led" },
    );

    expect(pinch.output).toMatchObject({ accepted: true, mode: "pinch" });
    expect(openPalm.output).toMatchObject({
      accepted: true,
      mode: "open_palm",
    });
  });

  it("still refuses a curled index and low-confidence landmark 8", () => {
    const curled = interpretHandFrame(
      createInitialHandIntentState(),
      frame(rawHandLandmarks({ pose: "fist" })),
      1_010,
      { pointPolicy: "spatial-index-led" },
    );
    const unreliable = interpretHandFrame(
      createInitialHandIntentState(),
      frame(
        rawHandLandmarks({
          pose: "relaxed_index",
          indexVisibility: 0.2,
        }),
      ),
      1_010,
      { pointPolicy: "spatial-index-led" },
    );

    expect(curled.output).toMatchObject({
      accepted: false,
      reason: "no_deliberate_gesture",
    });
    expect(unreliable.output).toMatchObject({
      accepted: false,
      reason: "low_keypoint_confidence",
    });
  });
});
