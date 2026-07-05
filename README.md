# ERAL — Execution Reliability & Anticipation Layer

ERAL replaces naive try-catch web automation with a short-term local
simulation and probability-gated execution engine ("Mirror Engine"). Instead
of reacting to failures after the fact, an atomic task is only executed once
a confidence score derived from a local DOM/network observation clears a
ternary gate.

Paradigm: `Observation -> Simulation -> Selection -> Gate -> Execution -> Feedback`.

## Architecture

- **Observation** — sample DOM mutation count, layout shift, and network idle
  state over a 500ms-3s local horizon (`DomState`, see `src/types.ts`).
- **Simulation / Selection** — derive a `ConfidenceVector` (`S_dom`, `R_inter`,
  `N_state`) and compose it into a single confidence score (`src/confidence.ts`).
- **Gate** — classify the score as `SAFE` (>= 0.85), `UNCERTAIN` (0.40-0.85),
  or `RISKY` (< 0.40), each with a distinct execution path.
- **Execution** — a single, idempotent entry point, `execute(task, domState,
  options)`, applies the mechanical action once gating clears it
  (`src/engine.ts`).
- **Feedback** — post-execution outcomes nudge the confidence weights so the
  gate self-corrects over repeated runs (`src/feedback.ts`).

## Layout

```
src/
  types.ts              Structural architecture: DomState, Task, FSM, ConfidenceVector
  confidence.ts         Logic matrix: confidence formula + SAFE/UNCERTAIN/RISKY gating
  engine.ts             Constrained runtime script: execute() entry point
  feedback.ts           Feedback loop: post-execution confidence adjustment
  playwright-driver.ts  Real DomState sampler (MutationObserver/PerformanceObserver/network events)
  index.ts              Barrel export (core only — playwright-driver.ts is a separate,
                        optional-peer-dependency module, imported directly)
examples/
  notion-editor-ready.ts    Worked atom: Notion editor typing (simulated snapshots)
  ghost-publish.ts          Worked atom: Ghost CMS publish click (simulated snapshots)
  linkedin-post.ts          Worked atom: LinkedIn share-box post (simulated snapshots)
  playwright-live-demo.ts   Live proof: real Chromium page sampled via playwright-driver.ts
docs/
  PROMPT.md       The finalized ERAL v1.0 meta-prompt used to generate new atoms
rust/eral-core/
  src/lib.rs      Confidence formula + ternary gate ported to Rust, compiled to
                  wasm32-unknown-unknown for sub-2ms in-browser scoring
```

## Usage

```bash
npm install
npm run build         # type-check and compile to dist/
npm run demo:notion    # simulated Notion atom (SAFE/UNCERTAIN/RISKY snapshots)
npm run demo:ghost      # simulated Ghost CMS atom
npm run demo:linkedin   # simulated LinkedIn atom
npm run demo:live       # real Chromium page sampled via the Playwright driver
```

```ts
import { execute } from "eral";

const outcome = await execute(task, domState, {
  runAction: (t) => page.locator(t.targetSelector).type(t.payload ?? ""),
  confirm: (t, confidence) => askHuman(t, confidence),
  fallback: (t, confidence) => logAndDefer(t, confidence),
});
```

To sample `domState` from a real page instead of hand-authoring it:

```ts
import { NetworkIdleTracker, sampleDomState } from "eral/dist/playwright-driver.js";

const tracker = new NetworkIdleTracker(page); // construct once per Page, before the action
const domState = await sampleDomState(page, task.targetSelector, tracker);
```

`demo:live` runs through `tsc` + `node` rather than `tsx`: `tsx`'s esbuild
transform injects `__name()` helper calls that break when a function is
serialized for `page.evaluate` (a known tsx/esbuild limitation), so the
Playwright-dependent demo needs a plain `tsc` build first.

### Rust/WASM core

`rust/eral-core` ports the confidence formula and ternary gate to Rust,
compiled to `wasm32-unknown-unknown` — see `rust/eral-core/README.md` for
build instructions and the `eralGate(domState, weights?)` JS entry point.

See `docs/PROMPT.md` for the meta-prompt this architecture implements.
