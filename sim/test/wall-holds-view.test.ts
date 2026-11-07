// R14-07: the snapshot's wallHolds, the viewer's wall soldiers that stay instead of shifting along the walls, and why
// (the screen's list's 3, too many enemies; 5, the way there cut by broken gates; PROTOCOL.md 4.7). For the screen only:
// the game plays and hashes the same without them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { RETARGET_EVERY, WALL_SHIFT } from "../src/core/rules.ts";
import { keepOf } from "../src/core/scenarios.ts";
import { onWall, WALL_HOLD_MARKS } from "../src/core/units.ts";
import { Action, CELL_SHIFT, Order, Stance, TownState, UnitType, WALL_HOLD_STRIDE, WallHold, WallHoldField } from "../src/protocol.ts";
import { buildView, SnapshotEncoder } from "../src/view/view.ts";
import { cmd, emptyGame, put, run, slotOf } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;
const S = 20;
const T = 0;

/** Player 0 governs town T (its keep too), a ranged unit on every `every`-th wall cell (the castle's order). */
function garrisoned(every: number): { g: G; mine: number[] } {
  const g = emptyGame();
  const w = g.w;
  w.townState[T] = TownState.Governed;
  w.townOwner[T] = 0;
  const keep = keepOf(w, T);
  if (keep >= 0) w.buildings.col.owner[keep] = 0;
  w.refreshGates(T);
  const n = w.size;
  const u = w.units.col;
  const mine: number[] = [];
  Array.from(w.wallCells[T]).forEach((c, k) => {
    if (k % every !== 0) return;
    const id = put(g, 0, UnitType.Ranged, c % n, Math.trunc(c / n));
    const s = slotOf(g, id);
    u.wall[s] = c;
    w.wallAt[c] = id;
    u.order[s] = Order.Wall;
    u.orderTarget[s] = T;
    u.action[s] = Action.OnWall;
    mine.push(id);
  });
  g.fog.update(w);
  return { g, mine };
}

/** `count` of player 1's spearmen, holding, that do not die, from 2 cells out of town T's east wall, `dy` rows from its middle on. */
function outEast(g: G, count: number, dy = -2): number[] {
  const w = g.w;
  const town = w.map.towns[T];
  const ex = town.cellX + w.castles[T].inside.x1 + 1;
  const ids: number[] = [];
  for (let k = 0; k < count; k++) {
    const id = put(g, 1, UnitType.Spearman, ex + 2 + (k % 3), town.cellY + dy + Math.trunc(k / 3));
    w.units.col.hp[slotOf(g, id)] = 1_000_000;
    ids.push(id);
  }
  cmd(g, 1, { c: "stance", u: ids, stance: Stance.Hold });
  g.fog.update(w);
  return ids;
}

/** Town T's north and south gates broken: the walls cut in two, east and west. */
function cutInTwo(g: G): void {
  const w = g.w;
  const n = w.size;
  const town = w.map.towns[T];
  const box = w.castles[T].inside;
  for (const c of [(town.cellY + box.y0 - 1) * n + town.cellX, (town.cellY + box.y1 + 1) * n + town.cellX]) w.buildings.col.hp[w.building(w.buildingAt[c])] = 0;
  run(g, 1);
}

/** The east wall and the east halves of the north and south walls: in reach of those out of the east gate. */
const EAST_END = new Set([2, 3, 4, 5, 8]);

const rowsOf = (a: Int32Array | undefined) => {
  const out: number[][] = [];
  for (let o = 0; a !== undefined && o < a.length; o += WALL_HOLD_STRIDE) out.push(Array.from(a.subarray(o, o + WALL_HOLD_STRIDE)));
  return out;
};
const held = (g: G) => {
  const u = g.w.units.col;
  return Array.from({ length: g.w.units.count }, (_, s) => s).filter((s) => u.wallHold[s] !== 0);
};

test("too many enemies (3): those with nothing to shoot stay, one row each from and to; foes and mine as the rule weighed them", () => {
  // Every 12th wall cell: 4 on the walls against 18.
  const { g, mine } = garrisoned(12);
  const w = g.w;
  const u = w.units.col;
  const foes = outEast(g, 18);
  run(g, WALL_SHIFT.wait - RETARGET_EVERY);
  assert.deepEqual(rowsOf(buildView(g, 0).wallHolds), [], "not before they would set off");
  run(g, 2 * S);
  const rows = rowsOf(buildView(g, 0).wallHolds);
  assert.ok(rows.length > 0, "some stay");
  const staying = held(g);
  const vis = g.fog.visible[0];
  const seen = foes.filter((id) => {
    const s = slotOf(g, id);
    return vis[(u.y[s] >> CELL_SHIFT) * w.size + (u.x[s] >> CELL_SHIFT)] === 1;
  }).length;
  assert.ok(seen > 0 && seen < 18, `${seen} seen`);
  assert.equal(rows.reduce((a, r) => a + r[WallHoldField.n], 0), staying.length, "every one staying in one row");
  for (const r of rows) {
    assert.equal(r[WallHoldField.town], T);
    assert.equal(r[WallHoldField.owner], 0);
    assert.equal(r[WallHoldField.kind], WallHold.Outnumbered);
    assert.ok(EAST_END.has(r[WallHoldField.to]), `would go to the east end: ${r[WallHoldField.to]}`);
    assert.ok(!EAST_END.has(r[WallHoldField.from]), `stands away from it: ${r[WallHoldField.from]}`);
    assert.equal(r[WallHoldField.gates], 0);
    assert.equal(r[WallHoldField.foes], seen, "the enemies player 0 sees");
    assert.equal(r[WallHoldField.mine], mine.length);
    assert.ok(r[WallHoldField.foes] > WALL_SHIFT.odds * r[WallHoldField.mine]);
    assert.ok(r[WallHoldField.since] >= WALL_SHIFT.wait - RETARGET_EVERY && r[WallHoldField.since] <= w.tick, `since ${r[WallHoldField.since]}`);
  }
  assert.ok(staying.every((s) => u.wallTo[s] < 0 && onWall(w, s)), "standing where they stood");
  assert.deepEqual(rowsOf(buildView(g, 1).wallHolds), [], "the enemy gets none");
  assert.deepEqual(rowsOf(buildView(g, null).wallHolds), rows, "a spectator gets them");
  const snap = new SnapshotEncoder(w.nodeAmount.length).encode(buildView(g, 0), []);
  assert.deepEqual(rowsOf(snap.wallHolds), rows, "the snapshot carries them");
});

test("3 lasts while the siege does (ceo 2026-11-06): not one stretch and then the other at each look, though the enemies mill about", () => {
  // 7 on the walls; 9 off the north wall's west half and 9 off the south wall's middle, all stepping a cell along the
  // walls and back each second: about as far for some on the walls, the nearest free cell in reach goes from one to the
  // other (without keeping the stretch, every second).
  const { g } = garrisoned(8);
  const w = g.w;
  const u = w.units.col;
  const town = w.map.towns[T];
  const box = w.castles[T].inside;
  const all: number[] = [];
  for (const [dx, y0, dy] of [[-6, box.y0 - 3, -1], [0, box.y1 + 3, 1]]) {
    for (let k = 0; k < 9; k++) {
      const id = put(g, 1, UnitType.Spearman, town.cellX + dx + Math.trunc(k / 3), town.cellY + y0 + dy * (k % 3));
      u.hp[slotOf(g, id)] = 1_000_000;
      all.push(id);
    }
  }
  cmd(g, 1, { c: "stance", u: all, stance: Stance.Hold });
  g.fog.update(w);
  run(g, 2 * S);
  const first = new Map(held(g).map((s) => [u.id[s], [u.wallHoldTo[s], u.wallHoldSince[s]]]));
  assert.ok(first.size >= 2, `${first.size} stay`);
  const keys = (rows: number[][]) => rows.map((r) => [r[WallHoldField.from], r[WallHoldField.to], r[WallHoldField.n], r[WallHoldField.since]].join(",")).sort().join(" ");
  const want = keys(rowsOf(buildView(g, 0).wallHolds));
  for (let k = 0; k < 20; k++) {
    for (const id of all) {
      const s = slotOf(g, id);
      cmd(g, 1, { c: "move", u: [id], x: (u.x[s] >> CELL_SHIFT) + (k % 2 === 0 ? 1 : -1), y: u.y[s] >> CELL_SHIFT });
    }
    for (let t = 0; t < S; t++) {
      run(g, 1);
      assert.equal(held(g).length, first.size, `all still stay (tick ${w.tick})`);
      for (const s of held(g)) {
        const had = first.get(u.id[s]);
        assert.ok(had !== undefined, `unit ${u.id[s]} stayed from the start`);
        assert.equal(u.wallHoldTo[s], had[0], `unit ${u.id[s]} would still go to the same cell (tick ${w.tick})`);
        assert.equal(u.wallHoldSince[s], had[1]);
      }
      assert.equal(keys(rowsOf(buildView(g, 0).wallHolds)), want, `same rows (tick ${w.tick})`);
    }
  }
});

test("3 ends when it no longer holds: fewer enemies, they set off; none near, nothing left", () => {
  const { g } = garrisoned(12);
  const u = g.w.units.col;
  const foes = outEast(g, 18);
  run(g, 3 * S);
  assert.ok(held(g).length > 0);
  // 6 left against 4: no more than twice as many.
  for (const f of foes.slice(6)) u.hp[slotOf(g, f)] = 0;
  run(g, RETARGET_EVERY + 1);
  assert.deepEqual(rowsOf(buildView(g, 0).wallHolds), [], "gone at their next look");
  assert.ok(rowsOf(buildView(g, 0).wallShifts).length > 0, "they set off");
  for (const f of foes.slice(0, 6)) u.hp[slotOf(g, f)] = 0;
  run(g, 4 * S);
  assert.deepEqual(rowsOf(buildView(g, 0).wallHolds), [], "calm: none");
});

test("the way cut by broken gates (5): the west wall's stay, the gate on their way in gates; one gate broken they go round, no 5", () => {
  const { g } = garrisoned(4);
  const w = g.w;
  const u = w.units.col;
  const n = w.size;
  const town = w.map.towns[T];
  cutInTwo(g);
  outEast(g, 9);
  run(g, 3 * S);
  const rows = rowsOf(buildView(g, 0).wallHolds);
  assert.ok(rows.length > 0, "some stay");
  for (const r of rows) {
    assert.equal(r[WallHoldField.kind], WallHold.GateDown);
    assert.ok(EAST_END.has(r[WallHoldField.to]), `would go to the east end: ${r[WallHoldField.to]}`);
    // The north gate (1) for those on the north wall's west half, the south (4) for the south's; the west wall's either.
    assert.ok(r[WallHoldField.gates] === 1 || r[WallHoldField.gates] === 4, `gates ${r[WallHoldField.gates]}`);
    const side = Math.trunc(r[WallHoldField.from] / 3);
    if (r[WallHoldField.from] === 1) assert.equal(r[WallHoldField.gates], 1);
    if (r[WallHoldField.from] === 7) assert.equal(r[WallHoldField.gates], 4);
    assert.ok(side === 3 || r[WallHoldField.from] === 1 || r[WallHoldField.from] === 7, `from the west: ${r[WallHoldField.from]}`);
    assert.ok(r[WallHoldField.foes] <= WALL_SHIFT.odds * r[WallHoldField.mine], "not too many");
  }
  for (const s of held(g)) assert.ok(u.wall[s] % n < town.cellX, "west of the broken gates");
  // One gate broken: round the other way.
  const one = garrisoned(4);
  const b = one.g.w.buildings.col;
  const box = one.g.w.castles[T].inside;
  b.hp[one.g.w.building(one.g.w.buildingAt[(town.cellY + box.y0 - 1) * n + town.cellX])] = 0;
  run(one.g, 1);
  outEast(one.g, 9);
  for (let k = 0; k < 10 * S; k++) {
    run(one.g, 1);
    assert.deepEqual(rowsOf(buildView(one.g, 0).wallHolds), [], `none at tick ${one.g.w.tick}`);
  }
  assert.ok(rowsOf(buildView(one.g, 0).wallShifts).some((r) => r[5] === 4), "some go over the south gate");
});

test("its way cut under a walker (5 at once): it stops on the free wall cell it is on and stays there, why kept", () => {
  const { g } = garrisoned(4);
  const w = g.w;
  const u = w.units.col;
  outEast(g, 9);
  // Off they go; cut while some walk the north and south walls' west halves.
  run(g, WALL_SHIFT.wait + RETARGET_EVERY + 1);
  const walking = Array.from({ length: w.units.count }, (_, s) => s).filter((s) => u.wallTo[s] >= 0 && u.owner[s] === 0);
  assert.ok(walking.length > 0, "some walk");
  cutInTwo(g);
  run(g, 1);
  const stopped = walking.filter((s) => u.wallHold[s] === WallHold.GateDown);
  assert.ok(stopped.length > 0, "some stopped with 5 at once");
  for (const s of stopped) assert.equal(u.action[s], Action.OnWall);
});

test("for the screen only: the columns out of the hash, and the game plays the same without them", () => {
  const play = (marks: boolean) => {
    WALL_HOLD_MARKS.on = marks;
    try {
      const hashes: string[] = [];
      for (const every of [12, 4]) {
        const { g } = garrisoned(every);
        const foes = outEast(g, 18);
        run(g, 4 * S);
        hashes.push(g.hash().toString());
        if (every === 4) cutInTwo(g);
        for (const f of foes.slice(8)) g.w.units.col.hp[slotOf(g, f)] = 0;
        run(g, 10 * S);
        hashes.push(g.hash().toString());
      }
      return hashes;
    } finally {
      WALL_HOLD_MARKS.on = true;
    }
  };
  assert.deepEqual(play(true), play(false));
  const { g } = garrisoned(12);
  outEast(g, 18);
  run(g, 3 * S);
  assert.ok(held(g).length > 0);
  const h = g.hash();
  const u = g.w.units.col;
  for (let s = 0; s < g.w.units.count; s++) {
    u.wallHold[s] += 1;
    u.wallHoldTo[s] += 2;
    u.wallHoldSince[s] += 3;
    u.wallHoldFoes[s] += 4;
    u.wallHoldMine[s] += 5;
  }
  assert.equal(g.hash(), h);
});
