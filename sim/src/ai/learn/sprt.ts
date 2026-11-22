// D-147 step 4 (ceo 2026-11-21; corrected 2026-11-23, D-162): the promotion rule, a sequential test on each of two
// paths, looked at after every chunk of games. Pure: no games. Never imported by the simulation Worker.
//
//   path A, harder for people: on the examiners' plans, fewer of the player's wins. The unit is a game: each examiner
//           has seeds of its own, and on each the candidate is compared with the champion: D = +1 when only the champion
//           lost, -1 when only the candidate did, 0 otherwise.
//   path B, stronger head to head: the unit is a seed, played from both spawns: X = the sum of the candidate's two games
//           (won +1, lost -1, neither 0), so -2 to 2. The two games of a seed are one map and go together; they are never
//           counted as two.
//
// "No better" is on average (ceo 2026-11-23): E[D] <= 0 over the three examiners together (not each of them), E[X] <= 0.
// Each path multiplies, unit by unit, (1 + lambda D) or (1 + lambda X), and promotes when its product reaches 1/alpha
// while the other path is not worse by a standard deviation (z >= -1). It rejects when both products are at the lower
// bound or the games run out; rejecting, and the checks before a promotion, can only make false promotions rarer.
//
// A candidate no better is promoted with probability at most 2 alpha = 1e-4, as long as all of these hold:
//   1. the seeds are new to both: neither the candidate, nor its champion, nor the program or settings that made the
//      candidate was chosen knowing any result on them (auto.ts: a block of seeds per champion; seeds.ts);
//   2. a unit is played once for a candidate and units share no seed (an examiner's game has a seed no other examiner
//      has; the two spawns of a seed are one unit);
//   3. lambda is fixed before a look from the looks before it alone (the first look: the assumed values). From counts
//      that take the look in, it is wrong even if only the number is used: where the examiners differ, how many games
//      differ tells which side won them;
//   4. in a look every examiner plays as many games and all share one lambda. Then the factor expected of the look is
//      the product over them of (1 + lambda E[D])^n <= exp(lambda n (sum of E[D])) <= 1. For B it is
//      (1 + lambda E[X])^n <= 1, whatever the two spawns have to do with each other;
//   5. every factor is above 0: lambda is clamped (LAMBDA_A, LAMBDA_B);
//   6. seeds are a fair draw of maps and games: consecutive numbers through the game's generator are taken as one;
//   7. the games of one exam are all played by the same rules (the canary pauses when they change).
// Then each product is a nonnegative supermartingale and ever reaches 1/alpha with probability at most alpha (Ville's
// inequality), however often it is looked at; the two paths add (a union bound).
//
// Over many candidates: those of one block share seeds and a champion's games, so they are not independent and
// 1 - (1 - 1e-4)^N does not apply. A block's candidates, all listed before its first game, add up (a union bound): at
// most 1e-4 x the candidates listed at the block's start; a training, the sum of that over its blocks (auto.ts listedSum).
// sprt-check.ts simulates the rule with this very code, the cases that broke the earlier ones among them.

export const SPRT = {
  /** Each path's chance of promoting a candidate no better than the champion (both paths together: 2 x). */
  alpha: 5e-5,
  /** The lower bound's: about the chance of missing a candidate EFFECT better (no part of the guarantee). */
  beta: 0.1,
  /** What "better" means: 5 percentage points (head to head, 55% of the games; examiners, 5 points fewer player wins). */
  effect: 0.05,
  /** The first look's assumption on path A: Q, the share of examiner games where candidate and champion differ. */
  discordant: 0.3,
  /** The first look's assumption on path B: Qb, the mean of X squared over 4 (0.5: the two spawns independent). */
  pairDiscordant: 0.5,
  /** Games per look: EX_CHUNK per examiner, VS_CHUNK head to head (VS_CHUNK / 2 seeds, both spawns). */
  exChunk: 20,
  vsChunk: 40,
  /** At most: examiner games over the whole roster, head-to-head games. */
  exMax: 6000,
  vsMax: 4000,
  /** The other path, not worse: its z at least this. */
  notWorse: -1,
  /** Candidates in one training at most; then it pauses. */
  candidatesMax: 400,
} as const;

/**
 * Lambda's range on path A, where |D| <= 1. At most 0.8: under 1, so no factor reaches 0 (the least is 1 - 0.8 = 0.2: one
 * game never takes more than four fifths of what was won). At least 0.05: effect / Q at Q = 1, the smallest the formula
 * gives. Above 0, so a candidate in fact weaker only loses.
 */
export const LAMBDA_A = { min: 0.05, max: 0.8 } as const;
/**
 * Lambda's range on path B, where |X| <= 2: A's halved, as X goes twice as far. At most 0.4: under 1/2, so no factor
 * reaches 0 (the least is 1 - 2 x 0.4 = 0.2). At least 0.025: half of effect / Qb at Qb = 1. Above 0.
 */
export const LAMBDA_B = { min: 0.025, max: 0.4 } as const;

const clamp = (v: number, r: { min: number; max: number }) => Math.min(r.max, Math.max(r.min, v));

/** + and - counts of one path, by game. */
export interface Side {
  plus: number;
  minus: number;
  /** Games played on this path (the decided and the undecided). */
  games: number;
}

/** z of a sign test: (plus - minus) / sqrt(plus + minus); 0 with nothing decided. */
export function zSign(s: Side): number {
  const n = s.plus + s.minus;
  return n === 0 ? 0 : (s.plus - s.minus) / Math.sqrt(n);
}

/** The bounds of a product's logarithm: promote at or above `upper` (1/alpha), reject at or below `lower`. */
export function bounds(alpha: number = SPRT.alpha, beta: number = SPRT.beta): { upper: number; lower: number } {
  return { upper: Math.log(1 / alpha), lower: Math.log(beta / (1 - alpha)) };
}

/** Path A so far. */
export interface PathA extends Side {
  llr: number;
}
export const pathA = (): PathA => ({ plus: 0, minus: 0, games: 0, llr: 0 });

/** Path A's lambda for the next look, from the looks so far: effect / Q, Q the share of games that differed. */
export function lambdaA(a: Side): number {
  if (a.games === 0) return clamp(SPRT.effect / SPRT.discordant, LAMBDA_A);
  const differ = a.plus + a.minus;
  return differ === 0 ? LAMBDA_A.max : clamp(SPRT.effect / (differ / a.games), LAMBDA_A);
}

/** Adds a look's games on path A, examiner by examiner; returns the lambda it used (taken before reading them). */
export function addA(a: PathA, look: readonly Side[]): number {
  const lambda = lambdaA(a);
  if (look.some((e) => e.games !== look[0].games || e.plus + e.minus > e.games)) throw new Error("path A: every examiner plays as many games in a look (sprt.ts, condition 4)");
  for (const e of look) {
    a.llr += e.plus * Math.log(1 + lambda) + e.minus * Math.log(1 - lambda);
    a.plus += e.plus;
    a.minus += e.minus;
    a.games += e.games;
  }
  return lambda;
}

/** A look's seeds on path B by their two games: won both, won and neither, one each, neither both, lost and neither, lost both. */
export interface Pairs {
  ww: number;
  wd: number;
  wl: number;
  dd: number;
  ld: number;
  ll: number;
}
export const noPairs = (): Pairs => ({ ww: 0, wd: 0, wl: 0, dd: 0, ld: 0, ll: 0 });

/** Which of Pairs a seed's two games are (1 won, 0 lost, -1 neither: auto.ts Res.w). */
export function pairOf(w0: number, w1: number): keyof Pairs {
  const wins = (w0 === 1 ? 1 : 0) + (w1 === 1 ? 1 : 0);
  const losses = (w0 === 0 ? 1 : 0) + (w1 === 0 ? 1 : 0);
  if (wins === 2) return "ww";
  if (losses === 2) return "ll";
  if (wins === 1) return losses === 1 ? "wl" : "wd";
  return losses === 1 ? "ld" : "dd";
}

/** Path B so far: plus and minus by game (for z), seeds and the sum of X squared (for lambda). */
export interface PathB extends Side {
  llr: number;
  seeds: number;
  squares: number;
}
export const pathB = (): PathB => ({ plus: 0, minus: 0, games: 0, llr: 0, seeds: 0, squares: 0 });

/** Path B's lambda for the next look, from the looks so far: effect / Qb, Qb the mean of X squared over 4. */
export function lambdaB(b: PathB): number {
  if (b.seeds === 0) return clamp(SPRT.effect / SPRT.pairDiscordant, LAMBDA_B);
  return b.squares === 0 ? LAMBDA_B.max : clamp(SPRT.effect / (b.squares / (4 * b.seeds)), LAMBDA_B);
}

/** Adds a look's seeds on path B; returns the lambda it used (taken before reading them). */
export function addB(b: PathB, p: Pairs): number {
  const lambda = lambdaB(b);
  b.llr += p.ww * Math.log(1 + 2 * lambda) + p.wd * Math.log(1 + lambda) + p.ld * Math.log(1 - lambda) + p.ll * Math.log(1 - 2 * lambda);
  const seeds = p.ww + p.wd + p.wl + p.dd + p.ld + p.ll;
  b.seeds += seeds;
  b.squares += 4 * (p.ww + p.ll) + p.wd + p.ld;
  b.games += 2 * seeds;
  b.plus += 2 * p.ww + p.wd + p.wl;
  b.minus += 2 * p.ll + p.ld + p.wl;
  return lambda;
}

export type Verdict = "promote" | "reject" | "continue";

export interface Decision {
  verdict: Verdict;
  /** Which path promoted ("A": the examiners, "B": head to head), or why it rejected. */
  why: string;
  llrEx: number;
  llrVs: number;
  zEx: number;
  zVs: number;
}

/**
 * The decision after a look, from both paths as addA and addB left them. `same`: a candidate that plays exactly as the
 * champion (every examiner game of the first look the same game): rejected at once, there is nothing to test.
 */
export function decide(a: PathA, b: PathB, same: boolean): Decision {
  const { upper, lower } = bounds();
  const zEx = zSign(a);
  const zVs = zSign(b);
  const base = { llrEx: a.llr, llrVs: b.llr, zEx, zVs };
  if (same) return { verdict: "reject", why: "和目前最強版一模一樣", ...base };
  if (a.llr >= upper && zVs >= SPRT.notWorse) return { verdict: "promote", why: "A：考官那邊少輸", ...base };
  if (b.llr >= upper && zEx >= SPRT.notWorse) return { verdict: "promote", why: "B：對目前最強版變強", ...base };
  if (a.llr <= lower && b.llr <= lower) return { verdict: "reject", why: "兩條路都夠確定沒有變強", ...base };
  if (a.games >= SPRT.exMax && b.games >= SPRT.vsMax) return { verdict: "reject", why: "局數用完", ...base };
  return { verdict: "continue", why: "", ...base };
}
