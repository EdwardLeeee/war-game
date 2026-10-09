// Outposts (D-080): spearmen posted around an outpost attack what comes within reach or hold and
// hit back together, chase no farther than OUTPOST.chase, walk back to their places, pull down
// enemy buildings nearby, let arrow towers go up near it, and leave it when the player says so.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { postedAt, towerLand } from "../src/core/commands.ts";
import { BUILDINGS, OUTPOST, TOWER_REACH } from "../src/core/rules.ts";
import { PERF } from "../src/core/scenarios.ts";
import { rectDist2 } from "../src/core/units.ts";
import { BuildingFlag, BuildingType, CELL, Order, PlaceBit, Reject, Stance, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, openArea, put, run, slotOf, switchedOff } from "./helpers.ts";

const OUT = BUILDINGS[BuildingType.Outpost];

/** An empty game with a finished outpost of player 0 in the middle of an open 24 x 24 area and three spearmen posted at it. */
function manned(guards = 3): { g: Game; post: number; ox: number; oy: number; ids: number[]; area: { x: number; y: number } } {
  const g = emptyGame();
  const area = openArea(g, 24);
  const ox = area.x + 11;
  const oy = area.y + 11;
  const post = g.w.addBuilding(0, BuildingType.Outpost, ox, oy, OUT.hp, 1000);
  const ids = Array.from({ length: guards }, (_, k) => put(g, 0, UnitType.Spearman, area.x + 2 + k, area.y + 2));
  g.fog.update(g.w);
  cmd(g, 0, { c: "post", u: ids, building: post });
  run(g, 400);
  return { g, post, ox, oy, ids, area };
}

/** How far (cells, rounded down) a unit stands from the outpost's footprint. */
function cellsOut(g: Game, id: number, ox: number, oy: number): number {
  const s = slotOf(g, id);
  return Math.trunc(Math.sqrt(rectDist2(g.w.units.col.x[s], g.w.units.col.y[s], ox, oy, OUT.size)) / CELL);
}

const rejected = (g: Game) => g.events.filter((e) => e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);

test("posted spearmen stand around the outpost, and the outpost row says how many", () => {
  const { g, post, ox, oy, ids } = manned();
  for (const id of ids) {
    assert.equal(g.w.units.col.order[slotOf(g, id)], Order.Post);
    assert.ok(cellsOut(g, id, ox, oy) <= 1, `guard ${id} next to the outpost`);
  }
  const v = buildView(g, 0);
  assert.equal(postedAt(g.w, post), 3);
  let row = -1;
  for (let r = 0; r < v.buildings.length; r += 16) if (v.buildings[r] === post) row = r;
  assert.equal(v.buildings[row + 15], 3, "posted");
  const theirs = buildView(g, 1);
  for (let r = 0; r < theirs.buildings.length; r += 16) if (theirs.buildings[r] === post) assert.equal(theirs.buildings[r + 15], 0, "not for the enemy");
});

test("attacking: the guards go for an enemy within reach, beat it, and walk back", () => {
  const { g, ox, oy, ids } = manned();
  const foe = put(g, 1, UnitType.Spearman, ox + OUT.size + 6, oy);
  g.w.units.col.stance[slotOf(g, foe)] = Stance.Hold;
  g.fog.update(g.w);
  let farthest = 0;
  for (let t = 0; t < 500 && g.w.unit(foe) >= 0; t++) {
    g.step();
    for (const id of ids) if (g.w.unit(id) >= 0) farthest = Math.max(farthest, cellsOut(g, id, ox, oy));
  }
  assert.equal(g.w.unit(foe), -1, "the intruder is dead");
  assert.ok(farthest >= 4, `they went out (${farthest} cells)`);
  run(g, 400);
  for (const id of ids) if (g.w.unit(id) >= 0) assert.ok(cellsOut(g, id, ox, oy) <= 1, "and came back");
});

test("holding: they stay put for an enemy nearby, and all go for a ranged unit that shoots them", () => {
  const { g, post, ox, oy, ids } = manned();
  cmd(g, 0, { c: "outpost_mode", building: post, hold: true });
  run(g, 1);
  assert.notEqual(g.w.buildings.col.flags[g.w.building(post)] & BuildingFlag.Hold, 0);
  // A spearman of theirs 4 cells off, standing: no one moves.
  const idle = put(g, 1, UnitType.Spearman, ox + OUT.size + 4, oy + 1);
  g.w.units.col.stance[slotOf(g, idle)] = Stance.Hold;
  g.fog.update(g.w);
  for (let t = 0; t < 200; t++) {
    g.step();
    for (const id of ids) assert.ok(cellsOut(g, id, ox, oy) <= 1, `tick ${g.tick}: holding`);
  }
  // A ranged unit (close enough to see them) sent to shoot one of them: they all go for it.
  const archer = put(g, 1, UnitType.Ranged, ox - 7, oy);
  g.fog.update(g.w);
  cmd(g, 1, { c: "attack", u: [archer], target: ids[0] });
  let out = 0;
  for (let t = 0; t < 600 && g.w.unit(archer) >= 0; t++) {
    g.step();
    out = Math.max(out, ...ids.filter((id) => g.w.unit(id) >= 0).map((id) => cellsOut(g, id, ox, oy)));
  }
  assert.equal(g.w.unit(archer), -1, "the archer is dead");
  assert.ok(out >= 3, `they went for it (${out} cells)`);
  assert.ok(g.w.unit(idle) >= 0, "the one that only stood there was left alone");
});

test("they chase no farther than OUTPOST.chase cells, then walk back", () => {
  const { g, ox, oy, ids } = manned();
  // A rider close by that runs: faster than them, so they follow it out.
  const foe = put(g, 1, UnitType.Cavalry, ox + OUT.size + 3, oy);
  // A spotter of ours (holding, off the path) keeps the runaway in sight past the outpost's own sight.
  const spotter = put(g, 0, UnitType.Spearman, ox + OUT.size + 16, oy + 3);
  g.w.units.col.stance[slotOf(g, spotter)] = Stance.Hold;
  g.fog.update(g.w);
  cmd(g, 1, { c: "retreat", u: [foe], x: ox + OUT.size + 40, y: oy });
  let farthest = 0;
  for (let t = 0; t < 600; t++) {
    g.step();
    for (const id of ids) if (g.w.unit(id) >= 0) farthest = Math.max(farthest, cellsOut(g, id, ox, oy));
  }
  assert.ok(farthest >= 4, `they gave chase (${farthest} cells)`);
  assert.ok(farthest <= OUTPOST.chase + 1, `but not past ${OUTPOST.chase} cells (${farthest})`);
  for (const id of ids) assert.ok(cellsOut(g, id, ox, oy) <= 1, "back at their places");
});

test("attacking: an enemy building within reach is pulled down", () => {
  const { g, ox, oy } = manned();
  const house = g.w.addBuilding(1, BuildingType.House, ox + OUT.size + 4, oy, BUILDINGS[BuildingType.House].hp, 1000);
  g.fog.update(g.w);
  run(g, 1200);
  assert.equal(g.w.building(house), -1, "the house is gone");
});

test("arrow towers may go up within TOWER_REACH.outpost cells of an own finished outpost, not farther", () => {
  const { g, post, ox, oy } = manned(0);
  const edge = ox + OUT.size - 1;
  assert.equal(towerLand(g.w, 0, edge + TOWER_REACH.outpost, oy), true);
  assert.equal(towerLand(g.w, 0, edge + TOWER_REACH.outpost + 1, oy), false);
  assert.equal(towerLand(g.w, 1, edge + 2, oy), false, "not for the other player");
  const v = buildView(g, 0);
  const n = g.w.size;
  assert.notEqual(v.placement[oy * n + edge + TOWER_REACH.outpost] & PlaceBit.TowerLand, 0);
  assert.equal(v.placement[oy * n + edge + TOWER_REACH.outpost + 1] & PlaceBit.TowerLand, 0);
  g.w.buildings.col.progress[g.w.building(post)] = 500;
  assert.equal(towerLand(g.w, 0, edge + 2, oy), false, "an unfinished outpost does not count");
});

test("a move, attack or retreat takes a guard off the outpost; stop and formation do not; unpost frees them all", () => {
  const { g, post, ox, oy, ids } = manned();
  const order = (id: number) => g.w.units.col.order[slotOf(g, id)];
  cmd(g, 0, { c: "stop", u: [ids[0]] });
  cmd(g, 0, { c: "formation", u: [ids[1]], loose: true });
  run(g, 1);
  assert.deepEqual(ids.map(order), [Order.Post, Order.Post, Order.Post]);
  cmd(g, 0, { c: "move", u: [ids[2]], x: ox - 8, y: oy });
  run(g, 1);
  assert.equal(order(ids[2]), Order.Move);
  assert.equal(postedAt(g.w, post), 2);
  cmd(g, 0, { c: "unpost", building: post });
  run(g, 1);
  assert.deepEqual(ids.map(order), [Order.None, Order.None, Order.Move]);
  cmd(g, 0, { c: "unpost", building: post });
  run(g, 1);
  assert.deepEqual(rejected(g), [Reject.NotAvailable], "nobody left to free");
});

test("post: at most OUTPOST.slots, finished own outposts only, spearmen only; when the outpost falls they are ordinary soldiers", () => {
  const { g, post, area } = manned(OUTPOST.slots);
  const more = put(g, 0, UnitType.Spearman, area.x + 3, area.y + 5);
  const archer = put(g, 0, UnitType.Ranged, area.x + 4, area.y + 5);
  const site = g.w.addBuilding(0, BuildingType.Outpost, area.x + 2, area.y + 20, OUT.hp, 0);
  cmd(g, 0, { c: "post", u: [more], building: post });
  cmd(g, 0, { c: "post", u: [archer], building: post });
  cmd(g, 0, { c: "post", u: [more], building: site });
  cmd(g, 1, { c: "outpost_mode", building: post, hold: true });
  run(g, 1);
  assert.deepEqual(rejected(g), [Reject.NoRoom, Reject.NotAvailable, Reject.InvalidTarget, Reject.NotOwner]);
  g.w.buildings.col.hp[g.w.building(post)] = 0;
  run(g, 3);
  const u = g.w.units.col;
  for (let s = 0; s < g.w.units.count; s++) assert.notEqual(u.order[s], Order.Post, "no one guards a fallen outpost");
});

test("mirror-image outposts fight mirror-image fights, tick by tick", () => {
  const g = emptyGame();
  const w = g.w;
  // A 16 x 16 open block well off the diagonal (x <-> y is the fixed map's mirror); its image is open too.
  let bx = -1;
  let by = -1;
  for (let y = 0; y + 16 <= w.size && bx < 0; y++) {
    for (let x = 0; x + 16 <= w.size && bx < 0; x++) {
      if (y - x < 30) continue;
      let ok = true;
      for (let yy = y; yy < y + 16 && ok; yy++) for (let xx = x; xx < x + 16 && ok; xx++) if (!w.walkable(xx, yy) || !w.walkable(yy, xx)) ok = false;
      if (ok) {
        bx = x;
        by = y;
      }
    }
  }
  assert.ok(bx >= 0, "an open block");
  const ox = bx + 7;
  const oy = by + 7;
  const posts = [w.addBuilding(0, BuildingType.Outpost, ox, oy, OUT.hp, 1000), w.addBuilding(1, BuildingType.Outpost, oy, ox, OUT.hp, 1000)];
  const pairs: [number, number][] = [];
  const add = (owner: number, type: UnitType, x: number, y: number) => {
    const p: [number, number] = [put(g, owner, type, x, y), put(g, 1 - owner, type, y, x)];
    pairs.push(p);
    return p;
  };
  const guards = [add(0, UnitType.Spearman, bx + 1, by + 1), add(0, UnitType.Spearman, bx + 2, by + 1), add(0, UnitType.Spearman, bx + 3, by + 1)];
  g.fog.update(w);
  cmd(g, 0, { c: "post", u: guards.map((p) => p[0]), building: posts[0] });
  cmd(g, 1, { c: "post", u: guards.map((p) => p[1]), building: posts[1] });
  cmd(g, 0, { c: "outpost_mode", building: posts[0], hold: true });
  cmd(g, 1, { c: "outpost_mode", building: posts[1], hold: true });
  run(g, 300);
  // Intruders: a spearman walking in and an archer shooting, at each outpost.
  const [walker] = add(1, UnitType.Spearman, ox + OUT.size + 6, oy + 1);
  const [archer] = add(1, UnitType.Ranged, ox - 7, oy + 1);
  g.fog.update(w);
  const u = w.units.col;
  cmd(g, 1, { c: "attack", u: [walker], target: guards[0][0] });
  cmd(g, 0, { c: "attack", u: [pairs[3][1]], target: guards[0][1] });
  cmd(g, 1, { c: "attack", u: [archer], target: guards[1][0] });
  cmd(g, 0, { c: "attack", u: [pairs[4][1]], target: guards[1][1] });
  let fought = 0;
  for (let t = 0; t < 600; t++) {
    g.step();
    for (const [a, b] of pairs) {
      const sa = slotOf(g, a);
      const sb = slotOf(g, b);
      assert.equal(sa < 0, sb < 0, `tick ${g.tick}: both alive or both dead`);
      if (sa < 0) continue;
      assert.equal(u.x[sb], u.y[sa], `tick ${g.tick}: x of the image is y of the original`);
      assert.equal(u.y[sb], u.x[sa], `tick ${g.tick}`);
    }
    if (slotOf(g, walker) < 0) fought++;
  }
  assert.ok(fought > 0, "the fight happened");
});

test("perf: two manned outposts a side, mirror images; a game with no outpost hashes as with the switch off", () => {
  const g = new Game({ seed: 1, scenario: "perf" });
  const b = g.w.buildings.col;
  const posts: number[][] = [[], []];
  for (let s = 0; s < g.w.buildings.count; s++) if (b.type[s] === BuildingType.Outpost) posts[b.owner[s]].push(s);
  assert.deepEqual(posts.map((x) => x.length), [2, 2]);
  posts[0].forEach((s, k) => {
    const m = posts[1][k];
    assert.deepEqual([b.cellX[m], b.cellY[m]], [b.cellY[s], b.cellX[s]]);
    assert.equal(postedAt(g.w, b.id[s]), OUTPOST.slots);
    assert.equal(postedAt(g.w, b.id[m]), OUTPOST.slots);
  });
  // perf's battle without its outposts: soldiers hit and fall, and nothing of D-080 shows.
  const hashes = (): number[] => {
    const h = new Game({ seed: 1, scenario: "perf" });
    const out: number[] = [];
    for (let t = 0; t < 600; t++) {
      h.step();
      if (t % 100 === 99) out.push(h.hash());
    }
    return out;
  };
  const keep = PERF.outposts;
  PERF.outposts = [];
  try {
    const on = hashes();
    let off: number[] = [];
    switchedOff(OUTPOST, () => {
      off = hashes();
    })();
    assert.deepEqual(on, off);
  } finally {
    PERF.outposts = keep;
  }
});
