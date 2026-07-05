/**
 * ERAL — Offline Calibration (Pillar 3)
 *
 * The feedback loop in feedback.ts nudges weights by a fixed 0.02 delta per
 * call — a toy online rule that oscillates rather than converges. This
 * module is the real learning loop: given a corpus of (ConfidenceVector,
 * actualSuccess) observations collected via `ExecuteOptions.onTrace`, it
 * grid-searches the weight simplex for the assignment that best predicts
 * real outcomes, scored by binary log-loss (confidence treated as a
 * predicted probability of success). Pure math, no I/O — see
 * scripts/calibrate.ts for the file-reading CLI that uses this.
 */

import { computeConfidence } from "./confidence.js";
import { TraceRecord } from "./engine.js";
import { ConfidenceWeights } from "./types.js";

const EPSILON = 1e-6;

/** Binary log-loss of `weights` against the observed corpus; lower is better. */
export function averageLogLoss(traces: TraceRecord[], weights: ConfidenceWeights): number {
  if (traces.length === 0) return 0;
  let total = 0;
  for (const { vector, success } of traces) {
    const p = Math.min(1 - EPSILON, Math.max(EPSILON, computeConfidence(vector, weights)));
    total += success ? -Math.log(p) : -Math.log(1 - p);
  }
  return total / traces.length;
}

export interface CalibrationResult {
  weights: ConfidenceWeights;
  logLoss: number;
  /** Number of (wDom, wInter, wState) simplex points evaluated. */
  candidatesEvaluated: number;
}

/**
 * Grid-searches the weight simplex (wDom + wInter + wState = 1, each a
 * multiple of `step`) for the point minimizing average log-loss against
 * `traces`. O((1/step)^2) candidates — step=0.05 is ~231 evaluations,
 * cheap enough to run on every calibration pass with no gradient code.
 */
export function calibrateWeights(traces: TraceRecord[], step = 0.05): CalibrationResult {
  let best: ConfidenceWeights = { wDom: 0.4, wInter: 0.3, wState: 0.3 };
  let bestLoss = Infinity;
  let candidatesEvaluated = 0;

  const steps = Math.round(1 / step);
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps - i; j++) {
      const wDom = i * step;
      const wInter = j * step;
      const wState = 1 - wDom - wInter;
      if (wState < -EPSILON) continue;
      const weights: ConfidenceWeights = { wDom, wInter, wState: Math.max(0, wState) };
      const loss = averageLogLoss(traces, weights);
      candidatesEvaluated += 1;
      if (loss < bestLoss) {
        bestLoss = loss;
        best = weights;
      }
    }
  }

  return { weights: best, logLoss: bestLoss, candidatesEvaluated };
}
