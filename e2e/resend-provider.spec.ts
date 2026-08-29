import { test } from "@playwright/test";

test("requires an authenticated standard room before exercising real Resend delivery", async () => {
  test.skip(
    true,
    "Real provider delivery requires an authenticated standard /meet room and is intentionally not exercised from the preview-only /demo route.",
  );
});
