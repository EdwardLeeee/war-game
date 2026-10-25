// D-086 B training, step 2: evolution strategies on the integer network itself (docs/research/2026-10-ai-nn.md).
// Each generation: pairs of candidates (the weights plus and minus one random step, rounded to integers),
// every candidate on the same games (seeds, spawns, opponents), scored, ranked; the weights move toward
// the better side of each pair. A game counts 1 for a win and 0 for a loss or a draw (draws are losses: no
// learning to sit at home); on top, small rewards from what D-086 A measured, shrinking to nothing over the
// generations (ceo 2026-10-19). It starts from the network that always chooses AS_HARD, so from hard's own
// strength; opponents from easy to hard (normal, hard, then a mix of hard, normal and the late scripted group)
// with the stage to start at in the settings (ES_DEFAULTS: the mix, as the start is as strong as hard already).

import { NET_HEADS, NET_SHAPE, type NetWeights } from "../net.ts";
import { runAll } from "./pool.ts";
import type { GameOutcome, Opponent, Switches } from "./play.ts";
import type { Job } from "./worker.ts";

export interface EsConfig {
  /** Candidate pairs per generation, and games each candidate plays (the same games for all). */
  pairs: number;
  games: number;
  /** Step size in weight units (weights are -127..127) and in bias units; how far the weights move. */
  sigma: number;
  sigmaBias: number;
  lr: number;
  /** The rewards on the way: their weight at generation 0, and the generation they are gone by. */
  shaping: number;
  shapingUntil: number;
  /** Curriculum: win share (of the pairs' games) that moves it from normal to hard, and from hard to the mix. */
  toHard: number;
  toMix: number;
  /** Time limit of a training game (ticks), and the share of games on the random map. */
  maxTicks: number;
  randomShare: number;
  /** The opponents' stage to start at: 0 normal, 1 hard, 2 the mix. */
  startStage: number;
  /** The rule switches every game is played with (empty: as they are on main). */
  rules: Switches;
}

export const ES_DEFAULTS: EsConfig = {
  pairs: 8,
  games: 8,
  sigma: 4,
  sigmaBias: 64,
  lr: 2,
  shaping: 0.2,
  shapingUntil: 60,
  toHard: 0.6,
  toMix: 0.45,
  maxTicks: 36000,
  randomShare: 0.5,
  startStage: 2,
  rules: {},
};

export interface EsState {
  config: EsConfig;
  /** The weights as one vector (weights then biases, layer by layer), in floating point: rounded to play. */
  theta: number[];
  generation: number;
  /** 0: against normal, 1: hard, 2: the mix. */
  stage: number;
  seed: number;
  history: GenerationReport[];
}

export interface GenerationReport {
  generation: number;
  stage: number;
  games: number;
  won: number;
  draws: number;
  /** Games where 10 or more of the trained side's soldiers stood by the enemy's main city (ceo: not hoarding at home). */
  reached: number;
  /** Per head, over all candidates' games: thinks with each choice (choice 0: AS_HARD). */
  choices: number[][];
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

/** Which entries of the vector are biases (they take sigmaBias). */
function biasMask(like: NetWeights): boolean[] {
  const m: boolean[] = [];
  for (const L of like.layers) {
    for (let i = 0; i < L.inputs * L.outputs; i++) m.push(false);
    for (let i = 0; i < L.outputs; i++) m.push(true);
  }
  return m;
}

/** The games of one generation: the same for every candidate. */
function gamesFor(state: EsState, r: () => number): { seed: number; map: "fixed" | "random"; swap: boolean; opp: Opponent }[] {
  const out = [];
  for (let k = 0; k < state.config.games; k++) {
    const seed = 1 + Math.floor(r() * 1_000_000);
    const map = r() < state.config.randomShare ? ("random" as const) : ("fixed" as const);
    let opp: Opponent;
    if (state.stage === 0) opp = { kind: "normal" };
    else if (state.stage === 1) opp = { kind: "hard" };
    else {
      const u = r();
      opp = u < 0.5 ? { kind: "hard" } : u < 0.75 ? { kind: "normal" } : { kind: "late" };
    }
    out.push({ seed, map, swap: (k & 1) === 1, opp });
  }
  return out;
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
  const bias = biasMask(like);
  const eps: number[][] = [];
  for (let p = 0; p < c.pairs; p++) eps.push(state.theta.map((_, i) => gauss(r) * (bias[i] ? c.sigmaBias : c.sigma)));
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
  const choices = NET_HEADS.map((k) => new Array(k).fill(0));
  for (let k = 0; k < candidates.length; k++) {
    let f = 0;
    for (let g = 0; g < games.length; g++) {
      const o = results[k * games.length + g].outcome;
      f += score(o, shaping);
      if (o.won === 1) won++;
      if (o.won < 0) draws++;
      if (o.reached) reached++;
      o.choices.forEach((h, i) => h.forEach((v, k) => (choices[i][k] += v)));
    }
    fitness.push(f);
  }
  // Ranks, centred (-0.5..0.5): the weights move by each pair's rank difference along its step.
  const order = fitness.map((f, i) => [f, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const rank = new Array(fitness.length);
  order.forEach(([, i], k) => (rank[i] = k / (fitness.length - 1) - 0.5));
  const n = state.theta.length;
  for (let p = 0; p < c.pairs; p++) {
    const d = rank[2 * p] - rank[2 * p + 1];
    if (d === 0) continue;
    for (let i = 0; i < n; i++) state.theta[i] += (c.lr * d * eps[p][i]) / ((bias[i] ? c.sigmaBias : c.sigma) * c.pairs);
  }
  const total = candidates.length * games.length;
  const report: GenerationReport = { generation: state.generation, stage: state.stage, games: total, won, draws, reached, shaping, choices, seconds: Math.round((performance.now() - t0) / 1000) };
  // Curriculum: on to the next opponents once the candidates win often enough against these.
  if (state.stage === 0 && won >= total * c.toHard) state.stage = 1;
  else if (state.stage === 1 && won >= total * c.toMix) state.stage = 2;
  state.generation++;
  state.history.push(report);
  return report;
}

export function newState(start: NetWeights, seed: number, config: Partial<EsConfig> = {}): EsState {
  const c = { ...ES_DEFAULTS, ...config };
  return { config: c, theta: toVector(start), generation: 0, stage: c.startStage, seed, history: [] };
}

/** The shape every network here has (net.ts NET_SHAPE). */
export function sameShape(net: NetWeights): boolean {
  return net.layers.length + 1 === NET_SHAPE.length && net.layers.every((L, l) => L.inputs === NET_SHAPE[l] && L.outputs === NET_SHAPE[l + 1]);
}
