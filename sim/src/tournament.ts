// AI-vs-AI tournament shard (Node; no build step). The same AI plays itself on the standard
// map: game i uses seed 1 + floor(i / 2) and the style pair STYLE_PAIRS[(seed - 1) % 9]
// (every combination of plunderer, governor, balanced); odd games swap the two AIs' slots,
// so each pair of AIs plays from both spawns. Every game is replayed from its command log
// with the AIs off and every HASH_EVERY-tick hash must match.
//   node src/tournament.ts --games 100 --shard 0 --shards 4 --out DIR
// Writes DIR/game-<i>.json (result and statistics) and DIR/game-<i>.jsonl (the log).
// Exits 1 if any replay differs.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hex8 } from "./core/fixed.ts";
import { AI_DIFFICULTIES, type AiDifficulty, type LogHeader, MAX_TICKS, UnitType } from "./protocol.ts";
import { AI_STYLES, type AiStyle } from "./ai/ai.ts";
import { Runner } from "./runner.ts";

export const STYLE_PAIRS: [AiStyle, AiStyle][] = [];
for (const a of AI_STYLES) for (const b of AI_STYLES) STYLE_PAIRS.push([a, b]);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const games = Number(arg("games", "100"));
const shard = Number(arg("shard", "0"));
const shards = Number(arg("shards", "1"));
const maxTicks = Number(arg("ticks", String(MAX_TICKS)));
/** The difficulty of slot 0 and slot 1 (they swap spawns with the styles), e.g. normal,easy. */
const slotDifficulty = arg("difficulty", "normal,normal").split(",") as AiDifficulty[];
if (slotDifficulty.length !== 2 || !slotDifficulty.every((d) => (AI_DIFFICULTIES as readonly string[]).includes(d))) throw new Error(`bad --difficulty ${slotDifficulty}`);
const out = arg("out", "tournament");
mkdirSync(out, { recursive: true });

export interface GameResult {
  game: number;
  seed: number;
  swap: boolean;
  /** The style each spawn's AI played. */
  styles: string[];
  /** The difficulty each spawn's AI played. */
  difficulty: string[];
  ticks: number;
  /** 0 or 1 (the spawn that won), -1 for a draw. */
  winner: number;
  reason: number;
  replayMatches: boolean;
  checkpoints: number;
  finalHash: string;
  wallMs: number;
  tickMicros: { median: number; p95: number; max: number; mean: number };
  /** Every TIMELINE_EVERY ticks: what each side had and where its army was (for finding why games run long). */
  timeline: Sample[];
  /** Tick of the first town capture, or -1, and the spawn that made it (-1: none). */
  firstCapture: number;
  firstCaptureBy: number;
  perPlayer: {
    plundered: number;
    governed: number;
    magesTrained: number;
    magesLost: number;
    cannonShots: number;
    cannonHits: number;
    plunderIncome: number;
    governChosen: number;
    governCost: number;
    townIncome: number;
    governedTicks: number;
    governEnded: number;
    governPaidBack: number;
    /** Governing spells still running when the game ended, and how many of them had paid back. */
    governOpen: number;
    governOpenPaidBack: number;
    trained: number[];
    lost: number[];
    gathered: number[];
    /** Farmers lost by what last hurt them: none, militia, an enemy unit, a crystal cannon, an arrow (HitCause; D-057). */
    farmersLostBy: number[];
    /** Towns lost to a revolt (D-057). */
    revolts: number;
  }[];
}

export interface Sample {
  tick: number;
  /** Town states and owners. */
  towns: number[][];
  sides: {
    farmers: number;
    spear: number;
    ranged: number;
    mages: number;
    /** Centre of the soldiers (cells), or null. */
    army: number[] | null;
    /** Soldiers within 12 cells of the enemy main city. */
    atEnemyCity: number;
    mainCityHp: number;
    hidden: number;
    res: number[];
  }[];
}
const TIMELINE_EVERY = 600;

function sample(r: Runner): Sample {
  const w = r.game.w;
  const u = w.units.col;
  const sides = [0, 1].map((p) => {
    const enemy = w.map.spawns[1 - p];
    let farmers = 0;
    let spear = 0;
    let ranged = 0;
    let mages = 0;
    let sx = 0;
    let sy = 0;
    let atEnemyCity = 0;
    for (let s = 0; s < w.units.count; s++) {
      if (u.owner[s] !== p) continue;
      const t = u.type[s];
      if (t === UnitType.Farmer) {
        farmers++;
        continue;
      }
      if (t === UnitType.Spearman) spear++;
      else if (t === UnitType.Ranged) ranged++;
      else if (t === UnitType.Mage) mages++;
      const cx = u.x[s] >> 10;
      const cy = u.y[s] >> 10;
      sx += cx;
      sy += cy;
      if ((cx - enemy.cellX) ** 2 + (cy - enemy.cellY) ** 2 <= 144) atEnemyCity++;
    }
    const n = spear + ranged + mages;
    const mc = w.mainCity(p);
    return {
      farmers,
      spear,
      ranged,
      mages,
      army: n === 0 ? null : [Math.trunc(sx / n), Math.trunc(sy / n)],
      atEnemyCity,
      mainCityHp: mc < 0 ? 0 : w.buildings.col.hp[mc],
      hidden: mc < 0 ? 0 : w.buildings.col.garrisoned[mc],
      res: Array.from(w.res.subarray(p * 4, p * 4 + 4)),
    };
  });
  return { tick: w.tick, towns: Array.from(w.townState).map((st, t) => [st, w.townOwner[t]]), sides };
}

/** Towns of player p still repairing or governed (optionally: whose pay-out has reached their cost). */
function openSpells(w: Runner["game"]["w"], p: number, paidBack: boolean): number {
  let n = 0;
  for (let t = 0; t < w.townSize.length; t++) {
    const st = w.townState[t];
    if (w.townOwner[t] !== p || (st !== 3 && st !== 4)) continue;
    if (!paidBack || w.townSpellIncome[t] >= w.townSpellCost[t]) n++;
  }
  return n;
}

const per = Math.ceil(games / shards);
let failed = 0;
for (let i = shard * per; i < Math.min(games, (shard + 1) * per); i++) {
  const seed = 1 + (i >> 1);
  const swap = (i & 1) === 1;
  const start = performance.now();
  const difficulty = [0, 1].map((p) => slotDifficulty[swap ? 1 - p : p]);
  const r = new Runner({ seed, scenario: "standard", ai: [true, true], swap, styles: STYLE_PAIRS[(seed - 1) % STYLE_PAIRS.length], maxTicks, difficulty });
  const g = r.game;
  const micros: number[] = [];
  const timeline: Sample[] = [];
  while (!r.over && g.tick < maxTicks) {
    micros.push(r.tick(() => performance.now()));
    if (g.tick % TIMELINE_EVERY === 0) timeline.push(sample(r));
  }
  if (r.hashes.at(-1)!.tick !== g.tick) r.hashes.push({ tick: g.tick, hash: g.hash() });
  // Replay with the AIs off.
  const rp = new Runner({ seed, scenario: "standard", ai: [false, false], replay: g.log, maxTicks });
  while (!rp.over && rp.game.tick < g.tick) rp.tick();
  if (rp.hashes.at(-1)!.tick !== rp.game.tick) rp.hashes.push({ tick: rp.game.tick, hash: rp.game.hash() });
  const same = rp.hashes.length === r.hashes.length && r.hashes.every((h, k) => h.tick === rp.hashes[k].tick && h.hash === rp.hashes[k].hash);
  if (!same) failed++;
  const wallMs = Math.round(performance.now() - start);
  const sorted = [...micros].sort((a, b) => a - b);
  const pick = (q: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]);
  const w = g.w;
  const result: GameResult = {
    game: i,
    seed,
    swap,
    styles: r.styles.map((s) => s ?? "none"),
    difficulty,
    ticks: g.tick,
    winner: w.over ? w.winner : -1,
    reason: w.endReason,
    replayMatches: same,
    checkpoints: r.hashes.length,
    finalHash: hex8(g.hash()),
    wallMs,
    tickMicros: { median: pick(0.5), p95: pick(0.95), max: sorted.at(-1) ?? 0, mean: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0 },
    timeline,
    firstCapture: w.firstCapture,
    firstCaptureBy: w.firstCaptureBy,
    perPlayer: [0, 1].map((p) => ({
      plundered: w.plundered[p],
      governed: w.governed[p],
      magesTrained: w.trained[p * 5 + UnitType.Mage],
      magesLost: w.lost[p * 5 + UnitType.Mage],
      cannonShots: w.cannonShots[p],
      cannonHits: w.cannonHits[p],
      plunderIncome: w.plunderIncome[p],
      governChosen: w.governChosen[p],
      governCost: w.governCost[p],
      townIncome: w.townIncome[p],
      governedTicks: w.governedTicks[p],
      governEnded: w.governEnded[p],
      governPaidBack: w.governPaidBack[p],
      governOpen: openSpells(w, p, false),
      governOpenPaidBack: openSpells(w, p, true),
      trained: Array.from(w.trained.subarray(p * 5, p * 5 + 4)),
      lost: Array.from(w.lost.subarray(p * 5, p * 5 + 4)),
      gathered: Array.from(w.gathered.subarray(p * 4, p * 4 + 4)),
      farmersLostBy: Array.from(w.farmerDeaths.subarray(p * 5, p * 5 + 5)),
      revolts: w.revolts[p],
})),
  };
  writeFileSync(join(out, `game-${i}.json`), JSON.stringify(result, null, 1) + "\n");
  const head: LogHeader = r.header([true, true]);
  writeFileSync(join(out, `game-${i}.jsonl`), [JSON.stringify(head), ...g.log.map((c) => JSON.stringify(c))].join("\n") + "\n");
  console.log(
    `game ${i} seed ${seed}${swap ? " swap" : ""} ${result.styles.join("/")}${difficulty[0] === difficulty[1] ? "" : ` ${difficulty.join("/")}`}: ${result.winner === -1 ? "draw" : `player ${result.winner} wins`} at tick ${g.tick}` +
      ` (${(g.tick / 1200).toFixed(1)} min); replay ${same ? "matches" : "DIFFERS"} (${r.hashes.length} checkpoints); ${wallMs} ms;` +
      ` plunder ${result.perPlayer.map((p) => p.plundered).join("/")}, govern ${result.perPlayer.map((p) => p.governed).join("/")},` +
      ` mages ${result.perPlayer.map((p) => p.magesTrained).join("/")}`,
  );
}
if (failed > 0) {
  console.error(`${failed} replay(s) differ`);
  process.exit(1);
}
