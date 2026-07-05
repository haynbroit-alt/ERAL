/**
 * Worked atom: "Click the Publish button on Ghost CMS without triggering modals."
 *
 * Ghost's publish flow opens a confirmation popover ("Publish now" / schedule
 * picker) right after the click; the RISKY snapshot below models a click
 * attempted while that popover from a *previous* interaction is still
 * settling, which is exactly the kind of double-modal race ERAL is meant to
 * catch before it fires.
 */

import { DomState, Task } from "../src/index.js";
import { runScenarios } from "./_harness.js";

const clickPublish: Task = {
  id: "ghost-publish",
  description: "Click the Publish button once the editor has no pending autosave and no open popover",
  targetSelector: '[data-test-button="publish-save"]',
  kind: "click",
};

const snapshots: Record<"safe" | "uncertain" | "risky", DomState> = {
  safe: {
    observedAt: Date.now(),
    mutationCount: 1,
    layoutShiftScore: 0,
    pendingNetworkRequests: 0,
    msSinceNetworkIdle: 2000, // autosave settled
    interruptPresent: false,
    targetElementReady: true,
  },
  uncertain: {
    observedAt: Date.now(),
    mutationCount: 4,
    layoutShiftScore: 0.1,
    pendingNetworkRequests: 1, // autosave PATCH still in flight
    msSinceNetworkIdle: 300,
    interruptPresent: false,
    targetElementReady: true,
  },
  risky: {
    observedAt: Date.now(),
    mutationCount: 10,
    layoutShiftScore: 0.25,
    pendingNetworkRequests: 2,
    msSinceNetworkIdle: 80,
    interruptPresent: true, // publish confirmation popover still open from last click
    targetElementReady: false,
  },
};

runScenarios(clickPublish, snapshots);
