#!/usr/bin/env node
/**
 * CLI for Pillar 4 (API-less distributed learning). Merges N capsule JSON
 * files (as produced by `RegistryStore.exportCapsule()`) into one, purely
 * as a file operation -- no server, no network call. Safe to run on
 * capsules committed to git: merge order never matters, and merging the
 * same capsule twice is a no-op (see mergeRawRegistries in src/registry.ts
 * for the CRDT proof).
 *
 * Usage: npm run merge-twins -- <capsule1.json> <capsule2.json> ... --out <merged.json>
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Capsule, mergeCapsules } from "../src/index.js";

function main() {
  const args = process.argv.slice(2);
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;
  const inputPaths = outIndex >= 0 ? [...args.slice(0, outIndex), ...args.slice(outIndex + 2)] : args;

  if (inputPaths.length < 1 || !outPath) {
    console.error("Usage: npm run merge-twins -- <capsule1.json> <capsule2.json> ... --out <merged.json>");
    process.exit(1);
  }

  const capsules: Capsule[] = inputPaths.map((p) => JSON.parse(readFileSync(p, "utf-8")));
  const merged = mergeCapsules(capsules);

  writeFileSync(outPath, JSON.stringify(merged, null, 2));

  const trajectoryCount = Object.keys(merged.trajectories).length;
  console.log(`Merged ${inputPaths.length} capsule(s) covering ${trajectoryCount} trajectories -> ${outPath}`);
}

main();
