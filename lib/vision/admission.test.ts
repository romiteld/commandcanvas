// @vitest-environment node

import { describe, expect, it } from "vitest";

import { createVisionAdmissionIdentity } from "@/lib/vision/admission";

const baseRequest = {
  roomId: "11111111-1111-4111-8111-111111111111",
  sketchObjectId: "sketch-source",
  sourceVersion: 2,
  instruction: "Make that usable",
  outputKind: "architecture" as const,
  imageDataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
};

describe("vision admission identity", () => {
  it("does not reuse a cached transform when the spoken diagram context changes", () => {
    const first = createVisionAdmissionIdentity({
      ...baseRequest,
      narration: "The API writes commands to PostgreSQL.",
    });
    const second = createVisionAdmissionIdentity({
      ...baseRequest,
      narration: "The API publishes events to a queue.",
    });

    expect(first.requestKey).not.toBe(second.requestKey);
    expect(first.normalizedNarration).toBe(
      "The API writes commands to PostgreSQL.",
    );
    expect(first.normalizedNarrationSha256).toBe(
      "380bdd86287e31230de1a2ab214de6ead3665f689a327bbf06105fdd84919775",
    );
    expect(second.normalizedNarrationSha256).not.toBe(
      first.normalizedNarrationSha256,
    );
  });

  it("uses an explicit null narration identity when no spoken context exists", () => {
    const identity = createVisionAdmissionIdentity(baseRequest);

    expect(identity.normalizedNarration).toBeUndefined();
    expect(identity.normalizedNarrationSha256).toBeNull();
  });
});
