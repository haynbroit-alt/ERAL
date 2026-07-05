#!/usr/bin/env node
/**
 * CLI for Pillar 3 (offline calibration). Reads a JSONL corpus of
 * `TraceRecord` lines (as produced by `ExecuteOptions.onTrace`) and prints
 * the confidence weights that best predict the observed outcomes.
 *
 * Usage: npm run calibrate -- <traces.jsonl> [step]
 */

import { readFileSync } from "node:fs";
import { averageLogLoss, calibrateWeights, DEFAULT_WEIGHTS, TraceRecord } from "../src/index.js";

function loadTraces(path: string): TraceRecord[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as TraceRecord);
}

function main() {
  const [path, stepArg] = process.argv.slice(2);
  if (!path) {
    console.error("Usage: npm run calibrate -- <traces.jsonl> [step]");
    process.exit(1);
  }

  const traces = loadTraces(path);
  const step = stepArg ? Number(stepArg) : 0.05;
  const baselineLoss = averageLogLoss(traces, DEFAULT_WEIGHTS);
  const result = calibrateWeights(traces, step);

  console.log(`Traces: ${traces.length}`);
  console.log(`Candidates evaluated: ${result.candidatesEvaluated} (step=${step})`);
  console.log(`Default weights ${JSON.stringify(DEFAULT_WEIGHTS)} -> log-loss ${baselineLoss.toFixed(4)}`);
  console.log(`Calibrated weights ${JSON.stringify(result.weights)} -> log-loss ${result.logLoss.toFixed(4)}`);
  const improvementPct = baselineLoss > 0 ? ((baselineLoss - result.logLoss) / baselineLoss) * 100 : 0;
  console.log(`Improvement: ${improvementPct.toFixed(1)}%`);
}

main();
