import type { StoreApi } from "zustand";

import {
  createCanvasStore,
  type CanvasStoreState,
} from "@/lib/canvas/canvas-store";
import type { CanvasState } from "@/lib/canvas/command-engine";
import { createDemoSeedCommands } from "@/lib/demo/fixtures";
import {
  createDemoInviteUrl,
  parseDemoJoinLink,
  readStoredDemoRoom,
  storeDemoRoom,
} from "@/lib/demo/room-link";
import type {
  DemoRoomSession,
  DemoRoomStartIntent,
} from "@/lib/demo/room-session";

interface DemoSessionStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => unknown;
  removeItem: (key: string) => unknown;
}

export type DemoBootstrapSessionFactory = (
  hydrateCanvas: (state: CanvasState) => boolean,
) => DemoRoomSession;

export interface DemoRoomBootstrapOptions {
  search: string;
  origin: string;
  storage: DemoSessionStorage;
  replacePath: (path: string) => void;
  createSession: DemoBootstrapSessionFactory;
}

export type DemoRoomBootstrapResult =
  | {
      ok: true;
      session: DemoRoomSession;
      store: StoreApi<CanvasStoreState>;
      role: "host" | "participant";
      inviteUrl: string | null;
    }
  | { ok: false; code: string; message: string };

export async function bootstrapDemoRoom(
  options: DemoRoomBootstrapOptions,
): Promise<DemoRoomBootstrapResult> {
  const searchParams = new URLSearchParams(options.search);
  const hasInviteFields = searchParams.has("room") || searchParams.has("join");
  const joinLink = parseDemoJoinLink(searchParams);
  if (hasInviteFields && !joinLink)
    return failure("invalid_invite", "This demo invite link is invalid.");

  const stored = joinLink ? null : readStoredDemoRoom(options.storage);
  const intent = resolveStartIntent(joinLink, stored);
  let store: StoreApi<CanvasStoreState> | null = null;
  const session = options.createSession((state) => {
    if (!store)
      store = createCanvasStore(state.roomId, {
        actor: {
          id: "browser-room-member",
          displayName: "Room member",
          type: "human",
        },
        createId: (prefix) => `${prefix}-${globalThis.crypto.randomUUID()}`,
        now: () => new Date().toISOString(),
      });
    return store.getState().hydrateCanvas(state);
  });

  const started = await session.start(intent);
  if (!started.ok) {
    await session.dispose();
    return failure(started.code, started.message);
  }

  let snapshot = session.getSnapshot();
  if (!store || !snapshot.state || !snapshot.membership) {
    await session.dispose();
    return failure(
      "room_not_verified",
      "The demo room did not return verified canvas state.",
    );
  }

  if (snapshot.membership.role === "host" && snapshot.state.revision === 0) {
    for (const command of createDemoSeedCommands(started.roomId)) {
      const result = await session.submitCommand(command, "system");
      if (!result.ok) {
        await session.dispose();
        return failure(result.code, result.message);
      }
    }
    snapshot = session.getSnapshot();
  }

  if (!snapshot.state || !snapshot.membership) {
    await session.dispose();
    return failure(
      "room_not_verified",
      "The demo room did not return verified canvas state.",
    );
  }

  const membership = snapshot.membership;
  const role = membership.role;
  if (role === "host" && snapshot.joinAccess) {
    storeDemoRoom(options.storage, {
      roomId: membership.roomId,
      slug: snapshot.joinAccess.slug,
      role,
      displayName: membership.displayName,
      color: membership.color,
      joinToken: snapshot.joinAccess.joinToken,
    });
  } else if (role === "participant") {
    const slug = joinLink?.slug ?? stored?.slug;
    if (slug)
      storeDemoRoom(options.storage, {
        roomId: membership.roomId,
        slug,
        role,
        displayName: membership.displayName,
        color: membership.color,
      });
  }

  if (joinLink) options.replacePath("/demo");

  let inviteUrl: string | null = null;
  if (role === "host" && snapshot.joinAccess) {
    try {
      inviteUrl = createDemoInviteUrl(
        options.origin,
        snapshot.joinAccess.slug,
        snapshot.joinAccess.joinToken,
      );
    } catch {
      inviteUrl = null;
    }
  }

  return { ok: true, session, store, role, inviteUrl };
}

function resolveStartIntent(
  joinLink: ReturnType<typeof parseDemoJoinLink>,
  stored: ReturnType<typeof readStoredDemoRoom>,
): DemoRoomStartIntent {
  if (joinLink)
    return {
      kind: "join",
      slug: joinLink.slug,
      joinToken: joinLink.joinToken,
      displayName: "Sarah",
      color: "#38bdf8",
    };
  if (stored?.role === "host")
    return {
      kind: "resume",
      roomId: stored.roomId,
      expectedRole: "host",
      joinAccess: { slug: stored.slug, joinToken: stored.joinToken },
    };
  if (stored?.role === "participant")
    return {
      kind: "resume",
      roomId: stored.roomId,
      expectedRole: "participant",
    };
  return {
    kind: "host",
    roomName: "CommandCanvas demo room",
    displayName: "Daniel",
    color: "#f26a5b",
  };
}

function failure(code: string, message: string) {
  return { ok: false as const, code, message };
}
