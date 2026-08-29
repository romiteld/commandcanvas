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

  it("documents the MIT source boundary and an explicit relay-source follow-up", () => {
    const readme = read("README.md");
    const source = read("SOURCE.md");
    const notices = read("THIRD_PARTY_NOTICES.md");

    expect(readme).toContain("[MIT License](LICENSE)");
    expect(source).toContain(
      "The optional private GPU relay is not distributed in this repository.",
    );
    expect(source).toContain("Source-link follow-up");
    expect(notices).toContain("## MediaPipe Tasks Vision");
    expect(notices).not.toContain("## ONNX Runtime Web");
    expect(notices).not.toContain("## Native CUDA relay runtime");
    expect(notices).not.toContain("## YOLO26 Hand Pose runtime models");
  });

  it("does not leave a hidden model under the public model directory", () => {
    const modelDirectory = path.join(root, "public", "models");
    const entries = existsSync(modelDirectory)
      ? readdirSync(modelDirectory).filter((entry) => entry !== ".gitkeep")
      : [];
    expect(entries).toEqual([]);
  });
});
