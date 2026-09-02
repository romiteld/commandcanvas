import { describe, expect, it } from "vitest";

import {
  bundledStaticHandPoseClassifier,
  classifyWithBundledStaticHandPose,
  createStaticHandPoseClassifier,
} from "@/lib/gesture/learning/static-pose-runtime";
import type { StaticHandPoseModel } from "@/lib/gesture/learning/static-pose-model";
import { rawHandLandmarks } from "@/lib/testing/hand-landmark-fixtures";

function openPalm() {
  return {
    trackId: "right-1",
    handedness: "right" as const,
    confidence: 0.98,
    landmarks: rawHandLandmarks({ pose: "open_palm" }),
  };
}

function promotedArtifact(
  overrides: Partial<StaticHandPoseModel> = {},
): StaticHandPoseModel {
  const classes = ["idle", "open_palm", "pinch", "point"] as const;
  return {
    schemaVersion: "commandcanvas.static-hand-pose-model/v1",
    inputSize: 72,
    classes,
    featureMean: Array.from({ length: 72 }, () => 0),
    featureScale: Array.from({ length: 72 }, () => 1),
    weights: classes.map(() => Array.from({ length: 72 }, () => 0)),
    bias: [0, 8, 0, 0],
    productionEligible: true,
    sourceAttribution: {
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
    },
    promotion: { eligible: true },
    heldOut: { test: { accuracy: 0.99 } },
    compactionAudit: {
      sourceModelSchema: "commandcanvas.temporal-gesture-model/v1",
      sourceFrameCount: 8,
      sourceDatasetDigest: "fixture-digest",
      maxNeutralStandardizedResidual: 0,
      maxNeutralLogitContribution: 0,
    },
    ...overrides,
  };
}

describe("license-gated static-pose runtime", () => {
  it("constructs the corrected bundled artifact through the explicit production gate", () => {
    expect(bundledStaticHandPoseClassifier.enabled).toBe(true);
    expect(classifyWithBundledStaticHandPose(openPalm())).toMatchObject({
      label: "open_palm",
      source: "hagrid-v2-static-pose-v1",
    });
  });

  it("loads only an explicitly license-approved promoted 72-feature artifact", () => {
    const classifier = createStaticHandPoseClassifier(promotedArtifact(), {
      licenseApproved: true,
    });
    expect(classifier.enabled).toBe(true);
    expect(classifier.classify(openPalm())).toMatchObject({
      label: "open_palm",
      source: "hagrid-v2-static-pose-v1",
    });
  });

  it.each([
    ["missing", undefined, true],
    ["license not approved", promotedArtifact(), false],
    ["not promoted", promotedArtifact({ productionEligible: false }), true],
    [
      "wrong input size",
      promotedArtifact({ inputSize: 71 as 72 }),
      true,
    ],
    [
      "unsafe class",
      promotedArtifact({
        classes: ["idle", "point", "throw"] as StaticHandPoseModel["classes"],
      }),
      true,
    ],
    [
      "malformed weights",
      promotedArtifact({ weights: promotedArtifact().weights.slice(1) }),
      true,
    ],
  ])("fails closed when the artifact is %s", (_name, artifact, licenseApproved) => {
    const classifier = createStaticHandPoseClassifier(artifact, {
      licenseApproved,
    });
    expect(classifier.enabled).toBe(false);
    expect(classifier.classify(openPalm())).toBeNull();
  });

  it.each([
    ["dataset id", { datasetId: "other/dataset" }],
    ["revision", { revision: "moving-main" }],
    ["custom license reference", { license: "CC-BY-SA-4.0" }],
    ["pinned license URL", { licenseUrl: "https://example.invalid/license.pdf" }],
    ["upstream URL", { url: "https://example.invalid/hagrid" }],
    ["derived license", { derivedArtifactLicense: "MIT" }],
    ["source archive digest", { sourceSha256: "b".repeat(64) }],
  ])("refuses altered %s provenance", (_name, provenanceChange) => {
    const artifact = promotedArtifact();
    const classifier = createStaticHandPoseClassifier(
      {
        ...artifact,
        sourceAttribution: {
          ...artifact.sourceAttribution,
          ...provenanceChange,
        },
      },
      { licenseApproved: true },
    );
    expect(classifier.enabled).toBe(false);
    expect(classifier.refusalReason).toBe("artifact_missing_or_malformed");
  });

  it("refuses an otherwise valid low-confidence model result", () => {
    const artifact = promotedArtifact();
    const zeroWeights = artifact.weights.map((row) => row.map(() => 0));
    const classifier = createStaticHandPoseClassifier({
      ...artifact,
      weights: zeroWeights,
      bias: artifact.bias.map(() => 0),
    }, {
      licenseApproved: true,
    });

    expect(classifier.enabled).toBe(true);
    expect(classifier.classify(openPalm())).toBeNull();
  });

  it("fails closed for malformed runtime landmarks instead of throwing into camera processing", () => {
    const classifier = createStaticHandPoseClassifier(promotedArtifact(), {
      licenseApproved: true,
    });
    const malformed = {
      ...openPalm(),
      landmarks: rawHandLandmarks({ pose: "open_palm" }).slice(0, 20),
    };
    expect(
      classifier.classify(
        malformed as unknown as Parameters<
          typeof classifier.classify
        >[0],
      ),
    ).toBeNull();
  });
});
