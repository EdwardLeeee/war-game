// D-147 PR B (ceo 2026-11-23): the promotion rule simulated and worked out with the very code the exam uses (sprt.ts
// addA, addB and decide), no games. The three ways the earlier rules broke are kept as fixed cases, each with a control
// that does break, so the check can be seen to fail (test/learn-sprt.test.ts):
//   pairs     the two spawns of a seed go the same way (P(++) = P(--) = 0.4, 0.5); control: counted as two units
//   examiners they differ, no better on average, or all three go together; controls: lambda from counts that take the
//             look in, one seed for the three
//   kept      a champion promoted on maps it likes, the next as strong and liking them more; control: the seeds kept
// Never imported by the simulation Worker.
//   node src/ai/learn/sprt-check.ts all [--n 1000000]     every case (the numbers in the PR)
//   node src/ai/learn/sprt-check.ts exact                 the expected factors of one look, exactly

import { rng } from "./exam-space.ts";
import { addA, addB, decide, lambdaA, noPairs, pairOf, type Pairs, pathA, type PathA, pathB, type PathB, SPRT } from "./sprt.ts";

const LOOKS = SPRT.exMax / (SPRT.exChunk * 3);
const SEEDS_A_LOOK = SPRT.vsChunk / 2;

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

/** What one examiner's games do: P(only the champion lost), P(only the candidate lost). */
export type Ex = readonly [plus: number, minus: number];
/** What a seed's two games do: P(++), P(--), and the share of games neither side won. */
export interface Pair {
  plus: number;
  minus: number;
  draws?: number;
}
export interface Case {
  examiners: readonly Ex[];
  pair: Pair;
}
/** The broken ways, for the controls; none: as the exam does. */
export interface Broken {
  /** One seed for the three examiners, their games the same way, counted as three. */
  tiedExaminers?: boolean;
  /** A seed's two games counted as two units of path B. */
  gamesAsUnits?: boolean;
}

export const exOf = (q: number, edge = 0): Ex[] => [0, 1, 2].map(() => [q / 2 + edge / 2, q / 2 - edge / 2] as const);
export const pairAt = (p: number, edge = 0, draws = 0): Pair => ({ plus: p + edge, minus: p - edge, draws });
/** Examiners that differ, no better on average: one only +, one only -, as much; one the same as the champion. */
export const UNEVEN: readonly Ex[] = [[0, 0.05], [0.225, 0.175], [0, 0]];

function drawPairs(p: Pair, n: number, r: () => number): Pairs {
  const out = noPairs();
  const d = 2 * (p.draws ?? 0);
  // Seeds with a game neither side won: half of them against a win, half against a loss, so the mean stays.
  let left = n;
  if (d > 0) {
    const drawn = binom(n, d, r);
    out.wd = binom(drawn, 0.5, r);
    out.ld = drawn - out.wd;
    left -= drawn;
  }
  out.ww = binom(left, Math.min(1, p.plus / (1 - d)), r);
  left -= out.ww;
  out.ll = binom(left, Math.min(1, p.minus / Math.max(1e-12, 1 - d - p.plus)), r);
  out.wl = left - out.ll;
  return out;
}

/** Adds one look to both paths, drawn for the case, through the exam's own addA and addB. */
function look(c: Case, a: PathA, b: PathB, r: () => number, broken: Broken, pairs = drawPairs(c.pair, SEEDS_A_LOOK, r)): void {
  const games = SPRT.exChunk;
  const sides = c.examiners.map(([p, q]) => {
    const plus = binom(games, p, r);
    return { plus, minus: p >= 1 ? 0 : binom(games - plus, Math.min(1, q / (1 - p)), r), games };
  });
  addA(a, broken.tiedExaminers ? sides.map(() => sides[0]) : sides);
  if (broken.gamesAsUnits) {
    const f = Math.log(1 + SPRT.effect * 2);
    const g = Math.log(1 - SPRT.effect * 2);
    const before = b.llr;
    addB(b, pairs);
    b.llr = before + (2 * pairs.ww + pairs.wd + pairs.wl) * f + (2 * pairs.ll + pairs.ld + pairs.wl) * g;
  } else addB(b, pairs);
}

export interface Check {
  n: number;
  promoted: number;
  looks: number;
  /** The candidate's games, with a segment's look-ahead of 12 looks. */
  filled: number;
}

/** `n` candidates through the looks with the exam's own rule. */
export function simulate(n: number, c: Case, seed: number, broken: Broken = {}): Check {
  const r = rng(seed);
  let promoted = 0;
  let looks = 0;
  let filled = 0;
  for (let i = 0; i < n; i++) {
    const a = pathA();
    const b = pathB();
    for (let k = 1; k <= LOOKS; k++) {
      look(c, a, b, r, broken);
      const d = decide(a, b, false);
      if (d.verdict === "continue") continue;
      if (d.verdict === "promote") promoted++;
      looks += k;
      filled += Math.min(LOOKS, Math.ceil(k / 12) * 12);
      break;
    }
  }
  return { n, promoted: promoted / n, looks: looks / n, filled: (filled / n) * (SPRT.exChunk * 3 + SPRT.vsChunk) };
}

export interface Leaning {
  /** P(++) and P(--) around, the promoted one's edge, how much its results go with the map's leaning, the next one's. */
  p: number;
  edge: number;
  champion: number;
  next: number;
}
/** The case in the test: a champion 1.5 points better; the kept seeds break it plainly (about 2e-3). */
export const LEANING: Leaning = { p: 0.3, edge: 0.015, champion: 0.285, next: 0.3 };
/** The case measured 2026-11-23 (8.2e-4 with the seeds kept, path B alone). */
export const LEANING_MILD: Leaning = { p: 0.3, edge: 0.02, champion: 0.28, next: 0.3 };

export interface After {
  /** Champions made, then candidates (as strong as them) run. */
  champions: number;
  tries: number;
  promoted: number;
}
/**
 * After a promotion: champions made by the exam's own rule on seeds that lean one way or the other, then a candidate
 * exactly as strong as each, leaning with it, examined `repeats` times; `keep`: on the seeds that promoted the champion
 * (the control), else on a new block's.
 */
export function afterPromotion(n: number, l: Leaning, seed: number, keep: boolean, repeats = 1): After {
  const r = rng(seed);
  const examiners = exOf(0.056);
  const leans = new Uint8Array(LOOKS);
  const fill = (to: Uint8Array) => {
    for (let k = 0; k < to.length; k++) to[k] = binom(SEEDS_A_LOOK, 0.5, r);
  };
  const exam = (on: Uint8Array, edge: number, lean: number): boolean => {
    const a = pathA();
    const b = pathB();
    for (let k = 0; k < LOOKS; k++) {
      const x = drawPairs(pairAt(l.p, edge + lean), on[k], r);
      const y = drawPairs(pairAt(l.p, edge - lean), SEEDS_A_LOOK - on[k], r);
      const pairs: Pairs = { ww: x.ww + y.ww, wd: 0, wl: x.wl + y.wl, dd: 0, ld: 0, ll: x.ll + y.ll };
      look({ examiners, pair: pairAt(l.p) }, a, b, r, {}, pairs);
      const d = decide(a, b, false);
      if (d.verdict !== "continue") return d.verdict === "promote";
    }
    return false;
  };
  const out = { champions: 0, tries: 0, promoted: 0 };
  const fresh = new Uint8Array(LOOKS);
  for (let i = 0; i < n; i++) {
    fill(leans);
    if (!exam(leans, l.edge, l.champion)) continue;
    out.champions++;
    for (let j = 0; j < repeats; j++) {
      if (!keep) fill(fresh);
      out.tries++;
      if (exam(keep ? leans : fresh, 0, l.next)) out.promoted++;
    }
  }
  return out;
}

/** The exact expected factor of path A's look after `before`; `sameLook` (a control): lambda from counts that take it in. */
export function expectedA(examiners: readonly Ex[], before: PathA = pathA(), sameLook = false, tied = false): number {
  const n = SPRT.exChunk;
  // How one examiner's games can fall, and the product over them, by +/- of each.
  const one = examiners.map(([p, q]) => {
    let d = new Map<number, number>([[0, 1]]);
    for (let i = 0; i < n; i++) {
      const next = new Map<number, number>();
      for (const [k, w] of d) for (const [add, v] of [[0, 1 - p - q], [100, p], [1, q]]) if (v > 0) next.set(k + add, (next.get(k + add) ?? 0) + w * v);
      d = next;
    }
    return [...d];
  });
  const side = (k: number) => ({ plus: Math.floor(k / 100), minus: k % 100, games: n });
  const factor = (sides: ReturnType<typeof side>[]) => {
    const a = { ...before };
    if (!sameLook) {
      addA(a, sides);
      return Math.exp(a.llr - before.llr);
    }
    const plus = sides.reduce((x, s) => x + s.plus, 0);
    const minus = sides.reduce((x, s) => x + s.minus, 0);
    const l = lambdaA({ plus: before.plus + plus, minus: before.minus + minus, games: before.games + n * sides.length });
    return (1 + l) ** plus * (1 - l) ** minus;
  };
  let e = 0;
  if (tied) for (const [k, w] of one[0]) e += w * factor(one.map(() => side(k)));
  else for (const [k0, w0] of one[0]) for (const [k1, w1] of one[1]) for (const [k2, w2] of one[2]) e += w0 * w1 * w2 * factor([side(k0), side(k1), side(k2)]);
  return e;
}

/** The exact expected factor of path B's look after `before`; `gamesAsUnits` (a control): a seed's games as two units. */
export function expectedB(p: Pair, before: PathB = pathB(), gamesAsUnits = false): number {
  const outcomes: [number, number, number][] = [
    [1, 1, p.plus],
    [0, 0, p.minus],
    [1, 0, 1 - p.plus - p.minus],
  ];
  let e = 0;
  for (const [w0, w1, w] of outcomes) {
    if (gamesAsUnits) {
      e += w * (1 + (w0 === 1 ? 1 : -1) * SPRT.effect * 2) * (1 + (w1 === 1 ? 1 : -1) * SPRT.effect * 2);
      continue;
    }
    const one = noPairs();
    one[pairOf(w0, w1)] = 1;
    const b = { ...before };
    addB(b, one);
    e += w * Math.exp(b.llr - before.llr);
  }
  // The seeds of a look are independent and share its lambda: the look's factor is a seed's to the power of them.
  return e ** SEEDS_A_LOOK;
}

/** The cases no better than the champion: none may be promoted more than 2 alpha of the time. */
export function nullCases(): [string, Case][] {
  const out: [string, Case][] = [];
  for (const q of [0.056, 0.3]) {
    for (const [name, p] of [["measured", 0.098], ["independent", 0.25], ["together 0.4", 0.4], ["together 0.5", 0.5]] as const) out.push([`Q ${q}, pairs ${name}`, { examiners: exOf(q), pair: pairAt(p) }]);
  }
  out.push(["examiners differ, zero on average", { examiners: UNEVEN, pair: pairAt(0.25) }]);
  out.push(["with draws", { examiners: exOf(0.3), pair: pairAt(0.2, 0, 0.02) }]);
  return out;
}

if (process.argv[1]?.endsWith("sprt-check.ts")) {
  const mode = process.argv[2];
  const i = process.argv.indexOf("--n");
  const n = i >= 0 ? Number(process.argv[i + 1]) : 1_000_000;
  const print = (name: string, out: object) => console.log(`${name}: ${JSON.stringify(out)}`);
  if (mode === "exact") {
    const later: PathA = { plus: 2, minus: 1, games: 120, llr: 0 };
    print("A, uneven", { first: expectedA(UNEVEN), later: expectedA(UNEVEN, later), control: expectedA(UNEVEN, pathA(), true) });
    for (const q of [0.056, 0.3]) print(`A, Q ${q}`, { first: expectedA(exOf(q)), later: expectedA(exOf(q), later), controlTied: expectedA(exOf(q), pathA(), false, true) });
    for (const p of [0.098, 0.25, 0.4, 0.5]) print(`B, P(++) ${p}`, { first: expectedB(pairAt(p)), control: expectedB(pairAt(p), pathB(), true) });
  } else if (mode === "all") {
    for (const [name, c] of nullCases()) print(`equal, ${name}`, simulate(n, c, 11));
    print("control: examiners tied on a seed", simulate(n / 10, { examiners: exOf(0.056), pair: pairAt(0.25) }, 12, { tiedExaminers: true }));
    for (const p of [0.4, 0.5]) print(`control: a seed's games as two units, ${p}`, simulate(n / 10, { examiners: exOf(0.056), pair: pairAt(p) }, 13, { gamesAsUnits: true }));
    for (const q of [0.056, 0.3]) {
      for (const p of [0.098, 0.25, 0.4]) print(`5 points head to head, Q ${q}, pairs ${p}`, simulate(n / 50, { examiners: exOf(q), pair: pairAt(p, 0.05) }, 14));
      print(`5 points on the examiners, Q ${q}`, simulate(n / 50, { examiners: exOf(q, 0.05), pair: pairAt(0.25) }, 15));
    }
    for (const [name, l] of [["strong", LEANING], ["mild", LEANING_MILD]] as const) {
      print(`leaning ${name}, control: seeds kept`, afterPromotion(n, l, 16, true, 20));
      print(`leaning ${name}, a new block`, afterPromotion(n, l, 16, false, 20));
    }
  } else {
    console.error("sprt-check.ts all [--n N] | exact");
    process.exitCode = 2;
  }
}
