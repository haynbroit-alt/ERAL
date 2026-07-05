/**
 * ERAL — Playwright Observation Driver
 *
 * Produces a real `DomState` from a live `Page` instead of a hand-authored
 * snapshot: DOM mutations and layout shift come from browser-native
 * MutationObserver/PerformanceObserver samples taken over the local
 * 500ms-3s horizon; network idle state comes from Playwright's own
 * request/response events (works across fetch, XHR, and navigations,
 * unlike an in-page Resource Timing hook). This is integration glue only —
 * it depends on `playwright`, unlike the dependency-free `src/` core.
 */

import type { Page } from "playwright";
import { DomState } from "./types.js";

const DEFAULT_INTERRUPT_SELECTORS = [
  '[role="dialog"]',
  '[aria-modal="true"]',
  ".modal",
  ".overlay",
  '[class*="cookie"]',
  '[class*="popover"]:not([hidden])',
];

export interface SampleOptions {
  /** Local observation window, clamped to the 500ms-3s ERAL horizon. */
  windowMs?: number;
  /** Selectors treated as focus-stealing interrupts when visible. */
  interruptSelectors?: string[];
}

/** Tracks in-flight network requests for one Page across its lifetime. */
export class NetworkIdleTracker {
  private pending = 0;
  private lastIdleAt = Date.now();

  constructor(page: Page) {
    page.on("request", () => {
      this.pending += 1;
    });
    const settle = () => {
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0) this.lastIdleAt = Date.now();
    };
    page.on("requestfinished", settle);
    page.on("requestfailed", settle);
  }

  snapshot(): { pendingNetworkRequests: number; msSinceNetworkIdle: number } {
    return {
      pendingNetworkRequests: this.pending,
      msSinceNetworkIdle: this.pending === 0 ? Date.now() - this.lastIdleAt : 0,
    };
  }
}

/**
 * Samples one DomState for `targetSelector` over `windowMs` (default 800ms,
 * clamped to [500, 3000] per the ERAL local-horizon constraint).
 *
 * `tracker` must be constructed once per Page (before the action under
 * observation begins) so network events aren't missed between samples.
 */
export async function sampleDomState(
  page: Page,
  targetSelector: string,
  tracker: NetworkIdleTracker,
  options: SampleOptions = {},
): Promise<DomState> {
  const windowMs = Math.min(3000, Math.max(500, options.windowMs ?? 800));
  const interruptSelectors = options.interruptSelectors ?? DEFAULT_INTERRUPT_SELECTORS;

  const { mutationCount, layoutShiftScore } = await page.evaluate(
    (ms) =>
      new Promise<{ mutationCount: number; layoutShiftScore: number }>((resolve) => {
        let mutationCount = 0;
        let layoutShiftScore = 0;

        const mutationObserver = new MutationObserver((records) => {
          mutationCount += records.length;
        });
        mutationObserver.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true,
        });

        let layoutObserver: PerformanceObserver | undefined;
        try {
          layoutObserver = new PerformanceObserver((list) => {
            for (const entry of list.getEntries() as unknown as { value: number; hadRecentInput: boolean }[]) {
              if (!entry.hadRecentInput) layoutShiftScore += entry.value;
            }
          });
          layoutObserver.observe({ type: "layout-shift", buffered: true });
        } catch {
          // layout-shift entry type unsupported in this engine; skip silently.
        }

        setTimeout(() => {
          mutationObserver.disconnect();
          layoutObserver?.disconnect();
          resolve({ mutationCount, layoutShiftScore });
        }, ms);
      }),
    windowMs,
  );

  const { interruptPresent, targetElementReady } = await page.evaluate(
    ({ targetSelector, interruptSelectors }) => {
      const isVisible = (el: Element): boolean => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = window.getComputedStyle(el);
        return style.visibility !== "hidden" && style.display !== "none";
      };

      const interruptPresent = interruptSelectors.some((sel) =>
        Array.from(document.querySelectorAll(sel)).some(isVisible),
      );

      const target = document.querySelector(targetSelector);
      let targetElementReady = false;
      if (target && isVisible(target)) {
        const rect = target.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const topElement = document.elementFromPoint(cx, cy);
        targetElementReady = !!topElement && (topElement === target || target.contains(topElement));
      }

      return { interruptPresent, targetElementReady };
    },
    { targetSelector, interruptSelectors },
  );

  return {
    observedAt: Date.now(),
    mutationCount,
    layoutShiftScore,
    interruptPresent,
    targetElementReady,
    ...tracker.snapshot(),
  };
}
