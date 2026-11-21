// 游標 (R26 05, ceo 2026-11-21): the cursor is what the right button would do there, read off the very orders it gives
// (commandIntents; Game.rightPlan adds 進駐). Each case: the orders the right button sends there and the cursor shown,
// side by side, so that the two cannot drift apart. Sword > gate > hammer > axe where two hold.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cursorFor } from "../src/input/cursor.ts";
import { commandIntents, type Intent } from "../src/input/intent.ts";
import { BuildingType, NEUTRAL, NodeKind, UnitType } from "../src/sim.ts";
import { at, ENEMY, FakeWorld, ME } from "./fakes.ts";

const R = 22;
const SPEAR = { id: 1, owner: ME, type: UnitType.Spearman, cx: 10, cy: 10 };
const RANGED = { id: 2, owner: ME, type: UnitType.Ranged, cx: 12, cy: 10 };
const FARMER = { id: 3, owner: ME, type: UnitType.Farmer, cx: 20, cy: 20 };
const FOE = { id: 9, owner: ENEMY, type: UnitType.Spearman, cx: 30, cy: 30 };
const MILITIA = { id: 10, owner: NEUTRAL, type: UnitType.Militia, cx: 32, cy: 30 };
const FOE_BARRACKS = { kind: "building" as const, id: 40, owner: ENEMY, type: BuildingType.Barracks, cx: 40, cy: 40 };
const GATE = { kind: "building" as const, id: 41, owner: NEUTRAL, type: BuildingType.Gate, cx: 42, cy: 40 };
const SITE = { kind: "building" as const, id: 50, owner: ME, type: BuildingType.House, cx: 44, cy: 44, needsWork: true };
const BARRACKS = { kind: "building" as const, id: 51, owner: ME, type: BuildingType.Barracks, cx: 46, cy: 44 };
// Farms always have work for farmers (the sim's repair there farms them); a finished one, unhurt, is farmed.
const FIELD = { kind: "building" as const, id: 52, owner: ME, type: BuildingType.Farm, cx: 48, cy: 44, needsWork: true };
const TREE = { kind: "node" as const, id: 60, owner: 0, type: NodeKind.Tree, cx: 50, cy: 50 };
const BERRIES = { kind: "node" as const, id: 61, owner: 0, type: NodeKind.Berries, cx: 52, cy: 50 };

function world(): FakeWorld {
  const w = new FakeWorld([SPEAR, RANGED, FARMER, FOE, MILITIA], [FOE_BARRACKS, GATE, SITE, BARRACKS, FIELD, TREE, BERRIES]);
  // A neutral town (D-100: its ground is an attack on it while its keep stands).
  w.towns = [{ id: 70, owner: NEUTRAL, size: 1, x0: 60, y0: 60, x1: 66, y1: 66, keep: { x: 63, y: 63 } }];
  w.keeps = true;
  return w;
}

/** What the right button sends: each order's kind (a command's `c`, else the intent's kind). */
const sent = (orders: Intent[]): string[] => orders.map((i) => (i.kind === "command" ? i.cmd.c : i.kind));

const SOLDIERS = [1, 2];
const FARMERS = [3];
const BOTH = [1, 2, 3];

const CASES: { name: string; units: number[]; cell: [number, number]; orders: string[]; cursor: string | null }[] = [
  { name: "兵、敵人的兵", units: SOLDIERS, cell: [30, 30], orders: ["attack"], cursor: "sword" },
  { name: "兵、中立的民兵（打得到）", units: SOLDIERS, cell: [32, 30], orders: ["attack"], cursor: "sword" },
  { name: "兵、敵人的建築", units: SOLDIERS, cell: [40, 40], orders: ["attack"], cursor: "sword" },
  { name: "兵、中立的城門", units: SOLDIERS, cell: [42, 40], orders: ["attack"], cursor: "sword" },
  { name: "兵、別人的城鎮地面（打那座城）", units: SOLDIERS, cell: [61, 61], orders: ["move", "townAttack"], cursor: "sword" },
  // ceo 2026-11-21 (1): farmers alone on an enemy go and fight it: a sword.
  { name: "只選村民、敵人的兵", units: FARMERS, cell: [30, 30], orders: ["attack"], cursor: "sword" },
  { name: "只選村民、樹", units: FARMERS, cell: [50, 50], orders: ["gather"], cursor: "axe" },
  { name: "只選村民、漿果", units: FARMERS, cell: [52, 50], orders: ["gather"], cursor: "axe" },
  { name: "只選村民、自己蓋到一半的建築", units: FARMERS, cell: [44, 44], orders: ["repair"], cursor: "hammer" },
  // A finished field: they farm it (food), an axe; the sim's order is a repair all the same.
  { name: "只選村民、自己蓋好的田", units: FARMERS, cell: [48, 44], orders: ["repair"], cursor: "axe" },
  // ceo 2026-11-21 (2): soldiers and farmers: the farmers gather (the soldiers walk), or repair (the soldiers stay).
  { name: "兵和村民、樹", units: BOTH, cell: [50, 50], orders: ["gather", "retreat"], cursor: "axe" },
  { name: "兵和村民、自己蓋到一半的建築", units: BOTH, cell: [44, 44], orders: ["repair"], cursor: "hammer" },
  { name: "兵和村民、敵人的兵", units: BOTH, cell: [30, 30], orders: ["attack"], cursor: "sword" },
  { name: "兵、地面（走過去）", units: SOLDIERS, cell: [80, 80], orders: ["retreat"], cursor: null },
  { name: "兵、自己好好的兵營（走過去）", units: SOLDIERS, cell: [46, 44], orders: ["retreat"], cursor: null },
  { name: "兵、自己的村民（走過去）", units: SOLDIERS, cell: [20, 20], orders: ["retreat"], cursor: null },
  { name: "只選村民、自己好好的兵營（走過去）", units: FARMERS, cell: [46, 44], orders: ["move"], cursor: null },
  { name: "什麼都沒選", units: [], cell: [30, 30], orders: [], cursor: null },
];

test("游標＝右鍵在那裡會下的指令（ceo 2026-11-21）：攻擊→劍、採集→斧頭、蓋修→鎚子、走過去或不做事→箭頭", () => {
  const w = world();
  for (const c of CASES) {
    const orders = commandIntents(w, { units: c.units, building: null }, at(c.cell[0]), at(c.cell[1]), R);
    assert.deepEqual(sent(orders), c.orders, `${c.name}: the right button's orders`);
    assert.equal(cursorFor(orders, false, (id) => id === FIELD.id), c.cursor, `${c.name}: the cursor`);
  }
});

test("同一處兩種都成立：劍 > 城門 > 鎚子 > 斧頭（ceo 2026-11-21）；有人會進駐才是城門", () => {
  const attack: Intent = { kind: "command", cmd: { c: "attack", u: [1], target: 9 } };
  const repair: Intent = { kind: "command", cmd: { c: "repair", u: [3], building: 50 } };
  const gather: Intent = { kind: "command", cmd: { c: "gather", u: [3], node: 60 } };
  const walk: Intent = { kind: "command", cmd: { c: "retreat", u: [1], x: 5, y: 5 } };
  assert.equal(cursorFor([attack], true), "sword");
  assert.equal(cursorFor([walk], true), "gate", "a walk onto a place of ours someone goes into");
  assert.equal(cursorFor([repair], true), "gate");
  assert.equal(cursorFor([repair, gather], false), "hammer");
  assert.equal(cursorFor([repair], false, () => true), "axe", "a finished field: farmed");
  assert.equal(cursorFor([gather, walk], false), "axe");
  assert.equal(cursorFor([walk], false), null, "grey (nobody goes in): a walk, the arrow");
  assert.equal(cursorFor([], false), null);
});
