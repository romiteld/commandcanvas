import { describe, expect, it } from "vitest";

import {
  assertParticipantSeparatedPartitions,
  convertHaGridAnnotations,
  HAGRID_LICENSE,
  HAGRID_LICENSE_URL,
} from "@/lib/gesture/learning/hagrid";
import { makeLandmarks } from "@/lib/gesture/learning/test-fixtures.test-support";

function hagridLandmarks(offsetX: number) {
  return makeLandmarks({ offsetX }).map((point) => [point.x, point.y]);
}

describe("HaGRIDv2 landmark adapter", () => {
  it("maps only relevant landmark gestures and keeps user_id as the split authority", () => {
    const converted = convertHaGridAnnotations(
      {
        imagePoint: {
          bboxes: [[0.1, 0.2, 0.3, 0.4]],
          user_id: "subject-a",
          labels: ["point"],
          hand_landmarks: [hagridLandmarks(0.3)],
          meta: { age: [42], gender: ["male"], race: ["not retained"] },
        },
        imagePinch: {
          bboxes: [
            [0.1, 0.2, 0.3, 0.4],
            [0.5, 0.2, 0.3, 0.4],
          ],
          user_id: "subject-b",
          labels: ["thumb_index", "peace"],
          hand_landmarks: [hagridLandmarks(0.35), hagridLandmarks(0.7)],
          meta: { age: [35], gender: ["female"], race: ["not retained"] },
        },
      },
      {
        partition: "train",
        sourceClass: "mixed-fixture",
        revision: "Hagrid_v2-1M",
        importedAt: "2026-09-02T15:00:00.000Z",
      },
    );

    expect(converted).toHaveLength(2);
    expect(converted.map((sequence) => sequence.label).sort()).toEqual([
      "pinch",
      "point",
    ]);
    expect(converted.map((sequence) => sequence.sessionId).sort()).toEqual([
      "hagrid-v2:subject-a",
      "hagrid-v2:subject-b",
    ]);
    const point = converted.find((sequence) => sequence.label === "point");
    expect(point).toMatchObject({
      participantKey: "hagrid-v2:subject-a",
      provenance: {
        kind: "public_dataset",
        datasetId: "hukenovs/hagrid-v2",
        revision: "Hagrid_v2-1M",
        license:
          "LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved",
        sourcePartition: "train",
        productionEligible: true,
      },
      engineSource: "hagrid-v2-hand-landmarks",
    });
    expect(new Set(converted.map((sequence) => JSON.stringify(sequence.context)))).toEqual(
      new Set([
        JSON.stringify({
          interactionMode: "manipulate",
          targetPresent: false,
          selectedObjectPresent: false,
          edgeZone: "none",
        }),
      ]),
    );
    expect(JSON.stringify(converted)).not.toMatch(/"(age|gender|race)":/);
    expect(HAGRID_LICENSE).toBe(
      "LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved",
    );
    expect(HAGRID_LICENSE_URL).toBe(
      "https://raw.githubusercontent.com/hukenovs/hagrid/080e18917376ec935e453cd0e599c23478c7e98f/license/en_us.pdf",
    );
  });

  it("rejects an official partition split if one subject appears in two partitions", () => {
    const sequence = convertHaGridAnnotations(
      {
        imagePoint: {
          bboxes: [[0.1, 0.2, 0.3, 0.4]],
          user_id: "subject-overlap",
          labels: ["point"],
          hand_landmarks: [hagridLandmarks(0.3)],
          meta: {},
        },
      },
      {
        partition: "train",
        sourceClass: "point",
        revision: "Hagrid_v2-1M",
        importedAt: "2026-09-02T15:00:00.000Z",
      },
    )[0]!;

    expect(() =>
      assertParticipantSeparatedPartitions({
        train: [sequence],
        validation: [{
          ...sequence,
          sequenceId: "validation-copy",
          provenance: { ...sequence.provenance, sourcePartition: "validation" },
        }],
        test: [],
      }),
    ).toThrowError(/participant leakage.*subject-overlap/i);
  });
});
