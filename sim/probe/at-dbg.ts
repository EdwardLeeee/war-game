const { emptyGame, openArea, put, cmd } = await import("../test/helpers.ts");
const { UnitType, NEUTRAL, CELL_SHIFT, Action } = await import("../src/protocol.ts");
const g = emptyGame();
const w = g.w;
w.ecoOn[0] = 0; w.ecoOn[1] = 0;
const { x, y } = openArea(g, 30);
const farmer = put(g, 0, UnitType.Farmer, x + 2, y + 10);
const archer = put(g, 1, UnitType.Ranged, x + 6, y + 10);
const militia = put(g, NEUTRAL, UnitType.Militia, x + 11, y + 10);
for (const id of [farmer, archer, militia]) w.units.col.hp[w.unit(id)] = 100000;
cmd(g, 1, { c: "attack", u: [archer], target: militia });
for (let k = 0; k < 30; k++) {
  g.step();
  const p = (id: number) => `${(w.units.col.x[w.unit(id)] >> CELL_SHIFT) - x},${(w.units.col.y[w.unit(id)] >> CELL_SHIFT) - y} a${w.units.col.action[w.unit(id)]} t${w.units.col.target[w.unit(id)]}`;
  const n = w.size;
  const mv = g.fog.visible[0][(w.units.col.y[w.unit(militia)] >> CELL_SHIFT) * n + (w.units.col.x[w.unit(militia)] >> CELL_SHIFT)];
  if (k % 3 === 0) console.log(k, "farmer", p(farmer), "archer", p(archer), "militia", p(militia), "p0 sees militia", mv);
}
void Action;
const { buildView } = await import("../src/view/view.ts");
const { UNIT_STRIDE, UnitField } = await import("../src/protocol.ts");
console.log("ids farmer", farmer, "archer", archer, "militia", militia);
for (const p of [0, 1]) {
  const v = buildView(g, p);
  for (let r = 0; r < v.units.length; r += UNIT_STRIDE) console.log("view", p, "unit", v.units[r + UnitField.id], "owner", v.units[r + UnitField.owner], "action", v.units[r + UnitField.action], "at", v.units[r + UnitField.attackTarget]);
}
