// 開局提示 (D-044): the nearest town is worked out from the map, not a fixed id.

import assert from "node:assert/strict";
import { test } from "node:test";
import { compass, nearestTown, townHintLines } from "../src/game/town-hint.ts";
import { TownSize } from "../src/sim.ts";

const town = (id: number, cellX: number, cellY: number, size: number = TownSize.Small) => ({ id, size, cellX, cellY });

test("開局提示：離主城最近的城鎮，不管有幾座、順序怎麼排；一樣近時挑編號小的", () => {
  const home = { cellX: 16, cellY: 78 };
  // The prototype map today: the small town (29, 29) and the large one (48, 48).
  assert.equal(nearestTown([town(0, 29, 29), town(1, 48, 48, TownSize.Large)], home)?.id, 1);
  // Core adds a small town near each main city, after the others (D-044): it becomes the nearest.
  const more = [town(0, 29, 29), town(1, 48, 48, TownSize.Large), town(2, 30, 70), town(3, 70, 30)];
  assert.equal(nearestTown(more, home)?.id, 2);
  assert.equal(nearestTown([...more].reverse(), home)?.id, 2, "the order of the list does not matter");
  // The same distance: the lower id, wherever it stands in the list.
  const tie = [town(5, 20, 78), town(4, 12, 78), town(6, 16, 82)];
  assert.equal(nearestTown(tie, home)?.id, 4);
  assert.equal(nearestTown([], home), null);
});

test("開局提示：方向用畫面上看到的八個方位（上面是北）", () => {
  assert.equal(compass(10, 0), "東");
  assert.equal(compass(10, -10), "東北");
  assert.equal(compass(0, -10), "北");
  assert.equal(compass(-10, -10), "西北");
  assert.equal(compass(-10, 0), "西");
  assert.equal(compass(-10, 10), "西南");
  assert.equal(compass(0, 10), "南");
  assert.equal(compass(10, 10), "東南");
  // Mostly north with a little east is still north.
  assert.equal(compass(3, -30), "北");
});

test("開局提示：三行字寫魔晶從哪裡來、到了要做什麼、最近的城鎮在哪裡", () => {
  const lines = townHintLines(town(1, 48, 48, TownSize.Large), { cellX: 16, cellY: 78 });
  assert.equal(lines.length, 3);
  assert.match(lines[0], /魔晶主要從城鎮來/);
  assert.match(lines[1], /搶.*治理/);
  assert.equal(lines[2], "離你的主城最近的是一座大城，在主城的東北方，約 44 格。小地圖上閃的圓圈就是它。");
});
