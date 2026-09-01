import { z } from "zod";

import type { CanvasState } from "@/lib/canvas/command-engine";
import {
  parseCanvasPersistenceRows,
  roomDataRowSchema,
} from "@/lib/supabase/persistence";
import { persistedRoomHardExpiryEpochMs } from "@/lib/supabase/room-access";

export interface BrowserRoomQueryResult {
  data: unknown;
  error: unknown;
}

export interface BrowserRoomQueryBuilder
  extends PromiseLike<BrowserRoomQueryResult> {
  select: (columns: string) => BrowserRoomQueryBuilder;
  eq: (column: string, value: unknown) => BrowserRoomQueryBuilder;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => BrowserRoomQueryBuilder;
  maybeSingle: () => PromiseLike<BrowserRoomQueryResult>;
}

export interface BrowserRoomClient {
  from: (table: string) => BrowserRoomQueryBuilder;
}

export type BrowserCanvasLoadResult =
  | {
      ok: true;
      state: CanvasState;
      hardExpiresAtEpochMs?: number | null;
    }
  | {
      ok: false;
      code:
        | "room_unavailable"
        | "invalid_persisted_state"
        | "snapshot_unstable";
      message: string;
    };

const membershipRowSchema = z
  .object({
    room_id: z.uuid(),
    user_id: z.uuid(),
    role: z.enum(["host", "participant"]),
    display_name: z.string().trim().min(1).max(64),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    joined_at: z.iso.datetime({ offset: true }),
  })
  .strict();

export interface OwnRoomMembership {
  roomId: string;
  userId: string;
  role: "host" | "participant";
  displayName: string;
  color: string;
  joinedAt: string;
}

export async function loadBrowserCanvas(
  client: BrowserRoomClient,
  roomId: string,
): Promise<BrowserCanvasLoadResult> {
  if (!z.uuid().safeParse(roomId).success) return roomUnavailable();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const beforeResponse = await client
        .from("rooms")
        .select("*")
        .eq("id", roomId)
        .maybeSingle();
      if (hasError(beforeResponse) || beforeResponse.data === null)
        return roomUnavailable();
      const before = roomDataRowSchema.safeParse(beforeResponse.data);
      if (!before.success) return invalidState();

      const objectQuery = client
        .from("canvas_objects")
        .select("*")
        .eq("room_id", roomId)
        .order("id", { ascending: true });
      const receiptQuery = client
        .from("receipts")
        .select("*")
        .eq("room_id", roomId)
        .order("revision", { ascending: true });
      const [objectResponse, receiptResponse] = await Promise.all([
        objectQuery,
        receiptQuery,
      ]);
      if (hasError(objectResponse) || hasError(receiptResponse))
        return roomUnavailable();

      const afterResponse = await client
        .from("rooms")
        .select("*")
        .eq("id", roomId)
        .maybeSingle();
      if (hasError(afterResponse) || afterResponse.data === null)
        return roomUnavailable();
      const after = roomDataRowSchema.safeParse(afterResponse.data);
      if (!after.success) return invalidState();
      if (before.data.revision !== after.data.revision) continue;

      const parsed = parseCanvasPersistenceRows({
        room: after.data,
        objects: objectResponse.data,
        receipts: receiptResponse.data,
      });
      if (!parsed.ok) return invalidState();
      const hardExpiresAtEpochMs = persistedRoomHardExpiryEpochMs({
        mode: after.data.mode,
        created_at: after.data.created_at,
        demo_hard_expires_at: after.data.demo_hard_expires_at ?? null,
      });
      if (hardExpiresAtEpochMs === undefined) return invalidState();
      return { ok: true, state: parsed.state, hardExpiresAtEpochMs };
    } catch {
      return roomUnavailable();
    }
  }

  return {
    ok: false,
    code: "snapshot_unstable",
    message: "Canvas is changing. Try loading it again.",
  };
}

export async function loadOwnRoomMembership(
  client: BrowserRoomClient,
  roomId: string,
  userId: string,
): Promise<
  | { ok: true; membership: OwnRoomMembership }
  | {
      ok: false;
      code: "membership_unavailable";
      message: string;
    }
> {
  if (!z.uuid().safeParse(roomId).success || !z.uuid().safeParse(userId).success)
    return membershipUnavailable();

  try {
    const response = await client
      .from("room_members")
      .select("room_id,user_id,role,display_name,color,joined_at")
      .eq("room_id", roomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (hasError(response) || response.data === null)
      return membershipUnavailable();

    const parsed = membershipRowSchema.safeParse(response.data);
    if (
      !parsed.success ||
      parsed.data.room_id !== roomId ||
      parsed.data.user_id !== userId
    )
      return membershipUnavailable();

    return {
      ok: true,
      membership: {
        roomId: parsed.data.room_id,
        userId: parsed.data.user_id,
        role: parsed.data.role,
        displayName: parsed.data.display_name,
        color: parsed.data.color,
        joinedAt: parsed.data.joined_at,
      },
    };
  } catch {
    return membershipUnavailable();
  }
}

function hasError(result: BrowserRoomQueryResult) {
  return result.error !== null && result.error !== undefined;
}

function roomUnavailable(): Extract<BrowserCanvasLoadResult, { ok: false }> {
  return {
    ok: false,
    code: "room_unavailable",
    message: "Room is unavailable.",
  };
}

function invalidState(): Extract<BrowserCanvasLoadResult, { ok: false }> {
  return {
    ok: false,
    code: "invalid_persisted_state",
    message: "Canvas state could not be verified.",
  };
}

function membershipUnavailable() {
  return {
    ok: false as const,
    code: "membership_unavailable" as const,
    message: "Room membership is unavailable.",
  };
}
