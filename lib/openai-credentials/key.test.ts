// @vitest-environment node

import { describe, expect, it } from "vitest";

import { parseOpenAiApiKey } from "@/lib/openai-credentials/key";
import {
  createMalformedTestOpenAiApiKey,
  createTestOpenAiApiKey,
} from "@/lib/testing/openai-key-fixture";

const VALID_KEY = createTestOpenAiApiKey("test-session-owned-key");

describe("saved OpenAI API key validation", () => {
  it("normalizes a plausible key and derives a non-reversible fingerprint", () => {
    const result = parseOpenAiApiKey(`  ${VALID_KEY}  `);

    expect(result).toEqual({
      ok: true,
      key: VALID_KEY,
      fingerprint: expect.stringMatching(/^sha256:[0-9a-f]{16}$/),
    });
    if (!result.ok) return;
    expect(result.fingerprint).not.toContain(VALID_KEY);
    expect(result.fingerprint).not.toContain(VALID_KEY.slice(-6));
  });

  it.each([
    "",
    "not-an-openai-key",
    createMalformedTestOpenAiApiKey("too-short"),
    createMalformedTestOpenAiApiKey("a".repeat(510)),
    createMalformedTestOpenAiApiKey("valid-looking-but-has.a-dot"),
    createMalformedTestOpenAiApiKey("valid-looking-but-has a-space"),
  ])("refuses malformed or unbounded input without echoing it: %s", (input) => {
    expect(parseOpenAiApiKey(input)).toEqual({ ok: false });
  });
});
