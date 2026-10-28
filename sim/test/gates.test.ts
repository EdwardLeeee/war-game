// Castle gates (D-096; core/rules.ts GATE, GATE_ARROW): a gate in each opening of a town's walls,
// closed to everyone but the town's holder (a neutral town's to all), open to all once broken; broken
// by a move or an attack whose goal lies behind it, never just in passing; hit by ranged units and
// mages for GATE.rangedNum / rangedDen; rebuilt by a governed town, the end of repairing and ruins
// turning neutral; a governed town's gates shoot, more the more soldiers hold it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { KEEP } from "../src/core/keep.ts";
import { Game } from "../src/core/game.ts";
import { GATE, GATE_ARROW, UNITS } from "../src/core/rules.ts";
import { BuildingType, CELL_SHIFT, Order, TownState, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOff } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;
const T = 0;

const inside = (g: G, id: number) => {
  const u = g.w.units.col;
  const s = slotOf(g, id);
  return g.w.inTown(T, u.x[s] >> CELL_SHIFT, u.y[s] >> CELL_SHIFT);
};
const gatesStanding = (g: G, t = T) => g.w.castles[t].gates.filter((_, k) => g.w.gateIn(t, k) >= 0).length;

/** Town T held by `owner` in `state` (militia gone, gates refreshed). */
function held(owner: number, state: TownState = TownState.Governed): G {
  const g = emptyGame();
  g.w.townState[T] = state;
  g.w.townOwner[T] = owner;
  // Ruins and plundering count down; long enough for a test.
  g.w.townTimer[T] = 1 << 20;
  g.w.refreshGates(T);
  g.fog.update(g.w);
  return g;
}

/** A soldier of player p 8 cells south of town T's walls. */
function outside(g: G, p: number, type: UnitType = UnitType.Spearman): number {
  const t = g.w.map.towns[T];
  const c = g.w.castles[T];
  return put(g, p, type, t.cellX, t.cellY + c.inside.y1 + 9);
}

test("a neutral town's gates are closed to every player: a retreat to its middle waits outside, and breaks nothing", () => {
  const g = emptyGame();
  const t = g.w.map.towns[T];
  const a = outside(g, 0);
  g.fog.update(g.w);
  cmd(g, 0, { c: "retreat", u: [a], x: t.cellX, y: t.cellY });
  run(g, 60 * 20);
  assert.equal(inside(g, a), false);
  assert.equal(gatesStanding(g), 4);
  for (let k = 0; k < 4; k++) assert.equal(g.w.buildings.col.hp[g.w.gateIn(T, k)], GATE.hp[g.w.townSize[T]], "untouched");
});

test("a held town's gates let its holder through and nobody else (awaiting the choice, plundering, repairing, governed); ruins let everyone", switchedOff(KEEP, () => {
  for (const state of [TownState.AwaitingChoice, TownState.Plundering, TownState.Repairing, TownState.Governed, TownState.Ruins]) {
    const g = held(0, state);
    const t = g.w.map.towns[T];
    // Farmers: they walk where they are sent and fight nobody.
    const mine = outside(g, 0, UnitType.Farmer);
    const theirs = put(g, 1, UnitType.Farmer, t.cellX, t.cellY - 13);
    g.fog.update(g.w);
    cmd(g, 0, { c: "retreat", u: [mine], x: t.cellX, y: t.cellY });
    cmd(g, 1, { c: "retreat", u: [theirs], x: t.cellX, y: t.cellY });
    run(g, 40 * 20);
    assert.equal(inside(g, mine), true, `state ${state}: the holder goes in`);
    assert.equal(inside(g, theirs), state === TownState.Ruins, `state ${state}: the other ${state === TownState.Ruins ? "goes in too" : "stays out"}`);
  }
}));

test("a move into a neutral town breaks the gate nearest the army, then goes in by it", () => {
  const g = emptyGame();
  const t = g.w.map.towns[T];
  const c = g.w.castles[T];
  const ids: number[] = [];
  for (let k = 0; k < 10; k++) ids.push(put(g, 0, UnitType.Spearman, t.cellX - 2 + (k % 5), t.cellY + c.inside.y1 + 9 + Math.trunc(k / 5)));
  g.fog.update(g.w);
  cmd(g, 0, { c: "move", u: ids, x: t.cellX, y: t.cellY });
  let broken = -1;
  for (let k = 0; k < 90 * 20 && broken < 0; k++) {
    run(g, 1);
    for (let q = 0; q < 4; q++) if (g.w.gateIn(T, q) < 0) broken = q;
  }
  assert.ok(broken >= 0, "a gate broken");
  // The south one: its cells lie south of the town's middle.
  const [, dy] = c.gates[broken][0];
  assert.ok(dy > 0, `the south gate (opening ${broken})`);
  assert.equal(gatesStanding(g), 3, "only that one");
  run(g, 20 * 20);
  assert.ok(ids.some((id) => inside(g, id)), "in by it");
});

test("ranged units hit a gate for 1/5 (at least 1); melee in full", () => {
  const cases: [UnitType, number, string][] = [
    [UnitType.Ranged, Math.max(1, Math.trunc(UNITS[UnitType.Ranged].attack / 5)), "ranged"],
    [UnitType.Spearman, UNITS[UnitType.Spearman].attack, "spearman"],
  ];
  for (const [type, expect, name] of cases) {
    const g = emptyGame();
    const t = g.w.map.towns[T];
    // 3 cells south of the south gate: it sees it (an attack needs a target seen or remembered).
    const a = put(g, 0, type, t.cellX, t.cellY + g.w.castles[T].inside.y1 + 4);
    g.fog.update(g.w);
    const s = g.w.gateIn(T, 3);
    const gate = g.w.buildings.col.id[s];
    const hp = g.w.buildings.col.hp[s];
    cmd(g, 0, { c: "attack", u: [a], target: gate });
    let took = 0;
    for (let k = 0; k < 40 * 20 && took === 0; k++) {
      run(g, 1);
      took = hp - g.w.buildings.col.hp[g.w.building(gate)];
    }
    assert.equal(took, expect, name);
  }
});

test("an attack-move past a neutral town never hits its gates; a gate is no target in passing", switchedOff(KEEP, () => {
  const g = emptyGame();
  const t = g.w.map.towns[T];
  const c = g.w.castles[T];
  // Along the town's south side, past its south gate 6 cells off it (within AGGRO_RANGE), west to east.
  const y = t.cellY + c.inside.y1 + 7;
  const ids = [put(g, 0, UnitType.Spearman, t.cellX - 11, y), put(g, 0, UnitType.Spearman, t.cellX - 11, y + 1)];
  g.fog.update(g.w);
  cmd(g, 0, { c: "move", u: ids, x: t.cellX + 11, y });
  run(g, 40 * 20);
  for (let k = 0; k < 4; k++) assert.equal(g.w.buildings.col.hp[g.w.gateIn(T, k)], GATE.hp[g.w.townSize[T]]);
  const u = g.w.units.col;
  assert.ok(ids.every((id) => u.order[slotOf(g, id)] === Order.None), "they walked on and got there");
}));

test("a governed town rebuilds a broken gate once no enemy has stood inside for GATE.rebuildTicks", () => {
  const g = held(0);
  const s = g.w.gateIn(T, 0);
  g.w.buildings.col.hp[s] = 0;
  run(g, 2);
  assert.equal(gatesStanding(g), 3);
  // An enemy inside holds it off.
  const t = g.w.map.towns[T];
  const foe = put(g, 1, UnitType.Ranged, t.cellX, t.cellY);
  const mine = put(g, 0, UnitType.Spearman, t.cellX + 1, t.cellY);
  g.w.units.col.cooldown[slotOf(g, foe)] = 1 << 20;
  g.w.units.col.hp[slotOf(g, foe)] = 1 << 20;
  g.w.units.col.cooldown[slotOf(g, mine)] = 1 << 20;
  g.fog.update(g.w);
  run(g, GATE.rebuildTicks + 20);
  assert.equal(gatesStanding(g), 3, "not while an enemy is inside");
  g.w.units.col.hp[slotOf(g, foe)] = 0;
  run(g, GATE.rebuildTicks - 20);
  assert.equal(gatesStanding(g), 3, "not yet");
  run(g, 40);
  assert.equal(gatesStanding(g), 4, "rebuilt");
  assert.equal(g.w.buildings.col.owner[g.w.gateIn(T, 0)], 0, "player 0's");
});

test("repairing done and ruins turning neutral rebuild every broken gate", () => {
  const g = held(0, TownState.Repairing);
  const t = g.w.map.towns[T];
  put(g, 0, UnitType.Spearman, t.cellX, t.cellY);
  for (const k of [0, 2]) g.w.buildings.col.hp[g.w.gateIn(T, k)] = 0;
  g.w.townTimer[T] = 3;
  g.fog.update(g.w);
  run(g, 5);
  assert.equal(g.w.townState[T], TownState.Governed);
  assert.equal(gatesStanding(g), 4, "repaired");
  const r = held(1, TownState.Ruins);
  for (const k of [1, 3]) r.w.buildings.col.hp[r.w.gateIn(T, k)] = 0;
  r.w.townTimer[T] = 3;
  run(r, 5);
  assert.equal(r.w.townState[T], TownState.Neutral);
  assert.equal(gatesStanding(r), 4, "neutral again, gates whole");
  for (let k = 0; k < 4; k++) assert.equal(r.w.buildings.col.hp[r.w.gateIn(T, k)], GATE.hp[r.w.townSize[T]]);
});

test("a governed town's gates shoot: one arrow, and one more for every 3 of its soldiers inside, at most 3 more", () => {
  for (const [held0, arrows] of [[0, 1], [3, 2], [6, 3], [9, 4], [15, 4]] as const) {
    const g = held(0);
    const t = g.w.map.towns[T];
    const c = g.w.castles[T];
    for (let k = 0; k < held0; k++) {
      const id = put(g, 0, UnitType.Spearman, t.cellX - 3 + (k % 7), t.cellY - 2 + Math.trunc(k / 7));
      g.w.units.col.cooldown[slotOf(g, id)] = 1 << 20;
    }
    // Player 0 sees out of the south gate (a farmer inside it; farmers do not count as holding).
    put(g, 0, UnitType.Farmer, t.cellX, t.cellY + c.inside.y1);
    // A sturdy target 4 cells south of the south gate, out of the others' reach.
    const foe = put(g, 1, UnitType.Spearman, t.cellX, t.cellY + c.inside.y1 + 5);
    const u = g.w.units.col;
    u.hp[slotOf(g, foe)] = 1 << 20;
    u.cooldown[slotOf(g, foe)] = 1 << 20;
    g.fog.update(g.w);
    const hp = u.hp[slotOf(g, foe)];
    // The shot events carry the arrows as n, absent for one.
    const ns: (number | undefined)[] = [];
    for (let k = 0; k < GATE_ARROW.cooldown; k++) {
      g.step();
      for (const e of g.events) if (e.to === 1 && e.ev.k === "shot" && e.ev.target === foe) ns.push(e.ev.n);
    }
    const took = hp - u.hp[slotOf(g, foe)];
    assert.ok(took > 0, "shot");
    assert.equal(took % (GATE_ARROW.damage * arrows), 0, `${held0} inside: ${took} taken, volleys of ${arrows}`);
    assert.ok(ns.length > 0 && ns.every((n) => n === (arrows > 1 ? arrows : undefined)), `${held0} inside: n ${JSON.stringify(ns)}`);
  }
});

test("switched off: no gates, the openings open to everyone as D-089", switchedOff(GATE, () => {
  const g = new Game({ seed: 1, scenario: "standard" });
  const b = g.w.buildings.col;
  for (let s = 0; s < g.w.buildings.count; s++) assert.notEqual(b.type[s], BuildingType.Gate);
  for (const t of g.w.map.towns) for (const [dx, dy] of g.w.castles[t.id].gate) assert.ok(g.w.walkable(t.cellX + dx, t.cellY + dy));
}));
