import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SpatialCameraControl } from "@/components/command-canvas/spatial-camera-control";
import type {
  HandTrackingController,
  HandTrackingObservation,
  HandTrackingStatus,
} from "@/lib/gesture/hand-tracking-controller";

function fakeController() {
  let status: HandTrackingStatus = { state: "off" };
  const statusListeners = new Set<(next: HandTrackingStatus) => void>();
  const observationListeners = new Set<
    (next: HandTrackingObservation) => void
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
  };
}

describe("SpatialCameraControl", () => {
  it("keeps the camera session alive when canvas observation handlers refresh", () => {
    const fake = fakeController();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(
      <SpatialCameraControl
        createController={() => fake.controller}
        onObservation={first}
      />,
    );
    fake.setStatus({ state: "ready" });

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
        "Camera frames stay in this browser. When hand input is enabled, the detector model downloads from Google. Only semantic canvas commands are shared.",
      ),
    ).toBeVisible();
    expect(fake.controller.start).not.toHaveBeenCalled();
    expect(screen.getByText("Camera off · pointer active")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Enable hand input" }));

    expect(fake.controller.start).toHaveBeenCalledOnce();
    expect(fake.controller.start).toHaveBeenCalledWith(
      expect.objectContaining({ muted: true }),
    );
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
    expect(await screen.findByText("Hand detected · pinch to move")).toBeVisible();
    expect(onObservation).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "pinch" }),
    );

    await user.click(screen.getByRole("button", { name: "Disable hand input" }));
    expect(fake.controller.stop).toHaveBeenCalledOnce();
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
