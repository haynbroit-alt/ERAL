/**
 * ERAL — Structural Architecture (Section A)
 *
 * Typed data models for the Observation -> Simulation -> Selection pipeline
 * described in the Mirror Engine architecture. No runtime logic lives here.
 */

/** Local-horizon snapshot of a single DOM/network observation (500ms-3s window). */
export interface DomState {
  /** Timestamp (ms epoch) the snapshot was taken. */
  observedAt: number;
  /** Mutation count observed in the trailing sample window. */
  mutationCount: number;
  /** Cumulative Layout Shift-style score over the sample window (0 = static). */
  layoutShiftScore: number;
  /** Pending network requests (fetch/XHR) not yet settled. */
  pendingNetworkRequests: number;
  /** Milliseconds since the last network request settled. */
  msSinceNetworkIdle: number;
  /** Whether a modal, overlay, cookie banner, or focus-stealing element is present. */
  interruptPresent: boolean;
  /** Whether the target element (if any) is attached, visible, and not obscured. */
  targetElementReady: boolean;
}

/** An atomic, mechanical action to perform once gating clears it. */
export interface Task {
  id: string;
  /** Human-readable description of the atom, e.g. "type content into Notion editor". */
  description: string;
  /** CSS/ARIA selector or locator string the runtime script will act on. */
  targetSelector: string;
  /** The mechanical action kind. */
  kind: "click" | "type" | "extract" | "wait" | "navigate";
  /** Payload for "type" (text) or "navigate" (url); unused otherwise. */
  payload?: string;
}

/** The three independent sub-scores that compose the confidence formula. */
export interface ConfidenceVector {
  /** S_dom: DOM stability, in [0, 1]. 1 = fully settled, no mutations/layout shift. */
  sDom: number;
  /** R_inter: risk of an interrupt (modal/overlay/focus-steal), in [0, 1]. 0 = no risk. */
  rInter: number;
  /** N_state: network calm, in [0, 1]. 1 = fully idle. */
  nState: number;
}

/** Relative weights applied to the three sub-scores; must sum to 1. */
export interface ConfidenceWeights {
  wDom: number;
  wInter: number;
  wState: number;
}

export const DEFAULT_WEIGHTS: ConfidenceWeights = {
  wDom: 0.4,
  wInter: 0.3,
  wState: 0.3,
};

/** Ternary classification of the composed confidence score. */
export type RiskClass = "SAFE" | "UNCERTAIN" | "RISKY";

export const GATING_THRESHOLDS = {
  safe: 0.85,
  uncertain: 0.4,
} as const;

/** Finite state machine driving a single task through the pipeline. */
export type ExecutionState =
  | "OBSERVING"
  | "SIMULATING"
  | "SELECTING"
  | "GATED_SAFE"
  | "GATED_UNCERTAIN"
  | "GATED_RISKY"
  | "EXECUTING"
  | "SETTLED"
  | "FALLBACK"
  | "ABORTED";

/**
 * Result of a shadow-clone counterfactual: "if the detected interrupt(s)
 * were removed, would the target settle into a safely actionable state?"
 * Produced by `simulateInterruptRemoval` (see src/simulate.ts). This is a
 * structural dry-run against a cloned DOM, not a prediction of the live
 * page's future — it never touches the real page.
 */
export interface SimulationResult {
  /** Whether the target becomes ready (visible, centered, unobscured) once known interrupts are stripped from the clone. */
  wouldClearIfInterruptsRemoved: boolean;
  /** Absolute pixel delta of the target's bounding-box center, live vs. clone-with-interrupts-removed. Large values mean removing the interrupt would itself reflow the page significantly. */
  layoutShiftDelta: number;
}

export interface ExecutionOutcome {
  taskId: string;
  finalState: ExecutionState;
  /** Final, possibly registry-calibrated confidence used for gating (see ConfidenceVector for the raw instantaneous sub-scores). */
  confidence: number;
  riskClass: RiskClass;
  success: boolean;
  /** Present when finalState is FALLBACK or ABORTED. */
  reason?: string;
  observedAt: number;
  /** Present only when a non-SAFE decision was enriched via `ExecuteOptions.simulate`. */
  simulation?: SimulationResult;
}
