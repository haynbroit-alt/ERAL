/**
 * ERAL — HTTP surface for the engine.
 *
 * The roadmap's "Open Core & API Developers" / "Digital Twin Cloud
 * Registry" milestone, minimally scoped: three routes, no framework
 * dependency (Node's built-in http module is enough). This turns the
 * per-process Digital Twin Registry (src/registry.ts) into something
 * multiple callers can actually share over the network, instead of each
 * process learning its own isolated history.
 *
 * Routes:
 *   GET  /health  -> liveness probe
 *   GET  /status  -> aggregate registry stats (real numbers, not decoration)
 *   POST /gate    -> { task, domState, domain? } -> confidence + risk class
 *   POST /report  -> { domain, selectorPattern, actionKind, success } -> records a real outcome
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { calibrateConfidence, classify, computeConfidence, deriveConfidenceVector } from "./confidence.js";
import { evidenceCount, FileRegistryStore, priorMean, taskToKey, TrajectoryKey } from "./registry.js";
import { DomState, Task } from "./types.js";

const REGISTRY_PATH = process.env.ERAL_REGISTRY_PATH ?? "./eral.registry.json";
const registry = new FileRegistryStore(REGISTRY_PATH);

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function handleGate(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const task = body.task as Task | undefined;
  const domState = body.domState as DomState | undefined;
  const domain = (body.domain as string | undefined) ?? "unknown";

  if (!task || !domState) {
    sendJson(res, 400, { error: "body must include task and domState" });
    return;
  }

  const vector = deriveConfidenceVector(domState);
  const instantConfidence = computeConfidence(vector);
  const key: TrajectoryKey = taskToKey(task, domain);
  const stats = registry.get(key);
  const confidence = calibrateConfidence(instantConfidence, stats);

  sendJson(res, 200, {
    vector,
    instantConfidence,
    confidence,
    riskClass: classify(confidence),
    trajectory: { evidenceCount: evidenceCount(stats), learnedSuccessRate: priorMean(stats) },
  });
}

async function handleReport(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = await readJsonBody(req);
  const { domain, selectorPattern, actionKind, success } = body;

  if (
    typeof domain !== "string" ||
    typeof selectorPattern !== "string" ||
    typeof actionKind !== "string" ||
    typeof success !== "boolean"
  ) {
    sendJson(res, 400, { error: "body must include domain, selectorPattern, actionKind (string), success (boolean)" });
    return;
  }

  const stats = registry.record({ domain, selectorPattern, actionKind: actionKind as Task["kind"] }, success);
  sendJson(res, 200, { stats });
}

function handleStatus(res: ServerResponse): void {
  const entries = Object.values(registry.all());
  const totalObservations = entries.reduce((sum, s) => sum + evidenceCount(s), 0);
  const averageLearnedSuccessRate =
    entries.length > 0 ? entries.reduce((sum, s) => sum + priorMean(s), 0) / entries.length : null;

  sendJson(res, 200, {
    status: "operational",
    trajectoriesTracked: entries.length,
    totalObservations,
    averageLearnedSuccessRate,
  });
}

export function startServer(port = Number(process.env.PORT) || 3000) {
  const server = createServer((req, res) => {
    void (async () => {
      try {
        if (req.method === "GET" && req.url === "/health") {
          sendJson(res, 200, { status: "ok" });
        } else if (req.method === "GET" && req.url === "/status") {
          handleStatus(res);
        } else if (req.method === "POST" && req.url === "/gate") {
          await handleGate(req, res);
        } else if (req.method === "POST" && req.url === "/report") {
          await handleReport(req, res);
        } else {
          sendJson(res, 404, { error: "not found" });
        }
      } catch (err) {
        sendJson(res, 500, { error: (err as Error).message });
      }
    })();
  });

  server.listen(port, () => {
    console.log(`ERAL server listening on port ${port} (registry: ${REGISTRY_PATH})`);
  });

  return server;
}
