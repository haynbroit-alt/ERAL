/**
 * Worked demo for Pillar 3 (offline calibration), self-contained.
 *
 * Synthesizes a corpus of (ConfidenceVector, actualSuccess) pairs from a
 * *known* ground-truth weighting — one where R_inter matters far more than
 * the DEFAULT_WEIGHTS assume — plus outcome noise, then asks
 * `calibrateWeights` to recover it purely from observed outcomes. If the
 * calibrated weights land close to the ground truth and beat
 * DEFAULT_WEIGHTS on log-loss, the calibration loop is doing real work,
 * not just decoration.
 */

import { ConfidenceVector, TraceRecord, averageLogLoss, calibrateWeights, computeConfidence, DEFAULT_WEIGHTS } from "../src/index.js";

const GROUND_TRUTH_WEIGHTS = { wDom: 0.15, wInter: 0.7, wState: 0.15 };

function randomVector(): ConfidenceVector {
  return { sDom: Math.random(), rInter: Math.random(), nState: Math.random() };
}

function synthesizeTraces(n: number): TraceRecord[] {
  const traces: TraceRecord[] = [];
  for (let i = 0; i < n; i++) {
    const vector = randomVector();
    const trueP = computeConfidence(vector, GROUND_TRUTH_WEIGHTS);
    traces.push({ vector, success: Math.random() < trueP });
  }
  return traces;
}

function main() {
  const traces = synthesizeTraces(2000);

  const baselineLoss = averageLogLoss(traces, DEFAULT_WEIGHTS);
  const groundTruthLoss = averageLogLoss(traces, GROUND_TRUTH_WEIGHTS);
  const { weights: recovered, logLoss: recoveredLoss, candidatesEvaluated } = calibrateWeights(traces, 0.05);

  console.log(`Ground truth weights:   ${JSON.stringify(GROUND_TRUTH_WEIGHTS)} -> log-loss ${groundTruthLoss.toFixed(4)}`);
  console.log(`Default weights:        ${JSON.stringify(DEFAULT_WEIGHTS)} -> log-loss ${baselineLoss.toFixed(4)}`);
  console.log(`Calibrated weights:     ${JSON.stringify(recovered)} -> log-loss ${recoveredLoss.toFixed(4)}`);
  console.log(`(${candidatesEvaluated} simplex candidates evaluated over ${traces.length} traces)`);
  console.log(
    `\nCalibration recovered wInter=${recovered.wInter.toFixed(2)} (ground truth 0.70) from outcomes alone, ` +
      `and beat the default weights' log-loss by ${(((baselineLoss - recoveredLoss) / baselineLoss) * 100).toFixed(1)}%.`,
  );
}

main();
