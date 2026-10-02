// 開局提示 (D-044): the town is worked out from the map, not a fixed id: the nearest small town.

import assert from "node:assert/strict";
import { test } from "node:test";
import { compass, hintTown, nearestTown, townHintLines } from "../src/game/town-hint.ts";
import { TownSize } from "../src/sim.ts";

const town = (id: number, cellX: number, cellY: number, size: number = TownSize.Small) => ({ id, size, cellX, cellY });

const home = { cellX: 16, cellY: 78 };

test("開局提示：離主城最近的小鎮，不管有幾座、順序怎麼排；一樣近時挑編號小的", () => {
  // Core adds a small town near each main city, after the others (D-044): it becomes the one.
  const more = [town(0, 29, 29), town(1, 48, 48, TownSize.Large), town(2, 28, 64), town(3, 64, 28)];
  assert.equal(hintTown(more, home)?.id, 2);
  assert.equal(hintTown([...more].reverse(), home)?.id, 2, "the order of the list does not matter");
  // The same distance: the lower id, wherever it stands in the list.
  const tie = [town(5, 20, 78), town(4, 12, 78), town(6, 16, 82)];
  assert.equal(hintTown(tie, home)?.id, 4);
  assert.equal(nearestTown(tie, home)?.id, 4);
  assert.equal(hintTown([], home), null);
});

test("開局提示：大城比較近時，還是挑小鎮；地圖上沒有小鎮時才挑最近的大城（ceo，D-044）", () => {
  // The prototype map today: the large town (48, 48) is about 44 cells away, the small one (29, 29) 51.
  const today = [town(0, 29, 29), town(1, 48, 48, TownSize.Large)];
  assert.equal(nearestTown(today, home)?.id, 1, "the large town is nearer");
  assert.equal(hintTown(today, home)?.id, 0, "but the hint shows the small one");
  assert.equal(hintTown([...today].reverse(), home)?.id, 0);
  // No small town: the nearest large one; the same distance, the lower id.
  const large = [town(3, 80, 20, TownSize.Large), town(2, 48, 48, TownSize.Large), town(1, 16, 46, TownSize.Large)];
  assert.equal(hintTown(large, home)?.id, 1);
  assert.equal(hintTown([town(7, 16, 46, TownSize.Large), town(6, 48, 78, TownSize.Large)], home)?.id, 6);
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

test("開局提示：三行字寫魔晶從哪裡來、到了要做什麼、最近的小鎮在哪裡", () => {
  const lines = townHintLines(town(0, 29, 29), home);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /魔晶主要從城鎮來/);
  assert.match(lines[1], /搶.*治理/);
  assert.equal(lines[2], "離你的主城最近的小鎮在主城的北方，約 51 格。小地圖上閃的圓圈就是它。");
  // After core's PR A, the small town near the main city.
  assert.equal(townHintLines(town(2, 28, 64), home)[2], "離你的主城最近的小鎮在主城的東北方，約 18 格。小地圖上閃的圓圈就是它。");
  // A map without small towns: the large one.
  assert.equal(townHintLines(town(1, 48, 48, TownSize.Large), home)[2], "離你的主城最近的是一座大城，在主城的東北方，約 44 格。小地圖上閃的圓圈就是它。");
});
