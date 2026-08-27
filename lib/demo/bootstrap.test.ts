import { describe, expect, it, vi } from "vitest";

import {
  applyCanvasCommand,
  createEmptyCanvasState,
  type CanvasCommand,
} from "@/lib/canvas/command-engine";
import {
  bootstrapDemoRoom,
  type DemoBootstrapSessionFactory,
} from "@/lib/demo/bootstrap";
import { readStoredDemoRoom } from "@/lib/demo/room-link";
import type {
  DemoRoomSession,
  DemoRoomSnapshot,
  DemoRoomStartIntent,
} from "@/lib/demo/room-session";

const ROOM_ID = "d32af6a9-31dd-4dfc-98d5-fcf439b9b106";
const USER_ID = "96ceecfe-ab18-4fda-9591-9945a73fe709";
const TOKEN = "t".repeat(43);
const SLUG = "room-0123456789abcdef0123456789abcdef";

function memoryStorage(initial?: unknown) {
  const values = new Map<string, string>();
  if (initial !== undefined)
    values.set("commandcanvas.demo.room.v1", JSON.stringify(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

function fakeSessionFactory(options?: {
  role?: "host" | "participant";
  failStart?: boolean;
  failAtCommand?: number;
}) {
  let session: DemoRoomSession | null = null;
  let startIntent: DemoRoomStartIntent | null = null;
  const submitted: CanvasCommand[] = [];
  let disposed = 0;

  const factory: DemoBootstrapSessionFactory = (hydrateCanvas) => {
    let state = createEmptyCanvasState(ROOM_ID);
    let snapshot: DemoRoomSnapshot = {
      status: "ready",
      realtimeStatus: "connected",
      identity: { userId: USER_ID, isAnonymous: true },
      roomId: ROOM_ID,
      membership: {
        roomId: ROOM_ID,
        userId: USER_ID,
        role: options?.role ?? "host",
        displayName: options?.role === "participant" ? "Sarah" : "Daniel",
        color: options?.role === "participant" ? "#38bdf8" : "#f26a5b",
        joinedAt: "2026-08-27T12:00:00.000Z",
      },
      state,
      joinAccess:
        (options?.role ?? "host") === "host"
          ? { slug: SLUG, joinToken: TOKEN }
          : null,
      presence: [],
      cursors: {},
      commandPending: false,
      lastError: null,
    };
    const listeners = new Set<() => void>();
    session = {
      getSnapshot: () => snapshot,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      start: async (intent) => {
        startIntent = intent;
        if (options?.failStart)
          return { ok: false, code: "start_failed", message: "Room start failed." };
        hydrateCanvas(state);
        return { ok: true, roomId: ROOM_ID };
      },
      submitCommand: async (command, source) => {
        submitted.push(command);
        if (submitted.length === options?.failAtCommand)
          return {
            ok: false,
            code: "seed_failed",
            message: "Demo fixture could not be committed.",
          };
        const applied = applyCanvasCommand(
          state,
          {
            id: `2f126835-122e-4536-8cb4-${String(submitted.length).padStart(12, "0")}`,
            roomId: ROOM_ID,
            baseRevision: state.revision,
            issuedAt: `2026-08-27T12:00:0${submitted.length}.000Z`,
            actor: { id: USER_ID, displayName: "Daniel", type: "human" },
            source,
            command,
          },
          {
            createId: () =>
              `3f126835-122e-4536-8cb4-${String(submitted.length).padStart(12, "0")}`,
          },
        );
        if (!applied.ok)
          return { ok: false, code: applied.error.code, message: applied.error.message };
        state = applied.state;
        snapshot = { ...snapshot, state };
        hydrateCanvas(state);
        listeners.forEach((listener) => listener());
        return { ok: true, state };
      },
      publishCursor: async () => true,
      whenIdle: async () => undefined,
      dispose: async () => {
        disposed += 1;
      },
    };
    return session;
  };

  return {
    factory,
    get session() {
      return session;
    },
    get startIntent() {
      return startIntent;
    },
    get submitted() {
      return submitted;
    },
    get disposed() {
      return disposed;
    },
  };
}

describe("bootstrapDemoRoom", () => {
  it("opens a new no-signup host room and commits all deterministic fixtures", async () => {
    const harness = fakeSessionFactory();
    const storage = memoryStorage();
    const replacePath = vi.fn();

    const result = await bootstrapDemoRoom({
      search: "",
      origin: "https://commandcanvas.example",
      storage,
      replacePath,
      createSession: harness.factory,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(harness.startIntent).toEqual({
      kind: "host",
      roomName: "CommandCanvas demo room",
      displayName: "Daniel",
      color: "#f26a5b",
    });
    expect(harness.submitted).toHaveLength(3);
    expect(result.store.getState().canvas.revision).toBe(3);
    expect(result.inviteUrl).toContain(`/demo?room=${SLUG}&join=${TOKEN}`);
    expect(replacePath).not.toHaveBeenCalled();
  });

  it("joins from a capability link, never seeds participant state, and scrubs the URL", async () => {
    const harness = fakeSessionFactory({ role: "participant" });
    const storage = memoryStorage();
    const replacePath = vi.fn();

    const result = await bootstrapDemoRoom({
      search: `?room=${SLUG}&join=${TOKEN}`,
      origin: "https://commandcanvas.example",
      storage,
      replacePath,
      createSession: harness.factory,
    });

    expect(result.ok).toBe(true);
    expect(harness.startIntent).toEqual({
      kind: "join",
      slug: SLUG,
      joinToken: TOKEN,
      displayName: "Sarah",
      color: "#38bdf8",
    });
    expect(harness.submitted).toHaveLength(0);
    expect(replacePath).toHaveBeenCalledExactlyOnceWith("/demo");
    expect(readStoredDemoRoom(storage)).toEqual({
      roomId: ROOM_ID,
      slug: SLUG,
      role: "participant",
      displayName: "Sarah",
      color: "#38bdf8",
    });
    expect(result.ok && result.inviteUrl).toBeNull();
  });

  it("resumes a validated per-tab host room instead of creating another", async () => {
    const harness = fakeSessionFactory();
    const storage = memoryStorage({
      roomId: ROOM_ID,
      slug: SLUG,
      role: "host",
      displayName: "Daniel",
      color: "#f26a5b",
      joinToken: TOKEN,
    });

    const result = await bootstrapDemoRoom({
      search: "",
      origin: "https://commandcanvas.example",
      storage,
      replacePath: vi.fn(),
      createSession: harness.factory,
    });

    expect(result.ok).toBe(true);
    expect(harness.startIntent).toEqual({
      kind: "resume",
      roomId: ROOM_ID,
      expectedRole: "host",
      joinAccess: { slug: SLUG, joinToken: TOKEN },
    });
  });

  it("refuses a malformed capability link without opening a session", async () => {
    const harness = fakeSessionFactory();
    const result = await bootstrapDemoRoom({
      search: `?room=${SLUG}&join=bad token`,
      origin: "https://commandcanvas.example",
      storage: memoryStorage(),
      replacePath: vi.fn(),
      createSession: harness.factory,
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_invite",
      message: "This demo invite link is invalid.",
    });
    expect(harness.session).toBeNull();
  });

  it("reports fixture failure and disposes instead of showing a partially seeded success", async () => {
    const harness = fakeSessionFactory({ failAtCommand: 2 });
    const result = await bootstrapDemoRoom({
      search: "",
      origin: "https://commandcanvas.example",
      storage: memoryStorage(),
      replacePath: vi.fn(),
      createSession: harness.factory,
    });

    expect(result).toEqual({
      ok: false,
      code: "seed_failed",
      message: "Demo fixture could not be committed.",
    });
    expect(harness.disposed).toBe(1);
  });
});
