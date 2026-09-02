import type { GestureLabel, GestureSequence } from "@/lib/gesture/learning/dataset";
import {
  extractGestureFeatureVector,
  FRAME_FEATURE_SIZE,
  HAND_FEATURE_SIZE,
} from "@/lib/gesture/learning/features";
import type { TemporalGestureModel } from "@/lib/gesture/learning/model";

export const STATIC_HAND_POSE_MODEL_SCHEMA_VERSION =
  "commandcanvas.static-hand-pose-model/v1" as const;

const NEUTRAL_RESIDUAL_TOLERANCE = 1e-7;

type TrackedHand = GestureSequence["frames"][number]["hands"][number];

export interface StaticHandPoseModel {
  readonly schemaVersion: typeof STATIC_HAND_POSE_MODEL_SCHEMA_VERSION;
  readonly inputSize: typeof HAND_FEATURE_SIZE;
  readonly classes: readonly GestureLabel[];
  readonly featureMean: readonly number[];
  readonly featureScale: readonly number[];
  readonly weights: readonly (readonly number[])[];
  readonly bias: readonly number[];
  readonly productionEligible: boolean;
  readonly sourceAttribution?: TemporalGestureModel["sourceAttribution"];
  readonly promotion?: Readonly<Record<string, unknown>>;
  readonly heldOut?: Readonly<Record<string, unknown>>;
  readonly limitation?: string;
  readonly compactionAudit: {
    readonly sourceModelSchema: TemporalGestureModel["schemaVersion"];
    readonly sourceFrameCount: number;
    readonly sourceDatasetDigest: string;
    readonly sourceModelSha256?: string;
    readonly sourceModelSizeBytes?: number;
    readonly maxNeutralStandardizedResidual: number;
    readonly maxNeutralLogitContribution: number;
  };
}

export interface StaticHandPosePrediction {
  readonly label: GestureLabel;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

/** Returns the exact first-hand 72-value feature block used by HaGRID training. */
export function extractStaticHandPoseFeatures(hand: TrackedHand): readonly number[] {
  const sequence = {
    schemaVersion: "commandcanvas.hand-gesture.dataset/v1",
    sequenceId: "static-pose-feature",
    sessionId: "static-pose-feature",
    participantKey: "static-pose-feature",
    recordedAt: "2026-01-01T00:00:00.000Z",
    label: "idle",
    provenance: {
      kind: "synthetic",
      generator: "commandcanvas-static-pose-feature/v1",
      productionEligible: false,
    },
    context: neutralContext(),
    engineSource: "static-pose-feature",
    frames: [
      { elapsedMs: 0, hands: [hand] },
      { elapsedMs: 33, hands: [hand] },
    ],
  };
  return extractGestureFeatureVector(sequence, { frameCount: 2 }).values.slice(
    0,
    HAND_FEATURE_SIZE,
  );
}

export function compactTemporalModelToStaticPose(
  model: TemporalGestureModel,
  options?: {
    readonly sourceModelSha256?: string;
    readonly sourceModelSizeBytes?: number;
  },
): StaticHandPoseModel {
  validateTemporalSource(model);
  const neutral = neutralStaticVector(model.frameCount);
  let maxResidual = 0;
  let maxContribution = 0;
  const constantContribution = model.classes.map(() => 0);

  for (let index = 0; index < model.inputSize; index += 1) {
    if (isFirstHandFeature(index, model.frameCount)) continue;
    const residual =
      (neutral[index]! - model.featureMean[index]!) /
      model.featureScale[index]!;
    maxResidual = Math.max(maxResidual, Math.abs(residual));
    for (let classIndex = 0; classIndex < model.classes.length; classIndex += 1) {
      const contribution = model.weights[classIndex]![index]! * residual;
      constantContribution[classIndex]! += contribution;
      maxContribution = Math.max(maxContribution, Math.abs(contribution));
    }
  }
  if (maxResidual > NEUTRAL_RESIDUAL_TOLERANCE)
    throw new TypeError(
      `Source model has a neutral static feature residual of ${maxResidual}; compaction requires at most ${NEUTRAL_RESIDUAL_TOLERANCE}.`,
    );

  const compactMean = model.featureMean.slice(0, HAND_FEATURE_SIZE);
  const compactScale = model.featureScale.slice(0, HAND_FEATURE_SIZE);
  const compactWeights = model.classes.map(() =>
    Array.from({ length: HAND_FEATURE_SIZE }, () => 0),
  );
  const compactBias = [...model.bias];
  for (let classIndex = 0; classIndex < model.classes.length; classIndex += 1) {
    let sourceMeanTerm = 0;
    let compactMeanTerm = 0;
    for (let feature = 0; feature < HAND_FEATURE_SIZE; feature += 1) {
      let rawCoefficient = 0;
      for (let frame = 0; frame < model.frameCount; frame += 1) {
        const index = frame * FRAME_FEATURE_SIZE + feature;
        const sourceScale = model.featureScale[index]!;
        rawCoefficient += model.weights[classIndex]![index]! / sourceScale;
        sourceMeanTerm +=
          (model.weights[classIndex]![index]! * model.featureMean[index]!) /
          sourceScale;
      }
      compactWeights[classIndex]![feature] =
        rawCoefficient * compactScale[feature]!;
      compactMeanTerm += rawCoefficient * compactMean[feature]!;
    }
    compactBias[classIndex] =
      model.bias[classIndex]! +
      constantContribution[classIndex]! -
      sourceMeanTerm +
      compactMeanTerm;
  }

  return {
    schemaVersion: STATIC_HAND_POSE_MODEL_SCHEMA_VERSION,
    inputSize: HAND_FEATURE_SIZE,
    classes: [...model.classes],
    featureMean: compactMean.map(roundedModelValue),
    featureScale: compactScale.map(roundedModelValue),
    weights: compactWeights.map((row) => row.map(roundedModelValue)),
    bias: compactBias.map(roundedModelValue),
    productionEligible: model.productionEligible,
    sourceAttribution: model.sourceAttribution,
    promotion: model.training.promotion,
    heldOut: model.training.heldOut,
    limitation: model.training.limitation,
    compactionAudit: {
      sourceModelSchema: model.schemaVersion,
      sourceFrameCount: model.frameCount,
      sourceDatasetDigest: model.training.datasetDigest,
      ...(options?.sourceModelSha256
        ? { sourceModelSha256: options.sourceModelSha256 }
        : {}),
      ...(options?.sourceModelSizeBytes !== undefined
        ? { sourceModelSizeBytes: options.sourceModelSizeBytes }
        : {}),
      maxNeutralStandardizedResidual: roundedAuditValue(maxResidual),
      maxNeutralLogitContribution: roundedAuditValue(maxContribution),
    },
  };
}

export function classifyStaticHandPose(
  model: StaticHandPoseModel,
  features: readonly number[],
): StaticHandPosePrediction {
  validateStaticModel(model);
  if (features.length !== HAND_FEATURE_SIZE)
    throw new TypeError(
      `Static hand-pose inference needs ${HAND_FEATURE_SIZE} features; received ${features.length}.`,
    );
  const normalized = features.map(
    (value, index) =>
      (value - model.featureMean[index]!) / model.featureScale[index]!,
  );
  const probabilities = softmax(
    model.weights.map((row, index) => dot(row, normalized) + model.bias[index]!),
  );
  let bestIndex = 0;
  for (let index = 1; index < probabilities.length; index += 1)
    if (probabilities[index]! > probabilities[bestIndex]!) bestIndex = index;
  return {
    label: model.classes[bestIndex]!,
    confidence: roundedProbability(probabilities[bestIndex]!),
    probabilities: Object.fromEntries(
      model.classes.map((label, index) => [
        label,
        roundedProbability(probabilities[index]!),
      ]),
    ),
  };
}

function validateTemporalSource(model: TemporalGestureModel) {
  if (model.schemaVersion !== "commandcanvas.temporal-gesture-model/v1")
    throw new TypeError("Unsupported temporal gesture source model.");
  if (model.training.featurePolicy !== "pose_only_neutral_context")
    throw new TypeError("Source model was not trained with neutral pose-only context.");
  const expectedSize = model.frameCount * FRAME_FEATURE_SIZE + 10;
  if (
    model.frameCount < 2 ||
    model.inputSize !== expectedSize ||
    model.featureMean.length !== expectedSize ||
    model.featureScale.length !== expectedSize ||
    model.weights.some((row) => row.length !== expectedSize) ||
    model.weights.length !== model.classes.length ||
    model.bias.length !== model.classes.length ||
    model.featureScale.some((value) => !Number.isFinite(value) || value <= 0)
  )
    throw new TypeError("Temporal gesture source model dimensions are inconsistent.");
}

function validateStaticModel(model: StaticHandPoseModel) {
  if (model.schemaVersion !== STATIC_HAND_POSE_MODEL_SCHEMA_VERSION)
    throw new TypeError("Unsupported static hand-pose model schema.");
  if (
    model.inputSize !== HAND_FEATURE_SIZE ||
    model.featureMean.length !== HAND_FEATURE_SIZE ||
    model.featureScale.length !== HAND_FEATURE_SIZE ||
    model.weights.length !== model.classes.length ||
    model.bias.length !== model.classes.length ||
    model.weights.some((row) => row.length !== HAND_FEATURE_SIZE) ||
    model.featureScale.some((value) => !Number.isFinite(value) || value <= 0)
  )
    throw new TypeError("Static hand-pose model dimensions are inconsistent.");
}

function neutralStaticVector(frameCount: number) {
  const frame = [
    ...Array.from({ length: HAND_FEATURE_SIZE }, () => Number.NaN),
    ...Array.from({ length: HAND_FEATURE_SIZE }, () => 0),
    0.5,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
  ];
  return [...Array.from({ length: frameCount }, () => frame).flat(), ...neutralContextFeatures()];
}

function neutralContext() {
  return {
    interactionMode: "manipulate" as const,
    targetPresent: false,
    selectedObjectPresent: false,
    edgeZone: "none" as const,
  };
}

function neutralContextFeatures() {
  return [0, 1, 0, 0, 0, 1, 0, 0, 0, 0];
}

function isFirstHandFeature(index: number, frameCount: number) {
  const temporalSize = frameCount * FRAME_FEATURE_SIZE;
  if (index >= temporalSize) return false;
  return index % FRAME_FEATURE_SIZE < HAND_FEATURE_SIZE;
}

function softmax(logits: readonly number[]) {
  const maximum = Math.max(...logits);
  const exponentials = logits.map((logit) => Math.exp(logit - maximum));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function dot(left: readonly number[], right: readonly number[]) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1)
    total += left[index]! * right[index]!;
  return total;
}

function roundedModelValue(value: number) {
  return Math.round(value * 1e10) / 1e10;
}

function roundedAuditValue(value: number) {
  return Math.round(value * 1e12) / 1e12;
}

function roundedProbability(value: number) {
  return Math.round(value * 1e6) / 1e6;
}
