// D-086 B training, step 2: evolution strategies on the integer network itself (docs/research/2026-10-ai-nn.md).
// Each generation: pairs of candidates (the weights plus and minus one random step, rounded to integers),
// every candidate on the same games (seeds, spawns, opponents), scored, ranked; the weights move toward
// the better side of each pair. A game counts 1 for a win and 0 for a loss or a draw (draws are losses: no
// learning to sit at home); on top, small rewards from what D-086 A measured, shrinking to nothing over the
// generations (ceo 2026-10-19). It starts from the network that always chooses AS_HARD, so from hard's own
// strength.
// NN v2 (ceo 2026-10-29): the same opponents every generation, in fixed numbers (EsConfig.mix: hard, normal,
// and CI's scripted groups push, push-crush, push-turtle), no curriculum; the heads in EsConfig.fixed keep the
// start's output rows (from asHardNet: AS_HARD, always), so the search is over the others alone.

import { HEAD_BUILD, HEAD_MIX, NET_HEADS, NET_SHAPE, type NetWeights } from "../net.ts";
import { runAll } from "./pool.ts";
import type { GameOutcome, Opponent, Switches } from "./play.ts";
import type { Job } from "./worker.ts";

/** Games of a generation against each opponent (the same for every candidate). */
export interface Mix {
  hard: number;
  normal: number;
  /** --strategy push, every third with cavalry (push-cavalry). */
  push: number;
  crush: number;
  turtle: number;
}

export interface EsConfig {
  /** Candidate pairs per generation; each candidate plays every game of `mix`. */
  pairs: number;
  mix: Mix;
  /** Step size in weight units (weights are -127..127) and in bias units; how far the weights move. */
  sigma: number;
  sigmaBias: number;
  lr: number;
  /** The rewards on the way: their weight at generation 0, and the generation they are gone by. */
  shaping: number;
  shapingUntil: number;
  /** Time limit of a training game (ticks; no winner by then is a loss), and the share of games on the random map. */
  maxTicks: number;
  randomShare: number;
  /** The rule switches every game is played with (empty: as they are on main). */
  rules: Switches;
  /** Heads whose output rows stay as they start (from asHardNet: AS_HARD). */
  fixed: number[];
}

export const ES_DEFAULTS: EsConfig = {
  pairs: 4,
  // 32 games: hard 40%, normal 10%, push 20%, push-crush 20%, push-turtle 10% (rounded).
  mix: { hard: 13, normal: 3, push: 6, crush: 7, turtle: 3 },
  sigma: 4,
  sigmaBias: 64,
  lr: 2,
  shaping: 0.2,
  shapingUntil: 20,
  // 60 minutes: CI's AI-against-AI limit (D-112), and the scripted games' (ceo 2026-10-29).
  maxTicks: 72000,
  randomShare: 0.5,
  rules: {},
  fixed: [HEAD_MIX, HEAD_BUILD],
};

export interface EsState {
  config: EsConfig;
  /** The weights as one vector (weights then biases, layer by layer), in floating point: rounded to play. */
  theta: number[];
  generation: number;
  seed: number;
  history: GenerationReport[];
}

export interface GenerationReport {
  generation: number;
  games: number;
  won: number;
  draws: number;
  /** Per opponent (Opponent's kind): games and wins, over all candidates. */
  byOpp: Record<string, { games: number; won: number }>;
  /** Games where 10 or more of the trained side's soldiers stood by the enemy's main city (ceo: not hoarding at home). */
  reached: number;
  /** Per head, over all candidates' games: thinks with each choice (choice 0: AS_HARD). */
  choices: number[][];
  /** NN v2 (ceo 2026-10-30): candidates whose choices changed within a game (by the game, not one set for all of it). */
  varied: number;
  shaping: number;
  seconds: number;
}

/** A small seeded generator for training (not the game's: learn/ never runs in a game). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** The weights vector's layout: per layer, its weights then its biases. */
export function toVector(net: NetWeights): number[] {
  const v: number[] = [];
  for (const L of net.layers) v.push(...L.w, ...L.b);
  return v;
}

/** The integer network from a vector (rounded; weights kept to -127..127), with the shifts of `like`. */
export function fromVector(v: readonly number[], like: NetWeights): NetWeights {
  let at = 0;
  return {
    layers: like.layers.map((L) => {
      const w = Array.from({ length: L.inputs * L.outputs }, () => Math.max(-127, Math.min(127, Math.round(v[at++]))));
      const b = Array.from({ length: L.outputs }, () => Math.round(v[at++]));
      return { inputs: L.inputs, outputs: L.outputs, w, b, shift: L.shift };
    }),
  };
}

/** Each entry's step size: sigmaBias for biases, sigma for weights, 0 for the output rows of the fixed heads. */
export function stepSizes(like: NetWeights, c: EsConfig): number[] {
  const last = like.layers.length - 1;
  const fixedRow: boolean[] = [];
  NET_HEADS.forEach((k, h) => {
    for (let i = 0; i < k; i++) fixedRow.push(c.fixed.includes(h));
  });
  const m: number[] = [];
  like.layers.forEach((L, l) => {
    for (let o = 0; o < L.outputs; o++) for (let i = 0; i < L.inputs; i++) m.push(l === last && fixedRow[o] ? 0 : c.sigma);
    for (let o = 0; o < L.outputs; o++) m.push(l === last && fixedRow[o] ? 0 : c.sigmaBias);
  });
  return m;
}

/** The games of one generation: the same for every candidate. */
export function gamesFor(state: EsState, r: () => number): { seed: number; map: "fixed" | "random"; swap: boolean; opp: Opponent }[] {
  const m = state.config.mix;
  const opps: Opponent[] = [];
  for (let k = 0; k < m.hard; k++) opps.push({ kind: "hard" });
  for (let k = 0; k < m.normal; k++) opps.push({ kind: "normal" });
  for (let k = 0; k < m.push; k++) opps.push({ kind: "push", cavalry: k % 3 === 2 });
  for (let k = 0; k < m.crush; k++) opps.push({ kind: "crush" });
  for (let k = 0; k < m.turtle; k++) opps.push({ kind: "turtle" });
  return opps.map((opp, k) => ({
    seed: 1 + Math.floor(r() * 1_000_000),
    map: r() < state.config.randomShare ? ("random" as const) : ("fixed" as const),
    // Against hard and normal both spawns in turn; a scripted player is always player 0.
    swap: (k & 1) === 1,
    opp,
  }));
}

/** A game's score: 1 for a win (draws and losses 0), plus the rewards on the way at weight `shaping`. */
export function score(o: GameOutcome, shaping: number): number {
  const clamp = (v: number) => (v < -1 ? -1 : v > 1 ? 1 : v);
  const extra =
    (o.governed20 > 0 ? 1 : 0) +
    (1 - Math.min(11, o.stuck) / 11) +
    (o.ratio20 < 0 ? 0 : clamp(o.ratio20 - 1)) +
    (o.farmerHits === 0 ? 0 : o.farmerBack / o.farmerHits) +
    clamp(o.margin);
  return (o.won === 1 ? 1 : 0) + (shaping * extra) / 5;
}

/** Normal-ish noise for the steps (training only). */
function gauss(r: () => number): number {
  const u = Math.max(r(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/** One generation; returns its report and moves state.theta. */
export async function generation(state: EsState, like: NetWeights, threads?: number): Promise<GenerationReport> {
  const t0 = performance.now();
  const c = state.config;
  const r = rng(state.seed * 1009 + state.generation * 7919 + 1);
  const games = gamesFor(state, r);
  const step = stepSizes(like, c);
  const eps: number[][] = [];
  for (let p = 0; p < c.pairs; p++) eps.push(state.theta.map((_, i) => gauss(r) * step[i]));
  const candidates: NetWeights[] = [];
  for (const e of eps) {
    candidates.push(fromVector(state.theta.map((v, i) => v + e[i]), like));
    candidates.push(fromVector(state.theta.map((v, i) => v - e[i]), like));
  }
  const jobs: Job[] = [];
  for (const net of candidates) for (const g of games) jobs.push({ kind: "play", spec: { seed: g.seed, map: g.map, swap: g.swap, maxTicks: c.maxTicks, opp: g.opp, rules: c.rules }, net });
  const results = await runAll(jobs, threads);
  const shaping = state.generation >= c.shapingUntil ? 0 : (c.shaping * (c.shapingUntil - state.generation)) / c.shapingUntil;
  const fitness: number[] = [];
  let won = 0;
  let draws = 0;
  let reached = 0;
  const byOpp: Record<string, { games: number; won: number }> = {};
  const choices = NET_HEADS.map((k) => new Array(k).fill(0));
  let varied = 0;
  for (let k = 0; k < candidates.length; k++) {
    let f = 0;
    let changed = false;
    for (let g = 0; g < games.length; g++) {
      const o = results[k * games.length + g].outcome;
      if (o.combos.length > 1) changed = true;
      f += score(o, shaping);
      const by = (byOpp[games[g].opp.kind] ??= { games: 0, won: 0 });
      by.games++;
      if (o.won === 1) {
        won++;
        by.won++;
      }
      if (o.won < 0) draws++;
      if (o.reached) reached++;
      o.choices.forEach((h, i) => h.forEach((v, k) => (choices[i][k] += v)));
    }
    fitness.push(f);
    if (changed) varied++;
  }
  // Ranks, centred (-0.5..0.5): the weights move by each pair's rank difference along its step.
  const order = fitness.map((f, i) => [f, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rank = new Array(fitness.length);
  order.forEach(([, i], k) => (rank[i] = k / (fitness.length - 1) - 0.5));
  const n = state.theta.length;
  for (let p = 0; p < c.pairs; p++) {
    const d = rank[2 * p] - rank[2 * p + 1];
    if (d === 0) continue;
    for (let i = 0; i < n; i++) if (step[i] > 0) state.theta[i] += (c.lr * d * eps[p][i]) / (step[i] * c.pairs);
  }
  const total = candidates.length * games.length;
  const report: GenerationReport = { generation: state.generation, games: total, won, draws, byOpp, reached, shaping, choices, varied, seconds: Math.round((performance.now() - t0) / 1000) };
  state.generation++;
  state.history.push(report);
  return report;
}

export function newState(start: NetWeights, seed: number, config: Partial<EsConfig> = {}): EsState {
  const c = { ...ES_DEFAULTS, ...config };
  return { config: c, theta: toVector(start), generation: 0, seed, history: [] };
}

/** The shape every network here has (net.ts NET_SHAPE). */
export function sameShape(net: NetWeights): boolean {
  return net.layers.length + 1 === NET_SHAPE.length && net.layers.every((L, l) => L.inputs === NET_SHAPE[l] && L.outputs === NET_SHAPE[l + 1]);
}
