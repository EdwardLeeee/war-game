// WALL_SHIFT (D-119; the user 2026-11-04: 「如果敵軍打一邊，另外一側牆上的兵都不會自動走過去打，應該要走過去一起打的」):
// soldiers on a castle's walls with nothing to shoot walk along the walls, over the gates while they
// stand, to the free wall cells nearest them from which an enemy is in reach; back home once calm.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { RETARGET_EVERY, UNITS, WALL_SHIFT } from "../src/core/rules.ts";
import { onWall, wallReach } from "../src/core/units.ts";
import { Action, CELL_SHIFT, NEUTRAL, Order, Stance, TownState, UnitType } from "../src/protocol.ts";
import { keepOf } from "../src/core/scenarios.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOff } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;
const S = 20;

/** Player 0 governs town t (its keep too), a ranged unit on every `every`-th wall cell (the castle's order). */
function garrisoned(t: number, every: number, type: UnitType = UnitType.Ranged): { g: G; mine: number[]; homes: number[] } {
  const g = emptyGame();
  const w = g.w;
  w.townState[t] = TownState.Governed;
  w.townOwner[t] = 0;
  const keep = keepOf(w, t);
  if (keep >= 0) w.buildings.col.owner[keep] = 0;
  w.refreshGates(t);
  const n = w.size;
  const u = w.units.col;
  const mine: number[] = [];
  const homes: number[] = [];
  Array.from(w.wallCells[t]).forEach((c, k) => {
    if (k % every !== 0) return;
    const id = put(g, 0, type, c % n, Math.trunc(c / n));
    const s = slotOf(g, id);
    u.wall[s] = c;
    w.wallAt[c] = id;
    u.order[s] = Order.Wall;
    u.orderTarget[s] = t;
    u.action[s] = Action.OnWall;
    mine.push(id);
    homes.push(c);
  });
  g.fog.update(w);
  return { g, mine, homes };
}

/** `count` of player 1's spearmen, holding, that do not die, 2 to 4 cells out of town t's east gate. */
function atEastGate(g: G, t: number, count: number, owner = 1): number[] {
  const w = g.w;
  const town = w.map.towns[t];
  const ex = town.cellX + w.castles[t].inside.x1 + 1;
  const ids: number[] = [];
  for (let k = 0; k < count; k++) {
    const id = put(g, owner, UnitType.Spearman, ex + 2 + (k % 3), town.cellY - 2 + Math.trunc(k / 3));
    w.units.col.hp[slotOf(g, id)] = 1_000_000;
    ids.push(id);
  }
  cmd(g, owner, { c: "stance", u: ids, stance: Stance.Hold });
  g.fog.update(w);
  return ids;
}

const reaches = (g: G, s: number, foes: number[]): boolean => {
  const u = g.w.units.col;
  const r = wallReach(u.type[s], UNITS[u.type[s]].range);
  return foes.some((f) => {
    const j = slotOf(g, f);
    return j >= 0 && (u.x[j] - u.x[s]) ** 2 + (u.y[j] - u.y[s]) ** 2 <= r * r;
  });
};

/** Every unit of `ids` on the walls' way of town t (a wall or a gate's cell), up there. */
function upThere(g: G, t: number, ids: number[]): void {
  const w = g.w;
  const u = w.units.col;
  for (const id of ids) {
    const s = slotOf(g, id);
    assert.ok(onWall(w, s), `unit ${id} on the walls`);
    assert.equal(w.wallTown[u.wall[s]], t, `unit ${id} on town ${t}'s walls`);
    if (w.walkGate[u.wall[s]] === 1) assert.equal(u.action[s], Action.Move, `unit ${id} never stands on a gate`);
  }
}

test("one gate attacked: the ranged on the other walls walk along them, over the gates, into reach within 20 s; never down, never out, a cell each", () => {
  const T = 0;
  const { g, mine } = garrisoned(T, 4);
  const w = g.w;
  const u = w.units.col;
  const foes = atEastGate(g, T, 9);
  const far = mine.filter((id) => !reaches(g, slotOf(g, id), foes));
  assert.ok(far.length >= 8, `most of them out of reach to start with (${far.length} of ${mine.length})`);
  let crossed = false;
  let all = -1;
  for (let tick = 1; tick <= 30 * S; tick++) {
    run(g, 1);
    upThere(g, T, mine);
    if (mine.some((id) => w.walkGate[u.wall[slotOf(g, id)]] === 1)) crossed = true;
    if (all < 0 && mine.every((id) => reaches(g, slotOf(g, id), foes))) all = tick;
  }
  assert.ok(crossed, "some walked over a gate");
  assert.ok(all > 0 && all <= 20 * S, `all in reach by ${all / S} s`);
  const cells = mine.map((id) => u.wall[slotOf(g, id)]);
  assert.equal(new Set(cells).size, mine.length, "a cell each");
  for (const id of mine) {
    const s = slotOf(g, id);
    assert.equal(w.wallAt[u.wall[s]], id, "each holds the cell it stands on");
    assert.equal(u.wallTo[s], -1, "standing");
    assert.equal(u.action[s], Action.Attack, "shooting");
  }
});

test("the big city: as many as there are cells in reach get there; the others stay where they stood", () => {
  const T = 1;
  const { g, mine, homes } = garrisoned(T, 2);
  const w = g.w;
  const u = w.units.col;
  const foes = atEastGate(g, T, 9);
  for (let k = 0; k < 40 * S; k++) {
    run(g, 1);
    upThere(g, T, mine);
  }
  const reach = wallReach(UnitType.Ranged, UNITS[UnitType.Ranged].range);
  const n = w.size;
  // Wall cells in reach of an enemy, all taken; whoever is not in reach stands at home.
  const inReach = Array.from(w.wallCells[T]).filter((c) =>
    foes.some((f) => {
      const j = slotOf(g, f);
      const dx = u.x[j] - (((c % n) << CELL_SHIFT) + 512);
      const dy = u.y[j] - ((Math.trunc(c / n) << CELL_SHIFT) + 512);
      return dx * dx + dy * dy <= reach * reach;
    }),
  );
  assert.ok(inReach.every((c) => w.wallAt[c] >= 0), "every wall cell in reach taken");
  mine.forEach((id, k) => {
    const s = slotOf(g, id);
    if (!reaches(g, s, foes)) assert.equal(u.wall[s], homes[k], `unit ${id} out of reach stays home`);
  });
  assert.ok(mine.filter((id) => reaches(g, slotOf(g, id), foes)).length > inReach.length / 2, "most of the cells in reach have someone");
});

test("calm again: WALL_SHIFT.back after the last enemy goes, they walk back to where they stood", () => {
  const T = 0;
  const { g, mine, homes } = garrisoned(T, 4);
  const w = g.w;
  const u = w.units.col;
  const foes = atEastGate(g, T, 9);
  run(g, 25 * S);
  assert.ok(mine.some((id, k) => u.wall[slotOf(g, id)] !== homes[k]), "they shifted");
  for (const f of foes) u.hp[slotOf(g, f)] = 0;
  run(g, 1);
  run(g, WALL_SHIFT.back - 2 * S);
  assert.ok(mine.every((id) => u.wallTo[slotOf(g, id)] === -1 || u.wall[slotOf(g, id)] === u.wallTo[slotOf(g, id)]), "not yet on the way back");
  run(g, 30 * S);
  mine.forEach((id, k) => {
    const s = slotOf(g, id);
    assert.equal(u.wall[s], homes[k], `unit ${id} home`);
    assert.equal(u.action[s], Action.OnWall);
  });
});

test("a broken gate is not crossed: with the north and south gates broken, the west wall's stay on their stretch", () => {
  const T = 0;
  const { g, mine, homes } = garrisoned(T, 4);
  const w = g.w;
  const u = w.units.col;
  const n = w.size;
  const b = w.buildings.col;
  const town = w.map.towns[T];
  const box = w.castles[T].inside;
  for (const c of [(town.cellY + box.y0 - 1) * n + town.cellX, (town.cellY + box.y1 + 1) * n + town.cellX]) b.hp[w.building(w.buildingAt[c])] = 0;
  run(g, 1);
  const foes = atEastGate(g, T, 9);
  const west = mine.filter((_, k) => homes[k] % n < town.cellX);
  for (let k = 0; k < 30 * S; k++) {
    run(g, 1);
    upThere(g, T, mine);
    for (const id of west) assert.ok(u.wall[slotOf(g, id)] % n < town.cellX, `unit ${id} stays west of the broken gates`);
  }
  void foes;
});

test("a neutral town's militia stand where they are (ceo 2026-11-04): attacked at one gate, none walks", () => {
  const g = new Game({ seed: 1, scenario: "standard" });
  const w = g.w;
  const u = w.units.col;
  const T = 0;
  const militia: number[] = [];
  for (let s = 0; s < w.units.count; s++) if (u.owner[s] === NEUTRAL && u.home[s] === T && onWall(w, s)) militia.push(u.id[s]);
  assert.equal(militia.length, 3);
  const cells = militia.map((id) => u.wall[slotOf(g, id)]);
  atEastGate(g, T, 9, 0);
  for (let k = 0; k < 30 * S; k++) {
    run(g, 1);
    assert.deepEqual(
      militia.map((id) => u.wall[slotOf(g, id)]),
      cells,
    );
  }
});

test("an army coming its way: it waits for it where it stands, and walking it stops at the first cell in reach", () => {
  const T = 0;
  const { g, mine } = garrisoned(T, 4);
  const w = g.w;
  const u = w.units.col;
  const town = w.map.towns[T];
  const ex = town.cellX + w.castles[T].inside.x1 + 1;
  // Spearmen walking in from 14 cells east of the east gate.
  const foes: number[] = [];
  for (let k = 0; k < 9; k++) foes.push(put(g, 1, UnitType.Spearman, ex + 14 + (k % 3), town.cellY - 1 + Math.trunc(k / 3)));
  for (const f of foes) u.hp[slotOf(g, f)] = 1_000_000;
  g.fog.update(w);
  cmd(g, 1, { c: "move", u: foes, x: ex + 2, y: town.cellY });
  let walkingInReach = 0;
  for (let t = 0; t < 40 * S; t++) {
    run(g, 1);
    upThere(g, T, mine);
    for (const id of mine) {
      const s = slotOf(g, id);
      // A look comes every RETARGET_EVERY ticks: one walking a whole second with an enemy in reach on a free cell would be a fault.
      const c = u.wall[s];
      if (u.action[s] === Action.Move && w.walkGate[c] === 0 && (w.wallAt[c] < 0 || w.wallAt[c] === id) && reaches(g, s, foes)) walkingInReach++;
    }
  }
  assert.ok(walkingInReach < mine.length * 2 * RETARGET_EVERY, `walked in reach ${walkingInReach} unit-ticks`);
  assert.ok(mine.every((id) => reaches(g, slotOf(g, id), foes)), "all in reach at the end");
});

test("down from the walls on the way (a move): from the cell it is on, its cells free again", () => {
  const T = 0;
  const { g, mine } = garrisoned(T, 4);
  const w = g.w;
  const u = w.units.col;
  atEastGate(g, T, 9);
  run(g, 3 * S);
  const walker = mine.find((id) => u.wallTo[slotOf(g, id)] >= 0 && u.wall[slotOf(g, id)] !== u.wallTo[slotOf(g, id)]);
  assert.ok(walker !== undefined, "one walking");
  const s = slotOf(g, walker);
  const foot = w.wallFoot[u.wall[s]];
  const town = w.map.towns[T];
  cmd(g, 0, { c: "move", u: [walker], x: town.cellX, y: town.cellY });
  run(g, 1);
  assert.equal(u.wall[s], -1, "down");
  assert.equal(u.wallTo[s], -1);
  assert.equal((u.y[s] >> CELL_SHIFT) * w.size + (u.x[s] >> CELL_SHIFT), foot, "at the foot of the cell it was on");
  assert.ok(!Array.from(w.wallAt).includes(walker), "no cell held for it");
});

test("same game twice, same hash; switched off they never move and the columns stay out of the hash", () => {
  const play = () => {
    const { g, mine } = garrisoned(0, 4);
    atEastGate(g, 0, 9);
    run(g, 30 * S);
    return { g, mine };
  };
  assert.equal(play().g.hash(), play().g.hash());
  switchedOff(WALL_SHIFT, () => {
    const { g, mine, homes } = garrisoned(0, 4);
    atEastGate(g, 0, 9);
    run(g, 30 * S);
    const u = g.w.units.col;
    mine.forEach((id, k) => assert.equal(u.wall[slotOf(g, id)], homes[k], "never moved"));
    const h = g.hash();
    u.wallHome[slotOf(g, mine[0])] = 5;
    u.wallWait[slotOf(g, mine[0])] = 7;
    assert.equal(g.hash(), h);
  })();
});

test("the wallshift scenario (the screen's recordings): they walk over, shoot the 9 spearmen dead and walk back", () => {
  const g = new Game({ seed: 1, scenario: "wallshift" });
  const w = g.w;
  const u = w.units.col;
  const mine: number[] = [];
  const homes: number[] = [];
  for (let s = 0; s < w.units.count; s++) {
    if (u.owner[s] === NEUTRAL && u.home[s] === 0) assert.fail("town 0's militia gone");
    if (u.owner[s] === 0 && u.type[s] === UnitType.Ranged) {
      mine.push(u.id[s]);
      homes.push(u.wall[s]);
    }
  }
  assert.equal(mine.length, 11);
  const foes = () => Array.from({ length: w.units.count }, (_, s) => s).filter((s) => u.owner[s] === 1 && u.type[s] === UnitType.Spearman).length;
  assert.equal(foes(), 9);
  run(g, 40 * S);
  assert.equal(foes(), 0, "shot dead");
  upThere(g, 0, mine);
  run(g, 30 * S);
  mine.forEach((id, k) => assert.equal(u.wall[slotOf(g, id)], homes[k], "home again"));
});

test("too many of them (more than WALL_SHIFT.odds times those on the walls): none walks; fewer, they do", () => {
  const T = 0;
  const run2 = (every: number) => {
    const { g, mine, homes } = garrisoned(T, every);
    atEastGate(g, T, 18);
    run(g, 20 * S);
    const u = g.w.units.col;
    return { moved: mine.filter((id, k) => u.wall[slotOf(g, id)] !== homes[k]).length, n: mine.length };
  };
  // Every 12th wall cell: 4 on the walls against 18 (those they see: more than twice as many).
  const few = run2(12);
  assert.ok(18 > WALL_SHIFT.odds * few.n, `${few.n} on the walls`);
  assert.equal(few.moved, 0, "nobody walked");
  // Every 4th: 11 against 18.
  const many = run2(4);
  assert.ok(many.moved >= 8, `${many.moved} of ${many.n} walked`);
});
