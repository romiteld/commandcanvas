import { describe, expect, it } from "vitest";

import type { HandTrackingObservation } from "@/lib/gesture/hand-tracking-controller";
import {
  createInitialSpatialRoomInputState,
  createInitialStrokeSampleState,
  reduceSpatialRoomObservation,
  sampleTrackedStrokePoint,
  spatialInputFromHandObservation,
} from "@/lib/gesture/spatial-room-input";
import {
  mapCalibratedPointer,
  type HandCalibrationProfile,
} from "@/lib/gesture/hand-calibration";

type SingleHandObservation = Exclude<
  HandTrackingObservation,
  { mode: "idle" | "bimanual_pinch" }
>;

function calibration(
  overrides: Partial<HandCalibrationProfile>,
): HandCalibrationProfile {
  return {
    deviceKey: "camera-a",
    cameraBounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    safeCanvasInsetPx: 24,
    pinchClosedRatio: 0.2,
    pinchOpenRatio: 0.8,
    mirrorX: true,
    createdAt: 1,
    ...overrides,
  };
}

function measuredObservation(
  timestamp: number,
): SingleHandObservation {
  return {
    mode: "point",
    pointer: { x: 0.4, y: 0.4 },
    motionPointer: { x: 0.46, y: 0.5 },
    confidence: 0.97,
    trackId: "track-a",
    prediction: { predicted: false },
    trackingState: "tracked",
    measurements: {
      indexTip: { x: 0.4, y: 0.4 },
      thumbTip: { x: 0.42, y: 0.4 },
      pinchMidpoint: { x: 0.41, y: 0.4 },
      palmMcpCentroid: { x: 0.46, y: 0.5 },
      pinchDistance: 0.08,
      palmScale: 0.2,
      pinchRatio: 0.4,
      confidence: 0.97,
      indexTipConfidence: 0.96,
      thumbTipConfidence: 0.95,
    },
    pinchRatio: 0.4,
    timestamp,
  };
}

describe("spatial room input adapter", () => {
  it("maps each tracked hand through its own reach calibration", () => {
    const canvas = { left: 0, top: 0, width: 1_000, height: 500 };
    const profile = {
      ...calibration({
        cameraBounds: { x: 0.1, y: 0.1, width: 0.4, height: 0.4 },
        safeCanvasInsetPx: 0,
        mirrorX: false,
      }),
      reachCalibrations: [
        {
          trackId: "recycled-track",
          handedness: "left" as const,
          handednessConfidence: 0.98,
          cameraBounds: { x: 0.4, y: 0.3, width: 0.2, height: 0.4 },
        },
        {
          trackId: "right-track",
          handedness: "right" as const,
          handednessConfidence: 0.98,
          cameraBounds: { x: 0.7, y: 0.3, width: 0.2, height: 0.4 },
        },
      ],
    } as HandCalibrationProfile;
    const left = {
      ...measuredObservation(500),
      trackId: "left-track",
      handedness: "left" as const,
      handednessConfidence: 0.99,
      pointer: { x: 0.5, y: 0.5 },
      motionPointer: { x: 0.5, y: 0.5 },
      measurements: {
        ...measuredObservation(500).measurements!,
        indexTip: { x: 0.5, y: 0.5 },
        palmMcpCentroid: { x: 0.5, y: 0.5 },
      },
    };
    const recycledAsRight = {
      ...measuredObservation(600),
      trackId: "recycled-track",
      handedness: "right" as const,
      handednessConfidence: 0.99,
      pointer: { x: 0.8, y: 0.5 },
      motionPointer: { x: 0.8, y: 0.5 },
      measurements: {
        ...measuredObservation(600).measurements!,
        indexTip: { x: 0.8, y: 0.5 },
        palmMcpCentroid: { x: 0.8, y: 0.5 },
      },
    };
    const options = {
      calibration: profile,
      canvas,
      gainState: "hover" as const,
      edgePreviewVisible: false,
    };

    const leftInput = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      left,
      options,
    );
    const rightInput = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      recycledAsRight,
      options,
    );

    expect(leftInput.input).toMatchObject({ pointer: { x: 0.5, y: 0.5 } });
    expect(rightInput.input).toMatchObject({ pointer: { x: 0.5, y: 0.5 } });
  });

  it("uses a matching per-hand drawing calibration without changing thumb-index pinch", () => {
    const canvas = { left: 0, top: 0, width: 1_000, height: 500 };
    const base = measuredObservation(2_000);
    const calibratedObservation = (timestamp: number): SingleHandObservation => ({
      ...base,
      timestamp,
      handedness: "right",
      handednessConfidence: 0.97,
      measurements: {
        ...base.measurements!,
        middleTip: { x: 0.5, y: 0.5 },
        drawingClutchRatio: 0.4,
        middleTipConfidence: 0.96,
      },
    });
    const options = {
      calibration: calibration({
        pinchClosedRatio: 0.2,
        pinchOpenRatio: 0.8,
        drawingClutchCalibrations: [
          {
            trackId: "track-a",
            handedness: "right" as const,
            handednessConfidence: 0.97,
            closedRatio: 0.4,
            openRatio: 0.8,
            openSampleCount: 8,
            closedSampleCount: 8,
            capturedAt: 1_000,
          },
        ],
      }),
      canvas,
      gainState: "draw" as const,
      edgePreviewVisible: false,
      drawingEnabled: true,
    };

    const pending = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      calibratedObservation(2_000),
      options,
    );
    const engaged = reduceSpatialRoomObservation(
      pending.state,
      calibratedObservation(2_016),
      options,
    );

    expect(engaged.input).toMatchObject({
      mode: "point",
      drawing: { penDown: true, transition: "engaged" },
    });
    expect(engaged.state.drawingClutch.policy).toMatchObject({
      engageThreshold: 0.5,
      releaseThreshold: 0.64,
    });
  });

  it("does not reuse handedness drawing calibration without reliable handedness", () => {
    const canvas = { left: 0, top: 0, width: 1_000, height: 500 };
    const base = measuredObservation(3_000);
    const observation = (timestamp: number): SingleHandObservation => ({
      ...base,
      timestamp,
      trackId: "replacement-track",
      handedness: "right",
      handednessConfidence: 0.42,
      measurements: {
        ...base.measurements!,
        middleTip: { x: 0.5, y: 0.5 },
        drawingClutchRatio: 0.4,
        middleTipConfidence: 0.96,
      },
    });
    const options = {
      calibration: calibration({
        drawingClutchCalibrations: [
          {
            trackId: "expired-track",
            handedness: "right" as const,
            handednessConfidence: 0.97,
            closedRatio: 0.4,
            openRatio: 0.8,
            openSampleCount: 8,
            closedSampleCount: 8,
            capturedAt: 1_000,
          },
        ],
      }),
      canvas,
      gainState: "draw" as const,
      edgePreviewVisible: false,
      drawingEnabled: true,
    };

    const pending = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      observation(3_000),
      options,
    );
    const stillHovering = reduceSpatialRoomObservation(
      pending.state,
      observation(3_016),
      options,
    );

    expect(stillHovering.input).toMatchObject({
      mode: "point",
      drawing: { penDown: false, transition: "none" },
    });
    expect(stillHovering.state.drawingClutch.policy).toMatchObject({
      engageThreshold: 0.32,
      releaseThreshold: 0.52,
    });
  });

  it("resets an uncommitted candidate before switching to another hand policy", () => {
    const canvas = { left: 0, top: 0, width: 1_000, height: 500 };
    const base = measuredObservation(3_500);
    const observation = (
      trackId: string,
      timestamp: number,
      drawingClutchRatio: number,
    ): SingleHandObservation => ({
      ...base,
      timestamp,
      trackId,
      handedness: trackId === "track-a" ? "right" : "left",
      handednessConfidence: 0.98,
      measurements: {
        ...base.measurements!,
        middleTip: { x: 0.5, y: 0.5 },
        drawingClutchRatio,
        middleTipConfidence: 0.96,
      },
    });
    const options = {
      calibration: calibration({
        drawingClutchCalibrations: [
          {
            trackId: "track-a",
            handedness: "right" as const,
            handednessConfidence: 0.98,
            closedRatio: 0.4,
            openRatio: 0.8,
            openSampleCount: 8,
            closedSampleCount: 8,
            capturedAt: 1_000,
          },
          {
            trackId: "track-b",
            handedness: "left" as const,
            handednessConfidence: 0.98,
            closedRatio: 0.1,
            openRatio: 0.5,
            openSampleCount: 8,
            closedSampleCount: 8,
            capturedAt: 1_000,
          },
        ],
      }),
      canvas,
      gainState: "draw" as const,
      edgePreviewVisible: false,
      drawingEnabled: true,
    };

    const firstHandPending = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      observation("track-a", 3_500, 0.4),
      options,
    );
    const secondHand = reduceSpatialRoomObservation(
      firstHandPending.state,
      observation("track-b", 3_516, 0.3),
      options,
    );

    expect(firstHandPending.state.drawingClutch).toMatchObject({
      phase: "engage_pending",
      activeTrackId: "track-a",
      policy: { engageThreshold: 0.5, releaseThreshold: 0.64 },
    });
    expect(secondHand.state.drawingClutch).toMatchObject({
      phase: "pen_up",
      activeTrackId: null,
      policy: { engageThreshold: 0.2, releaseThreshold: 0.34 },
    });
    expect(secondHand.input).toMatchObject({
      drawing: { trackId: "track-b", penDown: false, transition: "none" },
    });
  });

  it("releases drawing-clutch ownership after a drawing-hand identity change", () => {
    const base = measuredObservation(4_000);
    const observation = (
      trackId: string,
      timestamp: number,
    ): SingleHandObservation => ({
      ...base,
      timestamp,
      trackId,
      handedness: trackId === "track-a" ? "right" : "left",
      handednessConfidence: 0.98,
      measurements: {
        ...base.measurements!,
        middleTip: { x: 0.43, y: 0.41 },
        drawingClutchRatio: 0.2,
        middleTipConfidence: 0.96,
      },
    });
    const options = {
      calibration: calibration({}),
      canvas: { left: 0, top: 0, width: 1_000, height: 500 },
      gainState: "draw" as const,
      edgePreviewVisible: false,
      drawingEnabled: true,
    };
    const pendingA = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      observation("track-a", 4_000),
      options,
    );
    const engagedA = reduceSpatialRoomObservation(
      pendingA.state,
      observation("track-a", 4_016),
      options,
    );
    const pendingB = reduceSpatialRoomObservation(
      engagedA.state,
      observation("track-b", 4_032),
      options,
    );
    const engagedB = reduceSpatialRoomObservation(
      pendingB.state,
      observation("track-b", 4_048),
      options,
    );

    expect(engagedA.state.drawingClutch).toMatchObject({
      phase: "pen_down",
      activeTrackId: "track-a",
    });
    expect(pendingB.state.drawingClutch).toMatchObject({
      phase: "engage_pending",
      activeTrackId: "track-b",
    });
    expect(pendingB.input).toMatchObject({
      drawing: {
        trackId: "track-b",
        penDown: false,
        transition: "none",
      },
    });
    expect(engagedB.input).toMatchObject({
      drawing: {
        trackId: "track-b",
        penDown: true,
        transition: "engaged",
      },
    });
  });

  it("derives a confirmed thumb-middle clutch without changing index-tip ownership", () => {
    const canvas = { left: 0, top: 0, width: 1_000, height: 500 };
    const base = measuredObservation(1_000);
    const closed = (timestamp: number): SingleHandObservation => ({
      ...base,
      timestamp,
      measurements: {
        ...base.measurements!,
        middleTip: { x: 0.43, y: 0.41 },
        drawingClutchRatio: 0.2,
        middleTipConfidence: 0.94,
      },
    });
    const options = {
      calibration: calibration({}),
      canvas,
      gainState: "draw" as const,
      edgePreviewVisible: false,
      drawingEnabled: true,
    };

    const pending = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      closed(1_000),
      options,
    );
    const engaged = reduceSpatialRoomObservation(
      pending.state,
      closed(1_016),
      options,
    );

    expect(pending.input).toMatchObject({
      mode: "point",
      drawing: { trackId: "track-a", penDown: false, transition: "none" },
    });
    expect(engaged.input).toMatchObject({
      mode: "point",
      drawing: {
        trackId: "track-a",
        penDown: true,
        transition: "engaged",
        sampleKind: "measured",
      },
    });
    if (engaged.input.mode !== "point")
      throw new Error("fixture must remain index-led");
    expect(engaged.input.pointer).not.toEqual(
      engaged.input.drawing?.normalizedDistance,
    );
  });

  it("keeps landmark 8 as the only brush coordinate when the clutch engages", () => {
    const indexTip = { x: 0.24, y: 0.31 };
    const thumbTip = { x: 0.78, y: 0.82 };
    const middleTip = { x: 0.8, y: 0.82 };
    const palmMcpCentroid = { x: 0.71, y: 0.76 };
    const observation = (timestamp: number): SingleHandObservation => ({
      ...measuredObservation(timestamp),
      pointer: indexTip,
      motionPointer: palmMcpCentroid,
      pinchRatio: 0.8,
      measurements: {
        ...measuredObservation(timestamp).measurements!,
        indexTip,
        thumbTip,
        middleTip,
        pinchMidpoint: {
          x: (indexTip.x + thumbTip.x) / 2,
          y: (indexTip.y + thumbTip.y) / 2,
        },
        palmMcpCentroid,
        pinchRatio: 0.8,
        drawingClutchRatio: 0.2,
        middleTipConfidence: 0.96,
      },
    });
    const options = {
      calibration: calibration({
        cameraBounds: { x: 0, y: 0, width: 1, height: 1 },
        safeCanvasInsetPx: 0,
        mirrorX: false,
      }),
      canvas: { left: 0, top: 0, width: 1_000, height: 500 },
      gainState: "draw" as const,
      edgePreviewVisible: false,
      drawingEnabled: true,
    };

    const pending = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      observation(1_000),
      options,
    );
    const engaged = reduceSpatialRoomObservation(
      pending.state,
      observation(1_016),
      options,
    );

    const mappedPoint = (point: { x: number; y: number }) => {
      const mapped = mapCalibratedPointer(
        options.calibration,
        point,
        options.canvas,
        "draw",
      ).point;
      return {
        x: mapped.x / options.canvas.width,
        y: mapped.y / options.canvas.height,
      };
    };
    expect(engaged.input).toMatchObject({
      mode: "point",
      pointer: mappedPoint(indexTip),
      drawing: { penDown: true, transition: "engaged" },
    });
    if (engaged.input.mode !== "point")
      throw new Error("drawing fixture must remain index-led");
    expect(engaged.input.pointer).not.toEqual(mappedPoint(thumbTip));
    expect(engaged.input.pointer).not.toEqual(mappedPoint(middleTip));
    expect(engaged.input.pointer).not.toEqual(mappedPoint(palmMcpCentroid));
  });

  it("preserves an engaged clutch through a bounded tracking-loss observation", () => {
    const canvas = { left: 0, top: 0, width: 1_000, height: 500 };
    const base = measuredObservation(1_000);
    const closed = (timestamp: number): SingleHandObservation => ({
      ...base,
      timestamp,
      measurements: {
        ...base.measurements!,
        middleTip: { x: 0.43, y: 0.41 },
        drawingClutchRatio: 0.2,
        middleTipConfidence: 0.94,
      },
    });
    const options = {
      calibration: calibration({}),
      canvas,
      gainState: "draw" as const,
      edgePreviewVisible: false,
      drawingEnabled: true,
    };
    const pending = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      closed(1_000),
      options,
    );
    const engaged = reduceSpatialRoomObservation(
      pending.state,
      closed(1_016),
      options,
    );
    const lost = reduceSpatialRoomObservation(
      engaged.state,
      { mode: "idle", timestamp: 1_032, trackingState: "lost" },
      options,
    );
    const resumed = reduceSpatialRoomObservation(
      lost.state,
      closed(1_048),
      options,
    );

    expect(lost.input).toEqual({
      mode: "idle",
      timestamp: 1_032,
      reason: "loss",
    });
    expect(lost.state.drawingClutch).toMatchObject({
      phase: "pen_down",
      activeTrackId: "track-a",
    });
    expect(resumed.input).toMatchObject({
      mode: "point",
      drawing: {
        trackId: "track-a",
        penDown: true,
        transition: "none",
      },
    });
  });

  it("uses filtered intent pointers while retaining raw measurements only as evidence", () => {
    const observation: HandTrackingObservation = {
      mode: "pinch",
      pointer: { x: 0.9, y: 0.8 },
      motionPointer: { x: 0.7, y: 0.6 },
      confidence: 0.97,
      trackId: "track-a",
      prediction: { predicted: false },
      trackingState: "tracked",
      measurements: {
        indexTip: { x: 0.21, y: 0.31 },
        thumbTip: { x: 0.24, y: 0.34 },
        pinchMidpoint: { x: 0.225, y: 0.325 },
        palmMcpCentroid: { x: 0.42, y: 0.52 },
        pinchDistance: 0.04,
        palmScale: 0.2,
        pinchRatio: 0.2,
        confidence: 0.97,
        indexTipConfidence: 0.96,
        thumbTipConfidence: 0.95,
      },
      timestamp: 1_000,
    };

    expect(spatialInputFromHandObservation(observation, true)).toEqual({
      mode: "pinch",
      pointer: { x: 0.9, y: 0.8 },
      motionPointer: { x: 0.7, y: 0.6 },
      timestamp: 1_000,
      reliability: {
        trackId: "track-a",
        confidence: 0.95,
        real: true,
        predicted: false,
        trackingState: "tracked",
      },
      edgePreviewVisible: true,
    });
  });

  it("does not let raw landmark jitter override stable filtered intent points", () => {
    const stableFiltered = {
      mode: "pinch" as const,
      pointer: { x: 0.4, y: 0.4 },
      motionPointer: { x: 0.46, y: 0.5 },
      confidence: 0.97,
      trackId: "track-a",
      prediction: { predicted: false as const },
      trackingState: "tracked" as const,
      pinchRatio: 0.1,
    };
    const first: SingleHandObservation = {
      ...stableFiltered,
      measurements: {
        ...measuredObservation(1_000).measurements!,
        indexTip: { x: 0.4, y: 0.4 },
        palmMcpCentroid: { x: 0.46, y: 0.5 },
        pinchRatio: 0.1,
      },
      timestamp: 1_000,
    };
    const jittered: SingleHandObservation = {
      ...stableFiltered,
      measurements: {
        ...first.measurements!,
        indexTip: { x: 0.8, y: 0.2 },
        palmMcpCentroid: { x: 0.9, y: 0.15 },
      },
      timestamp: 1_016,
    };

    const firstInput = spatialInputFromHandObservation(first, false);
    const jitteredInput = spatialInputFromHandObservation(jittered, false);

    expect(firstInput).toMatchObject({
      pointer: { x: 0.4, y: 0.4 },
      motionPointer: { x: 0.46, y: 0.5 },
    });
    expect(jitteredInput).toMatchObject({
      pointer: { x: 0.4, y: 0.4 },
      motionPointer: { x: 0.46, y: 0.5 },
    });
  });

  it("keeps an open palm as pen-up and carries loss provenance", () => {
    const open: HandTrackingObservation = {
      mode: "open_palm",
      pointer: { x: 0.4, y: 0.5 },
      confidence: 0.93,
      trackId: "track-open",
      prediction: { predicted: false },
      trackingState: "tracked",
      timestamp: 2_000,
    };
    expect(spatialInputFromHandObservation(open, false)).toMatchObject({
      mode: "open_palm",
      pointer: { x: 0.4, y: 0.5 },
      reliability: { trackId: "track-open", real: true },
    });
    expect(
      spatialInputFromHandObservation(
        { mode: "idle", timestamp: 2_016, trackingState: "lost" },
        false,
      ),
    ).toEqual({ mode: "idle", reason: "loss", timestamp: 2_016 });
  });

  it("maps two independent tracked hands without collapsing their identities", () => {
    const observation: HandTrackingObservation = {
      mode: "bimanual_pinch",
      hands: [
        {
          handedness: "left",
          pointer: { x: 0.2, y: 0.4 },
          confidence: 0.92,
          trackId: "track-1",
          prediction: { predicted: false },
          trackingState: "tracked",
        },
        {
          handedness: "right",
          pointer: { x: 0.8, y: 0.4 },
          confidence: 0.94,
          trackId: "track-2",
          prediction: { predicted: false },
          trackingState: "tracked",
        },
      ],
      center: { x: 0.5, y: 0.4 },
      span: 0.6,
      timestamp: 3_000,
    };

    expect(spatialInputFromHandObservation(observation, false)).toMatchObject({
      mode: "bimanual_pinch",
      hands: [
        { trackId: "track-1", pointer: { x: 0.2, y: 0.4 } },
        { trackId: "track-2", pointer: { x: 0.8, y: 0.4 } },
      ],
    });
  });

  it("maps the same landmark differently for two retained calibration profiles", () => {
    const canvas = { left: 0, top: 0, width: 1_000, height: 500 };
    const wide = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      measuredObservation(1_000),
      {
        calibration: calibration({}),
        canvas,
        gainState: "draw",
        edgePreviewVisible: false,
      },
    );
    const narrow = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      measuredObservation(1_000),
      {
        calibration: calibration({
          cameraBounds: { x: 0.3, y: 0.2, width: 0.5, height: 0.6 },
        }),
        canvas,
        gainState: "draw",
        edgePreviewVisible: false,
      },
    );

    expect(wide.input).toMatchObject({ mode: "point" });
    expect(narrow.input).toMatchObject({ mode: "point" });
    if (wide.input.mode === "idle" || wide.input.mode === "bimanual_pinch")
      throw new Error("Expected a calibrated single-hand input.");
    if (narrow.input.mode === "idle" || narrow.input.mode === "bimanual_pinch")
      throw new Error("Expected a calibrated single-hand input.");
    expect(wide.input.pointer).not.toEqual(narrow.input.pointer);
    expect(wide.input.pointer).not.toEqual({ x: 0.4, y: 0.4 });
  });

  it("does not move a stationary hand when interaction state changes", () => {
    const canvas = { left: 0, top: 0, width: 1_000, height: 500 };
    const profile = calibration({});
    const mapped = (["hover", "target", "held", "draw"] as const).map(
      (gainState) =>
        reduceSpatialRoomObservation(
          createInitialSpatialRoomInputState(),
          measuredObservation(1_000),
          {
            calibration: profile,
            canvas,
            gainState,
            edgePreviewVisible: false,
          },
        ).input,
    );
    const points = mapped.map((input) => {
      if (input.mode === "idle" || input.mode === "bimanual_pinch")
        throw new Error("Expected a mapped single-hand observation.");
      return input.pointer;
    });

    expect(points.slice(1)).toEqual([points[0], points[0], points[0]]);
  });

  it("uses Task 2 calibrated thresholds and two-of-three voting for semantic pinch", () => {
    const canvas = { left: 0, top: 0, width: 1_000, height: 500 };
    const strictProfile = calibration({
      pinchClosedRatio: 0.2,
      pinchOpenRatio: 0.8,
    });
    const personalProfile = calibration({
      pinchClosedRatio: 0.4,
      pinchOpenRatio: 0.8,
    });
    const options = {
      canvas,
      gainState: "hover" as const,
      edgePreviewVisible: false,
    };

    const strictFirst = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      measuredObservation(2_000),
      { ...options, calibration: strictProfile },
    );
    const strictSecond = reduceSpatialRoomObservation(
      strictFirst.state,
      measuredObservation(2_016),
      { ...options, calibration: strictProfile },
    );
    const personalFirst = reduceSpatialRoomObservation(
      createInitialSpatialRoomInputState(),
      measuredObservation(2_000),
      { ...options, calibration: personalProfile },
    );
    const personalSecond = reduceSpatialRoomObservation(
      personalFirst.state,
      measuredObservation(2_016),
      { ...options, calibration: personalProfile },
    );

    expect(strictSecond.input.mode).toBe("point");
    expect(personalFirst.input.mode).toBe("point");
    expect(personalSecond.input.mode).toBe("pinch");
    expect(personalSecond.input).toMatchObject({
      reliability: {
        trackId: "track-a",
        real: true,
        trackingState: "tracked",
      },
    });
  });

  it("samples ink at 1.75 CSS pixels or 12 ms and rejects duplicate jitter", () => {
    const initial = createInitialStrokeSampleState();
    const first = sampleTrackedStrokePoint(initial, {
      pointer: { x: 0.2, y: 0.3 },
      timestamp: 1_000,
      canvasSize: { width: 1_000, height: 500 },
    });
    expect(first.accepted).toBe(true);

    const jitter = sampleTrackedStrokePoint(first.state, {
      pointer: { x: 0.2005, y: 0.3005 },
      timestamp: 1_006,
      canvasSize: { width: 1_000, height: 500 },
    });
    expect(jitter.accepted).toBe(false);

    const distance = sampleTrackedStrokePoint(jitter.state, {
      pointer: { x: 0.202, y: 0.3 },
      timestamp: 1_007,
      canvasSize: { width: 1_000, height: 500 },
    });
    expect(distance.accepted).toBe(true);

    const elapsed = sampleTrackedStrokePoint(distance.state, {
      pointer: { x: 0.2022, y: 0.3002 },
      timestamp: 1_019,
      canvasSize: { width: 1_000, height: 500 },
    });
    expect(elapsed.accepted).toBe(true);
  });
});
