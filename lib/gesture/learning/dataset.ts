import { z } from "zod";

export const GESTURE_DATASET_SCHEMA_VERSION =
  "commandcanvas.hand-gesture.dataset/v1" as const;

export const gestureLabels = [
  "idle",
  "point",
  "draw",
  "open_palm",
  "pinch",
  "held",
  "release",
  "pan",
  "bimanual_resize",
  "bimanual_zoom",
  "bimanual_rotate",
  "throw",
  "minimize",
] as const;

export type GestureLabel = (typeof gestureLabels)[number];

const landmarkSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    z: z.number().finite().optional(),
    visibility: z.number().min(0).max(1).optional(),
  })
  .strict();

const trackedHandSchema = z
  .object({
    trackId: z.string().trim().min(1).max(128),
    handedness: z.enum(["left", "right", "unknown"]),
    confidence: z.number().min(0).max(1),
    landmarks: z.array(landmarkSchema).length(21),
  })
  .strict();

const firstPartyProvenanceSchema = z
  .object({
    kind: z.literal("first_party_consent"),
    consent: z
      .object({
        explicit: z.boolean(),
        purpose: z.literal("gesture_model_training"),
        noticeVersion: z.string().trim().min(1).max(64),
        grantedAt: z.iso.datetime(),
        rawFramesRetained: z.boolean(),
      })
      .strict(),
    productionEligible: z.boolean(),
  })
  .strict();

const syntheticProvenanceSchema = z
  .object({
    kind: z.literal("synthetic"),
    generator: z.string().trim().min(1).max(256),
    productionEligible: z.literal(false),
  })
  .strict();

const publicDatasetProvenanceSchema = z
  .object({
    kind: z.literal("public_dataset"),
    datasetId: z.string().trim().min(1).max(256),
    revision: z.string().trim().min(1).max(128),
    license: z.string().trim().min(1).max(128),
    sourceSequenceId: z.string().trim().min(1).max(256),
    sourcePartition: z.enum(["train", "validation", "test", "external"]).optional(),
    productionEligible: z.boolean(),
  })
  .strict();

export const gestureSequenceSchema = z
  .object({
    schemaVersion: z.literal(GESTURE_DATASET_SCHEMA_VERSION),
    sequenceId: z.string().trim().min(1).max(128),
    sessionId: z.string().trim().min(1).max(128),
    participantKey: z.string().trim().min(1).max(128),
    recordedAt: z.iso.datetime(),
    label: z.enum(gestureLabels),
    provenance: z.discriminatedUnion("kind", [
      firstPartyProvenanceSchema,
      syntheticProvenanceSchema,
      publicDatasetProvenanceSchema,
    ]),
    context: z
      .object({
        interactionMode: z.enum(["draw", "manipulate", "navigate"]),
        targetPresent: z.boolean(),
        selectedObjectPresent: z.boolean(),
        edgeZone: z.enum(["none", "left", "right", "top", "bottom"]),
      })
      .strict(),
    engineSource: z.string().trim().min(1).max(128),
    frames: z
      .array(
        z
          .object({
            elapsedMs: z.number().finite().nonnegative(),
            hands: z.array(trackedHandSchema).max(2),
          })
          .strict(),
      )
      .min(2)
      .max(2_048),
  })
  .strict()
  .superRefine((sequence, context) => {
    if (
      sequence.provenance.kind === "first_party_consent" &&
      !sequence.provenance.consent.explicit
    ) {
      context.addIssue({
        code: "custom",
        path: ["provenance", "consent", "explicit"],
        message: "Explicit training consent is required for captured sequences.",
      });
    }
    for (let index = 1; index < sequence.frames.length; index += 1) {
      if (sequence.frames[index]!.elapsedMs <= sequence.frames[index - 1]!.elapsedMs) {
        context.addIssue({
          code: "custom",
          path: ["frames", index, "elapsedMs"],
          message: "Frame timestamps must increase within a sequence.",
        });
      }
    }
  });

export type GestureSequence = z.infer<typeof gestureSequenceSchema>;

export interface GestureDatasetSplit {
  readonly train: readonly GestureSequence[];
  readonly validation: readonly GestureSequence[];
  readonly test: readonly GestureSequence[];
}

export function parseGestureDatasetJsonl(input: string): GestureSequence[] {
  const records: GestureSequence[] = [];
  for (const [index, rawLine] of input.split(/\r?\n/u).entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new SyntaxError(
        `Gesture dataset line ${index + 1} is not valid JSON: ${errorMessage(error)}`,
      );
    }
    const result = gestureSequenceSchema.safeParse(parsed);
    if (!result.success) {
      throw new TypeError(
        `Gesture dataset line ${index + 1} is invalid: ${z.prettifyError(result.error)}`,
      );
    }
    records.push(result.data);
  }
  if (records.length === 0)
    throw new TypeError("Gesture dataset must contain at least one sequence.");
  return records;
}

export function serializeGestureDatasetJsonl(
  records: readonly unknown[],
): string {
  if (records.length === 0)
    throw new TypeError("Gesture dataset must contain at least one sequence.");
  return `${records
    .map((record, index) => {
      const result = gestureSequenceSchema.safeParse(record);
      if (!result.success)
        throw new TypeError(
          `Gesture dataset record ${index + 1} is invalid: ${z.prettifyError(result.error)}`,
        );
      return JSON.stringify(result.data);
    })
    .join("\n")}\n`;
}

export function splitGestureDatasetBySession(
  recordsInput: readonly unknown[],
  options: {
    readonly train: number;
    readonly validation: number;
    readonly test: number;
    readonly seed: string;
  },
): GestureDatasetSplit {
  const records = recordsInput.map((record) => gestureSequenceSchema.parse(record));
  validateRatios(options);
  const sessions = new Map<string, GestureSequence[]>();
  for (const record of records) {
    const session = sessions.get(record.sessionId) ?? [];
    session.push(record);
    sessions.set(record.sessionId, session);
  }
  const ordered = [...sessions.entries()].sort(
    ([left], [right]) =>
      stableHash(`${options.seed}:${left}`) - stableHash(`${options.seed}:${right}`) ||
      left.localeCompare(right),
  );
  const counts = allocateSessionCounts(ordered.length, [
    options.train,
    options.validation,
    options.test,
  ]);
  const groups = [
    ordered.slice(0, counts[0]),
    ordered.slice(counts[0], counts[0] + counts[1]),
    ordered.slice(counts[0] + counts[1]),
  ].map((entries) => entries.flatMap(([, sessionRecords]) => sessionRecords));
  return { train: groups[0]!, validation: groups[1]!, test: groups[2]! };
}

function validateRatios(options: {
  readonly train: number;
  readonly validation: number;
  readonly test: number;
}) {
  const ratios = [options.train, options.validation, options.test];
  if (ratios.some((value) => !Number.isFinite(value) || value < 0))
    throw new RangeError("Dataset split ratios must be finite and non-negative.");
  const sum = ratios.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > 1e-9)
    throw new RangeError("Dataset split ratios must add up to 1.");
}

function allocateSessionCounts(total: number, ratios: readonly number[]) {
  const raw = ratios.map((ratio) => ratio * total);
  const counts = raw.map(Math.floor);
  const remaining = total - counts.reduce((sum, count) => sum + count, 0);
  const order = raw
    .map((value, index) => ({ index, remainder: value - counts[index]! }))
    .sort(
      (left, right) =>
        right.remainder - left.remainder || left.index - right.index,
    );
  for (let index = 0; index < remaining; index += 1)
    counts[order[index % order.length]!.index]! += 1;
  return counts;
}

function stableHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
