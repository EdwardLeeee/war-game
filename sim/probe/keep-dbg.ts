import { KEEP, TOWNS } from "../src/core/rules.ts";
KEEP.on = true;
const { emptyGame, put, run, cmd } = await import("../test/helpers.ts");
const { keepOf } = await import("../src/core/scenarios.ts");
const { buildView } = await import("../src/view/view.ts");
const { BuildingType, Resource, TownChoice, UnitType } = await import("../src/protocol.ts");
const g = emptyGame();
const w = g.w;
const t = 0;
const x = w.townX[t];
const y = w.townY[t];
w.buildings.col.hp[keepOf(w, t)] = 0;
const s0 = put(g, 0, UnitType.Spearman, x + 2, y);
w.units.col.hp[w.unit(s0)] = 100000;
run(g, 3);
w.res[Resource.Wood] = 2000;
w.res[Resource.Gold] = 2000;
cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Govern });
run(g, 2);
console.log("state", w.townState[t], "owner", w.townOwner[t]);
const v = buildView(g, 0);
for (let yy = y - 6; yy <= y + 6; yy++) console.log(Array.from({ length: 13 }, (_, k) => v.placement[yy * w.size + x - 6 + k].toString(16).padStart(2, "0")).join(" "));
void TOWNS; void BuildingType;
const farmer = put(g, 0, UnitType.Farmer, x, y);
for (const [bx, by] of [[x - 1, y - 1], [x + 3, y + 3], [x + 2, y + 3], [x + 3, y + 2]]) {
  cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.ArrowTower, x: bx, y: by });
  g.step();
  console.log(bx - x, by - y, g.events.filter((e) => e.to === 0 && e.ev.k === "rejected").map((e) => JSON.stringify(e.ev)));
}
