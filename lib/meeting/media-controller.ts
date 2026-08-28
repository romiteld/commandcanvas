import { z } from "zod";

import {
  meetingMediaSignalSchema,
  type MeetingMediaSignal,
} from "@/lib/meeting/media-protocol";

const roomIdSchema = z.uuid();
const participantIdSchema = z.uuid();
const MAX_REMOTE_PEERS = 3;
const MAX_MEETING_PARTICIPANTS = MAX_REMOTE_PEERS + 1;
const MAX_PENDING_ICE_CANDIDATES = 128;
const RESOURCE_CLEANUP_TIMEOUT_MS = 500;
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
  addTrack: (track: MediaStreamTrack, stream: MediaStream) => unknown;
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
  setAllowedParticipantIds: (participantIds: ReadonlySet<string>) => void;
  setCameraEnabled: (enabled: boolean) => void;
  setMicrophoneEnabled: (enabled: boolean) => void;
  whenIdle: () => Promise<void>;
}

export interface MeetingMediaControllerOptions {
  roomId: string;
  localParticipantId: string;
  allowedParticipantIds: ReadonlySet<string>;
  getAccessToken: () => string | null;
  client: MeetingMediaClient;
  getUserMedia?: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  createPeer?: () => MeetingMediaPeer;
  createRemoteStream?: (track: MediaStreamTrack) => MediaStream;
  onSnapshot: (snapshot: MeetingMediaSnapshot) => void;
}

interface PeerRecord {
  peer: MeetingMediaPeer;
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
  const createPeer =
    rawOptions.createPeer ??
    (() =>
      new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      }) as unknown as MeetingMediaPeer);
  const createRemoteStream =
    rawOptions.createRemoteStream ?? ((track) => new MediaStream([track]));
  let snapshot = initialSnapshot();
  let channel: MeetingMediaChannel | null = null;
  let localStream: MediaStream | null = null;
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

    emit({ state: "requesting_permission", message: undefined });
    let acquiredStream: MediaStream;
    try {
      acquiredStream = await getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 360 },
        },
      });
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
      stopTracks(acquiredStream);
      return false;
    }
    localStream = acquiredStream;

    emit({
      state: "connecting",
      localStream,
      cameraEnabled: localStream.getVideoTracks().some((track) => track.enabled),
      microphoneEnabled: localStream
        .getAudioTracks()
        .some((track) => track.enabled),
      message: "Connecting direct meeting media…",
    });

    try {
      await rawOptions.client.realtime.setAuth(accessToken);
      if (disposed || version !== lifecycleVersion || !localStream) return false;
      const nextChannel = rawOptions.client.channel(`room-media:${roomId}`, {
        config: {
          private: true,
          broadcast: { ack: true, self: false },
        },
      });
      channel = nextChannel;
      nextChannel
        .on("broadcast", { event: "meeting-media" }, (message) => {
          const signal = parsePayload(message);
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
          if (channel !== nextChannel || disposed) return;
          if (status === "SUBSCRIBED") {
            emit({ state: "active", message: undefined });
            void send({
              version: 1,
              kind: "ready",
              senderId: localParticipantId,
            });
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            emit({
              state: "signaling_lost",
              message:
                "Signaling was lost. Existing direct media may continue; new connections are unavailable.",
            });
          }
        });
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
      const record = ensurePeer(signal.senderId);
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
      const record = ensurePeer(signal.senderId);
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
    const record = ensurePeer(signal.senderId);
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

  function ensurePeer(remoteParticipantId: string) {
    const existing = peers.get(remoteParticipantId);
    if (existing) return existing;
    if (peers.size >= MAX_REMOTE_PEERS || !localStream) return null;

    const peer = createPeer();
    const record: PeerRecord = {
      peer,
      pendingIce: [],
      pendingIceKeys: new Set(),
    };
    peers.set(remoteParticipantId, record);
    for (const track of localStream.getTracks()) peer.addTrack(track, localStream);
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
    const activeChannel = channel;
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
      if (!disposed && channel === activeChannel && localStream)
        emit({
          state: "signaling_lost",
          message: "Meeting media signaling was interrupted.",
        });
      return false;
    }
  }

  function setCameraEnabled(enabled: boolean) {
    if (!localStream) return;
    for (const track of localStream.getVideoTracks()) track.enabled = enabled;
    emit({ cameraEnabled: enabled });
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

  function setAllowedParticipantIds(participantIds: ReadonlySet<string>) {
    allowedParticipantIds = new Set(participantIds);
    if (allowedParticipantIds.size > MAX_MEETING_PARTICIPANTS) {
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
  }

  async function cleanupResources(announceDeparture: boolean) {
    const activeChannel = channel;
    channel = null;
    for (const participantId of [...peers.keys()]) closePeer(participantId);
    stopTracks(localStream);
    localStream = null;
    if (!activeChannel) return;

    if (announceDeparture)
      await settleWithin(
        activeChannel.send({
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
    await settleWithin(
      Promise.resolve(rawOptions.client.removeChannel(activeChannel)),
      RESOURCE_CLEANUP_TIMEOUT_MS,
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

function parsePayload(message: unknown): MeetingMediaSignal | null {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return null;
  const candidate = (message as { payload?: unknown }).payload;
  const parsed = meetingMediaSignalSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
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
