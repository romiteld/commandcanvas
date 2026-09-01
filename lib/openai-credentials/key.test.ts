// @vitest-environment node

import { describe, expect, it } from "vitest";

import { parseOpenAiApiKey } from "@/lib/openai-credentials/key";

const VALID_KEY = "sk-test-session-owned-key-123456789012345";

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
    "sk-too-short",
    `sk-${"a".repeat(510)}`,
    "sk-valid-looking-but-has.a-dot",
    "sk-valid-looking-but-has a-space",
  ])("refuses malformed or unbounded input without echoing it: %s", (input) => {
    expect(parseOpenAiApiKey(input)).toEqual({ ok: false });
  });
});
