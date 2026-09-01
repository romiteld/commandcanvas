import "server-only";

import { createHash } from "node:crypto";

export type ParsedOpenAiApiKey =
  | { ok: true; key: string; fingerprint: string }
  | { ok: false };

const OPENAI_API_KEY_PATTERN = /^sk-[A-Za-z0-9_-]{17,509}$/;

export function parseOpenAiApiKey(input: unknown): ParsedOpenAiApiKey {
  if (typeof input !== "string") return { ok: false };
  const key = input.trim();
  if (!OPENAI_API_KEY_PATTERN.test(key)) return { ok: false };
  const digest = createHash("sha256").update(key, "utf8").digest("hex");
  return {
    ok: true,
    key,
    fingerprint: `sha256:${digest.slice(0, 16)}`,
  };
}
