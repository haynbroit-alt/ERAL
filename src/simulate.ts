/**
 * ERAL — Shadow-Clone Trajectory Simulation (Pillar 2)
 *
 * `execute()` gates on the DOM as it is right now. This module answers a
 * narrower, honestly-scoped counterfactual instead of pretending to predict
 * the live page's future: "if the interrupt(s) ERAL detected were removed,
 * would the target actually settle into an actionable position, and how
 * much would that removal itself disturb the layout?" It answers this by
 * cloning the current document's HTML into a detached, off-screen iframe
 * and measuring there — never touching the real page. This is integration
 * glue (depends on `playwright`), like playwright-driver.ts, not part of
 * the dependency-free core.
 */

import type { Page } from "playwright";
import { SimulationResult, Task } from "./types.js";

const NO_TARGET_SHIFT_SENTINEL = 999_999;

export async function simulateInterruptRemoval(
  page: Page,
  task: Task,
  interruptSelectors: string[],
): Promise<SimulationResult> {
  return page.evaluate(
    ({ targetSelector, interruptSelectors, sentinel }) => {
      const isVisible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none";
      };

      const centerOf = (el: Element): { x: number; y: number } => {
        const rect = el.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      };

      const liveTarget = document.querySelector(targetSelector);
      const liveCenter = liveTarget ? centerOf(liveTarget) : undefined;

      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.style.cssText =
        "position:fixed;top:-10000px;left:-10000px;width:" +
        window.innerWidth +
        "px;height:" +
        window.innerHeight +
        "px;border:0;";
      document.body.appendChild(iframe);

      try {
        const cloneDoc = iframe.contentDocument;
        if (!cloneDoc) {
          return { wouldClearIfInterruptsRemoved: false, layoutShiftDelta: sentinel };
        }

        cloneDoc.open();
        cloneDoc.write(document.documentElement.outerHTML);
        cloneDoc.close();

        for (const sel of interruptSelectors) {
          cloneDoc.querySelectorAll(sel).forEach((el) => el.remove());
        }
        // Force a reflow so removed elements are reflected in layout.
        void cloneDoc.body?.offsetHeight;

        const cloneTarget = cloneDoc.querySelector(targetSelector);
        if (!cloneTarget || !isVisible(cloneTarget)) {
          return { wouldClearIfInterruptsRemoved: false, layoutShiftDelta: sentinel };
        }

        const cloneCenter = centerOf(cloneTarget);
        const topAtCenter = cloneDoc.elementFromPoint(cloneCenter.x, cloneCenter.y);
        const wouldClearIfInterruptsRemoved =
          !!topAtCenter && (topAtCenter === cloneTarget || cloneTarget.contains(topAtCenter));

        const layoutShiftDelta = liveCenter
          ? Math.hypot(cloneCenter.x - liveCenter.x, cloneCenter.y - liveCenter.y)
          : sentinel;

        return { wouldClearIfInterruptsRemoved, layoutShiftDelta };
      } finally {
        iframe.remove();
      }
    },
    { targetSelector: task.targetSelector, interruptSelectors, sentinel: NO_TARGET_SHIFT_SENTINEL },
  );
}
