/**
 * ERAL — The Constrained Runtime Script (Section C)
 *
 * Single entry point: execute(task, domState, options). Mechanical and
 * idempotent — calling it twice against an unchanged DomState produces the
 * same ExecutionOutcome and never re-runs a settled action.
 */

import { classify, computeConfidence, deriveConfidenceVector } from "./confidence.js";
import {
  ConfidenceWeights,
  DEFAULT_WEIGHTS,
  DomState,
  ExecutionOutcome,
  ExecutionState,
  Task,
} from "./types.js";

/** The mechanical action applied once gating clears a task. Zero intelligence. */
export type RunAction = (task: Task) => Promise<boolean> | boolean;

export interface ExecuteOptions {
  weights?: ConfidenceWeights;
  /** Invoked only when the task is SAFE (or UNCERTAIN + confirmed). Required to have any effect. */
  runAction?: RunAction;
  /** Invoked for UNCERTAIN tasks to request human-in-the-loop or delayed-retry approval. */
  confirm?: (task: Task, confidence: number) => Promise<boolean> | boolean;
  /** Invoked for RISKY tasks (or declined UNCERTAIN tasks) instead of aborting outright. */
  fallback?: (task: Task, confidence: number) => Promise<boolean> | boolean;
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

  let state: ExecutionState = "OBSERVING";
  state = "SIMULATING";
  const vector = deriveConfidenceVector(domState);
  state = "SELECTING";
  const confidence = computeConfidence(vector, weights);
  const riskClass = classify(confidence);

  let finalState: ExecutionState;
  let success = false;
  let reason: string | undefined;

  if (riskClass === "SAFE") {
    state = "GATED_SAFE";
    state = "EXECUTING";
    success = await runOrDefault(options.runAction, task);
    finalState = success ? "SETTLED" : "ABORTED";
    if (!success) reason = "runAction returned false";
  } else if (riskClass === "UNCERTAIN") {
    state = "GATED_UNCERTAIN";
    const confirmed = options.confirm ? await options.confirm(task, confidence) : false;
    if (confirmed) {
      state = "EXECUTING";
      success = await runOrDefault(options.runAction, task);
      finalState = success ? "SETTLED" : "ABORTED";
      if (!success) reason = "runAction returned false";
    } else if (options.fallback) {
      success = await options.fallback(task, confidence);
      finalState = success ? "FALLBACK" : "ABORTED";
      reason = success ? "uncertain: fallback executed" : "uncertain: fallback failed";
    } else {
      finalState = "ABORTED";
      reason = "uncertain: no confirmation and no fallback provided";
    }
  } else {
    state = "GATED_RISKY";
    if (options.fallback) {
      success = await options.fallback(task, confidence);
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
