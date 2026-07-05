/**
 * ERAL — The Constrained Runtime Script (Section C)
 *
 * Single entry point: execute(task, domState, options). Mechanical and
 * idempotent — calling it twice against an unchanged DomState produces the
 * same ExecutionOutcome and never re-runs a settled action.
 *
 * Beyond the base gate, this wires in the two learning pillars: a
 * `registry` (Digital Twin Registry, src/registry.ts) that calibrates the
 * instantaneous confidence against real historical outcomes for this exact
 * trajectory, and a `simulate` hook (shadow-clone dry-run, src/simulate.ts)
 * that enriches non-SAFE decisions with a structural counterfactual before
 * confirm/fallback logic runs. Both are optional — omit them and this is
 * exactly the stateless v1 gate.
 */

import { calibrateConfidence, classify, computeConfidence, deriveConfidenceVector } from "./confidence.js";
import { RegistryStore, taskToKey, TrajectoryKey } from "./registry.js";
import {
  ConfidenceVector,
  ConfidenceWeights,
  DEFAULT_WEIGHTS,
  DomState,
  ExecutionOutcome,
  ExecutionState,
  SimulationResult,
  Task,
} from "./types.js";

/** The mechanical action applied once gating clears a task. Zero intelligence. */
export type RunAction = (task: Task) => Promise<boolean> | boolean;

/** One observed (vector, real-outcome) pair, fed to onTrace for offline calibration (src/calibration.ts). */
export interface TraceRecord {
  vector: ConfidenceVector;
  success: boolean;
}

export interface ExecuteOptions {
  weights?: ConfidenceWeights;
  /** Invoked only when the task is SAFE (or UNCERTAIN + confirmed). Required to have any effect. */
  runAction?: RunAction;
  /** Invoked for UNCERTAIN tasks to request human-in-the-loop or delayed-retry approval. */
  confirm?: (task: Task, confidence: number, simulation?: SimulationResult) => Promise<boolean> | boolean;
  /** Invoked for RISKY tasks (or declined UNCERTAIN tasks) instead of aborting outright. */
  fallback?: (task: Task, confidence: number, simulation?: SimulationResult) => Promise<boolean> | boolean;
  /** Digital Twin Registry: blends instant confidence with this trajectory's learned success rate. */
  registry?: RegistryStore;
  /** Site identity for the registry key; defaults to "unknown" (all sites share one bucket). */
  domain?: string;
  /** Pseudo-count of trust given to the instantaneous signal before the registry's prior dominates. Default 5. */
  calibrationK?: number;
  /** Shadow-clone counterfactual, run once when the gate is not SAFE. See src/simulate.ts. */
  simulate?: (task: Task, domState: DomState) => Promise<SimulationResult> | SimulationResult;
  /** Fed one (vector, actualSuccess) record whenever runAction is actually attempted. Feeds scripts/calibrate.ts. */
  onTrace?: (record: TraceRecord) => void;
}

const settledTasks = new Map<string, ExecutionOutcome>();

/**
 * Runs one atom through OBSERVING -> SIMULATING -> SELECTING -> gate -> action.
 * "SIMULATING/SELECTING" collapse to a single deterministic scoring pass here;
 * the local-horizon simulation is the responsibility of the DomState producer
 * (the caller samples the DOM/network over the 500ms-3s window before calling).
 */
export async function execute(
  task: Task,
  domState: DomState,
  options: ExecuteOptions = {},
): Promise<ExecutionOutcome> {
  const cached = settledTasks.get(task.id);
  if (cached) return cached; // idempotent: never repeat a settled task

  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const key: TrajectoryKey = taskToKey(task, options.domain ?? "unknown");

  let state: ExecutionState = "OBSERVING";
  state = "SIMULATING";
  const vector = deriveConfidenceVector(domState);
  state = "SELECTING";
  const instantConfidence = computeConfidence(vector, weights);
  const confidence = options.registry
    ? calibrateConfidence(instantConfidence, options.registry.get(key), options.calibrationK)
    : instantConfidence;
  const riskClass = classify(confidence);

  let simulation: SimulationResult | undefined;
  if (riskClass !== "SAFE" && options.simulate) {
    simulation = await options.simulate(task, domState);
  }

  const attempt = async (): Promise<boolean> => {
    const result = await runOrDefault(options.runAction, task);
    options.registry?.record(key, result);
    options.onTrace?.({ vector, success: result });
    return result;
  };

  let finalState: ExecutionState;
  let success = false;
  let reason: string | undefined;

  if (riskClass === "SAFE") {
    state = "GATED_SAFE";
    state = "EXECUTING";
    success = await attempt();
    finalState = success ? "SETTLED" : "ABORTED";
    if (!success) reason = "runAction returned false";
  } else if (riskClass === "UNCERTAIN") {
    state = "GATED_UNCERTAIN";
    const confirmed = options.confirm ? await options.confirm(task, confidence, simulation) : false;
    if (confirmed) {
      state = "EXECUTING";
      success = await attempt();
      finalState = success ? "SETTLED" : "ABORTED";
      if (!success) reason = "runAction returned false";
    } else if (options.fallback) {
      success = await options.fallback(task, confidence, simulation);
      finalState = success ? "FALLBACK" : "ABORTED";
      reason = success ? "uncertain: fallback executed" : "uncertain: fallback failed";
    } else {
      finalState = "ABORTED";
      reason = "uncertain: no confirmation and no fallback provided";
    }
  } else {
    state = "GATED_RISKY";
    if (options.fallback) {
      success = await options.fallback(task, confidence, simulation);
      finalState = success ? "FALLBACK" : "ABORTED";
      reason = success ? "risky: fallback executed" : "risky: fallback failed";
    } else {
      finalState = "ABORTED";
      reason = "risky: safe abort, no fallback provided";
    }
  }

  const outcome: ExecutionOutcome = {
    taskId: task.id,
    finalState,
    confidence,
    riskClass,
    success,
    reason,
    observedAt: domState.observedAt,
    simulation,
  };

  if (finalState === "SETTLED" || finalState === "FALLBACK") {
    settledTasks.set(task.id, outcome);
  }

  return outcome;
}

/** Clears settlement memory; exposed for tests and long-running host processes. */
export function resetEngine(): void {
  settledTasks.clear();
}

async function runOrDefault(action: RunAction | undefined, task: Task): Promise<boolean> {
  if (!action) return false;
  return await action(task);
}
