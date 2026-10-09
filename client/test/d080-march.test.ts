// D-080 (user 2026-10-09: 「點攻擊或是撤退時所有的部隊都要聚集過去，就算有一部分已經到了，後面那些
// 還沒到的也要聚集過來」) on the real simulation: a group spread out, ordered as the screen orders it.
// A move (進攻 on the ground) and a retreat take every unit there by themselves; an attack on an
// enemy ends when the first to arrive kill it, and those on the way stop where they are, so the
// screen sends them on (follow.ts, 進攻到底), as it does here every tick.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Game } from "../../sim/src/core/game.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "../../sim/test/helpers.ts";
import { Charges } from "../src/game/follow.ts";
import { BuildingType, CELL, Order, rules, UnitType } from "../src/sim.ts";

const cellOf = (g: Game, id: number) => {
  const s = slotOf(g, id);
  return { x: g.w.units.col.x[s] / CELL, y: g.w.units.col.y[s] / CELL, order: g.w.units.col.order[s], alive: s >= 0 && g.w.units.col.hp[s] > 0 };
};
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

/** The walkable cell nearest (x, y). */
function walkableNear(g: Game, x: number, y: number): { x: number; y: number } {
  for (let r = 0; r < 20; r++) {
    for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (xx >= 0 && yy >= 0 && xx < g.w.size && yy < g.w.size && g.w.walkable(xx, yy)) return { x: xx, y: yy };
  }
  throw new Error(`nothing walkable near (${x}, ${y})`);
}

/** Four spearmen together, three 25 cells away (as a group's members spread over the map). */
function spread(g: Game) {
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  const a = openArea(g, 12);
  const near = [0, 1, 2, 3].map((k) => put(g, 0, UnitType.Spearman, a.x + 2 + k, a.y + 2));
  const back = walkableNear(g, a.x + 2, Math.min(g.w.size - 3, a.y + 27) > a.y + 20 ? a.y + 27 : a.y - 23);
  const far = [0, 1, 2].map((k) => {
    const c = walkableNear(g, back.x + k, back.y);
    return put(g, 0, UnitType.Spearman, c.x, c.y);
  });
  return { a, near, far, all: [...near, ...far] };
}

test("進攻點地面：散得很開的軍團，每一名都走到", () => {
  const g = emptyGame();
  const { a, all } = spread(g);
  const target = walkableNear(g, a.x + 9, a.y + 9);
  cmd(g, 0, { c: "move", u: all, x: target.x, y: target.y });
  run(g, 1500);
  for (const id of all) {
    const c = cellOf(g, id);
    assert.ok(dist(c, target) < 6, `unit ${id} at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}), order ${c.order}`);
  }
});

test("撤退：散得很開的軍團，每一名都走到", () => {
  const g = emptyGame();
  const { a, all } = spread(g);
  const target = walkableNear(g, a.x + 9, a.y + 9);
  cmd(g, 0, { c: "retreat", u: all, x: target.x, y: target.y });
  run(g, 1500);
  for (const id of all) {
    const c = cellOf(g, id);
    assert.ok(dist(c, target) < 6, `unit ${id} at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}), order ${c.order}`);
  }
});

/** Where a unit or building is (cells), null once it is gone: what the screen reads from the snapshot. */
function whereIs(g: Game, id: number): { x: number; y: number } | null {
  const s = g.w.unit(id);
  if (s >= 0) return g.w.units.col.hp[s] > 0 ? { x: g.w.units.col.x[s] / CELL, y: g.w.units.col.y[s] / CELL } : null;
  const b = g.w.building(id);
  if (b < 0 || g.w.buildings.col.hp[b] <= 0) return null;
  const size = rules().buildings[g.w.buildings.col.type[b]]?.size ?? 1;
  return { x: g.w.buildings.col.cellX[b] + size / 2, y: g.w.buildings.col.cellY[b] + size / 2 };
}

/** 進攻 on an enemy as the screen gives it: the attack, and with `follow` the screen's 進攻到底 every tick. */
function attackAsScreen(g: Game, ids: number[], target: number, follow: boolean): void {
  const charges = new Charges();
  cmd(g, 0, { c: "attack", u: ids, target });
  charges.start(ids, target, whereIs(g, target), g.tick);
  for (let t = 0; t < 1500 && !g.w.over; t++) {
    g.step();
    if (!follow) continue;
    const unit = (id: number) => {
      const s = g.w.unit(id);
      return s < 0 || g.w.units.col.hp[s] <= 0 ? null : { x: g.w.units.col.x[s] / CELL, y: g.w.units.col.y[s] / CELL, attacking: g.w.units.col.order[s] === Order.Attack };
    };
    for (const o of charges.update(g.tick, unit, (id) => whereIs(g, id))) cmd(g, 0, { c: "move", u: o.ids, x: o.x, y: o.y });
  }
}

/** A weak enemy spearman by the near ones, which they kill before the far ones get there. */
function weakEnemy(g: Game, a: { x: number; y: number }): { id: number; at: { x: number; y: number } } {
  const id = put(g, 1, UnitType.Spearman, a.x + 8, a.y + 2);
  g.w.units.col.hp[slotOf(g, id)] = 5;
  return { id, at: { x: a.x + 8.5, y: a.y + 2.5 } };
}

test("原因：只靠模擬，進攻點敵人時，前面的人把敵人打死，攻擊就結束，後面還沒到的停在原地", () => {
  const g = emptyGame();
  const { a, far, all } = spread(g);
  const enemy = weakEnemy(g, a);
  attackAsScreen(g, all, enemy.id, false);
  assert.equal(cellOf(g, enemy.id).alive, false, "the enemy fell");
  assert.ok(
    far.some((id) => dist(cellOf(g, id), enemy.at) > 15),
    "if this fails, the simulation now keeps them going by itself and 進攻到底 (follow.ts) may go",
  );
});

test("進攻點敵人：前面的人把敵人打死以後，後面還沒到的也走到（進攻到底）", () => {
  const g = emptyGame();
  const { a, near, far, all } = spread(g);
  const enemy = weakEnemy(g, a);
  attackAsScreen(g, all, enemy.id, true);
  assert.equal(cellOf(g, enemy.id).alive, false, "the enemy fell");
  for (const id of near) assert.ok(dist(cellOf(g, id), enemy.at) < 6, `near ${id}`);
  for (const id of far) {
    const c = cellOf(g, id);
    assert.ok(dist(c, enemy.at) < 6, `far unit ${id} stopped at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}), ${dist(c, enemy.at).toFixed(1)} cells from the fight, order ${c.order}`);
  }
});

test("進攻點敵方建築：前面的人拆掉以後，後面還沒到的也走到（進攻到底）", () => {
  const g = emptyGame();
  const { a, far, all } = spread(g);
  const spot = walkableNear(g, a.x + 8, a.y + 4);
  const house = g.w.buildings.col.id[g.w.building(g.w.addBuilding(1, BuildingType.House, spot.x, spot.y, 20, 1000))];
  const at = whereIs(g, house) as { x: number; y: number };
  attackAsScreen(g, all, house, true);
  assert.equal(whereIs(g, house), null, "the house fell");
  for (const id of far) {
    const c = cellOf(g, id);
    assert.ok(dist(c, at) < 7, `far unit ${id} stopped at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}), ${dist(c, at).toFixed(1)} cells from the house`);
  }
});

test("進攻點地面：後面的人路上遇到敵人，打完照樣走到", () => {
  const g = emptyGame();
  const { a, far, all } = spread(g);
  const target = walkableNear(g, a.x + 9, a.y + 9);
  const f = cellOf(g, far[0]);
  const on = walkableNear(g, Math.round(f.x + (target.x - f.x) * 0.3), Math.round(f.y + (target.y - f.y) * 0.3));
  const enemy = put(g, 1, UnitType.Spearman, on.x, on.y);
  g.w.units.col.hp[slotOf(g, enemy)] = 5;
  cmd(g, 0, { c: "move", u: all, x: target.x, y: target.y });
  run(g, 1500);
  assert.equal(cellOf(g, enemy).alive, false, "the enemy on the way fell");
  for (const id of all) {
    const c = cellOf(g, id);
    assert.ok(dist(c, target) < 6, `unit ${id} at (${c.x.toFixed(1)}, ${c.y.toFixed(1)}), order ${c.order}`);
  }
});
