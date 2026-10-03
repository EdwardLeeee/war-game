// The AI against a player who does nothing, without a time limit (as when a person plays): when
// it first goes for a town, takes towns, first marches on the main city, and takes it; when it
// has its first mage, how many go with that first march, and how many it has when the main city
// is first hit. Times are game minutes and, in brackets, real minutes at normal speed (30 ticks
// a second, D-024).
//   node src/ai-timeline.ts --seed 4 --difficulty easy --first-town-min 18
//   node src/ai-timeline.ts --seed 4 --difficulty normal --player-town governed
// Prints Markdown; with --first-town-min, exits 1 if the first town trip comes earlier.
// --player-town (round 4, D-044) sets the player's own small town, which lies on the AI's way to
// the main city: neutral as at the start (default); governed by the player from the start, with
// the minimum garrison (one spearman); or ruins all game long (as if the player had just
// plundered it, again and again), so it is never a town to take.

import { TOWNS, UNITS } from "./core/rules.ts";
import { AI_DIFFICULTIES, type AiDifficulty, BuildingType, CELL_SHIFT, NEUTRAL, NO_OWNER, TownState, UnitType } from "./protocol.ts";
import { Runner } from "./runner.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const seed = Number(arg("seed", "4"));
const difficulty = arg("difficulty", "normal") as AiDifficulty;
if (!(AI_DIFFICULTIES as readonly string[]).includes(difficulty)) throw new Error(`bad --difficulty ${difficulty}`);
const firstTownMin = Number(arg("first-town-min", "0"));
const PLAYER_TOWN_STATES = { neutral: "中立", governed: "玩家從開局就在治理（留守 1 名槍兵）", ruins: "整局都是廢墟" } as const;
const playerTown = arg("player-town", "neutral") as keyof typeof PLAYER_TOWN_STATES;
if (!(playerTown in PLAYER_TOWN_STATES)) throw new Error(`bad --player-town ${playerTown}`);
/** Stop after 40 game minutes if the city still stands. */
const CAP = 48000;

const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", difficulty] });
const w = r.game.w;
const map = w.map;
/** The player's own small town (round 4): the one nearest its main city. */
const home = map.spawns[0];
const PLAYER_TOWN = map.towns.reduce((a, t) => ((t.cellX - home.cellX) ** 2 + (t.cellY - home.cellY) ** 2 < (a.cellX - home.cellX) ** 2 + (a.cellY - home.cellY) ** 2 ? t : a)).id;
const NAMES = ["中間的小鎮", "大城", "玩家家旁的小鎮", "電腦家旁的小鎮"];
const townName = (t: number) => NAMES[t] ?? `城鎮 ${t}`;
const when = (t: number) => `遊戲第 ${(t / 1200).toFixed(1)} 分（實際 ${((t / 1200) * 2 / 3).toFixed(1)} 分）`;
const own = (p: number, farmers: boolean) => {
  let n = 0;
  for (let i = 0; i < w.units.count; i++) if (w.units.col.owner[i] === p && (w.units.col.type[i] === UnitType.Farmer) === farmers) n++;
  return n;
};
const mages = (p: number) => {
  let n = 0;
  for (let i = 0; i < w.units.count; i++) if (w.units.col.owner[i] === p && w.units.col.type[i] === UnitType.Mage) n++;
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
/** Takes the militia of town t off the map (they are removed with the dead at the next step). */
const noMilitia = (t: number) => {
  for (let i = 0; i < w.units.count; i++) if (w.units.col.owner[i] === NEUTRAL && w.units.col.home[i] === t) w.units.col.hp[i] = 0;
};

const lines = [`### ${difficulty === "easy" ? "簡單" : "普通"}對不動的玩家（種子 ${seed}，沒有時間上限，電腦是 ${r.styles[1]}）`, ""];
if (playerTown !== "neutral") lines.push(`玩家家旁的小鎮：${PLAYER_TOWN_STATES[playerTown]}。`, "");
if (playerTown === "governed") {
  noMilitia(PLAYER_TOWN);
  w.townState[PLAYER_TOWN] = TownState.Governed;
  w.townOwner[PLAYER_TOWN] = 0;
  const t = map.towns[PLAYER_TOWN];
  for (let k = 0; k < TOWNS[t.size].garrisonNeeded; k++) {
    w.addUnit(0, UnitType.Spearman, ((t.cellX + k) << CELL_SHIFT) + 512, (t.cellY << CELL_SHIFT) + 512, UNITS[UnitType.Spearman].hp);
  }
}
if (playerTown === "ruins") {
  noMilitia(PLAYER_TOWN);
  w.townState[PLAYER_TOWN] = TownState.Ruins;
  w.townOwner[PLAYER_TOWN] = NO_OWNER;
}
const status: string[] = [];
let seen = 0;
let firstTown = -1;
let firstBase = -1;
let firstMage = -1;
let firstHit = false;
const owner = Array.from(w.townOwner);
const state = Array.from(w.townState);
while (!r.over && w.tick < CAP) {
  // Ruins all game: the clock that would turn them neutral again is held.
  if (playerTown === "ruins") w.townTimer[PLAYER_TOWN] = TOWNS[map.towns[PLAYER_TOWN].size].ruinsTicks;
  r.tick();
  const log = r.game.log;
  for (; seen < log.length; seen++) {
    const c = log[seen] as { t: number; p: number; c: string; u?: number[]; x?: number; y?: number };
    if (c.p !== 1 || c.u === undefined || c.u.length < 5) continue;
    const town = map.towns.find((t) => t.cellX === c.x && t.cellY === c.y);
    if (firstTown < 0 && c.c === "move" && town !== undefined) {
      firstTown = c.t;
      lines.push(`- ${when(c.t)}：第一次出發打野城（${townName(town.id)}），${c.u.length} 名兵`);
    }
    const e = map.spawns[0];
    if (firstBase < 0 && ((c.c === "move" && c.x === e.cellX && c.y === e.cellY) || c.c === "attack")) {
      firstBase = c.t;
      const m = c.u.filter((id) => w.unit(id) >= 0 && w.units.col.type[w.unit(id)] === UnitType.Mage).length;
      lines.push(`- ${when(c.t)}：第一次出發打主城，${c.u.length} 名兵，其中法師 ${m} 名`);
    }
  }
  if (firstMage < 0 && mages(1) > 0) {
    firstMage = w.tick;
    lines.push(`- ${when(w.tick)}：電腦的第一名法師`);
  }
  for (let t = 0; t < owner.length; t++) {
    if (w.townOwner[t] !== owner[t] && w.townOwner[t] === 1) lines.push(`- ${when(w.tick)}：攻下${townName(t)}`);
    if (w.townState[t] !== state[t] && w.townOwner[t] === 1) {
      if (w.townState[t] === TownState.Plundering) lines.push(`- ${when(w.tick)}：搶${townName(t)}`);
      if (w.townState[t] === TownState.Repairing) lines.push(`- ${when(w.tick)}：治理${townName(t)}`);
    }
    owner[t] = w.townOwner[t];
    state[t] = w.townState[t];
  }
  if (!firstHit && cityHp(0) < 1200) {
    firstHit = true;
    lines.push(`- ${when(w.tick)}：主城第一次被打，電腦有法師 ${mages(1)} 名`);
  }
  if (w.tick % 2400 === 0) {
    status.push(`| ${(w.tick / 1200).toFixed(0)} | ${own(1, true)} | ${own(1, false)} | ${mages(1)} | ${count(1, BuildingType.Barracks) + count(1, BuildingType.Range)} | ${count(1, BuildingType.MageHall)} | ${cityHp(0)} |`);
  }
}
if (firstMage < 0) lines.push(`- 到結束電腦都沒有法師`);
lines.push(r.over ? `- ${when(w.tick)}：${w.winner === 1 ? "主城被攻下" : `結束（勝方 ${w.winner}）`}` : `- 到${when(w.tick)}還沒結束`);
lines.push("", "| 遊戲分鐘 | 電腦的農民 | 電腦的兵 | 其中法師 | 兵營＋射場 | 法術營 | 玩家主城血量 |", "|---|---|---|---|---|---|---|", ...status);
const early = firstTownMin > 0 && firstTown >= 0 && firstTown < firstTownMin * 1200;
if (firstTownMin > 0) lines.push("", early ? `**沒通過：** 第一次打野城早於第 ${firstTownMin} 分` : `第一次打野城不早於第 ${firstTownMin} 分：通過。`);
console.log(lines.join("\n"));
if (early) process.exit(1);
