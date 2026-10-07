// Round 8 rule 5 (D-069; core/rules.ts LONG_BOWS): ranged units reach 6 cells and see 8; main
// cities', the big town's tower's and players' arrow towers' arrows reach 9 cells and those
// buildings see 10; rules() says so; mirror-image towers and archers play as mirror images.

import assert from "node:assert/strict";
import { test } from "node:test";
import { ARROW_TOWER, BUILDINGS, CANNON, LONG_BOWS, MAIN_ARROW, rules, TOWER_ARROW, UNITS } from "../src/core/rules.ts";
import { BuildingType, CELL, Stance, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put, run, slotOf } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;

function withBows<T>(on: boolean, f: () => T): T {
  const was = LONG_BOWS.on;
  LONG_BOWS.on = on;
  try {
    return f();
  } finally {
    LONG_BOWS.on = was;
  }
}

const hp = (g: G, id: number) => g.w.units.col.hp[slotOf(g, id)];

test("the values: ranged 6 cells and sight 8, arrows 9 cells and those buildings' sight 10, in rules() too; off as before", () => {
  withBows(true, () => {
    const r = rules();
    assert.deepEqual([UNITS[UnitType.Ranged].range, UNITS[UnitType.Ranged].sight, r.units[UnitType.Ranged].range], [6 * CELL, 8, 6 * CELL]);
    assert.deepEqual([MAIN_ARROW.range, TOWER_ARROW.range, ARROW_TOWER.range, r.arrows.townTower.range, r.arrows.arrowTower.range], Array(5).fill(9 * CELL));
    for (const type of [BuildingType.MainCity, BuildingType.TownTower, BuildingType.ArrowTower]) assert.equal(BUILDINGS[type].sight, 10);
    assert.ok(MAIN_ARROW.range > CANNON.range, "farther than the cannon");
  });
  withBows(false, () => {
    assert.deepEqual([UNITS[UnitType.Ranged].range, UNITS[UnitType.Ranged].sight, MAIN_ARROW.range, ARROW_TOWER.range], [5 * CELL, 7, 7 * CELL, 7 * CELL]);
    assert.equal(BUILDINGS[BuildingType.MainCity].sight, 8);
    assert.equal(JSON.parse(JSON.stringify(rules())).units[UnitType.Ranged].range, 5 * CELL, "the values go out as plain numbers");
  });
});

test("a ranged unit on hold shoots a spearman 6 cells off; with the switch off it does not", () => {
  for (const on of [true, false]) {
    withBows(on, () => {
      const g = emptyGame();
      const archer = put(g, 0, UnitType.Ranged, 31, 44);
      const target = put(g, 1, UnitType.Spearman, 31, 50);
      g.w.ecoOn[0] = 0;
      g.w.ecoOn[1] = 0;
      g.fog.update(g.w);
      cmd(g, 0, { c: "stance", u: [archer], stance: Stance.Hold });
      cmd(g, 1, { c: "stance", u: [target], stance: Stance.Hold });
      run(g, 60);
      assert.equal(hp(g, target) < UNITS[UnitType.Spearman].hp, on);
    });
  }
});

test("a ranged unit sees 8 cells (7 with the switch off)", () => {
  for (const on of [true, false]) {
    withBows(on, () => {
      const g = emptyGame();
      put(g, 0, UnitType.Ranged, 31, 44);
      g.fog.update(g.w);
      assert.equal(g.fog.visible[0][52 * g.w.size + 31], on ? 1 : 0);
    });
  }
});

test("a player's arrow tower shoots a spearman 8.5 cells from its footprint; with the switch off it does not", () => {
  for (const on of [true, false]) {
    withBows(on, () => {
      const g = emptyGame();
      g.w.addBuilding(0, BuildingType.ArrowTower, 30, 40, BUILDINGS[BuildingType.ArrowTower].hp, 1000);
      const target = put(g, 1, UnitType.Spearman, 30, 50);
      g.w.ecoOn[1] = 0;
      g.fog.update(g.w);
      cmd(g, 1, { c: "stance", u: [target], stance: Stance.Hold });
      run(g, 60);
      assert.equal(hp(g, target) < UNITS[UnitType.Spearman].hp, on);
    });
  }
});

test("mirror images: arrow towers and archers against mirror-image spearmen, tick by tick", () => {
  withBows(true, () => {
    const g = emptyGame();
    g.w.addBuilding(0, BuildingType.ArrowTower, 30, 40, BUILDINGS[BuildingType.ArrowTower].hp, 1000);
    g.w.addBuilding(1, BuildingType.ArrowTower, 40, 30, BUILDINGS[BuildingType.ArrowTower].hp, 1000);
    const pairs: [number, number][] = [];
    const add = (owner: number, type: UnitType, x: number, y: number) => {
      const a = put(g, owner, type, x, y);
      const b = put(g, 1 - owner, type, y, x);
      pairs.push([a, b]);
      return [a, b];
    };
    const archers = [add(0, UnitType.Ranged, 33, 43), add(0, UnitType.Ranged, 34, 43)];
    const foes = [0, 1, 2].map((k) => add(1, UnitType.Spearman, 30 + k, 50));
    g.w.ecoOn[0] = 0;
    g.w.ecoOn[1] = 0;
    g.fog.update(g.w);
    cmd(g, 0, { c: "stance", u: [...archers.map((p) => p[0]), ...foes.map((p) => p[1])], stance: Stance.Hold });
    cmd(g, 1, { c: "stance", u: [...archers.map((p) => p[1]), ...foes.map((p) => p[0])], stance: Stance.Hold });
    const u = g.w.units.col;
    let hit = false;
    for (let t = 0; t < 200; t++) {
      g.step();
      for (const [a, b] of pairs) {
        const sa = slotOf(g, a);
        const sb = slotOf(g, b);
        assert.equal(sa < 0, sb < 0);
        if (sa < 0) continue;
        assert.equal(u.hp[sa], u.hp[sb], `tick ${g.tick}: hp`);
        assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}`);
        assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
        if (u.hp[sa] < UNITS[u.type[sa]].hp) hit = true;
      }
    }
    assert.ok(hit, "the towers and archers hit the spearmen 8.5 and 6.1 cells off");
  });
});

