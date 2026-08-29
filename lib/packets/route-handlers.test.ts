// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  handleApprovePacketRequest,
  handleCancelPacketSendRequest,
  handleExecutePacketSendRequest,
  handleLoadLatestPacketRequest,
  handlePreparePacketRequest,
  handleStagePacketSendRequest,
  handleUpdatePacketRequest,
  type PacketRouteDependencies,
} from "@/lib/packets/route-handlers";
import type { CommandCanvasPacketService } from "@/lib/packets/server-service";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJob3N0In0.signature";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const HOST_ID = "22222222-2222-4222-8222-222222222222";
const SEND_REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const PACKET_ID = "packet-launch";

function request(body: unknown, authorization = `Bearer ${JWT}`) {
  return new Request("https://commandcanvas.test/api/packets", {
    method: "POST",
    headers: {
      authorization,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createDependencies(input?: {
  actorId?: string | null;
  serviceResult?: unknown;
}) {
  const result =
    input?.serviceResult ??
    ({
      ok: true,
      value: {
        packetId: PACKET_ID,
        status: "draft",
      },
    } as const);
  const service: CommandCanvasPacketService = {
    loadLatest: vi.fn(async () => result as never),
    prepareDraft: vi.fn(async () => result as never),
    updateDraft: vi.fn(async () => result as never),
    approve: vi.fn(async () => result as never),
    stageSend: vi.fn(async () => result as never),
    cancelSend: vi.fn(async () => result as never),
    executeSend: vi.fn(async () => result as never),
  };
  return {
    dependencies: {
      verifier: {
        auth: {
          getUser: vi.fn(async () => ({
            data: {
              user:
                input?.actorId === null
                  ? null
                  : { id: input?.actorId ?? HOST_ID },
            },
            error: null,
          })),
        },
      },
      service,
    } satisfies PacketRouteDependencies,
    service,
  };
}

function readRequest(authorization = `Bearer ${JWT}`) {
  return new Request("https://commandcanvas.test/api/rooms/current/packets/latest", {
    method: "GET",
    headers: { authorization },
  });
}

async function body(response: Response) {
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  return response.json();
}

describe("packet route authentication and host guards", () => {
  it("loads compact persisted packet state through an authenticated no-store GET", async () => {
    const workflow = {
      packet: null,
      latestSend: null,
      activity: [],
    };
    const { dependencies, service } = createDependencies({
      serviceResult: { ok: true, value: workflow },
    });

    const response = await handleLoadLatestPacketRequest(
      readRequest(),
      ROOM_ID,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ ok: true, workflow });
    expect(service.loadLatest).toHaveBeenCalledExactlyOnceWith(HOST_ID, ROOM_ID);
  });

  it("rejects unauthenticated packet readback before any service read", async () => {
    const { dependencies, service } = createDependencies();

    const response = await handleLoadLatestPacketRequest(
      readRequest(""),
      ROOM_ID,
      dependencies,
    );

    expect(response.status).toBe(401);
    expect(await body(response)).toEqual({
      ok: false,
      error: {
        code: "authorization_missing",
        message: "Bearer authentication is required.",
      },
    });
    expect(service.loadLatest).not.toHaveBeenCalled();
  });

  it("rejects missing bearer authentication before preparing a packet", async () => {
    const { dependencies, service } = createDependencies();

    const response = await handlePreparePacketRequest(
      request(
        {
          roomId: ROOM_ID,
          packetId: PACKET_ID,
          actorType: "agent",
        },
        "",
      ),
      ROOM_ID,
      dependencies,
    );

    expect(response.status).toBe(401);
    expect(await body(response)).toEqual({
      ok: false,
      error: {
        code: "authorization_missing",
        message: "Bearer authentication is required.",
      },
    });
    expect(service.prepareDraft).not.toHaveBeenCalled();
  });

  it("propagates the host-only service guard with a stable 403 response", async () => {
    const { dependencies } = createDependencies({
      serviceResult: {
        ok: false,
        error: {
          code: "host_required",
          message: "Only the room host can manage meeting packets.",
        },
      },
    });

    const response = await handleApprovePacketRequest(
      request({ roomId: ROOM_ID, packetId: PACKET_ID }),
      ROOM_ID,
      PACKET_ID,
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(await body(response)).toEqual({
      ok: false,
      error: {
        code: "host_required",
        message: "Only the room host can manage meeting packets.",
      },
    });
  });

  it("rejects a path/body room mismatch before invoking the packet service", async () => {
    const { dependencies, service } = createDependencies();
    const otherRoom = "99999999-9999-4999-8999-999999999999";

    const response = await handleUpdatePacketRequest(
      request({
        roomId: otherRoom,
        packetId: PACKET_ID,
        title: "Launch packet",
        recipients: [{ name: "Danny", email: "danny@example.com" }],
      }),
      ROOM_ID,
      PACKET_ID,
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      ok: false,
      error: {
        code: "room_mismatch",
        message: "Room ID does not match the request path.",
      },
    });
    expect(service.updateDraft).not.toHaveBeenCalled();
  });

  it("requires JSON and bounds the request body before invoking the service", async () => {
    const mediaType = createDependencies();
    const textRequest = request(
      { roomId: ROOM_ID, packetId: PACKET_ID, actorType: "agent" },
    );
    textRequest.headers.set("content-type", "text/plain");
    const oversized = createDependencies();

    const mediaTypeResponse = await handlePreparePacketRequest(
      textRequest,
      ROOM_ID,
      mediaType.dependencies,
    );
    const oversizedResponse = await handlePreparePacketRequest(
      request({
        roomId: ROOM_ID,
        packetId: PACKET_ID,
        actorType: "agent",
        padding: "x".repeat(65_536),
      }),
      ROOM_ID,
      oversized.dependencies,
    );

    expect(mediaTypeResponse.status).toBe(415);
    expect(await body(mediaTypeResponse)).toEqual({
      ok: false,
      error: {
        code: "unsupported_media_type",
        message: "Content-Type must be application/json.",
      },
    });
    expect(oversizedResponse.status).toBe(413);
    expect(await body(oversizedResponse)).toEqual({
      ok: false,
      error: {
        code: "request_too_large",
        message: "Request body is too large.",
      },
    });
    expect(mediaType.service.prepareDraft).not.toHaveBeenCalled();
    expect(oversized.service.prepareDraft).not.toHaveBeenCalled();
  });
});

describe("packet route operations", () => {
  it("passes the authenticated actor to prepare, update, approve, and stage operations", async () => {
    const prepare = createDependencies();
    await handlePreparePacketRequest(
      request({ roomId: ROOM_ID, packetId: PACKET_ID, actorType: "agent" }),
      ROOM_ID,
      prepare.dependencies,
    );
    expect(prepare.service.prepareDraft).toHaveBeenCalledWith(HOST_ID, {
      roomId: ROOM_ID,
      packetId: PACKET_ID,
      actorType: "agent",
    });

    const update = createDependencies();
    const updateInput = {
      roomId: ROOM_ID,
      packetId: PACKET_ID,
      title: "Launch packet",
      recipients: [{ name: "Danny", email: "danny@example.com" }],
    };
    await handleUpdatePacketRequest(
      request(updateInput),
      ROOM_ID,
      PACKET_ID,
      update.dependencies,
    );
    expect(update.service.updateDraft).toHaveBeenCalledWith(HOST_ID, updateInput);

    const approve = createDependencies();
    const approveInput = { roomId: ROOM_ID, packetId: PACKET_ID };
    await handleApprovePacketRequest(
      request(approveInput),
      ROOM_ID,
      PACKET_ID,
      approve.dependencies,
    );
    expect(approve.service.approve).toHaveBeenCalledWith(HOST_ID, approveInput);

    const stage = createDependencies();
    const stageInput = {
      roomId: ROOM_ID,
      packetId: PACKET_ID,
      requestedByActorType: "agent" as const,
    };
    await handleStagePacketSendRequest(
      request(stageInput),
      ROOM_ID,
      PACKET_ID,
      stage.dependencies,
    );
    expect(stage.service.stageSend).toHaveBeenCalledWith(HOST_ID, stageInput);
  });

  it("requires an explicit host SEND action before invoking execute", async () => {
    const { dependencies, service } = createDependencies();

    const response = await handleExecutePacketSendRequest(
      request({
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostAuthorization: false,
      }),
      ROOM_ID,
      SEND_REQUEST_ID,
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      ok: false,
      error: {
        code: "explicit_host_authorization_required",
        message: "Click SEND to authorize this external action.",
      },
    });
    expect(service.executeSend).not.toHaveBeenCalled();
  });

  it("requires an explicit host cancel action before invoking durable cancellation", async () => {
    const { dependencies, service } = createDependencies();

    const response = await handleCancelPacketSendRequest(
      request({
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostCancellation: false,
      }),
      ROOM_ID,
      SEND_REQUEST_ID,
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(await body(response)).toEqual({
      ok: false,
      error: {
        code: "explicit_host_cancellation_required",
        message: "Click Cancel to cancel this staged send.",
      },
    });
    expect(service.cancelSend).not.toHaveBeenCalled();
  });

  it("passes the authenticated host to durable cancellation", async () => {
    const cancellationResult = {
      ok: true,
      value: {
        sendRequestId: SEND_REQUEST_ID,
        packetId: PACKET_ID,
        status: "cancelled",
        receiptId: "44444444-4444-4444-8444-444444444444",
        changed: true,
      },
    } as const;
    const { dependencies, service } = createDependencies({
      serviceResult: cancellationResult,
    });
    const input = {
      roomId: ROOM_ID,
      sendRequestId: SEND_REQUEST_ID,
      explicitHostCancellation: true as const,
    };

    const response = await handleCancelPacketSendRequest(
      request(input),
      ROOM_ID,
      SEND_REQUEST_ID,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      ok: true,
      send: cancellationResult.value,
    });
    expect(service.cancelSend).toHaveBeenCalledExactlyOnceWith(HOST_ID, input);
    expect(service.executeSend).not.toHaveBeenCalled();
  });

  it("executes only after authentication and an explicit host SEND action", async () => {
    const executionResult = {
      ok: true,
      value: {
        mode: "preview_only",
        status: "preview_only",
        sendRequestId: SEND_REQUEST_ID,
        outboundShareId: SEND_REQUEST_ID,
        reason: "resend_unconfigured",
        message: "Preview only: no email was sent.",
        preview: {
          subject: "Launch packet",
          recipients: [{ name: "Danny", email: "danny@example.com" }],
          contentSnapshot: {
            title: "Launch packet",
            content: { objects: [] },
          },
        },
      },
    } as const;
    const { dependencies, service } = createDependencies({
      serviceResult: executionResult,
    });
    const input = {
      roomId: ROOM_ID,
      sendRequestId: SEND_REQUEST_ID,
      explicitHostAuthorization: true as const,
    };
    const requestWithSignal = request(input);

    const response = await handleExecutePacketSendRequest(
      requestWithSignal,
      ROOM_ID,
      SEND_REQUEST_ID,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({
      ok: true,
      send: executionResult.value,
    });
    expect(service.executeSend).toHaveBeenCalledExactlyOnceWith(
      HOST_ID,
      input,
      requestWithSignal.signal,
    );
  });

  it("returns a retryable 429 when durable packet email admission is capped", async () => {
    const { dependencies } = createDependencies({
      serviceResult: {
        ok: false,
        error: {
          code: "email_rate_limited",
          message: "Packet email capacity is temporarily unavailable.",
        },
      },
    });
    const response = await handleExecutePacketSendRequest(
      request({
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostAuthorization: true,
      }),
      ROOM_ID,
      SEND_REQUEST_ID,
      dependencies,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3600");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "email_rate_limited",
        message: "Packet email capacity is temporarily unavailable.",
      },
    });
  });
});
