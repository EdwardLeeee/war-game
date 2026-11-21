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

/** The + share under "better" on each path. */
export const EFFECT_EX = SPRT.effect / (2 * SPRT.discordant);
export const EFFECT_VS = SPRT.effect;

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
 * there is nothing to test.
 */
export function decide(ex: Side, vs: Side, same = false): Decision {
  const { upper, lower } = bounds();
  const llrEx = llr(ex, EFFECT_EX);
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
