// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { pollInvitationDelivery } from "@/lib/supabase/invitation-delivery-poller";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";

describe("bounded invitation delivery polling", () => {
  it("continues through submitted and stops only on webhook-confirmed delivery", async () => {
    const loadInvitationDelivery = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          invitationId: INVITATION_ID,
          roomId: ROOM_ID,
          delivery: { status: "submitted" as const, message: "Pending" },
        },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          invitationId: INVITATION_ID,
          roomId: ROOM_ID,
          delivery: { status: "delivered" as const, message: "Delivered" },
        },
      });
    const updates: string[] = [];

    const result = await pollInvitationDelivery({
      api: { loadInvitationDelivery },
      roomId: ROOM_ID,
      invitationId: INVITATION_ID,
      signal: new AbortController().signal,
      delaysMs: [1, 2, 3],
      wait: vi.fn(async () => undefined),
      onUpdate: (value) => updates.push(value.delivery.status),
    });

    expect(result).toMatchObject({
      ok: true,
      value: { delivery: { status: "delivered" } },
    });
    expect(updates).toEqual(["submitted", "delivered"]);
    expect(loadInvitationDelivery).toHaveBeenCalledTimes(2);
  });

  it("is bounded while a status remains nonterminal", async () => {
    const loadInvitationDelivery = vi.fn(async () => ({
      ok: true as const,
      value: {
        invitationId: INVITATION_ID,
        roomId: ROOM_ID,
        delivery: { status: "reconciling" as const, message: "Reconciling" },
      },
    }));

    const result = await pollInvitationDelivery({
      api: { loadInvitationDelivery },
      roomId: ROOM_ID,
      invitationId: INVITATION_ID,
      signal: new AbortController().signal,
      delaysMs: [1, 2],
      wait: vi.fn(async () => undefined),
    });

    expect(result).toMatchObject({
      ok: true,
      value: { delivery: { status: "reconciling" } },
      exhausted: true,
    });
    expect(loadInvitationDelivery).toHaveBeenCalledTimes(3);
  });

  it("aborts before another status request after unmount", async () => {
    const controller = new AbortController();
    const loadInvitationDelivery = vi.fn(async () => ({
      ok: true as const,
      value: {
        invitationId: INVITATION_ID,
        roomId: ROOM_ID,
        delivery: { status: "submitted" as const, message: "Pending" },
      },
    }));
    const wait = vi.fn(async () => {
      controller.abort();
    });

    const result = await pollInvitationDelivery({
      api: { loadInvitationDelivery },
      roomId: ROOM_ID,
      invitationId: INVITATION_ID,
      signal: controller.signal,
      delaysMs: [1, 2],
      wait,
    });

    expect(result).toEqual({ ok: false, error: { code: "request_cancelled" } });
    expect(loadInvitationDelivery).toHaveBeenCalledTimes(1);
  });
});
