const TEST_OPENAI_KEY_PREFIX = ["s", "k", "-"].join("");

export function createTestOpenAiApiKey(label: string) {
  return `${TEST_OPENAI_KEY_PREFIX}${label}-${"x".repeat(32)}`;
}

export function createMalformedTestOpenAiApiKey(suffix: string) {
  return `${TEST_OPENAI_KEY_PREFIX}${suffix}`;
}
