import type { GestureLabel } from "@/lib/gesture/learning/dataset";
import {
  classifyGestureSequence,
  type TemporalGestureModel,
} from "@/lib/gesture/learning/model";

const CANONICAL_STATE_MACHINE_ONLY = new Set<GestureLabel>([
  "throw",
  "minimize",
  "bimanual_resize",
  "bimanual_zoom",
  "bimanual_rotate",
]);

export type LearnedGestureDecision =
  | {
      readonly accepted: true;
      readonly prediction: { readonly label: GestureLabel; readonly confidence: number };
    }
  | {
      readonly accepted: false;
      readonly reason:
        | "model_not_promoted"
        | "low_confidence"
        | "requires_canonical_edge_state_machine";
      readonly prediction: { readonly label: GestureLabel; readonly confidence: number };
    };

/**
 * Converts model output into a refusal-capable observation only. This adapter
 * never dispatches a canvas command. Acquisition, bimanual transforms, edge
 * dwell, release, trash, and undo stay inside the canonical gesture reducer.
 */
export function classifyGestureWithRefusal(
  model: TemporalGestureModel,
  sequence: unknown,
  options: { readonly minConfidence: number },
): LearnedGestureDecision {
  if (
    !Number.isFinite(options.minConfidence) ||
    options.minConfidence < 0 ||
    options.minConfidence > 1
  )
    throw new RangeError("Learned gesture minConfidence must be between 0 and 1.");
  const result = classifyGestureSequence(model, sequence);
  const prediction = { label: result.label, confidence: result.confidence };
  if (!model.productionEligible || model.training.validationStatus !== "held_out_evaluated")
    return { accepted: false, reason: "model_not_promoted", prediction };
  if (result.confidence < options.minConfidence)
    return { accepted: false, reason: "low_confidence", prediction };
  if (CANONICAL_STATE_MACHINE_ONLY.has(result.label))
    return {
      accepted: false,
      reason: "requires_canonical_edge_state_machine",
      prediction,
    };
  return { accepted: true, prediction };
}
