/**
 * Worked demo for Pillar 4 (API-less distributed learning via capsules).
 *
 * Two independent ERAL instances -- imagine two separate CI runners, or two
 * teammates' laptops -- each maintain their own local registry for the
 * *same* trajectory, with no network connection between them. Each exports
 * a "capsule" (just a JSON object) and merges the other's in. No server,
 * no API call, no coordination protocol -- the capsules could just as
 * easily be committed to git and merged by whoever pulls them.
 *
 * The point isn't just that this works -- it's proving the CRDT properties
 * that make it *safe*: merging is commutative (a+b == b+a) and idempotent
 * (merging the same capsule twice changes nothing), so there's no way to
 * corrupt the learned history by merging capsules out of order or more
 * than once, unlike a naive "sum the counters" approach would allow.
 */

import { InMemoryRegistryStore, TrajectoryKey, evidenceCount, mergeCapsules, priorMean } from "../src/index.js";

const KEY: TrajectoryKey = { domain: "ghost.example.com", selectorPattern: '[data-test-button="publish-save"]', actionKind: "click" };

/** Recursively sorts object keys so structurally-equal values compare equal regardless of insertion order. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonical((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function assertEqual(label: string, a: unknown, b: unknown) {
  const pass = JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${label}`);
  if (!pass) {
    console.log(`    a=${JSON.stringify(a)}`);
    console.log(`    b=${JSON.stringify(b)}`);
  }
}

function main() {
  // Two instances that have never talked to each other.
  const runnerA = new InMemoryRegistryStore("ci-runner-a");
  const runnerB = new InMemoryRegistryStore("ci-runner-b");

  // Runner A observed this trajectory 8 times: 7 successes, 1 failure.
  for (let i = 0; i < 7; i++) runnerA.record(KEY, true);
  runnerA.record(KEY, false);

  // Runner B, independently, observed it 5 times: all successes.
  for (let i = 0; i < 5; i++) runnerB.record(KEY, true);

  console.log("Before merge:");
  console.log(`  runner A alone: ${JSON.stringify(runnerA.get(KEY))} (evidence=${evidenceCount(runnerA.get(KEY))})`);
  console.log(`  runner B alone: ${JSON.stringify(runnerB.get(KEY))} (evidence=${evidenceCount(runnerB.get(KEY))})`);

  const capsuleA = runnerA.exportCapsule();
  const capsuleB = runnerB.exportCapsule();

  // Merge is a pure data operation -- no network call, works on files.
  const mergedAB = mergeCapsules([capsuleA, capsuleB]);
  const mergedBA = mergeCapsules([capsuleB, capsuleA]);

  runnerA.mergeCapsule(capsuleB);
  const afterMerge = runnerA.get(KEY)!;

  console.log("\nAfter merge (runner A absorbs runner B's capsule):");
  console.log(`  merged: ${JSON.stringify(afterMerge)} (evidence=${evidenceCount(afterMerge)}, learned success rate=${priorMean(afterMerge).toFixed(3)})`);
  console.log(`  expected: 13 real observations (8 + 5), 12 successes, 1 failure -> alpha=13, beta=2`);

  console.log("\nCRDT correctness checks:");
  assertEqual("evidence count is the union, not a re-sum (13 total observations)", evidenceCount(afterMerge), 13);
  assertEqual("merge(A, B) == merge(B, A) -- commutative", mergedAB, mergedBA);

  // Merging the exact same capsule again must be a no-op -- this is the
  // property a naive "add the alphas together" design would NOT have.
  runnerA.mergeCapsule(capsuleB);
  runnerA.mergeCapsule(capsuleB);
  assertEqual("re-merging the same capsule twice more is a no-op -- idempotent", runnerA.get(KEY), afterMerge);
}

main();
