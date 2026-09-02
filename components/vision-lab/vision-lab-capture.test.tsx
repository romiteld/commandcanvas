import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  VisionLabCapture,
  type VisionLabEnvironment,
} from "@/components/vision-lab/vision-lab-capture";

type VisionLabTestEnvironment = VisionLabEnvironment & {
  selectWebmMime: () => string | null;
  subscribeUser: (listener: (user: ReturnType<typeof permanentUser> | null) => void) => () => void;
};

function permanentUser() {
  return {
    id: "owner-1",
    email: "owner@example.com",
    emailConfirmedAt: "2026-09-02T14:00:00.000Z",
    isAnonymous: false,
  };
}

function fakeStream() {
  const track = {
    kind: "video",
    getSettings: () => ({
      width: 1280,
      height: 720,
      frameRate: 30,
      facingMode: "user",
    }),
    stop: vi.fn(),
  };
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    track,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createEnvironment(options: {
  user?: ReturnType<typeof permanentUser> | null;
  stream?: ReturnType<typeof fakeStream>;
  stopMode?: "immediate" | "delayed" | "never";
} = {}) {
  const stream = options.stream ?? fakeStream();
  const recorderHandlers: {
    data?: (event: { data: Blob }) => void;
    stop?: () => void;
    error?: () => void;
  } = {};
  const recorder = {
    state: "inactive" as "inactive" | "recording",
    mimeType: "video/webm",
    start: vi.fn(() => {
      recorder.state = "recording";
    }),
    stop: vi.fn(() => {
      recorder.state = "inactive";
      if ((options.stopMode ?? "immediate") === "immediate") emitStop();
    }),
    set ondataavailable(handler: ((event: { data: Blob }) => void) | null) {
      recorderHandlers.data = handler ?? undefined;
    },
    set onstop(handler: (() => void) | null) {
      recorderHandlers.stop = handler ?? undefined;
    },
    set onerror(handler: (() => void) | null) {
      recorderHandlers.error = handler ?? undefined;
    },
  };
  const emitStop = () => {
    recorderHandlers.data?.({ data: new Blob(["raw-camera-bytes"], { type: "video/webm" }) });
    recorderHandlers.stop?.();
  };
  const downloads: Array<{ name: string; blob: Blob }> = [];
  let userListener: ((user: ReturnType<typeof permanentUser> | null) => void) | null = null;
  const environment: VisionLabTestEnvironment = {
    loadUser: vi.fn(async () => options.user ?? permanentUser()),
    getUserMedia: vi.fn(async () => stream as unknown as MediaStream),
    createRecorder: vi.fn(() => recorder),
    selectWebmMime: vi.fn(() => "video/webm;codecs=vp8"),
    subscribeUser: vi.fn((listener) => {
      userListener = listener;
      return () => {
        userListener = null;
      };
    }),
    now: vi.fn(() => new Date("2026-09-02T14:00:00.000Z")),
    createSessionId: vi.fn(() => "vision-lab-owner-1-0001"),
    sha256: vi.fn(async () => "abc123"),
    download: vi.fn((name, blob) => downloads.push({ name, blob })),
  };
  return {
    environment,
    stream,
    recorder,
    downloads,
    emitStop,
    emitUser(user: ReturnType<typeof permanentUser> | null) {
      userListener?.(user);
    },
  };
}

describe("VisionLabCapture", () => {
  it("refuses anonymous accounts without exposing Start capture", async () => {
    const setup = createEnvironment({
      user: { ...permanentUser(), isAnonymous: true },
    });
    render(<VisionLabCapture environment={setup.environment} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vision Lab is available only to a verified CommandCanvas account.",
    );
    expect(screen.queryByRole("button", { name: "Start capture" })).toBeNull();
    expect(setup.environment.getUserMedia).not.toHaveBeenCalled();
  });

  it("does not request camera access until an eligible owner deliberately starts", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    render(<VisionLabCapture environment={setup.environment} />);

    expect(await screen.findByRole("button", { name: "Start capture" })).toBeEnabled();
    expect(setup.environment.getUserMedia).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Start capture" }));

    expect(setup.environment.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  });

  it("records the unmodified camera stream and exposes user-activated video and manifest downloads", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    expect(setup.environment.createRecorder).toHaveBeenCalledWith(
      setup.stream as unknown as MediaStream,
      "video/webm;codecs=vp8",
    );
    expect(setup.recorder.start).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Stop and download" }));

    expect(await screen.findByRole("button", { name: "Download video" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download manifest" })).toBeEnabled();
    expect(setup.downloads).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Download video" }));
    await user.click(screen.getByRole("button", { name: "Download manifest" }));

    expect(setup.downloads.map(({ name }) => name)).toEqual([
      "vision-lab-owner-1-0001.webm",
      "vision-lab-owner-1-0001.json",
    ]);
    expect(JSON.parse(await setup.downloads[1]!.blob.text())).toMatchObject({
      sessionId: "vision-lab-owner-1-0001",
      captureType: "acquisition",
      videoSha256: "abc123",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("stops camera tracks during component teardown", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    const view = render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    act(() => view.unmount());

    expect(setup.stream.track.stop).toHaveBeenCalledOnce();
  });

  it("refuses before camera access when WebM recording is unsupported without offering retry", async () => {
    const setup = createEnvironment();
    setup.environment.selectWebmMime = vi.fn(() => null);
    const user = userEvent.setup();
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This browser cannot create a WebM recording for Vision Lab.",
    );
    expect(setup.environment.getUserMedia).not.toHaveBeenCalled();
    expect(setup.environment.createRecorder).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Start capture" })).toBeNull();
  });

  it("detaches and stops tracks immediately when teardown precedes a delayed recorder stop", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment({ stopMode: "delayed" });
    const view = render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    act(() => view.unmount());

    expect(setup.recorder.stop).toHaveBeenCalledOnce();
    expect(setup.stream.track.stop).toHaveBeenCalledOnce();
    act(() => setup.emitStop());
    expect(setup.stream.track.stop).toHaveBeenCalledOnce();
  });

  it("stops tracks on page hide even if the recorder never emits stop", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment({ stopMode: "never" });
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    act(() => window.dispatchEvent(new Event("pagehide")));

    expect(setup.recorder.stop).toHaveBeenCalledOnce();
    expect(setup.stream.track.stop).toHaveBeenCalledOnce();
  });

  it("captures the stop timestamp before asynchronous hashing starts", async () => {
    const releaseHash = vi.fn();
    let continueHash: (() => void) | undefined;
    const setup = createEnvironment();
    setup.environment.now = vi
      .fn()
      .mockReturnValueOnce(new Date("2026-09-02T14:00:00.000Z"))
      .mockReturnValueOnce(new Date("2026-09-02T14:00:10.000Z"))
      .mockReturnValue(new Date("2026-09-02T14:01:00.000Z"));
    setup.environment.sha256 = vi.fn(
      () =>
        new Promise<string | null>((resolve) => {
          continueHash = () => resolve("abc123");
          releaseHash();
        }),
    );
    const user = userEvent.setup();
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    await user.click(screen.getByRole("button", { name: "Stop and download" }));
    expect(releaseHash).toHaveBeenCalledOnce();
    expect(setup.environment.now).toHaveBeenCalledTimes(2);
    act(() => continueHash?.());
    await user.click(await screen.findByRole("button", { name: "Download manifest" }));

    expect(JSON.parse(await setup.downloads[0]!.blob.text())).toMatchObject({
      stoppedAt: "2026-09-02T14:00:10.000Z",
    });
  });

  it("shows complete session guidance before and during capture", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    render(<VisionLabCapture environment={setup.environment} />);

    expect(await screen.findByText(/Frame one or two hands from wrist through fingertips/i)).toBeVisible();
    expect(screen.getByText(/Draw continuous lines, circles, and short strokes/i)).toBeVisible();
    expect(screen.getByText(/Avoid overlays, filters, other people, and identifiable documents/i)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Start capture" }));
    expect(screen.getByText(/Keep the same framing and complete the selected actions/i)).toBeVisible();
    expect(screen.getByText(/60 seconds or 250 MB maximum/i)).toBeVisible();
  });

  it("prepares downloads without a hash when hashing fails instead of losing the completed video", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    setup.environment.sha256 = vi.fn(async (): Promise<string | null> => {
      throw new Error("subtle unavailable");
    });
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    await user.click(screen.getByRole("button", { name: "Stop and download" }));
    await user.click(await screen.findByRole("button", { name: "Download video" }));
    await user.click(screen.getByRole("button", { name: "Download manifest" }));

    expect(setup.downloads.map(({ name }) => name)).toEqual([
      "vision-lab-owner-1-0001.webm",
      "vision-lab-owner-1-0001.json",
    ]);
    expect(JSON.parse(await setup.downloads[1]!.blob.text())).not.toHaveProperty(
      "videoSha256",
    );
  });

  it("retains a completed recording for an explicit download retry", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    let attempts = 0;
    setup.environment.download = vi.fn((name, blob) => {
      attempts += 1;
      if (attempts === 1) throw new Error("download blocked");
      setup.downloads.push({ name, blob });
    });
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    await user.click(screen.getByRole("button", { name: "Stop and download" }));
    await user.click(await screen.findByRole("button", { name: "Download video" }));
    expect(await screen.findByRole("button", { name: "Retry download" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Retry download" }));
    expect(setup.downloads.map(({ name }) => name)).toEqual(["vision-lab-owner-1-0001.webm"]);
  });

  it("refuses immediately when auth signs out while ready or recording", async () => {
    const user = userEvent.setup();
    const ready = createEnvironment();
    const readyView = render(<VisionLabCapture environment={ready.environment} />);
    await screen.findByRole("button", { name: "Start capture" });
    act(() => ready.emitUser(null));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vision Lab is available only to a verified CommandCanvas account.",
    );
    readyView.unmount();

    const recording = createEnvironment({ stopMode: "never" });
    render(<VisionLabCapture environment={recording.environment} />);
    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    act(() => recording.emitUser(null));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vision Lab is available only to a verified CommandCanvas account.",
    );
    expect(recording.stream.track.stop).toHaveBeenCalledOnce();
  });

  it("revalidates the owner account at Start before requesting camera access", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    setup.environment.loadUser = vi
      .fn()
      .mockResolvedValueOnce(permanentUser())
      .mockResolvedValueOnce(null);
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vision Lab is available only to a verified CommandCanvas account.",
    );
    expect(setup.environment.getUserMedia).not.toHaveBeenCalled();
  });

  it("cancels an in-flight owner revalidation before camera access when auth signs out", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    const pendingUser = deferred<ReturnType<typeof permanentUser> | null>();
    setup.environment.loadUser = vi
      .fn()
      .mockResolvedValueOnce(permanentUser())
      .mockReturnValueOnce(pendingUser.promise);
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    act(() => setup.emitUser(null));
    act(() => pendingUser.resolve(permanentUser()));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vision Lab is available only to a verified CommandCanvas account.",
    );
    expect(setup.environment.getUserMedia).not.toHaveBeenCalled();
  });

  it("stops a late camera stream without creating or starting a recorder after sign-out", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    const pendingStream = deferred<MediaStream>();
    setup.environment.getUserMedia = vi.fn(() => pendingStream.promise);
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    act(() => setup.emitUser(null));
    act(() => pendingStream.resolve(setup.stream as unknown as MediaStream));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vision Lab is available only to a verified CommandCanvas account.",
    );
    expect(setup.environment.createRecorder).not.toHaveBeenCalled();
    expect(setup.recorder.start).not.toHaveBeenCalled();
    expect(setup.stream.track.stop).toHaveBeenCalledOnce();
  });

  it("forbids download and ready revival when sign-out races a delayed hash", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    const pendingHash = deferred<string | null>();
    setup.environment.sha256 = vi.fn(() => pendingHash.promise);
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    await user.click(screen.getByRole("button", { name: "Stop and download" }));
    act(() => setup.emitUser(null));
    act(() => pendingHash.resolve("abc123"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Vision Lab is available only to a verified CommandCanvas account.",
    );
    expect(setup.downloads).toEqual([]);
    expect(screen.queryByRole("button", { name: "Download video" })).toBeNull();
  });

  it("clears a cancelled recording before delayed stop and allows a later signed-in ready state", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment({ stopMode: "delayed" });
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    act(() => setup.emitUser(null));
    act(() => setup.emitStop());
    act(() => setup.emitUser(permanentUser()));

    expect(await screen.findByRole("button", { name: "Start capture" })).toBeEnabled();
    expect(setup.stream.track.stop).toHaveBeenCalledOnce();
    expect(setup.downloads).toEqual([]);
    expect(screen.queryByRole("button", { name: "Download video" })).toBeNull();
  });

  it("revalidates and retries a recoverable camera denial", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    setup.environment.getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValueOnce(setup.stream as unknown as MediaStream);
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Camera access was not available");
    await user.click(screen.getByRole("button", { name: "Start capture" }));

    expect(setup.environment.getUserMedia).toHaveBeenCalledTimes(2);
    expect(setup.recorder.start).toHaveBeenCalledOnce();
  });

  it("keeps completed capture controls until the user explicitly discards them", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    await user.click(screen.getByRole("button", { name: "Stop and download" }));
    await user.click(await screen.findByRole("button", { name: "Download video" }));
    await user.click(screen.getByRole("button", { name: "Download manifest" }));
    expect(screen.getByRole("button", { name: "Download video" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Download manifest" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: "Discard completed recording" }));
    expect(screen.queryByRole("button", { name: "Download video" })).toBeNull();
    expect(screen.getByRole("button", { name: "Start capture" })).toBeEnabled();
  });
});
