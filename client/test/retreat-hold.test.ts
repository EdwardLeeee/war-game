// 撤到就堅守 (D-061: 「撤到之後兵自己回頭打」) needs no change in the simulation: the interface
// sends 堅守 with every retreat (Game.command). Here the simulation itself runs what the
// interface sends: a spearman retreats with 堅守, an enemy stands still `gap` cells beyond the
// spot. Once there it hits what is in reach and chases nothing. Without 堅守 (as before) it
// chases: the control.

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../../sim/src/core/game.ts";
import { UNITS } from "../../sim/src/core/rules.ts";
import { Action, CELL_SHIFT, Order, Stance, UnitType } from "../src/sim.ts";

function retreatNear(gap: number, hold: boolean): { arrived: boolean; chased: number; hit: boolean } {
  const g = new Game({ seed: 1, scenario: "e2e" });
  const w = g.w;
  const u = w.units.col;
  const at = (x: number, y: number) => [(x << CELL_SHIFT) + 512, (y << CELL_SHIFT) + 512] as const;
  const me = w.addUnit(0, UnitType.Spearman, ...at(26, 40), UNITS[UnitType.Spearman].hp);
  const foe = w.addUnit(1, UnitType.Spearman, ...at(20 + gap, 50), UNITS[UnitType.Spearman].hp);
  g.fog.update(w);
  let seq = 0;
  const cmd = (p: number, body: Record<string, unknown>) => g.push({ t: g.tick, p, seq: seq++, ...body } as never);
  cmd(1, { c: "stance", u: [foe], stance: Stance.Hold });
  // What the interface sends for 撤退 (Game.command).
  cmd(0, { c: "retreat", u: [me], x: 20, y: 50 });
  if (hold) cmd(0, { c: "stance", u: [me], stance: Stance.Hold });
  let arrived = false;
  let ax = 0;
  let ay = 0;
  let chased = 0;
  let hit = false;
  for (let t = 0; t < 1200; t++) {
    g.step();
    const s = w.unit(me);
    if (s < 0) break;
    if (!arrived && u.order[s] === Order.None) {
      arrived = true;
      ax = u.x[s];
      ay = u.y[s];
    }
    if (!arrived) continue;
    if (u.action[s] === Action.Attack) hit = true;
    chased = Math.max(chased, Math.hypot(u.x[s] - ax, u.y[s] - ay) / 1024);
  }
  return { arrived, chased, hit };
}

test("撤到就堅守：撤退時一起送堅守，到了以後射程外 3 格、5 格的敵人不追", () => {
  for (const gap of [3, 5]) {
    const r = retreatNear(gap, true);
    assert.equal(r.arrived, true, `gap ${gap}`);
    assert.equal(r.chased, 0, `gap ${gap}: did not move from where it arrived`);
    assert.equal(r.hit, false, `gap ${gap}: out of reach, left alone`);
  }
});

test("撤到就堅守：貼在旁邊（射程內）的敵人照打", () => {
  const r = retreatNear(1, true);
  assert.equal(r.arrived, true);
  assert.equal(r.hit, true);
});

test("對照：沒送堅守（積極）時，撤到以後會去追 3 格、5 格外的敵人（這就是使用者說的回頭打）", () => {
  for (const gap of [3, 5]) {
    const r = retreatNear(gap, false);
    assert.equal(r.arrived, true, `gap ${gap}`);
    assert.ok(r.chased > 1, `gap ${gap}: chased ${r.chased.toFixed(2)} cells`);
    assert.equal(r.hit, true, `gap ${gap}`);
  }
});
