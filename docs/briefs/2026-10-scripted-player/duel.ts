// Scratch, not in the repo (war-game-ceo, 2026-10-02): the scripted player (ai/human.ts) as
// player 0 against the AI as player 1, without a time limit (as when a person plays).
//   node src/duel.ts --seeds 1,2,3,4,5 --choice plunder --trace
// The player's decisions come from its fogged view; the numbers printed here read the world.

import { type AiDifficulty, BuildingType, Resource, TownSize, TownState, UnitType } from "./protocol.ts";
import { Runner } from "./runner.ts";
import { rules } from "./core/rules.ts";
import { buildView } from "./view/view.ts";
import { createHuman, type Plan } from "./ai/human.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const num = (name: string, fallback: number) => Number(arg(name, String(fallback)));

const plan: Plan = {
  farmers: num("farmers", 30),
  production: num("production", 4),
  spearShare: num("spear", 50),
  townAt: num("town-at", 6),
  choice: arg("choice", "plunder") as "plunder" | "govern",
  again: num("again", 1) === 1,
  guards: num("guards", 2),
  hallFirst: num("hall-first", 1) === 1,
  mageReserve: num("mage-reserve", 10),
  counterAt: num("counter-at", 14),
  pushAt: num("push-at", 30),
  vein: num("vein", 0),
  loose: num("loose", 0),
  woodBias: num("wood-bias", 0) === 1,
  focus: num("focus", 0),
  staticRatio: num("static-ratio", 0) === 1,
  noMage: num("no-mage", 0) === 1,
};
const seeds = arg("seeds", "1,2,3,4,5").split(",").map(Number);
const think = num("think", 10);
const CAP = num("cap", 50) * 1200;
const difficulty = arg("difficulty", "normal") as AiDifficulty;
const trace = flag("trace");
/** Forces the AI's style (plunder, govern, balanced); empty: drawn from the seed. */
const style = arg("style", "");
const quiet = flag("quiet");
const traceEvery = num("trace-every", 1200);

const m = (t: number) => (t < 0 ? "沒有" : `${(t / 1200).toFixed(1)}`);
console.log(`打法：${JSON.stringify(plan)}；每 ${think} tick 下一次指令；對手 ${difficulty}`);
let wins = 0;
const rows: string[] = [];
for (const seed of seeds) {
  const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", difficulty], styles: style === "" ? undefined : [style as never, style as never] });
  const g = r.game;
  const w = g.w;
  const map = w.map;
  const human = createHuman(0, { map, rules: rules(), frame: map.frames[0], maxTicks: 0 }, plan);
  const home = map.spawns[0];
  const u = w.units.col;
  const b = w.buildings.col;
  const count = (p: number, type: number) => {
    let n = 0;
    for (let i = 0; i < w.units.count; i++) if (u.owner[i] === p && u.type[i] === type) n++;
    return n;
  };
  const army = (p: number) => `${count(p, UnitType.Spearman)}/${count(p, UnitType.Ranged)}/${count(p, UnitType.Mage)}`;
  const soldiers = (p: number) => count(p, UnitType.Spearman) + count(p, UnitType.Ranged) + count(p, UnitType.Mage);
  const lostSoldiers = (p: number) => w.lost[p * 5 + UnitType.Spearman] + w.lost[p * 5 + UnitType.Ranged] + w.lost[p * 5 + UnitType.Mage];
  /** Soldiers of p within r cells of (x, y), and the mages among them. */
  const near = (p: number, x: number, y: number, r: number): [number, number] => {
    let n = 0;
    let mg = 0;
    for (let i = 0; i < w.units.count; i++) {
      if (u.owner[i] !== p || u.type[i] === UnitType.Farmer) continue;
      const dx = (u.x[i] >> 10) - x;
      const dy = (u.y[i] >> 10) - y;
      if (dx * dx + dy * dy > r * r) continue;
      n++;
      if (u.type[i] === UnitType.Mage) mg++;
    }
    return [n, mg];
  };
  /** Where p's soldiers are on average (cell). */
  const centre = (p: number) => {
    let n = 0;
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < w.units.count; i++) {
      if (u.owner[i] !== p || u.type[i] === UnitType.Farmer) continue;
      n++;
      sx += u.x[i] >> 10;
      sy += u.y[i] >> 10;
    }
    return n === 0 ? "-" : `${Math.round(sx / n)},${Math.round(sy / n)}`;
  };
  const has = (p: number, type: number) => {
    for (let s = 0; s < w.buildings.count; s++) if (b.owner[s] === p && b.type[s] === type) return true;
    return false;
  };
  const cityHp = (p: number) => {
    const s = w.mainCity(p);
    return s < 0 ? 0 : b.hp[s];
  };
  const myTown = map.towns
    .filter((t) => t.size === TownSize.Small)
    .sort((a, c) => (a.cellX - home.cellX) ** 2 + (a.cellY - home.cellY) ** 2 - (c.cellX - home.cellX) ** 2 - (c.cellY - home.cellY) ** 2 || a.id - c.id)[0];
  const STATE = ["中立", "待選", "搶奪中", "修繕中", "治理中", "廢墟"];

  let seq = 0;
  let town1 = -1;
  let farmersLostBeforeTown = -1;
  let hall = -1;
  let myMage = -1;
  let aiMage = -1;
  let cityHit = -1;
  let cityHitInfo = "";
  let rejected = 0;
  const reasons = new Map<number, number>();
  const lines: string[] = [];
  // Waves: 4 or more AI soldiers within 16 cells of the player's main city.
  let wave: { start: number; max: number; mages: number; mine: string; aiLost: number; myLost: number; farmersLost: number; last: number } | null = null;
  const waves: string[] = [];
  const closeWave = () => {
    if (wave === null) return;
    waves.push(
      `    第 ${m(wave.start)}–${m(wave.last)} 分：電腦最多 ${wave.max} 名（法師 ${wave.mages}）到主城 16 格內；當時我方兵 ${wave.mine}；這一波電腦死 ${lostSoldiers(1) - wave.aiLost} 名、我方死 ${lostSoldiers(0) - wave.myLost} 名兵和 ${w.lost[UnitType.Farmer] - wave.farmersLost} 名農民；結束時主城 ${cityHp(0)}`,
    );
    wave = null;
  };
  while (!r.over && w.tick < CAP) {
    if (w.tick % think === 0) {
      for (const body of human.think(buildView(g, 0))) r.command(0, { ...body, seq: seq++ });
    }
    r.tick();
    for (const e of g.events) {
      if (e.to !== 0 || e.ev.k !== "rejected") continue;
      rejected++;
      reasons.set(e.ev.reason, (reasons.get(e.ev.reason) ?? 0) + 1);
    }
    if (town1 < 0 && w.townOwner[myTown.id] === 0) {
      town1 = w.tick;
      farmersLostBeforeTown = w.lost[UnitType.Farmer];
    }
    if (hall < 0 && has(0, BuildingType.MageHall)) hall = w.tick;
    if (myMage < 0 && count(0, UnitType.Mage) > 0) myMage = w.tick;
    if (aiMage < 0 && count(1, UnitType.Mage) > 0) aiMage = w.tick;
    if (cityHit < 0 && cityHp(0) < 1200) {
      cityHit = w.tick;
      const [n, mg] = near(1, home.cellX, home.cellY, 16);
      cityHitInfo = `電腦 ${n} 名（法師 ${mg}），我方兵 ${army(0)}`;
    }
    if (w.tick % 20 === 0) {
      const [n, mg] = near(1, home.cellX, home.cellY, 16);
      if (wave === null && n >= 4) {
        wave = { start: w.tick, max: n, mages: mg, mine: army(0), aiLost: lostSoldiers(1), myLost: lostSoldiers(0), farmersLost: w.lost[UnitType.Farmer], last: w.tick };
      } else if (wave !== null) {
        if (n > 0) {
          wave.last = w.tick;
          wave.max = Math.max(wave.max, n);
          wave.mages = Math.max(wave.mages, mg);
        } else if (w.tick - wave.last >= 200) closeWave();
      }
    }
    if (trace && w.tick % traceEvery === 0) {
      const res = (p: number) => [Resource.Food, Resource.Wood, Resource.Gold, Resource.Crystal].map((k) => w.res[p * 4 + k]).join("/");
      const towns = map.towns.map((t) => `${STATE[w.townState[t.id]]}${w.townOwner[t.id] >= 0 && w.townOwner[t.id] < 2 ? `(${w.townOwner[t.id] === 0 ? "我" : "電"})` : ""}`).join(" ");
      lines.push(
        `    ${(w.tick / 1200).toFixed(1).padStart(4)} 分｜我 ${res(0)} 農 ${count(0, UnitType.Farmer)} 兵 ${army(0)} ${human.state().mode}@${centre(0)} 城 ${cityHp(0)}｜電 ${res(1)} 農 ${count(1, UnitType.Farmer)} 兵 ${army(1)}@${centre(1)} 城 ${cityHp(1)}｜${towns}`,
      );
    }
  }
  closeWave();
  const st = human.state();
  const won = w.winner === 0;
  if (won) wins++;
  const result = !r.over ? `到第 ${m(w.tick)} 分還沒結束（主城 我 ${cityHp(0)}／電腦 ${cityHp(1)}，兵 我 ${army(0)}／電腦 ${army(1)}）` : won ? `贏，第 ${m(w.tick)} 分` : `輸，第 ${m(w.tick)} 分`;
  rows.push(`| ${seed} | ${r.styles[1]} | ${m(town1)} | ${m(myMage)} | ${m(aiMage)} | ${m(cityHit)} | ${m(st.firstMarch)} | ${result} |`);
  if (!quiet) {
    console.log(
      `\n種子 ${seed}（電腦 ${r.styles[1]}）：${result}\n` +
        `  家旁小鎮第一次攻下 ${m(town1)} 分（之前死 ${farmersLostBeforeTown} 名農民）；搶 ${w.plundered[0]} 次、治理 ${w.governed[0]} 次；法術營 ${m(hall)}；我第一名法師 ${m(myMage)}，共出 ${w.trained[UnitType.Mage]} 名；電腦第一名法師 ${m(aiMage)}，共出 ${w.trained[5 + UnitType.Mage]} 名\n` +
        `  主城第一次被打 ${m(cityHit)}${cityHit >= 0 ? `：${cityHitInfo}` : ""}；第一次出發打電腦主城 ${m(st.firstMarch)}，出發 ${st.marches} 次、打不下撤回 ${st.brokenOff} 次；去小鎮 ${st.trips} 趟\n` +
        `  全場：我出兵 ${w.trained[1]}/${w.trained[2]}/${w.trained[3]}、死 ${w.lost[1]}/${w.lost[2]}/${w.lost[3]}、農民死 ${w.lost[0]}；電腦出兵 ${w.trained[6]}/${w.trained[7]}/${w.trained[8]}、死 ${w.lost[6]}/${w.lost[7]}/${w.lost[8]}；晶砲 我 ${w.cannonShots[0]} 發／電腦 ${w.cannonShots[1]} 發；被拒絕的指令 ${rejected}（原因碼：次數 ${[...reasons].map(([k, v]) => `${k}:${v}`).join(" ") || "無"}）`,
    );
    if (waves.length > 0) console.log(`  電腦打到家門口：\n${waves.join("\n")}`);
    if (trace) console.log(lines.join("\n"));
  }
}
console.log(`\n| 種子 | 電腦性格 | 攻下小鎮 | 我第一名法師 | 電腦第一名法師 | 主城第一次被打 | 第一次出發反攻 | 結果 |\n|---|---|---|---|---|---|---|---|\n${rows.join("\n")}`);
console.log(`\n${wins}/${seeds.length} 勝（時間都是遊戲分鐘；正常速度的實際時間是三分之二）`);
