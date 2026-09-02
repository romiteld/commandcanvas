import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

describe("MIT application and external AGPL relay boundary", () => {
  it("licenses only the CommandCanvas application under MIT", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      license?: string;
    };
    const packageLock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { license?: string }>;
    };
    const license = read("LICENSE");
    const notice = read("NOTICE");

    expect(packageJson.license).toBe("MIT");
    expect(packageLock.packages[""]?.license).toBe("MIT");
    expect(license).toContain("MIT License");
    expect(license).toContain("Copyright (c) 2026 Daniel Romitelli");
    expect(license).toContain(
      "Permission is hereby granted, free of charge, to any person obtaining a copy",
    );
    expect(license).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
    expect(license).not.toMatch(/Affero|AGPL/i);
    expect(notice).toContain("licensed under the MIT License");
    expect(notice).not.toMatch(/Affero|AGPL/i);
  });

  it("contains no browser YOLO, ONNX Runtime, native relay, or relay-ops artifact", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };
    const packageLock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, unknown>;
    };
    const forbiddenPaths = [
      "lib/gesture/yolo-hand-pose-detector.ts",
      "lib/gesture/yolo-hand-pose-detector.test.ts",
      "lib/gesture/yolo-hand-pose.worker.ts",
      "e2e/yolo-hand-pose-worker.spec.ts",
      "public/models/yolo26_hand_pose_320_fp16.onnx",
      "public/workers/yolo-hand-pose.js",
      "public/onnxruntime",
      "services/hand-relay",
      "ops/hand-relay",
    ];

    for (const relativePath of forbiddenPaths)
      expect(existsSync(path.join(root, relativePath)), relativePath).toBe(false);
    expect(packageJson.dependencies).not.toHaveProperty("onnxruntime-web");
    expect(
      Object.keys(packageLock.packages).filter((entry) =>
        entry.toLowerCase().includes("onnxruntime"),
      ),
    ).toEqual([]);
    expect(read("scripts/build-hand-worker.mjs")).not.toMatch(/yolo|onnx/i);
  });

  it("documents the MIT boundary and exact published relay source", () => {
    const readme = read("README.md");
    const source = read("SOURCE.md");
    const relayDocumentation = read("docs/private-hand-relay.md");
    const notices = read("THIRD_PARTY_NOTICES.md");
    const relaySourceUrl =
      "https://github.com/romiteld/commandcanvas/tree/ee5c2afcfbfc8427b39e2f13e170785c87bce2e3";

    expect(readme).toContain("[MIT License](LICENSE)");
    expect(source).toContain(
      "The optional private GPU relay is not distributed in this repository.",
    );
    expect(source).toContain(relaySourceUrl);
    expect(relayDocumentation).toContain(relaySourceUrl);
    expect(source).not.toMatch(/not published|publication as pending/i);
    expect(relayDocumentation).not.toMatch(
      /public URL is intentionally not listed|source-link follow-up/i,
    );
    expect(notices).toContain("## MediaPipe Tasks Vision");
    expect(notices).not.toContain("## ONNX Runtime Web");
    expect(notices).not.toContain("## Native CUDA relay runtime");
    expect(notices).not.toContain("## YOLO26 Hand Pose runtime models");
  });

  it("keeps internal execution reports out of the public repository", () => {
    expect(existsSync(path.join(root, ".superpowers"))).toBe(false);
    expect(read(".gitignore")).toContain("/.superpowers/");
  });

  it("publishes only the named refusal-gated HaGRID pose artifact under its exact custom license", () => {
    const modelDirectory = path.join(root, "public", "models");
    const entries = existsSync(modelDirectory)
      ? readdirSync(modelDirectory).filter((entry) => entry !== ".gitkeep")
      : [];
    expect(entries).toEqual([
      "commandcanvas-hagrid-v2-static-pose-model-v1.json",
    ]);
    const bytes = readFileSync(path.join(modelDirectory, entries[0]!));
    const artifact = JSON.parse(bytes.toString("utf8")) as {
      schemaVersion?: string;
      productionEligible?: boolean;
      sourceAttribution?: {
        license?: string;
        licenseUrl?: string;
        derivedArtifactLicense?: string;
      };
    };
    const customLicense =
      "LicenseRef-HaGRID-Public-License-With-Attribution-And-Conditions-Reserved";
    const customLicenseUrl =
      "https://raw.githubusercontent.com/hukenovs/hagrid/080e18917376ec935e453cd0e599c23478c7e98f/license/en_us.pdf";
    expect(artifact).toMatchObject({
      schemaVersion: "commandcanvas.static-hand-pose-model/v1",
      productionEligible: true,
      sourceAttribution: {
        license: customLicense,
        licenseUrl: customLicenseUrl,
        derivedArtifactLicense: customLicense,
      },
    });
    expect(read("THIRD_PARTY_NOTICES.md")).toContain(customLicenseUrl);
    expect(read("THIRD_PARTY_NOTICES.md")).toContain(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });
});
