import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  DemoCommandCanvas,
  type DemoCommandCanvasEnvironment,
} from "@/components/command-canvas/demo-command-canvas";
import { createCanvasStore } from "@/lib/canvas/canvas-store";
import { createEmptyCanvasState } from "@/lib/canvas/command-engine";
import type {
  DemoRoomSession,
  DemoRoomSnapshot,
} from "@/lib/demo/room-session";

const ROOM_ID = "d32af6a9-31dd-4dfc-98d5-fcf439b9b106";
const HOST_ID = "96ceecfe-ab18-4fda-9591-9945a73fe709";
const SARAH_ID = "99999999-9999-4999-8999-999999999999";

function readyEnvironment() {
  const canvas = createEmptyCanvasState(ROOM_ID);
  const store = createCanvasStore(ROOM_ID, {
    actor: { id: HOST_ID, displayName: "Daniel", type: "human" },
    createId: (prefix) => `${prefix}-fixture`,
    now: () => "2026-08-27T12:00:00.000Z",
  });
  store.getState().hydrateCanvas(canvas);
  let snapshot: DemoRoomSnapshot = {
    status: "ready",
    realtimeStatus: "connected",
    identity: { userId: HOST_ID, isAnonymous: true },
    roomId: ROOM_ID,
    membership: {
      roomId: ROOM_ID,
      userId: HOST_ID,
      role: "host",
      displayName: "Daniel",
      color: "#f26a5b",
      joinedAt: "2026-08-27T12:00:00.000Z",
    },
    state: canvas,
    joinAccess: { slug: "room-0123456789abcdef0123456789abcdef", joinToken: "t".repeat(43) },
    presence: [
      {
        participantId: HOST_ID,
        displayName: "Daniel",
        role: "host",
        color: "#f26a5b",
        onlineAt: "2026-08-27T12:00:00.000Z",
      },
      {
        participantId: SARAH_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#38bdf8",
        onlineAt: "2026-08-27T12:00:01.000Z",
      },
    ],
    cursors: {
      [SARAH_ID]: {
        participantId: SARAH_ID,
        seq: 1,
        x: 220,
        y: 160,
        sentAt: 1,
      },
    },
    commandPending: false,
    lastError: null,
  };
  const listeners = new Set<() => void>();
  const session: DemoRoomSession = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: async () => ({ ok: true, roomId: ROOM_ID }),
    submitCommand: async () => ({ ok: true, state: canvas }),
    publishCursor: async () => true,
    whenIdle: async () => undefined,
    dispose: vi.fn(async () => undefined),
  };
  const copyInvite = vi.fn(async () => undefined);
  const resetDemo = vi.fn();
  const environment: DemoCommandCanvasEnvironment = {
    bootstrap: async () => ({
      ok: true,
      session,
      store,
      role: "host",
      inviteUrl: "https://commandcanvas.example/demo?room=room&join=token",
    }),
    copyInvite,
    resetDemo,
  };
  return { environment, session, copyInvite, resetDemo, setSnapshot: (next: DemoRoomSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  } };
}

describe("DemoCommandCanvas", () => {
  it("shows an explicit no-signup loading state before a room is verified", () => {
    const environment: DemoCommandCanvasEnvironment = {
      bootstrap: () => new Promise(() => undefined),
      copyInvite: async () => undefined,
      resetDemo: () => undefined,
    };
    render(<DemoCommandCanvas environment={environment} />);

    expect(screen.getByText("Opening your no-signup demo room…")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /email|password/i })).toBeNull();
  });

  it("renders only actual Presence participants and one remote cursor", async () => {
    const { environment } = readyEnvironment();
    const { container } = render(<DemoCommandCanvas environment={environment} />);

    expect(await screen.findByText("Live demo room")).toBeVisible();
    expect(screen.getByLabelText("2 participants present")).toBeVisible();
    expect(screen.getByTitle("Daniel · host")).toBeVisible();
    expect(screen.getByTitle("Sarah · participant")).toBeVisible();
    expect(
      container.querySelector(`[data-remote-cursor="${SARAH_ID}"]`),
    ).not.toBeNull();
    expect(screen.queryByText(/fixture collaborator/i)).toBeNull();
  });

  it("copies the host invite and exposes an exact reset action", async () => {
    const user = userEvent.setup();
    const { environment, copyInvite, resetDemo } = readyEnvironment();
    render(<DemoCommandCanvas environment={environment} />);
    await screen.findByText("Live demo room");

    await user.click(screen.getByRole("button", { name: "Copy participant invite" }));
    expect(copyInvite).toHaveBeenCalledWith(
      "https://commandcanvas.example/demo?room=room&join=token",
    );
    expect(await screen.findByText("Invite copied")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Reset demo" }));
    expect(resetDemo).toHaveBeenCalledOnce();
  });

  it("keeps a failed service state honest and retryable", async () => {
    const resetDemo = vi.fn();
    const environment: DemoCommandCanvasEnvironment = {
      bootstrap: async () => ({
        ok: false,
        code: "service_unavailable",
        message: "The shared demo service is unavailable.",
      }),
      copyInvite: async () => undefined,
      resetDemo,
    };
    const user = userEvent.setup();
    render(<DemoCommandCanvas environment={environment} />);

    expect(await screen.findByText("Demo room unavailable")).toBeVisible();
    expect(screen.getByText("The shared demo service is unavailable.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(resetDemo).toHaveBeenCalledOnce();
  });

  it("updates collaboration status when Realtime degrades without losing the canvas", async () => {
    const harness = readyEnvironment();
    render(<DemoCommandCanvas environment={harness.environment} />);
    await screen.findByText("Live demo room");

    harness.setSnapshot({
      ...harness.session.getSnapshot(),
      status: "degraded",
      realtimeStatus: "channel_error",
      lastError: {
        code: "realtime_channel_error",
        message: "Live collaboration is unavailable; verified room state is preserved.",
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Realtime unavailable · state preserved")).toBeVisible();
    });
    expect(screen.getByText("Live demo room")).toBeVisible();
  });
});
