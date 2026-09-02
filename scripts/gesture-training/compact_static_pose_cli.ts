import { createHash } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { compactTemporalModelToStaticPose } from "@/lib/gesture/learning/static-pose-model";
import type { TemporalGestureModel } from "@/lib/gesture/learning/model";

const argumentsByName = parseArguments(process.argv.slice(2));
const sourcePath = requiredArgument(argumentsByName, "source");
const outputPath = requiredArgument(argumentsByName, "output");
const sourceBytes = readFileSync(sourcePath);
const sourceModel = JSON.parse(sourceBytes.toString("utf8")) as TemporalGestureModel;
const compact = compactTemporalModelToStaticPose(sourceModel, {
  sourceModelSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  sourceModelSizeBytes: sourceBytes.length,
});
const serialized = `${JSON.stringify(compact)}\n`;
mkdirSync(dirname(outputPath), { recursive: true });
const temporaryPath = `${outputPath}.tmp-${process.pid}`;
writeFileSync(temporaryPath, serialized, { mode: 0o644 });
renameSync(temporaryPath, outputPath);
process.stdout.write(
  `${JSON.stringify({
    status: "compacted",
    sourceBytes: sourceBytes.length,
    outputBytes: Buffer.byteLength(serialized),
    classes: compact.classes,
    productionEligible: compact.productionEligible,
    output: outputPath,
  })}\n`,
);

function parseArguments(values: readonly string[]) {
  const parsed = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || value === undefined)
      throw new TypeError("Usage: compact_static_pose.mjs --source MODEL --output MODEL");
    parsed.set(name.slice(2), value);
  }
  return parsed;
}

function requiredArgument(values: ReadonlyMap<string, string>, name: string) {
  const value = values.get(name);
  if (!value) throw new TypeError(`Missing required --${name} argument.`);
  return value;
}
