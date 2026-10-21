// On the walls (D-096; core/rules.ts WALLS): a town's holder sends ranged units and mages up onto its
// walls (`wall`), one a wall cell; there they shoot WALLS.range further, take arrows and shots for
// less, are reached by melee only from inside, and count as in the town; down again with
// `leave_wall` or any order. A neutral town's militia stand on its walls from the start.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { GATE, UNITS, WALLS } from "../src/core/rules.ts";
import { onWall } from "../src/core/units.ts";
import { Action, CELL, CELL_SHIFT, NEUTRAL, Order, Reject, TownSize, TownState, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOff } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;
const T = 0;

/** Player 0 governs town T (its militia gone, its gates player 0's). */
function governed(): G {
  const g = emptyGame();
  const w = g.w;
  w.townState[T] = TownState.Governed;
  w.townOwner[T] = 0;
  w.refreshGates(T);
  g.fog.update(w);
  return g;
}

const rejected = (g: G) => g.events.filter((e) => e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);

test("ranged units and mages go up onto the walls, one a wall cell, and stand there; spearmen stay below", () => {
  const g = governed();
  const w = g.w;
  const t = w.map.towns[T];
  const ids = [put(g, 0, UnitType.Ranged, t.cellX, t.cellY), put(g, 0, UnitType.Ranged, t.cellX + 1, t.cellY), put(g, 0, UnitType.Mage, t.cellX, t.cellY + 1)];
  const spear = put(g, 0, UnitType.Spearman, t.cellX - 1, t.cellY);
  g.fog.update(w);
  cmd(g, 0, { c: "wall", u: [...ids, spear], town: T });
  run(g, 20 * 20);
  const u = w.units.col;
  const cells = new Set<number>();
  for (const id of ids) {
    const s = slotOf(g, id);
    assert.ok(onWall(w, s), `unit ${id} on the wall`);
    assert.equal(u.action[s], Action.OnWall);
    assert.equal(w.wallTown[u.wall[s]], T);
    cells.add(u.wall[s]);
  }
  assert.equal(cells.size, 3, "a cell each");
  assert.equal(u.wall[slotOf(g, spear)], -1, "the spearman stays below");
  const before = ids.map((id) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]]);
  run(g, 100);
  assert.deepEqual(ids.map((id) => [u.x[slotOf(g, id)], u.y[slotOf(g, id)]]), before, "they do not move");
});

test("`wall` rejects: none of the player's (NotOwner), no ranged or mage (NotAvailable), a town not held (TownNotYours), a full wall (NoRoom)", () => {
  const g = governed();
  const w = g.w;
  const t = w.map.towns[T];
  const spear = put(g, 0, UnitType.Spearman, t.cellX, t.cellY);
  const archer = put(g, 0, UnitType.Ranged, t.cellX + 1, t.cellY);
  const theirs = put(g, 1, UnitType.Ranged, t.cellX + 2, t.cellY);
  g.fog.update(w);
  const got: number[] = [];
  const tryWall = (u: number[], town: number) => {
    cmd(g, 0, { c: "wall", u, town });
    run(g, 1);
    got.push(...rejected(g));
  };
  tryWall([theirs], T);
  tryWall([spear], T);
  tryWall([archer], 2);
  for (const c of w.wallCells[T]) w.wallAt[c] = 999;
  tryWall([archer], T);
  assert.deepEqual(got, [Reject.NotOwner, Reject.NotAvailable, Reject.TownNotYours, Reject.NoRoom]);
  assert.equal(w.units.col.wall[slotOf(g, archer)], -1);
});

/** A ranged unit of player 0 on town T's west wall, and player 1's ranged `gap` cells west of it, both standing. */
function duel(gap: number, ownOnWall: boolean) {
  const g = governed();
  const w = g.w;
  const t = w.map.towns[T];
  const c = w.castles[T];
  const wx = t.cellX + c.inside.x0 - 1;
  const wy = t.cellY + 3;
  const mine = put(g, 0, UnitType.Ranged, ownOnWall ? wx + 1 : wx - 1, wy);
  const theirs = put(g, 1, UnitType.Ranged, wx - gap, wy);
  g.fog.update(w);
  if (ownOnWall) {
    cmd(g, 0, { c: "wall", u: [mine], town: T });
    for (let k = 0; k < 200 && !onWall(w, slotOf(g, mine)); k++) run(g, 1);
    assert.ok(onWall(w, slotOf(g, mine)), "up");
    assert.equal(w.units.col.wall[slotOf(g, mine)], wy * w.size + wx, "on the west wall");
  }
  return { g, mine, theirs };
}

test("on a wall a ranged unit shoots WALLS.range further: it hits one 7 cells off that cannot hit it back", () => {
  const range = UNITS[UnitType.Ranged].range >> CELL_SHIFT;
  const { g, mine, theirs } = duel(range + 1, true);
  const u = g.w.units.col;
  const hp0 = [u.hp[slotOf(g, mine)], u.hp[slotOf(g, theirs)]];
  run(g, 10 * 20);
  assert.equal(u.hp[slotOf(g, mine)], hp0[0], "not hit");
  assert.ok(slotOf(g, theirs) < 0 || u.hp[slotOf(g, theirs)] < hp0[1], "it hit the other");
  assert.equal(WALLS.range, CELL);
});

test("on a wall it takes arrows and shots for 3/4: ranged against ranged, two cells off", () => {
  const hits = (wall: boolean) => {
    const { g, mine, theirs } = duel(2, wall);
    const u = g.w.units.col;
    u.hp[slotOf(g, theirs)] = 100000;
    const hp = u.hp[slotOf(g, mine)];
    // Theirs shoots first: a few shots, then compare what one shot took.
    let took = 0;
    for (let t = 0; t < 400 && took === 0; t++) {
      run(g, 1);
      took = hp - u.hp[slotOf(g, mine)];
    }
    return took;
  };
  const ground = hits(false);
  const wall = hits(true);
  assert.ok(ground > 0);
  assert.equal(wall, Math.max(1, Math.trunc((ground * WALLS.takenNum) / WALLS.takenDen)), `${wall} on the wall, ${ground} below`);
});

test("melee reaches one on a wall only from inside: a spearman outside the wall stands, one inside kills it", () => {
  const g = governed();
  const w = g.w;
  const t = w.map.towns[T];
  const c = w.castles[T];
  const wx = t.cellX + c.inside.x0 - 1;
  const wy = t.cellY + 3;
  const archer = put(g, 0, UnitType.Ranged, wx + 1, wy);
  g.fog.update(w);
  cmd(g, 0, { c: "wall", u: [archer], town: T });
  run(g, 100);
  assert.ok(onWall(w, slotOf(g, archer)));
  const u = w.units.col;
  u.cooldown[slotOf(g, archer)] = 1 << 20;
  const outside = put(g, 1, UnitType.Spearman, wx - 1, wy);
  g.fog.update(w);
  const hp = u.hp[slotOf(g, archer)];
  run(g, 5 * 20);
  assert.equal(u.hp[slotOf(g, archer)], hp, "not from outside");
  assert.notEqual(u.target[slotOf(g, outside)], u.id[slotOf(g, archer)], "the one outside does not go for it");
  put(g, 1, UnitType.Spearman, wx + 2, wy);
  g.fog.update(w);
  run(g, 30 * 20);
  assert.ok(slotOf(g, archer) < 0, "the one inside killed it");
});

test("a soldier on the wall keeps the town: enemies inside do not take it while it stands", () => {
  const g = governed();
  const w = g.w;
  const t = w.map.towns[T];
  const archer = put(g, 0, UnitType.Ranged, t.cellX + 2, t.cellY);
  g.fog.update(w);
  cmd(g, 0, { c: "wall", u: [archer], town: T });
  run(g, 100);
  assert.ok(onWall(w, slotOf(g, archer)));
  w.units.col.cooldown[slotOf(g, archer)] = 1 << 20;
  // Player 1's ranged unit inside, out of the archer's way (it shoots nobody: cooldown).
  const foe = put(g, 1, UnitType.Ranged, t.cellX, t.cellY);
  w.units.col.cooldown[slotOf(g, foe)] = 1 << 20;
  // It stands the gates' arrows (GATE_ARROW) meanwhile.
  w.units.col.hp[slotOf(g, foe)] = 1 << 20;
  g.fog.update(w);
  run(g, 3 * 20);
  assert.equal(w.townOwner[T], 0, "still player 0's");
  w.units.col.hp[slotOf(g, archer)] = 0;
  run(g, 3 * 20);
  assert.equal(w.townOwner[T], 1, "taken once it fell");
});

test("down again with leave_wall, or with a move: to the cell inside it climbed from", () => {
  const g = governed();
  const w = g.w;
  const t = w.map.towns[T];
  const a = put(g, 0, UnitType.Ranged, t.cellX, t.cellY);
  const b = put(g, 0, UnitType.Mage, t.cellX + 1, t.cellY);
  g.fog.update(w);
  cmd(g, 0, { c: "wall", u: [a, b], town: T });
  run(g, 200);
  const u = w.units.col;
  const feet = [a, b].map((id) => w.wallFoot[u.wall[slotOf(g, id)]]);
  cmd(g, 0, { c: "leave_wall", u: [a], town: T });
  cmd(g, 0, { c: "move", u: [b], x: t.cellX, y: t.cellY });
  run(g, 1);
  for (const [k, id] of [a, b].entries()) {
    const s = slotOf(g, id);
    assert.equal(u.wall[s], -1, `unit ${id} down`);
    assert.equal((u.y[s] >> CELL_SHIFT) * w.size + (u.x[s] >> CELL_SHIFT), feet[k], "where it climbed from");
  }
  assert.equal(u.order[slotOf(g, a)], Order.None);
  assert.equal(u.order[slotOf(g, b)], Order.Move);
  assert.ok(w.wallCells[T].every((c) => w.wallAt[c] < 0), "the wall cells are free again");
});

test("a neutral town's militia stand on its walls from the start: 3 of 6 in a small town, 6 of 12 in the big city; they throw stones to WALLS.sling", () => {
  const g = new Game({ seed: 1, scenario: "standard" });
  const w = g.w;
  const u = w.units.col;
  w.map.towns.forEach((t, i) => {
    let up = 0;
    let all = 0;
    for (let s = 0; s < w.units.count; s++) {
      if (u.owner[s] !== NEUTRAL || u.home[s] !== i) continue;
      all++;
      if (onWall(w, s)) up++;
    }
    assert.equal([all, up].join("/"), t.size === TownSize.Small ? "6/3" : "12/6", `town ${i}`);
  });
  assert.equal(WALLS.sling, 4 * CELL);
});

test("switched off (WALLS, GATE): no `wall`, and militia stand at their posts as before", switchedOff([WALLS, GATE], () => {
  const g = new Game({ seed: 1, scenario: "standard" });
  const w = g.w;
  const u = w.units.col;
  for (let s = 0; s < w.units.count; s++) assert.equal(u.wall[s], -1);
  const t = w.map.towns[T];
  const archer = put(g, 0, UnitType.Ranged, t.cellX, t.cellY);
  cmd(g, 0, { c: "wall", u: [archer], town: T });
  run(g, 1);
  assert.deepEqual(rejected(g as G), [Reject.NotAvailable]);
}));
