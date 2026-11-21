// D-147 step 4 (ceo 2026-11-21: in place of "2 standard deviations, checked on fresh seeds"): the promotion rule, a
// sequential probability ratio test (SPRT) on each of two paths, looked at after every chunk of games. Pure: no games.
// Never imported by the simulation Worker.
//
//   path A, harder for people: on the examiners' plans, fewer of the player's wins. Same seeds, game by game against the
//           champion: a seed where only the champion lost counts + for the candidate, one where only the candidate lost
//           counts -; seeds with the same result say nothing.
//   path B, stronger head to head: the candidate against the champion on the same seeds from both spawns; wins +,
//           losses -, draws say nothing.
//
// Each path is an SPRT of "the + share is 0.5" against "it is 0.5 + d"; it promotes when one path's ratio reaches its
// upper bound while the other path is not worse by a standard deviation (z >= -1), and rejects when both ratios reach
// their lower bounds, or the games run out. Looking after every chunk does not raise the error rates (it is how an SPRT
// works); "add games up to 4 times" of the first plan did (ai-tools promote-sim: 1.8% per candidate against 0.95%).
//
// The numbers (ceo 2026-11-21): each path at alpha 5e-5, so both together promote an equal candidate at most 1e-4 of the
// time (Bonferroni: not a guess from a simulation); 400 candidates in a training at most (then it pauses), so at least
// one false promotion in a whole training at most 4% (1 - (1 - 1e-4)^400 = 3.9%).
//
// Path A's H1 (ceo 2026-11-21, option 5; PR B trial: on `equal` only 5.6% of examiner seeds differed, not the 30%
// first assumed, and with H1 set from 30% a candidate playing nearly as hard took about 49 looks to reject): each look's
// H1 is 0.5 + effect / (2 Q), Q this candidate's own share of examiner seeds that differ so far (this look's included),
// clamped to [H1_MIN, H1_MAX]. The ratio is the sum of each look's + and - weighed with that look's H1 (addLook). It
// still promotes a candidate no better than the champion at most alpha of the time, because:
//   - H1 is chosen from how many seeds differ only, never from which side won them; under "no better" each differing
//     seed is + or - with even odds whatever their number, so every look's factor has mean 1 given what came before;
//   - every seed is used once for a candidate (fresh seeds each look), so the looks are independent given the counts;
//   - H1 is never under 0.5 (at least H1_MIN), so for a candidate in fact weaker each factor has mean under 1.
// The product is then a nonnegative (super)martingale, and it reaches 1/alpha with probability at most alpha (Ville's
// inequality). sprt-check.ts simulates it with this very code.

export const SPRT = {
  /** Each path's chance of promoting a candidate no better than the champion (both paths together: 2 x). */
  alpha: 5e-5,
  /** The chance of missing a candidate EFFECT better (each path, before the games run out). */
  beta: 0.1,
  /**
   * What "better" means: 5 percentage points. Head to head: 55% of the decided games. On the examiners: 5 points fewer
   * player wins, which over seeds where the two differ (DISCORDANT of them, assumed until measured) is 0.5 + EFFECT /
   * (2 x DISCORDANT) of those.
   */
  effect: 0.05,
  discordant: 0.3,
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

/** + and - counts of one path. */
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

/** Log-likelihood ratio of "+ share 0.5 + d" against "0.5". */
export function llr(s: Side, d: number): number {
  return s.plus * Math.log((0.5 + d) / 0.5) + s.minus * Math.log((0.5 - d) / 0.5);
}

/** The SPRT's bounds: promote at or above `upper`, reject at or below `lower`. */
export function bounds(alpha = SPRT.alpha, beta = SPRT.beta): { upper: number; lower: number } {
  return { upper: Math.log((1 - beta) / alpha), lower: Math.log(beta / (1 - alpha)) };
}

/** The + share under "better" on each path (path A's: the first rule, with Q assumed; see h1Ex for the one in use). */
export const EFFECT_EX = SPRT.effect / (2 * SPRT.discordant);
export const EFFECT_VS = SPRT.effect;

/** Path A's H1 bounds (as + share): never under 0.5; at most 0.9, so one differing seed never weighs too much. */
export const H1_MIN = 0.5 + SPRT.effect / 2;
export const H1_MAX = 0.9;

/** Path A's H1 for a look, from how many examiner seeds differ so far (`differ`) of `games` (never from which side). */
export function h1Ex(differ: number, games: number): number {
  if (differ <= 0 || games <= 0) return H1_MAX;
  return Math.min(H1_MAX, Math.max(H1_MIN, 0.5 + SPRT.effect / (2 * (differ / games))));
}

/** Path A so far: its counts and its ratio, look by look. */
export interface PathA extends Side {
  llr: number;
}
export const pathA = (): PathA => ({ plus: 0, minus: 0, games: 0, llr: 0 });

/** Adds a look's examiner results to path A (its H1 chosen first, from the counts with this look's); returns that H1. */
export function addLook(a: PathA, plus: number, minus: number, games: number): number {
  const h1 = h1Ex(a.plus + a.minus + plus + minus, a.games + games);
  a.llr += plus * Math.log(h1 / 0.5) + minus * Math.log((1 - h1) / 0.5);
  a.plus += plus;
  a.minus += minus;
  a.games += games;
  return h1;
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
 * The decision after a look, from everything so far on the two paths. `ex.games` and `vs.games` count all games played
 * (the caps); a candidate that plays exactly as the champion (no examiner seed differs, `same` true) is rejected at once:
 * there is nothing to test. `llrEx`: path A's ratio (addLook's; left out, the first rule's: H1 from Q assumed).
 */
export function decide(ex: Side, vs: Side, same = false, llrEx = llr(ex, EFFECT_EX)): Decision {
  const { upper, lower } = bounds();
  const llrVs = llr(vs, EFFECT_VS);
  const zEx = zSign(ex);
  const zVs = zSign(vs);
  const base = { llrEx, llrVs, zEx, zVs };
  if (same) return { verdict: "reject", why: "和目前最強版一模一樣", ...base };
  if (llrEx >= upper && zVs >= SPRT.notWorse) return { verdict: "promote", why: "A：考官那邊少輸", ...base };
  if (llrVs >= upper && zEx >= SPRT.notWorse) return { verdict: "promote", why: "B：對目前最強版變強", ...base };
  if (llrEx <= lower && llrVs <= lower) return { verdict: "reject", why: "兩條路都夠確定沒有變強", ...base };
  if (ex.games >= SPRT.exMax && vs.games >= SPRT.vsMax) return { verdict: "reject", why: "局數用完", ...base };
  return { verdict: "continue", why: "", ...base };
}
