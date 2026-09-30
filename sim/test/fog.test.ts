import assert from "node:assert/strict";
import { test } from "node:test";
import { Rng } from "../src/core/fixed.ts";
import { buildView } from "../src/view/view.ts";
import { BuildingFlag, BuildingField, BUILDING_STRIDE, CELL_SHIFT, Fog, UNIT_STRIDE, UnitField, UnitType } from "../src/protocol.ts";
import { emptyGame, openArea, put, slotOf } from "./helpers.ts";

test("a player sees enemy units only within sight; explored cells stay explored", () => {
  const g = emptyGame();
  const a = openArea(g, 24);
  const scout = put(g, 0, UnitType.Farmer, a.x + 2, a.y + 2);
  const near = put(g, 1, UnitType.Spearman, a.x + 5, a.y + 2);
  const far = put(g, 1, UnitType.Spearman, a.x + 20, a.y + 20);
  g.fog.update(g.w);
  const ids = (v: ReturnType<typeof buildView>) => {
    const out: number[] = [];
    for (let o = 0; o < v.units.length; o += UNIT_STRIDE) out.push(v.units[o + UnitField.id]);
    return out;
  };
  const v = buildView(g, 0);
  assert.ok(ids(v).includes(near));
  assert.ok(!ids(v).includes(far));
  const n = g.w.size;
  assert.equal(v.fog[(a.y + 2) * n + a.x + 2], Fog.Visible);
  // Walk away: the cell becomes explored-but-not-visible.
  g.w.units.col.x[slotOf(g, scout)] = (a.x + 22) << CELL_SHIFT;
  g.fog.update(g.w);
  const v2 = buildView(g, 0);
  assert.equal(v2.fog[(a.y + 2) * n + a.x + 2], Fog.Explored);
  assert.ok(!ids(v2).includes(near), "out of sight now");
});

test("enemy buildings are remembered after they leave sight, and forgotten when seen gone", () => {
  const g = emptyGame();
  const w = g.w;
  const s1 = w.map.spawns[1];
  const scout = put(g, 0, UnitType.Farmer, s1.cellX - 4, s1.cellY + 4);
  g.fog.update(w);
  const main1 = w.buildings.col.id[w.mainCity(1)];
  const find = () => {
    const v = buildView(g, 0);
    for (let o = 0; o < v.buildings.length; o += BUILDING_STRIDE) if (v.buildings[o + BuildingField.id] === main1) return v.buildings.subarray(o, o + BUILDING_STRIDE);
    return null;
  };
  assert.equal(find()![BuildingField.flags] & BuildingFlag.Remembered, 0);
  w.units.col.x[slotOf(g, scout)] = 20 << CELL_SHIFT;
  w.units.col.y[slotOf(g, scout)] = 70 << CELL_SHIFT;
  w.buildings.col.hp[w.mainCity(1)] = 900; // changes out of sight
  g.fog.update(w);
  const remembered = find()!;
  assert.ok(remembered[BuildingField.flags] & BuildingFlag.Remembered);
  assert.equal(remembered[BuildingField.hp], 1200, "hp as last seen");
});

test("PlayerView never shows enemy units outside visible cells, and hidden changes do not change it", () => {
  const rng = new Rng(7);
  for (let trial = 0; trial < 20; trial++) {
    const g = emptyGame();
    const n = g.w.size;
    for (let k = 0; k < 30; k++) {
      const x = rng.below(n);
      const y = rng.below(n);
      if (g.w.walkable(x, y)) put(g, k % 2, [UnitType.Farmer, UnitType.Spearman, UnitType.Ranged][k % 3] as UnitType, x, y);
    }
    g.fog.update(g.w);
    const v = buildView(g, 0);
    for (let o = 0; o < v.units.length; o += UNIT_STRIDE) {
      if (v.units[o + UnitField.owner] === 0) continue;
      const cx = v.units[o + UnitField.x] >> CELL_SHIFT;
      const cy = v.units[o + UnitField.y] >> CELL_SHIFT;
      assert.equal(v.fog[cy * n + cx], Fog.Visible);
    }
    // Move every player-1 unit standing on a cell player 0 cannot see; the view must not change.
    const u = g.w.units.col;
    for (let s = 0; s < g.w.units.count; s++) {
      if (u.owner[s] !== 1) continue;
      if (g.fog.visible[0][(u.y[s] >> CELL_SHIFT) * n + (u.x[s] >> CELL_SHIFT)] === 1) continue;
      u.hp[s] = 1;
      u.type[s] = UnitType.Mage;
    }
    const v2 = buildView(g, 0);
    assert.deepEqual(v2.units, v.units);
    assert.deepEqual(v2.buildings, v.buildings);
  }
});
