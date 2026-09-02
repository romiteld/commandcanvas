import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { classifyGestureSequence, type TemporalGestureModel } from "@/lib/gesture/learning/model";
import {
  makeLandmarks,
  makeSequence,
} from "@/lib/gesture/learning/test-fixtures.test-support";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("HaGRIDv2 CUDA trainer CLI", () => {
  it("trains an officially partitioned fixture and exports a TS-compatible evaluated model", () => {
    const cudaAvailable =
      spawnSync(
        "python3",
        ["-c", "import torch; print(str(torch.cuda.is_available()).lower())"],
        { encoding: "utf8" },
      ).stdout.trim() === "true";
    const trainingDevice = cudaAvailable ? "cuda" : "cpu";
    const root = mkdtempSync(join(tmpdir(), "commandcanvas-hagrid-trainer-"));
    temporaryDirectories.push(root);
    const source = join(root, "source");
    for (const partition of ["train", "val", "test"])
      mkdirSync(join(source, "annotations", partition), { recursive: true });
    for (const [partition, count] of [
      ["train", 6],
      ["val", 3],
      ["test", 3],
    ] as const) {
      writeFileSync(
        join(source, "annotations", partition, "point.json"),
        JSON.stringify(annotationFixture(partition, "point", count)),
      );
      writeFileSync(
        join(source, "annotations", partition, "palm.json"),
        JSON.stringify(annotationFixture(partition, "palm", count)),
      );
    }
    const modelPath = join(root, "model.json");
    const metricsPath = join(root, "metrics.json");
    const result = spawnSync(
      "python3",
      [
        "scripts/gesture-training/train_hagrid.py",
        "--source",
        source,
        "--output",
        modelPath,
        "--metrics-output",
        metricsPath,
        "--source-classes",
        "point,palm",
        "--max-per-class",
        "6",
        "--epochs",
        "4",
        "--batch-size",
        "4",
        "--frame-count",
        "6",
        "--device",
        trainingDevice,
        "--seed",
        "19",
        "--min-validation-accuracy",
        "0",
        "--min-test-accuracy",
        "0",
        "--min-class-recall",
        "0",
        "--max-false-grab-rate",
        "1",
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 120_000 },
    );

    expect(result.status, result.stderr).toBe(0);
    const model = JSON.parse(readFileSync(modelPath, "utf8")) as TemporalGestureModel;
    const metrics = JSON.parse(readFileSync(metricsPath, "utf8"));
    expect(model).toMatchObject({
      schemaVersion: "commandcanvas.temporal-gesture-model/v1",
      featureContract: "commandcanvas.gesture-features/v1",
      frameCount: 6,
      classes: ["open_palm", "point"],
      productionEligible: true,
      sourceAttribution: {
        datasetId: "hukenovs/hagrid-v2",
        license:
          "LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved",
      },
      training: {
        algorithm: "multinomial-logistic-regression",
        deviceType: trainingDevice,
        validationStatus: "held_out_evaluated",
        featurePolicy: "pose_only_neutral_context",
        selection: { train: { skippedInvalidLandmarks: 2 } },
      },
    });
    expect(model.weights[0]).toHaveLength(model.inputSize);
    if (cudaAvailable)
      expect(model.training.devicePeakAllocatedBytes).toBeGreaterThan(0);
    else expect(model.training.devicePeakAllocatedBytes).toBe(0);
    expect(metrics).toMatchObject({
      participantLeakage: false,
      validation: { sequenceCount: 6 },
      test: { sequenceCount: 6 },
    });
    expect(
      model.classes,
    ).toContain(classifyGestureSequence(model, makeSequence()).label);
  }, 120_000);
});

function annotationFixture(
  partition: string,
  label: "point" | "palm",
  count: number,
) {
  return Object.fromEntries([
    ...Array.from({ length: count }, (_, index) => {
      const openPalm = label === "palm";
      return [
        `${partition}-${label}-${index}`,
        {
          bboxes: [[0.2, 0.2, 0.4, 0.4]],
          user_id: `${partition}-subject-${index}`,
          labels: [label],
          hand_landmarks: [
            makeLandmarks({
              openPalm,
              offsetX: 0.35 + index * 0.01,
              scale: 0.16 + index * 0.002,
            }).map((point) => [point.x, point.y]),
          ],
          meta: {},
        },
      ] as const;
    }),
    [
      `${partition}-${label}-missing-landmarks`,
      {
        bboxes: [[0.2, 0.2, 0.4, 0.4]],
        user_id: `${partition}-subject-missing-${label}`,
        labels: [label],
        hand_landmarks: [[]],
        meta: {},
      },
    ] as const,
  ]);
}
