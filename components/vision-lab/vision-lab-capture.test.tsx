import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  VisionLabCapture,
  type VisionLabEnvironment,
} from "@/components/vision-lab/vision-lab-capture";

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

function createEnvironment(options: {
  user?: ReturnType<typeof permanentUser> | null;
  stream?: ReturnType<typeof fakeStream>;
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
      recorderHandlers.data?.({ data: new Blob(["raw-camera-bytes"], { type: "video/webm" }) });
      recorderHandlers.stop?.();
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
  const downloads: Array<{ name: string; blob: Blob }> = [];
  const environment: VisionLabEnvironment = {
    loadUser: vi.fn(async () => options.user ?? permanentUser()),
    getUserMedia: vi.fn(async () => stream as unknown as MediaStream),
    createRecorder: vi.fn(() => recorder),
    now: vi.fn(() => new Date("2026-09-02T14:00:00.000Z")),
    createSessionId: vi.fn(() => "vision-lab-owner-1-0001"),
    sha256: vi.fn(async () => "abc123"),
    download: vi.fn((name, blob) => downloads.push({ name, blob })),
  };
  return { environment, stream, recorder, downloads };
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

  it("records the unmodified camera stream and downloads only video plus its manifest", async () => {
    const user = userEvent.setup();
    const setup = createEnvironment();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    render(<VisionLabCapture environment={setup.environment} />);

    await user.click(await screen.findByRole("button", { name: "Start capture" }));
    expect(setup.environment.createRecorder).toHaveBeenCalledWith(
      setup.stream as unknown as MediaStream,
    );
    expect(setup.recorder.start).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Stop and download" }));

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
});
