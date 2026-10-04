// The scripted player (ai/scripted-player.ts) as player 0 against the AI as player 1, without a
// time limit (as when a person plays): game by game, who won and when, the first mages, the
// first hit on the player's main city, its first march, and every wave of the AI at its door
// (D-045, D-046). The player decides from its own view only; the numbers here read the world.
//   node src/scripted-games.ts --seeds 1-15 --strategy defend --speed h1 --formation close
//   node src/scripted-games.ts --seeds 1,2,3 --strategy push --trace --json out.json
//   node src/scripted-games.ts --seeds 1-20 --strategy push --no-range --no-mage   (spearmen only)
// Prints Markdown; with --json also writes every game's details. Reports only, no threshold.

import { writeFileSync } from "node:fs";
import { createScriptedPlayer, FORMATIONS, type Formation, planFor, SCRIPTED_THINK_EVERY, SPEEDS, type Speed, STRATEGIES, type Strategy } from "./ai/scripted-player.ts";
import { type AiStyle, AI_STYLES } from "./ai/ai.ts";
import { rules } from "./core/rules.ts";
import { AI_DIFFICULTIES, type AiDifficulty, Resource, TownSize, UnitType } from "./protocol.ts";
import { Runner } from "./runner.ts";
import { buildView } from "./view/view.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
function oneOf<T extends string>(name: string, values: readonly T[], fallback: T): T {
  const v = arg(name, fallback);
  if (!(values as readonly string[]).includes(v)) throw new Error(`--${name} ${v}: one of ${values.join(", ")}`);
  return v as T;
}
/** "1-5" or "1,3,7" (or both: "1-3,9"). */
function seedList(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(",")) {
    const [a, b] = part.split("-").map(Number);
    if (b === undefined) out.push(a);
    else for (let s = a; s <= b; s++) out.push(s);
  }
  return out;
}

const strategy = oneOf<Strategy>("strategy", STRATEGIES, "defend");
const speed = oneOf<Speed>("speed", SPEEDS, "h1");
const formation = oneOf<Formation>("formation", FORMATIONS, "close");
const difficulty = oneOf<AiDifficulty>("difficulty", AI_DIFFICULTIES, "normal");
/** The AI's style for every game; empty: drawn from the seed, as in an ordinary game. */
const style = arg("style", "");
if (style !== "" && !(AI_STYLES as readonly string[]).includes(style)) throw new Error(`--style ${style}: one of ${AI_STYLES.join(", ")}`);
const seeds = seedList(arg("seeds", "1-5"));
const think = Number(arg("think", String(SCRIPTED_THINK_EVERY)));
/** Games still going at this game minute are stopped and counted apart. */
const CAP = Number(arg("cap", "50")) * 1200;
const trace = flag("trace");
const jsonOut = arg("json", "");
const plan = planFor(strategy, speed, formation);
// Options outside the fixed groups (ceo's measurements, D-046): the economy ratio left at
// 40/35/25, no mage hall, no range (with --no-mage too: spearmen only).
if (flag("static-ratio")) plan.staticRatio = true;
if (flag("no-mage")) plan.noMage = true;
if (flag("no-range")) plan.noRange = true;

const NAMES: Record<Strategy, string> = { push: "主動", defend: "守家", notown: "守家、不拿城鎮" };
const SPEED_NAMES: Record<Speed, string> = { h1: "手速 H1", eco: "經濟養大" };
const FORMATION_NAMES: Record<Formation, string> = { close: "密集", shooters: "遠程和法師散開", all: "整隊散開" };
const LEVEL_NAMES: Record<string, string> = { easy: "簡單", normal: "普通", hard: "困難" };
const STYLE_NAMES: Record<string, string> = { plunder: "掠奪型", govern: "治理型", balanced: "均衡型" };
const m = (t: number) => (t < 0 ? "沒有" : (t / 1200).toFixed(1));

interface Wave {
  start: number;
  last: number;
  /** Most AI soldiers within 16 cells of the player's main city at once, and the most mages among them. */
  max: number;
  mages: number;
  /** The player's soldiers when it began: spearmen / ranged / mages. */
  mine: string;
  aiLost: number;
  myLost: number;
  farmersLost: number;
  /** The player's main city's hp when it ended. */
  cityHp: number;
}
interface GameRecord {
  seed: number;
  style: string;
  /** "won", "lost" or "open" (still going at the cap). */
  result: "won" | "lost" | "open";
  endTick: number;
  /** The player first holds the small town nearest its main city; its first mage; the AI's first mage. */
  town: number;
  myMage: number;
  aiMage: number;
  /** The player's main city first hit, with the AI's soldiers (mages) near it then and the player's army. */
  cityHit: number;
  cityHitAi: [number, number];
  cityHitMine: string;
  /** The player's first march on the AI's main city. */
  firstMarch: number;
  marches: number;
  brokenOff: number;
  waves: Wave[];
  /** At the end: both main cities' hp, both armies (spearmen / ranged / mages). */
  cityHp: [number, number];
  armies: [string, string];
  trained: { mages: [number, number] };
  cannonShots: [number, number];
  rejected: number;
  finalHash: string;
  trace?: string[];
}

function play(seed: number): GameRecord {
  const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", difficulty], styles: style === "" ? undefined : [style as AiStyle, style as AiStyle] });
  const g = r.game;
  const w = g.w;
  const map = w.map;
  const player = createScriptedPlayer(0, { map, rules: rules(), frame: map.frames[0] }, plan);
  const home = map.spawns[0];
  const u = w.units.col;
  const b = w.buildings.col;
  const count = (p: number, type: number) => {
    let n = 0;
    for (let i = 0; i < w.units.count; i++) if (u.owner[i] === p && u.type[i] === type) n++;
    return n;
  };
  const army = (p: number) => `${count(p, UnitType.Spearman)}/${count(p, UnitType.Ranged)}/${count(p, UnitType.Mage)}`;
  const lostSoldiers = (p: number) => w.lost[p * 5 + UnitType.Spearman] + w.lost[p * 5 + UnitType.Ranged] + w.lost[p * 5 + UnitType.Mage];
  /** Soldiers of p within r cells of (x, y), and the mages among them. */
  const near = (p: number, x: number, y: number, rad: number): [number, number] => {
    let n = 0;
    let mg = 0;
    for (let i = 0; i < w.units.count; i++) {
      if (u.owner[i] !== p || u.type[i] === UnitType.Farmer) continue;
      const dx = (u.x[i] >> 10) - x;
      const dy = (u.y[i] >> 10) - y;
      if (dx * dx + dy * dy > rad * rad) continue;
      n++;
      if (u.type[i] === UnitType.Mage) mg++;
    }
    return [n, mg];
  };
  const cityHp = (p: number) => {
    const s = w.mainCity(p);
    return s < 0 ? 0 : b.hp[s];
  };
  const myTown = map.towns
    .filter((t) => t.size === TownSize.Small)
    .sort((a, c) => (a.cellX - home.cellX) ** 2 + (a.cellY - home.cellY) ** 2 - (c.cellX - home.cellX) ** 2 - (c.cellY - home.cellY) ** 2 || a.id - c.id)[0];

  let seq = 0;
  let town = -1;
  let myMage = -1;
  let aiMage = -1;
  let cityHit = -1;
  let cityHitAi: [number, number] = [0, 0];
  let cityHitMine = "";
  let rejected = 0;
  const waves: Wave[] = [];
  let wave: Wave | null = null;
  const closeWave = () => {
    if (wave === null) return;
    wave.aiLost = lostSoldiers(1) - wave.aiLost;
    wave.myLost = lostSoldiers(0) - wave.myLost;
    wave.farmersLost = w.lost[UnitType.Farmer] - wave.farmersLost;
    wave.cityHp = cityHp(0);
    waves.push(wave);
    wave = null;
  };
  const lines: string[] = [];
  while (!r.over && w.tick < CAP) {
    if (w.tick % think === 0) {
      for (const body of player.think(buildView(g, 0))) r.command(0, { ...body, seq: seq++ });
    }
    r.tick();
    for (const e of g.events) if (e.to === 0 && e.ev.k === "rejected") rejected++;
    if (town < 0 && w.townOwner[myTown.id] === 0) town = w.tick;
    if (myMage < 0 && count(0, UnitType.Mage) > 0) myMage = w.tick;
    if (aiMage < 0 && count(1, UnitType.Mage) > 0) aiMage = w.tick;
    if (cityHit < 0 && cityHp(0) < 1200) {
      cityHit = w.tick;
      cityHitAi = near(1, home.cellX, home.cellY, 16);
      cityHitMine = army(0);
    }
    // Waves: 4 or more AI soldiers within 16 cells of the player's main city.
    if (w.tick % 20 === 0) {
      const [n, mg] = near(1, home.cellX, home.cellY, 16);
      if (wave === null && n >= 4) {
        wave = { start: w.tick, last: w.tick, max: n, mages: mg, mine: army(0), aiLost: lostSoldiers(1), myLost: lostSoldiers(0), farmersLost: w.lost[UnitType.Farmer], cityHp: 0 };
      } else if (wave !== null) {
        if (n > 0) {
          wave.last = w.tick;
          wave.max = Math.max(wave.max, n);
          wave.mages = Math.max(wave.mages, mg);
        } else if (w.tick - wave.last >= 200) closeWave();
      }
    }
    if (trace && w.tick % 1200 === 0) {
      const res = (p: number) => [Resource.Food, Resource.Wood, Resource.Gold, Resource.Crystal].map((k) => w.res[p * 4 + k]).join("/");
      lines.push(`${(w.tick / 1200).toFixed(0)} 分｜我 ${res(0)} 農 ${count(0, UnitType.Farmer)} 兵 ${army(0)} ${player.state().mode} 城 ${cityHp(0)}｜電腦 ${res(1)} 農 ${count(1, UnitType.Farmer)} 兵 ${army(1)} 城 ${cityHp(1)}`);
    }
  }
  closeWave();
  const st = player.state();
  return {
    seed,
    style: r.styles[1] ?? "",
    result: !r.over ? "open" : w.winner === 0 ? "won" : "lost",
    endTick: w.tick,
    town,
    myMage,
    aiMage,
    cityHit,
    cityHitAi,
    cityHitMine,
    firstMarch: st.firstMarch,
    marches: st.marches,
    brokenOff: st.brokenOff,
    waves,
    cityHp: [cityHp(0), cityHp(1)],
    armies: [army(0), army(1)],
    trained: { mages: [w.trained[UnitType.Mage], w.trained[5 + UnitType.Mage]] },
    cannonShots: [w.cannonShots[0], w.cannonShots[1]],
    rejected,
    finalHash: (g.hash() >>> 0).toString(16).padStart(8, "0"),
    ...(trace ? { trace: lines } : {}),
  };
}

const games = seeds.map(play);
const won = games.filter((x) => x.result === "won").length;
const open = games.filter((x) => x.result === "open");
const options = [
  plan.staticRatio ? "經濟比例固定" : "",
  plan.noMage ? "不蓋法術營" : "",
  plan.noRange ? "不蓋射場" : "",
  think !== SCRIPTED_THINK_EVERY ? `每 ${think} tick 下一輪指令` : "",
].filter((x) => x !== "");
const title = `${NAMES[strategy]}，${FORMATION_NAMES[formation]}，${SPEED_NAMES[speed]}${options.map((x) => `，${x}`).join("")}（種子 ${seeds.length === 1 ? seeds[0] : `${seeds[0]}–${seeds[seeds.length - 1]}`}，對手 ${LEVEL_NAMES[difficulty] ?? difficulty}）`;
const out: string[] = [`### ${title}`, ""];
out.push(`${games.length} 局贏 ${won} 局，輸 ${games.length - won - open.length} 局${open.length > 0 ? `，到第 ${m(CAP)} 分還沒分出勝負 ${open.length} 局` : ""}。`, "");
const byStyle = AI_STYLES.map((s) => {
  const of = games.filter((x) => x.style === s);
  return of.length === 0 ? "" : `${STYLE_NAMES[s]} ${of.filter((x) => x.result === "won").length}/${of.length}`;
}).filter((x) => x !== "");
out.push(`照電腦的性格：${byStyle.join("、")}。`, "");
out.push(`逐種子（b 均衡、g 治理、p 掠奪）：${games.map((x) => `${x.seed}${x.style[0]}:${x.result === "won" ? "贏" : x.result === "lost" ? "輸" : "未分"} ${m(x.endTick)}`).join("; ")}`, "");
out.push("| 種子 | 電腦性格 | 攻下小鎮 | 我第一名法師 | 電腦第一名法師 | 主城第一次被打 | 第一次出發打電腦主城 | 結果 |", "|---|---|---|---|---|---|---|---|");
for (const x of games) {
  const result = x.result === "open" ? `第 ${m(x.endTick)} 分還沒分出` : `${x.result === "won" ? "贏" : "輸"}，第 ${m(x.endTick)} 分`;
  const hit = x.cityHit < 0 ? "沒有" : `${m(x.cityHit)}（電腦 ${x.cityHitAi[0]} 名，法師 ${x.cityHitAi[1]}）`;
  out.push(`| ${x.seed} | ${STYLE_NAMES[x.style] ?? x.style} | ${m(x.town)} | ${m(x.myMage)} | ${m(x.aiMage)} | ${hit} | ${m(x.firstMarch)} | ${result} |`);
}
out.push("");
if (open.length > 0) {
  out.push(`**到第 ${m(CAP)} 分還沒分出勝負**（主城血量 我／電腦；兵 槍兵/遠程/法師 我／電腦）`, "");
  for (const x of open) out.push(`- 種子 ${x.seed}：主城 ${x.cityHp[0]}／${x.cityHp[1]}；兵 ${x.armies[0]}／${x.armies[1]}`);
  out.push("");
}
out.push("<details><summary>電腦打到家門口（每一波：電腦 16 格內最多幾名、其中法師；開始時我方的兵；這一波雙方的傷亡；結束時主城血量）</summary>", "");
for (const x of games) {
  if (x.waves.length === 0) continue;
  out.push(`- 種子 ${x.seed}：`);
  for (const v of x.waves) {
    out.push(`  - 第 ${m(v.start)}–${m(v.last)} 分：電腦 ${v.max} 名（法師 ${v.mages}）；我方兵 ${v.mine}；電腦死 ${v.aiLost} 名，我方死 ${v.myLost} 名兵和 ${v.farmersLost} 名農民；主城剩 ${v.cityHp}`);
  }
}
out.push("", "</details>", "");
if (trace) for (const x of games) out.push(`<details><summary>種子 ${x.seed} 每分鐘</summary>`, "", ...(x.trace ?? []).map((l) => `- ${l}`), "", "</details>", "");
console.log(out.join("\n"));
if (jsonOut !== "") writeFileSync(jsonOut, JSON.stringify({ strategy, speed, formation, difficulty, style, think, cap: CAP, plan, games }, null, 1));
