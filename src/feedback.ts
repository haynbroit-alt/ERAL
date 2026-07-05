/**
 * ERAL — Feedback Loop (Section D)
 *
 * Post-execution correction signal: nudges the confidence weights based on
 * whether the last gated decision matched reality. Pure local delta-update,
 * no external learning service.
 */

import { ConfidenceWeights, ExecutionOutcome, RiskClass } from "./types.js";

export interface FeedbackSignal {
  taskId: string;
  riskClass: RiskClass;
  /** Did the mechanical action actually succeed once attempted? */
  actualSuccess: boolean;
  confidence: number;
}

export interface FeedbackAdjustment {
  weights: ConfidenceWeights;
  /** Positive = system was too conservative; negative = too optimistic. */
  delta: number;
}

/** Learning rate for the local weight-nudge; small and bounded on purpose. */
const LEARNING_RATE = 0.02;

export function toSignal(outcome: ExecutionOutcome): FeedbackSignal {
  return {
    taskId: outcome.taskId,
    riskClass: outcome.riskClass,
    actualSuccess: outcome.success,
    confidence: outcome.confidence,
  };
}

/**
 * Adjusts confidence weights after observing a real outcome:
 * - SAFE that failed  -> shrink weights (system was overconfident).
 * - RISKY/UNCERTAIN that would have succeeded (actualSuccess true via fallback
 *   or confirmed run) -> grow weights slightly (system was overcautious).
 * Weights are re-normalized to sum to 1 after every adjustment.
 */
export function adjustWeights(
  weights: ConfidenceWeights,
  signal: FeedbackSignal,
): FeedbackAdjustment {
  let delta = 0;
  if (signal.riskClass === "SAFE" && !signal.actualSuccess) {
    delta = -LEARNING_RATE;
  } else if (signal.riskClass !== "SAFE" && signal.actualSuccess) {
    delta = LEARNING_RATE;
  }

  if (delta === 0) {
    return { weights, delta };
  }

  const nudged: ConfidenceWeights = {
    wDom: weights.wDom + delta * 0.4,
    wInter: weights.wInter + delta * 0.3,
    wState: weights.wState + delta * 0.3,
  };

  return { weights: normalize(nudged), delta };
}

function normalize(w: ConfidenceWeights): ConfidenceWeights {
  const sum = Math.max(1e-6, w.wDom + w.wInter + w.wState);
  return { wDom: w.wDom / sum, wInter: w.wInter / sum, wState: w.wState / sum };
}
