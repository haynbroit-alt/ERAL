/**
 * Live integration proof for `src/playwright-driver.ts`: launches a real
 * Chromium page, samples DomState with actual MutationObserver /
 * PerformanceObserver / network events (no hand-authored snapshots), and
 * runs each sample through the same `execute()` used by every other atom.
 *
 * Page 1: a contenteditable box that becomes stable ~600ms after load -> SAFE.
 * Page 2: the same box, but a cookie-banner overlay covers it -> RISKY,
 *         then the banner is dismissed and a re-sample goes SAFE.
 */

import { chromium } from "playwright";
import { execute, Task } from "../src/index.js";
import { NetworkIdleTracker, sampleDomState } from "../src/playwright-driver.js";

const STABLE_PAGE = `
<!doctype html><html><body>
  <div id="editor" contenteditable="true" style="width:300px;height:100px;border:1px solid #333;">Ready</div>
  <script>
    // Simulate a settling UI: a couple of late mutations, then quiet.
    setTimeout(() => { document.title = "loaded-1"; }, 100);
    setTimeout(() => { document.title = "loaded-2"; }, 200);
  </script>
</body></html>`;

const INTERRUPTED_PAGE = `
<!doctype html><html><body>
  <div id="editor" contenteditable="true" style="width:300px;height:100px;border:1px solid #333;">Ready</div>
  <div role="dialog" id="cookie-banner"
       style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;">
    <button id="accept">Accept cookies</button>
  </div>
  <script>
    document.getElementById("accept").addEventListener("click", () => {
      document.getElementById("cookie-banner").remove();
    });
  </script>
</body></html>`;

async function runCase(label: string, html: string, dismissBanner: boolean) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    const tracker = new NetworkIdleTracker(page);
    await page.setContent(html);

    if (dismissBanner) {
      await page.click("#accept");
    }

    const task: Task = {
      id: `live-${label}`,
      description: "Type into the live-sampled editor once ERAL confirms it is stable",
      targetSelector: "#editor",
      kind: "type",
      payload: "hello from ERAL",
    };

    const dom = await sampleDomState(page, "#editor", tracker, { windowMs: 500 });

    const outcome = await execute(task, dom, {
      runAction: async (t) => {
        await page.locator(t.targetSelector).click();
        await page.keyboard.type(t.payload ?? "");
        return true;
      },
      fallback: (_t, confidence) => {
        console.log(`  [FALLBACK] deferring (C=${confidence.toFixed(2)})`);
        return true;
      },
    });

    console.log(`${label}: dom=${JSON.stringify(dom)}`);
    console.log(`${label}: outcome=${JSON.stringify(outcome)}\n`);
  } finally {
    await browser.close();
  }
}

async function main() {
  await runCase("stable-page", STABLE_PAGE, false);
  await runCase("interrupted-page", INTERRUPTED_PAGE, false);
  await runCase("interrupted-page-dismissed", INTERRUPTED_PAGE, true);
}

main();
