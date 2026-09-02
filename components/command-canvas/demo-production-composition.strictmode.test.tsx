import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({
  createClient: vi.fn(),
  loadOwnRoomMembership: vi.fn(),
  loadBrowserCanvas: vi.fn(),
  createBrowserRoomApi: vi.fn(),
  createBrowserPacketApi: vi.fn(),
  createRoomRealtime: vi.fn(),
  realtimeConnect: vi.fn(),
  realtimeDispose: vi.fn(),
  realtimePublishCursor: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: ports.createClient,
}));

vi.mock("@/lib/supabase/browser-room", () => ({
  loadOwnRoomMembership: ports.loadOwnRoomMembership,
  loadBrowserCanvas: ports.loadBrowserCanvas,
}));

vi.mock("@/lib/supabase/room-api", () => ({
  createBrowserRoomApi: ports.createBrowserRoomApi,
}));

vi.mock("@/lib/packets/browser-api", () => ({
  createBrowserPacketApi: ports.createBrowserPacketApi,
}));

vi.mock("@/lib/realtime/room-channel", () => ({
  createRoomRealtime: ports.createRoomRealtime,
}));

import { DemoCommandCanvas } from "@/components/command-canvas/demo-command-canvas";
import { DemoEntry } from "@/components/command-canvas/demo-entry";
import { createEmptyCanvasState } from "@/lib/canvas/command-engine";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const INITIAL_SESSION = {
  access_token: "header.payload.signature",
  user: { id: USER_ID, is_anonymous: true },
};
const REFRESHED_SESSION = {
  access_token: "refreshed.payload.signature",
  user: { id: USER_ID, is_anonymous: true },
};

describe("production demo auth composition under StrictMode", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState(null, "", "/demo");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "sb_publishable_test",
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allocates one shared client and room, keeps both real auth owners live, and cleans both up", async () => {
    type Session = typeof INITIAL_SESSION;
    type Observer = (event: string, session: Session | null) => void;
    let currentSession: Session | null = null;
    const observers = new Set<Observer>();
    let activeObserverCount = 0;
    let maximumActiveObserverCount = 0;
    let unsubscribeCount = 0;
    const getSession = vi.fn(async () => ({
      data: { session: currentSession },
      error: null,
    }));
    const onAuthStateChange = vi.fn((callback: Observer) => {
      observers.add(callback);
      activeObserverCount += 1;
      maximumActiveObserverCount = Math.max(
        maximumActiveObserverCount,
        activeObserverCount,
      );
      let subscribed = true;
      return {
        data: {
          subscription: {
            unsubscribe: vi.fn(() => {
              if (!subscribed) return;
              subscribed = false;
              observers.delete(callback);
              activeObserverCount -= 1;
              unsubscribeCount += 1;
            }),
          },
        },
      };
    });
    const signInAnonymously = vi.fn(async () => {
      currentSession = INITIAL_SESSION;
      for (const observer of [...observers])
        observer("SIGNED_IN", INITIAL_SESSION);
      return { data: { session: INITIAL_SESSION }, error: null };
    });
    const client = {
      auth: { getSession, signInAnonymously, onAuthStateChange },
    };
    ports.createClient.mockReturnValue(client);

    const canvas = { ...createEmptyCanvasState(ROOM_ID), revision: 1 };
    ports.loadOwnRoomMembership.mockResolvedValue({
      ok: true,
      membership: {
        roomId: ROOM_ID,
        userId: USER_ID,
        role: "host",
        displayName: "Daniel",
        color: "#f26a5b",
        joinedAt: "2026-09-01T20:00:00.000Z",
      },
    });
    ports.loadBrowserCanvas.mockResolvedValue({ ok: true, state: canvas });

    const createRoom = vi.fn(async () => ({
      ok: true as const,
      value: {
        roomId: ROOM_ID,
        slug: "room-2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a",
        joinToken: "q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s",
        role: "host" as const,
        joined: true as const,
      },
    }));
    ports.createBrowserRoomApi.mockImplementation(({ accessToken }) => ({
      accessToken,
      createRoom,
      joinRoom: vi.fn(),
      deleteDemoRoom: vi.fn(),
      commitCommand: vi.fn(),
    }));
    ports.createBrowserPacketApi.mockReturnValue({
      loadLatest: vi.fn(async () => ({
        ok: true as const,
        value: { packet: null, latestSend: null, activity: [] },
      })),
    });
    ports.realtimeConnect.mockImplementation(async () => undefined);
    ports.realtimeDispose.mockImplementation(async () => undefined);
    ports.realtimePublishCursor.mockImplementation(async () => true);
    ports.createRoomRealtime.mockImplementation((options) => ({
      connect: async () => {
        await ports.realtimeConnect();
        options.onStatus("connected");
      },
      publishCursor: ports.realtimePublishCursor,
      dispose: ports.realtimeDispose,
    }));

    const user = userEvent.setup();
    const view = render(
      <StrictMode>
        <DemoEntry>
          <DemoCommandCanvas />
        </DemoEntry>
      </StrictMode>,
    );

    await user.click(
      await screen.findByRole("button", { name: "Enter no-signup preview" }),
    );
    expect(await screen.findByText("Live demo room")).toBeVisible();

    expect(ports.createClient).toHaveBeenCalledOnce();
    expect(ports.createClient).toHaveBeenCalledWith(
      "https://project.supabase.co",
      "sb_publishable_test",
      {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: true,
        },
      },
    );
    expect(signInAnonymously).toHaveBeenCalledOnce();
    expect(createRoom).toHaveBeenCalledOnce();
    expect(createRoom).toHaveBeenCalledWith({
      mode: "demo",
      name: "CommandCanvas demo room",
      displayName: "Daniel",
      color: "#f26a5b",
    });
    expect(ports.createBrowserRoomApi).toHaveBeenCalledWith({
      accessToken: "header.payload.signature",
    });
    expect(ports.loadOwnRoomMembership).toHaveBeenCalledOnce();
    expect(ports.loadBrowserCanvas).toHaveBeenCalledOnce();
    expect(ports.createRoomRealtime).toHaveBeenCalledOnce();
    expect(ports.realtimeConnect).toHaveBeenCalledOnce();
    expect(onAuthStateChange).toHaveBeenCalledTimes(3);
    expect(maximumActiveObserverCount).toBe(2);
    expect(activeObserverCount).toBe(2);
    expect(
      window.sessionStorage.getItem("commandcanvas.demo-entry.accepted.v1"),
    ).toBe("accepted");
    expect(ports.realtimeDispose).not.toHaveBeenCalled();

    currentSession = REFRESHED_SESSION;
    for (const observer of [...observers])
      observer("TOKEN_REFRESHED", REFRESHED_SESSION);
    await waitFor(() =>
      expect(ports.createBrowserRoomApi).toHaveBeenLastCalledWith({
        accessToken: "refreshed.payload.signature",
      }),
    );
    expect(ports.createBrowserRoomApi).toHaveBeenCalledTimes(2);
    expect(createRoom).toHaveBeenCalledOnce();
    expect(screen.getByText("Live demo room")).toBeVisible();

    view.unmount();
    await waitFor(() => {
      expect(activeObserverCount).toBe(0);
      expect(ports.realtimeDispose).toHaveBeenCalledOnce();
    });
    expect(unsubscribeCount).toBe(3);
    expect(createRoom).toHaveBeenCalledOnce();
    expect(signInAnonymously).toHaveBeenCalledOnce();
    expect(ports.realtimeConnect).toHaveBeenCalledOnce();
    expect(ports.createClient).toHaveBeenCalledOnce();
  });
});
