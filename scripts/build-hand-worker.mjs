import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(repositoryRoot, "public", "workers");
const onnxRuntimeOutputDirectory = path.join(
  repositoryRoot,
  "public",
  "onnxruntime",
);

await Promise.all([
  mkdir(outputDirectory, { recursive: true }),
  mkdir(onnxRuntimeOutputDirectory, { recursive: true }),
]);
await build({
  entryPoints: {
    "hand-landmarker": path.join(
      repositoryRoot,
      "lib",
      "gesture",
      "hand-landmarker.worker.ts",
    ),
    "yolo-hand-pose": path.join(
      repositoryRoot,
      "lib",
      "gesture",
      "yolo-hand-pose.worker.ts",
    ),
  },
  outdir: outputDirectory,
  alias: { "@": repositoryRoot },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
  logLevel: "info",
});

const onnxRuntimeDistribution = path.join(
  repositoryRoot,
  "node_modules",
  "onnxruntime-web",
  "dist",
);
await Promise.all(
  [
    "ort-wasm-simd-threaded.mjs",
    "ort-wasm-simd-threaded.wasm",
    "ort-wasm-simd-threaded.jsep.mjs",
    "ort-wasm-simd-threaded.jsep.wasm",
  ].map(
    (fileName) =>
      copyFile(
        path.join(onnxRuntimeDistribution, fileName),
        path.join(onnxRuntimeOutputDirectory, fileName),
      ),
  ),
);
