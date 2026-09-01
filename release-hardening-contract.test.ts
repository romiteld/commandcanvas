import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");
const packageJson = JSON.parse(read("package.json")) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};
const packageLock = JSON.parse(read("package-lock.json")) as {
  packages: Record<
    string,
    { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; version?: string }
  >;
};

describe("server-only dependency boundaries", () => {
  it("pins the production-only marker and replaces it only inside Vitest", () => {
    expect(packageJson.dependencies["server-only"]).toBe("0.0.1");
    expect(packageLock.packages[""]?.dependencies?.["server-only"]).toBe(
      "0.0.1",
    );
    expect(packageLock.packages["node_modules/server-only"]?.version).toBe(
      "0.0.1",
    );
    expect(read("vitest.config.mts")).toMatch(
      /["']server-only["']\s*:\s*fileURLToPath\(/,
    );
  });

  it.each([
    "lib/supabase/server-client.ts",
    "lib/supabase/route-handlers.ts",
    "lib/packets/server-dependencies.ts",
    "lib/packets/server-service.ts",
    "lib/packets/resend.ts",
    "lib/vision/server-dependencies.ts",
    "lib/vision/openai-diagram.ts",
    "lib/realtime-voice/server-dependencies.ts",
    "lib/openai-credentials/service.ts",
    "lib/openai-credentials/route-handler.ts",
  ])("fences %s from client bundles", (relativePath) => {
    expect(read(relativePath)).toMatch(/^import ["']server-only["'];/);
  });
});

describe("user-owned OpenAI credential boundary", () => {
  it("keeps credential-shaped literals out of tracked source and test fixtures", () => {
    const credentialPrefix = ["s", "k", "-"].join("");
    const credentialPattern = new RegExp(
      `${credentialPrefix}[A-Za-z0-9_-]{20,}`,
      "g",
    );
    const textExtensions = new Set([
      ".example",
      ".js",
      ".json",
      ".md",
      ".mjs",
      ".sql",
      ".ts",
      ".tsx",
      ".yaml",
      ".yml",
    ]);
    const excludedDirectories = new Set([
      ".git",
      ".next",
      "node_modules",
      "playwright-report",
      "test-results",
    ]);
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!excludedDirectories.has(entry.name))
            visit(path.join(directory, entry.name));
          continue;
        }
        if (!entry.isFile()) continue;
        const absolutePath = path.join(directory, entry.name);
        if (textExtensions.has(path.extname(entry.name)))
          files.push(path.relative(root, absolutePath));
      }
    };
    visit(root);
    const violations = files.flatMap((file) => {
      const matches = read(file).match(credentialPattern) ?? [];
      return matches.map(() => file);
    });

    expect(violations).toEqual([]);
  });

  it("does not advertise deployment-owned OpenAI keys", () => {
    const exampleEnvironment = read(".env.example");

    expect(exampleEnvironment).not.toMatch(/^OPENAI_API_KEY=/m);
    expect(exampleEnvironment).not.toMatch(/^OPENAI_REALTIME_API_KEY=/m);
  });

  it("keeps the user key out of browser persistence and request bodies", () => {
    const realtimeClient = read("lib/realtime-voice/client.ts");
    const visionClient = read("lib/vision/browser-api.ts");
    const credentialClient = read("lib/openai-credentials/browser-api.ts");
    const browserSources = `${realtimeClient}\n${visionClient}\n${credentialClient}`;

    expect(browserSources).not.toMatch(/localStorage|sessionStorage/);
    expect(realtimeClient).toContain('"x-commandcanvas-openai-key": openAiApiKey');
    expect(realtimeClient).toContain("body: offer.sdp");
    expect(visionClient).toContain(
      '"x-commandcanvas-openai-key": value',
    );
    expect(visionClient).toContain("body: JSON.stringify(input.data)");
    expect(credentialClient).toContain('const ENDPOINT = "/api/openai-credential"');
    expect(credentialClient).not.toMatch(/console\.|indexedDB/i);
  });

  it("has no production fallback to deployment-owned OpenAI keys", () => {
    const realtimeDependencies = read(
      "lib/realtime-voice/server-dependencies.ts",
    );
    const visionDependencies = read("lib/vision/server-dependencies.ts");
    const credentialService = read("lib/openai-credentials/service.ts");

    expect(realtimeDependencies).not.toContain("OPENAI_REALTIME_API_KEY");
    expect(visionDependencies).not.toMatch(
      /readOpenAiDiagramConfig\(options\.environment\)/,
    );
    expect(visionDependencies).toContain("OPENAI_API_KEY: openAiApiKey");
    expect(realtimeDependencies).toContain("resolveAccountOpenAiApiKey");
    expect(visionDependencies).toContain("resolveAccountOpenAiApiKey");
    expect(credentialService).not.toMatch(/OPENAI_API_KEY|OPENAI_REALTIME_API_KEY/);
  });
});

describe("account-first public positioning", () => {
  it("puts the signed workspace before the limited judge preview", () => {
    const readme = read("README.md");
    const signedWorkspace = readme.indexOf("Signed workspace:");
    const judgePreview = readme.indexOf("Limited judge preview:");

    expect(signedWorkspace).toBeGreaterThanOrEqual(0);
    expect(judgePreview).toBeGreaterThan(signedWorkspace);
    expect(readme).not.toMatch(/\bfree demo\b|\bunlimited demo\b/i);
  });

  it.each([
    "README.md",
    "docs/judge-instructions.md",
    "docs/devpost-submission.md",
    "docs/video-shot-list.md",
  ])("describes the public preview boundary in %s", (relativePath) => {
    const copy = read(relativePath);

    expect(copy).toMatch(/limited judge preview|bounded judge preview/i);
    expect(copy).toMatch(/temporary/i);
  });
});

describe("hand detector distribution boundary", () => {
  it("ships only the MediaPipe browser worker and keeps its model remote", () => {
    const enginePlan = read("lib/gesture/spatial-vision-engine.ts");
    const workerBuild = read("scripts/build-hand-worker.mjs");
    const fallbackModelUrl =
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

    expect(enginePlan).toContain(fallbackModelUrl);
    expect(enginePlan).toContain("createMediaPipeSpatialVisionEngine");
    expect(enginePlan).not.toMatch(/yolo|onnx-runtime-web/i);
    expect(enginePlan).not.toContain(
      'modelAssetUrl: "/mediapipe/hand_landmarker.task"',
    );
    expect(
      existsSync(path.join(root, "public/mediapipe/hand_landmarker.task")),
    ).toBe(false);
    expect(
      existsSync(path.join(root, "public/mediapipe/wasm/vision_wasm_internal.wasm")),
    ).toBe(true);
    expect(workerBuild).toContain("hand-landmarker.worker.ts");
    expect(workerBuild).not.toMatch(/yolo|onnxruntime/i);
  });

  it("records local MediaPipe provenance without claiming the external relay as bundled", () => {
    const notices = read("THIRD_PARTY_NOTICES.md");

    expect(notices.replace(/\s+/g, " ")).toContain(
      "The detector model is retrieved from Google at runtime only after the user enables hand input.",
    );
    expect(notices).toContain(
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    );
    expect(notices.replace(/\s+/g, " ")).toContain(
      "CommandCanvas does not bundle or redistribute the detector model and makes no separate licensing claim for it.",
    );
    expect(notices).not.toContain(
      "Local file: `public/mediapipe/hand_landmarker.task`",
    );
    expect(notices).toContain("MediaPipe is the browser hand-landmark engine");
    expect(notices).not.toMatch(/YOLO26|ONNX Runtime Web|AGPL-3.0-only/);
  });
});

describe("release dependency and README wording", () => {
  it("pins jsdom 29.1.1 exactly in the manifest and lockfile", () => {
    expect(packageJson.devDependencies.jsdom).toBe("29.1.1");
    expect(packageLock.packages[""]?.devDependencies?.jsdom).toBe("29.1.1");
    expect(packageLock.packages["node_modules/jsdom"]?.version).toBe("29.1.1");
  });

  it("describes npm run check as the build and unit gate", () => {
    const readme = read("README.md");

    expect(readme).toContain("The local build and unit gate is:");
    expect(readme).not.toContain("The complete local gate is:");
  });
});
