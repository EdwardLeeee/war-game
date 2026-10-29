// Scratch (war-game-ai, never merged): the AI (normal or hard) against the scripted "push" player,
// seeds given, no time limit; when the AI first builds a stable, trains a horseman, hides soldiers
// in a building, builds an arrow tower, marches on the player's main city (and with how many,
// mages among them), and who wins when.
//   node scratch/timeline7.ts --difficulty hard --seeds 1-5
import { createScriptedPlayer, planFor } from "../src/ai/scripted-player.ts";
import { rules } from "../src/core/rules.ts";
import { type AiDifficulty, BuildingType, UnitType } from "../src/protocol.ts";
import { Runner } from "../src/runner.ts";
import { buildView } from "../src/view/view.ts";
const arg = (n: string, f: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : f; };
const difficulty = arg("difficulty", "normal") as AiDifficulty;
const [a, b] = arg("seeds", "1-5").split("-").map(Number);
const m = (t: number) => (t < 0 ? "沒有" : `${(t / 1200).toFixed(1)}`);
const out = [`### ${difficulty} 對腳本玩家「主動」（沒有時間上限，第 50 分停）`, "", "| 種子 | 馬廄 | 第一名騎兵 | 第一次躲進建築 | 箭樓 | 第一次打玩家主城（兵／法師） | 結果 |", "|---|---|---|---|---|---|---|"];
for (let seed = a; seed <= (b ?? a); seed++) {
  const plan = planFor("push", "h1", "close");
  const r = new Runner({ seed, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", difficulty], autoTrain: [false, false] });
  const w = r.game.w;
  const player = createScriptedPlayer(0, { map: w.map, rules: rules(), frame: w.map.frames[0] }, plan);
  const home = w.map.spawns[0];
  let seq = 0, seen = 0;
  let stable = -1, cav = -1, hide = -1, tower = -1, march = -1, marchN = 0, marchM = 0;
  while (!r.over && w.tick < 50 * 1200) {
    if (w.tick % 40 === 0) for (const body of player.think(buildView(r.game, 0))) r.command(0, { ...body, seq: seq++ });
    r.tick();
    const log = r.game.log;
    for (; seen < log.length; seen++) {
      const c = log[seen] as { t: number; p: number; c: string; type?: number; u?: number[]; x?: number; y?: number };
      if (c.p !== 1) continue;
      if (stable < 0 && c.c === "build" && c.type === BuildingType.Stable) stable = c.t;
      if (tower < 0 && c.c === "build" && c.type === BuildingType.ArrowTower) tower = c.t;
      if (hide < 0 && c.c === "garrison") hide = c.t;
      if (march < 0 && c.c === "move" && c.x === home.cellX && c.y === home.cellY && (c.u?.length ?? 0) >= 5) {
        march = c.t;
        marchN = c.u!.length;
        marchM = c.u!.filter((id) => { const s = w.unit(id); return s >= 0 && w.units.col.type[s] === UnitType.Mage; }).length;
      }
    }
    if (cav < 0) for (let s = 0; s < w.units.count; s++) if (w.units.col.owner[s] === 1 && w.units.col.type[s] === UnitType.Cavalry) { cav = w.tick; break; }
  }
  const res = r.over ? (w.winner === 1 ? `電腦贏，第 ${m(w.tick)} 分` : `玩家贏，第 ${m(w.tick)} 分`) : "第 50 分未分";
  out.push(`| ${seed} | ${m(stable)} | ${m(cav)} | ${m(hide)} | ${m(tower)} | ${march < 0 ? "沒有" : `${m(march)}（${marchN}／${marchM}）`} | ${res} |`);
}
console.log(out.join("\n"));
