import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  SpatialCameraControl,
  type SpatialCameraControllerPreferences,
  type SpatialCalibrationResult,
} from "@/components/command-canvas/spatial-camera-control";
import type {
  HandTrackingController,
  HandTrackingEngineStatus,
  HandTrackingObservation,
  HandTrackingSensorFrame,
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

function openPalmLandmarks(): HandLandmarks {
  const landmarks = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.7,
    z: 0,
    visibility: 0.95,
  }));
  landmarks[0] = { x: 0.5, y: 0.9, z: 0, visibility: 0.95 };
  landmarks[4] = { x: 0.22, y: 0.5, z: 0, visibility: 0.95 };
  for (const [mcp, pip, dip, tip, x] of [
    [5, 6, 7, 8, 0.5],
    [9, 10, 11, 12, 0.58],
    [13, 14, 15, 16, 0.65],
    [17, 18, 19, 20, 0.72],
  ] as const) {
    landmarks[mcp] = { x, y: 0.67, z: 0, visibility: 0.95 };
    landmarks[pip] = { x, y: 0.51, z: 0, visibility: 0.95 };
    landmarks[dip] = { x, y: 0.38, z: 0, visibility: 0.95 };
    landmarks[tip] = { x, y: 0.24, z: 0, visibility: 0.95 };
  }
  return landmarks as unknown as HandLandmarks;
}

function fakeController(options: { sensorFrames?: boolean } = {}) {
  let status: HandTrackingStatus = { state: "off" };
  const statusListeners = new Set<(next: HandTrackingStatus) => void>();
  const observationListeners = new Set<
    (next: HandTrackingObservation) => void
  >();
  const sensorListeners = new Set<(next: HandTrackingSensorFrame) => void>();
  let engineStatus: HandTrackingEngineStatus | null = null;
  const engineListeners = new Set<
    (next: HandTrackingEngineStatus | null) => void
  >();
  const setPinchThresholds = vi.fn();
  const setPointPolicy = vi.fn();
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
    setPinchThresholds,
    setPointPolicy,
    getEngineStatus: () => engineStatus,
    subscribeEngineStatus(listener) {
      engineListeners.add(listener);
      return () => engineListeners.delete(listener);
    },
    acknowledgeRendered: vi.fn(() => true),
    start: vi.fn(async () => undefined),
    stop: vi.fn(() => undefined),
  };
  if (options.sensorFrames)
    controller.subscribeSensorFrames = (listener) => {
      sensorListeners.add(listener);
      return () => sensorListeners.delete(listener);
    };
  return {
    controller,
    setPointPolicy,
    setStatus(next: HandTrackingStatus) {
      status = next;
      statusListeners.forEach((listener) => listener(next));
    },
    emit(next: HandTrackingObservation) {
      observationListeners.forEach((listener) => listener(next));
    },
    emitSensor(next: HandTrackingSensorFrame) {
      sensorListeners.forEach((listener) => listener(next));
    },
    setEngine(next: HandTrackingEngineStatus | null) {
      engineStatus = next;
      engineListeners.forEach((listener) => listener(next));
    },
  };
}

describe("hand point-policy wiring", () => {
  it("switches the detector to index-led pointing only while Draw is explicit", () => {
    const fake = fakeController();
    const view = render(
      <SpatialCameraControl
        pointPolicy="deliberate"
        createController={() => fake.controller}
      />,
    );
    expect(fake.setPointPolicy).toHaveBeenLastCalledWith("deliberate");

    view.rerender(
      <SpatialCameraControl
        pointPolicy="draw-index-led"
        createController={() => fake.controller}
      />,
    );
    expect(fake.setPointPolicy).toHaveBeenLastCalledWith("draw-index-led");
  });
});

function calibrationSensorFrame(
  pointer: { x: number; y: number },
  pinchRatio: number,
  timestamp: number,
  trackId = "calibration-hand",
  landmarks = trackedLandmarks(),
  source: HandTrackingSensorFrame["source"] = "calibration-test",
  handednessConfidence: number | undefined = 0.97,
  handedness: "left" | "right" | "unknown" = "right",
): HandTrackingSensorFrame {
  return {
    timestamp,
    source,
    receivedAt: timestamp,
    hands: [
      {
        handedness,
        ...(handednessConfidence === undefined ? {} : { handednessConfidence }),
        trackId,
        confidence: 0.97,
        landmarks,
        prediction: { predicted: false },
        source,
        capturedAt: timestamp,
        receivedAt: timestamp,
        measurements: {
          indexTip: pointer,
          thumbTip: { x: pointer.x + 0.02, y: pointer.y },
          pinchMidpoint: { x: pointer.x + 0.01, y: pointer.y },
          palmMcpCentroid: pointer,
          pinchDistance: pinchRatio * 0.2,
          palmScale: 0.2,
          pinchRatio,
          confidence: 0.97,
          indexTipConfidence: 0.96,
          thumbTipConfidence: 0.95,
        },
      },
    ],
  };
}

function calibrationObservation(
  mode: "point" | "pinch" | "open_palm",
  pointer: { x: number; y: number },
  pinchRatio: number,
  timestamp: number,
): HandTrackingObservation {
  return {
    mode,
    pointer,
    confidence: 0.97,
    handedness: "right",
    trackId: "calibration-hand",
    prediction: { predicted: false },
    trackingState: "tracked",
    ...(mode === "open_palm" ? { landmarks: openPalmLandmarks() } : {}),
    pinchRatio,
    measurements: {
      indexTip: pointer,
      thumbTip: { x: pointer.x + 0.02, y: pointer.y },
      pinchMidpoint: { x: pointer.x + 0.01, y: pointer.y },
      palmMcpCentroid: pointer,
      pinchDistance: pinchRatio * 0.2,
      palmScale: 0.2,
      pinchRatio,
      confidence: 0.97,
      indexTipConfidence: 0.96,
      thumbTipConfidence: 0.95,
    },
    timestamp,
  };
}

function drawingCalibrationSensorFrame(
  pointer: { x: number; y: number },
  pinchRatio: number,
  drawingClutchRatio: number,
  timestamp: number,
  trackId = "calibration-hand",
  handedness: "left" | "right" | "unknown" = "right",
  handednessConfidence: number | undefined = 0.97,
): HandTrackingSensorFrame {
  const frame = calibrationSensorFrame(
    pointer,
    pinchRatio,
    timestamp,
    trackId,
    trackedLandmarks(),
    "calibration-test",
    handednessConfidence,
    handedness,
  );
  const hand = frame.hands[0]!;
  return {
    ...frame,
    hands: [
      {
        ...hand,
        measurements: {
          ...hand.measurements,
          middleTip: {
            x:
              hand.measurements.thumbTip.x +
              drawingClutchRatio * hand.measurements.palmScale,
            y: pointer.y,
          },
          drawingClutchRatio,
          middleTipConfidence: 0.94,
        },
      },
    ],
  };
}

async function completeMeasuredHandCalibrationToReview(
  user: ReturnType<typeof userEvent.setup>,
  fake: ReturnType<typeof fakeController>,
  options: {
    readonly startedAt: number;
    readonly trackId: string;
    readonly handedness: "left" | "right";
    readonly openPinchRatio?: number;
    readonly closedPinchRatio?: number;
    readonly openDrawingClutchRatio?: number;
    readonly closedDrawingClutchRatio?: number;
  },
) {
  const {
    startedAt,
    trackId,
    handedness,
    openPinchRatio = 0.72,
    closedPinchRatio = 0.22,
    openDrawingClutchRatio = 0.82,
    closedDrawingClutchRatio = 0.24,
  } = options;
  act(() => {
    for (let sample = 0; sample < 6; sample += 1)
      fake.emitSensor(
        calibrationSensorFrame(
          { x: 0.5 + (sample % 2) * 0.004, y: 0.5 },
          openPinchRatio,
          startedAt + sample * 16,
          trackId,
          openPalmLandmarks(),
          "calibration-test",
          0.97,
          handedness,
        ),
      );
  });
  await user.click(
    screen.getByRole("button", { name: "Continue to reach mapping" }),
  );

  const corners = [
    { x: 0.36, y: 0.34 },
    { x: 0.64, y: 0.34 },
    { x: 0.36, y: 0.66 },
    { x: 0.64, y: 0.66 },
  ];
  act(() => {
    for (let sample = 0; sample < 12; sample += 1)
      fake.emitSensor(
        drawingCalibrationSensorFrame(
          corners[sample % corners.length]!,
          openPinchRatio,
          openDrawingClutchRatio,
          startedAt + 500 + sample * 16,
          trackId,
          handedness,
        ),
      );
  });
  await user.click(
    screen.getByRole("button", { name: "Continue to open hand" }),
  );
  act(() => {
    for (let sample = 0; sample < 8; sample += 1)
      fake.emitSensor(
        drawingCalibrationSensorFrame(
          { x: 0.5, y: 0.5 },
          openPinchRatio,
          openDrawingClutchRatio,
          startedAt + 1_000 + sample * 16,
          trackId,
          handedness,
        ),
      );
  });
  await user.click(
    screen.getByRole("button", { name: "Continue to closed pinch" }),
  );
  act(() => {
    for (let sample = 0; sample < 8; sample += 1)
      fake.emitSensor(
        drawingCalibrationSensorFrame(
          { x: 0.5, y: 0.5 },
          closedPinchRatio,
          openDrawingClutchRatio,
          startedAt + 1_500 + sample * 16,
          trackId,
          handedness,
        ),
      );
  });
  await user.click(
    screen.getByRole("button", { name: "Continue to drawing clutch" }),
  );
  act(() => {
    for (let sample = 0; sample < 8; sample += 1)
      fake.emitSensor(
        drawingCalibrationSensorFrame(
          { x: 0.5, y: 0.5 },
          openPinchRatio,
          closedDrawingClutchRatio,
          startedAt + 2_000 + sample * 16,
          trackId,
          handedness,
        ),
      );
  });
  await user.click(
    screen.getByRole("button", { name: "Review hand calibration" }),
  );
}

async function establishOpenPalmBaseline(
  user: ReturnType<typeof userEvent.setup>,
  fake: ReturnType<typeof fakeController>,
  startedAt = 4_000,
  openPinchRatio = 0.7,
) {
  act(() => {
    for (let sample = 0; sample < 6; sample += 1) {
      const pointer = { x: 0.5 + (sample % 2) * 0.004, y: 0.5 };
      const timestamp = startedAt + sample * 16;
      fake.emitSensor(
        calibrationSensorFrame(
          pointer,
          openPinchRatio,
          timestamp,
          "calibration-hand",
          openPalmLandmarks(),
        ),
      );
      fake.emit(
        calibrationObservation("open_palm", pointer, openPinchRatio, timestamp),
      );
    }
  });
  await user.click(
    screen.getByRole("button", { name: "Continue to reach mapping" }),
  );
}

async function advanceToClosedPinch(
  user: ReturnType<typeof userEvent.setup>,
  fake: ReturnType<typeof fakeController>,
  startedAt: number,
  openRatios: readonly number[] = [0.7, 0.7, 0.7, 0.7, 0.7, 0.7],
) {
  await establishOpenPalmBaseline(user, fake, startedAt);
  const corners = [
    { x: 0.36, y: 0.34 },
    { x: 0.64, y: 0.34 },
    { x: 0.36, y: 0.66 },
    { x: 0.64, y: 0.66 },
  ];
  act(() => {
    for (let sample = 0; sample < 12; sample += 1)
      fake.emitSensor(
        calibrationSensorFrame(
          corners[sample % corners.length]!,
          0.7,
          startedAt + 500 + sample * 16,
        ),
      );
  });
  await user.click(
    screen.getByRole("button", { name: "Continue to open hand" }),
  );
  act(() => {
    openRatios.forEach((ratio, sample) =>
      fake.emitSensor(
        calibrationSensorFrame(
          { x: 0.5, y: 0.5 },
          ratio,
          startedAt + 1_000 + sample * 16,
        ),
      ),
    );
  });
  await user.click(
    screen.getByRole("button", { name: "Continue to closed pinch" }),
  );
}

describe("SpatialCameraControl", () => {
  it("keeps a legacy calibration profile and labels its drawing clutch provisional", () => {
    const fake = fakeController();
    render(
      <SpatialCameraControl
        calibrationKind="calibrated"
        calibrationProfile={{
          deviceKey: "legacy-camera",
          cameraBounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
          safeCanvasInsetPx: 24,
          pinchClosedRatio: 0.22,
          pinchOpenRatio: 0.72,
          mirrorX: true,
          createdAt: 1,
        }}
        createController={() => fake.controller}
      />,
    );

    expect(
      screen.getByText(
        "Calibrated for this camera session · drawing clutch provisional",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /left hand: pinch provisional, drawing clutch provisional.*right hand: pinch provisional, drawing clutch provisional/i,
      ),
    ).toBeVisible();
  });

  it("requires a stable whole open hand before point reach and pinch calibration", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));

    expect(
      screen.getByText(/scanning open hand — 0\/6 stable frames/i),
    ).toBeVisible();
    const next = screen.getByRole("button", {
      name: "Continue to reach mapping",
    });
    expect(next).toBeDisabled();
    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emit(
          calibrationObservation(
            "point",
            { x: 0.5, y: 0.5 },
            0.7,
            3_000 + sample * 16,
          ),
        );
    });
    expect(next).toBeDisabled();

    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emit(
          calibrationObservation(
            "open_palm",
            { x: sample % 2 === 0 ? 0.25 : 0.75, y: 0.5 },
            0.7,
            3_100 + sample * 16,
          ),
        );
    });
    expect(next).toBeDisabled();
    expect(screen.queryByText(/open-hand scan complete/i)).toBeNull();

    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emit(
          calibrationObservation(
            "open_palm",
            { x: 0.5 + (sample % 2) * 0.004, y: 0.5 },
            0.7,
            3_200 + sample * 16,
          ),
        );
    });
    expect(
      screen.getByText(/open-hand scan complete · 6 stable frames/i),
    ).toBeVisible();
    await user.click(next);
    expect(screen.getByText(/2 of 5 · map comfortable reach/i)).toBeVisible();
  });

  it("counts a co-emitted raw and semantic baseline inference only once", () => {
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    const next = screen.getByRole("button", {
      name: "Continue to reach mapping",
    });

    act(() => {
      for (let sample = 0; sample < 3; sample += 1) {
        const timestamp = 4_500 + sample * 16;
        const pointer = { x: 0.5 + (sample % 2) * 0.004, y: 0.5 };
        fake.emitSensor(
          calibrationSensorFrame(
            pointer,
            0.7,
            timestamp,
            "calibration-hand",
            openPalmLandmarks(),
          ),
        );
        fake.emit(calibrationObservation("open_palm", pointer, 0.7, timestamp));
      }
    });
    expect(next).toBeDisabled();

    act(() => {
      for (let sample = 3; sample < 6; sample += 1) {
        const timestamp = 4_500 + sample * 16;
        const pointer = { x: 0.5 + (sample % 2) * 0.004, y: 0.5 };
        fake.emitSensor(
          calibrationSensorFrame(
            pointer,
            0.7,
            timestamp,
            "calibration-hand",
            openPalmLandmarks(),
          ),
        );
        fake.emit(calibrationObservation("open_palm", pointer, 0.7, timestamp));
      }
    });
    expect(next).toBeEnabled();
  });

  it("does not mix calibration evidence from a reliably different hand", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 4_800);

    const corners = [
      { x: 0.36, y: 0.34 },
      { x: 0.64, y: 0.34 },
      { x: 0.36, y: 0.66 },
      { x: 0.64, y: 0.66 },
    ];
    act(() => {
      for (let sample = 0; sample < 12; sample += 1) {
        const otherHand = calibrationSensorFrame(
          corners[sample % corners.length]!,
          0.7,
          5_000 + sample * 16,
          "different-hand",
        );
        fake.emitSensor({
          ...otherHand,
          hands: [{ ...otherHand.hands[0]!, handedness: "left" }],
        });
      }
    });

    expect(
      screen.getByRole("button", { name: "Continue to open hand" }),
    ).toBeDisabled();
    expect(
      screen.getByText(/2 of 5 · map comfortable reach · 0 samples/i),
    ).toBeVisible();

    act(() => {
      for (let sample = 0; sample < 12; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            corners[sample % corners.length]!,
            0.7,
            5_500 + sample * 16,
            "calibration-hand",
          ),
        );
    });
    expect(
      screen.getByRole("button", { name: "Continue to open hand" }),
    ).toBeEnabled();
  });

  it("requires a visible opt-in before the private GPU controller can observe upload consent", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    const createController = vi.fn(
      (preferences: SpatialCameraControllerPreferences) => {
        void preferences;
        return fake.controller;
      },
    );
    render(
      <SpatialCameraControl
        createController={createController}
        privateGpuRelayAvailable
      />,
    );

    const consent = screen.getByRole("checkbox", {
      name: "Use private GPU hand tracking",
    });
    expect(consent).not.toBeChecked();
    expect(createController.mock.calls[0]?.[0]?.cameraUploadConsent()).toBe(
      false,
    );
    expect(fake.controller.start).not.toHaveBeenCalled();

    await user.click(consent);
    expect(consent).toBeChecked();
    expect(createController.mock.calls[0]?.[0]?.cameraUploadConsent()).toBe(
      true,
    );
    expect(
      screen.getByText(
        /bounded camera frames are uploaded only while hand input is active/i,
      ),
    ).toBeVisible();
  });

  it("restarts active tracking relay-first on opt-in and locally on opt-out", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    let preferences: SpatialCameraControllerPreferences | undefined;
    render(
      <SpatialCameraControl
        createController={(next) => {
          preferences = next;
          return fake.controller;
        }}
        privateGpuRelayAvailable
      />,
    );
    const consent = screen.getByRole("checkbox", {
      name: "Use private GPU hand tracking",
    });
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));

    await user.click(consent);
    expect(preferences?.cameraUploadConsent()).toBe(true);
    expect(fake.controller.stop).toHaveBeenCalledOnce();
    expect(fake.controller.start).toHaveBeenCalledTimes(2);
    act(() => fake.setStatus({ state: "starting" }));
    expect(await screen.findByText("Connecting to private GPU…")).toBeVisible();

    act(() => {
      fake.setEngine({
        id: "private-gpu-hand-relay-v1",
        displayName: "Private GPU Hand Relay",
        runtime: "private-hand-relay",
        fallback: false,
        processingLocation: "private-relay",
      });
      fake.setStatus({ state: "ready" });
    });
    await user.click(consent);
    expect(consent).not.toBeChecked();
    expect(preferences?.cameraUploadConsent()).toBe(false);
    expect(fake.controller.stop).toHaveBeenCalledTimes(2);
    expect(fake.controller.start).toHaveBeenCalledTimes(3);
    act(() => fake.setStatus({ state: "starting" }));
    expect(
      await screen.findByText("Starting local hand tracking…"),
    ).toBeVisible();
  });

  it("stops an active camera exactly once when pagehide and visibility cleanup overlap", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    const { unmount } = render(
      <SpatialCameraControl createController={() => fake.controller} />,
    );

    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fake.controller.stop).toHaveBeenCalledOnce();
    unmount();
    expect(fake.controller.stop).toHaveBeenCalledOnce();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  it("resumes an active hand session after hidden to visible and restores canvas observations", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    const onObservation = vi.fn();
    render(
      <SpatialCameraControl
        createController={() => fake.controller}
        onObservation={onObservation}
      />,
    );

    try {
      await user.click(
        screen.getByRole("button", { name: "Enable hand input" }),
      );
      act(() => fake.setStatus({ state: "ready" }));
      act(() =>
        fake.emit({
          mode: "point",
          pointer: { x: 0.25, y: 0.4 },
          confidence: 0.96,
          timestamp: 1_000,
        }),
      );
      expect(onObservation).toHaveBeenCalledOnce();

      act(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        fake.setStatus({ state: "off" });
      });
      expect(fake.controller.stop).toHaveBeenCalledOnce();

      act(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(fake.controller.start).toHaveBeenCalledTimes(2);

      act(() => fake.setStatus({ state: "ready" }));
      act(() =>
        fake.emit({
          mode: "point",
          pointer: { x: 0.7, y: 0.55 },
          confidence: 0.97,
          timestamp: 2_000,
        }),
      );
      expect(onObservation).toHaveBeenCalledTimes(2);
      expect(onObservation).toHaveBeenLastCalledWith(
        expect.objectContaining({ timestamp: 2_000 }),
      );
    } finally {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
    }
  });

  it("coalesces overlapping mobile lifecycle events into one stop and one restart", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);

    try {
      await user.click(
        screen.getByRole("button", { name: "Enable hand input" }),
      );
      act(() => fake.setStatus({ state: "ready" }));

      act(() => {
        window.dispatchEvent(new Event("pagehide"));
        window.dispatchEvent(new Event("pagehide"));
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        fake.setStatus({ state: "off" });
      });
      expect(fake.controller.stop).toHaveBeenCalledOnce();

      act(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        window.dispatchEvent(new Event("pageshow"));
        fake.setStatus({ state: "starting" });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pageshow"));
        window.dispatchEvent(new Event("pageshow"));
      });

      expect(fake.controller.start).toHaveBeenCalledTimes(2);
      expect(fake.controller.stop).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
    }
  });

  it("does not reopen the camera after the user explicitly disables hand input", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);

    try {
      await user.click(
        screen.getByRole("button", { name: "Enable hand input" }),
      );
      act(() => fake.setStatus({ state: "ready" }));
      await user.click(
        screen.getByRole("button", { name: "Disable hand input" }),
      );
      act(() => fake.setStatus({ state: "off" }));

      act(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pagehide"));
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("pageshow"));
      });

      expect(fake.controller.start).toHaveBeenCalledOnce();
      expect(fake.controller.stop).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
    }
  });

  it("makes the mobile sensor preview visible after lifecycle recovery", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(max-width: 720px)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      })),
    );
    const user = userEvent.setup();
    const fake = fakeController();
    const { container } = render(
      <SpatialCameraControl createController={() => fake.controller} />,
    );

    try {
      await user.click(
        screen.getByRole("button", { name: "Enable hand input" }),
      );
      act(() => fake.setStatus({ state: "ready" }));
      await user.click(
        screen.getByRole("button", { name: "Hide hand sensor preview" }),
      );
      expect(container.querySelector(".spatial-camera-control")).toHaveClass(
        "is-sensor-pip-hidden",
      );

      act(() => {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        fake.setStatus({ state: "off" });
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        fake.setStatus({ state: "ready" });
      });

      expect(
        container.querySelector(".spatial-camera-control"),
      ).not.toHaveClass("is-sensor-pip-hidden");
      expect(
        screen.getByRole("button", { name: "Hide hand sensor preview" }),
      ).toBeVisible();
    } finally {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      vi.unstubAllGlobals();
    }
  });

  it("labels the actual private relay provider, device, processing latency, and transit latency", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    render(
      <SpatialCameraControl
        createController={() => fake.controller}
        privateGpuRelayAvailable
      />,
    );

    act(() => {
      fake.setEngine({
        id: "private-gpu-hand-relay-v1",
        displayName: "Private GPU Hand Relay",
        runtime: "private-hand-relay",
        fallback: false,
        executionProvider: "cuda",
        processingLocation: "private-relay",
        highPerformanceGpuRequested: false,
        adapter: { description: "NVIDIA GeForce RTX 3090 Ti" },
        processingLatencyMs: 24,
        detectorRoundTripMs: 61,
        encodeLatencyMs: 8,
        relayRoundTripMs: 42,
        droppedBeforeEncode: 2,
        droppedBeforeSend: 0,
        runtimeSamples: 4,
        runtimeMetrics: {
          sampleCount: 12,
          deliveredRateHz: 18.4,
          captureLatencyMs: { p50: 4, p95: 7 },
          processingLatencyMs: { p50: 18, p95: 24 },
          encodeLatencyMs: { p50: 6, p95: 8 },
          relayLatencyMs: { p50: 31, p95: 42 },
          captureToReceiveMs: { p50: 54, p95: 61 },
          captureToRenderMs: null,
          droppedSuperseded: 0,
          droppedLateCapture: 0,
          droppedStale: 0,
          droppedBeforeEncode: 2,
          droppedBeforeSend: 0,
        },
      });
      fake.setStatus({ state: "ready" });
    });

    expect(
      await screen.findByText("Hand input ready · private GPU relay"),
    ).toBeVisible();
    expect(
      screen.getByText("Private GPU · CUDA · 18.4 Hz · p95 61 ms · dropped 2"),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Show hand tracking details" }),
    );
    expect(
      screen.getByText("Provider CUDA · NVIDIA GeForce RTX 3090 Ti"),
    ).toBeVisible();
    expect(
      screen.getByText(
        "24 ms GPU processing · 61 ms capture/result round trip",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        "8 ms encode · 42 ms relay round trip · dropped 2 raw / 0 encoded",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/high-performance webgpu adapter requested/i),
    ).toBeNull();
  });

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
    render(<SpatialCameraControl createController={() => fake.controller} />);

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

    act(() => fake.setStatus({ state: "ready" }));
    expect(
      await screen.findByText("Hand input ready · local only"),
    ).toBeVisible();
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

    await user.click(
      screen.getByRole("button", { name: "Disable hand input" }),
    );
    expect(fake.controller.stop).toHaveBeenCalledOnce();
  });

  it("visibly identifies YOLO as primary and labels a runtime fallback", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);

    act(() => {
      fake.setEngine({
        id: "yolo26-hand-pose-2abb91",
        displayName: "YOLO26 Hand Pose",
        runtime: "onnx-runtime-web",
        fallback: false,
        executionProvider: "webgpu",
        highPerformanceGpuRequested: true,
        adapter: { architecture: "ampere", description: "NVIDIA GPU" },
        detectorRoundTripMs: 69.01,
        resultRateFps: 14.49,
        runtimeSamples: 12,
      });
      fake.setStatus({ state: "ready" });
    });
    await user.click(
      screen.getByRole("button", { name: "Show hand tracking details" }),
    );
    expect(await screen.findByText("Engine YOLO26 Hand Pose")).toBeVisible();
    expect(screen.getByText("Provider WebGPU · NVIDIA GPU")).toBeVisible();
    expect(
      screen.getByText("High-performance WebGPU adapter requested"),
    ).toBeVisible();
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

  it("shows one compact truthful runtime chip and acknowledges the rendered camera result", async () => {
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);

    act(() => {
      fake.setEngine({
        id: "yolo26-hand-pose-2abb91",
        displayName: "YOLO26 Hand Pose",
        runtime: "onnx-runtime-web",
        fallback: false,
        executionProvider: "webgpu",
        runtimeMetrics: {
          sampleCount: 12,
          deliveredRateHz: 24.1,
          captureLatencyMs: { p50: 4, p95: 7 },
          processingLatencyMs: { p50: 18, p95: 31 },
          encodeLatencyMs: null,
          relayLatencyMs: null,
          captureToReceiveMs: { p50: 55, p95: 71 },
          captureToRenderMs: null,
          droppedSuperseded: 1,
          droppedLateCapture: 0,
          droppedStale: 1,
          droppedBeforeEncode: 0,
          droppedBeforeSend: 0,
        },
      });
      fake.setStatus({ state: "ready" });
      fake.emit({
        mode: "point",
        pointer: { x: 0.4, y: 0.5 },
        confidence: 0.94,
        capturedAt: 333,
        timestamp: 333,
      });
    });

    expect(
      await screen.findByText(
        "YOLO26 · WebGPU · 24.1 Hz · p95 71 ms · dropped 2",
      ),
    ).toBeVisible();
    await vi.waitFor(() =>
      expect(fake.controller.acknowledgeRendered).toHaveBeenCalledWith(333),
    );
  });

  it("keeps technical diagnostics off the default surface and exposes them through an accessible disclosure", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);

    act(() => {
      fake.setEngine({
        id: "yolo26-hand-pose-2abb91",
        displayName: "YOLO26 Hand Pose",
        runtime: "onnx-runtime-web",
        fallback: false,
        executionProvider: "webgpu",
        fallbackReason: "Measured fallback detail",
        runtimeMetrics: {
          sampleCount: 12,
          deliveredRateHz: 24.1,
          captureLatencyMs: { p50: 4, p95: 7 },
          processingLatencyMs: { p50: 18, p95: 31 },
          encodeLatencyMs: null,
          relayLatencyMs: null,
          captureToReceiveMs: { p50: 55, p95: 71 },
          captureToRenderMs: null,
          droppedSuperseded: 0,
          droppedLateCapture: 0,
          droppedStale: 0,
          droppedBeforeEncode: 0,
          droppedBeforeSend: 0,
        },
      });
      fake.setStatus({ state: "ready" });
    });

    expect(
      await screen.findByText(
        "YOLO26 · WebGPU · 24.1 Hz · p95 71 ms · dropped 0",
      ),
    ).toBeVisible();
    const disclosure = screen.getByRole("button", {
      name: "Show hand tracking details",
    });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Engine YOLO26 Hand Pose")).toBeNull();
    expect(screen.queryByText("Provider WebGPU")).toBeNull();
    expect(screen.queryByText(/Measured fallback detail/)).toBeNull();
    expect(screen.queryByLabelText("Gesture self-check")).toBeNull();

    await user.click(disclosure);

    expect(
      screen.getByRole("button", { name: "Hide hand tracking details" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Engine YOLO26 Hand Pose")).toBeVisible();
    expect(screen.getByText("Provider WebGPU")).toBeVisible();
    expect(
      screen.getByText("WebGPU fallback · Measured fallback detail"),
    ).toBeVisible();
    expect(screen.getByLabelText("Gesture self-check")).toBeVisible();
  });

  it("distinguishes a high-performance WebGPU request from the actual WASM fallback", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);

    act(() => {
      fake.setEngine({
        id: "yolo26-hand-pose-2abb91",
        displayName: "YOLO26 Hand Pose",
        runtime: "onnx-runtime-web",
        fallback: false,
        executionProvider: "wasm",
        highPerformanceGpuRequested: true,
        fallbackReason: "WebGPU did not return a GPU adapter",
      });
      fake.setStatus({ state: "ready" });
    });

    await user.click(
      screen.getByRole("button", { name: "Show hand tracking details" }),
    );
    expect(await screen.findByText("Provider WASM")).toBeVisible();
    expect(
      screen.getByText("High-performance WebGPU adapter requested"),
    ).toBeVisible();
    expect(
      screen.getByText("WebGPU fallback · WebGPU did not return a GPU adapter"),
    ).toBeVisible();
    expect(screen.queryByText(/3090/i)).toBeNull();
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
    const user = userEvent.setup();
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);

    act(() => fake.setStatus({ state: "ready" }));
    await user.click(
      screen.getByRole("button", { name: "Show hand tracking details" }),
    );
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

  it("opens a temporary calibration view and returns to the full canvas", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    const onSpatialModeStarted = vi.fn();
    const onObservation = vi.fn();
    const { container } = render(
      <SpatialCameraControl
        createController={() => fake.controller}
        onObservation={onObservation}
        onSpatialModeStarted={onSpatialModeStarted}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));
    onSpatialModeStarted.mockClear();

    await user.click(
      screen.getByRole("button", { name: "Open hand calibration" }),
    );
    expect(container.querySelector(".spatial-camera-control")).toHaveClass(
      "is-expanded",
    );
    expect(
      screen.getByRole("button", { name: "Close hand calibration" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Calibration view only")).toBeVisible();
    expect(
      screen.getByText(
        "Return to the canvas to move, draw, resize, or throw objects.",
      ),
    ).toBeVisible();

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
    expect(
      container.querySelectorAll("[data-tracked-hand-pointer]"),
    ).toHaveLength(1);
    expect(container.querySelectorAll("[data-hand-keypoint]")).toHaveLength(21);
    expect(container.querySelectorAll("[data-hand-connection]")).toHaveLength(
      21,
    );
    await user.click(
      screen.getByRole("button", { name: "Show hand tracking details" }),
    );
    expect(screen.getByText("Pinch distance 0.120")).toBeVisible();
    expect(screen.getByText("21-point hand landmarks")).toBeVisible();
    expect(screen.getByText("Confidence 91%")).toBeVisible();
    expect(screen.getByText("left hand")).toBeVisible();
    expect(screen.getByText("State point")).toBeVisible();
    expect(onObservation).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Return to full canvas" }),
    );
    expect(container.querySelector(".spatial-camera-control")).not.toHaveClass(
      "is-expanded",
    );
    expect(onSpatialModeStarted).toHaveBeenCalledOnce();
    expect(fake.controller.stop).not.toHaveBeenCalled();

    act(() =>
      fake.emit({
        mode: "idle",
        timestamp: 1_020,
      }),
    );
    expect(onObservation).toHaveBeenCalledWith({
      mode: "idle",
      timestamp: 1_020,
    });
  });

  it("uses a full-canvas calibration overlay then a draggable hideable sensor PiP", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    const onObservation = vi.fn();
    const { container } = render(
      <SpatialCameraControl
        createController={() => fake.controller}
        onObservation={onObservation}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));
    await user.click(
      screen.getByRole("button", { name: "Open hand calibration" }),
    );

    expect(container.querySelector(".spatial-camera-control")).toHaveClass(
      "is-calibrating-full-canvas",
    );
    await user.click(
      screen.getByRole("button", { name: "Return to full canvas" }),
    );
    const control = container.querySelector<HTMLElement>(
      ".spatial-camera-control",
    );
    expect(control).toHaveClass("is-sensor-pip");

    act(() =>
      fake.emit({
        mode: "point",
        pointer: { x: 0.3, y: 0.4 },
        confidence: 0.95,
        timestamp: 4_000,
      }),
    );
    expect(onObservation).toHaveBeenCalledOnce();

    const workspace = control?.parentElement as HTMLElement;
    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1_000,
      bottom: 800,
      width: 1_000,
      height: 800,
      toJSON: () => ({}),
    });
    vi.spyOn(control!, "getBoundingClientRect").mockReturnValue({
      x: 120,
      y: 100,
      left: 120,
      top: 100,
      right: 360,
      bottom: 300,
      width: 240,
      height: 200,
      toJSON: () => ({}),
    });
    const drag = screen.getByRole("button", {
      name: "Move hand sensor preview",
    });
    fireEvent.pointerDown(drag, { pointerId: 8, clientX: 40, clientY: 40 });
    fireEvent.pointerMove(drag, { pointerId: 8, clientX: 100, clientY: 120 });
    fireEvent.pointerUp(drag, { pointerId: 8, clientX: 100, clientY: 120 });
    expect(control?.style.getPropertyValue("--sensor-pip-x")).toBe("60px");
    expect(control?.style.getPropertyValue("--sensor-pip-y")).toBe("80px");

    await user.click(
      screen.getByRole("button", { name: "Hide hand sensor preview" }),
    );
    expect(control).toHaveClass("is-sensor-pip-hidden");
    expect(
      screen.getByRole("button", { name: "Show hand sensor preview" }),
    ).toBeVisible();
  });

  it("renders both raw sensor hands in the PiP even when semantic arbitration emits one", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    const { container } = render(
      <SpatialCameraControl createController={() => fake.controller} />,
    );
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));
    const left = calibrationSensorFrame(
      { x: 0.3, y: 0.4 },
      0.7,
      4_200,
      "left-track",
      trackedLandmarks(),
      "sensor-test",
      0.99,
      "left",
    );
    const right = calibrationSensorFrame(
      { x: 0.7, y: 0.4 },
      0.7,
      4_200,
      "right-track",
      trackedLandmarks(),
      "sensor-test",
      0.99,
      "right",
    );

    act(() => {
      fake.emit({
        mode: "point",
        pointer: { x: 0.3, y: 0.4 },
        confidence: 0.97,
        trackId: "left-track",
        landmarks: trackedLandmarks(),
        timestamp: 4_200,
      });
      fake.emitSensor({
        ...left,
        hands: [left.hands[0]!, right.hands[0]!],
      });
    });

    expect(container.querySelectorAll("[data-hand-skeleton]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-hand-keypoint]")).toHaveLength(42);
  });

  it("keeps the mobile sensor PiP visible after calibration and lets the user hide it", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(max-width: 720px)",
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      })),
    );
    try {
      const user = userEvent.setup();
      const fake = fakeController();
      const { container } = render(
        <SpatialCameraControl createController={() => fake.controller} />,
      );

      await user.click(
        screen.getByRole("button", { name: "Enable hand input" }),
      );
      act(() => fake.setStatus({ state: "ready" }));

      expect(
        container.querySelector(".spatial-camera-control"),
      ).not.toHaveClass("is-sensor-pip-hidden");
      expect(
        screen.getByRole("button", { name: "Hide hand sensor preview" }),
      ).toBeVisible();
      await user.click(
        screen.getByRole("button", { name: "Hide hand sensor preview" }),
      );
      expect(container.querySelector(".spatial-camera-control")).toHaveClass(
        "is-sensor-pip-hidden",
      );
      expect(
        screen.getByRole("button", { name: "Show hand sensor preview" }),
      ).toBeVisible();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("collects reach and open/closed pinch evidence into a retained device profile", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    const results: SpatialCalibrationResult[] = [];
    render(
      <SpatialCameraControl
        createController={() => fake.controller}
        calibrationDeviceKey="iphone-front-camera"
        onCalibrationResult={(result) => results.push(result)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));
    expect(
      screen.getByRole("button", { name: "Skip hand calibration" }),
    ).toBeVisible();
    await establishOpenPalmBaseline(user, fake, 4_700);

    const reach = [
      { x: 0.18, y: 0.16 },
      { x: 0.82, y: 0.16 },
      { x: 0.18, y: 0.82 },
      { x: 0.82, y: 0.82 },
    ];
    act(() => {
      for (let repeat = 0; repeat < 12; repeat += 1) {
        const pointer = reach[repeat % reach.length]!;
        fake.emit(
          calibrationObservation("point", pointer, 0.72, 5_000 + repeat * 16),
        );
      }
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to open hand" }),
    );
    act(() => {
      for (let repeat = 0; repeat < 8; repeat += 1) {
        const pointer = reach[repeat % reach.length]!;
        fake.emit(
          calibrationObservation("point", pointer, 0.72, 5_200 + repeat * 16),
        );
      }
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to closed pinch" }),
    );
    act(() => {
      for (let repeat = 0; repeat < 8; repeat += 1) {
        const pointer = reach[repeat % reach.length]!;
        fake.emit(
          calibrationObservation("pinch", pointer, 0.22, 5_400 + repeat * 16),
        );
      }
    });

    expect(screen.getByText(/12 reach · 8 open · 8 closed/i)).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Review hand calibration" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Use hand calibration" }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      accepted: true,
      profile: {
        deviceKey: "iphone-front-camera",
        pinchClosedRatio: 0.22,
        pinchOpenRatio: 0.72,
      },
    });
    expect(
      screen.getByText(/calibrated for this camera session/i),
    ).toBeVisible();
  });

  it("calibrates thumb-middle drawing clutch separately from thumb-index pinch", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    const results: SpatialCalibrationResult[] = [];
    const view = render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        calibrationDeviceKey="drawing-camera"
        onCalibrationOpenChange={() => undefined}
        onCalibrationResult={(result) => results.push(result)}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 70_000);

    const corners = [
      { x: 0.36, y: 0.34 },
      { x: 0.64, y: 0.34 },
      { x: 0.36, y: 0.66 },
      { x: 0.64, y: 0.66 },
    ];
    act(() => {
      for (let sample = 0; sample < 12; sample += 1)
        fake.emitSensor(
          drawingCalibrationSensorFrame(
            corners[sample % corners.length]!,
            0.7,
            0.82,
            71_000 + sample * 16,
          ),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to open hand" }),
    );
    act(() => {
      for (let sample = 0; sample < 8; sample += 1)
        fake.emitSensor(
          drawingCalibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.72,
            0.82,
            72_000 + sample * 16,
          ),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to closed pinch" }),
    );
    act(() => {
      for (let sample = 0; sample < 8; sample += 1)
        fake.emitSensor(
          drawingCalibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.22,
            0.82,
            73_000 + sample * 16,
          ),
        );
    });

    expect(
      screen.queryByRole("button", { name: "Review hand calibration" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Continue to drawing clutch" }),
    );
    expect(
      screen.getByText(/touch thumb and middle.*index finger extended/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Use provisional drawing clutch" }),
    ).toBeVisible();
    act(() => {
      for (let sample = 0; sample < 8; sample += 1)
        fake.emitSensor(
          drawingCalibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.72,
            0.24,
            74_000 + sample * 16,
          ),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Review hand calibration" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Use hand calibration" }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      accepted: true,
      profile: {
        pinchClosedRatio: 0.22,
        pinchOpenRatio: 0.72,
        drawingClutchCalibrations: [
          {
            trackId: "calibration-hand",
            handedness: "right",
            closedRatio: 0.24,
            openRatio: 0.82,
            openSampleCount: 8,
            closedSampleCount: 8,
          },
        ],
      },
    });
    view.rerender(
      <SpatialCameraControl
        calibrationOpen={false}
        createController={() => fake.controller}
        calibrationDeviceKey="drawing-camera"
        onCalibrationOpenChange={() => undefined}
        onCalibrationResult={(result) => results.push(result)}
      />,
    );
    expect(
      screen.getByText(
        /calibrated for this camera session.*drawing clutch measured for this hand/i,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /left hand: pinch provisional, drawing clutch provisional.*right hand: pinch measured, drawing clutch measured/i,
      ),
    ).toBeVisible();
  });

  it("offers other-hand calibration without removing single-hand acceptance", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        calibrationDeviceKey="two-hand-camera"
        onCalibrationOpenChange={() => undefined}
        onCalibrationResult={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await completeMeasuredHandCalibrationToReview(user, fake, {
      startedAt: 80_000,
      trackId: "right-hand-track",
      handedness: "right",
    });

    expect(
      screen.getByRole("button", { name: "Use hand calibration" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Calibrate other hand" }),
    ).toBeEnabled();
  });

  it("starts an independent pass and refuses to count the already measured hand", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    const results: SpatialCalibrationResult[] = [];
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        calibrationDeviceKey="two-hand-camera"
        onCalibrationOpenChange={() => undefined}
        onCalibrationResult={(result) => results.push(result)}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await completeMeasuredHandCalibrationToReview(user, fake, {
      startedAt: 90_000,
      trackId: "right-hand-track",
      handedness: "right",
    });

    await user.click(
      screen.getByRole("button", { name: "Calibrate other hand" }),
    );
    // The public completion callback retains its existing once-per-accepted-flow
    // semantics. The first hand is retained internally until the user accepts
    // the final one- or two-hand profile.
    expect(results).toHaveLength(0);
    expect(
      screen.getByText(/right hand: pinch measured, drawing clutch measured/i),
    ).toBeVisible();
    expect(screen.getByText(/1 of 5 · scanning open hand/i)).toBeVisible();

    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5 + (sample % 2) * 0.004, y: 0.5 },
            0.72,
            93_000 + sample * 16,
            "right-hand-reacquired",
            openPalmLandmarks(),
            "calibration-test",
            0.99,
            "right",
          ),
        );
    });
    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5 + (sample % 2) * 0.004, y: 0.5 },
            0.72,
            94_000 + sample * 16,
            "right-hand-track",
            openPalmLandmarks(),
            "calibration-test",
            0.99,
            "left",
          ),
        );
    });
    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5 + (sample % 2) * 0.004, y: 0.5 },
            0.72,
            95_000 + sample * 16,
            "unreliable-left-track",
            openPalmLandmarks(),
            "calibration-test",
            0.42,
            "left",
          ),
        );
    });

    expect(screen.getByText(/scanning open hand — 0\/6/i)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /show your other hand.*left/i,
    );
  });

  it("accepts one unambiguous opposite hand while the completed hand remains visible", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        calibrationDeviceKey="two-hand-camera"
        onCalibrationOpenChange={() => undefined}
        onCalibrationResult={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await completeMeasuredHandCalibrationToReview(user, fake, {
      startedAt: 96_000,
      trackId: "right-hand-track",
      handedness: "right",
    });
    await user.click(
      screen.getByRole("button", { name: "Calibrate other hand" }),
    );

    act(() => {
      for (let sample = 0; sample < 6; sample += 1) {
        const completed = calibrationSensorFrame(
          { x: 0.64, y: 0.5 },
          0.72,
          99_000 + sample * 16,
          "right-hand-track",
          openPalmLandmarks(),
          "calibration-test",
          0.99,
          "right",
        );
        const opposite = calibrationSensorFrame(
          { x: 0.36 + (sample % 2) * 0.004, y: 0.5 },
          0.72,
          99_000 + sample * 16,
          "left-hand-track",
          openPalmLandmarks(),
          "calibration-test",
          0.99,
          "left",
        );
        fake.emitSensor({
          ...opposite,
          hands: [completed.hands[0]!, opposite.hands[0]!],
        });
      }
    });

    expect(
      screen.getByRole("button", { name: "Continue to reach mapping" }),
    ).toBeEnabled();
    expect(screen.getByText(/open-hand scan complete · 6 stable frames/i)).toBeVisible();
  });

  it("merges independently measured opposite-hand pinch and drawing calibration", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    const results: SpatialCalibrationResult[] = [];
    const renderControl = (calibrationOpen: boolean) => (
      <SpatialCameraControl
        calibrationOpen={calibrationOpen}
        createController={() => fake.controller}
        calibrationDeviceKey="two-hand-camera"
        onCalibrationOpenChange={() => undefined}
        onCalibrationResult={(result) => results.push(result)}
      />
    );
    const view = render(renderControl(true));
    act(() => fake.setStatus({ state: "ready" }));
    await completeMeasuredHandCalibrationToReview(user, fake, {
      startedAt: 100_000,
      trackId: "right-hand-track",
      handedness: "right",
      openPinchRatio: 0.72,
      closedPinchRatio: 0.22,
      openDrawingClutchRatio: 0.82,
      closedDrawingClutchRatio: 0.24,
    });
    await user.click(
      screen.getByRole("button", { name: "Calibrate other hand" }),
    );
    await completeMeasuredHandCalibrationToReview(user, fake, {
      startedAt: 110_000,
      trackId: "left-hand-track",
      handedness: "left",
      openPinchRatio: 0.76,
      closedPinchRatio: 0.26,
      openDrawingClutchRatio: 0.86,
      closedDrawingClutchRatio: 0.28,
    });
    act(() =>
      fake.emitSensor(
        calibrationSensorFrame(
          { x: 0.5, y: 0.5 },
          0.76,
          113_000,
          "left-hand-track",
          trackedLandmarks(),
          "calibration-test",
          0.99,
          "right",
        ),
      ),
    );

    expect(
      screen.queryByRole("button", { name: "Calibrate other hand" }),
    ).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Use hand calibration" }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      accepted: true,
      profile: {
        pinchClosedRatio: 0.22,
        pinchOpenRatio: 0.72,
        pinchCalibrations: [
          {
            trackId: "right-hand-track",
            handedness: "right",
            closedRatio: 0.22,
            openRatio: 0.72,
          },
          {
            trackId: "left-hand-track",
            handedness: "left",
            closedRatio: 0.26,
            openRatio: 0.76,
          },
        ],
        drawingClutchCalibrations: [
          {
            trackId: "right-hand-track",
            handedness: "right",
            closedRatio: 0.24,
            openRatio: 0.82,
          },
          {
            trackId: "left-hand-track",
            handedness: "left",
            closedRatio: 0.28,
            openRatio: 0.86,
          },
        ],
        reachCalibrations: [
          {
            trackId: "right-hand-track",
            handedness: "right",
            cameraBounds: expect.any(Object),
          },
          {
            trackId: "left-hand-track",
            handedness: "left",
            cameraBounds: expect.any(Object),
          },
        ],
      },
    });
    view.rerender(renderControl(false));
    expect(
      screen.getByText(
        /left hand: pinch measured, drawing clutch measured.*right hand: pinch measured, drawing clutch measured/i,
      ),
    ).toBeVisible();
  });

  it("keeps the accepted first hand when the optional second pass is abandoned", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    const results: SpatialCalibrationResult[] = [];
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        calibrationDeviceKey="two-hand-camera"
        onCalibrationOpenChange={() => undefined}
        onCalibrationResult={(result) => results.push(result)}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await completeMeasuredHandCalibrationToReview(user, fake, {
      startedAt: 120_000,
      trackId: "right-hand-track",
      handedness: "right",
    });
    await user.click(
      screen.getByRole("button", { name: "Calibrate other hand" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Use first hand calibration" }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      accepted: true,
      profile: {
        pinchCalibrations: [
          { trackId: "right-hand-track", handedness: "right" },
        ],
        drawingClutchCalibrations: [
          { trackId: "right-hand-track", handedness: "right" },
        ],
      },
    });
  });

  it("rejects inadequate reach before asking for pinch poses", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 14_700);
    act(() => {
      for (let sample = 0; sample < 12; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.49 + (sample % 2) * 0.01, y: 0.49 + (sample % 2) * 0.01 },
            0.7,
            15_000 + sample * 16,
          ),
        );
    });

    const continueToOpen = screen.getByRole("button", {
      name: "Continue to open hand",
    });
    expect(continueToOpen).toBeDisabled();
    expect(screen.getByText(/2 of 5 · map comfortable reach/i)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Continue to closed pinch" }),
    ).toBeNull();

    const reach = [
      { x: 0.18, y: 0.16 },
      { x: 0.82, y: 0.16 },
      { x: 0.18, y: 0.82 },
      { x: 0.82, y: 0.82 },
    ];
    act(() => {
      for (let sample = 0; sample < 12; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            reach[sample % reach.length]!,
            0.7,
            15_500 + sample * 16,
          ),
        );
    });
    expect(continueToOpen).toBeEnabled();
  });

  it("calibrates a raw closed pinch above the default cutoff without erasing frozen reach", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    const results: SpatialCalibrationResult[] = [];
    render(
      <SpatialCameraControl
        createController={() => fake.controller}
        calibrationDeviceKey="iphone-front-camera"
        onCalibrationResult={(result) => results.push(result)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 19_700);

    const corners = [
      { x: 0.36, y: 0.34 },
      { x: 0.64, y: 0.34 },
      { x: 0.36, y: 0.66 },
      { x: 0.64, y: 0.66 },
    ];
    act(() => {
      for (let sample = 0; sample < 16; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            corners[sample % corners.length]!,
            0.7,
            20_000 + sample * 16,
          ),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to open hand" }),
    );

    act(() => {
      for (let sample = 0; sample < 40; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame({ x: 0.5, y: 0.5 }, 0.7, 21_000 + sample * 16),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to closed pinch" }),
    );

    act(() => {
      for (let sample = 0; sample < 40; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.34,
            22_000 + sample * 16,
          ),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Review hand calibration" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Use hand calibration" }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      accepted: true,
      profile: {
        deviceKey: "iphone-front-camera",
        pinchClosedRatio: 0.34,
        pinchOpenRatio: 0.7,
      },
    });
    expect(fake.controller.setPinchThresholds).toHaveBeenCalledWith({
      fallback: { engage: 0.43, release: 0.556 },
      byTrackId: {
        "calibration-hand": {
          engage: 0.43,
          release: 0.556,
          handedness: "right",
          handednessConfidence: 0.97,
        },
      },
      byHandedness: {
        right: { engage: 0.43, release: 0.556 },
      },
    });
    expect(
      screen.getByText(/calibrated for this camera session/i),
    ).toBeVisible();
  });

  it("does not learn a closed hand as the open-pinch calibration", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 20_700);

    const corners = [
      { x: 0.36, y: 0.34 },
      { x: 0.64, y: 0.34 },
      { x: 0.36, y: 0.66 },
      { x: 0.64, y: 0.66 },
    ];
    act(() => {
      for (let sample = 0; sample < 12; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            corners[sample % corners.length]!,
            0.7,
            21_000 + sample * 16,
          ),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to open hand" }),
    );

    const continueToClosed = screen.getByRole("button", {
      name: "Continue to closed pinch",
    });
    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame({ x: 0.5, y: 0.5 }, 2.4, 21_500 + sample * 16),
        );
    });
    expect(continueToClosed).toBeDisabled();

    act(() => {
      for (let sample = 0; sample < 12; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.22,
            22_000 + sample * 16,
          ),
        );
    });
    expect(continueToClosed).toBeDisabled();

    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame({ x: 0.5, y: 0.5 }, 0.7, 23_000 + sample * 16),
        );
    });
    expect(continueToClosed).toBeEnabled();
  });

  it("keeps open-pinch calibration relative to the accepted whole-hand baseline", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 23_700, 0.4);

    const corners = [
      { x: 0.36, y: 0.34 },
      { x: 0.64, y: 0.34 },
      { x: 0.36, y: 0.66 },
      { x: 0.64, y: 0.66 },
    ];
    act(() => {
      for (let sample = 0; sample < 12; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            corners[sample % corners.length]!,
            0.4,
            24_000 + sample * 16,
          ),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to open hand" }),
    );

    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.35,
            25_000 + sample * 16,
          ),
        );
    });
    expect(
      screen.getByRole("button", { name: "Continue to closed pinch" }),
    ).toBeEnabled();
  });

  it("waits for a stable closed pinch instead of learning the closing transition", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 22_700);
    const corners = [
      { x: 0.36, y: 0.34 },
      { x: 0.64, y: 0.34 },
      { x: 0.36, y: 0.66 },
      { x: 0.64, y: 0.66 },
    ];
    act(() => {
      for (let sample = 0; sample < 12; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            corners[sample % corners.length]!,
            0.7,
            23_000 + sample * 16,
          ),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to open hand" }),
    );
    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame({ x: 0.5, y: 0.5 }, 0.7, 24_000 + sample * 16),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to closed pinch" }),
    );
    act(() => {
      [0.63, 0.6, 0.57, 0.54, 0.51, 0.48].forEach((ratio, sample) =>
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            ratio,
            25_000 + sample * 16,
          ),
        ),
      );
    });

    expect(
      screen.getByRole("button", { name: "Review hand calibration" }),
    ).toBeDisabled();
    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.34,
            26_000 + sample * 16,
          ),
        );
    });
    expect(
      screen.getByRole("button", { name: "Review hand calibration" }),
    ).toBeEnabled();
  });

  it("does not bridge provisional closed-pinch evidence across loss, track replacement, or a long gap", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await advanceToClosedPinch(user, fake, 34_000);
    const review = screen.getByRole("button", {
      name: "Review hand calibration",
    });

    act(() => {
      for (let sample = 0; sample < 3; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.34,
            35_500 + sample * 16,
          ),
        );
      fake.emitSensor({
        ...calibrationSensorFrame({ x: 0.5, y: 0.5 }, 0.34, 35_600),
        hands: [],
      });
      for (let sample = 0; sample < 3; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.34,
            35_700 + sample * 16,
          ),
        );
    });
    expect(review).toBeDisabled();

    act(() => {
      for (let sample = 0; sample < 3; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.34,
            35_800 + sample * 16,
            "replacement-hand",
          ),
        );
    });
    expect(review).toBeDisabled();

    act(() => {
      for (let sample = 0; sample < 3; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.34,
            37_000 + sample * 16,
            "replacement-hand",
          ),
        );
    });
    expect(review).toBeDisabled();

    act(() => {
      for (let sample = 3; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.34,
            37_000 + sample * 16,
            "replacement-hand",
          ),
        );
    });
    expect(review).toBeEnabled();
  });

  it("restarts calibration when the active vision engine changes", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await advanceToClosedPinch(user, fake, 43_000);

    act(() =>
      fake.emitSensor(
        calibrationSensorFrame(
          { x: 0.5, y: 0.5 },
          0.34,
          44_500,
          "calibration-hand",
          trackedLandmarks(),
          "alternate-calibration-engine",
        ),
      ),
    );

    expect(screen.getByText(/1 of 5 · scanning open hand/i)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      /hand tracking switched engines/i,
    );
    expect(
      screen.queryByRole("button", { name: "Review hand calibration" }),
    ).toBeNull();
  });

  it("replaces a shallow partial-pinch plateau with the later pads-touch plateau", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    const results: SpatialCalibrationResult[] = [];
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
        onCalibrationResult={(result) => results.push(result)}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await advanceToClosedPinch(user, fake, 38_000);
    const review = screen.getByRole("button", {
      name: "Review hand calibration",
    });

    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.55,
            39_500 + sample * 16,
          ),
        );
    });
    expect(review).toBeEnabled();

    act(() =>
      fake.emitSensor(calibrationSensorFrame({ x: 0.5, y: 0.5 }, 0.34, 40_000)),
    );
    expect(review).toBeDisabled();
    act(() => {
      for (let sample = 1; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.34,
            40_000 + sample * 16,
          ),
        );
    });
    expect(review).toBeEnabled();
    await user.click(review);
    await user.click(
      screen.getByRole("button", { name: "Use hand calibration" }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      accepted: true,
      profile: { pinchClosedRatio: 0.34 },
    });
  });

  it("keeps accepted closed-pinch calibration ready after the user releases or leaves frame", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await advanceToClosedPinch(user, fake, 45_000);
    const review = screen.getByRole("button", {
      name: "Review hand calibration",
    });
    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.34,
            46_500 + sample * 16,
          ),
        );
    });
    expect(review).toBeEnabled();

    act(() =>
      fake.emitSensor({
        ...calibrationSensorFrame({ x: 0.5, y: 0.5 }, 0.34, 46_700),
        hands: [],
      }),
    );
    expect(review).toBeEnabled();

    act(() =>
      fake.emitSensor(calibrationSensorFrame({ x: 0.5, y: 0.5 }, 0.7, 46_900)),
    );
    expect(review).toBeEnabled();
  });

  it("uses a robust open range so one low open sample does not block a legitimate closed pinch", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await advanceToClosedPinch(
      user,
      fake,
      41_000,
      [0.53, 0.7, 0.7, 0.7, 0.7, 0.7],
    );

    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame({ x: 0.5, y: 0.5 }, 0.5, 42_500 + sample * 16),
        );
    });
    expect(
      screen.getByRole("button", { name: "Review hand calibration" }),
    ).toBeEnabled();
  });

  it("keeps closed-pinch evidence below the lowest accepted open range", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 26_700);
    const corners = [
      { x: 0.36, y: 0.34 },
      { x: 0.64, y: 0.34 },
      { x: 0.36, y: 0.66 },
      { x: 0.64, y: 0.66 },
    ];
    act(() => {
      for (let sample = 0; sample < 12; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            corners[sample % corners.length]!,
            0.7,
            27_000 + sample * 16,
          ),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to open hand" }),
    );
    act(() => {
      [0.53, 0.7, 0.7, 0.7, 0.7, 0.7].forEach((ratio, sample) =>
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            ratio,
            28_000 + sample * 16,
          ),
        ),
      );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to closed pinch" }),
    );

    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.58,
            29_000 + sample * 16,
          ),
        );
    });
    const review = screen.getByRole("button", {
      name: "Review hand calibration",
    });
    expect(review).toBeDisabled();

    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            0.34,
            30_000 + sample * 16,
          ),
        );
    });
    expect(review).toBeEnabled();
  });

  it("accepts a noisy but clearly separated closed pinch", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 30_700);
    const corners = [
      { x: 0.36, y: 0.34 },
      { x: 0.64, y: 0.34 },
      { x: 0.36, y: 0.66 },
      { x: 0.64, y: 0.66 },
    ];
    act(() => {
      for (let sample = 0; sample < 12; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            corners[sample % corners.length]!,
            0.7,
            31_000 + sample * 16,
          ),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to open hand" }),
    );
    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame({ x: 0.5, y: 0.5 }, 0.7, 32_000 + sample * 16),
        );
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to closed pinch" }),
    );

    act(() => {
      [0.32, 0.36, 0.29, 0.34, 0.38, 0.31].forEach((ratio, sample) =>
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.5, y: 0.5 },
            ratio,
            33_000 + sample * 16,
          ),
        ),
      );
    });
    expect(
      screen.getByRole("button", { name: "Review hand calibration" }),
    ).toBeEnabled();
  });

  it("labels skipped calibration as default controls instead of calibrated", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    const results: SpatialCalibrationResult[] = [];
    const view = render(
      <SpatialCameraControl
        createController={() => fake.controller}
        onCalibrationResult={(result) => results.push(result)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));
    await user.click(
      screen.getByRole("button", { name: "Skip hand calibration" }),
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ accepted: false, reason: "skipped" });
    view.rerender(
      <SpatialCameraControl
        calibrationKind="skipped"
        calibrationProfile={results[0]!.profile}
        createController={() => fake.controller}
        onCalibrationResult={(result) => results.push(result)}
      />,
    );
    expect(
      screen.getByText(/default controls · calibration skipped/i),
    ).toBeVisible();
    expect(
      screen.queryByText(/calibrated for this camera session/i),
    ).toBeNull();
  });

  it("clears personalized pinch thresholds when the retained profile is removed", () => {
    const fake = fakeController({ sensorFrames: true });
    const profile = {
      deviceKey: "camera-a",
      cameraBounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      safeCanvasInsetPx: 24,
      pinchClosedRatio: 0.3,
      pinchOpenRatio: 0.7,
      mirrorX: true,
      createdAt: 1_000,
    };
    const view = render(
      <SpatialCameraControl
        calibrationProfile={profile}
        createController={() => fake.controller}
      />,
    );
    expect(fake.controller.setPinchThresholds).toHaveBeenCalledWith({
      fallback: { engage: 0.4, release: 0.54 },
      byTrackId: {},
      byHandedness: {},
    });

    view.rerender(
      <SpatialCameraControl
        calibrationProfile={null}
        createController={() => fake.controller}
      />,
    );

    expect(fake.controller.setPinchThresholds).toHaveBeenLastCalledWith(null);
  });

  it("does not reuse a handedness calibration without explicit reliability", () => {
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationProfile={{
          deviceKey: "camera-a",
          cameraBounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
          safeCanvasInsetPx: 24,
          pinchClosedRatio: 0.3,
          pinchOpenRatio: 0.7,
          mirrorX: true,
          createdAt: 1_000,
          pinchCalibrations: [
            {
              trackId: "expired-track",
              handedness: "right",
              closedRatio: 0.32,
              openRatio: 0.7,
            },
          ],
        }}
        createController={() => fake.controller}
      />,
    );

    expect(fake.controller.setPinchThresholds).toHaveBeenCalledWith({
      fallback: { engage: 0.4, release: 0.54 },
      byTrackId: {
        "expired-track": {
          engage: 0.415,
          release: 0.548,
          handedness: "right",
        },
      },
      byHandedness: {},
    });
  });

  it("keeps an inadequate reach gated and explains how to recover", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    const results: SpatialCalibrationResult[] = [];
    render(
      <SpatialCameraControl
        createController={() => fake.controller}
        onCalibrationResult={(result) => results.push(result)}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 29_700);

    act(() => {
      for (let sample = 0; sample < 16; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.49 + (sample % 2) * 0.01, y: 0.49 + (sample % 2) * 0.01 },
            0.7,
            30_000 + sample * 16,
          ),
        );
    });
    expect(results).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Continue to open hand" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        /next step unlocks when the comfortable area is wide enough/i,
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/calibrated for this camera session/i),
    ).toBeNull();
  });

  it("resets every sample when controlled calibration is reopened", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    const view = render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 39_700);
    act(() => {
      for (let sample = 0; sample < 12; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            { x: 0.35 + (sample % 2) * 0.3, y: 0.35 + (sample % 3) * 0.15 },
            0.7,
            40_000 + sample * 16,
          ),
        );
    });
    expect(
      screen.getByText(/map comfortable reach · 12 samples/i),
    ).toBeVisible();

    view.rerender(
      <SpatialCameraControl
        calibrationOpen={false}
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    view.rerender(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );

    expect(
      screen.getByText(/scanning open hand — 0\/6 stable frames/i),
    ).toBeVisible();
    expect(
      screen.getByText(/0 baseline · 0 reach · 0 open · 0 closed/i),
    ).toBeVisible();
  });

  it("reacquires the only visible hand instead of freezing calibration on an expired track", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 49_700);
    const corners = [
      { x: 0.35, y: 0.35 },
      { x: 0.65, y: 0.35 },
      { x: 0.35, y: 0.65 },
      { x: 0.65, y: 0.65 },
    ];
    act(() => {
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            corners[sample % corners.length]!,
            0.7,
            50_000 + sample * 16,
            "hand-before-loss",
          ),
        );
      for (let sample = 0; sample < 6; sample += 1)
        fake.emitSensor(
          calibrationSensorFrame(
            corners[sample % corners.length]!,
            0.7,
            51_000 + sample * 16,
            "hand-after-reacquire",
          ),
        );
    });

    expect(
      screen.getByText(/map comfortable reach · 12 samples/i),
    ).toBeVisible();
  });

  it("clears stale calibration landmarks when the detector reports no hand", () => {
    const fake = fakeController({ sensorFrames: true });
    const { container } = render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    act(() => {
      fake.emit({
        mode: "point",
        pointer: { x: 0.5, y: 0.5 },
        confidence: 0.97,
        landmarks: trackedLandmarks(),
        timestamp: 60_000,
      });
      fake.emitSensor(calibrationSensorFrame({ x: 0.5, y: 0.5 }, 0.7, 60_000));
    });
    expect(
      container.querySelectorAll("[data-tracked-hand-pointer]"),
    ).toHaveLength(1);

    act(() =>
      fake.emitSensor({
        timestamp: 60_016,
        receivedAt: 60_016,
        source: "calibration-test",
        hands: [],
      }),
    );

    expect(
      container.querySelectorAll("[data-tracked-hand-pointer]"),
    ).toHaveLength(0);
    expect(container.querySelectorAll("[data-hand-keypoint]")).toHaveLength(0);
  });

  it("drops raw landmark state as soon as calibration closes", async () => {
    const user = userEvent.setup();
    const fake = fakeController({ sensorFrames: true });
    const { container } = render(
      <SpatialCameraControl
        calibrationOpen
        createController={() => fake.controller}
        onCalibrationOpenChange={() => undefined}
      />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    act(() =>
      fake.emitSensor(calibrationSensorFrame({ x: 0.5, y: 0.5 }, 0.7, 61_000)),
    );
    expect(container.querySelectorAll("[data-hand-keypoint]")).toHaveLength(21);

    await user.click(
      screen.getByRole("button", { name: "Close hand calibration" }),
    );

    expect(container.querySelectorAll("[data-hand-keypoint]")).toHaveLength(0);
  });

  it("bounds camera-rate calibration evidence after the retained profile is statistically useful", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    render(
      <SpatialCameraControl
        createController={() => fake.controller}
        onCalibrationResult={() => undefined}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => fake.setStatus({ state: "ready" }));
    await establishOpenPalmBaseline(user, fake, 5_700);

    act(() => {
      for (let sample = 0; sample < 300; sample += 1) {
        const pointer = {
          x: 0.16 + (sample % 20) * 0.034,
          y: 0.14 + (sample % 18) * 0.04,
        };
        fake.emit(
          calibrationObservation("point", pointer, 0.72, 6_000 + sample * 16),
        );
      }
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to open hand" }),
    );
    act(() => {
      for (let sample = 0; sample < 300; sample += 1) {
        const pointer = {
          x: 0.16 + (sample % 20) * 0.034,
          y: 0.14 + (sample % 18) * 0.04,
        };
        fake.emit(
          calibrationObservation("point", pointer, 0.72, 12_000 + sample * 16),
        );
      }
    });
    await user.click(
      screen.getByRole("button", { name: "Continue to closed pinch" }),
    );
    act(() => {
      for (let sample = 0; sample < 300; sample += 1) {
        const pointer = {
          x: 0.16 + (sample % 20) * 0.034,
          y: 0.14 + (sample % 18) * 0.04,
        };
        fake.emit(
          calibrationObservation("pinch", pointer, 0.22, 18_000 + sample * 16),
        );
      }
    });

    expect(
      screen.getByText(/240 reach · 120 open · 120 closed/i),
    ).toBeVisible();
  });

  it("clamps extreme PiP drags to the mobile workspace and dock on every side", async () => {
    const fake = fakeController();
    const { container } = render(
      <SpatialCameraControl createController={() => fake.controller} />,
    );
    act(() => fake.setStatus({ state: "ready" }));
    const control = container.querySelector<HTMLElement>(
      ".spatial-camera-control",
    );
    if (!control) throw new Error("Expected hand input control.");
    const workspace = control.parentElement as HTMLElement;
    const dock = document.createElement("div");
    dock.className = "tool-dock";
    workspace.append(dock);
    vi.spyOn(workspace, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 400,
      bottom: 600,
      width: 400,
      height: 600,
      toJSON: () => ({}),
    });
    vi.spyOn(dock, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 520,
      left: 0,
      top: 520,
      right: 400,
      bottom: 600,
      width: 400,
      height: 80,
      toJSON: () => ({}),
    });
    vi.spyOn(control, "getBoundingClientRect").mockImplementation(() => {
      const offsetX = Number.parseFloat(
        control.style.getPropertyValue("--sensor-pip-x") || "0",
      );
      const offsetY = Number.parseFloat(
        control.style.getPropertyValue("--sensor-pip-y") || "0",
      );
      const left = 120 + offsetX;
      const top = 250 + offsetY;
      return {
        x: left,
        y: top,
        left,
        top,
        right: left + 240,
        bottom: top + 200,
        width: 240,
        height: 200,
        toJSON: () => ({}),
      };
    });

    const drag = screen.getByRole("button", {
      name: "Move hand sensor preview",
    });
    const move = (pointerId: number, x: number, y: number) => {
      fireEvent.pointerDown(drag, { pointerId, clientX: 100, clientY: 100 });
      fireEvent.pointerMove(drag, { pointerId, clientX: x, clientY: y });
      fireEvent.pointerUp(drag, { pointerId, clientX: x, clientY: y });
    };

    move(1, -10_000, 100);
    expect(control.style.getPropertyValue("--sensor-pip-x")).toBe("-112px");
    move(2, 10_000, 100);
    expect(control.style.getPropertyValue("--sensor-pip-x")).toBe("32px");
    move(3, 100, -10_000);
    expect(control.style.getPropertyValue("--sensor-pip-y")).toBe("-242px");
    move(4, 100, 10_000);
    expect(control.style.getPropertyValue("--sensor-pip-y")).toBe("62px");

    expect(drag).toBeVisible();
    expect(control.getBoundingClientRect()).toMatchObject({
      left: 152,
      top: 312,
      right: 392,
      bottom: 512,
    });

    act(() => window.dispatchEvent(new Event("resize")));
    expect(control.getBoundingClientRect().right).toBeLessThanOrEqual(392);
    expect(control.getBoundingClientRect().bottom).toBeLessThanOrEqual(512);
  });

  it("presents the camera as a sensor preview rather than a movement boundary", () => {
    const fake = fakeController();
    const { container } = render(
      <SpatialCameraControl createController={() => fake.controller} />,
    );

    expect(container.querySelector(".camera-interaction-boundary")).toBeNull();
    expect(screen.getByText("Sensor preview only")).toBeVisible();
    expect(
      screen.getByText("Your whole canvas is the hand control surface."),
    ).toBeVisible();
  });

  it("shows open-palm and bimanual resize feedback without miscounting the pinch self-check", async () => {
    const user = userEvent.setup();
    const fake = fakeController();
    render(<SpatialCameraControl createController={() => fake.controller} />);
    act(() => fake.setStatus({ state: "ready" }));
    await user.click(
      screen.getByRole("button", { name: "Show hand tracking details" }),
    );

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
      await screen.findByText("OPEN · pen up or pan blank canvas"),
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
      await screen.findByText("TWO HANDS · resize object or zoom canvas"),
    ).toBeVisible();
  });

  it.each([
    [
      {
        state: "refused",
        message: "Camera permission was not granted.",
      } as const,
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
