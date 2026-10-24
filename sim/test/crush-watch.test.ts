// push-crush's measurement (crush-watch.ts, ceo 2026-10-25): the first battle the AI lost big, and what it did
// in the 15 minutes after. Read only: the game plays as without it.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BUILDINGS } from "../src/core/rules.ts";
import { CrushWatch } from "../src/crush-watch.ts";
import { BuildingType, TownState, UnitType } from "../src/protocol.ts";
import { emptyGame, openArea, put } from "./helpers.ts";

function watched(g: ReturnType<typeof emptyGame>, watch: CrushWatch, ticks: number): void {
  for (let i = 0; i < ticks && !g.w.over; i++) {
    g.step();
    watch.tick(g.w);
  }
}

test("crush watch: a battle the AI lost 15 or more in, twice ours, then its towers put down and its farmers", () => {
  const g = emptyGame();
  const w = g.w;
  const { x, y } = openArea(g, 14);
  for (let k = 0; k < 40; k++) put(g, 0, UnitType.Spearman, x + 1 + (k % 8), y + 1 + Math.trunc(k / 8));
  for (let k = 0; k < 16; k++) put(g, 1, UnitType.Spearman, x + 1 + (k % 8), y + 7 + Math.trunc(k / 8));
  put(g, 1, UnitType.Farmer, 5, 5);
  const watch = new CrushWatch();
  watched(g, watch, 600);
  assert.equal(watch.result(), null, "still fighting, or not 30 s since");
  watched(g, watch, 1200);
  const c = watch.result();
  assert.ok(c !== null, "the AI lost big");
  assert.ok(c.aiLost >= 15 && c.aiLost >= 2 * c.myLost, `${c.aiLost} against ${c.myLost}`);
  assert.equal(c.place, "field");
  assert.ok(c.soldiersAtEnd[0] > c.soldiersAtEnd[1]);
  assert.deepEqual([c.towers, c.aiFarmers[0]], [[0, 0, 0], 1]);
  // In the window: a tower put down, then finished.
  const tower = w.addBuilding(1, BuildingType.ArrowTower, 8, 5, BUILDINGS[BuildingType.ArrowTower].hp, 0);
  watched(g, watch, 40);
  assert.deepEqual(watch.result()!.towers, [0, 1, 0]);
  w.buildings.col.progress[w.building(tower)] = 1000;
  watched(g, watch, 1200);
  const r = watch.result()!;
  assert.deepEqual(r.towers, [0, 1, 1]);
  assert.ok(r.aiFarmers.length >= 2, "a reading a minute");
  assert.ok(r.until > c.end && r.until <= c.end + 15 * 1200);
  // A governed town of the AI's attacked (its 2 soldiers inside hold it while ours are there too): 3
  // more of its soldiers come, and it falls to us.
  const t = 0;
  w.townOwner[t] = 1;
  w.townState[t] = TownState.Governed;
  for (let k = 0; k < 2; k++) put(g, 1, UnitType.Spearman, w.townX[t] + k, w.townY[t] + 1);
  for (let k = 0; k < 4; k++) put(g, 0, UnitType.Spearman, w.townX[t] + k - 2, w.townY[t]);
  watched(g, watch, 40);
  for (let k = 0; k < 3; k++) put(g, 1, UnitType.Spearman, w.townX[t] + k - 1, w.townY[t] + w.townRadius[t] + 4);
  watched(g, watch, 40);
  w.townOwner[t] = 0;
  w.townState[t] = TownState.AwaitingChoice;
  watched(g, watch, 40);
  assert.deepEqual(
    watch.result()!.towns.map((e) => [e.town, e.came, e.held, e.open]),
    [[t, 3, false, false]],
  );
});

test("crush watch: a battle the AI did not lose big is not one", () => {
  const g = emptyGame();
  const { x, y } = openArea(g, 14);
  for (let k = 0; k < 10; k++) put(g, 0, UnitType.Spearman, x + 1 + (k % 8), y + 1 + Math.trunc(k / 8));
  for (let k = 0; k < 10; k++) put(g, 1, UnitType.Spearman, x + 1 + (k % 8), y + 5 + Math.trunc(k / 8));
  const watch = new CrushWatch();
  watched(g, watch, 2400);
  assert.equal(watch.result(), null);
});
