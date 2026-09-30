// The AI against a player who does nothing, without a time limit (as when a person plays): when
// it first goes for a town, takes towns, first marches on the main city, and takes it. Times
// are game minutes and, in brackets, real minutes at normal speed (30 ticks a second, D-024).
//   node src/ai-timeline.ts --seed 4 --difficulty easy --first-town-min 18
// Prints Markdown; with --first-town-min, exits 1 if the first town trip comes earlier.

import { AI_DIFFICULTIES, type AiDifficulty, BuildingType, UnitType } from "./protocol.ts";
import { Runner } from "./runner.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const seed = Number(arg("seed", "4"));
const difficulty = arg("difficulty", "normal") as AiDifficulty;
if (!(AI_DIFFICULTIES as readonly string[]).includes(difficulty)) throw new Error(`bad --difficulty ${difficulty}`);
const firstTownMin = Number(arg("first-town-min", "0"));
/** Stop after 40 game minutes if the city still stands. */
const CAP = 48000;

const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", difficulty] });
const w = r.game.w;
const map = w.map;
const when = (t: number) => `遊戲第 ${(t / 1200).toFixed(1)} 分（實際 ${((t / 1200) * 2 / 3).toFixed(1)} 分）`;
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

const lines = [`### ${difficulty === "easy" ? "簡單" : "普通"}對不動的玩家（種子 ${seed}，沒有時間上限，電腦是 ${r.styles[1]}）`, ""];
const status: string[] = [];
let seen = 0;
let firstTown = -1;
let firstBase = -1;
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
    if (firstBase < 0 && ((c.c === "move" && c.x === e.cellX && c.y === e.cellY) || c.c === "attack")) {
      firstBase = c.t;
      lines.push(`- ${when(c.t)}：第一次出發打主城，${c.u.length} 名兵`);
    }
  }
  for (let t = 0; t < owner.length; t++) {
    if (w.townOwner[t] === owner[t]) continue;
    if (w.townOwner[t] === 1) lines.push(`- ${when(w.tick)}：攻下${map.towns[t].size === 0 ? "小鎮" : "大城"}`);
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
lines.push(r.over ? `- ${when(w.tick)}：${w.winner === 1 ? "主城被攻下" : `結束（勝方 ${w.winner}）`}` : `- 到${when(w.tick)}還沒結束`);
lines.push("", "| 遊戲分鐘 | 電腦的農民 | 電腦的兵 | 兵營＋射場 | 玩家主城血量 |", "|---|---|---|---|---|", ...status);
const early = firstTownMin > 0 && firstTown >= 0 && firstTown < firstTownMin * 1200;
if (firstTownMin > 0) lines.push("", early ? `**沒通過：** 第一次打野城早於第 ${firstTownMin} 分` : `第一次打野城不早於第 ${firstTownMin} 分：通過。`);
console.log(lines.join("\n"));
if (early) process.exit(1);
