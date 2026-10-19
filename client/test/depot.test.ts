// 點存放建築派村民 (D-066): whom a depot counts, whom + sends and where, whom − takes.

import assert from "node:assert/strict";
import { test } from "node:test";
import { crystalSentText, DEPOT_REACH, type Depot, depotFor, NO_FARM_TEXT, panelResources, pickToSend, pickToTake, sendTarget, toFootprint, type Worker, workersAt } from "../src/game/depot.ts";
import { BuildingType, NodeKind, Resource } from "../src/sim.ts";

const W = (id: number, x: number, y: number, gathers: Resource | null, at: { x: number; y: number } | null, idle = false, busy = false): Worker => ({ id, x, y, gathers, at, idle, busy });
// A main city (everything), a lumber camp and a granary, in cells.
const city: Depot = { id: 1, cx: 10, cy: 10, size: 4, accepts: [Resource.Food, Resource.Wood, Resource.Gold, Resource.Crystal] };
const camp: Depot = { id: 2, cx: 30, cy: 10, size: 2, accepts: [Resource.Wood] };
const granary: Depot = { id: 3, cx: 10, cy: 30, size: 2, accepts: [Resource.Food] };
const depots = [city, camp, granary];

test("距離：到建築占地的距離，在占地裡是 0", () => {
  assert.equal(toFootprint({ x: 12, y: 12 }, city), 0);
  assert.equal(toFootprint({ x: 17, y: 12 }, city), 3);
  assert.equal(toFootprint({ x: 17, y: 18 }, city), 5);
});

test("在哪裡採：每名村民只算在他送回的那一棟，離採的地方最近、收這種資源的", () => {
  assert.equal(depotFor({ x: 25, y: 11 }, Resource.Wood, depots), camp.id, "the camp is nearer than the city");
  assert.equal(depotFor({ x: 18, y: 11 }, Resource.Wood, depots), city.id);
  assert.equal(depotFor({ x: 25, y: 11 }, Resource.Gold, depots), city.id, "the camp takes no gold");
  assert.equal(depotFor({ x: 11, y: 27 }, Resource.Food, depots), granary.id);
  assert.equal(depotFor({ x: 1, y: 1 }, Resource.Food, [camp]), null, "nowhere takes it");
  const workers = [
    W(1, 24, 11, Resource.Wood, { x: 25, y: 11 }),
    W(2, 17, 11, Resource.Wood, { x: 18, y: 11 }),
    W(3, 11, 26, Resource.Food, { x: 11, y: 27 }),
    W(4, 12, 9, null, null, true),
  ];
  assert.deepEqual(workersAt(workers, depots, camp.id, Resource.Wood).map((w) => w.id), [1]);
  assert.deepEqual(workersAt(workers, depots, city.id, Resource.Wood).map((w) => w.id), [2]);
  assert.deepEqual(workersAt(workers, depots, city.id, Resource.Food).map((w) => w.id), [], "the farmer by the granary counts there");
  assert.deepEqual(workersAt(workers, depots, granary.id, Resource.Food).map((w) => w.id), [3]);
});

test("＋派誰：閒置的先，近的先；沒有閒置的才從採別種資源的挑；採晶脈、蓋房子、修理的不挑", () => {
  const idleFar = W(1, 40, 40, null, null, true);
  const idleNear = W(2, 16, 12, null, null, true);
  const woodNear = W(3, 15, 11, Resource.Wood, { x: 16, y: 11 });
  const goldFar = W(4, 20, 20, Resource.Gold, { x: 21, y: 20 });
  const crystal = W(5, 14, 11, Resource.Crystal, { x: 14, y: 11 });
  const builder = W(6, 14, 12, null, null, false, true);
  assert.equal(pickToSend([idleFar, idleNear, woodNear, goldFar, crystal, builder], city, Resource.Wood), 2, "idle and near");
  assert.equal(pickToSend([idleFar, woodNear, goldFar], city, Resource.Wood), 1, "an idle one, however far, before anyone working");
  assert.equal(pickToSend([woodNear, goldFar, crystal, builder], city, Resource.Wood), 4, "not those on wood already, the vein or building");
  assert.equal(pickToSend([woodNear, goldFar], city, Resource.Gold), 3);
  assert.equal(pickToSend([crystal, builder, woodNear], city, Resource.Wood), null);
  // A builder that is idle-flagged does not go either (busy wins).
  assert.equal(pickToSend([W(7, 12, 12, null, null, true, true)], city, Resource.Wood), null);
});

test("－拿誰：在這裡採的人裡，離這棟最遠的那一名；沒有人就是 null", () => {
  const workers = [W(1, 17, 11, Resource.Wood, { x: 18, y: 11 }), W(2, 19, 11, Resource.Wood, { x: 20, y: 11 }), W(3, 25, 11, Resource.Wood, { x: 26, y: 11 })];
  assert.equal(pickToTake(workers, depots, city, Resource.Wood), 2, "3 brings its wood to the camp");
  assert.equal(pickToTake(workers, depots, camp, Resource.Wood), 3);
  assert.equal(pickToTake(workers, depots, city, Resource.Gold), null);
});

test("＋派去哪：木、金去 10 格內最近的樹、金礦；糧先去沒人種的田，再去野果，都沒有就提示先蓋田", () => {
  const nodes = [
    { id: 10, kind: NodeKind.Tree, cx: 20, cy: 11, amount: 100 },
    { id: 11, kind: NodeKind.Tree, cx: 16, cy: 11, amount: 100 },
    { id: 12, kind: NodeKind.Tree, cx: 15, cy: 12, amount: 0 },
    { id: 13, kind: NodeKind.GoldMine, cx: 10, cy: 10 + 4 + DEPOT_REACH + 2, amount: 800 },
    { id: 14, kind: NodeKind.Berries, cx: 9, cy: 15, amount: 50 },
  ];
  assert.deepEqual(sendTarget(city, Resource.Wood, nodes, []), { node: 11 }, "the nearest tree left");
  assert.deepEqual(sendTarget(city, Resource.Gold, nodes, []), { error: "附近沒有金礦" }, "beyond reach");
  const farms = [
    { id: 20, cx: 15, cy: 10, size: 3, taken: true },
    { id: 21, cx: 16, cy: 14, size: 3, taken: false },
  ];
  assert.deepEqual(sendTarget(city, Resource.Food, nodes, farms), { farm: 21 }, "a free farm before berries");
  assert.deepEqual(sendTarget(city, Resource.Food, nodes, [farms[0]]), { node: 14 }, "berries when every farm is worked");
  assert.deepEqual(sendTarget(city, Resource.Food, [], []), { error: NO_FARM_TEXT });
  assert.equal(NO_FARM_TEXT, "附近沒有空田，先蓋農田");
});

test("面板：糧倉、伐木場各一列，礦場金、晶兩列（使用者 2026-10-20）；主城不顯示（D-070），但照樣算存放建築", () => {
  const all = [Resource.Food, Resource.Wood, Resource.Gold, Resource.Crystal];
  assert.deepEqual(panelResources(BuildingType.MainCity, all), [], "「主城的那個附近在彩的村民沒有用，拿掉」");
  assert.deepEqual(panelResources(BuildingType.Granary, [Resource.Food]), [Resource.Food]);
  assert.deepEqual(panelResources(BuildingType.LumberCamp, [Resource.Wood]), [Resource.Wood]);
  assert.deepEqual(panelResources(BuildingType.Mine, [Resource.Gold, Resource.Crystal]), [Resource.Gold, Resource.Crystal]);
  assert.deepEqual(panelResources(BuildingType.House, []), []);
  // Wood brought to the city is the city's: the camp does not count it.
  const workers = [W(1, 17, 11, Resource.Wood, { x: 18, y: 11 }), W(2, 25, 11, Resource.Wood, { x: 26, y: 11 })];
  assert.deepEqual(workersAt(workers, depots, camp.id, Resource.Wood).map((w) => w.id), [2]);
});

// 礦場的晶 (the user 2026-10-20: 「礦場目前不能把村民叫過去採集晶礦，要修一下」; ceo).
const mine: Depot = { id: 4, cx: 40, cy: 10, size: 2, accepts: [Resource.Gold, Resource.Crystal] };

test("礦場的晶：＋派閒置的、再從採糧木金的調（採晶的、蓋房的不動），去 10 格內最近的晶脈；沒有就提示", () => {
  const idle = W(1, 50, 30, null, null, true);
  const wood = W(2, 39, 13, Resource.Wood, { x: 38, y: 13 });
  const gold = W(3, 44, 11, Resource.Gold, { x: 44, y: 11 });
  const onVein = W(4, 42, 12, Resource.Crystal, { x: 42.5, y: 12.5 });
  const builder = W(5, 41, 12, null, null, false, true);
  assert.equal(pickToSend([idle, wood, gold, onVein, builder], mine, Resource.Crystal), 1, "idle first, however far");
  assert.equal(pickToSend([wood, gold, onVein, builder], mine, Resource.Crystal), 2, "then the nearest on another resource");
  assert.equal(pickToSend([onVein, builder], mine, Resource.Crystal), null, "not one on the vein, nor a builder");
  // 金那一列的＋照舊不會從晶脈拉人.
  assert.equal(pickToSend([onVein, builder], mine, Resource.Gold), null);
  const nodes = [
    { id: 30, kind: NodeKind.CrystalVein, cx: 44, cy: 12, amount: 150 },
    { id: 31, kind: NodeKind.CrystalVein, cx: 43, cy: 11, amount: 0 },
    { id: 32, kind: NodeKind.GoldMine, cx: 42, cy: 11, amount: 400 },
    { id: 33, kind: NodeKind.CrystalVein, cx: 40, cy: 10 + 2 + DEPOT_REACH + 1, amount: 150 },
  ];
  assert.deepEqual(sendTarget(mine, Resource.Crystal, nodes, []), { node: 30 }, "the nearest vein left, not the gold");
  assert.deepEqual(sendTarget(mine, Resource.Crystal, [nodes[1], nodes[2], nodes[3]], []), { error: "附近沒有晶脈" }, "spent, gold or beyond reach");
});

test("礦場的晶：－拿走離礦場最遠、採晶送回這座礦場的；晶脈離主城比較近時，晶送回主城，訊息條要說", () => {
  const all = [city, mine];
  const near = W(1, 42, 12, Resource.Crystal, { x: 42.5, y: 12.5 });
  const far = W(2, 46, 12, Resource.Crystal, { x: 46.5, y: 12.5 });
  // A vein right beside the main city brings its crystal there.
  const byCity = W(3, 15, 11, Resource.Crystal, { x: 15.5, y: 11.5 });
  assert.deepEqual(workersAt([near, far, byCity], all, mine.id, Resource.Crystal).map((w) => w.id), [1, 2]);
  assert.equal(pickToTake([near, far, byCity], all, mine, Resource.Crystal), 2, "the farthest from the mine");
  assert.equal(pickToTake([byCity], all, mine, Resource.Crystal), null, "nobody brings crystal to the mine");
  // Sent from the mine to a vein nearer the main city: the mine's count does not grow, so the line says where it goes.
  assert.equal(depotFor({ x: 26.5, y: 11.5 }, Resource.Crystal, all), city.id);
  assert.equal(crystalSentText(mine.id, depotFor({ x: 26.5, y: 11.5 }, Resource.Crystal, all), "主城"), "已派 1 名去採晶，晶會送回主城");
  assert.equal(crystalSentText(mine.id, depotFor({ x: 42.5, y: 12.5 }, Resource.Crystal, all), "礦場"), "已派 1 名去採晶");
});
