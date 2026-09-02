export interface LocalMediaLease {
  stream: MediaStream;
  release: () => void;
}

export interface LocalMediaBroker {
  acquireHandVideo: () => Promise<LocalMediaLease>;
  acquireMeetingMedia: () => Promise<LocalMediaLease>;
  dispose: () => void;
}

interface LocalMediaBrokerOptions {
  getUserMedia?: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  createStream?: (tracks: MediaStreamTrack[]) => MediaStream;
}

interface ActiveLease {
  tracks: MediaStreamTrack[];
  video: boolean;
  audio: boolean;
  released: boolean;
}

export function createLocalMediaBroker(
  options: LocalMediaBrokerOptions = {},
): LocalMediaBroker {
  const getUserMedia =
    options.getUserMedia ??
    ((constraints: MediaStreamConstraints) =>
      navigator.mediaDevices.getUserMedia(constraints));
  const createStream =
    options.createStream ?? ((tracks: MediaStreamTrack[]) => new MediaStream(tracks));
  let videoSource: MediaStreamTrack | null = null;
  let audioSource: MediaStreamTrack | null = null;
  let videoPending: Promise<MediaStreamTrack> | null = null;
  let audioPending: Promise<MediaStreamTrack> | null = null;
  let videoReferences = 0;
  let audioReferences = 0;
  let disposed = false;
  const leases = new Set<ActiveLease>();

  async function ensureVideo() {
    if (disposed) throw new Error("Local media is no longer available.");
    if (videoSource?.readyState === "live") return videoSource;
    if (!videoPending)
      videoPending = getUserMedia({
        audio: false,
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
      })
        .then((stream) => selectSourceTrack(stream, "video"))
        .then((track) => {
          if (disposed) {
            track.stop();
            throw new Error("Local media is no longer available.");
          }
          videoSource = track;
          return track;
        })
        .finally(() => {
          videoPending = null;
        });
    return videoPending;
  }

  async function ensureAudio() {
    if (disposed) throw new Error("Local media is no longer available.");
    if (audioSource?.readyState === "live") return audioSource;
    if (!audioPending)
      audioPending = getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      })
        .then((stream) => selectSourceTrack(stream, "audio"))
        .then((track) => {
          if (disposed) {
            track.stop();
            throw new Error("Local media is no longer available.");
          }
          audioSource = track;
          return track;
        })
        .finally(() => {
          audioPending = null;
        });
    return audioPending;
  }

  async function acquireHandVideo() {
    const video = await ensureVideo();
    return cloneLease([video], true, false);
  }

  async function acquireMeetingMedia() {
    let video: MediaStreamTrack;
    let audio: MediaStreamTrack;
    try {
      [video, audio] = await Promise.all([ensureVideo(), ensureAudio()]);
    } catch (error) {
      releaseUnusedSources();
      throw error;
    }
    return cloneLease([audio, video], true, true);
  }

  function cloneLease(
    sources: MediaStreamTrack[],
    video: boolean,
    audio: boolean,
  ) {
    const tracks: MediaStreamTrack[] = [];
    try {
      for (const source of sources) tracks.push(source.clone());
    } catch (error) {
      for (const track of tracks) track.stop();
      releaseUnusedSources();
      throw error;
    }
    return createLease(tracks, video, audio);
  }

  function createLease(
    tracks: MediaStreamTrack[],
    video: boolean,
    audio: boolean,
  ): LocalMediaLease {
    if (disposed) {
      for (const track of tracks) track.stop();
      throw new Error("Local media is no longer available.");
    }
    let stream: MediaStream;
    try {
      stream = createStream(tracks);
    } catch (error) {
      for (const track of tracks) track.stop();
      releaseUnusedSources();
      throw error;
    }
    if (video) videoReferences += 1;
    if (audio) audioReferences += 1;
    const lease: ActiveLease = { tracks, video, audio, released: false };
    leases.add(lease);
    return {
      stream,
      release: () => releaseLease(lease),
    };
  }

  function releaseLease(lease: ActiveLease) {
    if (lease.released) return;
    lease.released = true;
    leases.delete(lease);
    for (const track of lease.tracks) track.stop();
    if (lease.video) videoReferences = Math.max(0, videoReferences - 1);
    if (lease.audio) audioReferences = Math.max(0, audioReferences - 1);
    releaseUnusedSources();
  }

  function releaseUnusedSources() {
    if (videoReferences === 0 && videoSource) {
      videoSource.stop();
      videoSource = null;
    }
    if (audioReferences === 0 && audioSource) {
      audioSource.stop();
      audioSource = null;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const lease of [...leases]) releaseLease(lease);
    videoSource?.stop();
    audioSource?.stop();
    videoSource = null;
    audioSource = null;
  }

  return { acquireHandVideo, acquireMeetingMedia, dispose };
}

function selectSourceTrack(stream: MediaStream, kind: "audio" | "video") {
  const tracks = stream.getTracks();
  const selected = tracks.find((track) => track.kind === kind);
  for (const track of tracks) if (track !== selected) track.stop();
  if (!selected) {
    for (const track of tracks) track.stop();
    throw new Error(`${kind === "video" ? "Camera" : "Microphone"} is unavailable.`);
  }
  return selected;
}
