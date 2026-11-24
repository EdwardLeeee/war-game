// D-147 step 4 (PR B; ceo 2026-11-21): the automatic exam and promotion, pure. `needed` lists the games still to play
// for the state as it is; `step` takes the results so far and moves the state on (decides candidates, promotes, pauses).
// exam-auto.ts plays the games (work) and keeps the state (merge) in CI; nothing here plays a game. Never imported by
// the simulation Worker.
//
// A candidate is a hard plan (Partial<HardPlan> over HARD, "{}" being hard itself); the champion starts as the
// baseline, hard as the training's code has it with every new switch off (selftrain-plan 4.4).
//
// The seeds come in blocks (ceo 2026-11-23; why: sprt.ts condition 1, and sprt-check.ts "kept" for what goes wrong
// without): a block is opened for one champion, recorded with it (State.blocks), and nothing else plays in it. A new
// block when a candidate is promoted, and, when the program or settings that make candidates changed (State.source),
// before the next candidate is taken (the one under exam was made before the change and ends in its block). Playing or
// counting with a champion that is not its block's throws (blockOf). For each candidate:
//   exam   looks of SPRT.exChunk games per examiner and SPRT.vsChunk head to head (sprt.ts decide after every look, in
//          order). Up to AUTO.lookAhead looks are listed at once, so a segment's jobs have work; a decision drops the rest.
//   final  only for a candidate about to be promoted: the "not worse" checks (FINAL), then promoted or rejected.
// Once per block: the champion against itself (A/A: on SEEDS.mirrorCount seeds from both spawns, which must be the very
// same game with the opposite result, else the measuring is wrong: pause; it is no statistical test. SEEDS.aaCount
// seeds from one spawn give its draws, for the finalist's check). After a promotion, once per champion, the new
// champion against the baseline (a score AUTO.baseDrop standard errors under the best so far: pause).
// Pauses too: a block that would take the candidates listed past AUTO.candidatesMax since the last resume (listedSum:
// what the bound adds up; ceo 2026-11-24), AUTO.roundsWithout rounds in a row with no promotion, the canary
// games' hashes changed (the rules or the code changed under the training), the blocks run out, and the queue run out.
//
// PR C (selftrain-plan 4.3; ceo 2026-11-24): a training with `gen` settings makes its candidates in rounds once its
// list is used up. A round: gen.ts proposes from the champion's plan (and nothing of the exam), each proposal plays a
// few screening games on seeds of the training's range made for that round, gen.ts picks the list from those, and a new
// block is opened for it (one round, one block: its list is fixed before any of its games). Then the list is examined
// as any. gen.rounds rounds at most, then done. A block with no list plays no A/A (nothing to compare with it).

import type { HardPlan } from "../ai.ts";
import type { MapMode } from "../../protocol.ts";
import type { Plan } from "../scripted-player.ts";
import { checkSettings, type GenSettings, pick, propose, type ScreenGame, screenExaminerSeed, screenVsSeed } from "./gen.ts";
import { normalize, planHash } from "./hard-space.ts";
import { blockBase, EXAM_SEEDS } from "./seeds.ts";

export { planHash };
import { addA, addB, decide, noPairs, pairOf, pathA, pathB, type Side, SPRT } from "./sprt.ts";
import type { Job, JobResult } from "./worker.ts";

export type HP = Partial<HardPlan>;

/**
 * The seeds (seeds.ts has the ranges). `block`: where each use starts within a champion's block, no seed used for two
 * things or by two examiners. `fixed`: for the whole training, never changed, as neither can promote.
 */
export const SEEDS = {
  block: {
    /** Examiner games: the e-th examiner's i-th game is ex + e * exCount + i, the candidate and the champion alike. */
    ex: 0,
    /** Head to head: vs + j, from both spawns. */
    vs: 6000,
    /** The finalist against normal, fixed and random maps, from both spawns. */
    normalFixed: 8000,
    normalRandom: 8100,
    /** The champion against itself: every seed from one spawn, the first mirrorCount from both. */
    aa: 8200,
  },
  examiners: 3,
  exCount: SPRT.exMax / 3,
  vsCount: SPRT.vsMax / 2,
  aaCount: 100,
  mirrorCount: 10,
  normalCount: 50,
  fixed: {
    /** The canary: three games whose hashes must not change during a training. */
    canary: EXAM_SEEDS.fixed,
    /** A new champion against the baseline, from both spawns (the same seeds for each, to compare them). */
    base: EXAM_SEEDS.fixed + 1000,
  },
  baseCount: 200,
  canaryCount: 3,
} as const;

/** Each use's first seed in block `n`. */
function seedsOf(n: number) {
  const b = blockBase(n);
  const at = SEEDS.block;
  return { base: b, ex: (e: number, i: number) => b + at.ex + e * SEEDS.exCount + i, vs: b + at.vs, normalFixed: b + at.normalFixed, normalRandom: b + at.normalRandom, aa: b + at.aa };
}

/** The finalist's "not worse" checks (selftrain-plan 4.4; ceo 2026-11-21: constants, listed in the PR). */
export const FINAL = {
  /** Wins against normal at least (hard's floor): fixed map, random map. */
  normalFixed: 0.75,
  normalRandom: 0.8,
  /** Draws: its share at most this over the champion's (head to head against the A/A's; examiners: same seeds). */
  drawsMore: 0.05,
  /** Games where 10 of its soldiers reached the enemy's main city (against normal): at most this under the champion's. */
  reachedLess: 0.05,
  /** Think time per think at most this times the champion's (against normal). */
  thinkRatio: 1.5,
} as const;

export const AUTO = {
  /** Looks listed at once, at most; a training's config can set fewer. */
  lookAhead: 12,
  candidatesMax: SPRT.candidatesMax,
  roundsWithout: 10,
  baseDrop: 2,
  /** Minutes of a game at most (then a draw: the scripted player's "open"). */
  capMinutes: 90,
} as const;
const CAP = AUTO.capMinutes * 1200;
/** Looks at most: both paths' games run out together (6,000 examiner games and 4,000 head to head at look 100). */
export const MAX_LOOKS = Math.min(SEEDS.exCount / SPRT.exChunk, SEEDS.vsCount / (SPRT.vsChunk / 2));

/** A game's result as kept. `w`: 1 the side measured won, 0 lost, -1 neither by the cap; on an examiner game the side
 * measured is the examiner (the player): 1 means hard lost. `h`: the final hash. The rest: the side measured (play games). */
export interface Res {
  w: number;
  h: string;
  reached?: boolean;
  thinks?: number;
  ms?: number;
}
export interface Item {
  key: string;
  job: Job;
}
export interface Examiner {
  id: string;
  plan: Plan;
  map: MapMode;
}
export interface Candidate {
  id: string;
  plan: HP;
  /** Candidates come in rounds (a training's batches); AUTO.roundsWithout counts rounds. */
  round: number;
}
export interface Pause {
  /** P-<run id of the segment that paused>: what AI_TRAIN_RESUME is set to (the dispatcher's pauses are named alike). */
  id: string;
  /** Which check paused it: what resuming resets (resume). */
  kind: "max" | "rounds" | "aa" | "base" | "canary" | "blocks";
  reason: string;
  numbers: string[];
  at: string;
}
export interface Decided {
  id: string;
  hash: string;
  verdict: "promote" | "reject";
  why: string;
  looks: number;
  /** The block it was examined in. */
  block: number;
  ex: Side;
  vs: Side;
  /** Measured: the share of examiner games where candidate and champion differ; Qb (sprt.ts); draws head to head. */
  q: number;
  qb: number;
  draws: number;
  final?: Record<string, number>;
  at: string;
}
/** A block of seeds as opened. */
export interface Block {
  n: number;
  /** The champion it was opened for: the only one that may play in it. */
  champion: string;
  /** What made the candidates when it was opened (State.source). */
  source: string;
  /** The candidates waiting when it was opened: what the bound adds up (listedSum). */
  listed: number;
  opened: string;
  why: string;
}
/** A training: its name, its own blocks (exam-blocks.json), what makes its candidates (a hash), its look-ahead. */
export interface Training {
  name: string;
  first: number;
  last: number;
  source: string;
  lookAhead?: number;
  /** PR C: candidates made in rounds once the list is used up (gen.ts); none: only the list. */
  gen?: GenSettings;
}
export const STATE_VERSION = 3;
export interface State {
  version: typeof STATE_VERSION;
  training: { name: string; first: number; last: number };
  /** The hash of the program and settings that make candidates, as they are now (setSource). */
  source: string;
  lookAhead: number;
  /** Every block opened, the last the one playing. */
  blocks: Block[];
  examiners: Examiner[];
  /** Every plan by its hash. */
  plans: Record<string, HP>;
  baseline: string;
  champion: string;
  queue: Candidate[];
  current: { id: string; hash: string; round: number; stage: "exam" | "final"; looks: number; block: number } | null;
  results: Record<string, Res>;
  tested: number;
  /** listedSum when a "max" pause was last resumed: AUTO.candidatesMax counts from there. */
  listedAtResume: number;
  /** A block due but not opened (a pause stopped it: over AUTO.candidatesMax, or none left): why it is due. */
  blockDue: string | null;
  lastRound: number;
  promotedInRound: boolean;
  roundsWithout: number;
  /** By block: the mirrored pairs that were not the same game, and the draws of the games from one spawn. */
  aa: Record<string, { pairs: number; differ: number; draws: number; games: number }>;
  base: Record<string, { score: number; se: number; games: number }>;
  canary: { hashes: string[]; tree: string; commit: string } | null;
  paused: Pause | null;
  done: boolean;
  decided: Decided[];
  log: { at: string; what: string }[];
  /** PR C: the generator's settings (null: only the list given). */
  gen: GenSettings | null;
  /** The next round's number, and the rounds made so far. */
  genRound: number;
  genRounds: number;
  /** Every plan proposed so far, by hash (what was proposed, never how it did: gen.ts proposes none twice). */
  proposed: string[];
  /** A round being screened: its proposals (their plans in `plans`) and what was dropped before any game. */
  screen: { round: number; plans: string[]; invalid: number; repeated: number } | null;
}


export function init(examiners: Examiner[], candidates: Candidate[], training: Training, baseline: HP = {}, at = ""): State {
  const { name, first, last, source } = training;
  if (examiners.length !== SEEDS.examiners) throw new Error(`${examiners.length} examiners: a block has seeds for ${SEEDS.examiners}`);
  blockBase(first);
  blockBase(last);
  if (last < first) throw new Error(`${name}: blocks ${first}-${last}`);
  if (candidates.length > AUTO.candidatesMax) throw new Error(`${name}: ${candidates.length} candidates listed, at most ${AUTO.candidatesMax} at once (each listed one adds to the bound)`);
  const lookAhead = training.lookAhead ?? AUTO.lookAhead;
  if (!Number.isInteger(lookAhead) || lookAhead < 1 || lookAhead > AUTO.lookAhead) throw new Error(`${name}: lookAhead ${lookAhead}: 1-${AUTO.lookAhead}`);
  if (training.gen !== undefined) checkSettings(training.gen, examiners.length);
  const b = planHash(baseline);
  const s: State = {
    version: STATE_VERSION,
    training: { name, first, last },
    source,
    lookAhead,
    blocks: [{ n: first, champion: b, source, listed: candidates.length, opened: at, why: "開始" }],
    examiners,
    plans: { [b]: baseline },
    baseline: b,
    champion: b,
    queue: candidates.map((c) => ({ ...c })),
    current: null,
    results: {},
    tested: 0,
    listedAtResume: 0,
    blockDue: null,
    lastRound: -1,
    promotedInRound: false,
    roundsWithout: 0,
    aa: {},
    base: {},
    canary: null,
    paused: null,
    done: false,
    decided: [],
    gen: training.gen ?? null,
    genRound: 1 + Math.max(-1, ...candidates.map((c) => c.round)),
    genRounds: 0,
    proposed: [planHash(normalize(baseline)), ...candidates.map((c) => planHash(normalize(c.plan)))],
    screen: null,
    log: [{ at, what: `開始 ${name}：基準 ${b}，${candidates.length} 個候選，考官 ${examiners.map((e) => e.id).join("、")}，種子第 ${first} 批（這次訓練有 ${first}-${last}）` }],
  };
  for (const c of candidates) s.plans[planHash(c.plan)] = c.plan;
  return s;
}

/** Throws on a state of another version (an older one's seeds and rule are not this one's). */
export function checkState(s: State): void {
  if (s.version !== STATE_VERSION) throw new Error(`exam state version ${s.version}: this program plays version ${STATE_VERSION}; start a training of a new name with blocks of its own (exam-blocks.json)`);
}

/**
 * The block playing, checked (sprt.ts condition 1): opened for the champion there is now, after every one before it,
 * and the candidate under exam began in it. Anything else throws: no game is listed or counted on another's seeds.
 */
export function blockOf(s: State): Block {
  checkState(s);
  const b = s.blocks.at(-1);
  if (b === undefined) throw new Error("exam: no block of seeds is open");
  if (b.champion !== s.champion) throw new Error(`exam: block ${b.n} was opened for champion ${b.champion}, not ${s.champion}: a new champion plays on new seeds (sprt.ts, condition 1)`);
  if (s.blocks.slice(0, -1).some((x) => x.n >= b.n) || b.n < s.training.first || b.n > s.training.last) throw new Error(`exam: block ${b.n} is not a new one of ${s.training.name}'s ${s.training.first}-${s.training.last}`);
  if (s.current !== null && s.current.block !== b.n) throw new Error(`exam: ${s.current.id} began in block ${s.current.block}, block ${b.n} is open`);
  return b;
}

/** The candidates listed at each block's start, added up: a training promotes one no better at most this x 2 alpha. */
export function listedSum(s: State): number {
  return s.blocks.reduce((a, b) => a + b.listed, 0);
}

/**
 * Opens the next block for the champion, the candidates waiting its list. Pauses instead (the block due, opened once
 * resumed) when the training has none left, or when the list would take listedSum past AUTO.candidatesMax since the
 * last resume (ceo 2026-11-24: the bound, not the candidates tested, is what is capped).
 */
function openBlock(s: State, why: string, pauseId: string, at: string): void {
  const n = Math.max(...s.blocks.map((b) => b.n)) + 1;
  s.blockDue = why;
  if (n > s.training.last) {
    pause(s, pauseId, "blocks", `考試種子用完了（${s.training.name} 只有第 ${s.training.first}-${s.training.last} 批）：要用新的名字開一次訓練`, [], at);
    return;
  }
  const since = listedSum(s) - s.listedAtResume;
  if (since + s.queue.length > AUTO.candidatesMax) {
    pause(s, pauseId, "max", `考試的名單上次恢復以後已經 ${since} 個（各批開批時的名單加總），再開一批（${s.queue.length} 個）會超過 ${AUTO.candidatesMax} 個`, [`名單加總 ${listedSum(s)}`, `上限 ${(Math.min(1, (listedSum(s) + s.queue.length) * 2 * SPRT.alpha) * 100).toFixed(2)}%`], at);
    return;
  }
  s.blockDue = null;
  s.blocks.push({ n, champion: s.champion, source: s.source, listed: s.queue.length, opened: at, why });
  s.log.push({ at, what: `換考試種子：第 ${n} 批（${why}；最強版 ${s.champion}，名單 ${s.queue.length} 個）` });
}

/** Notes what makes the candidates now; if it changed, the next candidate taken starts a new block (step). */
export function setSource(s: State, source: string, at: string): void {
  checkState(s);
  if (s.source === source) return;
  s.source = source;
  s.log.push({ at, what: `產生候選的程式或設定改了（${source}）：下一個候選換一批考試種子` });
}

const exKey = (plan: string, e: string, seed: number) => `ex|${plan}|${e}|${seed}`;
const playKey = (kind: string, me: string, opp: string, seed: number, swap: boolean) => `${kind}|${me}|${opp}|${seed}|${swap ? 1 : 0}`;

function exItem(s: State, plan: string, e: Examiner, seed: number): Item {
  return { key: exKey(plan, e.id, seed), job: { kind: "scripted", seed, plan: e.plan, map: e.map, cap: CAP, hard: s.plans[plan] } };
}
function playItem(s: State, kind: string, me: string, opp: string, seed: number, swap: boolean, map: MapMode): Item {
  const o = opp === "normal" ? { kind: "normal" as const } : { kind: "hard" as const, plan: s.plans[opp] };
  return { key: playKey(kind, me, opp, seed, swap), job: { kind: "play", spec: { seed, map, swap, maxTicks: CAP, opp: o }, net: null, plan: s.plans[me] } };
}
const both = (n: number, from: number, f: (seed: number, swap: boolean) => Item) => Array.from({ length: n * 2 }, (_, i) => f(from + (i >> 1), (i & 1) === 1));

/** The games of look `k` of candidate `c` (its own and the champion's examiner games, and head to head). */
export function lookItems(s: State, c: string, k: number): Item[] {
  const at = seedsOf(blockOf(s).n);
  const items: Item[] = [];
  s.examiners.forEach((e, j) => {
    for (let i = k * SPRT.exChunk; i < (k + 1) * SPRT.exChunk; i++) items.push(exItem(s, c, e, at.ex(j, i)), exItem(s, s.champion, e, at.ex(j, i)));
  });
  const per = SPRT.vsChunk / 2;
  items.push(...both(per, at.vs + k * per, (seed, swap) => playItem(s, "vs", c, s.champion, seed, swap, "random")));
  return items;
}
export function finalItems(s: State, c: string): Item[] {
  const at = seedsOf(blockOf(s).n);
  const items: Item[] = [];
  for (const p of [c, s.champion]) {
    items.push(...both(SEEDS.normalCount, at.normalFixed, (seed, swap) => playItem(s, "nf", p, "normal", seed, swap, "fixed")));
    items.push(...both(SEEDS.normalCount, at.normalRandom, (seed, swap) => playItem(s, "nr", p, "normal", seed, swap, "random")));
  }
  return items;
}
/** The champion against itself: the mirrored pairs first, then the other seeds from one spawn. */
export function aaItems(s: State): Item[] {
  const from = seedsOf(blockOf(s).n).aa;
  const item = (seed: number, swap: boolean) => playItem(s, "aa", s.champion, s.champion, seed, swap, "random");
  return [...both(SEEDS.mirrorCount, from, item), ...Array.from({ length: SEEDS.aaCount - SEEDS.mirrorCount }, (_, j) => item(from + SEEDS.mirrorCount + j, false))];
}
export const baseItems = (s: State, h: string) => both(SEEDS.baseCount, SEEDS.fixed.base, (seed, swap) => playItem(s, "bl", h, s.baseline, seed, swap, "random"));
/** The canary: the baseline against the first examiner, against itself and against normal; replayed every segment. */
export function canaryItems(s: State): Item[] {
  return [
    { ...exItem(s, s.baseline, s.examiners[0], SEEDS.fixed.canary), key: "canary|0" },
    { ...playItem(s, "cn", s.baseline, s.baseline, SEEDS.fixed.canary + 1, false, "random"), key: "canary|1" },
    { ...playItem(s, "cn", s.baseline, "normal", SEEDS.fixed.canary + 2, false, "fixed"), key: "canary|2" },
  ];
}

/** The first look of `h` from `from` on with a game not played yet (MAX_LOOKS: all played). */
function openLook(s: State, h: string, from: number): number {
  let k = from;
  while (k < MAX_LOOKS && has(s, lookItems(s, h, k))) k++;
  return k;
}

/** The screening games of the round being screened (PR C): the proposals' and the champion's, on the round's seeds. */
export function screenItems(s: State): Item[] {
  const sc = s.screen;
  const g = s.gen;
  if (sc === null || g === null) return [];
  const items: Item[] = [];
  s.examiners.forEach((e, j) => {
    for (let i = 0; i < g.screen.examiner; i++) {
      const seed = screenExaminerSeed(g.seed, sc.round, j, i);
      for (const p of [s.champion, ...sc.plans]) items.push({ ...exItem(s, p, e, seed), key: `sx|${p}|${e.id}|${seed}` });
    }
  });
  for (let j = 0; j < g.screen.vs; j++) {
    for (const p of sc.plans) items.push(...[false, true].map((swap) => ({ ...playItem(s, "sv", p, s.champion, screenVsSeed(g.seed, sc.round, j), swap, "random") })));
  }
  return items;
}

/** The round's screening games as gen.ts takes them: on its seeds, how each proposal did against the champion. */
function screenGames(s: State): ScreenGame[] {
  const sc = s.screen!;
  const g = s.gen!;
  const out: ScreenGame[] = [];
  for (const p of sc.plans) {
    s.examiners.forEach((e, j) => {
      for (let i = 0; i < g.screen.examiner; i++) {
        const seed = screenExaminerSeed(g.seed, sc.round, j, i);
        const rp = s.results[`sx|${p}|${e.id}|${seed}`];
        const rc = s.results[`sx|${s.champion}|${e.id}|${seed}`];
        out.push({ plan: p, kind: "ex", seed, differ: rp.h !== rc.h, d: rc.w === 1 && rp.w !== 1 ? 1 : rp.w === 1 && rc.w !== 1 ? -1 : 0 });
      }
    });
    for (let j = 0; j < g.screen.vs; j++) {
      const seed = screenVsSeed(g.seed, sc.round, j);
      for (const swap of [false, true]) {
        const w = s.results[playKey("sv", p, s.champion, seed, swap)].w;
        out.push({ plan: p, kind: "vs", seed, differ: true, d: w === 1 ? 1 : w === 0 ? -1 : 0 });
      }
    }
  }
  return out;
}

/** The games still to play, in order: the canary (always), the block's A/A, the champion's base games, the candidate's. */
export function needed(s: State): Item[] {
  checkState(s);
  if (s.paused !== null || s.done) return [];
  const block = blockOf(s);
  const items = [...canaryItems(s)];
  if (block.listed > 0 && s.aa[block.n] === undefined) items.push(...aaItems(s));
  if (s.champion !== s.baseline && s.base[s.champion] === undefined) items.push(...baseItems(s, s.champion));
  if (s.screen !== null) items.push(...screenItems(s));
  // The current candidate's looks not played yet, then (PR C) the first such looks of those after it in the list, about
  // s.lookAhead looks in all: with others waiting the current one takes half, so a decision leaves the next one's
  // games played rather than its own far looks unused. Only in this block (the list's), only looks not played yet.
  const c = s.current;
  const waiting = s.queue.map((x) => planHash(x.plan)).filter((h) => h !== s.champion && h !== c?.hash);
  let budget = s.lookAhead;
  if (c !== null) {
    if (c.stage === "exam") {
      const share = waiting.length > 0 && block.listed > 0 ? Math.max(1, Math.ceil(s.lookAhead / 2)) : s.lookAhead;
      const from = openLook(s, c.hash, c.looks);
      for (let k = from; k < Math.min(from + share, MAX_LOOKS); k++) items.push(...lookItems(s, c.hash, k));
      budget -= share;
    } else items.push(...finalItems(s, c.hash));
  }
  for (const h of block.listed > 0 ? waiting : []) {
    if (budget <= 0) break;
    const from = openLook(s, h, 0);
    const n = Math.min(budget, MAX_LOOKS - from);
    for (let k = from; k < from + n; k++) items.push(...lookItems(s, h, k));
    budget -= n;
  }
  // The canary always; the rest once each, and only those not played yet.
  const seen = new Set<string>();
  return items.filter((x) => {
    if (x.key.startsWith("canary|")) return true;
    if (s.results[x.key] !== undefined || seen.has(x.key)) return false;
    seen.add(x.key);
    return true;
  });
}

/** A played game's result as kept. */
export function resOf(r: JobResult): Res {
  if (r.kind === "scripted") return { w: r.outcome.result === "won" ? 1 : r.outcome.result === "lost" ? 0 : -1, h: r.outcome.finalHash };
  const o = r.outcome;
  return { w: o.won, h: o.finalHash, reached: o.reached, thinks: o.thinks, ms: o.thinkMs };
}

const has = (s: State, items: Item[]) => items.every((x) => s.results[x.key] !== undefined);

/**
 * Both paths over the first `looks` looks of candidate `c`, in order, as sprt.ts adds them; `same`: no examiner game of
 * the first look differs at all. `lambdas`: each look's two.
 */
export function tally(s: State, c: string, looks: number) {
  const at = seedsOf(blockOf(s).n);
  const ex = pathA();
  const vs = pathB();
  const lambdas: [number, number][] = [];
  let identical = 0;
  let firstLook = 0;
  let exOpen = 0;
  let champOpen = 0;
  let vsDraws = 0;
  for (let k = 0; k < looks; k++) {
    const sides = s.examiners.map((e, j) => {
      const side: Side = { plus: 0, minus: 0, games: 0 };
      for (let i = k * SPRT.exChunk; i < (k + 1) * SPRT.exChunk; i++) {
        const rc = s.results[exKey(c, e.id, at.ex(j, i))];
        const rh = s.results[exKey(s.champion, e.id, at.ex(j, i))];
        side.games++;
        // + when only the champion lost to the player (the examiner won), - when only the candidate did.
        if (rh.w === 1 && rc.w !== 1) side.plus++;
        else if (rc.w === 1 && rh.w !== 1) side.minus++;
        if (rc.w === -1) exOpen++;
        if (rh.w === -1) champOpen++;
        if (k === 0) {
          firstLook++;
          if (rc.h === rh.h) identical++;
        }
      }
      return side;
    });
    const pairs = noPairs();
    const per = SPRT.vsChunk / 2;
    for (let j = k * per; j < (k + 1) * per; j++) {
      const [w0, w1] = [false, true].map((swap) => s.results[playKey("vs", c, s.champion, at.vs + j, swap)].w);
      pairs[pairOf(w0, w1)]++;
      for (const w of [w0, w1]) if (w === -1) vsDraws++;
    }
    lambdas.push([addA(ex, sides), addB(vs, pairs)]);
  }
  return {
    ex,
    vs,
    lambdas,
    same: looks >= 1 && firstLook > 0 && identical === firstLook,
    q: ex.games === 0 ? 0 : (ex.plus + ex.minus) / ex.games,
    qb: vs.seeds === 0 ? 0 : vs.squares / (4 * vs.seeds),
    draws: vs.games === 0 ? 0 : vsDraws / vs.games,
    exOpenMore: ex.games === 0 ? 0 : (exOpen - champOpen) / ex.games,
  };
}

/** The finalist's checks: its numbers, and what failed (empty: passed). */
export function finalCheck(s: State, c: string): { numbers: Record<string, number>; failed: string[] } {
  const block = blockOf(s);
  const at = seedsOf(block.n);
  const games = (kind: string, p: string) => [false, true].flatMap((swap) => Array.from({ length: SEEDS.normalCount }, (_, i) => s.results[playKey(kind, p, "normal", (kind === "nf" ? at.normalFixed : at.normalRandom) + i, swap)]));
  const share = (rs: Res[], f: (r: Res) => boolean) => rs.filter(f).length / rs.length;
  const mine = [...games("nf", c), ...games("nr", c)];
  const theirs = [...games("nf", s.champion), ...games("nr", s.champion)];
  const perThink = (rs: Res[]) => rs.reduce((a, r) => a + (r.ms ?? 0), 0) / Math.max(1, rs.reduce((a, r) => a + (r.thinks ?? 0), 0));
  const t = tally(s, c, s.current?.looks ?? 0);
  const aa = s.aa[block.n];
  const numbers = {
    normalFixed: share(games("nf", c), (r) => r.w === 1),
    normalRandom: share(games("nr", c), (r) => r.w === 1),
    drawsVs: t.draws,
    drawsAa: aa === undefined ? 0 : aa.draws / Math.max(1, aa.games),
    exOpenMore: t.exOpenMore,
    reached: share(mine, (r) => r.reached === true),
    reachedChampion: share(theirs, (r) => r.reached === true),
    thinkRatio: perThink(mine) / Math.max(1e-9, perThink(theirs)),
  };
  const failed: string[] = [];
  if (numbers.normalFixed < FINAL.normalFixed) failed.push(`對普通（固定地圖）只贏 ${pct(numbers.normalFixed)}，要 ${pct(FINAL.normalFixed)} 以上`);
  if (numbers.normalRandom < FINAL.normalRandom) failed.push(`對普通（隨機地圖）只贏 ${pct(numbers.normalRandom)}，要 ${pct(FINAL.normalRandom)} 以上`);
  if (numbers.drawsVs - numbers.drawsAa > FINAL.drawsMore) failed.push(`平手多了：對目前最強版 ${pct(numbers.drawsVs)}，自己打自己 ${pct(numbers.drawsAa)}`);
  if (numbers.exOpenMore > FINAL.drawsMore) failed.push(`考官那邊未分的局多了 ${pct(numbers.exOpenMore)}`);
  if (numbers.reached < numbers.reachedChampion - FINAL.reachedLess) failed.push(`打到對方主城的局少了：${pct(numbers.reached)}，目前最強版 ${pct(numbers.reachedChampion)}`);
  if (numbers.thinkRatio > FINAL.thinkRatio) failed.push(`思考時間是目前最強版的 ${numbers.thinkRatio.toFixed(2)} 倍，最多 ${FINAL.thinkRatio} 倍`);
  return { numbers, failed };
}
const pct = (x: number) => `${Math.round(x * 100)}%`;

function pause(s: State, id: string, kind: Pause["kind"], reason: string, numbers: string[], at: string) {
  s.paused = { id, kind, reason, numbers, at };
  s.log.push({ at, what: `暫停 ${id}：${reason}` });
}

function finish(s: State, verdict: "promote" | "reject", why: string, pauseId: string, at: string, final?: Record<string, number>) {
  const c = s.current!;
  const t = tally(s, c.hash, c.looks);
  const side = ({ plus, minus, games }: Side): Side => ({ plus, minus, games });
  s.decided.push({ id: c.id, hash: c.hash, verdict, why, looks: c.looks, block: c.block, ex: side(t.ex), vs: side(t.vs), q: t.q, qb: t.qb, draws: t.draws, final, at });
  s.tested++;
  s.log.push({ at, what: `${verdict === "promote" ? "升級" : "不升級"} ${c.id}（${c.hash}）：${why}；第 ${c.block} 批、${c.looks} 次、考官 +${t.ex.plus}/-${t.ex.minus}、對最強版 +${t.vs.plus}/-${t.vs.minus}` });
  s.current = null;
  if (verdict === "promote") {
    s.champion = c.hash;
    s.promotedInRound = true;
    openBlock(s, `${c.id} 升級`, pauseId, at);
  }
  prune(s);
}

/**
 * Drops the results no longer needed, so the state stays small (6,000 examiner games of every candidate tested would
 * not): kept are the champion's and the current candidate's games on the open block's seeds (the champion's examiner
 * and normal games are the next candidates' comparison) and the champion's against the baseline until measured.
 * Nothing of a block closed is kept. What was decided is in `decided`, `aa` and `base`.
 */
export function prune(s: State): void {
  const b = s.blocks.at(-1);
  if (b === undefined) return;
  const from = blockBase(b.n);
  const keep = new Set([s.champion, s.current?.hash, ...s.queue.map((c) => planHash(c.plan))]);
  const screening = new Set(s.screen === null ? [] : [s.champion, ...s.screen.plans]);
  for (const k of Object.keys(s.results)) {
    const [kind, me, , seedText] = k.split("|");
    const seed = Number(seedText);
    if (kind === "sx" || kind === "sv") {
      if (!screening.has(me)) delete s.results[k];
      continue;
    }
    const here = kind === "bl" ? s.base[me] === undefined : seed >= from && seed < from + EXAM_SEEDS.blockSize;
    if (!here || !keep.has(me)) delete s.results[k];
  }
}

/**
 * Lifts the pause named `id` (AI_TRAIN_RESUME: the user said go on, the ceo told war-game-ai), resetting what made it,
 * so it does not pause again at once: the candidates' count, the rounds without a promotion, the canary (its new hashes
 * are kept: the training goes on with the code as it is now). A/A and base pauses are measured once a block and once a
 * champion. A training out of blocks cannot be resumed: it would play on a used one. Returns whether it lifted one.
 */
export function resume(s: State, id: string, at: string): boolean {
  if (s.paused === null || s.paused.id !== id || s.paused.kind === "blocks") return false;
  const p = s.paused;
  if (p.kind === "max") s.listedAtResume = listedSum(s);
  if (p.kind === "rounds") s.roundsWithout = 0;
  if (p.kind === "canary") s.canary = null;
  s.paused = null;
  s.log.push({ at, what: `恢復 ${id}（${p.reason}）` });
  return true;
}

/** A round's proposals (gen.ts): from the champion's plan, the round, the generator's settings and what was proposed. */
function startRound(s: State, at: string, did: string[]): void {
  const g = s.gen!;
  const round = s.genRound;
  const made = propose(s.plans[s.champion], round, g, new Set(s.proposed));
  for (const p of made.plans) {
    const h = planHash(p);
    s.plans[h] = p;
    s.proposed.push(h);
  }
  s.screen = { round, plans: made.plans.map(planHash), invalid: made.invalid, repeated: made.repeated };
  const what = `第 ${round} 輪：提了 ${made.plans.length} 個（範圍外 ${made.invalid}、提過的 ${made.repeated} 個不算），篩選`;
  s.log.push({ at, what });
  did.push(what);
}

/** A round's list from its screening games, and a block opened for it; a round with none listed counts as no promotion. */
function endRound(s: State, pauseId: string, at: string, did: string[]): void {
  const g = s.gen!;
  const sc = s.screen!;
  const picked = pick(sc.plans, screenGames(s), g, sc.round);
  s.queue = picked.list.map((h, k) => ({ id: `r${sc.round}-${k + 1}`, plan: s.plans[h], round: sc.round }));
  const listed = new Set(picked.list);
  for (const h of sc.plans) if (!listed.has(h) && h !== s.champion && h !== s.baseline) delete s.plans[h];
  s.screen = null;
  s.genRound++;
  s.genRounds++;
  for (const k of Object.keys(s.results)) if (k.startsWith("sx|") || k.startsWith("sv|")) delete s.results[k];
  const what = `第 ${sc.round} 輪的名單：${picked.list.length} 個（和最強版同一局 ${picked.same}、不同的局太少 ${picked.few} 個丟掉）`;
  s.log.push({ at, what });
  did.push(what);
  if (s.queue.length === 0) {
    // No candidate this round: a round with no promotion all the same.
    if (s.lastRound >= 0) s.roundsWithout = s.promotedInRound ? 0 : s.roundsWithout + 1;
    s.promotedInRound = false;
    s.lastRound = sc.round;
    if (s.roundsWithout >= AUTO.roundsWithout) pause(s, pauseId, "rounds", `連續 ${s.roundsWithout} 輪都沒有升級`, [], at);
    return;
  }
  openBlock(s, `第 ${sc.round} 輪`, pauseId, at);
  prune(s);
}

/**
 * Moves the state on as far as the results allow; `pauseId` names a pause it makes (the segment's P-<run id>). Returns
 * what it did, a line each.
 */
export function step(s: State, pauseId: string, at: string): string[] {
  const did: string[] = [];
  checkState(s);
  for (let guard = 0; guard < 10_000; guard++) {
    if (s.paused !== null || s.done) return did;
    if (s.blockDue !== null) {
      openBlock(s, s.blockDue, pauseId, at);
      prune(s);
      continue;
    }
    const block = blockOf(s);
    const ch = s.champion;
    // The champion against itself.
    const aa = aaItems(s);
    if (block.listed > 0 && s.aa[block.n] === undefined && has(s, aa)) {
      const m = { pairs: SEEDS.mirrorCount, differ: 0, draws: 0, games: SEEDS.aaCount };
      for (let i = 0; i < SEEDS.mirrorCount * 2; i += 2) {
        const a = s.results[aa[i].key];
        const b = s.results[aa[i + 1].key];
        // The same game seen from the other side: the same hash, and one won and one lost, or neither won in both.
        const opposite = (a.w === 1 && b.w === 0) || (a.w === 0 && b.w === 1) || (a.w === -1 && b.w === -1);
        if (a.h !== b.h || !opposite) m.differ++;
      }
      for (const x of aa) if (!x.key.endsWith("|1") && s.results[x.key].w === -1) m.draws++;
      s.aa[block.n] = m;
      did.push(`自己打自己（${ch}，第 ${block.n} 批）：${m.pairs - m.differ}/${m.pairs} 對是同一局、結果相反；平手 ${m.draws}/${m.games}`);
      if (m.differ > 0) {
        pause(s, pauseId, "aa", `自己打自己換邊不是同一局（${m.differ}/${m.pairs} 對）：換邊、決定性或量法壞了`, [`不符 ${m.differ}/${m.pairs} 對`], at);
        continue;
      }
    }
    // A new champion against the baseline.
    const bl = baseItems(s, ch);
    if (ch !== s.baseline && s.base[ch] === undefined && has(s, bl)) {
      const pts = bl.reduce((a, x) => a + (s.results[x.key].w === 1 ? 1 : s.results[x.key].w === -1 ? 0.5 : 0), 0);
      const score = pts / bl.length;
      const se = Math.sqrt(Math.max(1e-9, score * (1 - score)) / bl.length);
      const best = Math.max(0.5, ...Object.values(s.base).map((b) => b.score));
      s.base[ch] = { score, se, games: bl.length };
      did.push(`新的最強版 ${ch} 對基準：${pct(score)}（±${pct(se)}），歷來最好 ${pct(best)}`);
      if (score < best - AUTO.baseDrop * se) {
        pause(s, pauseId, "base", `新的最強版對基準掉了：${pct(score)}，比歷來最好的 ${pct(best)} 低 ${AUTO.baseDrop} 個標準差以上`, [`${pct(score)} ±${pct(se)}`, `最好 ${pct(best)}`], at);
        continue;
      }
    }
    // The next candidate.
    if (s.current === null) {
      if (s.queue.length === 0) {
        // The last champion's own checks (A/A, against the baseline) first: they can still pause.
        if ((block.listed > 0 && s.aa[block.n] === undefined) || (ch !== s.baseline && s.base[ch] === undefined)) return did;
        // PR C: the list used up, the next round.
        if (s.gen !== null && s.genRounds < s.gen.rounds) {
          if (s.screen === null) {
            startRound(s, at, did);
            continue;
          }
          if (!has(s, screenItems(s))) return did;
          endRound(s, pauseId, at, did);
          continue;
        }
      }
      if (s.queue.length > 0 && block.source !== s.source) {
        openBlock(s, "產生候選的程式或設定改了", pauseId, at);
        prune(s);
        continue;
      }
      const c = s.queue.shift();
      if (c === undefined) {
        s.done = true;
        const why = s.gen !== null ? `候選都考完了（產生了 ${s.genRounds} 輪）` : "候選都考完了";
        s.log.push({ at, what: why });
        did.push(why);
        return did;
      }
      if (c.round !== s.lastRound) {
        if (s.lastRound >= 0) s.roundsWithout = s.promotedInRound ? 0 : s.roundsWithout + 1;
        s.promotedInRound = false;
        s.lastRound = c.round;
        if (s.roundsWithout >= AUTO.roundsWithout) {
          s.queue.unshift(c);
          pause(s, pauseId, "rounds", `連續 ${s.roundsWithout} 輪都沒有升級`, [], at);
          continue;
        }
      }
      s.current = { id: c.id, hash: planHash(c.plan), round: c.round, stage: "exam", looks: 0, block: block.n };
      did.push(`開始考 ${c.id}（${s.current.hash}）`);
      if (s.current.hash === ch) {
        finish(s, "reject", "和目前最強版一模一樣", pauseId, at);
        did.push(`${c.id}：和目前最強版一模一樣，不考`);
      }
      continue;
    }
    const c = s.current;
    if (c.stage === "exam") {
      if (!has(s, lookItems(s, c.hash, c.looks))) return did;
      c.looks++;
      const t = tally(s, c.hash, c.looks);
      const d = decide(t.ex, t.vs, t.same);
      if (d.verdict === "continue") continue;
      if (d.verdict === "reject") {
        finish(s, "reject", d.why, pauseId, at);
        did.push(`${c.id}：不升級（${d.why}），第 ${c.looks} 次`);
        continue;
      }
      c.stage = "final";
      s.log.push({ at, what: `${c.id} 過了考試（${d.why}），做上線前檢查` });
      did.push(`${c.id}：過了考試（${d.why}），第 ${c.looks} 次；做上線前檢查`);
      continue;
    }
    // final: needs the champion's A/A too (its draws).
    if (!has(s, finalItems(s, c.hash)) || s.aa[block.n] === undefined) return did;
    const f = finalCheck(s, c.hash);
    if (f.failed.length === 0) {
      finish(s, "promote", "過了考試和上線前檢查", pauseId, at, f.numbers);
      did.push(`${c.id}：升級`);
    } else {
      finish(s, "reject", `上線前檢查沒過：${f.failed.join("；")}`, pauseId, at, f.numbers);
      did.push(`${c.id}：不升級（${f.failed.join("；")}）`);
    }
  }
  throw new Error("step: no end");
}

/** The canary: the hashes of this segment's canary games against those kept; a change pauses, a new tree is noted. */
export function checkCanary(s: State, hashes: string[], tree: string, commit: string, pauseId: string, at: string): string {
  if (hashes.length !== SEEDS.canaryCount) return "這一段沒有跑固定的三局";
  if (s.canary === null) {
    s.canary = { hashes, tree, commit };
    s.log.push({ at, what: `固定的三局：${hashes.join(" ")}（sim ${tree.slice(0, 12)}，commit ${commit.slice(0, 8)}）` });
    return `記下固定的三局：${hashes.join(" ")}`;
  }
  if (hashes.some((h, i) => h !== s.canary!.hashes[i])) {
    pause(s, pauseId, "canary", "固定的三局雜湊變了：規則或程式在訓練中途變了", [`原本 ${s.canary.hashes.join(" ")}`, `這次 ${hashes.join(" ")}`, `sim ${tree.slice(0, 12)}，commit ${commit.slice(0, 8)}`], at);
    return "固定的三局雜湊變了，暫停";
  }
  if (tree !== s.canary.tree) {
    s.log.push({ at, what: `程式改了（sim ${s.canary.tree.slice(0, 12)} → ${tree.slice(0, 12)}，commit ${commit.slice(0, 8)}），固定的三局雜湊一樣：繼續` });
    s.canary.tree = tree;
    s.canary.commit = commit;
    return "程式改了但固定的三局一樣，繼續（記進帳）";
  }
  return "固定的三局一樣";
}
