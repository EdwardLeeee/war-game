// D-147 step 4 (PR B; ceo 2026-11-21): the automatic exam and promotion, pure. `needed` lists the games still to play
// for the state as it is; `step` takes the results so far and moves the state on (decides candidates, promotes, pauses).
// exam-auto.ts plays the games (work) and keeps the state (merge) in CI; nothing here plays a game. Never imported by
// the simulation Worker.
//
// A candidate is a hard plan (Partial<HardPlan> over HARD, "{}" being hard itself); the champion starts as the
// baseline, hard as the training's code has it with every new switch off (selftrain-plan 4.4). For each candidate:
//   exam   looks of SPRT.exChunk games per examiner and SPRT.vsChunk head to head (sprt.ts decide after every look, in
//          order). Up to AUTO.lookAhead looks are listed at once, so a segment's jobs have work; a decision drops the rest.
//   final  only for a candidate about to be promoted: the "not worse" checks (FINAL), then promoted or rejected.
// Once per champion: the champion against itself (A/A, |z| > AUTO.aaZ: the measuring is wrong, pause), and after a
// promotion the new champion against the baseline (a score AUTO.baseDrop standard errors under the best so far: pause).
// Pauses too: AUTO.candidatesMax candidates tested, AUTO.roundsWithout rounds in a row with no promotion, the canary
// games' hashes changed (the rules or the code changed under the training), and the queue run out.

import { createHash } from "node:crypto";
import type { HardPlan } from "../ai.ts";
import type { MapMode } from "../../protocol.ts";
import type { Plan } from "../scripted-player.ts";
import { decide, type Side, SPRT, zSign } from "./sprt.ts";
import type { Job, JobResult } from "./worker.ts";

export type HP = Partial<HardPlan>;

/**
 * The seeds (ceo 2026-11-21: exam seeds never those of training; reused only across candidates on the same path). None
 * overlap, nor touch CI's (1-100, 2,000,001-, 3,000,001-), the examiner search's and its checks' (5,000,001-8,999,999)
 * or the training data's (PR C: 20,000,001 on).
 */
export const SEEDS = {
  /** Examiner games: EX + i is the i-th game of every examiner, for every candidate and the champion alike. */
  ex: 9_000_001,
  exCount: SPRT.exMax / 3,
  /** Head to head: VS + j, from both spawns. */
  vs: 9_100_001,
  vsCount: SPRT.vsMax / 2,
  /** The champion against itself (A/A), from both spawns. */
  aa: 9_150_001,
  aaCount: 100,
  /** The finalist against normal, fixed and random maps, from both spawns. */
  normalFixed: 9_200_001,
  normalRandom: 9_210_001,
  normalCount: 50,
  /** A new champion against the baseline, from both spawns. */
  base: 9_300_001,
  baseCount: 200,
  /** The canary: three games whose hashes must not change during a training. */
  canary: 9_900_001,
  canaryCount: 3,
  training: 20_000_001,
} as const;

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
  lookAhead: 12,
  candidatesMax: SPRT.candidatesMax,
  roundsWithout: 10,
  aaZ: 2,
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
  ex: Side;
  vs: Side;
  /** Measured: the share of examiner seeds where candidate and champion differ; draws of the head-to-head games. */
  q: number;
  draws: number;
  final?: Record<string, number>;
  at: string;
}
export interface State {
  version: 1;
  examiners: Examiner[];
  /** Every plan by its hash. */
  plans: Record<string, HP>;
  baseline: string;
  champion: string;
  queue: Candidate[];
  current: { id: string; hash: string; round: number; stage: "exam" | "final"; looks: number } | null;
  results: Record<string, Res>;
  tested: number;
  lastRound: number;
  promotedInRound: boolean;
  roundsWithout: number;
  aa: Record<string, { plus: number; minus: number; draws: number; games: number; z: number }>;
  base: Record<string, { score: number; se: number; games: number }>;
  canary: { hashes: string[]; tree: string; commit: string } | null;
  paused: Pause | null;
  done: boolean;
  decided: Decided[];
  log: { at: string; what: string }[];
}

/** A plan's hash: its JSON with the keys sorted, 12 hex digits. */
export function planHash(p: HP): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v;
  return createHash("sha256").update(JSON.stringify(sorted(p))).digest("hex").slice(0, 12);
}

export function init(examiners: Examiner[], candidates: Candidate[], baseline: HP = {}, at = ""): State {
  const b = planHash(baseline);
  const s: State = {
    version: 1,
    examiners,
    plans: { [b]: baseline },
    baseline: b,
    champion: b,
    queue: candidates.map((c) => ({ ...c })),
    current: null,
    results: {},
    tested: 0,
    lastRound: -1,
    promotedInRound: false,
    roundsWithout: 0,
    aa: {},
    base: {},
    canary: null,
    paused: null,
    done: false,
    decided: [],
    log: [{ at, what: `開始：基準 ${b}，${candidates.length} 個候選，考官 ${examiners.map((e) => e.id).join("、")}` }],
  };
  for (const c of candidates) s.plans[planHash(c.plan)] = c.plan;
  return s;
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
  const items: Item[] = [];
  for (const e of s.examiners) {
    for (let i = k * SPRT.exChunk; i < (k + 1) * SPRT.exChunk; i++) {
      items.push(exItem(s, c, e, SEEDS.ex + i), exItem(s, s.champion, e, SEEDS.ex + i));
    }
  }
  const per = SPRT.vsChunk / 2;
  items.push(...both(per, SEEDS.vs + k * per, (seed, swap) => playItem(s, "vs", c, s.champion, seed, swap, "random")));
  return items;
}
export function finalItems(s: State, c: string): Item[] {
  const items: Item[] = [];
  for (const p of [c, s.champion]) {
    items.push(...both(SEEDS.normalCount, SEEDS.normalFixed, (seed, swap) => playItem(s, "nf", p, "normal", seed, swap, "fixed")));
    items.push(...both(SEEDS.normalCount, SEEDS.normalRandom, (seed, swap) => playItem(s, "nr", p, "normal", seed, swap, "random")));
  }
  return items;
}
const aaItems = (s: State, h: string) => both(SEEDS.aaCount, SEEDS.aa, (seed, swap) => playItem(s, "aa", h, h, seed, swap, "random"));
const baseItems = (s: State, h: string) => both(SEEDS.baseCount, SEEDS.base, (seed, swap) => playItem(s, "bl", h, s.baseline, seed, swap, "random"));
/** The canary: the baseline against the first examiner, against itself and against normal; replayed every segment. */
export function canaryItems(s: State): Item[] {
  return [
    { ...exItem(s, s.baseline, s.examiners[0], SEEDS.canary), key: "canary|0" },
    { ...playItem(s, "cn", s.baseline, s.baseline, SEEDS.canary + 1, false, "random"), key: "canary|1" },
    { ...playItem(s, "cn", s.baseline, "normal", SEEDS.canary + 2, false, "fixed"), key: "canary|2" },
  ];
}

/** The games still to play, in order: the canary (always), the champion's A/A and base games, the candidate's. */
export function needed(s: State): Item[] {
  if (s.paused !== null || s.done) return [];
  const items = [...canaryItems(s)];
  if (s.aa[s.champion] === undefined) items.push(...aaItems(s, s.champion));
  if (s.champion !== s.baseline && s.base[s.champion] === undefined) items.push(...baseItems(s, s.champion));
  const c = s.current;
  if (c !== null) {
    if (c.stage === "exam") for (let k = c.looks; k < Math.min(c.looks + AUTO.lookAhead, MAX_LOOKS); k++) items.push(...lookItems(s, c.hash, k));
    else items.push(...finalItems(s, c.hash));
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

/** Both paths over the first `looks` looks of candidate `c`; `same`: no examiner game of the first look differs at all. */
export function tally(s: State, c: string, looks: number) {
  const ex: Side = { plus: 0, minus: 0, games: 0 };
  const vs: Side = { plus: 0, minus: 0, games: 0 };
  let identical = 0;
  let firstLook = 0;
  let exOpen = 0;
  let champOpen = 0;
  let vsDraws = 0;
  for (let k = 0; k < looks; k++) {
    for (const e of s.examiners) {
      for (let i = k * SPRT.exChunk; i < (k + 1) * SPRT.exChunk; i++) {
        const rc = s.results[exKey(c, e.id, SEEDS.ex + i)];
        const rh = s.results[exKey(s.champion, e.id, SEEDS.ex + i)];
        ex.games++;
        // + when only the champion lost to the player (the examiner won), - when only the candidate did.
        if (rh.w === 1 && rc.w !== 1) ex.plus++;
        else if (rc.w === 1 && rh.w !== 1) ex.minus++;
        if (rc.w === -1) exOpen++;
        if (rh.w === -1) champOpen++;
        if (k === 0) {
          firstLook++;
          if (rc.h === rh.h) identical++;
        }
      }
    }
    const per = SPRT.vsChunk / 2;
    for (let j = k * per; j < (k + 1) * per; j++) {
      for (const swap of [false, true]) {
        const r = s.results[playKey("vs", c, s.champion, SEEDS.vs + j, swap)];
        vs.games++;
        if (r.w === 1) vs.plus++;
        else if (r.w === 0) vs.minus++;
        else vsDraws++;
      }
    }
  }
  return {
    ex,
    vs,
    same: looks >= 1 && firstLook > 0 && identical === firstLook,
    q: ex.games === 0 ? 0 : (ex.plus + ex.minus) / ex.games,
    draws: vs.games === 0 ? 0 : vsDraws / vs.games,
    exOpenMore: ex.games === 0 ? 0 : (exOpen - champOpen) / ex.games,
  };
}

/** The finalist's checks: its numbers, and what failed (empty: passed). */
export function finalCheck(s: State, c: string): { numbers: Record<string, number>; failed: string[] } {
  const games = (kind: string, p: string) => [false, true].flatMap((swap) => Array.from({ length: SEEDS.normalCount }, (_, i) => s.results[playKey(kind, p, "normal", (kind === "nf" ? SEEDS.normalFixed : SEEDS.normalRandom) + i, swap)]));
  const share = (rs: Res[], f: (r: Res) => boolean) => rs.filter(f).length / rs.length;
  const mine = [...games("nf", c), ...games("nr", c)];
  const theirs = [...games("nf", s.champion), ...games("nr", s.champion)];
  const perThink = (rs: Res[]) => rs.reduce((a, r) => a + (r.ms ?? 0), 0) / Math.max(1, rs.reduce((a, r) => a + (r.thinks ?? 0), 0));
  const t = tally(s, c, s.current?.looks ?? 0);
  const aa = s.aa[s.champion];
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

function pause(s: State, id: string, reason: string, numbers: string[], at: string) {
  s.paused = { id, reason, numbers, at };
  s.log.push({ at, what: `暫停 ${id}：${reason}` });
}

function finish(s: State, verdict: "promote" | "reject", why: string, at: string, final?: Record<string, number>) {
  const c = s.current!;
  const t = tally(s, c.hash, c.looks);
  s.decided.push({ id: c.id, hash: c.hash, verdict, why, looks: c.looks, ex: t.ex, vs: t.vs, q: t.q, draws: t.draws, final, at });
  s.tested++;
  s.log.push({ at, what: `${verdict === "promote" ? "升級" : "不升級"} ${c.id}（${c.hash}）：${why}；${c.looks} 次、考官 +${t.ex.plus}/-${t.ex.minus}、對最強版 +${t.vs.plus}/-${t.vs.minus}` });
  if (verdict === "promote") {
    s.champion = c.hash;
    s.promotedInRound = true;
  }
  s.current = null;
}

/**
 * Moves the state on as far as the results allow; `pauseId` names a pause it makes (the segment's P-<run id>). Returns
 * what it did, a line each.
 */
export function step(s: State, pauseId: string, at: string): string[] {
  const did: string[] = [];
  for (let guard = 0; guard < 10_000; guard++) {
    if (s.paused !== null || s.done) return did;
    const ch = s.champion;
    // The champion against itself.
    const aa = aaItems(s, ch);
    if (s.aa[ch] === undefined && has(s, aa)) {
      const side = { plus: 0, minus: 0, draws: 0, games: aa.length, z: 0 };
      for (const x of aa) {
        const w = s.results[x.key].w;
        if (w === 1) side.plus++;
        else if (w === 0) side.minus++;
        else side.draws++;
      }
      side.z = zSign({ plus: side.plus, minus: side.minus, games: side.games });
      s.aa[ch] = side;
      did.push(`自己打自己（${ch}）：+${side.plus}/-${side.minus}、平手 ${side.draws}，z ${side.z.toFixed(2)}`);
      if (Math.abs(side.z) > AUTO.aaZ) {
        pause(s, pauseId, `自己打自己的對照偏了（z ${side.z.toFixed(2)}，超過 ${AUTO.aaZ}）：量法可能有問題`, [`+${side.plus}`, `-${side.minus}`, `平手 ${side.draws}`], at);
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
        pause(s, pauseId, `新的最強版對基準掉了：${pct(score)}，比歷來最好的 ${pct(best)} 低 ${AUTO.baseDrop} 個標準差以上`, [`${pct(score)} ±${pct(se)}`, `最好 ${pct(best)}`], at);
        continue;
      }
    }
    // The next candidate.
    if (s.current === null) {
      if (s.tested >= AUTO.candidatesMax) {
        pause(s, pauseId, `已經考了 ${s.tested} 個候選（一次訓練最多 ${AUTO.candidatesMax} 個）`, [], at);
        continue;
      }
      if (s.queue.length === 0) {
        // The last champion's own checks (A/A, against the baseline) first: they can still pause.
        if (s.aa[ch] === undefined || (ch !== s.baseline && s.base[ch] === undefined)) return did;
      }
      const c = s.queue.shift();
      if (c === undefined) {
        s.done = true;
        s.log.push({ at, what: "候選都考完了" });
        did.push("候選都考完了");
        return did;
      }
      if (c.round !== s.lastRound) {
        if (s.lastRound >= 0) s.roundsWithout = s.promotedInRound ? 0 : s.roundsWithout + 1;
        s.promotedInRound = false;
        s.lastRound = c.round;
        if (s.roundsWithout >= AUTO.roundsWithout) {
          s.queue.unshift(c);
          pause(s, pauseId, `連續 ${s.roundsWithout} 輪都沒有升級`, [], at);
          continue;
        }
      }
      s.current = { id: c.id, hash: planHash(c.plan), round: c.round, stage: "exam", looks: 0 };
      did.push(`開始考 ${c.id}（${s.current.hash}）`);
      if (s.current.hash === ch) {
        finish(s, "reject", "和目前最強版一模一樣", at);
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
        finish(s, "reject", d.why, at);
        did.push(`${c.id}：不升級（${d.why}），第 ${c.looks} 次`);
        continue;
      }
      c.stage = "final";
      s.log.push({ at, what: `${c.id} 過了考試（${d.why}），做上線前檢查` });
      did.push(`${c.id}：過了考試（${d.why}），第 ${c.looks} 次；做上線前檢查`);
      continue;
    }
    // final: needs the champion's A/A too (its draws).
    if (!has(s, finalItems(s, c.hash)) || s.aa[ch] === undefined) return did;
    const f = finalCheck(s, c.hash);
    if (f.failed.length === 0) {
      finish(s, "promote", "過了考試和上線前檢查", at, f.numbers);
      did.push(`${c.id}：升級`);
    } else {
      finish(s, "reject", `上線前檢查沒過：${f.failed.join("；")}`, at, f.numbers);
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
    pause(s, pauseId, "固定的三局雜湊變了：規則或程式在訓練中途變了", [`原本 ${s.canary.hashes.join(" ")}`, `這次 ${hashes.join(" ")}`, `sim ${tree.slice(0, 12)}，commit ${commit.slice(0, 8)}`], at);
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
