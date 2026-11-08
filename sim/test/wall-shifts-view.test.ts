// R14-07: the snapshot's wallShifts, the viewer's soldiers walking along town walls (PROTOCOL.md 4.7).

import assert from "node:assert/strict";
import { test } from "node:test";
import { wallStretch } from "../src/core/wall-walk.ts";
import { keepOf } from "../src/core/scenarios.ts";
import { Action, CELL_SHIFT, Order, Stance, TownState, UNIT_STRIDE, UnitField, UnitType, WALL_SHIFT_STRIDE, WallShiftField } from "../src/protocol.ts";
import { buildView, SnapshotEncoder } from "../src/view/view.ts";
import { cmd, emptyGame, put, run, slotOf } from "./helpers.ts";

const S = 20;
const T = 0;

/** Player 0 governs town 0 (its keep too), a ranged unit on every 4th wall cell; 9 of player 1's spearmen hold out of its east gate. */
function attacked() {
  const g = emptyGame();
  const w = g.w;
  w.townState[T] = TownState.Governed;
  w.townOwner[T] = 0;
  const keep = keepOf(w, T);
  if (keep >= 0) w.buildings.col.owner[keep] = 0;
  w.refreshGates(T);
  const n = w.size;
  const u = w.units.col;
  Array.from(w.wallCells[T]).forEach((c, k) => {
    if (k % 4 !== 0) return;
    const s = slotOf(g, put(g, 0, UnitType.Ranged, c % n, Math.trunc(c / n)));
    u.wall[s] = c;
    w.wallAt[c] = u.id[s];
    u.order[s] = Order.Wall;
    u.orderTarget[s] = T;
    u.action[s] = Action.OnWall;
  });
  const t = w.map.towns[T];
  const ex = t.cellX + w.castles[T].inside.x1 + 1;
  const foes: number[] = [];
  for (let k = 0; k < 9; k++) {
    const id = put(g, 1, UnitType.Spearman, ex + 2 + (k % 3), t.cellY - 2 + Math.trunc(k / 3));
    u.hp[slotOf(g, id)] = 1_000_000;
    foes.push(id);
  }
  cmd(g, 1, { c: "stance", u: foes, stance: Stance.Hold });
  g.fog.update(w);
  return { g, foes };
}

/** The east wall and the east halves of the north and south walls: in reach of those out of the east gate. */
const EAST_END = new Set([2, 3, 4, 5, 8]);

const rowsOf = (a: Int32Array | undefined) => {
  const out: number[][] = [];
  for (let o = 0; a !== undefined && o < a.length; o += WALL_SHIFT_STRIDE) out.push(Array.from(a.subarray(o, o + WALL_SHIFT_STRIDE)));
  return out;
};

test("stretch codes: side * 3 + part by map cells; the east gate's top 3, the east wall's south half 5", () => {
  const g = emptyGame();
  const w = g.w;
  const n = w.size;
  const t = w.map.towns[T];
  const box = w.castles[T].inside;
  const at = (dx: number, dy: number) => wallStretch(w, (t.cellY + dy) * n + t.cellX + dx);
  const e = box.x1 + 1;
  const north = box.y0 - 1;
  assert.equal(at(e, 0), 3, "east gate top");
  assert.equal(at(e, 3), 5, "east wall, south half");
  assert.equal(at(e, -3), 4, "east wall, north half");
  assert.equal(at(-3, north), 1, "north wall, west half");
  assert.equal(at(0, north), 0, "north gate top");
  assert.equal(at(e, north), 2, "a corner goes with the north wall");
  assert.equal(at(0, 0), -1, "not on the walls");
});

test("the viewer's soldiers walking: grouped by from, to, via and home; the enemy gets none; foes only as the viewer sees them", () => {
  const { g } = attacked();
  const w = g.w;
  run(g, 4 * S);
  const mine = rowsOf(buildView(g, 0).wallShifts);
  assert.ok(mine.length > 0, "some walk");
  const walking = Array.from({ length: w.units.count }, (_, s) => s).filter((s) => w.units.col.owner[s] === 0 && w.units.col.action[s] === Action.Move);
  assert.equal(mine.reduce((a, r) => a + r[WallShiftField.n], 0), walking.length, "every walker in one row");
  for (const r of mine) {
    assert.equal(r[WallShiftField.town], T);
    assert.equal(r[WallShiftField.owner], 0);
    assert.ok(EAST_END.has(r[WallShiftField.to]), `to the east end: ${r[WallShiftField.to]}`);
    assert.equal(r[WallShiftField.home], 0, "to fight");
    assert.ok(r[WallShiftField.foes] > 0 && r[WallShiftField.foes] <= 9, `foes ${r[WallShiftField.foes]}`);
  }
  assert.ok(mine.some((r) => r[WallShiftField.via] !== 0), "some go over a gate's top");
  assert.ok(mine.some((r) => Math.trunc(r[WallShiftField.from] / 3) === 3), "some from the west wall");
  assert.deepEqual(rowsOf(buildView(g, 1).wallShifts), [], "the enemy sees none of it");
  assert.ok(rowsOf(buildView(g, null).wallShifts).length > 0, "a spectator does");
  // Foes the viewer does not see do not count.
  const vis = g.fog.visible[0];
  vis.fill(0);
  assert.ok(rowsOf(buildView(g, 0).wallShifts).every((r) => r[WallShiftField.foes] === 0));
});

test("foes (ceo 2026-11-06): the enemies the viewer sees within 8 cells of the `to` stretch, as many as its units in view there", () => {
  const { g } = attacked();
  const w = g.w;
  const n = w.size;
  run(g, 4 * S);
  const view = buildView(g, 0);
  const rows = rowsOf(view.wallShifts);
  assert.ok(rows.length > 0, "some walk");
  // The enemy units in the viewer's own unit rows (those it sees), by cell.
  const seen: [number, number][] = [];
  for (let o = 0; o < view.units.length; o += UNIT_STRIDE) {
    if (view.units[o + UnitField.owner] !== 1) continue;
    seen.push([view.units[o + UnitField.x] >> CELL_SHIFT, view.units[o + UnitField.y] >> CELL_SHIFT]);
  }
  assert.ok(seen.length > 0, "the viewer sees spearmen out of the east gate");
  for (const r of rows) {
    const cells = Array.from(w.walkCells[T]).filter((c) => wallStretch(w, c) === r[WallShiftField.to]);
    const x0 = Math.min(...cells.map((c) => c % n)) - 8;
    const x1 = Math.max(...cells.map((c) => c % n)) + 8;
    const y0 = Math.min(...cells.map((c) => Math.trunc(c / n))) - 8;
    const y1 = Math.max(...cells.map((c) => Math.trunc(c / n))) + 8;
    const near = seen.filter(([x, y]) => x >= x0 && x <= x1 && y >= y0 && y <= y1).length;
    assert.ok(near > 0, `stretch ${r[WallShiftField.to]}: spearmen in sight within 8 cells`);
    assert.equal(r[WallShiftField.foes], near, `stretch ${r[WallShiftField.to]}`);
  }
});

test("walking home: home 1, from where the walk set off; the snapshot carries the rows", () => {
  const { g, foes } = attacked();
  const w = g.w;
  run(g, 25 * S);
  for (const f of foes) w.units.col.hp[slotOf(g, f)] = 0;
  run(g, 14 * S);
  const rows = rowsOf(buildView(g, 0).wallShifts);
  assert.ok(rows.length > 0 && rows.every((r) => r[WallShiftField.home] === 1 && r[WallShiftField.foes] === 0), JSON.stringify(rows));
  assert.ok(rows.every((r) => EAST_END.has(r[WallShiftField.from])), "set off from the east end");
  const snap = new SnapshotEncoder(w.nodeAmount.length).encode(buildView(g, 0), []);
  assert.deepEqual(rowsOf(snap.wallShifts), rows);
});

test("wallFrom is for the screen only: not in the hash", () => {
  const { g } = attacked();
  run(g, 4 * S);
  const h = g.hash();
  const u = g.w.units.col;
  for (let s = 0; s < g.w.units.count; s++) u.wallFrom[s] += 7;
  assert.equal(g.hash(), h);
});
