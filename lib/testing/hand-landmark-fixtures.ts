import type {
  HandLandmark,
  HandLandmarks,
} from "@/lib/gesture/hand-landmark-contract";

export type RawHandPose =
  | "relaxed_index"
  | "open_palm"
  | "fist"
  | "pinch";

export interface RawHandFixtureOptions {
  readonly pose: RawHandPose;
  readonly indexTip?: { readonly x: number; readonly y: number };
  readonly thumbTip?: { readonly x: number; readonly y: number };
  readonly supportVisibility?: number;
  readonly indexVisibility?: number;
  readonly thumbVisibility?: number;
  readonly offsetX?: number;
  readonly offsetY?: number;
}

/**
 * Deterministic MediaPipe-order 21-landmark fixtures. Behavioral gesture tests
 * use these camera observations rather than starting from semantic modes.
 */
export function rawHandLandmarks({
  pose,
  indexTip = { x: 0.5, y: 0.22 },
  thumbTip,
  supportVisibility = 0.98,
  indexVisibility = 0.99,
  thumbVisibility = 0.99,
  offsetX = 0,
  offsetY = 0,
}: RawHandFixtureOptions): HandLandmarks {
  const point = (x: number, y: number, visibility = 0.99): HandLandmark => ({
    x,
    y,
    z: 0,
    visibility,
  });
  const landmarks = Array.from({ length: 21 }, () => point(0.5, 0.72));
  landmarks[0] = point(0.5, 0.9);
  landmarks[1] = point(0.43, 0.82);
  landmarks[2] = point(0.36, 0.74);
  landmarks[3] = point(0.29, 0.67);
  landmarks[5] = point(0.42, 0.68, indexVisibility);
  landmarks[9] = point(0.5, 0.67, supportVisibility);
  landmarks[13] = point(0.58, 0.69, supportVisibility);
  landmarks[17] = point(0.66, 0.73, supportVisibility);

  if (pose === "fist") {
    landmarks[6] = point(0.4, 0.62, indexVisibility);
    landmarks[7] = point(0.47, 0.57, indexVisibility);
    landmarks[8] = point(0.43, 0.55, indexVisibility);
  } else {
    landmarks[6] = interpolate(landmarks[5]!, indexTip, 0.34, indexVisibility);
    landmarks[7] = interpolate(landmarks[5]!, indexTip, 0.67, indexVisibility);
    landmarks[8] = point(indexTip.x, indexTip.y, indexVisibility);
  }

  if (pose === "open_palm") {
    setFinger(landmarks, 10, 11, 12, 0.5, supportVisibility, [0.5, 0.33, 0.16]);
    setFinger(landmarks, 14, 15, 16, 0.59, supportVisibility, [0.52, 0.35, 0.19]);
    setFinger(landmarks, 18, 19, 20, 0.68, supportVisibility, [0.57, 0.43, 0.3]);
  } else {
    setFinger(landmarks, 10, 11, 12, 0.5, supportVisibility, [0.55, 0.64, 0.74]);
    setFinger(landmarks, 14, 15, 16, 0.59, supportVisibility, [0.57, 0.67, 0.77]);
    setFinger(landmarks, 18, 19, 20, 0.68, supportVisibility, [0.62, 0.71, 0.8]);
  }

  const resolvedThumb =
    thumbTip ??
    (pose === "pinch"
      ? { x: indexTip.x + 0.018, y: indexTip.y + 0.004 }
      : pose === "open_palm"
        ? { x: 0.22, y: 0.5 }
        : { x: 0.27, y: 0.63 });
  landmarks[4] = point(resolvedThumb.x, resolvedThumb.y, thumbVisibility);

  return landmarks.map((landmark) => ({
    ...landmark,
    x: landmark.x + offsetX,
    y: landmark.y + offsetY,
  })) as unknown as HandLandmarks;
}

function setFinger(
  landmarks: HandLandmark[],
  pip: number,
  dip: number,
  tip: number,
  x: number,
  visibility: number,
  ys: readonly [number, number, number],
) {
  landmarks[pip] = { x, y: ys[0], z: 0, visibility };
  landmarks[dip] = { x, y: ys[1], z: 0, visibility };
  landmarks[tip] = { x, y: ys[2], z: 0, visibility };
}

function interpolate(
  from: HandLandmark,
  to: { readonly x: number; readonly y: number },
  amount: number,
  visibility: number,
): HandLandmark {
  return {
    x: from.x + (to.x - from.x) * amount,
    y: from.y + (to.y - from.y) * amount,
    z: 0,
    visibility,
  };
}
