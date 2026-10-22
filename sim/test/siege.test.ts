// Siege engines (D-099, SIEGE; off until art-v6): a stone every 5 s that lands a second later where it
// was aimed, splash 1 cell, 3 times on buildings, GATE.siege times on gates, nothing within 3 cells;
// outranges arrow towers (10 against 9). The siege works trains them, after a range.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Game } from "../src/core/game.ts";
import { ARROW_TOWER, BUILDINGS, GATE, SIEGE, rules, UNITS } from "../src/core/rules.ts";
import { damage } from "../src/core/units.ts";
import { BuildingType, CELL, Order, Reject, Stance, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, openArea, put, run, slotOf, switchedOn } from "./helpers.ts";

const SIEGE_INFO = UNITS[UnitType.Siege];

/** An enemy arrow tower (2 x 2) at (x, y) and a siege engine of player 0 `gap` cells west of it, both finished, seen. */
function towerScene(gap: number) {
  const g = emptyGame();
  const w = g.w;
  const a = openArea(g, 30);
  const tx = a.x + 18;
  const ty = a.y + 10;
  const tower = w.addBuilding(1, BuildingType.ArrowTower, tx, ty, BUILDINGS[BuildingType.ArrowTower].hp, 1000);
  const engine = put(g, 0, UnitType.Siege, tx - gap, ty);
  g.fog.update(w);
  return { g, w, tower, engine, tx, ty, a };
}

const hpOf = (g: Game, id: number) => {
  const s = g.w.building(id);
  return s < 0 ? 0 : g.w.buildings.col.hp[s];
};

test("switched off: rules leave the engine, the works and the cavalry multiplier out; the works cannot be built", () => {
  assert.equal(SIEGE.on, false, "off until art-v6");
  const r = rules();
  assert.equal(r.units.length, UnitType.Siege);
  assert.equal(r.buildings.length, BuildingType.SiegeWorks);
  assert.equal(r.features.siege, undefined);
  assert.ok(!r.multipliers.some((m) => m.target === UnitType.Siege));
  const g = emptyGame();
  const a = openArea(g, 20);
  g.w.addBuilding(0, BuildingType.Range, a.x + 2, a.y + 2, BUILDINGS[BuildingType.Range].hp, 1000);
  const farmer = put(g, 0, UnitType.Farmer, a.x + 10, a.y + 10);
  g.w.res[1] = 1000;
  cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.SiegeWorks, x: a.x + 8, y: a.y + 8 });
  run(g, 1);
  assert.deepEqual(g.events.filter((e) => e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason), [Reject.NotAvailable]);
});

test("switched on: the GDD's values; rules send them; the works needs a range and trains engines", switchedOn(SIEGE, () => {
  assert.deepEqual(
    [SIEGE_INFO.hp, SIEGE_INFO.attack, SIEGE_INFO.range, SIEGE_INFO.minRange, SIEGE_INFO.splash, SIEGE_INFO.cooldown, SIEGE_INFO.sight, SIEGE_INFO.cost.wood, SIEGE_INFO.cost.gold, SIEGE_INFO.trainTicks],
    [140, 35, 10 * CELL, 3 * CELL, CELL, 100, 10, 150, 100, 800],
  );
  const works = BUILDINGS[BuildingType.SiegeWorks];
  assert.deepEqual([works.size, works.hp, works.cost.wood, works.buildTicks, works.trains, works.requires], [3, 500, 200, 900, [UnitType.Siege], [BuildingType.Range]]);
  const r = rules();
  assert.equal(r.features.siege, true);
  assert.equal(r.units[UnitType.Siege].attack, 35);
  assert.deepEqual(r.siege, { vsBuildings: 3, flightTicks: 20 });
  assert.equal(damage(UNITS[UnitType.Cavalry].attack, UnitType.Cavalry, UnitType.Siege), 22, "cavalry x2");
  const g = emptyGame();
  const a = openArea(g, 24);
  const farmer = put(g, 0, UnitType.Farmer, a.x + 12, a.y + 12);
  g.w.res[1] = 1000;
  cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.SiegeWorks, x: a.x + 8, y: a.y + 8 });
  run(g, 1);
  assert.deepEqual(g.events.filter((e) => e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason), [Reject.NotAvailable], "no range yet");
  g.w.addBuilding(0, BuildingType.Range, a.x + 2, a.y + 2, BUILDINGS[BuildingType.Range].hp, 1000);
  const ws = g.w.addBuilding(0, BuildingType.SiegeWorks, a.x + 14, a.y + 2, works.hp, 1000);
  g.w.res[0] = 1000;
  g.w.res[2] = 1000;
  cmd(g, 0, { c: "train", building: ws, type: UnitType.Siege, n: 1 });
  run(g, SIEGE_INFO.trainTicks + 2);
  assert.equal(g.w.trained[UnitType.Siege], 1, "an engine trained");
}));

test("a stone lands a second after it is thrown: the siege_shot event says where and when, the tower takes 3 x 35 then", switchedOn(SIEGE, () => {
  const { g, tower } = towerScene(10);
  const hp0 = hpOf(g, tower);
  let shot: { x: number; y: number; lands: number; at: number } | null = null;
  let hit = -1;
  for (let t = 0; t < 200 && hit < 0; t++) {
    g.step();
    for (const e of g.events) if (e.to === 0 && e.ev.k === "siege_shot" && shot === null) shot = { ...(e.ev as { x: number; y: number; lands: number }), at: g.tick };
    if (hpOf(g, tower) < hp0) hit = g.tick;
  }
  assert.ok(shot !== null, "thrown");
  assert.equal(shot.lands, shot.at + SIEGE.flightTicks);
  assert.equal(hit, shot.lands, "landed then");
  assert.equal(hp0 - hpOf(g, tower), SIEGE_INFO.attack * SIEGE.vsBuildings);
}));

test("it outranges an arrow tower: 9.5 cells off, the tower falls and the engine is not hit", switchedOn(SIEGE, () => {
  assert.equal(ARROW_TOWER.range, 9 * CELL, "towers shoot 9 cells");
  const { g, tower, engine } = towerScene(10);
  const u = g.w.units.col;
  run(g, 60 * 20);
  assert.equal(hpOf(g, tower), 0, "the tower is down");
  assert.equal(u.hp[slotOf(g, engine)], SIEGE_INFO.hp, "untouched");
}));

test("nothing within 3 cells: an enemy 2 cells off is no target of its own; told to attack it, it backs off, then throws", switchedOn(SIEGE, () => {
  const g = emptyGame();
  const a = openArea(g, 30);
  const engine = put(g, 0, UnitType.Siege, a.x + 10, a.y + 10);
  const foe = put(g, 1, UnitType.Spearman, a.x + 12, a.y + 10);
  const mate = put(g, 1, UnitType.Spearman, a.x + 12, a.y + 11);
  const u = g.w.units.col;
  for (const id of [foe, mate]) {
    u.stance[slotOf(g, id)] = Stance.Hold;
    u.cooldown[slotOf(g, id)] = 1 << 20;
  }
  g.fog.update(g.w);
  run(g, 40);
  assert.equal(u.target[slotOf(g, engine)], -1, "too near for its own choice");
  const x0 = u.x[slotOf(g, engine)];
  cmd(g, 0, { c: "attack", u: [engine], target: foe });
  let thrown = false;
  for (let t = 0; t < 400 && !thrown; t++) {
    g.step();
    thrown = g.events.some((e) => e.to === 0 && e.ev.k === "siege_shot");
  }
  assert.ok(thrown, "it threw");
  const s = slotOf(g, engine);
  assert.ok(u.x[s] < x0, "it backed off west");
  const f = slotOf(g, foe);
  const dx = u.x[f] - u.x[s];
  const dy = u.y[f] - u.y[s];
  assert.ok(dx * dx + dy * dy >= SIEGE_INFO.minRange! * SIEGE_INFO.minRange!, "from 3 cells or more");
  assert.equal(u.order[s], Order.Attack);
}));

test("splash: every enemy within a cell of where it lands, never its own side; one that walks off in the second dodges", switchedOn(SIEGE, () => {
  const g = emptyGame();
  const a = openArea(g, 30);
  const u = g.w.units.col;
  const engine = put(g, 0, UnitType.Siege, a.x + 4, a.y + 10);
  // Two enemies side by side 8 cells east, one of ours beside them, an enemy 2 cells further.
  const e1 = put(g, 1, UnitType.Spearman, a.x + 12, a.y + 10);
  const e2 = put(g, 1, UnitType.Spearman, a.x + 12, a.y + 11);
  const own = put(g, 0, UnitType.Spearman, a.x + 13, a.y + 10);
  const far = put(g, 1, UnitType.Spearman, a.x + 15, a.y + 10);
  for (const id of [e1, e2, own, far]) {
    u.stance[slotOf(g, id)] = Stance.Hold;
    u.cooldown[slotOf(g, id)] = 1 << 20;
  }
  g.fog.update(g.w);
  let lands = -1;
  for (let t = 0; t < 120 && lands < 0; t++) {
    g.step();
    for (const e of g.events) if (e.to === 0 && e.ev.k === "siege_shot") lands = (e.ev as { lands: number }).lands;
  }
  assert.ok(lands > 0, "thrown");
  while (g.tick < lands) g.step();
  const hp = UNITS[UnitType.Spearman].hp;
  const lost = (id: number) => hp - u.hp[slotOf(g, id)];
  const at = [lost(e1), lost(e2)].sort((p, q) => q - p);
  assert.equal(at[0], SIEGE_INFO.attack, "the one aimed at");
  assert.equal(lost(own), 0, "not our own");
  assert.equal(lost(far), 0, "out of the splash");
  // The next stone: its target walks 3 cells away while it flies.
  u.cooldown[slotOf(g, engine)] = 0;
  let aim = -1;
  let next = -1;
  for (let t = 0; t < 40 && next < 0; t++) {
    g.step();
    for (const e of g.events) if (e.to === 0 && e.ev.k === "siege_shot") next = (e.ev as { lands: number }).lands;
  }
  aim = u.target[slotOf(g, engine)];
  const runner = slotOf(g, aim);
  const before = u.hp[runner];
  u.x[runner] += 3 * CELL;
  while (g.tick < next) g.step();
  assert.equal(u.hp[slotOf(g, aim)], before, "it was not there");
}));

test("a stone on a gate does GATE.siege times its attack", switchedOn(SIEGE, () => {
  const g = emptyGame();
  const w = g.w;
  const gs = w.gateIn(0, 0);
  assert.ok(gs >= 0, "the town's first gate stands");
  const b = w.buildings.col;
  const gx = b.cellX[gs];
  const gy = b.cellY[gs];
  // Player 0's engine 8 cells out from the gate, told to attack it.
  const out = [[0, -8], [-8, 0], [8, 0], [0, 8]].map(([dx, dy]) => ({ x: gx + dx, y: gy + dy })).find((p) => w.walkable(p.x, p.y))!;
  const engine = put(g, 0, UnitType.Siege, out.x, out.y);
  g.fog.update(w);
  const hp0 = b.hp[gs];
  cmd(g, 0, { c: "attack", u: [engine], target: b.id[gs] });
  for (let k = 0; k < 200 && w.building(b.id[gs]) >= 0 && b.hp[w.building(b.id[gs])] === hp0; k++) g.step();
  const s = w.building(b.id[gs]);
  assert.ok(s >= 0);
  assert.equal(hp0 - b.hp[s], SIEGE_INFO.attack * GATE.siege);
}));

test("its own choice: a building that shoots before another building, a building before units", switchedOn(SIEGE, () => {
  const g = emptyGame();
  const w = g.w;
  const a = openArea(g, 30);
  const u = w.units.col;
  const engine = put(g, 0, UnitType.Siege, a.x + 4, a.y + 12);
  const house = w.addBuilding(1, BuildingType.House, a.x + 10, a.y + 12, BUILDINGS[BuildingType.House].hp, 1000);
  const tower = w.addBuilding(1, BuildingType.ArrowTower, a.x + 12, a.y + 6, 100000, 1000);
  for (const [x, y] of [[a.x + 9, a.y + 16], [a.x + 9, a.y + 17]]) {
    const id = put(g, 1, UnitType.Spearman, x, y);
    u.stance[slotOf(g, id)] = Stance.Hold;
  }
  g.fog.update(w);
  run(g, 20);
  assert.equal(u.target[slotOf(g, engine)], tower, "the tower first");
  w.buildings.col.hp[w.building(tower)] = 0;
  run(g, 20);
  assert.equal(u.target[slotOf(g, engine)], house, "then the house");
}));

test("mirror images: an engine and its image take down a tower and its image, tick by tick", switchedOn(SIEGE, () => {
  const g = emptyGame();
  const w = g.w;
  // A block below the diagonal open both ways (x and y swapped), far from its image.
  let bx = -1;
  let by = -1;
  for (let y = 0; y + 14 < w.size && bx < 0; y++) {
    for (let x = 0; x + 24 <= y && bx < 0; x++) {
      let ok = true;
      for (let yy = y; yy < y + 14 && ok; yy++) for (let xx = x; xx < x + 16 && ok; xx++) if (!w.walkable(xx, yy) || !w.walkable(yy, xx)) ok = false;
      if (ok) {
        bx = x;
        by = y;
      }
    }
  }
  assert.ok(bx >= 0, "an open block");
  const hp = BUILDINGS[BuildingType.ArrowTower].hp;
  const ta = w.addBuilding(1, BuildingType.ArrowTower, bx + 12, by + 5, hp, 1000);
  const tb = w.addBuilding(0, BuildingType.ArrowTower, by + 5, bx + 12, hp, 1000);
  const ea = put(g, 0, UnitType.Siege, bx + 2, by + 5);
  const eb = put(g, 1, UnitType.Siege, by + 5, bx + 2);
  g.fog.update(w);
  const u = w.units.col;
  let fell = false;
  for (let t = 0; t < 60 * 20 && !fell; t++) {
    g.step();
    assert.equal(hpOf(g, ta), hpOf(g, tb), `tick ${g.tick}: tower hp`);
    const sa = slotOf(g, ea);
    const sb = slotOf(g, eb);
    assert.deepEqual([u.x[sb], u.y[sb], u.hp[sb]], [u.y[sa], u.x[sa], u.hp[sa]], `tick ${g.tick}: engines`);
    fell = hpOf(g, ta) === 0;
  }
  assert.ok(fell, "both towers fell");
}));
