// The phone-side determinism check: a separate simulation Worker plays the same AI-vs-AI
// game as CI did (seed, scenario, length from expected-hashes.json, written at build time
// by `node sim/src/headless.ts --expected`) and every HASH_EVERY-tick hash is compared.

import type { SimPort } from "../game/port.ts";
import { type ExpectedHashes, MAX_TICKS, PROTOCOL_VERSION } from "../sim.ts";

export interface CheckResult {
  /** true: every hash and the final state match CI; false: something differs; null: no CI file to compare with. */
  same: boolean | null;
  /** Hashes compared (progress hashes that CI also has, plus the final one). */
  compared: number;
  mismatches: number;
  firstMismatchTick: number | null;
  ticks: number;
  finalHash: string;
  totalMs: number;
  tickMedianMs: number;
  tickMaxMs: number;
}

export interface Progress {
  tick: number;
  hash: string;
}

export interface Done {
  ticks: number;
  finalHash: string;
  totalMs: number;
  tickMedianMs: number;
  tickMaxMs: number;
}

export function compare(expected: ExpectedHashes | null, progress: Progress[], done: Done): CheckResult {
  let compared = 0;
  let mismatches = 0;
  let firstMismatchTick: number | null = null;
  const miss = (tick: number) => {
    mismatches++;
    if (firstMismatchTick === null) firstMismatchTick = tick;
  };
  if (expected !== null) {
    for (const p of progress) {
      const want = expected.hashes[String(p.tick)];
      if (want === undefined) continue;
      compared++;
      if (want !== p.hash) miss(p.tick);
    }
    compared++;
    if (expected.final.tick !== done.ticks || expected.final.hash !== done.finalHash) miss(done.ticks);
  }
  return {
    same: expected === null ? null : mismatches === 0,
    compared,
    mismatches,
    firstMismatchTick,
    ticks: done.ticks,
    finalHash: done.finalHash,
    totalMs: done.totalMs,
    tickMedianMs: done.tickMedianMs,
    tickMaxMs: done.tickMaxMs,
  };
}

export async function loadExpected(): Promise<ExpectedHashes | null> {
  try {
    const res = await fetch("expected-hashes.json", { cache: "no-store" });
    if (!res.ok) return null;
    const exp = (await res.json()) as ExpectedHashes;
    return exp.protocol === PROTOCOL_VERSION ? exp : null;
  } catch {
    return null;
  }
}

export function runCheck(port: SimPort, expected: ExpectedHashes | null, onProgress: (p: Progress) => void = () => {}): Promise<CheckResult> {
  return new Promise((resolve, reject) => {
    const progress: Progress[] = [];
    port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "determinism_progress") {
        progress.push({ tick: m.tick, hash: m.hash });
        onProgress(m);
      } else if (m.type === "determinism_done") {
        port.terminate();
        resolve(compare(expected, progress, m));
      } else if (m.type === "error") {
        port.terminate();
        reject(new Error(m.message));
      }
    };
    port.postMessage({
      type: "determinism",
      protocol: PROTOCOL_VERSION,
      seed: expected?.seed ?? 1,
      scenario: expected?.scenario ?? "standard",
      maxTicks: expected?.maxTicks ?? MAX_TICKS,
    });
  });
}
