/**
 * Shared demo harness: runs one Task against SAFE/UNCERTAIN/RISKY DomState
 * snapshots and prints the gated outcome + feedback adjustment for each.
 * Not part of the public API — used only by files under examples/.
 */

import { DEFAULT_WEIGHTS, DomState, Task, adjustWeights, execute, toSignal } from "../src/index.js";

export async function runScenarios(
  baseTask: Task,
  snapshots: Record<"safe" | "uncertain" | "risky", DomState>,
) {
  for (const [label, dom] of Object.entries(snapshots)) {
    const task: Task = { ...baseTask, id: `${baseTask.id}-${label}` };

    const outcome = await execute(task, dom, {
      runAction: (t) => {
        console.log(`  [ACTION] ${t.kind} on ${t.targetSelector}${t.payload ? ` ("${t.payload}")` : ""}`);
        return true;
      },
      confirm: async (_t, confidence) => {
        console.log(`  [CONFIRM] uncertain at C=${confidence.toFixed(2)}, requesting human check`);
        return false;
      },
      fallback: (_t, confidence) => {
        console.log(`  [FALLBACK] logging and deferring retry (C=${confidence.toFixed(2)})`);
        return true;
      },
    });

    console.log(`${label.toUpperCase()} case: ${JSON.stringify(outcome, null, 2)}`);

    const { weights, delta } = adjustWeights(DEFAULT_WEIGHTS, toSignal(outcome));
    if (delta !== 0) {
      console.log(`  [FEEDBACK] delta=${delta}, next weights=${JSON.stringify(weights)}`);
    }
    console.log("");
  }
}
