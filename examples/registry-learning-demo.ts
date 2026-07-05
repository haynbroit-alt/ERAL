/**
 * Worked demo for Pillar 1 (Digital Twin Registry).
 *
 * Models a Ghost "Publish" click where the instantaneous DOM signal is
 * *chronically* borderline: this particular site's autosave PATCH is still
 * technically in flight every single time an operator clicks Publish, so
 * the stateless heuristic reads ~0.65 (UNCERTAIN) on every run, forever,
 * with zero memory. In reality this action succeeds 95% of the time on
 * this site — the DOM signal is a false alarm, not a real risk.
 *
 * A human confirms the first uncertain runs (bootstrapping the registry).
 * As real outcomes accumulate, the registry's learned prior pulls the
 * blended confidence up past the SAFE threshold, and ERAL stops needing a
 * human at all for this exact trajectory — without the instantaneous DOM
 * heuristic ever changing. That's the point: memory, not a smarter guess.
 *
 * Each real attempt is also logged to .eral-data/ghost-publish-traces.jsonl
 * via onTrace; run `npm run calibrate -- .eral-data/ghost-publish-traces.jsonl`
 * afterwards to see Pillar 3 recover weights from this exact corpus.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DomState, InMemoryRegistryStore, Task, execute } from "../src/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACE_PATH = `${__dirname}/../.eral-data/ghost-publish-traces.jsonl`;
mkdirSync(dirname(TRACE_PATH), { recursive: true });

const registry = new InMemoryRegistryStore();
const DOMAIN = "ghost.example.com";
const TRUE_SUCCESS_RATE = 0.95; // ground truth: actually reliable, despite the noisy DOM signal

const chronicallyUncertainDom: DomState = {
  observedAt: Date.now(),
  mutationCount: 4,
  layoutShiftScore: 0.1,
  pendingNetworkRequests: 1, // autosave PATCH that never quite looks "settled" in time
  msSinceNetworkIdle: 300,
  interruptPresent: false,
  targetElementReady: true,
};

async function run(i: number) {
  const task: Task = {
    id: `ghost-publish-run-${i}`,
    description: "Click Publish once ERAL confirms it is safe",
    targetSelector: '[data-test-button="publish-save"]',
    kind: "click",
  };

  const outcome = await execute(task, chronicallyUncertainDom, {
    registry,
    domain: DOMAIN,
    runAction: () => Math.random() < TRUE_SUCCESS_RATE,
    confirm: () => true, // a human bootstraps the first uncertain runs
    onTrace: (record) => appendFileSync(TRACE_PATH, `${JSON.stringify(record)}\n`),
  });

  const stats = registry.get({ domain: DOMAIN, selectorPattern: task.targetSelector, actionKind: task.kind });
  console.log(
    `run ${String(i).padStart(2)}: confidence=${outcome.confidence.toFixed(3)} ` +
      `class=${outcome.riskClass} state=${outcome.finalState} ` +
      `registry=${stats ? `${stats.alpha - 1}/${stats.alpha + stats.beta - 2}` : "none"}`,
  );
}

async function main() {
  for (let i = 1; i <= 30; i++) {
    await run(i);
  }
  console.log(`\nTraces logged to ${TRACE_PATH}`);
  console.log(`Try: npm run calibrate -- ${TRACE_PATH}`);
}

main();
