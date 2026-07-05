/**
 * ERAL — Digital Twin Registry (Pillar 1)
 *
 * The confidence formula in confidence.ts is stateless: it recomputes a
 * score from scratch on every call, with no memory of whether this exact
 * (domain, selector, action) has actually worked before. This module adds
 * that memory: a Beta-Bernoulli posterior per trajectory key, updated from
 * real execution outcomes, that the engine blends with the instantaneous
 * score. Over repeated runs against a site this turns ERAL from a one-shot
 * heuristic into a system that has actually learned the site.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Task } from "./types.js";

/** Identifies one recurring (site, element, action) trajectory. */
export interface TrajectoryKey {
  domain: string;
  selectorPattern: string;
  actionKind: Task["kind"];
}

/** Beta(alpha, beta) posterior over "this trajectory succeeds when attempted". */
export interface TrajectoryStats {
  alpha: number;
  beta: number;
  lastUpdated: number;
}

export interface RegistryStore {
  get(key: TrajectoryKey): TrajectoryStats | undefined;
  record(key: TrajectoryKey, success: boolean): TrajectoryStats;
  /** All tracked trajectories, keyed by `trajectoryId`. Used for aggregate reporting (e.g. a /status endpoint). */
  all(): Record<string, TrajectoryStats>;
}

export function trajectoryId(key: TrajectoryKey): string {
  return `${key.domain}::${key.selectorPattern}::${key.actionKind}`;
}

export function taskToKey(task: Task, domain: string): TrajectoryKey {
  return { domain, selectorPattern: task.targetSelector, actionKind: task.kind };
}

const UNIFORM_PRIOR: Omit<TrajectoryStats, "lastUpdated"> = { alpha: 1, beta: 1 };

function recordInto(
  stats: Record<string, TrajectoryStats>,
  key: TrajectoryKey,
  success: boolean,
): TrajectoryStats {
  const id = trajectoryId(key);
  const prev = stats[id] ?? { ...UNIFORM_PRIOR, lastUpdated: 0 };
  const next: TrajectoryStats = {
    alpha: prev.alpha + (success ? 1 : 0),
    beta: prev.beta + (success ? 0 : 1),
    lastUpdated: Date.now(),
  };
  stats[id] = next;
  return next;
}

/** Process-local registry; learns for the lifetime of the running process. */
export class InMemoryRegistryStore implements RegistryStore {
  private stats: Record<string, TrajectoryStats> = {};

  get(key: TrajectoryKey): TrajectoryStats | undefined {
    return this.stats[trajectoryId(key)];
  }

  record(key: TrajectoryKey, success: boolean): TrajectoryStats {
    return recordInto(this.stats, key, success);
  }

  all(): Record<string, TrajectoryStats> {
    return { ...this.stats };
  }
}

/** JSON-file-backed registry; learns across process restarts on one machine. */
export class FileRegistryStore implements RegistryStore {
  private stats: Record<string, TrajectoryStats>;

  constructor(private readonly filePath: string) {
    this.stats = this.load();
  }

  private load(): Record<string, TrajectoryStats> {
    try {
      return JSON.parse(readFileSync(this.filePath, "utf-8"));
    } catch {
      return {};
    }
  }

  private persist(): void {
    writeFileSync(this.filePath, JSON.stringify(this.stats, null, 2));
  }

  get(key: TrajectoryKey): TrajectoryStats | undefined {
    return this.stats[trajectoryId(key)];
  }

  record(key: TrajectoryKey, success: boolean): TrajectoryStats {
    const next = recordInto(this.stats, key, success);
    this.persist();
    return next;
  }

  all(): Record<string, TrajectoryStats> {
    return { ...this.stats };
  }
}

/** Posterior mean success rate; 0.5 (uninformative) when nothing has been observed yet. */
export function priorMean(stats: TrajectoryStats | undefined): number {
  if (!stats) return 0.5;
  return stats.alpha / (stats.alpha + stats.beta);
}

/** Real observations backing the posterior (excludes the (1,1) uniform prior pseudo-counts). */
export function evidenceCount(stats: TrajectoryStats | undefined): number {
  if (!stats) return 0;
  return stats.alpha + stats.beta - 2;
}
