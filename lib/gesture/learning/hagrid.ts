import { z } from "zod";

import {
  GESTURE_DATASET_SCHEMA_VERSION,
  gestureSequenceSchema,
  type GestureDatasetSplit,
  type GestureLabel,
  type GestureSequence,
} from "@/lib/gesture/learning/dataset";

export const HAGRID_DATASET_ID = "hukenovs/hagrid-v2" as const;
export const HAGRID_LICENSE =
  "LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved" as const;
export const HAGRID_LICENSE_URL =
  "https://raw.githubusercontent.com/hukenovs/hagrid/080e18917376ec935e453cd0e599c23478c7e98f/license/en_us.pdf" as const;

const HAGRID_LABEL_MAP: Readonly<Record<string, GestureLabel | undefined>> = {
  point: "point",
  palm: "open_palm",
  thumb_index: "pinch",
  thumb_index2: "pinch",
  grip: "held",
  grabbing: "held",
  fist: "idle",
  no_gesture: "idle",
};

const coordinateSchema = z.tuple([z.number().finite(), z.number().finite()]);
const handLandmarksSchema = z.array(coordinateSchema).length(21);
const annotationSchema = z.object({
  user_id: z.string().trim().min(1).max(256),
  labels: z.array(z.string().trim().min(1)),
  hand_landmarks: z.array(handLandmarksSchema),
});
const annotationFileSchema = z.record(z.string(), annotationSchema);

export function convertHaGridAnnotations(
  annotationsInput: unknown,
  options: {
    readonly partition: "train" | "validation" | "test";
    readonly sourceClass: string;
    readonly revision: string;
    readonly importedAt: string;
  },
): GestureSequence[] {
  const annotations = annotationFileSchema.parse(annotationsInput);
  const importedAt = z.iso.datetime().parse(options.importedAt);
  const converted: GestureSequence[] = [];
  for (const [imageId, annotation] of Object.entries(annotations).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (annotation.labels.length !== annotation.hand_landmarks.length)
      throw new TypeError(
        `HaGRIDv2 annotation ${imageId} has ${annotation.labels.length} labels but ${annotation.hand_landmarks.length} landmark sets.`,
      );
    for (let handIndex = 0; handIndex < annotation.labels.length; handIndex += 1) {
      const sourceLabel = annotation.labels[handIndex]!;
      const label = HAGRID_LABEL_MAP[sourceLabel];
      if (!label) continue;
      const landmarks = annotation.hand_landmarks[handIndex]!.map(([x, y]) => ({
        x,
        y,
        z: 0,
        visibility: 1,
      }));
      const sessionId = `hagrid-v2:${annotation.user_id}`;
      converted.push(
        gestureSequenceSchema.parse({
          schemaVersion: GESTURE_DATASET_SCHEMA_VERSION,
          sequenceId: `hagrid-v2:${options.partition}:${options.sourceClass}:${imageId}:hand-${handIndex}`,
          sessionId,
          participantKey: sessionId,
          recordedAt: importedAt,
          label,
          provenance: {
            kind: "public_dataset",
            datasetId: HAGRID_DATASET_ID,
            revision: options.revision,
            license: HAGRID_LICENSE,
            sourceSequenceId: `${options.partition}/${options.sourceClass}/${imageId}#hand-${handIndex}`,
            sourcePartition: options.partition,
            productionEligible: true,
          },
          context: neutralContext(),
          engineSource: "hagrid-v2-hand-landmarks",
          // HaGRIDv2 is a static-pose source. Duplicating the observation keeps
          // the temporal contract explicit without inventing motion.
          frames: [
            {
              elapsedMs: 0,
              hands: [
                {
                  trackId: `${imageId}:${handIndex}`,
                  handedness: "unknown",
                  confidence: 1,
                  landmarks,
                },
              ],
            },
            {
              elapsedMs: 33,
              hands: [
                {
                  trackId: `${imageId}:${handIndex}`,
                  handedness: "unknown",
                  confidence: 1,
                  landmarks,
                },
              ],
            },
          ],
        }),
      );
    }
  }
  return converted;
}

export function assertParticipantSeparatedPartitions(partitions: {
  readonly train: readonly unknown[];
  readonly validation: readonly unknown[];
  readonly test: readonly unknown[];
}): GestureDatasetSplit {
  const parsed: GestureDatasetSplit = {
    train: partitions.train.map((sequence) => gestureSequenceSchema.parse(sequence)),
    validation: partitions.validation.map((sequence) => gestureSequenceSchema.parse(sequence)),
    test: partitions.test.map((sequence) => gestureSequenceSchema.parse(sequence)),
  };
  const owner = new Map<string, keyof GestureDatasetSplit>();
  for (const [partition, sequences] of Object.entries(parsed) as Array<
    [keyof GestureDatasetSplit, readonly GestureSequence[]]
  >) {
    for (const sequence of sequences) {
      const prior = owner.get(sequence.participantKey);
      if (prior && prior !== partition)
        throw new TypeError(
          `HaGRIDv2 participant leakage: ${sequence.participantKey.replace(/^hagrid-v2:/u, "")} appears in ${prior} and ${partition}.`,
        );
      owner.set(sequence.participantKey, partition);
    }
  }
  return parsed;
}

function neutralContext() {
  return {
    interactionMode: "manipulate" as const,
    targetPresent: false,
    selectedObjectPresent: false,
    edgeZone: "none" as const,
  };
}
