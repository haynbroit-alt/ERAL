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

## Beyond the stateless gate: three learning pillars

The base gate above is a stateless heuristic — it recomputes a score from
scratch on every call, with no memory of whether this exact trajectory has
ever actually worked. Three optional pillars turn it into a system that
learns the site instead of just reading it:

1. **Digital Twin Registry** (`src/registry.ts`) — a Beta-Bernoulli posterior
   per `(domain, selector, action)` trajectory, updated from real execution
   outcomes. `execute()` blends the instantaneous confidence with this
   learned prior (`calibrateConfidence` in `src/confidence.ts`), so a
   trajectory that's chronically borderline on raw DOM signal but actually
   reliable in practice gradually stops needing human confirmation — see
   `examples/registry-learning-demo.ts`.
2. **Shadow-clone trajectory simulation** (`src/simulate.ts`) — before a
   non-SAFE decision reaches your `confirm`/`fallback` hooks, ERAL can clone
   the live document into a detached, off-screen iframe, strip the detected
   interrupt(s) there, and report whether the target would actually become
   actionable and how much layout would shift — a real structural
   counterfactual, not a guess about the future — see
   `examples/simulate-interrupt-demo.ts`.
3. **Offline calibration** (`src/calibration.ts`, `scripts/calibrate.ts`) —
   replaces the toy fixed-delta nudge in `feedback.ts` with a real learning
   loop: grid-search the confidence-weight simplex against a corpus of
   recorded `(vector, actualSuccess)` traces (`ExecuteOptions.onTrace`),
   scored by log-loss — see `examples/calibration-demo.ts`, which recovers a
   known ground-truth weighting from outcomes alone.

All three are opt-in via `ExecuteOptions` (`registry`, `simulate`,
`onTrace`) — omit them and `execute()` is exactly the stateless v1 gate.

## Layout

```
src/
  types.ts              Structural architecture: DomState, Task, FSM, ConfidenceVector, SimulationResult
  confidence.ts         Logic matrix: confidence formula + SAFE/UNCERTAIN/RISKY gating + registry calibration
  engine.ts             Constrained runtime script: execute() entry point, wires all three pillars
  feedback.ts           Toy online feedback loop (superseded by src/calibration.ts for real use)
  registry.ts           Pillar 1: Digital Twin Registry (Beta-Bernoulli trajectory memory)
  simulate.ts           Pillar 2: shadow-clone interrupt-removal counterfactual (Playwright-dependent)
  calibration.ts        Pillar 3: offline weight calibration by log-loss grid search
  playwright-driver.ts  Real DomState sampler (MutationObserver/PerformanceObserver/network events)
  server.ts             HTTP surface: /health, /status, /gate, /report (see "Running as a service" below)
  index.ts              Barrel export (core only — playwright-driver.ts/simulate.ts are separate,
                        optional-peer-dependency modules, imported directly); also the deploy entry
                        point (starts the server iff executed directly, e.g. `node dist/src/index.js`)
examples/
  notion-editor-ready.ts     Worked atom: Notion editor typing (simulated snapshots)
  ghost-publish.ts           Worked atom: Ghost CMS publish click (simulated snapshots)
  linkedin-post.ts           Worked atom: LinkedIn share-box post (simulated snapshots)
  playwright-live-demo.ts    Live proof: real Chromium page sampled via playwright-driver.ts
  registry-learning-demo.ts  Pillar 1: confidence rises from UNCERTAIN to SAFE purely from learned history
  simulate-interrupt-demo.ts Pillar 2: real overlay gated, then cleared by shadow-clone simulation
  calibration-demo.ts        Pillar 3: recovers a known ground-truth weighting from outcomes alone
scripts/
  calibrate.ts    CLI: reads a JSONL trace corpus, prints calibrated weights vs. the default baseline
docs/
  PROMPT.md       The finalized ERAL v1.0 meta-prompt used to generate new atoms
rust/eral-core/
  src/lib.rs      Confidence formula + ternary gate ported to Rust, compiled to
                  wasm32-unknown-unknown for sub-2ms in-browser scoring
```

## Usage

```bash
npm install
npm run build           # type-check and compile to dist/
npm run demo:notion      # simulated Notion atom (SAFE/UNCERTAIN/RISKY snapshots)
npm run demo:ghost        # simulated Ghost CMS atom
npm run demo:linkedin     # simulated LinkedIn atom
npm run demo:live         # real Chromium page sampled via the Playwright driver
npm run demo:registry     # Pillar 1: learned trajectory memory
npm run demo:simulate     # Pillar 2: shadow-clone counterfactual, real Chromium
npm run demo:calibration  # Pillar 3: recovers ground-truth weights from synthetic outcomes
npm run calibrate -- <traces.jsonl>   # Pillar 3 CLI against a real trace corpus
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
import { NetworkIdleTracker, sampleDomState } from "eral/dist/src/playwright-driver.js";

const tracker = new NetworkIdleTracker(page); // construct once per Page, before the action
const domState = await sampleDomState(page, task.targetSelector, tracker);
```

`demo:live` and `demo:simulate` run through `tsc` + `node` rather than
`tsx`: `tsx`'s esbuild transform injects `__name()` helper calls that break
when a function is serialized for `page.evaluate` (a known tsx/esbuild
limitation), so Playwright-dependent demos need a plain `tsc` build first.

With all three pillars wired in:

```ts
import { execute, InMemoryRegistryStore } from "eral";
import { simulateInterruptRemoval } from "eral/dist/src/simulate.js";

const registry = new InMemoryRegistryStore(); // or FileRegistryStore("./eral.registry.json")

const outcome = await execute(task, domState, {
  registry,
  domain: "ghost.example.com",
  runAction: (t) => page.locator(t.targetSelector).click(),
  confirm: (t, confidence) => askHuman(t, confidence),
  simulate: (t) => simulateInterruptRemoval(page, t, ["[role=\"dialog\"]"]),
  fallback: (t, confidence, simulation) =>
    simulation?.wouldClearIfInterruptsRemoved ? waitAndRetry(t) : logAndDefer(t, confidence),
  onTrace: (record) => appendFileSync("traces.jsonl", `${JSON.stringify(record)}\n`),
});
```

## Running as a service

`npm install` alone builds and boots the API: `postinstall` runs `tsc`
(`npm run build`), which mirrors `src/` under `dist/src/` (the package's
real `main`, which starts the HTTP server in `src/server.ts` when executed
directly) — but a `postbuild` step (`scripts/postbuild.mjs`) also writes a
tiny unconditional shim at the literal path `dist/index.js`, because some
hosts (Render among them) hardcode `node dist/index.js` as the run command
regardless of `package.json`'s `main`/`start` fields, and there's no way to
fix that from inside the repo — only to make the path they expect actually
exist. Either entry point works: `node dist/index.js` (the shim) or
`npm start` (`node dist/src/index.js`, the real entry) both start the same
server. Set `PORT` (defaults to 3000) and optionally `ERAL_REGISTRY_PATH`
(defaults to `./eral.registry.json`; note this is lost on redeploy unless
the host gives you a persistent disk).

```
GET  /health   -> { status: "ok" }
GET  /status   -> { status, trajectoriesTracked, totalObservations, averageLearnedSuccessRate }
POST /gate     -> body: { task, domState, domain? }
                  returns: { vector, instantConfidence, confidence, riskClass, trajectory }
POST /report   -> body: { domain, selectorPattern, actionKind, success }
                  returns: { stats } (the updated Beta-Bernoulli posterior)
```

`/gate` and `/report` expose exactly the Digital Twin Registry math from
`src/confidence.ts`/`src/registry.ts` as a shared, network-accessible
service — multiple automation processes hitting `/report` build one common
learned history instead of each staying isolated in its own process, per
the roadmap's "Digital Twin Cloud Registry" milestone. There is no browser
in this server — DOM sampling and the shadow-clone simulation still happen
client-side via `playwright-driver.ts`/`simulate.ts`; this service is pure
scoring and memory.

### Rust/WASM core

`rust/eral-core` ports the confidence formula and ternary gate to Rust,
compiled to `wasm32-unknown-unknown` — see `rust/eral-core/README.md` for
build instructions and the `eralGate(domState, weights?)` JS entry point.

See `docs/PROMPT.md` for the meta-prompt this architecture implements.
