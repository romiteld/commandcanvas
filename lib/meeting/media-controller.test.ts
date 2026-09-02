import { describe, expect, it, vi } from "vitest";

import {
  createMeetingMediaController,
  type MeetingMediaIceServerConfig,
  type MeetingMediaChannel,
  type MeetingMediaClient,
  type MeetingMediaPeer,
  type MeetingMediaSnapshot,
} from "@/lib/meeting/media-controller";
import { meetingMediaTopic } from "@/lib/meeting/media-protocol";

const roomId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const localId = "11111111-1111-4111-8111-111111111111";
const remoteId = "22222222-2222-4222-8222-222222222222";
const strangerId = "33333333-3333-4333-8333-333333333333";
const lowerId = "00000000-0000-4000-8000-000000000000";
const fourthId = "44444444-4444-4444-8444-444444444444";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function track(
  kind: "audio" | "video",
  clone?: () => MediaStreamTrack,
) {
  return {
    kind,
    enabled: true,
    stop: vi.fn(),
    ...(clone ? { clone: vi.fn(clone) } : {}),
  } as unknown as MediaStreamTrack;
}

function stream(...tracks: MediaStreamTrack[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((item) => item.kind === "audio"),
    getVideoTracks: () => tracks.filter((item) => item.kind === "video"),
  } as unknown as MediaStream;
}

function harness(
  options: {
    allowedParticipantIds?: ReadonlySet<string>;
    getIceServerConfig?: () => Promise<MeetingMediaIceServerConfig>;
    now?: () => number;
    acquireLocalMedia?: () => Promise<{
      stream: MediaStream;
      release: () => void;
    }>;
  } = {},
) {
  const sent: Array<Parameters<MeetingMediaChannel["send"]>[0]> = [];
  const channels = new Map<
    string,
    {
      channel: MeetingMediaChannel;
      handler: ((message?: unknown) => void) | null;
      subscriptionHandler: ((status: string) => void) | null;
    }
  >();
  const client: MeetingMediaClient = {
    realtime: { setAuth: vi.fn(async () => undefined) },
    channel: vi.fn((topic) => {
      const record: {
        channel: MeetingMediaChannel;
        handler: ((message?: unknown) => void) | null;
        subscriptionHandler: ((status: string) => void) | null;
      } = {
        channel: undefined as unknown as MeetingMediaChannel,
        handler: null,
        subscriptionHandler: null,
      };
      const channel: MeetingMediaChannel = {
        on: vi.fn((_type, _filter, callback) => {
          record.handler = callback;
          return channel;
        }),
        subscribe: vi.fn((callback) => {
          record.subscriptionHandler = callback;
          callback("SUBSCRIBED");
          return channel;
        }),
        send: vi.fn(async (message) => {
          sent.push(message);
          return "ok";
        }),
      };
      record.channel = channel;
      channels.set(topic, record);
      return channel;
    }),
    removeChannel: vi.fn(async () => undefined),
  };
  const audio = track("audio");
  const publishedVideo = track("video");
  const video = track("video", () => publishedVideo);
  const localStream = stream(audio, video);
  const getUserMedia = vi.fn(async () => localStream);
  const peers: FakePeer[] = [];
  const peerIceServers: Array<readonly RTCIceServer[]> = [];
  const snapshots: MeetingMediaSnapshot[] = [];
  const controller = createMeetingMediaController({
    roomId,
    localParticipantId: localId,
    allowedParticipantIds:
      options.allowedParticipantIds ?? new Set([localId, remoteId, lowerId]),
    getAccessToken: () => "ey.test.token",
    client,
    getUserMedia,
    ...(options.getIceServerConfig
      ? { getIceServerConfig: options.getIceServerConfig }
      : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.acquireLocalMedia
      ? { acquireLocalMedia: options.acquireLocalMedia }
      : {}),
    createPeer: (iceServers) => {
      peerIceServers.push(iceServers);
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
    get channel() {
      const localChannel = channels.get(meetingMediaTopic(roomId, localId));
      if (!localChannel) throw new Error("Local media channel is not open.");
      return localChannel.channel;
    },
    sent,
    peers,
    peerIceServers,
    snapshots,
    getUserMedia,
    audio,
    video,
    publishedVideo,
    emitChannelStatus(status: string, participantId = localId) {
      channels
        .get(meetingMediaTopic(roomId, participantId))
        ?.subscriptionHandler?.(status);
    },
    emitSignal(participantId: string, payload: unknown) {
      channels
        .get(meetingMediaTopic(roomId, participantId))
        ?.handler?.({ payload });
    },
  };
}

function senderBindingHarness() {
  const channels = new Map<
    string,
    {
      channel: MeetingMediaChannel;
      handler: ((message?: unknown) => void) | null;
      sent: unknown[];
    }
  >();
  const client: MeetingMediaClient = {
    realtime: { setAuth: vi.fn(async () => undefined) },
    channel: vi.fn((topic) => {
      const record: {
        channel: MeetingMediaChannel;
        handler: ((message?: unknown) => void) | null;
        sent: unknown[];
      } = {
        channel: undefined as unknown as MeetingMediaChannel,
        handler: null,
        sent: [],
      };
      const channel: MeetingMediaChannel = {
        on: vi.fn((_type, _filter, callback) => {
          record.handler = callback;
          return channel;
        }),
        subscribe: vi.fn((callback) => {
          callback("SUBSCRIBED");
          return channel;
        }),
        send: vi.fn(async (message) => {
          record.sent.push(message);
          return "ok";
        }),
      };
      record.channel = channel;
      channels.set(topic, record);
      return channel;
    }),
    removeChannel: vi.fn(async () => undefined),
  };
  const audio = track("audio");
  const publishedVideo = track("video");
  const video = track("video", () => publishedVideo);
  const peers: FakePeer[] = [];
  const controller = createMeetingMediaController({
    roomId,
    localParticipantId: localId,
    allowedParticipantIds: new Set([localId, remoteId, lowerId]),
    getAccessToken: () => "ey.test.token",
    client,
    getUserMedia: vi.fn(async () => stream(audio, video)),
    createPeer: () => {
      const peer = new FakePeer();
      peers.push(peer);
      return peer;
    },
    createRemoteStream: (remoteTrack) => stream(remoteTrack),
    onSnapshot: vi.fn(),
  });
  return { channels, client, controller, peers };
}

describe("meeting media controller", () => {
  it("subscribes to one authenticated sender topic per bounded room member", async () => {
    const setup = senderBindingHarness();

    await setup.controller.start();

    expect(new Set(setup.channels.keys())).toEqual(
      new Set([
        meetingMediaTopic(roomId, localId),
        meetingMediaTopic(roomId, remoteId),
        meetingMediaTopic(roomId, lowerId),
      ]),
    );
    expect(setup.channels.get(meetingMediaTopic(roomId, localId))?.sent)
      .toContainEqual({
        type: "broadcast",
        event: "meeting-media",
        payload: { version: 1, kind: "ready", senderId: localId },
      });
    expect(setup.channels.get(meetingMediaTopic(roomId, remoteId))?.sent)
      .toEqual([]);
  });

  it("derives the remote sender from its topic and rejects a mismatched payload claim", async () => {
    const setup = senderBindingHarness();
    await setup.controller.start();
    const remoteChannel = setup.channels.get(meetingMediaTopic(roomId, remoteId));
    expect(remoteChannel).toBeDefined();

    remoteChannel?.handler?.({
      payload: { version: 1, kind: "ready", senderId: strangerId },
    });
    await setup.controller.whenIdle();
    expect(setup.peers).toHaveLength(0);

    remoteChannel?.handler?.({
      payload: { version: 1, kind: "ready", senderId: remoteId },
    });
    await setup.controller.whenIdle();
    expect(setup.peers).toHaveLength(1);
    expect(remoteChannel?.sent).toEqual([]);
    expect(setup.channels.get(meetingMediaTopic(roomId, localId))?.sent)
      .toContainEqual({
        type: "broadcast",
        event: "meeting-media",
        payload: expect.objectContaining({
          kind: "description",
          senderId: localId,
          targetId: remoteId,
        }),
      });
  });

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

  it("supersedes a start awaiting TURN when authoritative membership removes the local actor", async () => {
    const lookup = deferred<MeetingMediaIceServerConfig>();
    const getIceServerConfig = vi.fn(() => lookup.promise);
    const setup = harness({ getIceServerConfig });

    const started = setup.controller.start();
    await vi.waitFor(() => expect(getIceServerConfig).toHaveBeenCalledOnce());
    setup.controller.setAllowedParticipantIds(new Set([remoteId]));
    lookup.resolve({
      mode: "direct",
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    await expect(started).resolves.toBe(false);
    expect(setup.getUserMedia).not.toHaveBeenCalled();
    expect(setup.client.channel).not.toHaveBeenCalled();
    expect(setup.snapshots.at(-1)).toMatchObject({
      state: "error",
      localStream: null,
      message: "Room membership is unavailable.",
    });
  });

  it("releases deferred camera and microphone acquisition when membership is removed during start", async () => {
    const acquisition = deferred<{
      stream: MediaStream;
      release: () => void;
    }>();
    const release = vi.fn();
    const acquireLocalMedia = vi.fn(() => acquisition.promise);
    const setup = harness({ acquireLocalMedia });

    const started = setup.controller.start();
    await vi.waitFor(() => expect(acquireLocalMedia).toHaveBeenCalledOnce());
    setup.controller.setAllowedParticipantIds(new Set([remoteId]));
    acquisition.resolve({
      stream: stream(track("audio"), track("video")),
      release,
    });

    await expect(started).resolves.toBe(false);
    expect(release).toHaveBeenCalledOnce();
    expect(setup.client.channel).not.toHaveBeenCalled();
    expect(setup.snapshots.at(-1)).toMatchObject({
      state: "error",
      localStream: null,
      message: "Room membership is unavailable.",
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
    expect(setup.publishedVideo.stop).toHaveBeenCalledOnce();
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
    expect(setup.client.channel).toHaveBeenCalledWith(
      meetingMediaTopic(roomId, localId),
      { config: { private: true, broadcast: { ack: true, self: false } } },
    );
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

    setup.emitSignal(strangerId, {
      version: 1,
      kind: "ready",
      senderId: strangerId,
    });
    await setup.controller.whenIdle();
    expect(setup.peers).toHaveLength(0);

    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
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

  it("uses short-lived TURN credentials for peers when the authorized room supplies them", async () => {
    const iceServers = [
      { urls: ["stun:stun.l.google.com:19302"] },
      {
        urls: [
          "turn:turn.commandcanvas.example:3478?transport=udp",
          "turns:turn.commandcanvas.example:5349?transport=tcp",
        ],
        username: "1788000600:11111111-1111-4111-8111-111111111111",
        credential: "ephemeral-credential",
      },
    ] satisfies readonly RTCIceServer[];
    const getIceServerConfig = vi.fn(async () => ({
      mode: "turn" as const,
      expiresAt: "2099-08-29T10:50:00.000Z",
      iceServers,
    }));
    const setup = harness({ getIceServerConfig });
    await setup.controller.start();

    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
    });
    await setup.controller.whenIdle();

    expect(getIceServerConfig).toHaveBeenCalledOnce();
    expect(setup.peerIceServers).toEqual([iceServers]);
  });

  it("falls back to direct STUN media when TURN credential lookup fails", async () => {
    const getIceServerConfig = vi.fn(async () => {
      throw new Error("TURN unavailable");
    });
    const setup = harness({ getIceServerConfig });
    await setup.controller.start();

    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
    });
    await setup.controller.whenIdle();

    expect(setup.peerIceServers).toEqual([
      [{ urls: "stun:stun.l.google.com:19302" }],
    ]);
  });

  it("refreshes near-expiry TURN credentials before a reconnecting peer is created", async () => {
    let now = Date.parse("2026-09-01T12:00:00.000Z");
    const firstIce = [
      {
        urls: "turn:turn.commandcanvas.example:3478",
        username: "first",
        credential: "first-secret",
      },
    ] satisfies readonly RTCIceServer[];
    const refreshedIce = [
      {
        urls: "turn:turn.commandcanvas.example:3478",
        username: "refreshed",
        credential: "refreshed-secret",
      },
    ] satisfies readonly RTCIceServer[];
    const getIceServerConfig = vi
      .fn<() => Promise<MeetingMediaIceServerConfig>>()
      .mockResolvedValueOnce({
        mode: "turn",
        expiresAt: "2026-09-01T12:02:00.000Z",
        iceServers: firstIce,
      })
      .mockResolvedValueOnce({
        mode: "turn",
        expiresAt: "2026-09-01T12:12:00.000Z",
        iceServers: refreshedIce,
      });
    const setup = harness({ getIceServerConfig, now: () => now });
    await setup.controller.start();
    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
    });
    await setup.controller.whenIdle();
    expect(setup.peerIceServers).toEqual([firstIce]);

    setup.emitSignal(remoteId, {
      version: 1,
      kind: "left",
      senderId: remoteId,
    });
    await setup.controller.whenIdle();
    now = Date.parse("2026-09-01T12:01:15.000Z");
    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
    });
    await setup.controller.whenIdle();

    expect(getIceServerConfig).toHaveBeenCalledTimes(2);
    expect(setup.peerIceServers).toEqual([firstIce, refreshedIce]);
  });

  it("never gives a new peer stale TURN credentials when refresh fails", async () => {
    let now = Date.parse("2026-09-01T12:00:00.000Z");
    const staleIce = [
      {
        urls: "turn:turn.commandcanvas.example:3478",
        username: "stale",
        credential: "stale-secret",
      },
    ] satisfies readonly RTCIceServer[];
    const getIceServerConfig = vi
      .fn<() => Promise<MeetingMediaIceServerConfig>>()
      .mockResolvedValueOnce({
        mode: "turn",
        expiresAt: "2026-09-01T12:00:45.000Z",
        iceServers: staleIce,
      })
      .mockRejectedValueOnce(new Error("refresh unavailable"));
    const setup = harness({ getIceServerConfig, now: () => now });
    await setup.controller.start();
    now = Date.parse("2026-09-01T12:00:10.000Z");

    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
    });
    await setup.controller.whenIdle();

    expect(getIceServerConfig).toHaveBeenCalledTimes(2);
    expect(setup.peerIceServers).toEqual([
      [{ urls: "stun:stun.l.google.com:19302" }],
    ]);
    expect(JSON.stringify(setup.peerIceServers)).not.toContain("stale-secret");
  });

  it("rejects a successful refresh response that is still near expiry", async () => {
    const now = Date.parse("2026-09-01T12:00:00.000Z");
    const staleIce = [
      {
        urls: "turn:turn.commandcanvas.example:3478",
        username: "stale-refresh",
        credential: "stale-refresh-secret",
      },
    ] satisfies readonly RTCIceServer[];
    const getIceServerConfig = vi
      .fn<() => Promise<MeetingMediaIceServerConfig>>()
      .mockResolvedValueOnce({
        mode: "turn",
        expiresAt: "2026-09-01T12:00:30.000Z",
        iceServers: staleIce,
      })
      .mockResolvedValueOnce({
        mode: "turn",
        expiresAt: "2026-09-01T12:00:45.000Z",
        iceServers: staleIce,
      });
    const setup = harness({ getIceServerConfig, now: () => now });
    await setup.controller.start();

    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
    });
    await setup.controller.whenIdle();

    expect(getIceServerConfig).toHaveBeenCalledTimes(2);
    expect(setup.peerIceServers).toEqual([
      [{ urls: "stun:stun.l.google.com:19302" }],
    ]);
    expect(JSON.stringify(setup.peerIceServers)).not.toContain(
      "stale-refresh-secret",
    );
  });

  it("acknowledges a late joiner so the deterministic offerer cannot miss readiness", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.sent.length = 0;

    for (let attempt = 0; attempt < 2; attempt += 1)
      setup.emitSignal(lowerId, {
        version: 1,
        kind: "ready",
        senderId: lowerId,
      });
    await setup.controller.whenIdle();

    expect(
      setup.sent.filter(
        (message) =>
          message.payload.kind === "ready" &&
          "targetId" in message.payload &&
          message.payload.targetId === lowerId,
      ),
    ).toHaveLength(2);
    expect(setup.peers[0]?.localDescription).toBeNull();
  });

  it("reports a non-ok acknowledged signaling send instead of claiming success", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.channel.send = vi.fn(async () => "error");

    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
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

    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
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
      setup.emitSignal(remoteId, {
        version: 1,
        kind: "ice",
        senderId: remoteId,
        targetId: localId,
        candidate,
      });
    setup.emitSignal(remoteId, {
      version: 1,
      kind: "description",
      senderId: remoteId,
      targetId: localId,
      description: { type: "offer", sdp: "remote-offer" },
    });
    await setup.controller.whenIdle();

    expect(setup.peers[0]?.addedIceCandidates).toHaveLength(1);
  });

  it("bounds ICE candidates queued before the remote description", async () => {
    const setup = harness();
    await setup.controller.start();

    for (let index = 0; index < 140; index += 1)
      setup.emitSignal(remoteId, {
        version: 1,
        kind: "ice",
        senderId: remoteId,
        targetId: localId,
        candidate: {
          candidate: `candidate:${index} 1 UDP 1 192.0.2.1 ${5000 + index} typ host`,
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      });
    setup.emitSignal(remoteId, {
      version: 1,
      kind: "description",
      senderId: remoteId,
      targetId: localId,
      description: { type: "offer", sdp: "remote-offer" },
    });
    await setup.controller.whenIdle();

    expect(setup.peers[0]?.addedIceCandidates).toHaveLength(128);
  });

  it("exposes a real remote track and tears down every media resource", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
    });
    await setup.controller.whenIdle();

    const remoteVideo = track("video");
    setup.peers[0]?.emitTrack(remoteVideo);
    expect(setup.snapshots.at(-1)?.remoteStreams[remoteId]).toBeTruthy();

    await setup.controller.stop();

    expect(setup.audio.stop).toHaveBeenCalledOnce();
    expect(setup.video.stop).toHaveBeenCalledOnce();
    expect(setup.publishedVideo.stop).toHaveBeenCalledOnce();
    expect(setup.peers[0]?.close).toHaveBeenCalledOnce();
    expect(setup.client.removeChannel).toHaveBeenCalledWith(setup.channel);
    expect(setup.snapshots.at(-1)).toMatchObject({
      state: "off",
      localStream: null,
      remoteStreams: {},
    });
  });

  it("releases a broker-owned meeting lease without stopping its shared source tracks directly", async () => {
    const sourceAudio = track("audio");
    const publishedVideo = track("video");
    const sourceVideo = track("video", () => publishedVideo);
    const leasedStream = stream(sourceAudio, sourceVideo);
    const release = vi.fn();
    const setup = harness({
      acquireLocalMedia: vi.fn(async () => ({
        stream: leasedStream,
        release,
      })),
    });

    await setup.controller.start();
    await setup.controller.stop();
    await setup.controller.stop();

    expect(setup.getUserMedia).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(sourceAudio.stop).not.toHaveBeenCalled();
    expect(sourceVideo.stop).not.toHaveBeenCalled();
    expect(publishedVideo.stop).toHaveBeenCalledOnce();
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
    await setup.controller.whenIdle();

    expect(setup.video.enabled).toBe(true);
    expect(setup.publishedVideo.enabled).toBe(false);
    expect(setup.audio.enabled).toBe(false);
    expect(setup.getUserMedia).toHaveBeenCalledOnce();
    expect(setup.snapshots.at(-1)).toMatchObject({
      cameraEnabled: false,
      microphoneEnabled: false,
    });
  });

  it("detaches meeting video without disabling the capture track shared with hand inference", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
    });
    await setup.controller.whenIdle();
    const videoSender = setup.peers[0]?.senders.find(
      (sender) => sender.track?.kind === "video",
    );
    expect(videoSender).toBeDefined();

    setup.controller.setCameraEnabled(false);
    await setup.controller.whenIdle();

    expect(setup.video.enabled).toBe(true);
    expect(setup.video.stop).not.toHaveBeenCalled();
    expect(setup.publishedVideo.enabled).toBe(false);
    expect(videoSender?.replaceTrack).toHaveBeenLastCalledWith(null);
    expect(setup.snapshots.at(-1)).toMatchObject({ cameraEnabled: false });

    setup.controller.setCameraEnabled(true);
    await setup.controller.whenIdle();

    expect(setup.video.enabled).toBe(true);
    expect(setup.publishedVideo.enabled).toBe(true);
    expect(videoSender?.replaceTrack).toHaveBeenLastCalledWith(
      setup.publishedVideo,
    );
    expect(setup.getUserMedia).toHaveBeenCalledOnce();
    expect(setup.snapshots.at(-1)).toMatchObject({ cameraEnabled: true });
  });

  it("keeps a late peer's video sender detached when meeting video is already off", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.controller.setCameraEnabled(false);
    await setup.controller.whenIdle();

    setup.emitSignal(remoteId, {
      version: 1,
      kind: "ready",
      senderId: remoteId,
    });
    await setup.controller.whenIdle();

    const videoSender = setup.peers[0]?.senders.find((sender) =>
      sender.replaceTrack.mock.calls.some(([nextTrack]) => nextTrack === null),
    );
    expect(videoSender?.replaceTrack).toHaveBeenCalledWith(null);
    expect(videoSender?.track).toBeNull();
    expect(setup.video.enabled).toBe(true);
    expect(setup.publishedVideo.enabled).toBe(false);
    expect(setup.sent).toContainEqual({
      type: "broadcast",
      event: "meeting-media",
      payload: expect.objectContaining({
        kind: "description",
        targetId: remoteId,
      }),
    });
  });
});

class FakeSender {
  constructor(public track: MediaStreamTrack | null) {}

  replaceTrack = vi.fn(async (nextTrack: MediaStreamTrack | null) => {
    this.track = nextTrack;
  });
}

class FakePeer implements MeetingMediaPeer {
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  connectionState: RTCPeerConnectionState = "new";
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { track: MediaStreamTrack; streams: MediaStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  addedTracks: MediaStreamTrack[] = [];
  senders: FakeSender[] = [];
  addedIceCandidates: RTCIceCandidateInit[] = [];
  close = vi.fn();

  addTrack(track: MediaStreamTrack) {
    this.addedTracks.push(track);
    const sender = new FakeSender(track);
    this.senders.push(sender);
    return sender;
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
