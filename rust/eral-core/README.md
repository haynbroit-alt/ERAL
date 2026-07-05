# eral-core (Rust/WASM)

The confidence formula and ternary gate (sections A/B of the ERAL v1.0
prompt) compiled to `wasm32-unknown-unknown` for sub-2ms in-browser scoring,
matching the "Mirror Engine" performance goal from the pitch deck. DOM
mutation still happens in JS/TypeScript (`src/engine.ts`) — WASM has no
direct DOM access, so this crate only replaces the *scoring* step, not the
mechanical action.

This trades strict `no_std` for `wasm-bindgen` + `serde`, which need `std`;
that's a deliberate call for real JS interop over the single-file "atom
script" constraint in the meta-prompt, which applies to generated
integration atoms, not this shared engine.

## Build

```bash
# native unit tests (5 tests covering the same cases as src/confidence.ts)
cargo test

# WASM build
rustup target add wasm32-unknown-unknown
cargo build --release --target wasm32-unknown-unknown

# generate JS/TS bindings (requires wasm-bindgen-cli matching the
# wasm-bindgen version pinned in Cargo.lock)
cargo install wasm-bindgen-cli --version <version> --locked
wasm-bindgen --target web --out-dir pkg \
  target/wasm32-unknown-unknown/release/eral_core.wasm
```

## Usage from JS

```js
import init, { eralGate } from "./pkg/eral_core.js";

await init();
const decision = eralGate({
  observedAt: Date.now(),
  mutationCount: 0,
  layoutShiftScore: 0,
  pendingNetworkRequests: 0,
  msSinceNetworkIdle: 1200,
  interruptPresent: false,
  targetElementReady: true,
});
// decision: { confidence, riskClass: "SAFE" | "UNCERTAIN" | "RISKY", vector }
```

`eralGate(domState, weights?)` is the crate's only exported symbol, mirroring
the single-entry-point constraint from the ERAL prompt. `weights` is
optional and defaults to `{ wDom: 0.4, wInter: 0.3, wState: 0.3 }`.
