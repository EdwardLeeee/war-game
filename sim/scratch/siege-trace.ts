// SCRATCH (ai/scratch-*): one tournament game (index, slot difficulties) traced through every siege: every 5 s
// while a side has soldiers within 14 cells of the other's main city. node scratch/siege-trace.ts <game> <slots>
import { Runner } from "../src/runner.ts";
import { AI_STYLES } from "../src/ai/ai.ts";
import { Action, MAX_TICKS, Order, UnitType } from "../src/protocol.ts";
const pairs: [string, string][] = [];
for (const a of AI_STYLES) for (const b of AI_STYLES) pairs.push([a, b]);
const i = Number(process.argv[2]);
const slots = (process.argv[3] ?? "hard,hard").split(",");
const until = process.argv[4] ? Number(process.argv[4]) * 1200 : MAX_TICKS;
const seed = 1 + (i >> 1);
const swap = (i & 1) === 1;
const difficulty = [0, 1].map((p) => slots[swap ? 1 - p : p]);
const r = new Runner({ seed, scenario: "standard", ai: [true, true], swap, styles: pairs[(seed - 1) % pairs.length], maxTicks: MAX_TICKS, difficulty });
const g = r.game, w = g.w, u = w.units.col, b = w.buildings.col;
const T = ["F", "S", "R", "M", "m", "C"];
const prevLost = [0, 1].map(() => [0, 0, 0, 0, 0, 0]);
const prevShots = [0, 0], prevHits = [0, 0];
const prevHp = [1200, 1200];
const out: string[] = [];
while (!r.over && g.tick < until) {
  r.tick(() => 0);
  if (g.tick % 100 !== 0) continue;
  for (const a of [0, 1]) {
    const d = 1 - a;
    const ec = w.map.spawns[d];
    const cs = w.mainCity(d);
    const cityId = cs >= 0 ? b.id[cs] : -1;
    const band = [0, 0, 0, 0];
    let onCity = 0, moving = 0, attacking = 0, retreat = 0;
    for (let s = 0; s < w.units.count; s++) {
      if (u.owner[s] !== a || u.type[s] === UnitType.Farmer) continue;
      const dist = Math.hypot((u.x[s] >> 10) - ec.cellX, (u.y[s] >> 10) - ec.cellY);
      band[dist <= 9 ? 0 : dist <= 14 ? 1 : dist <= 25 ? 2 : 3]++;
      if (dist <= 14) {
        if (u.target[s] === cityId) onCity++;
        if (u.order[s] === Order.Move) moving++;
        if (u.action[s] === Action.Attack) attacking++;
        if (u.order[s] === Order.Retreat) retreat++;
      }
    }
    const hp = cs >= 0 ? b.hp[cs] : 0;
    if (band[0] + band[1] === 0 && hp === prevHp[d]) continue;
    const hid = [0, 0, 0, 0, 0, 0];
    for (let s = 0; s < w.units.count; s++) if (u.owner[s] === d && u.action[s] === Action.Garrisoned) hid[u.type[s]]++;
    const lostA = [1, 2, 3, 5].map((k) => w.lost[a * 6 + k] - prevLost[a][k]);
    const lostD = [0, 1, 2, 3, 5].map((k) => w.lost[d * 6 + k] - prevLost[d][k]);
    out.push(`${(g.tick / 1200).toFixed(2)} p${a}→p${d} | ≤9:${band[0]} 9-14:${band[1]} 14-25:${band[2]} home:${band[3]} | at city: target=city ${onCity} attacking ${attacking} move ${moving} retreat ${retreat} | lost S/R/M/C ${lostA.join("/")} | def lost F/S/R/M/C ${lostD.join("/")} | def hiding S/R/M ${hid[1]}/${hid[2]}/${hid[3]} farmers ${hid[0]} | def cannon ${w.cannonShots[d] - prevShots[d]} shots ${w.cannonHits[d] - prevHits[d]} hits | city ${hp} (${hp - prevHp[d] >= 0 ? "+" : ""}${hp - prevHp[d]})`);
  }
  for (const p of [0, 1]) {
    for (let k = 0; k < 6; k++) prevLost[p][k] = w.lost[p * 6 + k];
    prevShots[p] = w.cannonShots[p];
    prevHits[p] = w.cannonHits[p];
    const cs = w.mainCity(p);
    prevHp[p] = cs >= 0 ? b.hp[cs] : 0;
  }
}
console.log(`game ${i} seed ${seed}${swap ? " swap" : ""} ${difficulty.join("/")}: winner ${w.winner} at ${(g.tick / 1200).toFixed(1)}`);
console.log(out.join("\n"));
