import { describe, expect, it } from "vitest";

import {
  isPersistedRoomAccessActive,
  persistedRoomHardExpiryEpochMs,
} from "@/lib/supabase/room-access";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

describe("persisted room hard-expiry access", () => {
  it("resolves the fixed or legacy demo deadline but leaves standard rooms unbounded", () => {
    expect(
      persistedRoomHardExpiryEpochMs({
        mode: "standard",
        created_at: "2020-01-01T00:00:00.000Z",
        demo_hard_expires_at: null,
      }),
    ).toBeNull();
    expect(
      persistedRoomHardExpiryEpochMs({
        mode: "demo",
        created_at: "2026-08-31T12:00:00.000Z",
        demo_hard_expires_at: "2026-09-01T13:00:00.000Z",
      }),
    ).toBe(Date.parse("2026-09-01T13:00:00.000Z"));
    expect(
      persistedRoomHardExpiryEpochMs({
        mode: "demo",
        created_at: "2026-08-31T12:00:00.000Z",
        demo_hard_expires_at: null,
      }),
    ).toBe(Date.parse("2026-09-01T12:00:00.000Z"));
    expect(persistedRoomHardExpiryEpochMs({ mode: "demo" })).toBeUndefined();
  });

  it("keeps standard rooms active regardless of age", () => {
    expect(
      isPersistedRoomAccessActive(
        {
          mode: "standard",
          created_at: "2020-01-01T00:00:00.000Z",
          demo_hard_expires_at: null,
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("allows a demo strictly before its fixed hard expiry", () => {
    expect(
      isPersistedRoomAccessActive(
        {
          mode: "demo",
          created_at: "2026-08-31T12:00:00.000Z",
          demo_hard_expires_at: "2026-09-01T12:00:00.001Z",
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("denies a demo at or after its fixed hard expiry", () => {
    for (const hardExpiry of [
      "2026-09-01T12:00:00.000Z",
      "2026-09-01T11:59:59.999Z",
    ]) {
      expect(
        isPersistedRoomAccessActive(
          {
            mode: "demo",
            created_at: "2026-08-31T12:00:00.000Z",
            demo_hard_expires_at: hardExpiry,
          },
          NOW,
        ),
      ).toBe(false);
    }
  });

  it("applies created-at plus 24 hours to legacy demo rows", () => {
    expect(
      isPersistedRoomAccessActive(
        {
          mode: "demo",
          created_at: "2026-08-31T12:00:00.001Z",
          demo_hard_expires_at: null,
        },
        NOW,
      ),
    ).toBe(true);
    expect(
      isPersistedRoomAccessActive(
        {
          mode: "demo",
          created_at: "2026-08-31T12:00:00.000Z",
          demo_hard_expires_at: null,
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("fails closed on malformed or incomplete service-role rows", () => {
    for (const row of [
      null,
      { mode: "demo" },
      {
        mode: "demo",
        created_at: "not-a-timestamp",
        demo_hard_expires_at: null,
      },
      {
        mode: "demo",
        created_at: "2026-09-01T11:00:00.000Z",
        demo_hard_expires_at: "not-a-timestamp",
      },
    ]) {
      expect(isPersistedRoomAccessActive(row, NOW)).toBe(false);
    }
  });
});
