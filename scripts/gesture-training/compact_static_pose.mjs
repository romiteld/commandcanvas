#!/usr/bin/env node

import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdtemp } from "node:fs/promises";

import { build } from "esbuild";

const directory = await mkdtemp(join(tmpdir(), "commandcanvas-static-pose-cli-"));
const output = join(directory, "compact-static-pose.mjs");
try {
  await build({
    entryPoints: [
      new URL("./compact_static_pose_cli.ts", import.meta.url).pathname,
    ],
    outfile: output,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: false,
  });
  await import(`${pathToFileURL(output).href}?run=${Date.now()}`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
