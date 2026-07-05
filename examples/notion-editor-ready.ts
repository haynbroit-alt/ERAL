/**
 * Worked atom: "Detect if the Notion editor is ready and type content into it."
 *
 * Demonstrates the full A -> D pipeline against three DomState snapshots
 * (SAFE, UNCERTAIN, RISKY) without any browser dependency. A real Playwright
 * integration would replace these snapshots with `sampleDomState` from
 * `src/playwright-driver.ts`, and the `runAction` hook with
 * `page.locator(task.targetSelector).type(task.payload)`.
 */

import { DomState, Task } from "../src/index.js";
import { runScenarios } from "./_harness.js";

const typeIntoNotion: Task = {
  id: "notion-type",
  description: "Type content into the Notion editor once it is stable and focused",
  targetSelector: '[contenteditable="true"].notion-page-content',
  kind: "type",
  payload: "Meeting notes: ERAL v1.0 review",
};

const snapshots: Record<"safe" | "uncertain" | "risky", DomState> = {
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

runScenarios(typeIntoNotion, snapshots);
