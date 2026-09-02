import { z } from "zod";

import {
  meetingMediaTopic,
  meetingMediaSignalSchema,
  type MeetingMediaSignal,
} from "@/lib/meeting/media-protocol";

const roomIdSchema = z.uuid();
const participantIdSchema = z.uuid();
const MAX_REMOTE_PEERS = 3;
const MAX_MEETING_PARTICIPANTS = MAX_REMOTE_PEERS + 1;
const MAX_PENDING_ICE_CANDIDATES = 128;
const RESOURCE_CLEANUP_TIMEOUT_MS = 500;
const ICE_SERVER_LOOKUP_TIMEOUT_MS = 1_500;
const TURN_REFRESH_SAFETY_WINDOW_MS = 60_000;
const DIRECT_ICE_SERVERS: readonly RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];
const OVER_CAPACITY_MESSAGE =
  "Meeting media is available when four or fewer people are present.";

export type MeetingMediaState =
  | "off"
  | "requesting_permission"
  | "connecting"
  | "active"
  | "signaling_lost"
  | "error";

export interface MeetingMediaSnapshot {
  state: MeetingMediaState;
  localStream: MediaStream | null;
  remoteStreams: Readonly<Record<string, MediaStream>>;
  peerStates: Readonly<
    Record<string, "connecting" | "connected" | "disconnected" | "failed">
  >;
  cameraEnabled: boolean;
  microphoneEnabled: boolean;
  message?: string;
}

export interface MeetingMediaPeer {
  localDescription: RTCSessionDescriptionInit | null;
  remoteDescription: RTCSessionDescriptionInit | null;
  connectionState: RTCPeerConnectionState;
  onicecandidate: ((event: { candidate: RTCIceCandidate | null }) => void) | null;
  ontrack:
    | ((event: { track: MediaStreamTrack; streams: MediaStream[] }) => void)
    | null;
  onconnectionstatechange: (() => void) | null;
  addTrack: (
    track: MediaStreamTrack,
    stream: MediaStream,
  ) => MeetingMediaSender;
  createOffer: () => Promise<RTCSessionDescriptionInit>;
  createAnswer: () => Promise<RTCSessionDescriptionInit>;
  setLocalDescription: (
    description: RTCSessionDescriptionInit,
  ) => Promise<unknown>;
  setRemoteDescription: (
    description: RTCSessionDescriptionInit,
  ) => Promise<unknown>;
  addIceCandidate: (candidate: RTCIceCandidateInit) => Promise<unknown>;
  close: () => void;
}

export interface MeetingMediaSender {
  replaceTrack: (track: MediaStreamTrack | null) => Promise<unknown>;
}

export interface MeetingMediaChannel {
  on: (
    type: "broadcast",
    filter: { event: "meeting-media" },
    callback: (message?: unknown) => void,
  ) => MeetingMediaChannel;
  subscribe: (callback: (status: string) => void) => MeetingMediaChannel;
  send: (message: {
    type: "broadcast";
    event: "meeting-media";
    payload: MeetingMediaSignal;
  }) => Promise<string>;
}

export interface MeetingMediaClient {
  realtime: { setAuth: (accessToken: string) => Promise<unknown> | unknown };
  channel: (
    topic: string,
    options: {
      config: { private: true; broadcast: { ack: true; self: false } };
    },
  ) => MeetingMediaChannel;
  removeChannel: (channel: MeetingMediaChannel) => Promise<unknown> | unknown;
}

export interface MeetingMediaController {
  start: () => Promise<boolean>;
  stop: () => Promise<void>;
  dispose: () => Promise<void>;
  setAllowedParticipantIds: (
    participantIds: ReadonlySet<string>,
    decision?: { overCapacity: true },
  ) => void;
  setCameraEnabled: (enabled: boolean) => void;
  setMicrophoneEnabled: (enabled: boolean) => void;
  whenIdle: () => Promise<void>;
}

export type MeetingMediaIceServerConfig =
  | {
      mode: "turn";
      expiresAt: string;
      iceServers: readonly RTCIceServer[];
    }
  | { mode: "direct"; iceServers: readonly RTCIceServer[] };

export interface MeetingMediaControllerOptions {
  roomId: string;
  localParticipantId: string;
  allowedParticipantIds: ReadonlySet<string>;
  getAccessToken: () => string | null;
  client: MeetingMediaClient;
  getUserMedia?: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  acquireLocalMedia?: () => Promise<{
    stream: MediaStream;
    release: () => void;
  }>;
  getIceServerConfig?: () => Promise<MeetingMediaIceServerConfig>;
  now?: () => number;
  createPeer?: (iceServers: readonly RTCIceServer[]) => MeetingMediaPeer;
  createRemoteStream?: (track: MediaStreamTrack) => MediaStream;
  onSnapshot: (snapshot: MeetingMediaSnapshot) => void;
}

interface PeerRecord {
  peer: MeetingMediaPeer;
  videoSender: MeetingMediaSender | null;
  pendingIce: RTCIceCandidateInit[];
  pendingIceKeys: Set<string>;
}

const initialSnapshot = (): MeetingMediaSnapshot => ({
  state: "off",
  localStream: null,
  remoteStreams: {},
  peerStates: {},
  cameraEnabled: false,
  microphoneEnabled: false,
});

export function createMeetingMediaController(
  rawOptions: MeetingMediaControllerOptions,
): MeetingMediaController {
  const roomId = roomIdSchema.parse(rawOptions.roomId);
  const localParticipantId = participantIdSchema.parse(
    rawOptions.localParticipantId,
  );
  const getUserMedia =
    rawOptions.getUserMedia ??
    ((constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints));
  const createPeer = rawOptions.createPeer ??
    ((iceServers) =>
      new RTCPeerConnection({
        iceServers: [...iceServers],
      }) as unknown as MeetingMediaPeer);
  const createRemoteStream =
    rawOptions.createRemoteStream ?? ((track) => new MediaStream([track]));
  let snapshot = initialSnapshot();
  const channels = new Map<string, MeetingMediaChannel>();
  const subscribedParticipantIds = new Set<string>();
  let localStream: MediaStream | null = null;
  let releaseLocalMedia: (() => void) | null = null;
  let publicationVideoTrack: MediaStreamTrack | null = null;
  let iceServerConfig: MeetingMediaIceServerConfig = directIceServerConfig();
  let iceServerLookup: Promise<MeetingMediaIceServerConfig> | null = null;
  let disposed = false;
  let lifecycleVersion = 0;
  let starting: Promise<boolean> | null = null;
  let signalWork: Promise<void> = Promise.resolve();
  const peers = new Map<string, PeerRecord>();
  const readyAcknowledged = new Set<string>();
  let allowedParticipantIds = new Set(rawOptions.allowedParticipantIds);

  function emit(patch?: Partial<MeetingMediaSnapshot>) {
    if (patch) snapshot = { ...snapshot, ...patch };
    rawOptions.onSnapshot({
      ...snapshot,
      remoteStreams: { ...snapshot.remoteStreams },
      peerStates: { ...snapshot.peerStates },
    });
  }

  async function start() {
    if (disposed || localStream || snapshot.state === "active") return false;
    if (starting) return starting;
    const version = lifecycleVersion;
    starting = startOnce(version).finally(() => {
      starting = null;
    });
    return starting;
  }

  async function startOnce(version: number) {
    if (allowedParticipantIds.size > MAX_MEETING_PARTICIPANTS) {
      emit({ state: "error", message: OVER_CAPACITY_MESSAGE });
      return false;
    }
    const accessToken = rawOptions.getAccessToken();
    if (!accessToken) {
      emit({ state: "error", message: "Room authorization is unavailable." });
      return false;
    }
    if (
      !allowedParticipantIds.has(localParticipantId)
    ) {
      emit({ state: "error", message: "Room membership is unavailable." });
      return false;
    }

    iceServerConfig = await resolveIceServerConfig(
      rawOptions.getIceServerConfig,
    );
    if (disposed || version !== lifecycleVersion) return false;

    emit({ state: "requesting_permission", message: undefined });
    let acquired: { stream: MediaStream; release: () => void };
    try {
      acquired = rawOptions.acquireLocalMedia
        ? await rawOptions.acquireLocalMedia()
        : await acquireOwnedMedia(getUserMedia);
    } catch (error) {
      if (disposed || version !== lifecycleVersion) return false;
      emit({
        state: "error",
        message:
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Camera or microphone permission was not granted."
            : "Camera and microphone could not be started.",
      });
      return false;
    }
    if (disposed || version !== lifecycleVersion) {
      acquired.release();
      return false;
    }
    const acquiredStream = acquired.stream;
    const sourceVideoTrack = acquiredStream.getVideoTracks()[0] ?? null;
    try {
      publicationVideoTrack = sourceVideoTrack?.clone() ?? null;
    } catch {
      acquired.release();
      if (disposed || version !== lifecycleVersion) return false;
      emit({
        state: "error",
        localStream: null,
        cameraEnabled: false,
        microphoneEnabled: false,
        message: "Camera video could not be prepared for the meeting.",
      });
      return false;
    }
    if (publicationVideoTrack && sourceVideoTrack)
      publicationVideoTrack.enabled = sourceVideoTrack.enabled;
    localStream = acquiredStream;
    releaseLocalMedia = once(acquired.release);

    emit({
      state: "connecting",
      localStream,
      cameraEnabled: publicationVideoTrack?.enabled ?? false,
      microphoneEnabled: localStream
        .getAudioTracks()
        .some((track) => track.enabled),
      message: "Connecting direct meeting media…",
    });

    try {
      await rawOptions.client.realtime.setAuth(accessToken);
      if (disposed || version !== lifecycleVersion || !localStream) return false;
      syncSenderChannels();
      return true;
    } catch {
      if (disposed || version !== lifecycleVersion) return false;
      await cleanupResources(false);
      emit({
        state: "error",
        localStream: null,
        remoteStreams: {},
        peerStates: {},
        cameraEnabled: false,
        microphoneEnabled: false,
        message: "Meeting media signaling is unavailable.",
      });
      return false;
    }
  }

  function syncSenderChannels() {
    if (!localStream || disposed) return;
    const desiredParticipantIds = new Set(allowedParticipantIds);
    for (const participantId of [...channels.keys()])
      if (!desiredParticipantIds.has(participantId))
        void removeSenderChannel(participantId);

    const orderedParticipantIds = [
      localParticipantId,
      ...[...desiredParticipantIds]
        .filter((participantId) => participantId !== localParticipantId)
        .sort(),
    ];
    for (const participantId of orderedParticipantIds)
      if (desiredParticipantIds.has(participantId) && !channels.has(participantId))
        openSenderChannel(participantId);
  }

  function openSenderChannel(boundParticipantId: string) {
    const nextChannel = rawOptions.client.channel(
      meetingMediaTopic(roomId, boundParticipantId),
      {
        config: {
          private: true,
          broadcast: { ack: true, self: false },
        },
      },
    );
    channels.set(boundParticipantId, nextChannel);
    nextChannel
      .on("broadcast", { event: "meeting-media" }, (message) => {
        if (
          channels.get(boundParticipantId) !== nextChannel ||
          disposed ||
          !allowedParticipantIds.has(boundParticipantId)
        )
          return;
        const signal = parsePayload(message, boundParticipantId);
        if (!signal) return;
        signalWork = signalWork
          .then(() => handleSignal(signal))
          .catch(() => {
            if (!disposed)
              emit({
                state: "error",
                message: "Direct meeting media negotiation failed.",
              });
          });
      })
      .subscribe((status) => {
        if (channels.get(boundParticipantId) !== nextChannel || disposed) return;
        if (status === "SUBSCRIBED") {
          subscribedParticipantIds.add(boundParticipantId);
          if (boundParticipantId === localParticipantId) {
            emit({ state: "active", message: undefined });
            void send({
              version: 1,
              kind: "ready",
              senderId: localParticipantId,
            });
            for (const remoteParticipantId of subscribedParticipantIds)
              if (remoteParticipantId !== localParticipantId)
                void announceReadyTo(remoteParticipantId);
          } else if (subscribedParticipantIds.has(localParticipantId))
            void announceReadyTo(boundParticipantId);
        } else if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          subscribedParticipantIds.delete(boundParticipantId);
          emit({
            state: "signaling_lost",
            message:
              "Signaling was lost. Existing direct media may continue; new connections are unavailable.",
          });
        }
      });
  }

  function announceReadyTo(remoteParticipantId: string) {
    return send({
      version: 1,
      kind: "ready",
      senderId: localParticipantId,
      targetId: remoteParticipantId,
    });
  }

  async function removeSenderChannel(participantId: string) {
    const activeChannel = channels.get(participantId);
    if (!activeChannel) return;
    channels.delete(participantId);
    subscribedParticipantIds.delete(participantId);
    await settleWithin(
      Promise.resolve(rawOptions.client.removeChannel(activeChannel)),
      RESOURCE_CLEANUP_TIMEOUT_MS,
    );
  }

  async function handleSignal(signal: MeetingMediaSignal) {
    if (
      disposed ||
      !localStream ||
      signal.senderId === localParticipantId ||
      !allowedParticipantIds.has(signal.senderId)
    )
      return;
    if ("targetId" in signal && signal.targetId !== localParticipantId) return;

    if (signal.kind === "left") {
      closePeer(signal.senderId, "disconnected");
      return;
    }
    if (signal.kind === "ready") {
      const record = await ensurePeer(signal.senderId);
      if (record && localParticipantId.localeCompare(signal.senderId) < 0)
        await sendOffer(signal.senderId, record);
      else if (record && !readyAcknowledged.has(signal.senderId)) {
        readyAcknowledged.add(signal.senderId);
        await send({
          version: 1,
          kind: "ready",
          senderId: localParticipantId,
          targetId: signal.senderId,
        });
      }
      return;
    }
    if (signal.kind === "description") {
      const record = await ensurePeer(signal.senderId);
      if (!record) return;
      await record.peer.setRemoteDescription(signal.description);
      const pendingIce = record.pendingIce.splice(0);
      record.pendingIceKeys.clear();
      for (const candidate of pendingIce)
        await record.peer.addIceCandidate(candidate);
      if (signal.description.type === "offer") {
        const answer = await record.peer.createAnswer();
        await record.peer.setLocalDescription(answer);
        await send({
          version: 1,
          kind: "description",
          senderId: localParticipantId,
          targetId: signal.senderId,
          description: requiredDescription(answer, "answer"),
        });
      }
      return;
    }
    const record = await ensurePeer(signal.senderId);
    if (!record) return;
    if (!record.peer.remoteDescription) {
      const key = iceCandidateKey(signal.candidate);
      if (
        record.pendingIceKeys.has(key) ||
        record.pendingIce.length >= MAX_PENDING_ICE_CANDIDATES
      )
        return;
      record.pendingIceKeys.add(key);
      record.pendingIce.push(signal.candidate);
    } else await record.peer.addIceCandidate(signal.candidate);
  }

  async function ensurePeer(remoteParticipantId: string) {
    const existing = peers.get(remoteParticipantId);
    if (existing) return existing;
    if (peers.size >= MAX_REMOTE_PEERS || !localStream) return null;

    const currentIceServers = await iceServersForNewPeer();
    if (disposed || !localStream || !allowedParticipantIds.has(remoteParticipantId))
      return null;
    const peer = createPeer(currentIceServers);
    const record: PeerRecord = {
      peer,
      videoSender: null,
      pendingIce: [],
      pendingIceKeys: new Set(),
    };
    try {
      for (const track of localStream.getAudioTracks())
        peer.addTrack(track, localStream);
      if (publicationVideoTrack) {
        record.videoSender = peer.addTrack(publicationVideoTrack, localStream);
        if (!snapshot.cameraEnabled)
          await record.videoSender.replaceTrack(null);
      }
    } catch (error) {
      peer.close();
      throw error;
    }
    peers.set(remoteParticipantId, record);
    peer.onicecandidate = (event: { candidate: RTCIceCandidate | null }) => {
      if (!event.candidate) return;
      const candidate = event.candidate;
      void send({
        version: 1,
        kind: "ice",
        senderId: localParticipantId,
        targetId: remoteParticipantId,
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment,
        },
      });
    };
    peer.ontrack = (event: {
      track: MediaStreamTrack;
      streams: MediaStream[];
    }) => {
      const remoteStream = event.streams[0] ?? createRemoteStream(event.track);
      emit({
        remoteStreams: {
          ...snapshot.remoteStreams,
          [remoteParticipantId]: remoteStream,
        },
      });
    };
    peer.onconnectionstatechange = () => {
      const state = peer.connectionState;
      if (state === "connected") setPeerState(remoteParticipantId, "connected");
      else if (state === "failed") closePeer(remoteParticipantId, "failed");
      else if (state === "disconnected" || state === "closed")
        closePeer(remoteParticipantId, "disconnected");
    };
    setPeerState(remoteParticipantId, "connecting");
    return record;
  }

  async function iceServersForNewPeer() {
    if (!turnConfigNeedsRefresh(iceServerConfig, rawOptions.now?.() ?? Date.now()))
      return iceServerConfig.iceServers;
    if (!iceServerLookup) {
      iceServerLookup = resolveIceServerConfig(rawOptions.getIceServerConfig)
        .then((resolved) => {
          const usable = turnConfigNeedsRefresh(
            resolved,
            rawOptions.now?.() ?? Date.now(),
          )
            ? directIceServerConfig()
            : resolved;
          iceServerConfig = usable;
          return usable;
        })
        .finally(() => {
          iceServerLookup = null;
        });
    }
    return (await iceServerLookup).iceServers;
  }

  async function sendOffer(remoteParticipantId: string, record: PeerRecord) {
    if (record.peer.localDescription) return;
    const offer = await record.peer.createOffer();
    await record.peer.setLocalDescription(offer);
    await send({
      version: 1,
      kind: "description",
      senderId: localParticipantId,
      targetId: remoteParticipantId,
      description: requiredDescription(offer, "offer"),
    });
  }

  function setPeerState(
    participantId: string,
    state: "connecting" | "connected" | "disconnected" | "failed",
  ) {
    emit({
      peerStates: { ...snapshot.peerStates, [participantId]: state },
    });
  }

  function closePeer(
    participantId: string,
    terminalState?: "disconnected" | "failed",
  ) {
    const record = peers.get(participantId);
    if (record) {
      record.peer.onicecandidate = null;
      record.peer.ontrack = null;
      record.peer.onconnectionstatechange = null;
      record.peer.close();
      peers.delete(participantId);
      readyAcknowledged.delete(participantId);
    }
    const remoteStreams = { ...snapshot.remoteStreams };
    stopTracks(remoteStreams[participantId]);
    delete remoteStreams[participantId];
    const peerStates = { ...snapshot.peerStates };
    if (terminalState) peerStates[participantId] = terminalState;
    else delete peerStates[participantId];
    emit({ remoteStreams, peerStates });
  }

  async function send(signal: MeetingMediaSignal) {
    const activeChannel = channels.get(localParticipantId);
    if (!activeChannel) return false;
    try {
      const result = await activeChannel.send({
        type: "broadcast",
        event: "meeting-media",
        payload: meetingMediaSignalSchema.parse(signal),
      });
      if (result !== "ok") throw new Error("Signaling was not acknowledged.");
      return true;
    } catch {
      if (
        !disposed &&
        channels.get(localParticipantId) === activeChannel &&
        localStream
      )
        emit({
          state: "signaling_lost",
          message: "Meeting media signaling was interrupted.",
        });
      return false;
    }
  }

  function setCameraEnabled(enabled: boolean) {
    const track = publicationVideoTrack;
    if (!localStream || !track) return;
    track.enabled = enabled;
    emit({ cameraEnabled: enabled });
    signalWork = signalWork.then(async () => {
      if (disposed || publicationVideoTrack !== track) return;
      for (const [participantId, record] of [...peers.entries()]) {
        if (!record.videoSender) continue;
        try {
          await record.videoSender.replaceTrack(enabled ? track : null);
        } catch {
          closePeer(participantId, "failed");
        }
      }
    });
  }

  function setMicrophoneEnabled(enabled: boolean) {
    if (!localStream) return;
    for (const track of localStream.getAudioTracks()) track.enabled = enabled;
    emit({ microphoneEnabled: enabled });
  }

  async function stop() {
    lifecycleVersion += 1;
    const cleanup = cleanupResources(true);
    snapshot = initialSnapshot();
    emit();
    await cleanup;
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    lifecycleVersion += 1;
    const cleanup = cleanupResources(true);
    snapshot = initialSnapshot();
    emit();
    await cleanup;
  }

  function setAllowedParticipantIds(
    participantIds: ReadonlySet<string>,
    decision?: { overCapacity: true },
  ) {
    allowedParticipantIds = new Set(participantIds);
    if (
      decision?.overCapacity ||
      allowedParticipantIds.size > MAX_MEETING_PARTICIPANTS
    ) {
      lifecycleVersion += 1;
      const cleanup = cleanupResources(true);
      snapshot = {
        ...initialSnapshot(),
        state: "error",
        message: OVER_CAPACITY_MESSAGE,
      };
      emit();
      void cleanup;
      return;
    }
    if (!allowedParticipantIds.has(localParticipantId)) {
      lifecycleVersion += 1;
      const cleanup = cleanupResources(true);
      snapshot = {
        ...initialSnapshot(),
        state: "error",
        message: "Room membership is unavailable.",
      };
      emit();
      void cleanup;
      return;
    }
    if (
      snapshot.state === "error" &&
      snapshot.message === OVER_CAPACITY_MESSAGE &&
      !localStream
    ) {
      snapshot = initialSnapshot();
      emit();
    }
    for (const participantId of [...peers.keys()])
      if (!allowedParticipantIds.has(participantId))
        closePeer(participantId, "disconnected");
    syncSenderChannels();
  }

  async function cleanupResources(announceDeparture: boolean) {
    const activeChannels = [...channels.values()];
    const localChannel = channels.get(localParticipantId);
    channels.clear();
    subscribedParticipantIds.clear();
    for (const participantId of [...peers.keys()]) closePeer(participantId);
    publicationVideoTrack?.stop();
    publicationVideoTrack = null;
    releaseLocalMedia?.();
    releaseLocalMedia = null;
    localStream = null;
    if (!localChannel && activeChannels.length === 0) return;

    if (announceDeparture && localChannel)
      await settleWithin(
        localChannel.send({
          type: "broadcast",
          event: "meeting-media",
          payload: {
            version: 1,
            kind: "left",
            senderId: localParticipantId,
          },
        }),
        RESOURCE_CLEANUP_TIMEOUT_MS,
      );
    await Promise.all(
      activeChannels.map((activeChannel) =>
        settleWithin(
          Promise.resolve(rawOptions.client.removeChannel(activeChannel)),
          RESOURCE_CLEANUP_TIMEOUT_MS,
        ),
      ),
    );
  }

  async function whenIdle() {
    await signalWork;
  }

  return {
    start,
    stop,
    dispose,
    setAllowedParticipantIds,
    setCameraEnabled,
    setMicrophoneEnabled,
    whenIdle,
  };
}

function parsePayload(
  message: unknown,
  boundParticipantId: string,
): MeetingMediaSignal | null {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return null;
  const candidate = (message as { payload?: unknown }).payload;
  const parsed = meetingMediaSignalSchema.safeParse(candidate);
  return parsed.success && parsed.data.senderId === boundParticipantId
    ? parsed.data
    : null;
}

function requiredDescription(
  description: RTCSessionDescriptionInit,
  expectedType: "offer" | "answer",
) {
  if (description.type !== expectedType || !description.sdp)
    throw new Error("Peer description was incomplete.");
  return { type: expectedType, sdp: description.sdp } as const;
}

function stopTracks(stream: MediaStream | null | undefined) {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

async function acquireOwnedMedia(
  getUserMedia: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>,
) {
  const stream = await getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 360 },
    },
  });
  return { stream, release: once(() => stopTracks(stream)) };
}

function once(operation: () => void) {
  let called = false;
  return () => {
    if (called) return;
    called = true;
    operation();
  };
}

function iceCandidateKey(candidate: RTCIceCandidateInit) {
  return [
    candidate.candidate ?? "",
    candidate.sdpMid ?? "",
    candidate.sdpMLineIndex ?? "",
    candidate.usernameFragment ?? "",
  ].join("\u001f");
}

async function settleWithin(operation: Promise<unknown>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation.catch(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function resolveIceServerConfig(
  loader: MeetingMediaControllerOptions["getIceServerConfig"],
): Promise<MeetingMediaIceServerConfig> {
  if (!loader) return directIceServerConfig();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const resolved = await Promise.race([
      loader(),
      new Promise<MeetingMediaIceServerConfig>((resolve) => {
        timeout = setTimeout(
          () => resolve(directIceServerConfig()),
          ICE_SERVER_LOOKUP_TIMEOUT_MS,
        );
      }),
    ]);
    return resolved.iceServers.length > 0 ? resolved : directIceServerConfig();
  } catch {
    return directIceServerConfig();
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function turnConfigNeedsRefresh(
  config: MeetingMediaIceServerConfig,
  nowEpochMs: number,
) {
  if (config.mode !== "turn") return false;
  const expiresAt = Date.parse(config.expiresAt);
  return (
    !Number.isFinite(expiresAt) ||
    expiresAt <= nowEpochMs + TURN_REFRESH_SAFETY_WINDOW_MS
  );
}

function directIceServerConfig(): MeetingMediaIceServerConfig {
  return { mode: "direct", iceServers: DIRECT_ICE_SERVERS };
}
