// OUTPOST_HIDE (D-119; the user 2026-11-04: 「我覺得哨所的面積應該要放大，我是把它當作城牆來設計的」「駐軍是不是也可以放進去？
// 只能放槍兵然後槍兵可以躲在裡面戳人」): 3 x 3 outposts, 1500 hp; up to 9 posted spearmen hide inside, out of
// reach, and strike enemies next to it at twice their attack; holding (the default) they stay in,
// attacking they come out for enemies within reach and go back in.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { BUILDINGS, OUTPOST, OUTPOST_HIDE, rules, UNITS } from "../src/core/rules.ts";
import { Action, BUILDING_STRIDE, BuildingField, BuildingFlag, BuildingType, Order, Reject, Stance, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { outpostDamage } from "../src/core/units.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "./helpers.ts";

const S = 20;
const OUT = BUILDINGS[BuildingType.Outpost];
const rejected = (g: Game) => g.events.filter((e) => e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);

/** An empty game with a finished outpost of player 0 in an open 30 x 30 area, `guards` spearmen posted (and in), holding or not. */
function manned(guards: number, hold: boolean) {
  const g = emptyGame();
  const area = openArea(g, 30);
  const ox = area.x + 13;
  const oy = area.y + 13;
  const post = g.w.addBuilding(0, BuildingType.Outpost, ox, oy, OUT.hp, 1000);
  if (hold) g.w.buildings.col.flags[g.w.building(post)] |= BuildingFlag.Hold;
  const ids = Array.from({ length: guards }, (_, k) => put(g, 0, UnitType.Spearman, area.x + 2 + (k % 5), area.y + 2 + Math.trunc(k / 5)));
  g.fog.update(g.w);
  cmd(g, 0, { c: "post", u: ids, building: post });
  run(g, 30 * S);
  return { g, post, ox, oy, ids, area };
}

const inside = (g: Game, ids: number[]) => ids.filter((id) => g.w.units.col.action[slotOf(g, id)] === Action.Garrisoned).length;

test("the rules: 3 x 3, 1500 hp, 90 wood, 9 spearmen, strikes x2; Rules says so", () => {
  assert.deepEqual([OUT.size, OUT.hp, OUT.cost.wood, OUTPOST.slots, OUTPOST_HIDE.poke], [3, 1500, 90, 9, 2]);
  const r = rules();
  assert.equal(r.buildings[BuildingType.Outpost].size, 3);
  assert.deepEqual(r.outpost, { slots: 9, reach: OUTPOST.reach, chase: OUTPOST.chase, poke: 2, ranged: [1, 5], melee: [1, 3] });
  assert.equal(r.features.outpostHide, true);
});

test("a new outpost holds; posted spearmen go in, 9 at most, and the outpost row counts them", () => {
  const g = emptyGame();
  const area = openArea(g, 30);
  // The keep openArea takes down goes at the first step.
  run(g, 1);
  const farmer = put(g, 0, UnitType.Farmer, area.x + 3, area.y + 3);
  g.fog.update(g.w);
  cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.Outpost, x: area.x + 4, y: area.y + 4 });
  run(g, 1);
  const b = g.w.buildings.col;
  const s = Array.from({ length: g.w.buildings.count }, (_, k) => k).find((k) => b.type[k] === BuildingType.Outpost);
  assert.ok(s !== undefined, "built");
  assert.notEqual(b.flags[s] & BuildingFlag.Hold, 0, "holds from the start");
  const { g: h, post, ids } = manned(9, true);
  assert.equal(inside(h, ids), 9, "all 9 in");
  assert.equal(h.w.buildings.col.soldiers[h.w.building(post)], 9);
  for (const id of ids) assert.equal(h.w.units.col.order[slotOf(h, id)], Order.Post);
  const tenth = put(h, 0, UnitType.Spearman, 5, 5);
  cmd(h, 0, { c: "post", u: [tenth], building: post });
  run(h, 1);
  assert.deepEqual(rejected(h), [Reject.NoRoom]);
});

test("in it, nobody outside reaches them: archers shooting the outpost for 20 s hurt none, and holding they stay in", () => {
  const { g, post, ox, oy, ids } = manned(9, true);
  const u = g.w.units.col;
  const archers = [0, 1, 2].map((k) => put(g, 1, UnitType.Ranged, ox + OUT.size + 4, oy + k));
  g.fog.update(g.w);
  cmd(g, 1, { c: "attack", u: archers, target: post });
  run(g, 20 * S);
  assert.ok(g.w.buildings.col.hp[g.w.building(post)] < OUT.hp, "the outpost was hit");
  for (const id of ids) assert.equal(u.hp[slotOf(g, id)], UNITS[UnitType.Spearman].hp, `spearman ${id} untouched`);
  assert.equal(inside(g, ids), 9, "still in");
});

test("they strike an enemy next to the outpost at twice their attack, a `poke` event for each", () => {
  const { g, post, ox, oy, ids } = manned(3, true);
  const u = g.w.units.col;
  const foe = put(g, 1, UnitType.Spearman, ox + OUT.size, oy + 1);
  u.stance[slotOf(g, foe)] = Stance.Hold;
  u.hp[slotOf(g, foe)] = 10_000;
  g.fog.update(g.w);
  cmd(g, 1, { c: "attack", u: [foe], target: post });
  let pokes = 0;
  let strikes = 0;
  let before = u.hp[slotOf(g, foe)];
  let hits: number[] = [];
  for (let t = 0; t < 10 * S; t++) {
    g.step();
    for (const e of g.events) {
      if (e.ev.k !== "poke" || e.to !== 0) continue;
      const ev = e.ev as { building: number; target: number; n?: number };
      assert.equal(ev.building, post);
      assert.equal(ev.target, foe);
      pokes++;
      strikes += ev.n ?? 1;
    }
    const hp = u.hp[slotOf(g, foe)];
    if (hp < before) hits.push(before - hp);
    before = hp;
  }
  assert.ok(pokes > 0, "poke events");
  assert.ok(strikes >= pokes);
  const one = UNITS[UnitType.Spearman].attack * OUTPOST_HIDE.poke;
  assert.ok(hits.every((d) => d % one === 0), `each tick's damage a multiple of ${one}: ${hits.slice(0, 6).join(",")}`);
  assert.equal(inside(g, ids), 3, "they strike from inside");
});

test("attacking: an enemy within OUTPOST.reach brings them out, they kill it and go back in", () => {
  const { g, post, ox, oy, ids } = manned(4, false);
  const u = g.w.units.col;
  assert.equal(inside(g, ids), 4, "in to start with");
  const foe = put(g, 1, UnitType.Ranged, ox + OUT.size + 5, oy + 1);
  u.stance[slotOf(g, foe)] = Stance.Hold;
  g.fog.update(g.w);
  let out = 0;
  for (let t = 0; t < 30 * S; t++) {
    g.step();
    out = Math.max(out, ids.length - inside(g, ids));
  }
  assert.ok(out >= 3, `they came out (${out})`);
  assert.ok(slotOf(g, foe) < 0, "killed it");
  assert.equal(inside(g, ids), 4, "back in");
  assert.equal(g.w.buildings.col.soldiers[g.w.building(post)], 4);
});

test("out again: unpost, a move, and the outpost falling; their cells free, no order after", () => {
  const { g, post, ids, area } = manned(5, true);
  const u = g.w.units.col;
  cmd(g, 0, { c: "move", u: [ids[0]], x: area.x + 2, y: area.y + 2 });
  run(g, 1);
  assert.equal(u.action[slotOf(g, ids[0])] === Action.Garrisoned, false, "the move takes it out");
  assert.equal(u.order[slotOf(g, ids[0])], Order.Move);
  cmd(g, 0, { c: "unpost", building: post });
  run(g, 1);
  for (const id of [ids[1], ids[2]]) {
    assert.notEqual(u.action[slotOf(g, id)], Action.Garrisoned);
    assert.equal(u.order[slotOf(g, id)], Order.None);
  }
  assert.equal(g.w.buildings.col.soldiers[g.w.building(post)], 0);
  // Posted again, then the outpost falls.
  cmd(g, 0, { c: "post", u: ids.slice(1), building: post });
  run(g, 20 * S);
  assert.equal(inside(g, ids.slice(1)), 4);
  g.w.buildings.col.hp[g.w.building(post)] = 0;
  run(g, 2);
  for (const id of ids.slice(1)) {
    const s = slotOf(g, id);
    assert.ok(s >= 0, "alive");
    assert.notEqual(u.action[s], Action.Garrisoned);
    assert.equal(u.order[s], Order.None);
  }
});

test("mirror-image outposts, mirror-image fights from inside, tick by tick", () => {
  const g = emptyGame();
  const w = g.w;
  let bx = -1;
  let by = -1;
  for (let y = 0; y + 16 <= w.size && bx < 0; y++) {
    for (let x = 0; x + 16 <= w.size && bx < 0; x++) {
      if (y - x < 27) continue;
      let ok = true;
      for (let yy = y; yy < y + 16 && ok; yy++) for (let xx = x; xx < x + 16 && ok; xx++) if (!w.walkable(xx, yy) || !w.walkable(yy, xx)) ok = false;
      if (ok) {
        bx = x;
        by = y;
      }
    }
  }
  assert.ok(bx >= 0, "an open block");
  const ox = bx + 6;
  const oy = by + 6;
  const posts = [w.addBuilding(0, BuildingType.Outpost, ox, oy, OUT.hp, 1000), w.addBuilding(1, BuildingType.Outpost, oy, ox, OUT.hp, 1000)];
  const pairs: [number, number][] = [];
  const add = (owner: number, type: UnitType, x: number, y: number) => {
    const p: [number, number] = [put(g, owner, type, x, y), put(g, 1 - owner, type, y, x)];
    pairs.push(p);
    return p;
  };
  const guards = [0, 1, 2, 3].map((k) => add(0, UnitType.Spearman, bx + 1 + k, by + 1));
  g.fog.update(w);
  cmd(g, 0, { c: "post", u: guards.map((p) => p[0]), building: posts[0] });
  cmd(g, 1, { c: "post", u: guards.map((p) => p[1]), building: posts[1] });
  cmd(g, 0, { c: "outpost_mode", building: posts[0], hold: true });
  cmd(g, 1, { c: "outpost_mode", building: posts[1], hold: true });
  run(g, 20 * S);
  const walkers = [add(1, UnitType.Spearman, ox + OUT.size + 4, oy + 1), add(1, UnitType.Spearman, ox - 4, oy + 2)];
  g.fog.update(w);
  cmd(g, 1, { c: "attack", u: walkers.map((p) => p[0]), target: posts[0] });
  cmd(g, 0, { c: "attack", u: walkers.map((p) => p[1]), target: posts[1] });
  const u = w.units.col;
  let struck = false;
  for (let t = 0; t < 30 * S; t++) {
    g.step();
    if (g.events.some((e) => e.ev.k === "poke")) struck = true;
    for (const [a, b] of pairs) {
      const sa = slotOf(g, a);
      const sb = slotOf(g, b);
      assert.equal(sa < 0, sb < 0, `tick ${g.tick}: both alive or both dead`);
      if (sa < 0) continue;
      assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}: x of the image is y of the original`);
      assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
      assert.equal(u.hp[sb], u.hp[sa], `tick ${g.tick}: hp`);
    }
  }
  assert.ok(struck, "they struck");
});

test("like a wall: ranged units and mages hit it at 1/5, the rest at 1/3, at least 1; siege stones as on any building", () => {
  assert.equal(outpostDamage(UNITS[UnitType.Ranged].attack, UnitType.Ranged), 1);
  assert.equal(outpostDamage(UNITS[UnitType.Spearman].attack, UnitType.Spearman), 2);
  assert.equal(outpostDamage(UNITS[UnitType.Cavalry].attack, UnitType.Cavalry), 3);
  const { g, post, ox, oy } = manned(0, true);
  const u = g.w.units.col;
  const b = g.w.buildings.col;
  const foe = put(g, 1, UnitType.Spearman, ox + OUT.size, oy + 1);
  u.stance[slotOf(g, foe)] = Stance.Hold;
  g.fog.update(g.w);
  cmd(g, 1, { c: "attack", u: [foe], target: post });
  run(g, 10 * S);
  const lost = OUT.hp - b.hp[g.w.building(post)];
  assert.ok(lost > 0 && lost % 2 === 0 && lost <= 2 * 8, `a spearman took ${lost} in 10 s (2 a hit)`);
});

test("everyone who sees an outpost learns how many are in it (they stand on top of it on the screen); a tower's stay its owner's", () => {
  const { g, post, ox, oy } = manned(5, true);
  const scout = put(g, 1, UnitType.Ranged, ox + OUT.size + 3, oy + 1);
  g.w.units.col.stance[slotOf(g, scout)] = Stance.Hold;
  g.fog.update(g.w);
  const view = buildView(g, 1);
  const rows = view.buildings;
  let found = false;
  for (let o = 0; o < rows.length; o += BUILDING_STRIDE) {
    if (rows[o + BuildingField.id] !== post) continue;
    found = true;
    assert.equal(rows[o + BuildingField.soldiers], 5);
    assert.equal(rows[o + BuildingField.posted], 0, "posted: still the owner's only");
  }
  assert.ok(found, "player 1 sees the outpost");
});
