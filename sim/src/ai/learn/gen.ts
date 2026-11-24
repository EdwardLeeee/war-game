// D-147 PR C (selftrain-plan 4.3; ceo 2026-11-24): the candidates of a round, made from the champion's plan, and the
// cheap screening that drops those that play almost as the champion before they take a place in the exam's list.
// Pure: no games. Never imported by the simulation Worker.
//
// What this side sees, and nothing else (sprt.ts condition 1: no candidate is chosen knowing a result on the exam's seeds):
//   - the champion's plan (who won the exam is all it learns of it: the champion and its challengers are examined on a
//     block opened after it, so this tells nothing of the seeds they are examined on);
//   - the round's number and the training's seed;
//   - the hashes of the plans proposed before (to propose none twice: what was proposed, not how it did);
//   - the screening games of this round, on seeds of the training's range made from the round and the training's seed
//     alone (a new set each round, ceo 2026-11-24: never the same few maps to fit to).
// It takes no exam state (auto.ts calls it with exactly these), imports nothing of the exam's, reads no file, and pick
// throws on any game whose seed is not this round's screening seed. test/learn-gen.test.ts checks all of it.

import type { HardPlan } from "../ai.ts";
import { active, type Field, HARD_NOW, HARD_SPACE, type HP, normalize, planHash, validateHard } from "./hard-space.ts";
import { EXAM_SEEDS, isExamSeed } from "./seeds.ts";

export interface GenSettings {
  /** The training's seed (0-99): its screening seeds are its own. */
  seed: number;
  /** Proposals a round. */
  propose: number;
  /** Fields changed in a proposal, at least and at most. */
  changes: [number, number];
  /** Screening games a proposal: each examiner's, and seeds head to head (both spawns). */
  screen: { examiner: number; vs: number };
  /** Candidates a round lists at most. */
  list: number;
  /** A proposal whose examiner games differ from the champion's in fewer than this share is dropped. */
  minDiffer: number;
  /** Rounds made at most; then the training is done (a trial's end, and a brake). */
  rounds: number;
}

/** Screening seeds: 20,000,000 + seed x 100,000 + round x 100; in a round, examiner e's from e x 20, head to head from 60. */
export const SCREEN = { base: EXAM_SEEDS.training, perSeed: 100_000, perRound: 100, examinerMost: 20, vsFrom: 60, vsMost: 40, rounds: 1000, seeds: 100 } as const;

export function checkSettings(g: GenSettings, examiners: number): void {
  const bad = (why: string) => {
    throw new Error(`gen: ${why}`);
  };
  if (!Number.isInteger(g.seed) || g.seed < 0 || g.seed >= SCREEN.seeds) bad(`seed ${g.seed}: 0-${SCREEN.seeds - 1}`);
  if (!Number.isInteger(g.propose) || g.propose < 1 || g.propose > 200) bad(`propose ${g.propose}: 1-200`);
  if (!(Number.isInteger(g.changes[0]) && Number.isInteger(g.changes[1]) && g.changes[0] >= 1 && g.changes[1] >= g.changes[0] && g.changes[1] <= 5)) bad(`changes ${g.changes}: 1-5`);
  if (examiners * SCREEN.examinerMost > SCREEN.vsFrom) bad(`${examiners} examiners: screening seeds for ${SCREEN.vsFrom / SCREEN.examinerMost}`);
  if (!Number.isInteger(g.screen.examiner) || g.screen.examiner < 1 || g.screen.examiner > SCREEN.examinerMost) bad(`screen.examiner ${g.screen.examiner}: 1-${SCREEN.examinerMost}`);
  if (!Number.isInteger(g.screen.vs) || g.screen.vs < 0 || g.screen.vs > SCREEN.vsMost) bad(`screen.vs ${g.screen.vs}: 0-${SCREEN.vsMost}`);
  if (!Number.isInteger(g.list) || g.list < 1 || g.list > g.propose) bad(`list ${g.list}: 1-propose`);
  if (!(g.minDiffer >= 0 && g.minDiffer < 1)) bad(`minDiffer ${g.minDiffer}: 0-1`);
  if (!Number.isInteger(g.rounds) || g.rounds < 1 || g.rounds >= SCREEN.rounds) bad(`rounds ${g.rounds}: 1-${SCREEN.rounds - 1}`);
}

/** The first screening seed of round `round` of the training with seed `seed`: from those two alone. */
export function screenBase(seed: number, round: number): number {
  if (!Number.isInteger(round) || round < 0 || round >= SCREEN.rounds) throw new Error(`gen: round ${round}: 0-${SCREEN.rounds - 1}`);
  if (!Number.isInteger(seed) || seed < 0 || seed >= SCREEN.seeds) throw new Error(`gen: seed ${seed}`);
  return SCREEN.base + seed * SCREEN.perSeed + round * SCREEN.perRound;
}
export const screenExaminerSeed = (seed: number, round: number, e: number, i: number) => screenBase(seed, round) + e * SCREEN.examinerMost + i;
export const screenVsSeed = (seed: number, round: number, j: number) => screenBase(seed, round) + SCREEN.vsFrom + j;

/** A small seeded generator of its own (mulberry32), so this side's files are only these (the config's `generator`). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash32 = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

export interface Proposals {
  plans: HP[];
  /** Drawn but out of range or crossing fields (validateHard): dropped before any game. */
  invalid: number;
  /** Drawn but proposed before, or the champion itself. */
  repeated: number;
}

/**
 * The round's proposals: the champion with `changes` fields moved, each an int one or two steps, a switch flipped;
 * only fields that can change anything (their needs on). From the champion's plan, the round, the training's seed and
 * the hashes proposed before, nothing else.
 */
export function propose(champion: HP, round: number, g: GenSettings, proposedBefore: ReadonlySet<string>): Proposals {
  const r = rng(hash32(`gen|${g.seed}|${round}|${planHash(normalize(champion))}`));
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const fields = Object.keys(HARD_SPACE) as Field[];
  const out: HP[] = [];
  const seen = new Set([...proposedBefore, planHash(normalize(champion))]);
  let invalid = 0;
  let repeated = 0;
  for (let attempt = 0; attempt < g.propose * 50 && out.length < g.propose; attempt++) {
    const plan = { ...HARD_NOW, ...champion } as HardPlan;
    const n = g.changes[0] + Math.floor(r() * (g.changes[1] - g.changes[0] + 1));
    const changed = new Set<Field>();
    for (let k = 0; k < n; k++) {
      const can = fields.filter((f) => !changed.has(f) && active(plan, f));
      if (can.length === 0) break;
      const f = pick(can);
      const s = HARD_SPACE[f]!;
      changed.add(f);
      if (s.type === "bool") (plan as unknown as Record<string, unknown>)[f] = !plan[f];
      else (plan as unknown as Record<string, number>)[f] = (plan[f] as number) + (r() < 0.5 ? -1 : 1) * (r() < 0.75 ? 1 : 2) * s.step;
    }
    const p = normalize(plan);
    if (validateHard(p) !== "") {
      invalid++;
      continue;
    }
    const h = planHash(p);
    if (seen.has(h)) {
      repeated++;
      continue;
    }
    seen.add(h);
    out.push(p);
  }
  return { plans: out, invalid, repeated };
}

/** One screening game of a proposal: its seed, whether it differs from the champion's, and how it went for it (+1, 0, -1). */
export interface ScreenGame {
  plan: string;
  kind: "ex" | "vs";
  seed: number;
  /** Examiner games: a different game from the champion's on the same seed (by the final hash). */
  differ: boolean;
  /** Examiner: +1 only the champion lost to the player, -1 only the proposal did. Head to head: won +1, lost -1. */
  d: number;
}
export interface Picked {
  list: string[];
  /** Dropped: the same games as the champion's, or too few differing (under minDiffer). */
  same: number;
  few: number;
  scores: Record<string, { differ: number; score: number }>;
}

/**
 * The round's list from its screening games: drop what plays as the champion, rank the rest by how they did, the best
 * `list`. Throws on a game whose seed is not one of this round's screening seeds (never an exam seed).
 */
export function pick(plans: readonly string[], games: readonly ScreenGame[], g: GenSettings, round: number): Picked {
  const allowed = new Set<number>();
  for (let e = 0; e * SCREEN.examinerMost < SCREEN.vsFrom; e++) for (let i = 0; i < g.screen.examiner; i++) allowed.add(screenExaminerSeed(g.seed, round, e, i));
  for (let j = 0; j < g.screen.vs; j++) allowed.add(screenVsSeed(g.seed, round, j));
  const by = new Map(plans.map((h) => [h, { games: 0, differ: 0, score: 0 }]));
  for (const x of games) {
    if (isExamSeed(x.seed)) throw new Error(`gen: a game on the exam's seed ${x.seed}: the exam's results never come here`);
    if (!allowed.has(x.seed)) throw new Error(`gen: seed ${x.seed} is not one of round ${round}'s screening seeds`);
    const b = by.get(x.plan);
    if (b === undefined) throw new Error(`gen: a game of ${x.plan}, not proposed this round`);
    b.score += x.d;
    if (x.kind === "ex") {
      b.games++;
      if (x.differ) b.differ++;
    }
  }
  let same = 0;
  let few = 0;
  const kept: { h: string; score: number }[] = [];
  const scores: Picked["scores"] = {};
  for (const h of plans) {
    const b = by.get(h)!;
    const share = b.games === 0 ? 0 : b.differ / b.games;
    scores[h] = { differ: share, score: b.score };
    if (b.differ === 0) same++;
    else if (share < g.minDiffer) few++;
    else kept.push({ h, score: b.score });
  }
  kept.sort((a, b) => b.score - a.score || (a.h < b.h ? -1 : 1));
  return { list: kept.slice(0, g.list).map((x) => x.h), same, few, scores };
}
