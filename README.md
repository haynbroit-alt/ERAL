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
  types.ts        Structural architecture: DomState, Task, FSM, ConfidenceVector
  confidence.ts   Logic matrix: confidence formula + SAFE/UNCERTAIN/RISKY gating
  engine.ts       Constrained runtime script: execute() entry point
  feedback.ts      Feedback loop: post-execution confidence adjustment
  index.ts        Barrel export
examples/
  notion-editor-ready.ts   Worked atom demonstrating the full pipeline
docs/
  PROMPT.md       The finalized ERAL v1.0 meta-prompt used to generate new atoms
```

## Usage

```bash
npm install
npm run build   # type-check and compile to dist/
npm run demo     # run the worked Notion-editor atom against SAFE/UNCERTAIN/RISKY snapshots
```

```ts
import { execute } from "eral";

const outcome = await execute(task, domState, {
  runAction: (t) => page.locator(t.targetSelector).type(t.payload ?? ""),
  confirm: (t, confidence) => askHuman(t, confidence),
  fallback: (t, confidence) => logAndDefer(t, confidence),
});
```

See `docs/PROMPT.md` for the meta-prompt this architecture implements, and
`examples/notion-editor-ready.ts` for a full worked atom.
