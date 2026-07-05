import { fileURLToPath } from "node:url";

export * from "./types.js";
export * from "./confidence.js";
export * from "./engine.js";
export * from "./feedback.js";
export * from "./registry.js";
export * from "./calibration.js";

// Dual-purpose entry point: `import "eral"` stays a pure, side-effect-free
// barrel, but running this file directly (`node dist/index.js` — the
// default a Node host infers from package.json's "main") starts the HTTP
// surface in src/server.ts. This is what lets a plain "npm install" +
// default start command deploy the API with zero extra host configuration.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void import("./server.js").then((m) => m.startServer());
}
