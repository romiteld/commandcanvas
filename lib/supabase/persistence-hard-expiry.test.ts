import { describe, expect, it } from "vitest";

import { roomDataRowSchema } from "@/lib/supabase/persistence";

describe("persisted room hard-expiry column", () => {
  it("accepts the room row returned by select star after the migration", () => {
    expect(
      roomDataRowSchema.safeParse({
        id: "11111111-1111-4111-8111-111111111111",
        slug: "commandcanvas-demo-room",
        name: "CommandCanvas demo",
        mode: "demo",
        revision: 2,
        created_by: "22222222-2222-4222-8222-222222222222",
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T01:00:00.000Z",
        demo_hard_expires_at: "2026-09-02T00:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("accepts legacy and standard rows whose hard-expiry column is null", () => {
    expect(
      roomDataRowSchema.safeParse({
        id: "11111111-1111-4111-8111-111111111111",
        slug: "commandcanvas-standard-room",
        name: "CommandCanvas meeting",
        mode: "standard",
        revision: 2,
        created_by: "22222222-2222-4222-8222-222222222222",
        created_at: "2026-09-01T00:00:00.000Z",
        updated_at: "2026-09-01T01:00:00.000Z",
        demo_hard_expires_at: null,
      }).success,
    ).toBe(true);
  });
});
