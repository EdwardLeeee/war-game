// Guarding a town (`guard`, Order.TownGuard; the user 2026-10-31: 「駐軍的功能應該是說敵軍打過來我們要反擊但不會追出城鎮」): ranged
// units and mages on the walls, the rest within them. They hit what they can reach, go for an enemy inside, onto a gate
// being broken and no further, hide from shooters they cannot reach, and go back to their place when it is over.

import assert from "node:assert/strict";
import { test } from "node:test";
import { TOWN_GUARD, UNITS } from "../src/core/rules.ts";
import { BuildingType, CELL_SHIFT, Order, Reject, Stance, TownState, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOff } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;
const T = 0;

/** One tick: the codes of the commands of player p it rejected. */
function step(g: G, p = 0): number[] {
  g.step();
  return g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

/** Town T held by player 0 (militia gone, gates refreshed). */
function held(state: TownState = TownState.Governed): G {
  const g = emptyGame();
  g.w.townState[T] = state;
  g.w.townOwner[T] = 0;
  g.w.townTimer[T] = 1 << 20;
  const b = g.w.buildings.col;
  for (let s = 0; s < g.w.buildings.count; s++) if (b.type[s] === BuildingType.Keep && b.town[s] === T) b.owner[s] = 0;
  g.w.refreshGates(T);
  g.fog.update(g.w);
  return g;
}
const cellOf = (g: G, id: number) => {
  const u = g.w.units.col;
  const s = slotOf(g, id);
  return { x: u.x[s] >> CELL_SHIFT, y: u.y[s] >> CELL_SHIFT };
};
const within = (g: G, id: number) => {
  const c = cellOf(g, id);
  return g.w.inTown(T, c.x, c.y);
};
const onGate = (g: G, id: number) => {
  const c = cellOf(g, id);
  const t = g.w.map.towns[T];
  return g.w.castles[T].gate.some(([dx, dy]) => t.cellX + dx === c.x && t.cellY + dy === c.y);
};
/** A soldier of player p in the town's middle, off its keep. */
const inTown = (g: G, p: number, type: UnitType, dx = 3, dy = 3) => {
  const t = g.w.map.towns[T];
  return put(g, p, type, t.cellX + dx, t.cellY + dy);
};
/** A unit of player p `off` cells south of the south wall. */
const south = (g: G, p: number, type: UnitType, off: number) => {
  const t = g.w.map.towns[T];
  return put(g, p, type, t.cellX, t.cellY + g.w.castles[T].inside.y1 + 1 + off);
};
const guarding = (g: G, id: number) => g.w.units.col.order[slotOf(g, id)] === Order.TownGuard;

test("`guard`: the holder's soldiers only, in a town it holds; farmers are left alone", () => {
  const g = emptyGame();
  const a = inTown(g, 0, UnitType.Spearman);
  cmd(g, 0, { c: "guard", u: [a], town: T });
  assert.deepEqual(step(g), [Reject.TownNotYours]);
  g.w.townState[T] = TownState.Governed;
  g.w.townOwner[T] = 0;
  cmd(g, 0, { c: "guard", u: [a], town: 99 });
  assert.deepEqual(step(g), [Reject.InvalidTarget]);
  const f = inTown(g, 0, UnitType.Farmer);
  cmd(g, 0, { c: "guard", u: [f], town: T });
  assert.deepEqual(step(g), [Reject.NotAvailable]);
  cmd(g, 1, { c: "guard", u: [a], town: T });
  assert.deepEqual(step(g, 1), [Reject.NotOwner]);
  cmd(g, 0, { c: "guard", u: [a, f], town: T });
  assert.deepEqual(step(g), []);
  assert.equal(guarding(g, a), true);
  assert.equal(g.w.units.col.order[slotOf(g, f)] === Order.TownGuard, false);
});

test("from outside they walk in and stand at their place; ranged units and mages go up the walls, those with no room stay inside", () => {
  const g = held();
  const spear = south(g, 0, UnitType.Spearman, 8);
  const horse = south(g, 0, UnitType.Cavalry, 9);
  const bow = south(g, 0, UnitType.Ranged, 10);
  const mage = south(g, 0, UnitType.Mage, 11);
  cmd(g, 0, { c: "guard", u: [spear, horse, bow, mage], town: T });
  run(g, 60 * 20);
  const u = g.w.units.col;
  assert.ok(within(g, spear) && within(g, horse), "inside");
  assert.equal(u.order[slotOf(g, bow)], Order.Wall);
  assert.equal(u.order[slotOf(g, mage)], Order.Wall);
  assert.ok(u.wall[slotOf(g, bow)] >= 0);
  // No wall cell left: inside.
  for (const c of g.w.wallCells[T]) if (g.w.wallAt[c] < 0) g.w.wallAt[c] = 1 << 20;
  const late = inTown(g, 0, UnitType.Ranged);
  cmd(g, 0, { c: "guard", u: [late], town: T });
  run(g, 2);
  assert.equal(guarding(g, late), true);
});

test("an enemy inside: they go and hit it; once it is gone they go back to their place", () => {
  const g = held();
  const a = inTown(g, 0, UnitType.Spearman, -4, -4);
  cmd(g, 0, { c: "guard", u: [a], town: T });
  run(g, 2);
  const place = cellOf(g, a);
  const foe = inTown(g, 1, UnitType.Spearman, 4, 4);
  const u = g.w.units.col;
  g.fog.update(g.w);
  const hp = u.hp[slotOf(g, foe)];
  let hit = false;
  for (let k = 0; k < 40 * 20 && g.w.unit(foe) >= 0; k++) {
    run(g, 1);
    if (g.w.unit(foe) >= 0 && u.hp[slotOf(g, foe)] < hp) hit = true;
    assert.ok(within(g, a), "never out of the walls");
  }
  assert.ok(hit || g.w.unit(foe) < 0, "it fought");
  run(g, 30 * 20);
  const c = cellOf(g, a);
  assert.ok(g.w.unit(a) < 0 || (Math.abs(c.x - place.x) <= 1 && Math.abs(c.y - place.y) <= 1), "back at its place");
});

test("an enemy who runs out of the town is not chased through the gate", () => {
  const g = held();
  const a = inTown(g, 0, UnitType.Spearman);
  cmd(g, 0, { c: "guard", u: [a], town: T });
  run(g, 2);
  const foe = south(g, 1, UnitType.Spearman, 2);
  g.fog.update(g.w);
  for (let k = 0; k < 20 * 20; k++) {
    run(g, 1);
    assert.ok(within(g, a) || onGate(g, a), "within the walls");
  }
  assert.ok(g.w.unit(foe) >= 0, "out of reach behind the wall");
});

test("a gate being broken: they go onto the gate cell and hit who is at it, and no further; when it is over, back to their place", () => {
  const g = held(TownState.Repairing);
  const a = inTown(g, 0, UnitType.Spearman, 0, 4);
  cmd(g, 0, { c: "guard", u: [a], town: T });
  run(g, 2);
  const place = cellOf(g, a);
  const foe = south(g, 1, UnitType.Spearman, 3);
  const k = g.w.castles[T].gates.findIndex((cells) => cells.every(([, dy]) => dy > 0));
  const gate = g.w.gateIn(T, k);
  const b = g.w.buildings.col;
  const u = g.w.units.col;
  const t = g.w.map.towns[T];
  g.fog.update(g.w);
  cmd(g, 1, { c: "attack", u: [foe], target: b.id[gate] });
  let reached = false;
  const foeHp = u.hp[slotOf(g, foe)];
  for (let i = 0; i < 40 * 20 && g.w.unit(foe) >= 0; i++) {
    run(g, 1);
    reached ||= onGate(g, a);
    assert.ok(within(g, a) || onGate(g, a), `tick ${g.tick}: on no cell beyond the gate`);
  }
  assert.equal(reached, true, "onto the gate cell");
  assert.ok(g.w.unit(foe) < 0 || u.hp[slotOf(g, foe)] < foeHp, "it hit the one at the gate");
  assert.ok(t.cellY + g.w.castles[T].inside.y1 + 2 >= cellOf(g, a).y);
  if (g.w.unit(foe) >= 0) cmd(g, 1, { c: "retreat", u: [foe], x: t.cellX, y: t.cellY + 30 });
  run(g, 40 * 20);
  const c = cellOf(g, a);
  assert.ok(Math.abs(c.x - place.x) <= 1 && Math.abs(c.y - place.y) <= 1, "back at its place");
});

test("shooters it cannot reach: once hit it hides inside out of their reach, and goes back when they leave", () => {
  const g = held(TownState.Repairing);
  const t = g.w.map.towns[T];
  const y1 = g.w.castles[T].inside.y1;
  const a = put(g, 0, UnitType.Spearman, t.cellX, t.cellY + y1 - 1);
  cmd(g, 0, { c: "guard", u: [a], town: T });
  run(g, 2);
  const place = cellOf(g, a);
  const bow = south(g, 1, UnitType.Ranged, 2);
  const reach = UNITS[UnitType.Ranged].range >> CELL_SHIFT;
  g.fog.update(g.w);
  // Standing where it is, shooting what it can reach.
  cmd(g, 1, { c: "stance", u: [bow], stance: Stance.Hold });
  const far = () => {
    const m = cellOf(g, a);
    const f = cellOf(g, bow);
    return (m.x - f.x) ** 2 + (m.y - f.y) ** 2 > reach * reach;
  };
  assert.equal(far(), false, "in reach to begin with");
  for (let k = 0; k < 10 * 20; k++) {
    run(g, 1);
    assert.ok(within(g, a), "within the walls");
  }
  assert.ok(far(), "out of the bow's reach");
  assert.ok(guarding(g, a));
  cmd(g, 1, { c: "retreat", u: [bow], x: t.cellX, y: t.cellY + y1 + 30 });
  run(g, 40 * 20);
  const c = cellOf(g, a);
  assert.ok(Math.abs(c.x - place.x) <= 1 && Math.abs(c.y - place.y) <= 1, "back at its place");
});

test("the whole town within reach: it goes as far from the shooters as the walls allow", () => {
  const g = held();
  const t = g.w.map.towns[T];
  const inside = g.w.castles[T].inside;
  const a = put(g, 0, UnitType.Spearman, t.cellX, t.cellY + inside.y1 - 1);
  cmd(g, 0, { c: "guard", u: [a], town: T });
  run(g, 2);
  // All round, enough of them that nothing inside is out of reach.
  const bows = [south(g, 1, UnitType.Ranged, 1), put(g, 1, UnitType.Ranged, t.cellX, t.cellY + inside.y0 - 2), put(g, 1, UnitType.Ranged, t.cellX + inside.x1 + 2, t.cellY), put(g, 1, UnitType.Ranged, t.cellX + inside.x0 - 2, t.cellY)];
  g.fog.update(g.w);
  g.w.units.col.hp[slotOf(g, a)] = 100000;
  cmd(g, 1, { c: "attack", u: bows, target: a });
  run(g, 20 * 20);
  assert.ok(within(g, a), "inside still");
  assert.ok(guarding(g, a), "guarding still");
});

test("any move, attack, retreat or stop ends it; losing the town too", () => {
  for (const c of ["move", "retreat", "stop"] as const) {
    const g = held();
    const a = inTown(g, 0, UnitType.Spearman);
    cmd(g, 0, { c: "guard", u: [a], town: T });
    run(g, 2);
    const t = g.w.map.towns[T];
    cmd(g, 0, c === "stop" ? { c, u: [a] } : { c, u: [a], x: t.cellX, y: t.cellY + 20 });
    run(g, 2);
    assert.equal(guarding(g, a), false, c);
  }
  const g = held();
  const a = inTown(g, 0, UnitType.Spearman);
  cmd(g, 0, { c: "guard", u: [a], town: T });
  run(g, 2);
  g.w.townOwner[T] = 1;
  run(g, 2);
  assert.equal(g.w.units.col.order[slotOf(g, a)], Order.None);
});

test("guards count as the town's garrison", () => {
  const g = held(TownState.Repairing);
  const a = inTown(g, 0, UnitType.Spearman);
  cmd(g, 0, { c: "guard", u: [a], town: T });
  run(g, 20 * 20);
  assert.equal(g.w.townRevolt?.[T] ?? 0, 0);
  assert.equal(g.w.townOwner[T], 0);
});

test("TOWN_GUARD off: `guard` is rejected", switchedOff(TOWN_GUARD, () => {
  const g = held();
  const a = inTown(g, 0, UnitType.Spearman);
  cmd(g, 0, { c: "guard", u: [a], town: T });
  assert.deepEqual(step(g), [Reject.NotAvailable]);
}));
