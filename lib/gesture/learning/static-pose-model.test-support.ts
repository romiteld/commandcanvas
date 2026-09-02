import { extractGestureFeatureVector } from "@/lib/gesture/learning/features";
import type { TemporalGestureModel } from "@/lib/gesture/learning/model";
import type { makeSequence } from "@/lib/gesture/learning/test-fixtures.test-support";

export function makeNeutralTemporalModel(
  sequence: ReturnType<typeof makeSequence>,
): TemporalGestureModel {
  const frameCount = 8;
  const extracted = extractGestureFeatureVector(sequence, { frameCount });
  const featureMean = extracted.values.map((value, index) =>
    isFirstHandFeature(index, frameCount) ? 0 : value,
  );
  const featureScale = extracted.values.map((_, index) =>
    isFirstHandFeature(index, frameCount) ? 0.75 + (index % 7) * 0.05 : 1,
  );
  const classes = ["open_palm", "pinch", "point"] as const;
  const weights = classes.map((_, classIndex) =>
    extracted.values.map((__, index) =>
      Math.sin((classIndex + 1) * (index + 3)) * 0.013,
    ),
  );
  return {
    schemaVersion: "commandcanvas.temporal-gesture-model/v1",
    featureContract: "commandcanvas.gesture-features/v1",
    frameCount,
    inputSize: extracted.inputSize,
    classes,
    featureMean,
    featureScale,
    weights,
    bias: [0.1, -0.2, 0.05],
    productionEligible: true,
    sourceAttribution: {
      datasetId: "hukenovs/hagrid-v2",
      revision: "Hagrid_v2-1M",
      license:
        "LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved",
      url: "https://github.com/hukenovs/hagrid",
      licenseUrl:
        "https://raw.githubusercontent.com/hukenovs/hagrid/080e18917376ec935e453cd0e599c23478c7e98f/license/en_us.pdf",
      derivedArtifactLicense:
        "LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved",
      sourceSha256: "a".repeat(64),
    },
    training: {
      algorithm: "multinomial-logistic-regression",
      epochs: 1,
      learningRate: 0.1,
      l2: 0,
      seed: 1,
      sequenceCount: 10,
      sessionCount: 10,
      sourceKinds: ["public_dataset"],
      datasetDigest: "fixture",
      validationStatus: "held_out_evaluated",
      featurePolicy: "pose_only_neutral_context",
      heldOut: { test: { accuracy: 0.9 } },
      promotion: { eligible: true },
    },
  };
}

function isFirstHandFeature(index: number, frameCount: number) {
  const temporalSize = frameCount * 152;
  if (index >= temporalSize) return false;
  return index % 152 < 72;
}
