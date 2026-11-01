// push-late-siege's measurement (siege-watch.ts, D-115): when the works stood, each engine's end and what hit it last,
// what stones killed and pulled down. Read only.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDINGS, KEEP, UNITS } from "../src/core/rules.ts";
import { BuildingType, Stance, UnitType } from "../src/protocol.ts";
import { SiegeWatch } from "../src/siege-watch.ts";
import { emptyGame, openArea, put, slotOf, switchedOff } from "./helpers.ts";

type G = ReturnType<typeof emptyGame>;
function watched(g: G, watch: SiegeWatch, ticks: number, marching = false): void {
  for (let i = 0; i < ticks && !g.w.over; i++) {
    g.step();
    watch.tick(g.w, g.events, marching);
  }
}

test("an engine's end: when, and by what: cavalry here; standing engines say nothing; a march is noted once", switchedOff(KEEP, () => {
  const g = emptyGame();
  const { x, y } = openArea(g, 24);
  const doomed = put(g, 0, UnitType.Siege, x + 4, y + 4);
  const safe = put(g, 0, UnitType.Siege, x + 20, y + 20);
  const works = g.w.addBuilding(0, BuildingType.SiegeWorks, x + 20, y + 4, BUILDINGS[BuildingType.SiegeWorks].hp, 1000);
  assert.ok(works >= 0);
  g.w.units.col.hp[slotOf(g, doomed)] = 30; // Two of the cavalry's hits: what hit it last is read while it stands.
  const watch = new SiegeWatch(0);
  watched(g, watch, 1, true);
  const c = put(g, 1, UnitType.Cavalry, x + 5, y + 4);
  g.w.units.col.stance[slotOf(g, c)] = Stance.Aggressive;
  g.fog.update(g.w);
  watched(g, watch, 200);
  const r = watch.result();
  assert.ok(r.worksDone >= 0);
  assert.ok(r.firstEngine >= 0);
  assert.deepEqual([r.out.engines, r.out.soldiers], [2, 2]);
  const a = r.engines.find((e) => e.id === doomed)!;
  const b = r.engines.find((e) => e.id === safe)!;
  assert.ok(a.died > 0);
  assert.equal(a.by, "cavalry");
  assert.deepEqual([b.died, b.by], [-1, ""]);
}));

test("stones: the soldiers they kill count, and a tower a stone brings down", switchedOff(KEEP, () => {
  const g = emptyGame();
  const { x, y } = openArea(g, 24);
  const engine = put(g, 0, UnitType.Siege, x + 4, y + 10);
  const tower = g.w.addBuilding(1, BuildingType.ArrowTower, x + 12, y + 10, 1, 1000);
  g.w.units.col.hp[slotOf(g, engine)] = UNITS[UnitType.Siege].hp;
  g.fog.update(g.w);
  const watch = new SiegeWatch(0);
  watched(g, watch, 300);
  assert.equal(g.w.building(tower), -1, "down");
  assert.equal(watch.result().towers, 1);
  // Two enemies side by side, one hit away, within the engine's reach.
  const g2 = emptyGame();
  const a2 = openArea(g2, 24);
  put(g2, 0, UnitType.Siege, a2.x + 4, a2.y + 10);
  const e1 = put(g2, 1, UnitType.Spearman, a2.x + 8, a2.y + 10);
  const e2 = put(g2, 1, UnitType.Spearman, a2.x + 8, a2.y + 11);
  for (const id of [e1, e2]) {
    const s = slotOf(g2, id);
    g2.w.units.col.hp[s] = 1;
    g2.w.units.col.stance[s] = Stance.Hold;
    g2.w.units.col.cooldown[s] = 1 << 20;
  }
  g2.fog.update(g2.w);
  const w2 = new SiegeWatch(0);
  watched(g2, w2, 300);
  assert.equal(w2.result().kills.soldiers, 2);
}));
