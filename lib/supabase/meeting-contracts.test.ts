import { describe, expect, it } from "vitest";

import {
  acceptMeetingInvitationRequestSchema,
  createMeetingInvitationRequestSchema,
  createMeetingRequestSchema,
} from "@/lib/supabase/meeting-contracts";

describe("meeting request contracts", () => {
  it("accepts only bounded standard meeting creation fields", () => {
    expect(
      createMeetingRequestSchema.safeParse({
        name: "Product review",
        displayName: "Danny",
        color: "#0ea5e9",
      }).success,
    ).toBe(true);
    expect(
      createMeetingRequestSchema.safeParse({
        name: "Product review",
        displayName: "Danny",
        color: "#0ea5e9",
        mode: "demo",
      }).success,
    ).toBe(false);
  });

  it("normalizes an email invitation while forbidding role escalation", () => {
    const parsed = createMeetingInvitationRequestSchema.parse({
      requestId: "44444444-4444-4444-8444-444444444444",
      email: "  Sarah@Example.COM ",
      displayName: "Sarah",
      color: "#a855f7",
      expiresInHours: 24,
    });
    expect(parsed.email).toBe("sarah@example.com");
    expect(parsed.requestId).toBe("44444444-4444-4444-8444-444444444444");
    expect(
      createMeetingInvitationRequestSchema.safeParse({
        ...parsed,
        role: "host",
      }).success,
    ).toBe(false);
    expect(
      createMeetingInvitationRequestSchema.safeParse({
        ...parsed,
        expiresInHours: 169,
      }).success,
    ).toBe(false);
  });

  it("requires a caller-stable UUID for invitation retries", () => {
    expect(
      createMeetingInvitationRequestSchema.safeParse({
        email: "sarah@example.com",
        displayName: "Sarah",
        color: "#a855f7",
        expiresInHours: 24,
      }).success,
    ).toBe(false);
    expect(
      createMeetingInvitationRequestSchema.safeParse({
        requestId: "not-a-uuid",
        email: "sarah@example.com",
        displayName: "Sarah",
        color: "#a855f7",
        expiresInHours: 24,
      }).success,
    ).toBe(false);
  });

  it("requires a bounded opaque invitation token and no participant identity fields", () => {
    const token = "a".repeat(43);
    expect(
      acceptMeetingInvitationRequestSchema.safeParse({ token }).success,
    ).toBe(true);
    expect(
      acceptMeetingInvitationRequestSchema.safeParse({
        token,
        email: "attacker@example.com",
      }).success,
    ).toBe(false);
    expect(
      acceptMeetingInvitationRequestSchema.safeParse({ token: "short" })
        .success,
    ).toBe(false);
  });
});
