// 開局提示 (D-044): the town is worked out from the map and what we know of its towns, not a
// fixed id: the nearest small town we can take.

import assert from "node:assert/strict";
import { test } from "node:test";
import { compass, hintTown, nearestTown, townHintLines } from "../src/game/town-hint.ts";
import { NEUTRAL, TownSize, TownState } from "../src/sim.ts";

const ME = 0;
const FOE = 1;
const town = (id: number, cellX: number, cellY: number, size: number = TownSize.Small, owner: number = NEUTRAL, state: number | null = TownState.Neutral) => ({
  id,
  size,
  cellX,
  cellY,
  owner,
  state,
});
const home = { cellX: 16, cellY: 78 };
const pick = (towns: ReturnType<typeof town>[]) => hintTown(towns, home, ME);

test("開局提示：離主城最近的小鎮，不管有幾座、順序怎麼排；一樣近時挑編號小的", () => {
  // Core adds a small town near each main city, after the others (D-044): it becomes the one.
  const more = [town(0, 29, 29), town(1, 48, 48, TownSize.Large), town(2, 28, 64), town(3, 64, 28)];
  assert.deepEqual(pick(more), { town: more[2], passed: false });
  assert.equal(pick([...more].reverse())?.town.id, 2, "the order of the list does not matter");
  // The same distance: the lower id, wherever it stands in the list.
  const tie = [town(5, 20, 78), town(4, 12, 78), town(6, 16, 82)];
  assert.equal(pick(tie)?.town.id, 4);
  assert.equal(nearestTown(tie, home)?.id, 4);
  assert.equal(pick([]), null);
  // Never explored (no snapshot row yet): as at the start.
  assert.equal(pick([town(0, 29, 29, TownSize.Small, -1, null), town(2, 28, 64, TownSize.Small, -1, null)])?.town.id, 2);
});

test("開局提示：大城比較近時，還是挑小鎮；地圖上沒有小鎮時才挑最近的大城（ceo，D-044）", () => {
  // The prototype map today: the large town (48, 48) is about 44 cells away, the small one (29, 29) 51.
  const today = [town(0, 29, 29), town(1, 48, 48, TownSize.Large)];
  assert.equal(nearestTown(today, home)?.id, 1, "the large town is nearer");
  assert.deepEqual(pick(today), { town: today[0], passed: false }, "but the hint shows the small one");
  assert.equal(pick([...today].reverse())?.town.id, 0);
  // No small town: the nearest large one; the same distance, the lower id.
  const large = [town(3, 80, 20, TownSize.Large), town(2, 48, 48, TownSize.Large), town(1, 16, 46, TownSize.Large)];
  assert.deepEqual(pick(large), { town: large[2], passed: false });
  assert.equal(pick([town(7, 16, 46, TownSize.Large), town(6, 48, 78, TownSize.Large)])?.town.id, 6);
});

test("開局提示：對局中途，指最近的、還不是自己的小鎮（中立或對手的都算，廢墟不算）；小鎮都是自己的時，照舊指最近的小鎮（ceo，D-044）", () => {
  const near = town(2, 28, 64, TownSize.Small, ME, TownState.Governed);
  const middle = town(0, 29, 29);
  const theirs = town(3, 64, 28, TownSize.Small, FOE, TownState.Governed);
  const large = town(1, 48, 48, TownSize.Large);
  // Ours near home: the next one, the neutral town in the middle.
  assert.deepEqual(pick([middle, large, near, theirs]), { town: middle, passed: true });
  // Being repaired, plundered or waiting for the choice is ours too.
  for (const state of [TownState.AwaitingChoice, TownState.Plundering, TownState.Repairing]) {
    assert.equal(pick([middle, { ...near, state }])?.town.id, 0, `state ${state}`);
  }
  // The middle one ours as well: the enemy's counts.
  const middleOurs = { ...middle, owner: ME, state: TownState.Governed };
  assert.deepEqual(pick([middleOurs, large, near, theirs]), { town: theirs, passed: true });
  // A ruin has nothing to take until it turns neutral again; never explored counts.
  const ruin = { ...middle, owner: -1, state: TownState.Ruins };
  assert.equal(pick([ruin, near, theirs])?.town.id, 3);
  assert.equal(pick([ruin, near, { ...theirs, owner: -1, state: null }])?.town.id, 3);
  // Every small town ours (or in ruins): the nearest small town, as before; never the large one.
  assert.deepEqual(pick([middleOurs, large, near]), { town: near, passed: false });
  assert.deepEqual(pick([ruin, large, near]), { town: near, passed: false });
  // The enemy holding the nearest one: it is the one to take, nothing passed over.
  assert.deepEqual(pick([middle, { ...near, owner: FOE }]), { town: { ...near, owner: FOE }, passed: false });
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
  // A nearer small town is ours already (選單 → 魔晶怎麼拿 in the middle of a game).
  assert.equal(townHintLines(town(0, 29, 29), home, true)[2], "離你的主城最近、可以攻下的小鎮在主城的北方，約 51 格。小地圖上閃的圓圈就是它。");
  // A map without small towns: the large one.
  assert.equal(townHintLines(town(1, 48, 48, TownSize.Large), home)[2], "離你的主城最近的是一座大城，在主城的東北方，約 44 格。小地圖上閃的圓圈就是它。");
});
