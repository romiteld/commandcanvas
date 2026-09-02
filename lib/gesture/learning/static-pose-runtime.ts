import type { GestureLabel } from "@/lib/gesture/learning/dataset";
import bundledStaticPoseArtifact from "@/public/models/commandcanvas-hagrid-v2-static-pose-model-v1.json";
import {
  classifyStaticHandPose,
  extractStaticHandPoseFeatures,
  type StaticHandPoseModel,
} from "@/lib/gesture/learning/static-pose-model";
import type {
  HandLandmarks,
  Handedness,
} from "@/lib/gesture/hand-landmark-contract";

export const STATIC_POSE_EVIDENCE_SOURCE =
  "hagrid-v2-static-pose-v1" as const;

export type StaticSupportingPoseLabel = Extract<
  GestureLabel,
  "idle" | "point" | "open_palm" | "pinch" | "held"
>;

export interface LearnedStaticPoseEvidence {
  readonly label: StaticSupportingPoseLabel;
  readonly confidence: number;
  readonly source: typeof STATIC_POSE_EVIDENCE_SOURCE;
}

export interface StaticHandPoseObservation {
  readonly trackId: string;
  readonly handedness: Handedness;
  readonly confidence: number;
  readonly landmarks: HandLandmarks;
}

export interface StaticHandPoseClassifier {
  readonly enabled: boolean;
  readonly refusalReason?:
    | "license_not_approved"
    | "artifact_missing_or_malformed"
    | "model_not_promoted";
  classify(observation: StaticHandPoseObservation): LearnedStaticPoseEvidence | null;
}

const SAFE_STATIC_LABELS = new Set<StaticSupportingPoseLabel>([
  "idle",
  "point",
  "open_palm",
  "pinch",
  "held",
]);

const EXPECTED_HAGRID_PROVENANCE = Object.freeze({
  datasetId: "hukenovs/hagrid-v2",
  revision: "Hagrid_v2-1M",
  license:
    "LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved",
  licenseUrl:
    "https://raw.githubusercontent.com/hukenovs/hagrid/080e18917376ec935e453cd0e599c23478c7e98f/license/en_us.pdf",
  url: "https://github.com/hukenovs/hagrid",
  derivedArtifactLicense:
    "LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved",
  sourceSha256:
    "ca27a177cc9f061e92d59f6a7d9b1b10fe2ee8289ab5f2068cde6ab197d2a286",
});

const MIN_CONFIDENCE_BY_LABEL: Readonly<
  Record<StaticSupportingPoseLabel, number>
> = Object.freeze({
  idle: 0.9,
  point: 0.9,
  open_palm: 0.94,
  // Grab-like evidence has a deliberately higher floor because the canonical
  // reducer may use it only to widen physical pinch engagement slightly.
  pinch: 0.97,
  held: 0.97,
});

/** The checked-in artifact has a separately documented custom-license boundary. */
export const bundledStaticHandPoseClassifier = createStaticHandPoseClassifier(
  bundledStaticPoseArtifact,
  { licenseApproved: true },
);

export function classifyWithBundledStaticHandPose(
  observation: StaticHandPoseObservation,
) {
  return bundledStaticHandPoseClassifier.classify(observation);
}

/**
 * Builds a synchronous landmark classifier, but only after the caller has
 * independently approved the source and derived-artifact license. Artifact
 * self-declarations are never sufficient to turn this gate on.
 */
export function createStaticHandPoseClassifier(
  artifact: unknown,
  options: { readonly licenseApproved: boolean },
): StaticHandPoseClassifier {
  if (!options.licenseApproved)
    return disabledClassifier("license_not_approved");
  const model = parseStaticHandPoseModel(artifact);
  if (!model) return disabledClassifier("artifact_missing_or_malformed");
  if (
    !model.productionEligible ||
    !isRecord(model.promotion) ||
    model.promotion.eligible !== true
  )
    return disabledClassifier("model_not_promoted");

  return {
    enabled: true,
    classify(observation) {
      try {
        const prediction = classifyStaticHandPose(
          model,
          extractStaticHandPoseFeatures({
            ...observation,
            // Dataset validation owns the boundary. Clone the readonly runtime
            // tuple into its mutable JSON-compatible landmark shape.
            landmarks: observation.landmarks.map((landmark) => ({
              ...landmark,
            })),
          }),
        );
        if (!isStaticSupportingPoseLabel(prediction.label)) return null;
        if (
          prediction.confidence < MIN_CONFIDENCE_BY_LABEL[prediction.label]
        )
          return null;
        return {
          label: prediction.label,
          confidence: prediction.confidence,
          source: STATIC_POSE_EVIDENCE_SOURCE,
        };
      } catch {
        // A model or observation fault must never interrupt the camera loop.
        return null;
      }
    },
  };
}

function disabledClassifier(
  refusalReason: NonNullable<StaticHandPoseClassifier["refusalReason"]>,
): StaticHandPoseClassifier {
  return {
    enabled: false,
    refusalReason,
    classify: () => null,
  };
}

function parseStaticHandPoseModel(value: unknown): StaticHandPoseModel | null {
  if (!isRecord(value)) return null;
  if (
    value.schemaVersion !== "commandcanvas.static-hand-pose-model/v1" ||
    value.inputSize !== 72 ||
    typeof value.productionEligible !== "boolean" ||
    !Array.isArray(value.classes) ||
    value.classes.length === 0 ||
    !value.classes.every(isStaticSupportingPoseLabel) ||
    new Set(value.classes).size !== value.classes.length ||
    !finiteVector(value.featureMean, 72) ||
    !positiveVector(value.featureScale, 72) ||
    !Array.isArray(value.weights) ||
    value.weights.length !== value.classes.length ||
    !value.weights.every((row) => finiteVector(row, 72)) ||
    !finiteVector(value.bias, value.classes.length) ||
    !isRecord(value.sourceAttribution) ||
    !hasExpectedHaGridProvenance(value.sourceAttribution) ||
    !isRecord(value.compactionAudit) ||
    value.compactionAudit.sourceModelSchema !==
      "commandcanvas.temporal-gesture-model/v1" ||
    !Number.isInteger(value.compactionAudit.sourceFrameCount) ||
    (value.compactionAudit.sourceFrameCount as number) < 2 ||
    !nonEmptyString(value.compactionAudit.sourceDatasetDigest) ||
    !finiteNumber(value.compactionAudit.maxNeutralStandardizedResidual) ||
    !finiteNumber(value.compactionAudit.maxNeutralLogitContribution)
  )
    return null;
  return value as unknown as StaticHandPoseModel;
}

function isStaticSupportingPoseLabel(
  value: unknown,
): value is StaticSupportingPoseLabel {
  return (
    typeof value === "string" &&
    SAFE_STATIC_LABELS.has(value as StaticSupportingPoseLabel)
  );
}

function hasExpectedHaGridProvenance(
  value: Record<string, unknown>,
): boolean {
  return Object.entries(EXPECTED_HAGRID_PROVENANCE).every(
    ([key, expected]) => value[key] === expected,
  );
}

function finiteVector(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(finiteNumber)
  );
}

function positiveVector(value: unknown, length: number): value is number[] {
  return finiteVector(value, length) && value.every((entry) => entry > 0);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
