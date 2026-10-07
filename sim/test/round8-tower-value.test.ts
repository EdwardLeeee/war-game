// Round 8 rule 6 (D-071; core/rules.ts TOWER_VALUE): a player's arrow tower costs wood 60 and gold
// 20, has 600 hp, is built in 30 s, and shoots 10 every 1.5 s; rules() says so; mirror-image towers
// shoot as mirror images.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ARROW_TOWER, BUILDINGS, rules, TOWER_VALUE, UNITS } from "../src/core/rules.ts";
import { BuildingType, Resource, Stance, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put, run, slotOf } from "./helpers.ts";

const TOWER = BUILDINGS[BuildingType.ArrowTower];

function withValue<T>(on: boolean, f: () => T): T {
  const was = TOWER_VALUE.on;
  TOWER_VALUE.on = on;
  try {
    return f();
  } finally {
    TOWER_VALUE.on = was;
  }
}

test("the values: wood 60, gold 20, 600 hp, 30 s, 10 every 1.5 s, in rules() too; off as before", () => {
  withValue(true, () => {
    assert.deepEqual([TOWER.cost.wood, TOWER.cost.gold, TOWER.hp, TOWER.buildTicks, ARROW_TOWER.damage, ARROW_TOWER.cooldown], [60, 20, 600, 600, 10, 30]);
    const r = JSON.parse(JSON.stringify(rules()));
    assert.deepEqual([r.buildings[BuildingType.ArrowTower].cost.wood, r.buildings[BuildingType.ArrowTower].hp, r.arrows.arrowTower.damage, r.arrows.arrowTower.cooldown], [60, 600, 10, 30]);
  });
  withValue(false, () => {
    assert.deepEqual([TOWER.cost.wood, TOWER.cost.gold, TOWER.hp, TOWER.buildTicks, ARROW_TOWER.damage, ARROW_TOWER.cooldown], [100, 50, 500, 800, 5, 40]);
  });
});

test("villagers build one for wood 60 and gold 20 in 30 s, and it stands with 600 hp", () => {
  withValue(true, () => {
    const g = emptyGame();
    g.w.ecoOn[0] = 0;
    const farmer = put(g, 0, UnitType.Farmer, 20, 80);
    g.w.res.set([0, 1000, 1000, 0], 0);
    g.fog.update(g.w);
    cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.ArrowTower, x: 20, y: 77 });
    run(g, 1);
    assert.deepEqual([g.w.res[Resource.Wood], g.w.res[Resource.Gold]], [940, 980]);
    run(g, 30 * 20 + 100);
    const b = g.w.buildings.col;
    let s = -1;
    for (let k = 0; k < g.w.buildings.count; k++) if (b.type[k] === BuildingType.ArrowTower) s = k;
    assert.ok(s >= 0 && b.progress[s] === 1000, "built within 30 s (and the walk)");
    assert.equal(b.hp[s], 600);
  });
});

test("its arrows: 10 every 1.5 s, 30 in 64 ticks on a spearman 5 cells off (10 with the switch off)", () => {
  for (const on of [true, false]) {
    withValue(on, () => {
      const g = emptyGame();
      g.w.addBuilding(0, BuildingType.ArrowTower, 30, 40, TOWER.hp, 1000);
      const foe = put(g, 1, UnitType.Spearman, 30, 47);
      g.w.ecoOn[1] = 0;
      g.fog.update(g.w);
      cmd(g, 1, { c: "stance", u: [foe], stance: Stance.Hold });
      run(g, 64);
      assert.equal(UNITS[UnitType.Spearman].hp - g.w.units.col.hp[slotOf(g, foe)], on ? 30 : 10);
    });
  }
});

test("mirror images: mirror-image towers shoot mirror-image spearmen, 10 an arrow, tick by tick", () => {
  withValue(true, () => {
    const g = emptyGame();
    g.w.addBuilding(0, BuildingType.ArrowTower, 30, 40, TOWER.hp, 1000);
    g.w.addBuilding(1, BuildingType.ArrowTower, 40, 30, TOWER.hp, 1000);
    const pairs: [number, number][] = [];
    for (let k = 0; k < 3; k++) pairs.push([put(g, 1, UnitType.Spearman, 29 + k, 47), put(g, 0, UnitType.Spearman, 47, 29 + k)]);
    g.w.ecoOn[0] = 0;
    g.w.ecoOn[1] = 0;
    g.fog.update(g.w);
    cmd(g, 1, { c: "stance", u: pairs.map((p) => p[0]), stance: Stance.Hold });
    cmd(g, 0, { c: "stance", u: pairs.map((p) => p[1]), stance: Stance.Hold });
    const u = g.w.units.col;
    let lost = 0;
    for (let t = 0; t < 100; t++) {
      g.step();
      for (const [a, b] of pairs) {
        const sa = slotOf(g, a);
        const sb = slotOf(g, b);
        assert.equal(sa < 0, sb < 0);
        if (sa < 0) continue;
        assert.equal(u.hp[sa], u.hp[sb], `tick ${g.tick}: hp`);
        assert.equal(u.x[sb], u.y[sa]);
        assert.equal(u.y[sb], u.x[sa]);
      }
    }
    for (const [a] of pairs) lost += UNITS[UnitType.Spearman].hp - u.hp[slotOf(g, a)];
    assert.equal(lost % 10, 0, "arrows of 10");
    assert.ok(lost >= 30, `${lost}`);
  });
});
