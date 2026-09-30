import assert from "node:assert/strict";
import { test } from "node:test";
import { damage } from "../src/core/units.ts";
import { CELL_SHIFT, GameOverReason, Order, Stance, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, openArea, put, run, slotOf } from "./helpers.ts";

test("multipliers: ranged deal 7 to spearmen (5 x 3/2), 5 to others; at least 1", () => {
  assert.equal(damage(5, UnitType.Ranged, UnitType.Spearman), 7);
  assert.equal(damage(5, UnitType.Ranged, UnitType.Ranged), 5);
  assert.equal(damage(6, UnitType.Spearman, UnitType.Ranged), 6);
  assert.equal(damage(0, UnitType.Farmer, UnitType.Farmer), 1);
});

test("a group moves at its slowest speed and forms up: melee in front, then ranged, then mages", () => {
  const g = emptyGame();
  const a = openArea(g, 24);
  const ids: number[] = [];
  for (let k = 0; k < 4; k++) ids.push(put(g, 0, UnitType.Mage, a.x + 2 + k, a.y + 2));
  for (let k = 0; k < 4; k++) ids.push(put(g, 0, UnitType.Ranged, a.x + 2 + k, a.y + 3));
  for (let k = 0; k < 4; k++) ids.push(put(g, 0, UnitType.Spearman, a.x + 2 + k, a.y + 4));
  cmd(g, 0, { c: "move", u: ids, x: a.x + 3, y: a.y + 20 });
  run(g, 1);
  const u = g.w.units.col;
  for (const id of ids) assert.equal(u.speedCap[slotOf(g, id)], 46, "group speed = mage speed");
  run(g, 600);
  for (const id of ids) assert.equal(u.order[slotOf(g, id)], Order.None, `unit ${id} arrived`);
  const meanY = (t: number) => {
    const ys = ids.filter((id) => u.type[slotOf(g, id)] === t).map((id) => u.y[slotOf(g, id)]);
    return ys.reduce((p, v) => p + v, 0) / ys.length;
  };
  // Moving toward +y: the front is the largest y.
  assert.ok(meanY(UnitType.Spearman) > meanY(UnitType.Ranged), "spearmen ahead of ranged");
  assert.ok(meanY(UnitType.Ranged) > meanY(UnitType.Mage), "ranged ahead of mages");
});

test("retreat ignores enemies; attack-move fights them", () => {
  for (const kind of ["retreat", "move"] as const) {
    const g = emptyGame();
    const a = openArea(g, 24);
    const mine = put(g, 0, UnitType.Spearman, a.x + 2, a.y + 10);
    const enemy = put(g, 1, UnitType.Farmer, a.x + 8, a.y + 10);
    g.w.units.col.stance[slotOf(g, enemy)] = Stance.Hold;
    g.w.ecoOn[1] = 0; // keep the target farmer standing still
    g.fog.update(g.w);
    cmd(g, 0, { c: kind, u: [mine], x: a.x + 20, y: a.y + 10 });
    run(g, 300);
    const enemyHurt = slotOf(g, enemy) < 0 || g.w.units.col.hp[slotOf(g, enemy)] < 25;
    assert.equal(enemyHurt, kind === "move", kind);
  }
});

test("hold stance stays put; aggressive idle units chase but give up past the leash", () => {
  const g = emptyGame();
  const a = openArea(g, 24);
  const holder = put(g, 0, UnitType.Spearman, a.x + 4, a.y + 4);
  const chaser = put(g, 0, UnitType.Spearman, a.x + 4, a.y + 14);
  cmd(g, 0, { c: "stance", u: [holder], stance: Stance.Hold });
  const bait1 = put(g, 1, UnitType.Ranged, a.x + 8, a.y + 4);
  const bait2 = put(g, 1, UnitType.Ranged, a.x + 8, a.y + 14);
  const u = g.w.units.col;
  for (const b of [bait1, bait2]) u.stance[slotOf(g, b)] = Stance.Hold;
  g.fog.update(g.w);
  const x0 = u.x[slotOf(g, holder)];
  run(g, 60);
  assert.equal(u.x[slotOf(g, holder)], x0, "holder did not move");
  assert.ok(u.x[slotOf(g, chaser)] > (a.x + 4) << CELL_SHIFT, "chaser moved toward the bait");
  // Move the bait far away (and its post, or it would walk back): the chaser returns.
  u.x[slotOf(g, bait2)] = (a.x + 22) << CELL_SHIFT;
  u.anchorX[slotOf(g, bait2)] = (a.x + 22) << CELL_SHIFT;
  run(g, 200);
  const dx = u.x[slotOf(g, chaser)] - (((a.x + 4) << CELL_SHIFT) + 512);
  assert.ok(Math.abs(dx) < 2 << CELL_SHIFT, `chaser back near its post (dx ${dx})`);
});

test("main city arrows hit intruders; destroying a main city ends the game", () => {
  const g = emptyGame();
  const w = g.w;
  const s1 = w.map.spawns[1];
  const intruder = put(g, 0, UnitType.Spearman, s1.cellX - 5, s1.cellY + 3);
  g.fog.update(w);
  run(g, 45);
  assert.ok(slotOf(g, intruder) < 0 || w.units.col.hp[slotOf(g, intruder)] < 60, "arrow hit");
  const main1 = w.mainCity(1);
  w.buildings.col.hp[main1] = 1;
  const attacker = put(g, 0, UnitType.Spearman, s1.cellX + 3, s1.cellY);
  g.fog.update(w);
  cmd(g, 0, { c: "attack", u: [attacker], target: w.buildings.col.id[main1] });
  run(g, 100);
  assert.equal(w.winner, 0);
  assert.equal(w.endReason, GameOverReason.MainCityDestroyed);
});
