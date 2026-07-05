/**
 * Worked demo for Pillar 2 (shadow-clone trajectory simulation).
 *
 * A real Chromium page has a promo dialog covering the editor. On raw DOM
 * signal alone that's a RISKY/UNCERTAIN gate (interrupt present) exactly
 * like Pillar-0 ERAL would produce. But `simulateInterruptRemoval` clones
 * the live document into a detached iframe, strips the dialog there, and
 * checks whether the editor would actually become clickable with a small
 * layout shift — i.e. "is this a clean, safe-to-wait-for blocker, or
 * something structurally worse?" — before the fallback handler decides
 * whether to wait-and-retry or defer.
 *
 * Runs via tsc + node (see package.json `demo:simulate`): tsx's esbuild
 * transform injects `__name()` helper calls that break when a function
 * is serialized for page.evaluate.
 */

import { chromium } from "playwright";
import { execute, Task } from "../src/index.js";
import { NetworkIdleTracker, sampleDomState } from "../src/playwright-driver.js";
import { simulateInterruptRemoval } from "../src/simulate.js";

const INTERRUPT_SELECTORS = ['[role="dialog"]'];

const PAGE_WITH_TRANSIENT_OVERLAY = `
<!doctype html><html><body>
  <div id="editor" contenteditable="true" style="width:300px;height:100px;border:1px solid #333;">Ready</div>
  <div role="dialog" id="promo"
       style="position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;">
    <button id="close-promo">Close</button>
  </div>
</body></html>`;

async function main() {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    const tracker = new NetworkIdleTracker(page);
    await page.setContent(PAGE_WITH_TRANSIENT_OVERLAY);

    const task: Task = {
      id: "simulate-demo",
      description: "Type into the editor once ERAL confirms it's safe, or once simulation proves the overlay is a clean transient blocker",
      targetSelector: "#editor",
      kind: "type",
      payload: "hello",
    };

    const dom = await sampleDomState(page, "#editor", tracker, { windowMs: 500 });

    const outcome = await execute(task, dom, {
      simulate: (t) => simulateInterruptRemoval(page, t, INTERRUPT_SELECTORS),
      fallback: (_t, confidence, simulation) => {
        console.log(`  [FALLBACK] C=${confidence.toFixed(2)}, simulation=${JSON.stringify(simulation)}`);
        if (simulation?.wouldClearIfInterruptsRemoved && simulation.layoutShiftDelta < 20) {
          console.log("  [FALLBACK] clean transient blocker -> safe to wait and retry");
          return true;
        }
        console.log("  [FALLBACK] inconclusive or high layout disruption -> deferring");
        return false;
      },
    });

    console.log(`dom=${JSON.stringify(dom)}`);
    console.log(`outcome=${JSON.stringify(outcome)}`);
  } finally {
    await browser.close();
  }
}

main();
