import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDirectory = path.join(repositoryRoot, "public", "workers");

await mkdir(outputDirectory, { recursive: true });
await build({
  entryPoints: [
    path.join(repositoryRoot, "lib", "gesture", "hand-landmarker.worker.ts"),
  ],
  outfile: path.join(outputDirectory, "hand-landmarker.js"),
  alias: { "@": repositoryRoot },
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "eof",
  logLevel: "info",
});
