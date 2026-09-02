import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { StaticHandPoseModel } from "@/lib/gesture/learning/static-pose-model";
import { makeNeutralTemporalModel } from "@/lib/gesture/learning/static-pose-model.test-support";
import { makeSequence } from "@/lib/gesture/learning/test-fixtures.test-support";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("static hand-pose artifact CLI", () => {
  it("writes an audited compact artifact without discarding attribution or promotion metrics", () => {
    const root = mkdtempSync(join(tmpdir(), "commandcanvas-static-pose-"));
    temporaryDirectories.push(root);
    const sourcePath = join(root, "temporal.json");
    const outputPath = join(root, "static.json");
    const sourceBytes = `${JSON.stringify(makeNeutralTemporalModel(makeSequence()))}\n`;
    writeFileSync(sourcePath, sourceBytes);

    const result = spawnSync(
      "node",
      [
        "scripts/gesture-training/compact_static_pose.mjs",
        "--source",
        sourcePath,
        "--output",
        outputPath,
      ],
      { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 },
    );

    expect(result.status, result.stderr).toBe(0);
    const compact = JSON.parse(readFileSync(outputPath, "utf8")) as StaticHandPoseModel;
    expect(compact).toMatchObject({
      schemaVersion: "commandcanvas.static-hand-pose-model/v1",
      inputSize: 72,
      productionEligible: true,
      sourceAttribution: {
        datasetId: "hukenovs/hagrid-v2",
        license:
          "LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved",
      },
      promotion: { eligible: true },
      heldOut: { test: { accuracy: 0.9 } },
      compactionAudit: {
        sourceModelSha256: createHash("sha256").update(sourceBytes).digest("hex"),
        maxNeutralStandardizedResidual: 0,
        maxNeutralLogitContribution: 0,
      },
    });
    expect(statSync(outputPath).size).toBeLessThan(statSync(sourcePath).size);
  });
});
