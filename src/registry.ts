/**
 * ERAL — Digital Twin Registry (Pillar 1) + Capsule Sync (Pillar 4)
 *
 * The confidence formula in confidence.ts is stateless: it recomputes a
 * score from scratch on every call, with no memory of whether this exact
 * (domain, selector, action) has actually worked before. This module adds
 * that memory: a Beta-Bernoulli posterior per trajectory key, updated from
 * real execution outcomes, that the engine blends with the instantaneous
 * score.
 *
 * Internally the posterior for one trajectory is not a single (alpha,
 * beta) pair but a per-source G-Counter: `Record<sourceId, {successes,
 * failures}>`, one monotonically-increasing entry per ERAL instance that
 * has ever recorded an outcome for that trajectory. This is what makes the
 * registry mergeable without a coordination service: merging two replicas
 * is `max()` per source, per field -- provably commutative, associative,
 * and idempotent (a G-Counter CRDT), so two ERAL instances can exchange
 * their learned history as a plain JSON file (a "capsule") -- via git, a
 * shared drive, email, whatever -- with no server, no API, and no risk of
 * double-counting a capsule that gets merged twice. `get`/`record`/`all`
 * still expose a simple aggregate (alpha, beta) view; the multi-source
 * structure is purely an implementation detail of `RegistryStore`.
 */

import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { Task } from "./types.js";

/** Identifies one recurring (site, element, action) trajectory. */
export interface TrajectoryKey {
  domain: string;
  selectorPattern: string;
  actionKind: Task["kind"];
}

/** Beta(alpha, beta) posterior over "this trajectory succeeds when attempted" -- the aggregate view across all sources. */
export interface TrajectoryStats {
  alpha: number;
  beta: number;
  lastUpdated: number;
}

/** One source's own monotonic counters for one trajectory. Never decreases. */
export interface SourceStats {
  successes: number;
  failures: number;
  lastUpdated: number;
}

/** trajectoryId -> sourceId -> that source's counters. The CRDT state proper. */
export type RawRegistry = Record<string, Record<string, SourceStats>>;

/** A portable, mergeable export of a registry's learned state. No server involved in producing or consuming one. */
export interface Capsule {
  format: "eral-twin-capsule/v1";
  trajectories: RawRegistry;
}

export interface RegistryStore {
  get(key: TrajectoryKey): TrajectoryStats | undefined;
  record(key: TrajectoryKey, success: boolean): TrajectoryStats;
  /** All tracked trajectories, keyed by `trajectoryId`, as aggregate stats. Used for reporting (e.g. a /status endpoint). */
  all(): Record<string, TrajectoryStats>;
  /** Exports the full multi-source CRDT state for offline sync (see `mergeCapsule`). */
  exportCapsule(): Capsule;
  /** Merges another instance's capsule into this one. Commutative, associative, idempotent -- safe to call with the same capsule more than once. */
  mergeCapsule(capsule: Capsule): void;
}

export function trajectoryId(key: TrajectoryKey): string {
  return `${key.domain}::${key.selectorPattern}::${key.actionKind}`;
}

export function taskToKey(task: Task, domain: string): TrajectoryKey {
  return { domain, selectorPattern: task.targetSelector, actionKind: task.kind };
}

function aggregate(bySource: Record<string, SourceStats> | undefined): TrajectoryStats | undefined {
  if (!bySource) return undefined;
  const sources = Object.values(bySource);
  if (sources.length === 0) return undefined;
  let successes = 0;
  let failures = 0;
  let lastUpdated = 0;
  for (const s of sources) {
    successes += s.successes;
    failures += s.failures;
    lastUpdated = Math.max(lastUpdated, s.lastUpdated);
  }
  return { alpha: 1 + successes, beta: 1 + failures, lastUpdated };
}

/**
 * G-Counter merge: per (trajectory, source), take the element-wise max of
 * each counter. Two replicas of the *same* source's counters are always
 * comparable (one is a prefix of the other's history, since a source only
 * ever increments its own counters), so max() never loses information and
 * never double-counts -- merge(a, a) = a, merge(a, b) = merge(b, a),
 * merge(merge(a, b), c) = merge(a, merge(b, c)).
 */
export function mergeRawRegistries(a: RawRegistry, b: RawRegistry): RawRegistry {
  const merged: RawRegistry = {};
  const trajectoryIds = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const tid of trajectoryIds) {
    const bySourceA = a[tid] ?? {};
    const bySourceB = b[tid] ?? {};
    const sourceIds = new Set([...Object.keys(bySourceA), ...Object.keys(bySourceB)]);
    const mergedSources: Record<string, SourceStats> = {};
    for (const sid of sourceIds) {
      const sa = bySourceA[sid];
      const sb = bySourceB[sid];
      mergedSources[sid] = {
        successes: Math.max(sa?.successes ?? 0, sb?.successes ?? 0),
        failures: Math.max(sa?.failures ?? 0, sb?.failures ?? 0),
        lastUpdated: Math.max(sa?.lastUpdated ?? 0, sb?.lastUpdated ?? 0),
      };
    }
    merged[tid] = mergedSources;
  }
  return merged;
}

/** Merges any number of capsules (e.g. from several CI shards or teammates) into one, purely from data -- no store, no I/O. */
export function mergeCapsules(capsules: Capsule[]): Capsule {
  const trajectories = capsules.reduce<RawRegistry>((acc, c) => mergeRawRegistries(acc, c.trajectories), {});
  return { format: "eral-twin-capsule/v1", trajectories };
}

function recordInto(raw: RawRegistry, sourceId: string, key: TrajectoryKey, success: boolean): void {
  const tid = trajectoryId(key);
  const bySource = raw[tid] ?? {};
  const mine = bySource[sourceId] ?? { successes: 0, failures: 0, lastUpdated: 0 };
  bySource[sourceId] = {
    successes: mine.successes + (success ? 1 : 0),
    failures: mine.failures + (success ? 0 : 1),
    lastUpdated: Date.now(),
  };
  raw[tid] = bySource;
}

/** Process-local registry; learns for the lifetime of the running process. */
export class InMemoryRegistryStore implements RegistryStore {
  private raw: RawRegistry = {};
  private readonly sourceId: string;

  constructor(sourceId: string = randomUUID()) {
    this.sourceId = sourceId;
  }

  get(key: TrajectoryKey): TrajectoryStats | undefined {
    return aggregate(this.raw[trajectoryId(key)]);
  }

  record(key: TrajectoryKey, success: boolean): TrajectoryStats {
    recordInto(this.raw, this.sourceId, key, success);
    return aggregate(this.raw[trajectoryId(key)])!;
  }

  all(): Record<string, TrajectoryStats> {
    const result: Record<string, TrajectoryStats> = {};
    for (const tid of Object.keys(this.raw)) {
      const stats = aggregate(this.raw[tid]);
      if (stats) result[tid] = stats;
    }
    return result;
  }

  exportCapsule(): Capsule {
    return { format: "eral-twin-capsule/v1", trajectories: structuredCloneRaw(this.raw) };
  }

  mergeCapsule(capsule: Capsule): void {
    this.raw = mergeRawRegistries(this.raw, capsule.trajectories);
  }
}

interface PersistedFile {
  sourceId: string;
  trajectories: RawRegistry;
}

/** JSON-file-backed registry; learns across process restarts on one machine, and can export/merge capsules for cross-machine sync. */
export class FileRegistryStore implements RegistryStore {
  private raw: RawRegistry;
  private readonly sourceId: string;

  constructor(private readonly filePath: string) {
    const loaded = this.load();
    this.sourceId = loaded.sourceId;
    this.raw = loaded.trajectories;
  }

  private load(): PersistedFile {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf-8")) as PersistedFile;
      return { sourceId: parsed.sourceId ?? randomUUID(), trajectories: parsed.trajectories ?? {} };
    } catch {
      return { sourceId: randomUUID(), trajectories: {} };
    }
  }

  private persist(): void {
    const payload: PersistedFile = { sourceId: this.sourceId, trajectories: this.raw };
    writeFileSync(this.filePath, JSON.stringify(payload, null, 2));
  }

  get(key: TrajectoryKey): TrajectoryStats | undefined {
    return aggregate(this.raw[trajectoryId(key)]);
  }

  record(key: TrajectoryKey, success: boolean): TrajectoryStats {
    recordInto(this.raw, this.sourceId, key, success);
    this.persist();
    return aggregate(this.raw[trajectoryId(key)])!;
  }

  all(): Record<string, TrajectoryStats> {
    const result: Record<string, TrajectoryStats> = {};
    for (const tid of Object.keys(this.raw)) {
      const stats = aggregate(this.raw[tid]);
      if (stats) result[tid] = stats;
    }
    return result;
  }

  exportCapsule(): Capsule {
    return { format: "eral-twin-capsule/v1", trajectories: structuredCloneRaw(this.raw) };
  }

  mergeCapsule(capsule: Capsule): void {
    this.raw = mergeRawRegistries(this.raw, capsule.trajectories);
    this.persist();
  }
}

function structuredCloneRaw(raw: RawRegistry): RawRegistry {
  return JSON.parse(JSON.stringify(raw));
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
