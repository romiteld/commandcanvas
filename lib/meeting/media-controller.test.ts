import { describe, expect, it, vi } from "vitest";

import {
  createMeetingMediaController,
  type MeetingMediaChannel,
  type MeetingMediaClient,
  type MeetingMediaPeer,
  type MeetingMediaSnapshot,
} from "@/lib/meeting/media-controller";

const roomId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const localId = "11111111-1111-4111-8111-111111111111";
const remoteId = "22222222-2222-4222-8222-222222222222";
const strangerId = "33333333-3333-4333-8333-333333333333";
const lowerId = "00000000-0000-4000-8000-000000000000";
const fourthId = "44444444-4444-4444-8444-444444444444";

function track(kind: "audio" | "video") {
  return {
    kind,
    enabled: true,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack;
}

function stream(...tracks: MediaStreamTrack[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((item) => item.kind === "audio"),
    getVideoTracks: () => tracks.filter((item) => item.kind === "video"),
  } as unknown as MediaStream;
}

function harness(options: { allowedParticipantIds?: ReadonlySet<string> } = {}) {
  const handlers = new Map<string, (message?: unknown) => void>();
  const sent: unknown[] = [];
  let subscriptionHandler: ((status: string) => void) | null = null;
  const channel: MeetingMediaChannel = {
    on: vi.fn((type, filter, callback) => {
      handlers.set(`${type}:${filter.event}`, callback);
      return channel;
    }),
    subscribe: vi.fn((callback) => {
      subscriptionHandler = callback;
      callback("SUBSCRIBED");
      return channel;
    }),
    send: vi.fn(async (message) => {
      sent.push(message);
      return "ok";
    }),
  };
  const client: MeetingMediaClient = {
    realtime: { setAuth: vi.fn(async () => undefined) },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => undefined),
  };
  const audio = track("audio");
  const video = track("video");
  const localStream = stream(audio, video);
  const getUserMedia = vi.fn(async () => localStream);
  const peers: FakePeer[] = [];
  const snapshots: MeetingMediaSnapshot[] = [];
  const controller = createMeetingMediaController({
    roomId,
    localParticipantId: localId,
    allowedParticipantIds:
      options.allowedParticipantIds ?? new Set([localId, remoteId, lowerId]),
    getAccessToken: () => "ey.test.token",
    client,
    getUserMedia,
    createPeer: () => {
      const peer = new FakePeer();
      peers.push(peer);
      return peer;
    },
    createRemoteStream: (remoteTrack) => stream(remoteTrack),
    onSnapshot: (snapshot) => snapshots.push(snapshot),
  });
  return {
    controller,
    client,
    channel,
    handlers,
    sent,
    peers,
    snapshots,
    getUserMedia,
    audio,
    video,
    emitChannelStatus(status: string) {
      subscriptionHandler?.(status);
    },
  };
}

describe("meeting media controller", () => {
  it("does not request camera or microphone until the human starts video", () => {
    const setup = harness();

    expect(setup.getUserMedia).not.toHaveBeenCalled();
    expect(setup.client.channel).not.toHaveBeenCalled();
    expect(setup.snapshots).toHaveLength(0);
  });

  it("refuses device access when more than four people are present", async () => {
    const setup = harness({
      allowedParticipantIds: new Set([
        localId,
        remoteId,
        lowerId,
        strangerId,
        fourthId,
      ]),
    });

    await expect(setup.controller.start()).resolves.toBe(false);

    expect(setup.getUserMedia).not.toHaveBeenCalled();
    expect(setup.client.channel).not.toHaveBeenCalled();
    expect(setup.snapshots.at(-1)).toMatchObject({
      state: "error",
      localStream: null,
      message: "Meeting media is available when four or fewer people are present.",
    });
  });

  it("stops active media if a fifth participant arrives", async () => {
    const setup = harness();
    await setup.controller.start();

    setup.controller.setAllowedParticipantIds(
      new Set([localId, remoteId, lowerId, strangerId, fourthId]),
    );

    expect(setup.audio.stop).toHaveBeenCalledOnce();
    expect(setup.video.stop).toHaveBeenCalledOnce();
    expect(setup.snapshots.at(-1)).toMatchObject({
      state: "error",
      localStream: null,
      message: "Meeting media is available when four or fewer people are present.",
    });
  });

  it("joins a dedicated private media topic and announces actual local media", async () => {
    const setup = harness();

    await setup.controller.start();

    expect(setup.getUserMedia).toHaveBeenCalledWith({
      audio: expect.any(Object),
      video: expect.any(Object),
    });
    expect(setup.client.channel).toHaveBeenCalledWith(`room-media:${roomId}`, {
      config: { private: true, broadcast: { ack: true, self: false } },
    });
    expect(setup.sent).toContainEqual({
      type: "broadcast",
      event: "meeting-media",
      payload: { version: 1, kind: "ready", senderId: localId },
    });
    expect(setup.snapshots.at(-1)).toMatchObject({
      state: "active",
      localStream: expect.anything(),
      cameraEnabled: true,
      microphoneEnabled: true,
    });
  });

  it("negotiates only with a present participant and targets the offer", async () => {
    const setup = harness();
    await setup.controller.start();

    setup.handlers.get("broadcast:meeting-media")?.({
      payload: { version: 1, kind: "ready", senderId: strangerId },
    });
    await setup.controller.whenIdle();
    expect(setup.peers).toHaveLength(0);

    setup.handlers.get("broadcast:meeting-media")?.({
      payload: { version: 1, kind: "ready", senderId: remoteId },
    });
    await setup.controller.whenIdle();

    expect(setup.peers).toHaveLength(1);
    expect(setup.peers[0]?.addedTracks).toHaveLength(2);
    expect(setup.sent).toContainEqual({
      type: "broadcast",
      event: "meeting-media",
      payload: {
        version: 1,
        kind: "description",
        senderId: localId,
        targetId: remoteId,
        description: { type: "offer", sdp: "offer-sdp" },
      },
    });
  });

  it("acknowledges a late joiner so the deterministic offerer cannot miss readiness", async () => {
    const setup = harness();
    await setup.controller.start();

    setup.handlers.get("broadcast:meeting-media")?.({
      payload: { version: 1, kind: "ready", senderId: lowerId },
    });
    await setup.controller.whenIdle();

    expect(setup.sent).toContainEqual({
      type: "broadcast",
      event: "meeting-media",
      payload: {
        version: 1,
        kind: "ready",
        senderId: localId,
        targetId: lowerId,
      },
    });
    expect(setup.peers[0]?.localDescription).toBeNull();
  });

  it("reports a non-ok acknowledged signaling send instead of claiming success", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.channel.send = vi.fn(async () => "error");

    setup.handlers.get("broadcast:meeting-media")?.({
      payload: { version: 1, kind: "ready", senderId: remoteId },
    });
    await setup.controller.whenIdle();

    expect(setup.snapshots.at(-1)).toMatchObject({
      state: "signaling_lost",
      message: "Meeting media signaling was interrupted.",
    });
  });

  it("ignores a late signaling acknowledgement after the human stops media", async () => {
    const setup = harness();
    await setup.controller.start();
    let resolveDescription: ((status: string) => void) | undefined;
    const descriptionResult = new Promise<string>((resolve) => {
      resolveDescription = resolve;
    });
    setup.channel.send = vi.fn((message) =>
      message.payload.kind === "description"
        ? descriptionResult
        : Promise.resolve("ok"),
    );

    setup.handlers.get("broadcast:meeting-media")?.({
      payload: { version: 1, kind: "ready", senderId: remoteId },
    });
    await vi.waitFor(() => {
      expect(setup.channel.send).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({ kind: "description" }),
        }),
      );
    });

    await setup.controller.stop();
    resolveDescription?.("error");
    await setup.controller.whenIdle();

    expect(setup.snapshots.at(-1)).toMatchObject({
      state: "off",
      localStream: null,
    });
  });

  it("truthfully preserves direct media when the signaling channel is lost", async () => {
    const setup = harness();
    await setup.controller.start();

    setup.emitChannelStatus("CHANNEL_ERROR");

    expect(setup.audio.stop).not.toHaveBeenCalled();
    expect(setup.video.stop).not.toHaveBeenCalled();
    expect(setup.snapshots.at(-1)).toMatchObject({
      state: "signaling_lost",
      localStream: expect.anything(),
      message:
        "Signaling was lost. Existing direct media may continue; new connections are unavailable.",
    });
  });

  it("deduplicates ICE candidates queued before the remote description", async () => {
    const setup = harness();
    await setup.controller.start();
    const candidate = {
      candidate: "candidate:1 1 UDP 1 192.0.2.1 5000 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };

    for (let index = 0; index < 2; index += 1)
      setup.handlers.get("broadcast:meeting-media")?.({
        payload: {
          version: 1,
          kind: "ice",
          senderId: remoteId,
          targetId: localId,
          candidate,
        },
      });
    setup.handlers.get("broadcast:meeting-media")?.({
      payload: {
        version: 1,
        kind: "description",
        senderId: remoteId,
        targetId: localId,
        description: { type: "offer", sdp: "remote-offer" },
      },
    });
    await setup.controller.whenIdle();

    expect(setup.peers[0]?.addedIceCandidates).toHaveLength(1);
  });

  it("bounds ICE candidates queued before the remote description", async () => {
    const setup = harness();
    await setup.controller.start();

    for (let index = 0; index < 140; index += 1)
      setup.handlers.get("broadcast:meeting-media")?.({
        payload: {
          version: 1,
          kind: "ice",
          senderId: remoteId,
          targetId: localId,
          candidate: {
            candidate: `candidate:${index} 1 UDP 1 192.0.2.1 ${5000 + index} typ host`,
            sdpMid: "0",
            sdpMLineIndex: 0,
          },
        },
      });
    setup.handlers.get("broadcast:meeting-media")?.({
      payload: {
        version: 1,
        kind: "description",
        senderId: remoteId,
        targetId: localId,
        description: { type: "offer", sdp: "remote-offer" },
      },
    });
    await setup.controller.whenIdle();

    expect(setup.peers[0]?.addedIceCandidates).toHaveLength(128);
  });

  it("exposes a real remote track and tears down every media resource", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.handlers.get("broadcast:meeting-media")?.({
      payload: { version: 1, kind: "ready", senderId: remoteId },
    });
    await setup.controller.whenIdle();

    const remoteVideo = track("video");
    setup.peers[0]?.emitTrack(remoteVideo);
    expect(setup.snapshots.at(-1)?.remoteStreams[remoteId]).toBeTruthy();

    await setup.controller.stop();

    expect(setup.audio.stop).toHaveBeenCalledOnce();
    expect(setup.video.stop).toHaveBeenCalledOnce();
    expect(setup.peers[0]?.close).toHaveBeenCalledOnce();
    expect(setup.client.removeChannel).toHaveBeenCalledWith(setup.channel);
    expect(setup.snapshots.at(-1)).toMatchObject({
      state: "off",
      localStream: null,
      remoteStreams: {},
    });
  });

  it("stops private device tracks immediately and bounds a hung departure", async () => {
    vi.useFakeTimers();
    try {
      const setup = harness();
      await setup.controller.start();
      setup.channel.send = vi.fn(
        () => new Promise<"ok">(() => undefined),
      );

      const stopping = setup.controller.stop();

      expect(setup.audio.stop).toHaveBeenCalledOnce();
      expect(setup.video.stop).toHaveBeenCalledOnce();
      expect(setup.snapshots.at(-1)).toMatchObject({
        state: "off",
        localStream: null,
      });

      await vi.advanceTimersByTimeAsync(2_000);
      await stopping;
      expect(setup.client.removeChannel).toHaveBeenCalledWith(setup.channel);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops acquired tracks without waiting for stalled realtime authorization", async () => {
    let releaseAuthorization: (() => void) | undefined;
    const authorization = new Promise<void>((resolve) => {
      releaseAuthorization = resolve;
    });
    const setup = harness();
    setup.client.realtime.setAuth = vi.fn(() => authorization);

    const starting = setup.controller.start();
    await vi.waitFor(() => {
      expect(setup.client.realtime.setAuth).toHaveBeenCalledOnce();
    });

    await setup.controller.dispose();

    expect(setup.audio.stop).toHaveBeenCalledOnce();
    expect(setup.video.stop).toHaveBeenCalledOnce();
    expect(setup.client.channel).not.toHaveBeenCalled();

    releaseAuthorization?.();
    await expect(starting).resolves.toBe(false);
    expect(setup.client.channel).not.toHaveBeenCalled();
  });

  it("toggles tracks without reacquiring devices", async () => {
    const setup = harness();
    await setup.controller.start();

    setup.controller.setCameraEnabled(false);
    setup.controller.setMicrophoneEnabled(false);

    expect(setup.video.enabled).toBe(false);
    expect(setup.audio.enabled).toBe(false);
    expect(setup.getUserMedia).toHaveBeenCalledOnce();
    expect(setup.snapshots.at(-1)).toMatchObject({
      cameraEnabled: false,
      microphoneEnabled: false,
    });
  });
});

class FakePeer implements MeetingMediaPeer {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = "new";
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { track: MediaStreamTrack; streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addedTracks: MediaStreamTrack[] = [];
  addedIceCandidates: RTCIceCandidateInit[] = [];
  close = vi.fn();

  addTrack(track: MediaStreamTrack) {
    this.addedTracks.push(track);
  }

  async createOffer() {
    return { type: "offer" as const, sdp: "offer-sdp" };
  }

  async createAnswer() {
    return { type: "answer" as const, sdp: "answer-sdp" };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit) {
    this.localDescription = description;
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit) {
    this.remoteDescription = description;
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    this.addedIceCandidates.push(candidate);
  }

  emitTrack(remoteTrack: MediaStreamTrack) {
    this.ontrack?.({ track: remoteTrack, streams: [] });
  }
}
