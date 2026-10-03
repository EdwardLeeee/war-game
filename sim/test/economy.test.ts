// Economy (PR-3): gathering, the economy ratio, building, placement, training, repair,
// recall, idle farmers, and the e2e scenario.

import assert from "node:assert/strict";
import test from "node:test";
import { Game } from "../src/core/game.ts";
import { Task } from "../src/core/economy.ts";
import { BUILDINGS, CARRY, MAIN_ARROW, MAIN_CITY_REPAIR_LOCK, UNITS } from "../src/core/rules.ts";
import { checkPlacement } from "../src/placement.ts";
import {
  Action,
  BUILDING_STRIDE,
  BuildingField,
  BuildingFlag,
  BuildingType,
  CELL_SHIFT,
  HeaderField,
  NodeKind,
  Order,
  PlaceBit,
  Reject,
  Resource,
  UNIT_STRIDE,
  UnitField,
  UnitFlag,
  UnitType,
} from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, put, run, slotOf } from "./helpers.ts";

function rejects(g: Game, p: number): number[] {
  return g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

/** Runs one tick and returns the reject reasons it produced for player p. */
function step(g: Game, p = 0): number[] {
  g.step();
  return rejects(g, p);
}

/** Known, open nodes of a kind, nearest the player's spawn first. */
function nodesNear(g: Game, p: number, kind: number): number[] {
  const w = g.w;
  const s = w.map.spawns[p];
  const out: number[] = [];
  for (let k = 0; k < w.nodeAmount.length; k++) {
    if (w.nodeKind[k] === kind && g.fog.nodeSeen[p][k] >= 0 && w.nodeAmount[k] > 0) out.push(k);
  }
  const d = (k: number) => (w.nodeX[k] - s.cellX) ** 2 + (w.nodeY[k] - s.cellY) ** 2;
  return out.sort((a, b) => d(a) - d(b) || a - b);
}

/** A spot where player p may build `type`, per its own view, nearest its spawn. */
function spot(g: Game, p: number, type: BuildingType, skip = 0): { x: number; y: number } {
  const view = buildView(g, p);
  const n = g.w.size;
  const s = g.w.map.spawns[p];
  const found: { x: number; y: number; d: number }[] = [];
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (checkPlacement({ size: n, cells: view.placement }, BUILDINGS[type], x, y) === 0) {
        found.push({ x, y, d: (x - s.cellX) ** 2 + (y - s.cellY) ** 2 });
      }
    }
  }
  found.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  return found[skip * 3];
}

function mainCityCell(g: Game, p: number): { x: number; y: number } {
  const s = g.w.mainCity(p);
  return { x: g.w.buildings.col.cellX[s], y: g.w.buildings.col.cellY[s] };
}

/** A farmer beside player p's main city (the first free cell on its right side). */
function farmerAtBase(g: Game, p: number, k = 0): number {
  const m = mainCityCell(g, p);
  return put(g, p, UnitType.Farmer, m.x + 4, m.y + k);
}

test("the start reveals the home area: berries, trees and the home gold mine are known", () => {
  const g = new Game({ seed: 1, scenario: "standard" });
  for (const kind of [NodeKind.Berries, NodeKind.Tree, NodeKind.GoldMine]) {
    assert.ok(nodesNear(g, 0, kind).length > 0, `player 0 knows kind ${kind}`);
    assert.equal(nodesNear(g, 0, kind).length, nodesNear(g, 1, kind).length, `mirror counts of kind ${kind}`);
  }
});

test("a farmer gathers wood, carries 10 back to the main city, and goes again", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const f = farmerAtBase(g, 0);
  const tree = nodesNear(g, 0, NodeKind.Tree)[0];
  const wood0 = g.w.res[Resource.Wood];
  cmd(g, 0, { c: "gather", u: [f], node: tree });
  let sawCarry = false;
  for (let t = 0; t < 2000 && g.w.res[Resource.Wood] === wood0; t++) {
    g.step();
    const s = slotOf(g, f);
    if (g.w.units.col.carryAmount[s] === CARRY && g.w.units.col.carryKind[s] === Resource.Wood) sawCarry = true;
  }
  assert.ok(sawCarry, "carried a full load");
  assert.equal(g.w.res[Resource.Wood], wood0 + CARRY);
  assert.equal(g.w.gathered[Resource.Wood], CARRY);
  const s = slotOf(g, f);
  assert.equal(g.w.units.col.order[s], Order.Gather);
  assert.equal(g.w.units.col.task[s], Task.Go);
  assert.equal(g.w.nodeAmount[tree], 100 - CARRY);
});

test("gathering rate: 30 wood per minute while at the tree", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const tree = nodesNear(g, 0, NodeKind.Tree).find((k) => {
    const x = g.w.nodeX[k];
    const y = g.w.nodeY[k];
    return g.w.walkable(x + 1, y);
  })!;
  const f = put(g, 0, UnitType.Farmer, g.w.nodeX[tree] + 1, g.w.nodeY[tree]);
  cmd(g, 0, { c: "gather", u: [f], node: tree });
  run(g, 200); // 10 seconds = 5 wood
  assert.equal(g.w.units.col.carryAmount[slotOf(g, f)], 5);
});

test("a used-up tree opens its cell, says so, and the farmer moves to the next tree", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const trees = nodesNear(g, 0, NodeKind.Tree);
  const tree = trees.find((k) => g.w.walkable(g.w.nodeX[k] + 1, g.w.nodeY[k]))!;
  g.w.nodeAmount[tree] = 3;
  const f = put(g, 0, UnitType.Farmer, g.w.nodeX[tree] + 1, g.w.nodeY[tree]);
  cmd(g, 0, { c: "gather", u: [f], node: tree });
  let depleted = false;
  for (let t = 0; t < 200 && !depleted; t++) {
    g.step();
    depleted = g.events.some((e) => e.to === 0 && e.ev.k === "node_depleted" && e.ev.id === tree);
  }
  assert.ok(depleted, "node_depleted event");
  assert.ok(g.w.walkable(g.w.nodeX[tree], g.w.nodeY[tree]), "the tree's cell is open");
  run(g, 2);
  const s = slotOf(g, f);
  assert.equal(g.w.units.col.order[s], Order.Gather);
  assert.notEqual(g.w.units.col.orderTarget[s], tree);
  assert.equal(g.w.nodeKind[g.w.units.col.orderTarget[s]], NodeKind.Tree);
});

test("the economy ratio shares idle farmers 40/35/25 and never sends them to the crystal vein", () => {
  const g = emptyGame();
  const ids: number[] = [];
  for (let k = 0; k < 10; k++) ids.push(farmerAtBase(g, 0, k % 4));
  g.step(); // tick 0: the economy pass
  const count = [0, 0, 0, 0];
  const u = g.w.units.col;
  for (const id of ids) {
    const s = slotOf(g, id);
    assert.equal(u.order[s], Order.Gather);
    const kind = g.w.nodeKind[u.orderTarget[s]];
    count[kind === NodeKind.Tree ? Resource.Wood : kind === NodeKind.GoldMine ? Resource.Gold : kind === NodeKind.Berries ? Resource.Food : Resource.Crystal]++;
  }
  assert.deepEqual(count, [4, 4, 2, 0]);
});

test("eco_ratio validates and switches the ratio off", () => {
  const g = emptyGame();
  cmd(g, 0, { c: "eco_ratio", food: 50, wood: 50, gold: 10, on: true });
  assert.deepEqual(step(g), [Reject.InvalidTarget]);
  cmd(g, 0, { c: "eco_ratio", food: 20, wood: 30, gold: 50, on: false });
  assert.deepEqual(step(g), []);
  const h = buildView(g, 0).header;
  assert.deepEqual([h[HeaderField.ratioFood], h[HeaderField.ratioWood], h[HeaderField.ratioGold], h[HeaderField.ratioOn]], [20, 30, 50, 0]);
  const f = farmerAtBase(g, 0);
  run(g, 40);
  assert.equal(g.w.units.col.order[slotOf(g, f)], Order.None, "with the ratio off an idle farmer stays idle");
  const view = buildView(g, 0);
  assert.deepEqual([...view.idleFarmers], [f]);
  const row = [...view.units].findIndex((_, i) => i % UNIT_STRIDE === 0 && view.units[i] === f);
  assert.ok((view.units[row + UnitField.flags] & UnitFlag.IdleFarmer) !== 0);
});

test("build: pays at placement, builders add up (at most 4), the house raises the cap", () => {
  const times: number[] = [];
  for (const builders of [1, 2, 5]) {
    const g = emptyGame();
    g.w.ecoOn[0] = 0;
    const ids: number[] = [];
    for (let k = 0; k < builders; k++) ids.push(farmerAtBase(g, 0, k));
    const at = spot(g, 0, BuildingType.House);
    const wood0 = g.w.res[Resource.Wood];
    cmd(g, 0, { c: "build", u: ids, type: BuildingType.House, x: at.x, y: at.y });
    assert.deepEqual(step(g), []);
    assert.equal(g.w.res[Resource.Wood], wood0 - BUILDINGS[BuildingType.House].cost.wood);
    assert.equal(g.w.populationCap(0), 10);
    let done = -1;
    for (let t = 0; t < 1000 && done < 0; t++) {
      g.step();
      if (g.events.some((e) => e.to === 0 && e.ev.k === "building_done")) done = g.tick;
    }
    assert.ok(done > 0, `${builders} builders finished`);
    times.push(done);
    const bs = g.w.building(g.w.buildingAt[at.y * g.w.size + at.x]);
    assert.equal(g.w.buildings.col.hp[bs], BUILDINGS[BuildingType.House].hp);
    assert.equal(g.w.populationCap(0), 15);
  }
  const build = BUILDINGS[BuildingType.House].buildTicks;
  // Walking there takes a few seconds; the building itself takes build / builders.
  assert.ok(times[0] - times[1] >= build / 2 - 40 && times[0] - times[1] <= build / 2 + 40, `1 vs 2 builders: ${times}`);
  assert.ok(times[1] - times[2] >= build / 4 - 40 && times[1] - times[2] <= build / 4 + 40, `2 vs 4 builders: ${times}`);
});

test("placement: rock, trees, unexplored cells and farms outside farm land are refused; the sim agrees with the view", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const f = farmerAtBase(g, 0);
  const n = g.w.size;
  const tree = nodesNear(g, 0, NodeKind.Tree)[0];
  cmd(g, 0, { c: "build", u: [f], type: BuildingType.House, x: g.w.nodeX[tree], y: g.w.nodeY[tree] });
  assert.deepEqual(step(g), [Reject.BadPlacement], "on a tree");
  const far = g.w.map.spawns[1];
  cmd(g, 0, { c: "build", u: [f], type: BuildingType.House, x: far.cellX + 6, y: far.cellY + 6 });
  assert.deepEqual(step(g), [Reject.BadPlacement], "unexplored");
  const m = mainCityCell(g, 0);
  cmd(g, 0, { c: "build", u: [f], type: BuildingType.House, x: m.x + 1, y: m.y + 1 });
  assert.deepEqual(step(g), [Reject.BadPlacement], "on the main city");
  cmd(g, 0, { c: "build", u: [f], type: BuildingType.MainCity, x: m.x + 8, y: m.y });
  assert.deepEqual(step(g), [Reject.NotAvailable], "main cities are not built");
  // Farm land: every cell of the view that says FarmLand is within 6 of the main city.
  const view = buildView(g, 0);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const land = (view.placement[y * n + x] & PlaceBit.FarmLand) !== 0;
      const dx = Math.max(m.x - x, 0, x - (m.x + 3));
      const dy = Math.max(m.y - y, 0, y - (m.y + 3));
      assert.equal(land, Math.max(dx, dy) <= 6, `farm land at ${x},${y}`);
    }
  }
  // The view's verdict and the simulation's agree around the base (nothing hidden there).
  let checked = 0;
  for (let y = m.y - 9; y <= m.y + 9; y += 3) {
    for (let x = m.x - 9; x <= m.x + 9; x += 3) {
      for (const type of [BuildingType.House, BuildingType.Farm]) {
        const h = emptyGame();
        h.w.ecoOn[0] = 0;
        const hf = farmerAtBase(h, 0);
        const v = buildView(h, 0);
        const expect = checkPlacement({ size: n, cells: v.placement }, BUILDINGS[type], x, y);
        cmd(h, 0, { c: "build", u: [hf], type, x, y });
        const got = step(h);
        assert.deepEqual(got, expect === 0 ? [] : [Reject.BadPlacement], `${type} at ${x},${y}`);
        checked++;
      }
    }
  }
  assert.ok(checked > 50);
});

test("cannot afford, and units on the footprint are pushed aside", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const f = farmerAtBase(g, 0);
  const at = spot(g, 0, BuildingType.Barracks);
  g.w.res[Resource.Wood] = 100;
  cmd(g, 0, { c: "build", u: [f], type: BuildingType.Barracks, x: at.x, y: at.y });
  assert.deepEqual(step(g), [Reject.CannotAfford]);
  g.w.res[Resource.Wood] = 500;
  const standing = put(g, 0, UnitType.Spearman, at.x + 1, at.y + 1);
  cmd(g, 0, { c: "build", u: [f], type: BuildingType.Barracks, x: at.x, y: at.y });
  assert.deepEqual(step(g), []);
  const s = slotOf(g, standing);
  const u = g.w.units.col;
  assert.ok(g.w.walkable(u.x[s] >> CELL_SHIFT, u.y[s] >> CELL_SHIFT), "pushed onto an open cell");
});

test("train: pays, queues, spawns after the training time; queue, population and cancel rules", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const mc = g.w.buildings.col.id[g.w.mainCity(0)];
  const food0 = g.w.res[Resource.Food];
  cmd(g, 0, { c: "train", building: mc, type: UnitType.Farmer, n: 2 });
  assert.deepEqual(step(g), []);
  assert.equal(g.w.res[Resource.Food], food0 - 2 * UNITS[UnitType.Farmer].cost.food);
  cmd(g, 0, { c: "train", building: mc, type: UnitType.Spearman, n: 1 });
  assert.deepEqual(step(g), [Reject.NotAvailable], "a main city trains farmers only");
  g.w.res[Resource.Food] = 10000;
  cmd(g, 0, { c: "train", building: mc, type: UnitType.Farmer, n: 6 });
  assert.deepEqual(step(g), [Reject.QueueFull], "2 + 6 > 7");
  cmd(g, 0, { c: "train", building: mc, type: UnitType.Farmer, n: 5 });
  assert.deepEqual(step(g), [], "2 + 5 = 7 queued, 7 <= cap 10");
  cmd(g, 0, { c: "cancel_train", building: mc, index: 6 });
  assert.deepEqual(step(g), []);
  assert.equal(g.w.res[Resource.Food], 10000 - 5 * 50 + 50);
  for (let k = 0; k < 4; k++) put(g, 0, UnitType.Spearman, 40, 60 + k);
  cmd(g, 0, { c: "train", building: mc, type: UnitType.Farmer, n: 1 });
  assert.deepEqual(step(g), [Reject.PopulationCap], "4 units + 6 queued + 1 > 10");
  const view = buildView(g, 0);
  assert.equal(view.header[HeaderField.population], 4);
  // The head finishes after 12 s.
  const trained: number[] = [];
  for (let t = 0; t < UNITS[UnitType.Farmer].trainTicks + 5; t++) {
    g.step();
    for (const e of g.events) if (e.ev.k === "unit_trained") trained.push(e.ev.id);
  }
  assert.equal(trained.length, 1);
  assert.equal(g.w.trained[UnitType.Farmer], 1);
  assert.equal(g.w.units.col.type[slotOf(g, trained[0])], UnitType.Farmer);
});

test("the queue head waits at 100% while the population is full", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const mc = g.w.buildings.col.id[g.w.mainCity(0)];
  for (let k = 0; k < 9; k++) put(g, 0, UnitType.Spearman, 40, 55 + k);
  cmd(g, 0, { c: "train", building: mc, type: UnitType.Farmer, n: 1 });
  assert.deepEqual(step(g), []);
  put(g, 0, UnitType.Spearman, 41, 55); // now 10 / 10
  run(g, UNITS[UnitType.Farmer].trainTicks + 20);
  const s = g.w.mainCity(0);
  assert.equal(g.w.buildings.col.queueLength[s], 1, "still waiting");
  const row = buildView(g, 0).buildings;
  assert.equal(row[9], 1000, "queueProgress is permille, at 1000");
});

test("rally on a tree sends a new farmer to gather it", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const mc = g.w.buildings.col.id[g.w.mainCity(0)];
  const tree = nodesNear(g, 0, NodeKind.Tree)[0];
  cmd(g, 0, { c: "rally", building: mc, x: g.w.nodeX[tree], y: g.w.nodeY[tree] });
  cmd(g, 0, { c: "train", building: mc, type: UnitType.Farmer, n: 1 });
  assert.deepEqual(step(g), []);
  let id = -1;
  for (let t = 0; t < 300 && id < 0; t++) {
    g.step();
    for (const e of g.events) if (e.ev.k === "unit_trained") id = e.ev.id;
  }
  const s = slotOf(g, id);
  assert.equal(g.w.units.col.order[s], Order.Gather);
  assert.equal(g.w.units.col.orderTarget[s], tree);
});

test("repair: 5 hp per second per farmer; idle farmers repair nearby damage on their own", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const mcSlot = g.w.mainCity(0);
  const mc = g.w.buildings.col.id[mcSlot];
  g.w.buildings.col.hp[mcSlot] = 1000;
  const a = farmerAtBase(g, 0, 0);
  cmd(g, 0, { c: "repair", u: [a], building: mc });
  assert.deepEqual(step(g), []);
  run(g, 20);
  const hp1 = g.w.buildings.col.hp[mcSlot];
  run(g, 40);
  assert.equal(g.w.buildings.col.hp[mcSlot] - hp1, 10, "one farmer: 10 hp in 2 s");
  // b is idle beside the damaged main city: auto-repair picks it up at the next pass.
  const b = farmerAtBase(g, 0, 1);
  run(g, 20);
  assert.equal(g.w.units.col.order[slotOf(g, b)], Order.Repair);
  const hp2 = g.w.buildings.col.hp[mcSlot];
  run(g, 40);
  assert.equal(g.w.buildings.col.hp[mcSlot] - hp2, 20, "two farmers: 20 hp in 2 s");
  cmd(g, 0, { c: "repair", u: [a], building: g.w.buildings.col.id[g.w.mainCity(1)] });
  assert.deepEqual(step(g), [Reject.NotOwner]);
});

test("farm: built on farm land, the builder farms it, one farmer per farm", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const a = farmerAtBase(g, 0, 0);
  const b = farmerAtBase(g, 0, 1);
  const at = spot(g, 0, BuildingType.Farm);
  cmd(g, 0, { c: "build", u: [a], type: BuildingType.Farm, x: at.x, y: at.y });
  assert.deepEqual(step(g), []);
  const farm = g.w.buildingAt[at.y * g.w.size + at.x];
  assert.ok(g.w.walkable(at.x + 1, at.y + 1), "farms can be walked over");
  run(g, BUILDINGS[BuildingType.Farm].buildTicks + 200);
  const u = g.w.units.col;
  assert.equal(u.order[slotOf(g, a)], Order.Gather);
  assert.equal(u.onFarm[slotOf(g, a)], 1);
  assert.equal(u.orderTarget[slotOf(g, a)], farm);
  cmd(g, 0, { c: "repair", u: [b], building: farm });
  assert.deepEqual(step(g), [Reject.NotAvailable], "the farm already has its farmer");
  const food0 = g.w.res[Resource.Food];
  run(g, 1200);
  assert.ok(g.w.res[Resource.Food] >= food0 + 10, "food came in from the farm");
});

test("recall: farmers hide in the main city (15) and houses (5), arrows grow, and they go back to work", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const at = spot(g, 0, BuildingType.House);
  g.w.addBuilding(0, BuildingType.House, at.x, at.y, BUILDINGS[BuildingType.House].hp, 1000);
  const tree = nodesNear(g, 0, NodeKind.Tree)[0];
  const ids: number[] = [];
  for (let k = 0; k < 22; k++) ids.push(farmerAtBase(g, 0, k % 4));
  cmd(g, 0, { c: "gather", u: ids.slice(0, 5), node: tree });
  run(g, 60);
  cmd(g, 0, { c: "recall", on: true });
  run(g, 400);
  const u = g.w.units.col;
  const b = g.w.buildings.col;
  const hidden = ids.filter((id) => u.action[slotOf(g, id)] === Action.Garrisoned).length;
  assert.equal(hidden, 20, "15 + 5 hidden, 2 wait outside");
  assert.equal(b.garrisoned[g.w.mainCity(0)], 15);
  assert.equal(buildView(g, 0).header[HeaderField.recall], 1);
  // Hidden farmers are not in the enemy's view, and cannot be targeted.
  const p1 = buildView(g, 1);
  for (let r = 0; r < p1.units.length; r += UNIT_STRIDE) assert.notEqual(p1.units[r + UnitField.action], Action.Garrisoned);
  // The main city shoots 1 + 10 arrows.
  const m = mainCityCell(g, 0);
  const raider = put(g, 1, UnitType.Spearman, m.x + 6, m.y + 2);
  g.fog.update(g.w);
  const hp0 = u.hp[slotOf(g, raider)];
  run(g, MAIN_ARROW.cooldown + 1);
  assert.equal(hp0 - u.hp[slotOf(g, raider)], MAIN_ARROW.damage * (1 + MAIN_ARROW.extraMax));
  // A rejected command leaves hidden farmers inside; an accepted one lets them out.
  const inside = ids.slice(5).find((id) => u.action[slotOf(g, id)] === Action.Garrisoned)!;
  cmd(g, 0, { c: "move", u: [inside], x: -5, y: 3 });
  assert.deepEqual(step(g), [Reject.InvalidTarget]);
  assert.equal(u.action[slotOf(g, inside)], Action.Garrisoned, "still hidden after a rejected move");
  cmd(g, 0, { c: "stop", u: [inside] });
  assert.deepEqual(step(g), []);
  assert.notEqual(u.action[slotOf(g, inside)], Action.Garrisoned, "out after an accepted stop");
  cmd(g, 0, { c: "recall", on: false });
  run(g, 1);
  assert.equal(b.garrisoned[g.w.mainCity(0)], 0);
  for (const id of ids.slice(0, 5)) {
    const s = slotOf(g, id);
    assert.equal(u.order[s], Order.Gather, "back to work");
  }
});

test("farmers do not pick fights on their own, and keep working near enemies", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  // A tree out of the main city's arrow range, so only farmers could hurt the enemy farmer.
  const s0 = g.w.map.spawns[0];
  const tree = nodesNear(g, 0, NodeKind.Tree).find((k) => {
    const x = g.w.nodeX[k];
    const y = g.w.nodeY[k];
    return (x - s0.cellX) ** 2 + (y - s0.cellY) ** 2 > 14 * 14 && g.w.walkable(x + 1, y) && g.w.walkable(x + 3, y) && g.w.walkable(x + 1, y + 2);
  })!;
  const f = put(g, 0, UnitType.Farmer, g.w.nodeX[tree] + 1, g.w.nodeY[tree]);
  const idle = put(g, 0, UnitType.Farmer, g.w.nodeX[tree] + 1, g.w.nodeY[tree] + 2);
  const enemy = put(g, 1, UnitType.Farmer, g.w.nodeX[tree] + 3, g.w.nodeY[tree]);
  g.w.ecoOn[1] = 0;
  g.fog.update(g.w);
  cmd(g, 0, { c: "gather", u: [f], node: tree });
  run(g, 100);
  assert.equal(g.w.units.col.hp[slotOf(g, enemy)], UNITS[UnitType.Farmer].hp);
  assert.equal(g.w.units.col.order[slotOf(g, f)], Order.Gather);
  assert.equal(g.w.units.col.order[slotOf(g, idle)], Order.None);
});

test("e2e scenario: resources, finished houses and barracks, squads by the small town, mirrored", () => {
  const g = new Game({ seed: 1, scenario: "e2e" });
  const w = g.w;
  assert.equal(w.res[Resource.Wood], 2000);
  assert.equal(w.populationCap(0), 20);
  assert.equal(w.population(0), 15);
  const u = w.units.col;
  const squad = (p: number) => {
    const out: string[] = [];
    for (let s = 0; s < w.units.count; s++) {
      if (u.owner[s] !== p || u.type[s] === UnitType.Farmer) continue;
      const x = u.x[s] >> CELL_SHIFT;
      const y = u.y[s] >> CELL_SHIFT;
      out.push(`${u.type[s]}:${p === 0 ? x : y},${p === 0 ? y : x}`);
    }
    return out.sort();
  };
  assert.equal(squad(0).length, 10);
  assert.deepEqual(squad(0), squad(1), "player 1's squad mirrors player 0's");
  const town = w.map.towns[0];
  for (let s = 0; s < w.units.count; s++) {
    if (u.owner[s] > 1 || u.type[s] === UnitType.Farmer) continue;
    const dx = (u.x[s] >> CELL_SHIFT) - town.cellX;
    const dy = (u.y[s] >> CELL_SHIFT) - town.cellY;
    assert.ok(dx * dx + dy * dy >= 100, "at least 10 cells from the town centre");
  }
  let barracks = -1;
  for (let s = 0; s < w.buildings.count; s++) {
    if (w.buildings.col.owner[s] === 0 && w.buildings.col.type[s] === BuildingType.Barracks) barracks = w.buildings.col.id[s];
  }
  cmd(g, 0, { c: "train", building: barracks, type: UnitType.Spearman, n: 3 });
  assert.deepEqual(step(g), []);
  run(g, 3 * UNITS[UnitType.Spearman].trainTicks + 20);
  assert.equal(w.trained[UnitType.Spearman], 3);
});

test("a farmer the player sends somewhere waits there: automatic work leaves it alone until it gets work", () => {
  const g = emptyGame();
  const m = mainCityCell(g, 0);
  const f = farmerAtBase(g, 0);
  const stopped = farmerAtBase(g, 0, 2);
  const tree = nodesNear(g, 0, NodeKind.Tree)[0];
  // `stopped` is working when the player stops it.
  cmd(g, 0, { c: "gather", u: [stopped], node: tree });
  run(g, 30);
  cmd(g, 0, { c: "stop", u: [stopped] });
  const to = { x: m.x + 12, y: m.y - 6 };
  cmd(g, 0, { c: "move", u: [f], x: to.x, y: to.y });
  // Damage the main city too: auto-repair must not take them either.
  g.w.buildings.col.hp[g.w.mainCity(0)] -= 100;
  run(g, 600);
  const u = g.w.units.col;
  const s = slotOf(g, f);
  assert.equal(u.order[s], Order.None, "still waiting after many economy passes");
  assert.ok(Math.abs((u.x[s] >> CELL_SHIFT) - to.x) <= 1 && Math.abs((u.y[s] >> CELL_SHIFT) - to.y) <= 1, "where it was sent");
  assert.equal(u.order[slotOf(g, stopped)], Order.None, "a stopped farmer waits too");
  const view = buildView(g, 0);
  assert.ok(view.idleFarmers.includes(f) && view.idleFarmers.includes(stopped), "counted as idle");
  // Work ends the waiting: a gather, and when that work runs out, the ratio takes over.
  g.w.nodeAmount[tree] = 2;
  cmd(g, 0, { c: "gather", u: [stopped], node: tree });
  run(g, 2);
  assert.equal(u.stay[slotOf(g, stopped)], 0);
});

test("farmers whose work ended, and new farmers, still go to the economy ratio", () => {
  const g = emptyGame();
  const builder = farmerAtBase(g, 0);
  const at = spot(g, 0, BuildingType.House);
  cmd(g, 0, { c: "build", u: [builder], type: BuildingType.House, x: at.x, y: at.y });
  let done = false;
  for (let t = 0; t < 1000 && !done; t++) {
    g.step();
    done = g.events.some((e) => e.to === 0 && e.ev.k === "building_done");
  }
  assert.ok(done);
  run(g, 45);
  assert.equal(g.w.units.col.order[slotOf(g, builder)], Order.Gather, "house done: the ratio sends it on");
  const mc = g.w.buildings.col.id[g.w.mainCity(0)];
  cmd(g, 0, { c: "train", building: mc, type: UnitType.Farmer, n: 1 });
  let id = -1;
  for (let t = 0; t < 300 && id < 0; t++) {
    g.step();
    for (const e of g.events) if (e.ev.k === "unit_trained") id = e.ev.id;
  }
  run(g, 25);
  assert.equal(g.w.units.col.order[slotOf(g, id)], Order.Gather, "a new farmer goes to work");
});

test("recall still takes waiting farmers, and they wait again afterwards", () => {
  const g = emptyGame();
  const m = mainCityCell(g, 0);
  const f = farmerAtBase(g, 0);
  cmd(g, 0, { c: "move", u: [f], x: m.x + 6, y: m.y });
  run(g, 200);
  cmd(g, 0, { c: "recall", on: true });
  run(g, 200);
  const u = g.w.units.col;
  assert.equal(u.action[slotOf(g, f)], Action.Garrisoned);
  cmd(g, 0, { c: "recall", on: false });
  run(g, 200);
  assert.equal(u.order[slotOf(g, f)], Order.None, "back to waiting, not sent to work");
  assert.equal(u.stay[slotOf(g, f)], 1);
});

test("a main city cannot be repaired within 10 s of being hit; other buildings can", () => {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  const b = g.w.buildings.col;
  const mc = g.w.mainCity(0);
  b.hp[mc] = 1000;
  const f = farmerAtBase(g, 0);
  cmd(g, 0, { c: "repair", u: [f], building: b.id[mc] });
  run(g, 20);
  b.lastHurt[mc] = g.tick; // hit now
  const hp0 = b.hp[mc];
  run(g, MAIN_CITY_REPAIR_LOCK - 1);
  assert.equal(b.hp[mc], hp0, "no repair for 10 s after a hit");
  assert.equal(g.w.units.col.order[slotOf(g, f)], Order.Repair, "the repairer waits");
  const flags = () => buildView(g, 0).buildings[g.w.mainCity(0) * BUILDING_STRIDE + BuildingField.flags];
  assert.ok((flags() & BuildingFlag.RepairLocked) !== 0, "the snapshot says the main city is locked");
  run(g, 41);
  assert.ok(b.hp[mc] > hp0, "then repair resumes");
  assert.equal(flags() & BuildingFlag.RepairLocked, 0, "and the flag is gone");
  // A house repairs straight after a hit.
  const at = spot(g, 0, BuildingType.House);
  const house = g.w.addBuilding(0, BuildingType.House, at.x, at.y, 100, 1000);
  const hs = g.w.building(house);
  b.lastHurt[hs] = g.tick;
  const h = farmerAtBase(g, 0, 2);
  cmd(g, 0, { c: "repair", u: [h], building: house });
  run(g, 200);
  assert.ok(b.hp[hs] > 100, "houses repair at once");
});

test("a build without farmers sends the nearest free ones: 1 for 2 x 2, 2 for 3 x 3, not placed, busy, hidden or vein farmers", () => {
  const g = emptyGame();
  const w = g.w;
  w.ecoOn[0] = 0;
  const u = w.units.col;
  const vein = Array.from(w.nodeKind).findIndex((k) => k === NodeKind.CrystalVein);
  // Nearest first: placed by the player, building, hiding, on the vein; then three free ones,
  // two of them on the same spot (ties go to the lower id).
  const placed = farmerAtBase(g, 0, 0);
  const building = farmerAtBase(g, 0, 1);
  const hiding = farmerAtBase(g, 0, 2);
  const onVein = farmerAtBase(g, 0, 3);
  const near = farmerAtBase(g, 0, 5);
  const tieA = farmerAtBase(g, 0, 7);
  const tieB = farmerAtBase(g, 0, 7);
  u.stay[slotOf(g, placed)] = 1;
  u.order[slotOf(g, building)] = Order.Build;
  u.orderTarget[slotOf(g, building)] = w.buildings.col.id[w.mainCity(0)];
  u.action[slotOf(g, hiding)] = Action.Garrisoned;
  u.order[slotOf(g, onVein)] = Order.Gather;
  u.orderTarget[slotOf(g, onVein)] = vein;
  const house = spot(g, 0, BuildingType.House);
  cmd(g, 0, { c: "build", u: [], type: BuildingType.House, x: house.x, y: house.y });
  assert.deepEqual(step(g), []);
  const houseId = w.buildingAt[house.y * w.size + house.x];
  const builders = (id: number) => [placed, building, hiding, onVein, near, tieA, tieB].filter((f) => u.order[slotOf(g, f)] === Order.Build && u.orderTarget[slotOf(g, f)] === id);
  assert.deepEqual(builders(houseId), [near], "one farmer, the nearest free one");
  const barracks = spot(g, 0, BuildingType.Barracks, 2);
  cmd(g, 0, { c: "build", u: [], type: BuildingType.Barracks, x: barracks.x, y: barracks.y });
  assert.deepEqual(step(g), []);
  assert.deepEqual(builders(w.buildingAt[barracks.y * w.size + barracks.x]), [tieA, tieB], "two for a 3 x 3");
  assert.equal(u.stay[slotOf(g, near)], 0, "not placed: the economy may take it afterwards");
});

test("a build without farmers and nobody free is refused with NoFarmer: nothing placed, nothing paid", () => {
  const g = emptyGame();
  const w = g.w;
  const f = farmerAtBase(g, 0);
  w.units.col.stay[slotOf(g, f)] = 1;
  const at = spot(g, 0, BuildingType.House);
  const wood = w.res[Resource.Wood];
  const count = w.buildings.count;
  cmd(g, 0, { c: "build", u: [], type: BuildingType.House, x: at.x, y: at.y });
  assert.deepEqual(step(g), [Reject.NoFarmer]);
  assert.equal(w.res[Resource.Wood], wood);
  assert.equal(w.buildings.count, count);
  // The other checks come first.
  w.res[Resource.Wood] = 0;
  cmd(g, 0, { c: "build", u: [], type: BuildingType.House, x: at.x, y: at.y });
  assert.deepEqual(step(g), [Reject.CannotAfford]);
});

test("a farmer the simulation sent to build goes back to what it gathered, or to the economy when that is gone", () => {
  for (const gone of [false, true]) {
    const g = emptyGame();
    const w = g.w;
    w.ecoOn[0] = 0;
    const f = farmerAtBase(g, 0);
    const tree = nodesNear(g, 0, NodeKind.Tree)[0];
    cmd(g, 0, { c: "gather", u: [f], node: tree });
    run(g, 20);
    const at = spot(g, 0, BuildingType.House);
    cmd(g, 0, { c: "build", u: [], type: BuildingType.House, x: at.x, y: at.y });
    assert.deepEqual(step(g), []);
    const u = w.units.col;
    assert.equal(u.order[slotOf(g, f)], Order.Build);
    if (gone) w.nodeAmount[tree] = 0;
    let done = false;
    for (let t = 0; t < 1500 && !done; t++) {
      g.step();
      done = g.events.some((e) => e.to === 0 && e.ev.k === "building_done");
    }
    assert.ok(done, "the house is built");
    run(g, 2);
    const s = slotOf(g, f);
    if (gone) assert.equal(u.order[s], Order.None, "its tree is gone: idle, for the economy ratio");
    else assert.deepEqual([u.order[s], u.orderTarget[s]], [Order.Gather, tree], "back to its tree");
    assert.equal(u.stay[s], 0);
  }
});

// --- operations round (D-050): the ratio for farmers already at work --------------------

/** What farmer slot s is gathering: Resource, Crystal (3) for the vein, -1 if not gathering. */
function gatheringOf(g: Game, s: number): number {
  const u = g.w.units.col;
  if (u.order[s] !== Order.Gather) return -1;
  if (u.onFarm[s] === 1) return Resource.Food;
  const kind = g.w.nodeKind[u.orderTarget[s]];
  return kind === NodeKind.Tree ? Resource.Wood : kind === NodeKind.GoldMine ? Resource.Gold : kind === NodeKind.Berries ? Resource.Food : Resource.Crystal;
}

function shares(g: Game, ids: number[]): number[] {
  const count = [0, 0, 0, 0];
  for (const id of ids) {
    const r = gatheringOf(g, slotOf(g, id));
    if (r >= 0) count[r]++;
  }
  return count;
}

/** Player p's farmers beside its main city, player 1's the mirror image of player 0's. */
function mirroredFarmers(g: Game, p: number, n: number): number[] {
  const m = mainCityCell(g, p);
  const ids: number[] = [];
  for (let k = 0; k < n; k++) ids.push(p === 0 ? put(g, 0, UnitType.Farmer, m.x + 4, m.y + (k % 4)) : put(g, 1, UnitType.Farmer, m.x + (k % 4), m.y + 4));
  return ids;
}

test("a new ratio moves farmers already at work within 2 s, each share within one farmer, mirrored", () => {
  const g = emptyGame();
  const ids = [mirroredFarmers(g, 0, 12), mirroredFarmers(g, 1, 12)];
  run(g, 200);
  assert.deepEqual(shares(g, ids[0]), shares(g, ids[1]));
  const before = shares(g, ids[0]);
  for (const p of [0, 1]) cmd(g, p, { c: "eco_ratio", food: 10, wood: 20, gold: 70, on: true });
  run(g, 40);
  for (const p of [0, 1]) {
    const now = shares(g, ids[p]);
    [10, 20, 70].forEach((r, k) => assert.ok(Math.abs(now[k] - (r * 12) / 100) <= 1, `player ${p} resource ${k}: ${now[k]} of 12 for ${r}%`));
    assert.notDeepEqual(now, before, "farmers moved");
  }
  // Mirrored: the same work, the mirror image of each node.
  const w = g.w;
  const u = w.units.col;
  const work = (p: number) =>
    ids[p]
      .map((id) => {
        const s = slotOf(g, id);
        const t = u.orderTarget[s];
        return u.onFarm[s] === 1 || t < 0 ? "-" : p === 0 ? `${w.nodeX[t]},${w.nodeY[t]}` : `${w.nodeY[t]},${w.nodeX[t]}`;
      })
      .sort();
  assert.deepEqual(work(0), work(1));
});

test("the ratio does not move farmers sent by hand, on the vein, placed, or building; the others follow it", () => {
  const g = emptyGame();
  const w = g.w;
  const u = w.units.col;
  const ids = mirroredFarmers(g, 0, 10);
  run(g, 100);
  const tree = nodesNear(g, 0, NodeKind.Tree)[0];
  const hand = ids.slice(0, 3);
  cmd(g, 0, { c: "gather", u: hand, node: tree });
  const vein = Array.from(w.nodeKind).findIndex((k) => k === NodeKind.CrystalVein);
  g.fog.nodeSeen[0][vein] = 0;
  cmd(g, 0, { c: "gather", u: [ids[3]], node: vein });
  const m = mainCityCell(g, 0);
  cmd(g, 0, { c: "move", u: [ids[4]], x: m.x + 8, y: m.y - 4 });
  const at = spot(g, 0, BuildingType.House);
  cmd(g, 0, { c: "build", u: [ids[5]], type: BuildingType.House, x: at.x, y: at.y });
  run(g, 2);
  for (const id of hand) assert.ok((u.flags[slotOf(g, id)] & UnitFlag.HandPicked) !== 0, "sent by hand");
  const view = buildView(g, 0);
  const row = [...view.units].findIndex((_, i) => i % UNIT_STRIDE === 0 && view.units[i] === hand[0]);
  assert.ok((view.units[row + UnitField.flags] & UnitFlag.HandPicked) !== 0, "the view says so");
  cmd(g, 0, { c: "eco_ratio", food: 0, wood: 0, gold: 100, on: true });
  run(g, 60);
  for (const id of hand) assert.equal(u.orderTarget[slotOf(g, id)], tree, "still on the tree it was sent to");
  assert.equal(gatheringOf(g, slotOf(g, ids[3])), Resource.Crystal, "still on the vein");
  assert.ok([Order.Move, Order.None].includes(u.order[slotOf(g, ids[4])] as never), "still going to, or waiting at, where it was placed");
  assert.equal(u.order[slotOf(g, ids[5])], Order.Build, "still building");
  for (const id of ids.slice(6)) assert.equal(gatheringOf(g, slotOf(g, id)), Resource.Gold, "the others went to gold");
  // Another command takes a farmer off the job it was sent to by hand.
  cmd(g, 0, { c: "stop", u: [hand[0]] });
  run(g, 1);
  assert.equal(u.flags[slotOf(g, hand[0])] & UnitFlag.HandPicked, 0);
});

test("with the ratio unchanged, no farmer is moved back and forth", () => {
  const g = emptyGame();
  const ids = mirroredFarmers(g, 0, 15);
  run(g, 100);
  const u = g.w.units.col;
  const last = new Map<number, { r: number; t: number }>();
  let moved = 0;
  for (let t = 0; t < 1200; t++) {
    g.step();
    for (const id of ids) {
      const s = slotOf(g, id);
      const r = gatheringOf(g, s);
      const prev = last.get(id);
      // Moved by the ratio: on to another resource while the old node was still there.
      if (prev && r >= 0 && prev.r >= 0 && r !== prev.r && prev.t >= 0 && g.w.nodeAmount[prev.t] > 0) moved++;
      last.set(id, { r, t: u.onFarm[s] === 1 ? -1 : u.orderTarget[s] });
    }
  }
  assert.equal(moved, 0);
});
