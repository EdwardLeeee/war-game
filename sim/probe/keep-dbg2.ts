import { KEEP } from "../src/core/rules.ts";
KEEP.on = true;
const { emptyGame, put, run, cmd, slotOf } = await import("../test/helpers.ts");
const { keepOf } = await import("../src/core/scenarios.ts");
const { BuildingType, Resource, TownChoice, UnitType } = await import("../src/protocol.ts");
const g = emptyGame();
g.w.ecoOn[0] = 0;
g.w.ecoOn[1] = 0;
const w = g.w;
const t = 0;
const x = w.townX[t];
const y = w.townY[t];
w.buildings.col.hp[keepOf(w, t)] = 0;
const s0 = put(g, 0, UnitType.Spearman, x + 2, y);
w.units.col.hp[slotOf(g, s0)] = 100000;
run(g, 3);
w.res[Resource.Wood] = 2000;
w.res[Resource.Gold] = 2000;
cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Govern });
const farmer = put(g, 0, UnitType.Farmer, x, y);
cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.ArrowTower, x: x - 1, y: y - 1 });
g.step();
console.log("state", w.townState[t], g.events.filter((e) => e.to === 0).map((e) => JSON.stringify(e.ev)).slice(0, 5));
{
  const { towerLand: tl } = await import("../src/core/commands.ts");
  for (const [cx, cy] of [[x + 3, y + 3], [x + 4, y + 4]]) console.log("before", cx - x, cy - y, "exp", g.fog.explored[0][cy * w.size + cx], "tl", tl(w, 0, cx, cy), "state", w.townState[t], "owner", w.townOwner[t]);
}
cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.ArrowTower, x: x + 3, y: y + 3 });
g.step();
console.log("state", w.townState[t], g.events.filter((e) => e.to === 0).map((e) => JSON.stringify(e.ev)).slice(0, 5));
const { towerLand } = await import("../src/core/commands.ts");
for (const [cx, cy] of [[x + 3, y + 3], [x + 4, y + 3], [x + 3, y + 4], [x + 4, y + 4]]) {
  const c = cy * w.size + cx;
  console.log(cx - x, cy - y, "grid", w.grid[c], "bAt", w.buildingAt[c], "keepG", w.keepGround[c], "lane", w.gateLane[c], "exp", g.fog.explored[0][c], "tl", towerLand(w, 0, cx, cy));
}
