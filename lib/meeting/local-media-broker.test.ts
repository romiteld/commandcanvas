import { describe, expect, it, vi } from "vitest";

import { createLocalMediaBroker } from "@/lib/meeting/local-media-broker";

class FakeTrack {
  enabled = true;
  readyState: MediaStreamTrackState = "live";
  stop = vi.fn(() => {
    this.readyState = "ended";
  });
  clone = vi.fn(() => new FakeTrack(this.kind));

  constructor(public readonly kind: "audio" | "video") {}
}

function fakeStream(tracks: FakeTrack[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((track) => track.kind === "audio"),
    getVideoTracks: () => tracks.filter((track) => track.kind === "video"),
  } as unknown as MediaStream;
}

describe("local media broker", () => {
  it("shares one physical camera source across hand and meeting leases", async () => {
    const camera = new FakeTrack("video");
    const microphone = new FakeTrack("audio");
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) =>
      fakeStream(constraints.video ? [camera] : [microphone]),
    );
    const broker = createLocalMediaBroker({
      getUserMedia,
      createStream: (tracks) =>
        fakeStream(tracks as unknown as FakeTrack[]),
    });

    const hand = await broker.acquireHandVideo();
    const meeting = await broker.acquireMeetingMedia();

    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: false,
      video: expect.any(Object),
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      audio: expect.any(Object),
      video: false,
    });
    expect(camera.clone).toHaveBeenCalledTimes(2);
    expect(meeting.stream.getAudioTracks()).toHaveLength(1);
    expect(meeting.stream.getVideoTracks()).toHaveLength(1);
    expect(hand.stream.getVideoTracks()).toHaveLength(1);

    meeting.release();
    expect(hand.stream.getVideoTracks()[0]?.readyState).toBe("live");
    expect(camera.stop).not.toHaveBeenCalled();

    hand.release();
    expect(camera.stop).toHaveBeenCalledOnce();
    expect(microphone.stop).toHaveBeenCalledOnce();
  });

  it("deduplicates concurrent camera acquisition and makes release idempotent", async () => {
    const camera = new FakeTrack("video");
    let resolveCamera: ((stream: MediaStream) => void) | undefined;
    const pending = new Promise<MediaStream>((resolve) => {
      resolveCamera = resolve;
    });
    const getUserMedia = vi.fn(() => pending);
    const broker = createLocalMediaBroker({
      getUserMedia,
      createStream: (tracks) =>
        fakeStream(tracks as unknown as FakeTrack[]),
    });

    const first = broker.acquireHandVideo();
    const second = broker.acquireHandVideo();
    expect(getUserMedia).toHaveBeenCalledOnce();
    resolveCamera?.(fakeStream([camera]));
    const [firstLease, secondLease] = await Promise.all([first, second]);

    firstLease.release();
    firstLease.release();
    expect(camera.stop).not.toHaveBeenCalled();
    secondLease.release();
    expect(camera.stop).toHaveBeenCalledOnce();
  });

  it("stops source and leased tracks on page disposal", async () => {
    const camera = new FakeTrack("video");
    const getUserMedia = vi.fn(async () => fakeStream([camera]));
    const broker = createLocalMediaBroker({
      getUserMedia,
      createStream: (tracks) =>
        fakeStream(tracks as unknown as FakeTrack[]),
    });
    const lease = await broker.acquireHandVideo();
    const leasedTrack = lease.stream.getVideoTracks()[0] as unknown as FakeTrack;

    broker.dispose();

    expect(camera.stop).toHaveBeenCalledOnce();
    expect(leasedTrack.stop).toHaveBeenCalledOnce();
    lease.release();
    expect(camera.stop).toHaveBeenCalledOnce();
  });

  it("releases an acquired camera source when microphone acquisition fails", async () => {
    const camera = new FakeTrack("video");
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.video) return fakeStream([camera]);
      throw new DOMException("Microphone unavailable", "NotFoundError");
    });
    const broker = createLocalMediaBroker({
      getUserMedia,
      createStream: (tracks) =>
        fakeStream(tracks as unknown as FakeTrack[]),
    });

    await expect(broker.acquireMeetingMedia()).rejects.toThrow(
      "Microphone unavailable",
    );

    expect(camera.stop).toHaveBeenCalledOnce();
  });

  it("stops already-cloned tracks and unused sources when a later clone fails", async () => {
    const camera = new FakeTrack("video");
    const microphone = new FakeTrack("audio");
    camera.clone.mockImplementationOnce(() => {
      throw new Error("Camera clone failed");
    });
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) =>
      fakeStream(constraints.video ? [camera] : [microphone]),
    );
    const broker = createLocalMediaBroker({
      getUserMedia,
      createStream: (tracks) =>
        fakeStream(tracks as unknown as FakeTrack[]),
    });

    await expect(broker.acquireMeetingMedia()).rejects.toThrow(
      "Camera clone failed",
    );

    const clonedMicrophone = microphone.clone.mock.results[0]
      ?.value as FakeTrack;
    expect(clonedMicrophone.stop).toHaveBeenCalledOnce();
    expect(camera.stop).toHaveBeenCalledOnce();
    expect(microphone.stop).toHaveBeenCalledOnce();
  });

  it("stops cloned tracks and their source when MediaStream construction fails", async () => {
    const camera = new FakeTrack("video");
    const getUserMedia = vi.fn(async () => fakeStream([camera]));
    const broker = createLocalMediaBroker({
      getUserMedia,
      createStream: () => {
        throw new Error("MediaStream construction failed");
      },
    });

    await expect(broker.acquireHandVideo()).rejects.toThrow(
      "MediaStream construction failed",
    );

    const clonedCamera = camera.clone.mock.results[0]?.value as FakeTrack;
    expect(clonedCamera.stop).toHaveBeenCalledOnce();
    expect(camera.stop).toHaveBeenCalledOnce();
  });
});
