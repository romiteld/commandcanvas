import type { GestureLabel } from "@/lib/gesture/learning/dataset";

export interface GestureClassMetrics {
  readonly precision: number;
  readonly recall: number;
  readonly f1: number;
  readonly support: number;
}

export interface GestureEvaluationMetrics {
  readonly accuracy: number;
  readonly perClass: Readonly<Record<string, GestureClassMetrics>>;
  readonly confusionMatrix: {
    readonly labels: readonly GestureLabel[];
    readonly values: readonly (readonly number[])[];
  };
  readonly falseGrabRate: number;
  readonly twoHandIdentityContinuity: number | null;
}

const GRAB_LABELS = new Set<GestureLabel>(["pinch", "held"]);

export function evaluateGesturePredictions(
  truth: readonly GestureLabel[],
  predictions: readonly GestureLabel[],
  options?: { readonly twoHandContinuity?: readonly number[] },
): GestureEvaluationMetrics {
  if (truth.length === 0)
    throw new TypeError("Gesture evaluation needs at least one prediction.");
  if (truth.length !== predictions.length)
    throw new RangeError("Truth and prediction arrays must have equal length.");
  const labels = [...new Set([...truth, ...predictions])].sort() as GestureLabel[];
  const indexByLabel = new Map(labels.map((label, index) => [label, index]));
  const matrix = labels.map(() => labels.map(() => 0));
  let correct = 0;
  let falseGrabs = 0;
  let nonGrabTruth = 0;
  for (let index = 0; index < truth.length; index += 1) {
    const expected = truth[index]!;
    const predicted = predictions[index]!;
    matrix[indexByLabel.get(expected)!]![indexByLabel.get(predicted)!] += 1;
    if (expected === predicted) correct += 1;
    if (!GRAB_LABELS.has(expected)) {
      nonGrabTruth += 1;
      if (GRAB_LABELS.has(predicted)) falseGrabs += 1;
    }
  }
  const perClass: Record<string, GestureClassMetrics> = {};
  for (const [classIndex, label] of labels.entries()) {
    const truePositive = matrix[classIndex]![classIndex]!;
    const support = matrix[classIndex]!.reduce((sum, value) => sum + value, 0);
    const predictedCount = matrix.reduce(
      (sum, row) => sum + row[classIndex]!,
      0,
    );
    const precision = predictedCount ? truePositive / predictedCount : 0;
    const recall = support ? truePositive / support : 0;
    perClass[label] = {
      precision: rounded(precision),
      recall: rounded(recall),
      f1: rounded(
        precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
      ),
      support,
    };
  }
  const continuity = options?.twoHandContinuity ?? [];
  return {
    accuracy: rounded(correct / truth.length),
    perClass,
    confusionMatrix: { labels, values: matrix },
    falseGrabRate: rounded(nonGrabTruth ? falseGrabs / nonGrabTruth : 0),
    twoHandIdentityContinuity:
      continuity.length > 0
        ? rounded(
            continuity.reduce((sum, value) => sum + value, 0) /
              continuity.length,
          )
        : null,
  };
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
