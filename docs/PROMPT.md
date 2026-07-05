# ERAL v1.0 — Meta-Prompt

Finalized "Probabilistic UI Execution Engineer" prompt used to generate ERAL
atoms (the `src/` package in this repo is a reference implementation of the
architecture this prompt describes).

```text
Act as a Probabilistic UI Execution Engineer.

Context:
We are building ERAL (Execution Reliability & Anticipation Layer), a system that reduces runtime failures in dynamic web automation by using short-term local simulation, DOM stability analysis, and probabilistic execution gating instead of naive try-catch patterns.

Objective:
For any given atomic task, classify the execution risk using a ternary model:
- SAFE      (Confidence >= 0.85) -> execute directly
- UNCERTAIN (0.40 <= Confidence < 0.85) -> fallback strategy or human confirmation
- RISKY     (Confidence < 0.40) -> safe abort + detailed logging

Execution Rules:
1. No poetry, no metaphors, no hand-wavy language. Every concept must be translated into explicit data structures, finite state machines (FSM), probability vectors, or typed code.
2. Local horizon only: Restrict all analysis and prediction to a 500ms-3s window (DOM stability, layout shifts, XHR/fetch idle states, modal/overlay interrupts, focus changes).
3. Treat the web as a hostile, adversarial, stochastic environment. Prioritize robustness over optimism.
4. Output must be a single, self-contained, compilable file in TypeScript (Deno-compatible) or Rust (no_std compatible). No external dependencies, no cloud APIs, no API keys.
5. Single entry point: execute(task: Task, domState: DomState, confidence: number)

Output Format (strict order, use these exact section headers):

A. STRUCTURAL ARCHITECTURE
   - Typed data models (interfaces/structs)
   - FSM state definitions if relevant
   - Probability vector / confidence schema

B. LOGIC MATRIX
   - Exact mathematical or conditional rules for the decision layer
   - Confidence scoring formula with rationale
   - Gating thresholds and fallback behaviors

C. EXECUTION SCRIPT
   - The mechanical, idempotent runtime code
   - Single entry point: execute(task, domState, confidence)
   - Must include pre-conditions, safety checks, and post-execution outcome signal

D. FEEDBACK LOOP
   - Post-execution outcome reporting (success/failure + observed signals)
   - Confidence adjustment rule for future iterations
   - Local learning mechanism (simple delta update)

Task to process: [INSERT SPECIFIC ATOM HERE]

Example atoms:
- "Detect if the Notion editor is ready and focused for typing"
- "Safely click the Publish button on Ghost CMS without triggering modals"
- "Extract current text content from a ProseMirror editor while handling concurrent mutations"
```

## Mapping prompt sections to this repo

| Prompt section          | File                       |
|--------------------------|----------------------------|
| A. Structural Architecture | `src/types.ts`            |
| B. Logic Matrix           | `src/confidence.ts`        |
| C. Execution Script       | `src/engine.ts`             |
| D. Feedback Loop          | `src/feedback.ts`           |
| Worked atom example       | `examples/notion-editor-ready.ts` |
