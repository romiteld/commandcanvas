import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SpatialCameraControl } from "@/components/command-canvas/spatial-camera-control";
import type {
  HandTrackingController,
  HandTrackingEngineStatus,
  HandTrackingObservation,
  HandTrackingStatus,
} from "@/lib/gesture/hand-tracking-controller";
import type { HandLandmarks } from "@/lib/gesture/hand-intent";

function trackedLandmarks(): HandLandmarks {
  return Array.from({ length: 21 }, (_, index) => ({
    x: 0.2 + index * 0.02,
    y: 0.25 + index * 0.01,
    z: 0,
  })) as unknown as HandLandmarks;
}

function fakeController() {
  let status: HandTrackingStatus = { state: "off" };
  const statusListeners = new Set<(next: HandTrackingStatus) => void>();
  const observationListeners = new Set<
    (next: HandTrackingObservation) => void
  >();
  let engineStatus: HandTrackingEngineStatus | null = null;
  const engineListeners = new Set<
    (next: HandTrackingEngineStatus | null) => void
  >();
  const controller: HandTrackingController = {
    getStatus: () => status,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    subscribeObservations(listener) {
      observationListeners.add(listener);
      return () => observationListeners.delete(listener);
    },
    getEngineStatus: () => engineStatus,
    subscribeEngineStatus(listener) {
      engineListeners.add(listener);
      return () => engineListeners.delete(listener);
    },
    start: vi.fn(async () => undefined),
    stop: vi.fn(() => undefined),
  };
  return {
    controller,
    setStatus(next: HandTrackingStatus) {
      status = next;
      statusListeners.forEach((listener) => listener(next));
    },
    emit(next: HandTrackingObservation) {
      observationListeners.forEach((listener) => listener(next));
    },
    setEngine(next: HandTrackingEngineStatus | null) {
      engineStatus = next;
      engineListeners.forEach((listener) => listener(next));
    },
  };
}

describe("SpatialCameraControl", () => {
  it("enters spatial control automatically after the one required permission action", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    const onObservation = vi.fn();
    const onSpatialModeStarted = vi.fn();
    const { container } = render(
      <SpatialCameraControl
        createController={() => fake.controller}
        onObservation={onObservation}
        onSpatialModeStarted={onSpatialModeStarted}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));
    act(() =>
      fake.emit({
        mode: "point",
        pointer: { x: 0.25, y: 0.4 },
        confidence: 0.96,
        timestamp: 1_000,
      }),
    );

    expect(onSpatialModeStarted).toHaveBeenCalledOnce();
    expect(onObservation).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "point" }),
    );
    expect(container.querySelector(".spatial-camera-control")).not.toHaveClass(
      "is-expanded",
    );
    expect(
      screen.queryByRole("button", { name: "Start spatial mode" }),
    ).toBeNull();
  });

  it("keeps the camera session alive when canvas observation handlers refresh", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <SpatialCameraControl
        createController={() => fake.controller}
        onObservation={first}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));

    rerender(
      <SpatialCameraControl
        createController={() => fake.controller}
        onObservation={second}
      />,
    );
    fake.emit({
      mode: "point",
      pointer: { x: 0.2, y: 0.3 },
      confidence: 0.95,
      timestamp: 1_000,
    });

    expect(fake.controller.stop).not.toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("keeps camera off until an explicit click and explains local processing", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    render(
      <SpatialCameraControl createController={() => fake.controller} />,
    );

    expect(
      screen.getByText(
        "Camera frames stay in this browser. The active local hand-pose engine downloads its model in your browser. Only semantic canvas commands are shared.",
      ),
    ).toBeVisible();
    expect(fake.controller.start).not.toHaveBeenCalled();
    expect(screen.getByText("Camera off · pointer active")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Enable hand input" }));

    expect(fake.controller.start).toHaveBeenCalledOnce();
    expect(fake.controller.start).toHaveBeenCalledWith(
      expect.objectContaining({ muted: true }),
    );
    expect(
      screen.queryByRole("button", { name: "Start spatial mode" }),
    ).toBeNull();
  });

  it("shows ready separately from a real detected hand and disables cleanly", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    const onObservation = vi.fn();
    render(
      <SpatialCameraControl
        createController={() => fake.controller}
        onObservation={onObservation}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));

    fake.setStatus({ state: "ready" });
    expect(await screen.findByText("Hand input ready · local only")).toBeVisible();
    expect(screen.queryByText(/hand detected/i)).toBeNull();

    fake.emit({
      mode: "pinch",
      pointer: { x: 0.4, y: 0.3 },
      confidence: 0.95,
      timestamp: 1_000,
    });
    expect(await screen.findByText("PINCH · ready to hold")).toBeVisible();
    expect(onObservation).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "pinch" }),
    );

    await user.click(screen.getByRole("button", { name: "Disable hand input" }));
    expect(fake.controller.stop).toHaveBeenCalledOnce();
  });

  it("visibly identifies YOLO as primary and labels a runtime fallback", async () => {
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);

    act(() => {
      fake.setEngine({
        id: "yolo26-hand-pose-2abb91",
        displayName: "YOLO26 Hand Pose",
        runtime: "onnx-runtime-web",
        fallback: false,
        executionProvider: "webgpu",
        adapter: { architecture: "ampere", description: "NVIDIA GPU" },
        detectorRoundTripMs: 69.01,
        resultRateFps: 14.49,
        runtimeSamples: 12,
      });
      fake.setStatus({ state: "ready" });
    });
    expect(await screen.findByText("Engine YOLO26 Hand Pose")).toBeVisible();
    expect(screen.getByText("Provider WebGPU · NVIDIA GPU")).toBeVisible();
    expect(
      screen.getByText("69 ms detector/worker round trip · 14.5 results/s"),
    ).toBeVisible();

    act(() =>
      fake.setEngine({
        id: "mediapipe-hand-landmarker-v1",
        displayName: "MediaPipe Hand Landmarker",
        runtime: "mediapipe-tasks-vision",
        fallback: true,
      }),
    );
    expect(
      await screen.findByText("Fallback MediaPipe Hand Landmarker"),
    ).toBeVisible();
  });

  it("hands control back to the canvas as soon as the engine is ready", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    const onSpatialModeStarted = vi.fn();
    render(
      <SpatialCameraControl
        createController={() => fake.controller}
        onSpatialModeStarted={onSpatialModeStarted}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));

    expect(onSpatialModeStarted).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole("button", { name: "Start spatial mode" }),
    ).toBeNull();
  });

  it("reports point and pinch as separate real-session self-checks", async () => {
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);

    fake.setStatus({ state: "ready" });
    expect(await screen.findByText("Gesture self-check · 0/2")).toBeVisible();
    expect(screen.getByText("Point not seen")).toBeVisible();
    expect(screen.getByText("Pinch not seen")).toBeVisible();

    act(() =>
      fake.emit({
        mode: "point",
        pointer: { x: 0.3, y: 0.4 },
        confidence: 0.91,
        handedness: "left",
        landmarks: trackedLandmarks(),
        pinchDistance: 0.12,
        timestamp: 1_000,
      }),
    );
    expect(await screen.findByText("Gesture self-check · 1/2")).toBeVisible();
    expect(screen.getByText("Point seen · 91% confidence")).toBeVisible();

    act(() => {
      fake.emit({ mode: "idle", timestamp: 1_010 });
      fake.emit({
        mode: "pinch",
        pointer: { x: 0.4, y: 0.45 },
        confidence: 0.96,
        timestamp: 1_020,
      });
    });
    expect(await screen.findByText("Gesture self-check · 2/2")).toBeVisible();
    expect(screen.getByText("Pinch seen · 96% confidence")).toBeVisible();
    expect(
      screen.getByText(
        "Point and pinch detected in this camera session. Self-check complete.",
      ),
    ).toBeVisible();

    act(() => fake.setStatus({ state: "off" }));
    expect(screen.queryByText(/Gesture self-check/)).toBeNull();
  });

  it("expands the live calibration view and shows the tracked pointer", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    const { container } = render(
      <SpatialCameraControl createController={() => fake.controller} />,
    );
    fake.setStatus({ state: "ready" });

    await user.click(
      screen.getByRole("button", { name: "Expand hand tracking preview" }),
    );
    expect(container.querySelector(".spatial-camera-control")).toHaveClass(
      "is-expanded",
    );
    expect(
      screen.getByRole("button", { name: "Collapse hand tracking preview" }),
    ).toHaveAttribute("aria-expanded", "true");

    act(() =>
      fake.emit({
        mode: "point",
        pointer: { x: 0.3, y: 0.4 },
        confidence: 0.91,
        handedness: "left",
        landmarks: trackedLandmarks(),
        pinchDistance: 0.12,
        timestamp: 1_000,
      }),
    );
    expect(container.querySelectorAll("[data-tracked-hand-pointer]")).toHaveLength(
      1,
    );
    expect(container.querySelectorAll("[data-hand-keypoint]")).toHaveLength(21);
    expect(container.querySelectorAll("[data-hand-connection]")).toHaveLength(21);
    expect(screen.getByText("Pinch distance 0.120")).toBeVisible();
    expect(screen.getByText("21-point hand landmarks")).toBeVisible();
    expect(screen.getByText("Confidence 91%")).toBeVisible();
    expect(screen.getByText("left hand")).toBeVisible();
    expect(screen.getByText("State point")).toBeVisible();
  });

  it("shows open-palm and bimanual resize feedback without miscounting the pinch self-check", async () => {
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);
    fake.setStatus({ state: "ready" });

    act(() =>
      fake.emit({
        mode: "open_palm",
        pointer: { x: 0.5, y: 0.5 },
        confidence: 0.94,
        handedness: "left",
        timestamp: 1_000,
      }),
    );
    expect(
      await screen.findByText("OPEN · hold steady to focus"),
    ).toBeVisible();
    expect(screen.getByText("Gesture self-check · 0/2")).toBeVisible();

    act(() =>
      fake.emit({
        mode: "bimanual_pinch",
        hands: [
          {
            handedness: "left",
            pointer: { x: 0.3, y: 0.5 },
            confidence: 0.95,
          },
          {
            handedness: "right",
            pointer: { x: 0.7, y: 0.5 },
            confidence: 0.96,
          },
        ],
        center: { x: 0.5, y: 0.5 },
        span: 0.4,
        timestamp: 1_016,
      }),
    );
    expect(
      await screen.findByText("TWO HANDS · spread to resize"),
    ).toBeVisible();
  });

  it.each([
    [
      { state: "refused", message: "Camera permission was not granted." } as const,
      "Camera permission refused · pointer active",
    ],
    [
      {
        state: "unavailable",
        message: "Local hand tracking is unavailable in this browser.",
      } as const,
      "Hand input unavailable · pointer active",
    ],
  ])("keeps the pointer fallback honest for %s", async (status, label) => {
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);

    fake.setStatus(status);

    expect(await screen.findByText(label)).toBeVisible();
    expect(screen.getByText(status.message)).toBeVisible();
  });
});
