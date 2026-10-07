// Round 7 PR T (D-061; core/towns.ts, core/rules.ts TOWN_ONCE, GOVERN_INCOME, PLUNDER_RECOVERY):
// a town can be plundered once a game; governing pays about a plunder in 4 minutes; a plundered
// town governed again pays a quarter at first and all of it after 10 minutes of governing.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Game } from "../src/core/game.ts";
import { governPerMinute, MAIN_CRYSTAL, PLUNDER_RECOVERY, TOWN_ONCE, TOWNS } from "../src/core/rules.ts";
import { NEUTRAL, Reject, Resource, TOWN_STRIDE, TownChoice, TownField, TownFlag, TownSize, TownState, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, put, run, slotOf } from "./helpers.ts";

const T = 0;
const SMALL = TOWNS[TownSize.Small];

/** Runs `body` with switches set, the main city's crystal off (only the town pays). */
function withRules(on: { once: boolean; recovery: boolean }, body: () => void): () => void {
  return () => {
    const saved = [TOWN_ONCE.on, PLUNDER_RECOVERY.on, MAIN_CRYSTAL.every] as const;
    TOWN_ONCE.on = on.once;
    PLUNDER_RECOVERY.on = on.recovery;
    MAIN_CRYSTAL.every = 0;
    try {
      body();
    } finally {
      [TOWN_ONCE.on, PLUNDER_RECOVERY.on, MAIN_CRYSTAL.every] = saved;
    }
  };
}

function rejections(g: Game, p: number): number[] {
  return g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

function row(g: Game, p: number | null): Int32Array {
  const v = buildView(g, p);
  for (let r = 0; r < v.towns.length; r += TOWN_STRIDE) if (v.towns[r + TownField.id] === T) return v.towns.subarray(r, r + TOWN_STRIDE);
  throw new Error("town not in view");
}

/** The small town 0 (no militia in an empty game) taken by player p with one tough spearman. */
function take(g: Game, p: number): number {
  const u = g.w.units.col;
  for (let s = 0; s < g.w.units.count; s++) if (u.owner[s] === NEUTRAL && u.home[s] === T) u.hp[s] = 0;
  const spear = put(g, p, UnitType.Spearman, g.w.townX[T] + 1, g.w.townY[T]);
  u.hp[slotOf(g, spear)] = 100000;
  run(g, 3);
  assert.equal(g.w.townState[T], TownState.AwaitingChoice);
  assert.equal(g.w.townOwner[T], p);
  return spear;
}

/** Player p takes the town, plunders it and leaves; the ruins turn neutral again. */
function plunderOnce(g: Game, p: number): void {
  const spear = take(g, p);
  cmd(g, p, { c: "town_choice", town: T, choice: TownChoice.Plunder });
  run(g, SMALL.plunderTicks + 2);
  assert.equal(g.w.townState[T], TownState.Ruins);
  g.w.units.col.hp[slotOf(g, spear)] = 0;
  run(g, SMALL.ruinsTicks + 1);
  assert.equal(g.w.townState[T], TownState.Neutral);
}

/** Plunders the town once, takes it again and chooses `choice`: the rejections of that choice. */
function again(p: number, choice: number): { g: Game; spear: number; rejected: number[] } {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  plunderOnce(g, p);
  const spear = take(g, p);
  g.w.res[p * 4 + Resource.Wood] = 1000;
  g.w.res[p * 4 + Resource.Gold] = 1000;
  cmd(g, p, { c: "town_choice", town: T, choice });
  g.step();
  return { g, spear, rejected: rejections(g, p) };
}

test("a town can be plundered once a game: again it is refused (both players alike), governing it is not", withRules({ once: true, recovery: true }, () => {
  for (const p of [0, 1]) {
    const { g, rejected } = again(p, TownChoice.Plunder);
    assert.deepEqual(rejected, [Reject.AlreadyPlundered], `player ${p}`);
    assert.equal(g.w.townState[T], TownState.AwaitingChoice, "still waiting for a choice");
    for (const q of [p, null]) assert.ok((row(g, q)[TownField.flags] & TownFlag.Plundered) !== 0, `${q} sees it was plundered`);
    cmd(g, p, { c: "town_choice", town: T, choice: TownChoice.Govern });
    g.step();
    assert.deepEqual(rejections(g, p), []);
    assert.equal(g.w.townState[T], TownState.Repairing);
  }
}));

test("TOWN_ONCE off: the same town is plundered twice", withRules({ once: false, recovery: true }, () => {
  const { g, rejected } = again(0, TownChoice.Plunder);
  assert.deepEqual(rejected, []);
  assert.equal(g.w.townState[T], TownState.Plundering);
}));

/** Resources the holder p gets from the town over `ticks` (food). */
function foodOver(g: Game, p: number, ticks: number): number {
  const f0 = g.w.res[p * 4 + Resource.Food];
  run(g, ticks);
  return g.w.res[p * 4 + Resource.Food] - f0;
}

test("a plundered town governed again pays 25% at first and all of it after 10 minutes; it keeps its climb when it changes hands", withRules({ once: true, recovery: true }, () => {
  const { g, spear } = again(0, TownChoice.Govern);
  run(g, SMALL.repairTicks);
  assert.equal(g.w.townState[T], TownState.Governed);
  const per = governPerMinute(TownSize.Small).food;
  assert.equal(row(g, 0)[TownField.incomePermille], 250, "a quarter at first");
  // The first minute pays a quarter climbing to 32.5%: about 28.75% of a full minute.
  const first = foodOver(g, 0, 1200);
  const expect = (per * 2875) / 10000;
  assert.ok(Math.abs(first - expect) <= 1.5, `first minute ${first}, about ${expect}`);
  assert.equal(row(g, 0)[TownField.incomePermille], 325);
  run(g, 4 * 1200);
  assert.equal(row(g, null)[TownField.incomePermille], 625, "a spectator sees it too");
  // Another player takes it: the climb stays with the town.
  g.w.units.col.hp[slotOf(g, spear)] = 0;
  const enemy = put(g, 1, UnitType.Spearman, g.w.townX[T] - 1, g.w.townY[T]);
  g.w.units.col.hp[slotOf(g, enemy)] = 100000;
  run(g, 6);
  assert.equal(g.w.townOwner[T], 1);
  assert.equal(row(g, 1)[TownField.incomePermille], 625);
  g.w.res[4 + Resource.Wood] = 1000;
  g.w.res[4 + Resource.Gold] = 1000;
  cmd(g, 1, { c: "town_choice", town: T, choice: TownChoice.Govern });
  run(g, SMALL.repairTicks + 2);
  assert.equal(g.w.townState[T], TownState.Governed);
  run(g, 5 * 1200);
  assert.equal(row(g, 1)[TownField.incomePermille], 1000, "ten minutes of governing in all");
  const full = foodOver(g, 1, 1200);
  assert.ok(Math.abs(full - per) <= 1, `full minute ${full}`);
}));

test("PLUNDER_RECOVERY off: a plundered town governed again pays in full, and town rows say 1000", withRules({ once: true, recovery: false }, () => {
  const { g } = again(0, TownChoice.Govern);
  run(g, SMALL.repairTicks);
  assert.equal(row(g, 0)[TownField.incomePermille], 1000);
  const per = governPerMinute(TownSize.Small).food;
  const food = foodOver(g, 0, 1200);
  assert.ok(Math.abs(food - per) <= 1, `a minute ${food}`);
}));
