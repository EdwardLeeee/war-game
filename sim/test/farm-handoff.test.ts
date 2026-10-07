// A farmer the player sends to a farm works it, even when someone else works it already (the
// user, 2026-10-07: "如果把指定去砍樹的村民叫去農田，它會沒辦法過去"). The one who worked it
// moves to the nearest farm of the player's nobody works, or idles for the economy ratio.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Game } from "../src/core/game.ts";
import { BUILDINGS } from "../src/core/rules.ts";
import { BuildingType, NodeKind, Order, UnitType } from "../src/protocol.ts";
import { cmd, emptyGame, put, run, slotOf } from "./helpers.ts";

/** Player 0's finished farms beside its main city (14..17, 76..79), by id. */
function farms(g: Game, n: number): number[] {
  const at = [
    [19, 80],
    [22, 80],
    [25, 80],
  ];
  return at.slice(0, n).map(([x, y]) => g.w.addBuilding(0, BuildingType.Farm, x, y, BUILDINGS[BuildingType.Farm].hp, 1000));
}

function rejected(g: Game): number[] {
  return g.events.filter((e) => e.to === 0 && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

/** Farm id the farmer works or walks to, or -1. */
function farmOf(g: Game, id: number): number {
  const u = g.w.units.col;
  const s = slotOf(g, id);
  return u.order[s] === Order.Gather && u.onFarm[s] === 1 ? u.orderTarget[s] : -1;
}

/** A farmer sent by hand to cut wood. */
function woodcutter(g: Game): number {
  const w = g.w;
  let tree = -1;
  for (let k = 0; k < w.nodeKind.length && tree < 0; k++) if (w.nodeKind[k] === NodeKind.Tree && Math.abs(w.nodeX[k] - 18) + Math.abs(w.nodeY[k] - 80) < 14) tree = k;
  const f = put(g, 0, UnitType.Farmer, 18, 78);
  g.fog.update(w);
  cmd(g, 0, { c: "gather", u: [f], node: tree });
  run(g, 20);
  return f;
}

test("a woodcutter sent to a farm someone works takes it; the one working it moves to the nearest free farm", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const [a, b] = farms(g, 2);
  const farmer = put(g, 0, UnitType.Farmer, 20, 81);
  g.fog.update(g.w);
  cmd(g, 0, { c: "repair", u: [farmer], building: a });
  run(g, 40);
  assert.equal(farmOf(g, farmer), a);
  const cutter = woodcutter(g);
  cmd(g, 0, { c: "repair", u: [cutter], building: a });
  g.step();
  assert.deepEqual(rejected(g), [], "the player's pick is never refused");
  assert.equal(farmOf(g, cutter), a, "the woodcutter takes the farm");
  assert.equal(farmOf(g, farmer), b, "the farmer who worked it goes to the free one");
  run(g, 200);
  assert.equal(g.w.units.col.onFarm[slotOf(g, cutter)], 1);
});

test("no free farm left: the one who worked it idles; several named: the first takes it, the next the nearest free farm, the rest idle", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const [a] = farms(g, 1);
  const farmer = put(g, 0, UnitType.Farmer, 20, 81);
  g.fog.update(g.w);
  cmd(g, 0, { c: "repair", u: [farmer], building: a });
  run(g, 40);
  const cutter = woodcutter(g);
  cmd(g, 0, { c: "repair", u: [cutter], building: a });
  g.step();
  assert.equal(farmOf(g, cutter), a);
  assert.equal(g.w.units.col.order[slotOf(g, farmer)], Order.None, "no farm to go to: idle");

  const h = emptyGame();
  h.w.ecoOn[0] = 0;
  const [x, y] = farms(h, 2);
  const named = [0, 1, 2].map((k) => put(h, 0, UnitType.Farmer, 18 + k, 82));
  h.fog.update(h.w);
  cmd(h, 0, { c: "repair", u: named, building: x });
  h.step();
  assert.deepEqual(rejected(h), []);
  assert.deepEqual(named.map((id) => farmOf(h, id)), [x, y, -1]);
  assert.equal(h.w.units.col.order[slotOf(h, named[2])], Order.None);
});
