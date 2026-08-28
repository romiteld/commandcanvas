import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import { MeetingFilmstrip } from "@/components/command-canvas/meeting-filmstrip";
import type {
  MeetingMediaController,
  MeetingMediaControllerOptions,
  MeetingMediaSnapshot,
} from "@/lib/meeting/media-controller";

const localId = "11111111-1111-4111-8111-111111111111";
const remoteId = "22222222-2222-4222-8222-222222222222";
const roomId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function harness() {
  let options: MeetingMediaControllerOptions | null = null;
  const controller: MeetingMediaController = {
    start: vi.fn(async () => true),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
    setAllowedParticipantIds: vi.fn(),
    setCameraEnabled: vi.fn(),
    setMicrophoneEnabled: vi.fn(),
    whenIdle: vi.fn(async () => undefined),
  };
  const createController = vi.fn((input: MeetingMediaControllerOptions) => {
    options = input;
    return controller;
  });
  return {
    controller,
    createController,
    emit(snapshot: MeetingMediaSnapshot) {
      if (!options) throw new Error("Controller was not created");
      options.onSnapshot(snapshot);
    },
  };
}

const participants = [
  { id: localId, displayName: "Daniel", color: "#f26a5b" },
  { id: remoteId, displayName: "Sarah", color: "#38bdf8" },
];

const crowdedParticipants = [
  ...participants,
  { id: "33333333-3333-4333-8333-333333333333", displayName: "Mike" },
  { id: "44444444-4444-4444-8444-444444444444", displayName: "Avery" },
  { id: "55555555-5555-4555-8555-555555555555", displayName: "Jo" },
];

describe("MeetingFilmstrip", () => {
  it("shows self and participants without requesting devices on mount", () => {
    const setup = harness();
    render(
      <MeetingFilmstrip
        roomId={roomId}
        localParticipantId={localId}
        participants={participants}
        getAccessToken={() => "token"}
        client={{} as MeetingMediaControllerOptions["client"]}
        createController={setup.createController}
      />,
    );

    expect(screen.getByText("Daniel (you)")).toBeVisible();
    expect(screen.getByText("Sarah")).toBeVisible();
    expect(screen.getAllByText("Video off")).toHaveLength(3);
    expect(setup.controller.start).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId("remote-meeting-video")).toHaveLength(0);
  });

  it("visibly refuses meeting media while more than four people are present", () => {
    const setup = harness();
    render(
      <MeetingFilmstrip
        roomId={roomId}
        localParticipantId={localId}
        participants={crowdedParticipants}
        getAccessToken={() => "token"}
        client={{} as MeetingMediaControllerOptions["client"]}
        createController={setup.createController}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Start camera and microphone" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "5 people are present. Meeting media starts at four or fewer.",
    );
  });

  it("starts only from a human click and exposes camera, microphone, and leave controls", async () => {
    const user = userEvent.setup();
    const setup = harness();
    render(
      <MeetingFilmstrip
        roomId={roomId}
        localParticipantId={localId}
        participants={participants}
        getAccessToken={() => "token"}
        client={{} as MeetingMediaControllerOptions["client"]}
        createController={setup.createController}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Start camera and microphone" }),
    );
    expect(setup.controller.start).toHaveBeenCalledOnce();

    act(() =>
      setup.emit({
        state: "active",
        localStream: {} as MediaStream,
        remoteStreams: {},
        peerStates: { [remoteId]: "connecting" },
        cameraEnabled: true,
        microphoneEnabled: true,
      }),
    );

    expect(
      await screen.findByRole("button", { name: "Turn camera off" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Turn camera off" }));
    await user.click(screen.getByRole("button", { name: "Mute microphone" }));
    expect(setup.controller.setCameraEnabled).toHaveBeenCalledWith(false);
    expect(setup.controller.setMicrophoneEnabled).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: "Leave meeting video" }));
    expect(setup.controller.stop).toHaveBeenCalledOnce();
  });

  it("remains startable after the Strict Mode effect cleanup cycle", async () => {
    const user = userEvent.setup();
    const createController = (
      options: MeetingMediaControllerOptions,
    ): MeetingMediaController => {
      let disposed = false;
      return {
        async start() {
          if (disposed) return false;
          options.onSnapshot({
            state: "active",
            localStream: {} as MediaStream,
            remoteStreams: {},
            peerStates: {},
            cameraEnabled: true,
            microphoneEnabled: true,
          });
          return true;
        },
        async stop() {},
        async dispose() {
          disposed = true;
        },
        setAllowedParticipantIds() {},
        setCameraEnabled() {},
        setMicrophoneEnabled() {},
        async whenIdle() {},
      };
    };
    render(
      <StrictMode>
        <MeetingFilmstrip
          roomId={roomId}
          localParticipantId={localId}
          participants={participants}
          getAccessToken={() => "token"}
          client={{} as MeetingMediaControllerOptions["client"]}
          createController={createController}
        />
      </StrictMode>,
    );

    await user.click(
      screen.getByRole("button", { name: "Start camera and microphone" }),
    );

    expect(
      await screen.findByRole("button", { name: "Turn camera off" }),
    ).toBeVisible();
  });

  it("renders remote video only after an actual remote stream arrives", () => {
    const setup = harness();
    render(
      <MeetingFilmstrip
        roomId={roomId}
        localParticipantId={localId}
        participants={participants}
        getAccessToken={() => "token"}
        client={{} as MeetingMediaControllerOptions["client"]}
        createController={setup.createController}
      />,
    );
    const remoteStream = {} as MediaStream;

    act(() =>
      setup.emit({
        state: "active",
        localStream: {} as MediaStream,
        remoteStreams: { [remoteId]: remoteStream },
        peerStates: { [remoteId]: "connected" },
        cameraEnabled: true,
        microphoneEnabled: true,
      }),
    );

    const video = screen.getByTestId("remote-meeting-video");
    expect(video).toHaveAttribute("aria-label", "Sarah live video");
    expect(screen.getByText("Direct connection")).toBeVisible();
  });

  it("distinguishes lost signaling from stopped direct media", () => {
    const setup = harness();
    render(
      <MeetingFilmstrip
        roomId={roomId}
        localParticipantId={localId}
        participants={participants}
        getAccessToken={() => "token"}
        client={{} as MeetingMediaControllerOptions["client"]}
        createController={setup.createController}
      />,
    );

    act(() =>
      setup.emit({
        state: "signaling_lost",
        localStream: {} as MediaStream,
        remoteStreams: {},
        peerStates: {},
        cameraEnabled: true,
        microphoneEnabled: true,
        message:
          "Signaling was lost. Existing direct media may continue; new connections are unavailable.",
      }),
    );

    expect(screen.getByText("Signaling lost")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Existing direct media may continue",
    );
    expect(
      screen.getByRole("button", { name: "Leave meeting video" }),
    ).toBeVisible();
  });

  it("exposes and clears the authorized local stream for deliberate hand-input reuse", () => {
    const setup = harness();
    const onLocalStreamChange = vi.fn();
    const view = render(
      <MeetingFilmstrip
        roomId={roomId}
        localParticipantId={localId}
        participants={participants}
        getAccessToken={() => "token"}
        client={{} as MeetingMediaControllerOptions["client"]}
        createController={setup.createController}
        onLocalStreamChange={onLocalStreamChange}
      />,
    );
    const localStream = {} as MediaStream;

    act(() =>
      setup.emit({
        state: "active",
        localStream,
        remoteStreams: {},
        peerStates: {},
        cameraEnabled: true,
        microphoneEnabled: true,
      }),
    );

    expect(onLocalStreamChange).toHaveBeenLastCalledWith(localStream);
    view.unmount();
    expect(onLocalStreamChange).toHaveBeenLastCalledWith(null);
  });

  it("collapses to a top-edge meeting control and stops tracks on unmount", async () => {
    const user = userEvent.setup();
    const setup = harness();
    const view = render(
      <MeetingFilmstrip
        roomId={roomId}
        localParticipantId={localId}
        participants={participants}
        getAccessToken={() => "token"}
        client={{} as MeetingMediaControllerOptions["client"]}
        createController={setup.createController}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Collapse meeting video" }));
    expect(screen.queryByText("Daniel (you)")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Expand meeting video" }),
    ).toBeVisible();

    view.unmount();
    await waitFor(() => expect(setup.controller.dispose).toHaveBeenCalledOnce());
  });

  it("reports playback failure honestly instead of claiming remote video is audible", () => {
    const setup = harness();
    render(
      <MeetingFilmstrip
        roomId={roomId}
        localParticipantId={localId}
        participants={participants}
        getAccessToken={() => "token"}
        client={{} as MeetingMediaControllerOptions["client"]}
        createController={setup.createController}
      />,
    );
    act(() =>
      setup.emit({
        state: "active",
        localStream: {} as MediaStream,
        remoteStreams: { [remoteId]: {} as MediaStream },
        peerStates: { [remoteId]: "connected" },
        cameraEnabled: true,
        microphoneEnabled: true,
      }),
    );

    fireEvent.error(screen.getByTestId("remote-meeting-video"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Sarah's video could not play.",
    );
  });

  it("offers a user-gesture recovery when mobile autoplay blocks remote media", async () => {
    const user = userEvent.setup();
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockRejectedValueOnce(new DOMException("Not allowed", "NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    const setup = harness();
    render(
      <MeetingFilmstrip
        roomId={roomId}
        localParticipantId={localId}
        participants={participants}
        getAccessToken={() => "token"}
        client={{} as MeetingMediaControllerOptions["client"]}
        createController={setup.createController}
      />,
    );
    act(() =>
      setup.emit({
        state: "active",
        localStream: null,
        remoteStreams: { [remoteId]: {} as MediaStream },
        peerStates: { [remoteId]: "connected" },
        cameraEnabled: false,
        microphoneEnabled: false,
      }),
    );

    const resume = await screen.findByRole("button", {
      name: "Tap to play Sarah's video",
    });
    await user.click(resume);

    expect(play).toHaveBeenCalledTimes(2);
    expect(
      screen.queryByRole("button", { name: "Tap to play Sarah's video" }),
    ).toBeNull();
    play.mockRestore();
  });
});
