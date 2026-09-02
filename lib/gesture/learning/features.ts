import {
  gestureSequenceSchema,
  type GestureSequence,
} from "@/lib/gesture/learning/dataset";

export const GESTURE_FEATURE_CONTRACT =
  "commandcanvas.gesture-features/v1" as const;
export const HAND_FEATURE_SIZE = 72;
export const FRAME_FEATURE_SIZE = 152;
export const CONTEXT_FEATURE_SIZE = 10;

interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface GestureFeatureVector {
  readonly contract: typeof GESTURE_FEATURE_CONTRACT;
  readonly frameCount: number;
  readonly frameFeatureSize: typeof FRAME_FEATURE_SIZE;
  readonly inputSize: number;
  readonly values: readonly number[];
  readonly twoHandIdentityContinuity: number;
}

export function extractGestureFeatureVector(
  sequenceInput: unknown,
  options: { readonly frameCount: number },
): GestureFeatureVector {
  const sequence = gestureSequenceSchema.parse(sequenceInput);
  if (!Number.isInteger(options.frameCount) || options.frameCount < 2)
    throw new RangeError("Gesture feature extraction needs at least two frames.");

  const sampledFrames = resampleFrames(sequence, options.frameCount);
  const slots = chooseTrackSlots(sequence);
  const initialTwoHandSpan = firstTwoHandSpan(sequence) ?? 1;
  const values: number[] = [];
  let previousIndexTips: Array<Point3 | null> = [null, null];
  let previousMidpoint: Point3 | null = null;

  for (const frame of sampledFrames) {
    const orderedHands = orderHandsIntoSlots(frame.hands, slots);
    const currentTips: Array<Point3 | null> = [null, null];
    for (let slot = 0; slot < 2; slot += 1) {
      const hand = orderedHands[slot];
      if (!hand) {
        values.push(...Array.from({ length: HAND_FEATURE_SIZE }, () => 0));
        continue;
      }
      const scale = palmScale(hand.landmarks);
      const wrist = point3(hand.landmarks[0]!);
      const normalized = hand.landmarks.flatMap((landmark) => [
        rounded((landmark.x - wrist.x) / scale),
        rounded((landmark.y - wrist.y) / scale),
        rounded(((landmark.z ?? 0) - wrist.z) / scale),
      ]);
      const indexTip = point3(hand.landmarks[8]!);
      currentTips[slot] = indexTip;
      const priorTip = previousIndexTips[slot];
      const velocity = priorTip
        ? {
            x: (indexTip.x - priorTip.x) / scale,
            y: (indexTip.y - priorTip.y) / scale,
          }
        : { x: 0, y: 0 };
      values.push(
        1,
        hand.handedness === "left" ? 1 : 0,
        hand.handedness === "right" ? 1 : 0,
        hand.handedness === "unknown" ? 1 : 0,
        rounded(hand.confidence),
        ...normalized,
        rounded(distance(hand.landmarks[4]!, hand.landmarks[8]!) / scale),
        rounded(
          [8, 12, 16, 20]
            .map((index) => distance(hand.landmarks[0]!, hand.landmarks[index]!))
            .reduce((sum, value) => sum + value, 0) /
            4 /
            scale,
        ),
        rounded(velocity.x),
        rounded(velocity.y),
      );
    }
    previousIndexTips = currentTips;

    const present = orderedHands.filter(Boolean);
    if (present.length === 2) {
      const leftWrist = point3(present[0]!.landmarks[0]!);
      const rightWrist = point3(present[1]!.landmarks[0]!);
      const dx = rightWrist.x - leftWrist.x;
      const dy = rightWrist.y - leftWrist.y;
      const span = Math.hypot(dx, dy);
      const midpoint = {
        x: (leftWrist.x + rightWrist.x) / 2,
        y: (leftWrist.y + rightWrist.y) / 2,
        z: 0,
      };
      values.push(
        1,
        rounded(dx / initialTwoHandSpan),
        rounded(dy / initialTwoHandSpan),
        rounded(span / initialTwoHandSpan),
        rounded(Math.sin(Math.atan2(dy, dx))),
        rounded(Math.cos(Math.atan2(dy, dx))),
        rounded(previousMidpoint ? (midpoint.x - previousMidpoint.x) / initialTwoHandSpan : 0),
        rounded(previousMidpoint ? (midpoint.y - previousMidpoint.y) / initialTwoHandSpan : 0),
      );
      previousMidpoint = midpoint;
    } else {
      values.push(present.length / 2, 0, 0, 0, 0, 0, 0, 0);
      previousMidpoint = null;
    }
  }

  values.push(...contextFeatures(sequence));
  const inputSize = options.frameCount * FRAME_FEATURE_SIZE + CONTEXT_FEATURE_SIZE;
  if (values.length !== inputSize)
    throw new Error(
      `Gesture feature contract emitted ${values.length} values; expected ${inputSize}.`,
    );
  return {
    contract: GESTURE_FEATURE_CONTRACT,
    frameCount: options.frameCount,
    frameFeatureSize: FRAME_FEATURE_SIZE,
    inputSize,
    values,
    twoHandIdentityContinuity: computeTwoHandIdentityContinuity(sequence),
  };
}

export function computeTwoHandIdentityContinuity(sequenceInput: unknown): number {
  const sequence = gestureSequenceSchema.parse(sequenceInput);
  const frames = sequence.frames.filter((frame) => frame.hands.length === 2);
  if (frames.length < 2) return 1;
  let preserved = 0;
  let possible = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const prior = new Set(frames[index - 1]!.hands.map((hand) => hand.trackId));
    for (const hand of frames[index]!.hands) {
      possible += 1;
      if (prior.has(hand.trackId)) preserved += 1;
    }
  }
  return rounded(preserved / possible);
}

function resampleFrames(sequence: GestureSequence, frameCount: number) {
  if (frameCount === sequence.frames.length) return sequence.frames;
  return Array.from({ length: frameCount }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (sequence.frames.length - 1)) / (frameCount - 1),
    );
    return sequence.frames[sourceIndex]!;
  });
}

function chooseTrackSlots(sequence: GestureSequence) {
  const firstSeen = new Map<string, { handedness: string; order: number }>();
  for (const frame of sequence.frames) {
    for (const hand of frame.hands) {
      if (!firstSeen.has(hand.trackId))
        firstSeen.set(hand.trackId, {
          handedness: hand.handedness,
          order: firstSeen.size,
        });
    }
  }
  return [...firstSeen.entries()]
    .sort(([, left], [, right]) => {
      const handednessDelta = handednessRank(left.handedness) - handednessRank(right.handedness);
      return handednessDelta || left.order - right.order;
    })
    .slice(0, 2)
    .map(([trackId]) => trackId);
}

function orderHandsIntoSlots(
  hands: GestureSequence["frames"][number]["hands"],
  slots: readonly string[],
) {
  const ordered: Array<(typeof hands)[number] | null> = [null, null];
  const unassigned = [...hands];
  for (let slot = 0; slot < 2; slot += 1) {
    const index = unassigned.findIndex((hand) => hand.trackId === slots[slot]);
    if (index >= 0) ordered[slot] = unassigned.splice(index, 1)[0]!;
  }
  for (const hand of unassigned) {
    const preferred = hand.handedness === "left" ? 0 : hand.handedness === "right" ? 1 : -1;
    if (preferred >= 0 && !ordered[preferred]) ordered[preferred] = hand;
    else {
      const open = ordered.findIndex((entry) => !entry);
      if (open >= 0) ordered[open] = hand;
    }
  }
  return ordered;
}

function firstTwoHandSpan(sequence: GestureSequence) {
  const frame = sequence.frames.find((candidate) => candidate.hands.length === 2);
  if (!frame) return null;
  const span = distance(frame.hands[0]!.landmarks[0]!, frame.hands[1]!.landmarks[0]!);
  return span > 1e-6 ? span : 1;
}

function contextFeatures(sequence: GestureSequence) {
  return [
    sequence.context.interactionMode === "draw" ? 1 : 0,
    sequence.context.interactionMode === "manipulate" ? 1 : 0,
    sequence.context.interactionMode === "navigate" ? 1 : 0,
    sequence.context.targetPresent ? 1 : 0,
    sequence.context.selectedObjectPresent ? 1 : 0,
    sequence.context.edgeZone === "none" ? 1 : 0,
    sequence.context.edgeZone === "left" ? 1 : 0,
    sequence.context.edgeZone === "right" ? 1 : 0,
    sequence.context.edgeZone === "top" ? 1 : 0,
    sequence.context.edgeZone === "bottom" ? 1 : 0,
  ];
}

function palmScale(landmarks: GestureSequence["frames"][number]["hands"][number]["landmarks"]) {
  const candidates = [
    distance(landmarks[5]!, landmarks[17]!),
    distance(landmarks[0]!, landmarks[9]!) * 0.9,
    distance(landmarks[0]!, landmarks[5]!),
    distance(landmarks[0]!, landmarks[17]!) * 0.7,
  ]
    .filter((value) => Number.isFinite(value) && value > 0.005)
    .sort((left, right) => left - right);
  if (candidates.length === 0) return 0.000_001;
  const midpoint = Math.floor(candidates.length / 2);
  return candidates.length % 2
    ? candidates[midpoint]!
    : (candidates[midpoint - 1]! + candidates[midpoint]!) / 2;
}

function handednessRank(handedness: string) {
  return handedness === "left" ? 0 : handedness === "right" ? 1 : 2;
}

function point3(point: { readonly x: number; readonly y: number; readonly z?: number }): Point3 {
  return { x: point.x, y: point.y, z: point.z ?? 0 };
}

function distance(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
