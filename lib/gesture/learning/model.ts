import {
  gestureSequenceSchema,
  type GestureLabel,
  type GestureSequence,
} from "@/lib/gesture/learning/dataset";
import {
  extractGestureFeatureVector,
  GESTURE_FEATURE_CONTRACT,
} from "@/lib/gesture/learning/features";

export const TEMPORAL_GESTURE_MODEL_SCHEMA_VERSION =
  "commandcanvas.temporal-gesture-model/v1" as const;

export interface TemporalGestureModel {
  readonly schemaVersion: typeof TEMPORAL_GESTURE_MODEL_SCHEMA_VERSION;
  readonly featureContract: typeof GESTURE_FEATURE_CONTRACT;
  readonly frameCount: number;
  readonly inputSize: number;
  readonly classes: readonly GestureLabel[];
  readonly featureMean: readonly number[];
  readonly featureScale: readonly number[];
  readonly weights: readonly (readonly number[])[];
  readonly bias: readonly number[];
  readonly productionEligible: boolean;
  readonly sourceAttribution?: {
    readonly datasetId: string;
    readonly revision: string;
    readonly license: string;
    readonly licenseUrl?: string;
    readonly url: string;
    readonly derivedArtifactLicense: string;
    readonly sourceSha256: string;
  };
  readonly training: {
    readonly algorithm: "multinomial-logistic-regression";
    readonly epochs: number;
    readonly learningRate: number;
    readonly l2: number;
    readonly seed: number;
    readonly sequenceCount: number;
    readonly sessionCount: number;
    readonly sourceKinds: readonly string[];
    readonly datasetDigest: string;
    readonly validationStatus: "not_evaluated" | "held_out_evaluated";
    readonly featurePolicy?: "pose_only_neutral_context";
    readonly deviceType?: "cpu" | "cuda";
    readonly deviceName?: string;
    readonly devicePeakAllocatedBytes?: number;
    readonly devicePeakReservedBytes?: number;
    readonly maxPerClass?: number;
    readonly selection?: Readonly<Record<string, unknown>>;
    readonly heldOut?: Readonly<Record<string, unknown>>;
    readonly promotion?: Readonly<Record<string, unknown>>;
    readonly limitation?: string;
  };
}

export interface TemporalGesturePrediction {
  readonly label: GestureLabel;
  readonly confidence: number;
  readonly probabilities: Readonly<Record<string, number>>;
}

export function trainTemporalGestureClassifier(
  recordsInput: readonly unknown[],
  options: {
    readonly frameCount: number;
    readonly epochs: number;
    readonly learningRate: number;
    readonly seed: number;
    readonly l2?: number;
    readonly allowNonProductionData?: boolean;
  },
): TemporalGestureModel {
  const records = recordsInput.map((record) => gestureSequenceSchema.parse(record));
  validateTrainingOptions(records, options);
  if (
    !options.allowNonProductionData &&
    records.some((record) => !record.provenance.productionEligible)
  ) {
    throw new TypeError(
      "Gesture training refused non-production data; pass allowNonProductionData only for a labeled smoke artifact.",
    );
  }
  const classes = [...new Set(records.map((record) => record.label))].sort();
  if (classes.length < 2)
    throw new TypeError("Gesture training needs at least two gesture classes.");
  const features = records.map(
    (record) => extractGestureFeatureVector(record, { frameCount: options.frameCount }).values,
  );
  const inputSize = features[0]!.length;
  const { mean, scale } = standardization(features);
  const standardized = features.map((vector) =>
    vector.map((value, index) => (value - mean[index]!) / scale[index]!),
  );
  const classIndex = new Map(classes.map((label, index) => [label, index]));
  const weights = classes.map(() => Array.from({ length: inputSize }, () => 0));
  const bias = classes.map(() => 0);
  const l2 = options.l2 ?? 0.000_1;

  for (let epoch = 0; epoch < options.epochs; epoch += 1) {
    const weightGradient = classes.map(() =>
      Array.from({ length: inputSize }, () => 0),
    );
    const biasGradient = classes.map(() => 0);
    for (let sampleIndex = 0; sampleIndex < standardized.length; sampleIndex += 1) {
      const vector = standardized[sampleIndex]!;
      const probabilities = softmax(
        weights.map((row, index) => dot(row, vector) + bias[index]!),
      );
      const expected = classIndex.get(records[sampleIndex]!.label)!;
      for (let output = 0; output < classes.length; output += 1) {
        const error = probabilities[output]! - (output === expected ? 1 : 0);
        biasGradient[output]! += error;
        for (let feature = 0; feature < inputSize; feature += 1)
          weightGradient[output]![feature]! += error * vector[feature]!;
      }
    }
    const divisor = standardized.length;
    for (let output = 0; output < classes.length; output += 1) {
      bias[output]! -= options.learningRate * (biasGradient[output]! / divisor);
      for (let feature = 0; feature < inputSize; feature += 1) {
        const gradient =
          weightGradient[output]![feature]! / divisor +
          l2 * weights[output]![feature]!;
        weights[output]![feature]! -= options.learningRate * gradient;
      }
    }
  }

  return {
    schemaVersion: TEMPORAL_GESTURE_MODEL_SCHEMA_VERSION,
    featureContract: GESTURE_FEATURE_CONTRACT,
    frameCount: options.frameCount,
    inputSize,
    classes,
    featureMean: mean.map(roundedModelValue),
    featureScale: scale.map(roundedModelValue),
    weights: weights.map((row) => row.map(roundedModelValue)),
    bias: bias.map(roundedModelValue),
    productionEligible: false,
    training: {
      algorithm: "multinomial-logistic-regression",
      epochs: options.epochs,
      learningRate: options.learningRate,
      l2,
      seed: options.seed,
      sequenceCount: records.length,
      sessionCount: new Set(records.map((record) => record.sessionId)).size,
      sourceKinds: [...new Set(records.map((record) => record.provenance.kind))].sort(),
      datasetDigest: datasetDigest(records),
      validationStatus: "not_evaluated",
    },
  };
}

export function classifyGestureSequence(
  model: TemporalGestureModel,
  sequenceInput: unknown,
): TemporalGesturePrediction {
  validateModel(model);
  const sequence = gestureSequenceSchema.parse(sequenceInput);
  const features = extractGestureFeatureVector(sequence, {
    frameCount: model.frameCount,
  }).values;
  if (features.length !== model.inputSize)
    throw new TypeError("Gesture model input size does not match the feature contract.");
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

function validateTrainingOptions(
  records: readonly GestureSequence[],
  options: {
    readonly frameCount: number;
    readonly epochs: number;
    readonly learningRate: number;
    readonly seed: number;
    readonly l2?: number;
  },
) {
  if (records.length < 2)
    throw new TypeError("Gesture training needs at least two sequences.");
  if (!Number.isInteger(options.frameCount) || options.frameCount < 2)
    throw new RangeError("Gesture training frameCount must be an integer of at least two.");
  if (!Number.isInteger(options.epochs) || options.epochs < 1)
    throw new RangeError("Gesture training epochs must be a positive integer.");
  if (!Number.isFinite(options.learningRate) || options.learningRate <= 0)
    throw new RangeError("Gesture training learningRate must be positive.");
  if (!Number.isInteger(options.seed))
    throw new RangeError("Gesture training seed must be an integer.");
  if (options.l2 !== undefined && (!Number.isFinite(options.l2) || options.l2 < 0))
    throw new RangeError("Gesture training l2 must be non-negative.");
}

function validateModel(model: TemporalGestureModel) {
  if (model.schemaVersion !== TEMPORAL_GESTURE_MODEL_SCHEMA_VERSION)
    throw new TypeError("Unsupported temporal gesture model schema.");
  if (model.featureContract !== GESTURE_FEATURE_CONTRACT)
    throw new TypeError("Gesture model uses an incompatible feature contract.");
  if (
    model.classes.length < 2 ||
    model.bias.length !== model.classes.length ||
    model.weights.length !== model.classes.length ||
    model.featureMean.length !== model.inputSize ||
    model.featureScale.length !== model.inputSize ||
    model.weights.some((row) => row.length !== model.inputSize)
  )
    throw new TypeError("Gesture model dimensions are inconsistent.");
}

function standardization(vectors: readonly (readonly number[])[]) {
  const inputSize = vectors[0]!.length;
  const mean = Array.from({ length: inputSize }, () => 0);
  for (const vector of vectors)
    for (let index = 0; index < inputSize; index += 1)
      mean[index]! += vector[index]! / vectors.length;
  const scale = Array.from({ length: inputSize }, () => 0);
  for (const vector of vectors)
    for (let index = 0; index < inputSize; index += 1) {
      const delta = vector[index]! - mean[index]!;
      scale[index]! += (delta * delta) / vectors.length;
    }
  for (let index = 0; index < inputSize; index += 1) {
    scale[index] = Math.sqrt(scale[index]!);
    if (scale[index]! < 1e-6) scale[index] = 1;
  }
  return { mean, scale };
}

function softmax(logits: readonly number[]) {
  const max = Math.max(...logits);
  const exponentials = logits.map((logit) => Math.exp(logit - max));
  const total = exponentials.reduce((sum, value) => sum + value, 0);
  return exponentials.map((value) => value / total);
}

function dot(left: readonly number[], right: readonly number[]) {
  let total = 0;
  for (let index = 0; index < left.length; index += 1)
    total += left[index]! * right[index]!;
  return total;
}

function datasetDigest(records: readonly GestureSequence[]) {
  const canonical = records
    .map((record) => `${record.sessionId}\u0000${record.sequenceId}\u0000${record.label}`)
    .sort()
    .join("\u0001");
  let hash = 2_166_136_261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function roundedModelValue(value: number) {
  return Math.round(value * 1e10) / 1e10;
}

function roundedProbability(value: number) {
  return Math.round(value * 1e6) / 1e6;
}
