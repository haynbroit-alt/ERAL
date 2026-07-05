/**
 * Worked atom: "Detect if the Notion editor is ready and type content into it."
 *
 * Demonstrates the full A -> D pipeline against three DomState snapshots
 * (SAFE, UNCERTAIN, RISKY) without any browser dependency. A real Playwright
 * integration would replace `sampleDomState` with an actual 500ms-3s
 * MutationObserver/PerformanceObserver sample, and `runAction` with
 * `page.locator(task.targetSelector).type(task.payload)`.
 */

import {
  DEFAULT_WEIGHTS,
  DomState,
  Task,
  adjustWeights,
  execute,
  toSignal,
} from "../src/index.js";

const typeIntoNotion: Task = {
  id: "notion-type-001",
  description: "Type content into the Notion editor once it is stable and focused",
  targetSelector: '[contenteditable="true"].notion-page-content',
  kind: "type",
  payload: "Meeting notes: ERAL v1.0 review",
};

const snapshots: Record<string, DomState> = {
  safe: {
    observedAt: Date.now(),
    mutationCount: 0,
    layoutShiftScore: 0,
    pendingNetworkRequests: 0,
    msSinceNetworkIdle: 1200,
    interruptPresent: false,
    targetElementReady: true,
  },
  uncertain: {
    observedAt: Date.now(),
    mutationCount: 6,
    layoutShiftScore: 0.15,
    pendingNetworkRequests: 1,
    msSinceNetworkIdle: 400,
    interruptPresent: false,
    targetElementReady: true,
  },
  risky: {
    observedAt: Date.now(),
    mutationCount: 14,
    layoutShiftScore: 0.4,
    pendingNetworkRequests: 3,
    msSinceNetworkIdle: 50,
    interruptPresent: true, // e.g. a "Enable notifications?" modal just appeared
    targetElementReady: false,
  },
};

async function runOnce(label: string, dom: DomState, taskId: string) {
  const task = { ...typeIntoNotion, id: taskId };

  const outcome = await execute(task, dom, {
    runAction: (t) => {
      console.log(`  [ACTION] typing "${t.payload}" into ${t.targetSelector}`);
      return true;
    },
    confirm: async (_t, confidence) => {
      console.log(`  [CONFIRM] uncertain at C=${confidence.toFixed(2)}, requesting human check`);
      return false; // no human in the loop for this demo; would prompt in a real run
    },
    fallback: (_t, confidence) => {
      console.log(`  [FALLBACK] logging and deferring retry (C=${confidence.toFixed(2)})`);
      return true;
    },
  });

  console.log(`${label}: ${JSON.stringify(outcome, null, 2)}`);

  const { weights, delta } = adjustWeights(DEFAULT_WEIGHTS, toSignal(outcome));
  if (delta !== 0) {
    console.log(`  [FEEDBACK] delta=${delta}, next weights=${JSON.stringify(weights)}`);
  }
  console.log("");
}

async function main() {
  await runOnce("SAFE case", snapshots.safe, "notion-type-safe");
  await runOnce("UNCERTAIN case", snapshots.uncertain, "notion-type-uncertain");
  await runOnce("RISKY case", snapshots.risky, "notion-type-risky");
}

main();
