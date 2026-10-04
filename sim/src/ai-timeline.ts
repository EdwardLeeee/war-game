// The AI against a player who does nothing, without a time limit (as when a person plays): when
// it first goes for a town, takes each town, first marches on the main city (with how many
// mages), and takes it. Times are game minutes and, in brackets, real minutes at normal speed
// (30 ticks a second, D-024).
//   node src/ai-timeline.ts --seed 4 --difficulty easy --first-town-min 18
//   node src/ai-timeline.ts --seeds 1-5
// Prints Markdown; --seeds adds a table, one row per seed. With --first-town-min, exits 1 if the
// first town trip comes earlier in any game.

import type { GameMap } from "./core/map.ts";
import { AI_DIFFICULTIES, type AiDifficulty, BuildingType, TownSize, UnitType } from "./protocol.ts";
import { Runner } from "./runner.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

/** "1-5" or "1,3,7-9". */
function seedList(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(",")) {
    const [a, b] = part.split("-").map(Number);
    if (b === undefined) out.push(a);
    else for (let s = a; s <= b; s++) out.push(s);
  }
  return out;
}

const seeds = arg("seeds", "") !== "" ? seedList(arg("seeds", "")) : [Number(arg("seed", "4"))];
const difficulty = arg("difficulty", "normal") as AiDifficulty;
if (!(AI_DIFFICULTIES as readonly string[]).includes(difficulty)) throw new Error(`bad --difficulty ${difficulty}`);
const firstTownMin = Number(arg("first-town-min", "0"));
/** Stop after 40 game minutes if the city still stands. */
const CAP = 48000;
const LEVEL_NAMES: Record<string, string> = { easy: "簡單", normal: "普通", hard: "困難" };
const minutes = (t: number) => (t / 1200).toFixed(1);
const when = (t: number) => `遊戲第 ${minutes(t)} 分（實際 ${((t / 1200) * 2 / 3).toFixed(1)} 分）`;

/** A town by its place: the big city, the small town in the middle, or a corner town (D-054). */
function townName(map: GameMap, t: number): string {
  const s = map.towns[t];
  if (s.size === TownSize.Large) return "大城";
  const mid = map.size / 2;
  if (Math.abs(s.cellX - mid) < map.size / 4) return "中間的小鎮";
  return s.cellX < mid ? "左上的小鎮" : "右下的小鎮";
}

interface Result {
  lines: string[];
  style: string;
  /** Per town: when the AI first took it, or -1. */
  taken: number[];
  firstTown: number;
  /** The first march on the main city: when (-1 if none), soldiers, mages among them. */
  base: [number, number, number];
  /** When the main city fell, or -1. */
  fell: number;
  map: GameMap;
}

function timeline(seed: number): Result {
  const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", difficulty] });
  const w = r.game.w;
  const map = w.map;
  const own = (p: number, farmers: boolean) => {
    let n = 0;
    for (let i = 0; i < w.units.count; i++) if (w.units.col.owner[i] === p && (w.units.col.type[i] === UnitType.Farmer) === farmers) n++;
    return n;
  };
  const count = (p: number, t: number) => {
    let n = 0;
    for (let s = 0; s < w.buildings.count; s++) if (w.buildings.col.owner[s] === p && w.buildings.col.type[s] === t) n++;
    return n;
  };
  const cityHp = (p: number) => {
    const s = w.mainCity(p);
    return s < 0 ? 0 : w.buildings.col.hp[s];
  };
  const mages = (ids: number[]) =>
    ids.filter((id) => {
      const s = w.unit(id);
      return s >= 0 && w.units.col.type[s] === UnitType.Mage;
    }).length;

  const lines = [`### ${LEVEL_NAMES[difficulty] ?? difficulty}對不動的玩家（種子 ${seed}，沒有時間上限，電腦是 ${r.styles[1]}）`, ""];
  const status: string[] = [];
  const taken = map.towns.map(() => -1);
  let seen = 0;
  let firstTown = -1;
  let base: [number, number, number] = [-1, 0, 0];
  let firstHit = false;
  const owner = Array.from(w.townOwner);
  while (!r.over && w.tick < CAP) {
    r.tick();
    const log = r.game.log;
    for (; seen < log.length; seen++) {
      const c = log[seen] as { t: number; p: number; c: string; u?: number[]; x?: number; y?: number };
      if (c.p !== 1 || c.u === undefined || c.u.length < 5) continue;
      if (firstTown < 0 && c.c === "move" && map.towns.some((t) => t.cellX === c.x && t.cellY === c.y)) {
        firstTown = c.t;
        lines.push(`- ${when(c.t)}：第一次出發打野城，${c.u.length} 名兵`);
      }
      const e = map.spawns[0];
      if (base[0] < 0 && ((c.c === "move" && c.x === e.cellX && c.y === e.cellY) || c.c === "attack")) {
        base = [c.t, c.u.length, mages(c.u)];
        lines.push(`- ${when(c.t)}：第一次出發打主城，${c.u.length} 名兵（法師 ${base[2]} 名）`);
      }
    }
    for (let t = 0; t < owner.length; t++) {
      if (w.townOwner[t] === owner[t]) continue;
      if (w.townOwner[t] === 1) {
        lines.push(`- ${when(w.tick)}：攻下${townName(map, t)}`);
        if (taken[t] < 0) taken[t] = w.tick;
      }
      owner[t] = w.townOwner[t];
    }
    if (!firstHit && cityHp(0) < 1200) {
      firstHit = true;
      lines.push(`- ${when(w.tick)}：主城第一次被打`);
    }
    if (w.tick % 2400 === 0) {
      status.push(`| ${(w.tick / 1200).toFixed(0)} | ${own(1, true)} | ${own(1, false)} | ${count(1, BuildingType.Barracks) + count(1, BuildingType.Range)} | ${cityHp(0)} |`);
    }
  }
  const fell = r.over && w.winner === 1 ? w.tick : -1;
  lines.push(r.over ? `- ${when(w.tick)}：${w.winner === 1 ? "主城被攻下" : `結束（勝方 ${w.winner}）`}` : `- 到${when(w.tick)}還沒結束`);
  lines.push("", "| 遊戲分鐘 | 電腦的農民 | 電腦的兵 | 兵營＋射場 | 玩家主城血量 |", "|---|---|---|---|---|", ...status, "");
  return { lines, style: r.styles[1] ?? "", taken, firstTown, base, fell, map };
}

const results = seeds.map(timeline);
const out = results.flatMap((x) => x.lines);
if (seeds.length > 1) {
  const map = results[0].map;
  const names = map.towns.map((_, t) => townName(map, t));
  const m = (t: number) => (t < 0 ? "—" : minutes(t));
  out.push(
    "### 彙整（遊戲分鐘；「—」是沒拿下或沒發生）",
    "",
    `| 種子 | 電腦 | ${names.map((n) => `攻下${n}`).join(" | ")} | 第一次出發打主城（兵／法師） | 主城被攻下 |`,
    `|---|---|${names.map(() => "---|").join("")}---|---|`,
    ...results.map(
      (x, k) =>
        `| ${seeds[k]} | ${x.style} | ${x.taken.map(m).join(" | ")} | ${x.base[0] < 0 ? "—" : `${m(x.base[0])}（${x.base[1]}／${x.base[2]}）`} | ${m(x.fell)} |`,
    ),
    "",
  );
}
const early = firstTownMin > 0 && results.some((x) => x.firstTown >= 0 && x.firstTown < firstTownMin * 1200);
if (firstTownMin > 0) out.push(early ? `**沒通過：** 第一次打野城早於第 ${firstTownMin} 分` : `第一次打野城不早於第 ${firstTownMin} 分：通過。`);
console.log(out.join("\n"));
if (early) process.exit(1);
