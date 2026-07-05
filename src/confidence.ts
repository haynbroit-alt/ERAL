/**
 * ERAL — The Logic Matrix (Section B)
 *
 * Exact, deterministic rules for turning a DomState into a confidence score
 * and a ternary gating decision. No heuristics beyond what is written here.
 */

import {
  ConfidenceVector,
  ConfidenceWeights,
  DEFAULT_WEIGHTS,
  DomState,
  GATING_THRESHOLDS,
  RiskClass,
} from "./types.js";

/**
 * Derives the three sub-scores from a raw DOM observation.
 *
 * S_dom  — decays with mutation count and layout shift within the local window.
 * R_inter — 1.0 if an interrupt is present or the target isn't ready, else 0.
 * N_state — decays while network requests are still pending.
 */
export function deriveConfidenceVector(dom: DomState): ConfidenceVector {
  const sDom = clamp01(
    1 - clamp01(dom.mutationCount / 20) * 0.6 - clamp01(dom.layoutShiftScore) * 0.4,
  );

  const rInter = dom.interruptPresent || !dom.targetElementReady ? 1 : 0;

  const nState =
    dom.pendingNetworkRequests > 0
      ? clamp01(dom.msSinceNetworkIdle / 3000) * 0.3
      : clamp01(dom.msSinceNetworkIdle / 1000);

  return { sDom, rInter, nState };
}

/**
 * Confidence formula:
 *   C = wDom * S_dom + wInter * (1 - R_inter) + wState * N_state
 *
 * Each term is in [0, 1] and weights sum to 1, so C is always in [0, 1].
 */
export function computeConfidence(
  vector: ConfidenceVector,
  weights: ConfidenceWeights = DEFAULT_WEIGHTS,
): number {
  const { sDom, rInter, nState } = vector;
  const c =
    weights.wDom * clamp01(sDom) +
    weights.wInter * (1 - clamp01(rInter)) +
    weights.wState * clamp01(nState);
  return clamp01(c);
}

/** Ternary gate: SAFE >= 0.85, UNCERTAIN in [0.40, 0.85), RISKY < 0.40. */
export function classify(confidence: number): RiskClass {
  if (confidence >= GATING_THRESHOLDS.safe) return "SAFE";
  if (confidence >= GATING_THRESHOLDS.uncertain) return "UNCERTAIN";
  return "RISKY";
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
