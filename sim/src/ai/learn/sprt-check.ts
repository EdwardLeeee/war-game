// D-147 PR B (ceo 2026-11-21): the promotion rule simulated with the very code the exam uses (sprt.ts addLook and
// decide), no games: how often a candidate is promoted, and what it costs, for a given Q (the share of examiner seeds
// where candidate and champion differ), draws and edges. Never imported by the simulation Worker.
//   node src/ai/learn/sprt-check.ts [--n 1000000] [--q 0.056] [--draws 0.002] [--edge-ex 0] [--edge-vs 0] [--seed 1]
//                                   [--first]   (the first rule: path A's H1 from Q assumed 30%)
//   edge-ex: the candidate loses that many fewer examiner games (a share of all games); edge-vs: its edge head to head.

import { rng } from "./exam-space.ts";
import { addLook, decide, pathA, type Side, SPRT } from "./sprt.ts";

const EX = SPRT.exChunk * 3;
const VS = SPRT.vsChunk;
const MAX_LOOKS = SPRT.exMax / EX;

/** A binomial draw (inversion; n is at most 60 here). */
function binom(n: number, p: number, r: () => number): number {
  if (p <= 0 || n <= 0) return 0;
  if (p >= 1) return n;
  if (p > 0.5) return n - binom(n, 1 - p, r);
  const q = 1 - p;
  const ratio = p / q;
  let f = q ** n;
  let u = r();
  let x = 0;
  while (u > f && x < n) {
    u -= f;
    x++;
    f *= ((n - x + 1) / x) * ratio;
  }
  return x;
}

export interface Check {
  n: number;
  promoted: number;
  looks: number;
  games: number;
}

/** `n` candidates through the looks with the exam's own rule; `first`: path A as the first rule had it. */
export function simulate(n: number, q: number, draws: number, edgeEx: number, edgeVs: number, seed: number, first = false): Check {
  const r = rng(seed);
  const pEx = Math.min(1, 0.5 + edgeEx / (2 * q));
  let promoted = 0;
  let looks = 0;
  for (let c = 0; c < n; c++) {
    const a = pathA();
    const vs: Side = { plus: 0, minus: 0, games: 0 };
    for (let k = 1; k <= MAX_LOOKS; k++) {
      const differ = binom(EX, q, r);
      const plus = binom(differ, pEx, r);
      addLook(a, plus, differ - plus, EX);
      const decided = binom(VS, 1 - draws, r);
      const won = binom(decided, 0.5 + edgeVs, r);
      vs.plus += won;
      vs.minus += decided - won;
      vs.games += VS;
      const d = first ? decide(a, vs) : decide(a, vs, false, a.llr);
      if (d.verdict === "continue") continue;
      if (d.verdict === "promote") promoted++;
      looks += k;
      break;
    }
  }
  return { n, promoted: promoted / n, looks: looks / n, games: (looks / n) * (EX + VS) };
}

if (process.argv[1]?.endsWith("sprt-check.ts")) {
  const arg = (k: string, f: string) => {
    const i = process.argv.indexOf(`--${k}`);
    return i >= 0 ? process.argv[i + 1] : f;
  };
  const t0 = performance.now();
  const out = simulate(Number(arg("n", "1000000")), Number(arg("q", "0.056")), Number(arg("draws", "0.002")), Number(arg("edge-ex", "0")), Number(arg("edge-vs", "0")), Number(arg("seed", "1")), process.argv.includes("--first"));
  console.log(JSON.stringify({ ...out, seconds: Math.round((performance.now() - t0) / 1000) }));
}
