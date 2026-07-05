/**
 * Worked atom: "Compose and submit a LinkedIn post without tripping anti-bot
 * friction (share-box re-render, connection-request interstitials)."
 *
 * LinkedIn's share box frequently re-mounts its contenteditable node after
 * an image/link preview finishes loading; typing into the stale reference
 * mid-remount is the classic RPA "Casse aux mises à jour" failure mode from
 * the pitch deck's market segment table.
 */

import { DomState, Task } from "../src/index.js";
import { runScenarios } from "./_harness.js";

const submitPost: Task = {
  id: "linkedin-post",
  description: "Type the post body once the share-box editor has stopped re-rendering",
  targetSelector: '.share-box-feed-entry__wrapper [contenteditable="true"]',
  kind: "type",
  payload: "Excited to ship ERAL v1.0 — deterministic gating for web automation.",
};

const snapshots: Record<"safe" | "uncertain" | "risky", DomState> = {
  safe: {
    observedAt: Date.now(),
    mutationCount: 0,
    layoutShiftScore: 0,
    pendingNetworkRequests: 0,
    msSinceNetworkIdle: 1500,
    interruptPresent: false,
    targetElementReady: true,
  },
  uncertain: {
    observedAt: Date.now(),
    mutationCount: 5,
    layoutShiftScore: 0.12,
    pendingNetworkRequests: 1, // link-preview fetch still resolving
    msSinceNetworkIdle: 350,
    interruptPresent: false,
    targetElementReady: true,
  },
  risky: {
    observedAt: Date.now(),
    mutationCount: 18, // share-box actively re-rendering
    layoutShiftScore: 0.5,
    pendingNetworkRequests: 3,
    msSinceNetworkIdle: 40,
    interruptPresent: true, // "Grow your network" interstitial surfaced
    targetElementReady: false,
  },
};

runScenarios(submitPost, snapshots);
