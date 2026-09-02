import type { HandLandmark } from "@/lib/gesture/hand-landmark-contract";

export function makeLandmarks(input?: {
  offsetX?: number;
  offsetY?: number;
  scale?: number;
  pinch?: boolean;
  openPalm?: boolean;
}): HandLandmark[] {
  const offsetX = input?.offsetX ?? 0.5;
  const offsetY = input?.offsetY ?? 0.6;
  const scale = input?.scale ?? 0.18;
  const points = Array.from({ length: 21 }, (_, index) => ({
    x: offsetX + ((index % 4) - 1.5) * scale * 0.12,
    y: offsetY - Math.floor(index / 4) * scale * 0.12,
    z: (index % 3) * scale * 0.02,
    visibility: 0.98,
  }));

  points[0] = { x: offsetX, y: offsetY, z: 0, visibility: 0.99 };
  points[5] = {
    x: offsetX - scale * 0.35,
    y: offsetY - scale * 0.45,
    z: 0,
    visibility: 0.99,
  };
  points[9] = {
    x: offsetX,
    y: offsetY - scale * 0.5,
    z: 0,
    visibility: 0.99,
  };
  points[13] = {
    x: offsetX + scale * 0.22,
    y: offsetY - scale * 0.42,
    z: 0,
    visibility: 0.99,
  };
  points[17] = {
    x: offsetX + scale * 0.38,
    y: offsetY - scale * 0.32,
    z: 0,
    visibility: 0.99,
  };
  points[8] = {
    x: offsetX - scale * 0.3,
    y: offsetY - scale * (input?.openPalm ? 1.55 : 1.25),
    z: 0,
    visibility: 0.99,
  };
  points[4] = input?.pinch
    ? {
        x: points[8]!.x + scale * 0.04,
        y: points[8]!.y + scale * 0.03,
        z: 0,
        visibility: 0.99,
      }
    : {
        x: offsetX - scale * 0.92,
        y: offsetY - scale * 0.75,
        z: 0,
        visibility: 0.99,
      };

  if (input?.openPalm) {
    for (const tip of [8, 12, 16, 20]) {
      points[tip] = {
        x: offsetX + (tip - 12) * scale * 0.065,
        y: offsetY - scale * 1.55,
        z: 0,
        visibility: 0.99,
      };
    }
  }
  return points;
}

export function makeSequence(overrides?: Record<string, unknown>) {
  return {
    schemaVersion: "commandcanvas.hand-gesture.dataset/v1",
    sequenceId: "sequence-1",
    sessionId: "session-1",
    participantKey: "participant-a",
    recordedAt: "2026-09-02T12:00:00.000Z",
    label: "point",
    provenance: {
      kind: "first_party_consent",
      consent: {
        explicit: true,
        purpose: "gesture_model_training",
        noticeVersion: "2026-09-02",
        grantedAt: "2026-09-02T11:59:50.000Z",
        rawFramesRetained: false,
      },
      productionEligible: true,
    },
    context: {
      interactionMode: "manipulate",
      targetPresent: false,
      selectedObjectPresent: false,
      edgeZone: "none",
    },
    engineSource: "local-mediapipe",
    frames: Array.from({ length: 5 }, (_, index) => ({
      elapsedMs: index * 16,
      hands: [
        {
          trackId: "right-1",
          handedness: "right",
          confidence: 0.98,
          landmarks: makeLandmarks({ offsetX: 0.45 + index * 0.01 }),
        },
      ],
    })),
    ...overrides,
  };
}
