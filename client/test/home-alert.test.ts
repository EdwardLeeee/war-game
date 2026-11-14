// 主城被打的警示 (D-141): the enemy's soldiers near our main city, and when 「敵軍 N 名接近主城」 is said.
import assert from "node:assert/strict";
import { test } from "node:test";
import { enemiesNearHome, HOME_NEAR_AGAIN_MS, HOME_NEAR_CALM_MS, HOME_NEAR_MORE, HomeNearAlert, homeNearText } from "../src/game/home-alert.ts";
import { NEUTRAL, NO_OWNER, UnitType } from "../src/sim.ts";

const HOME = { x: 8, y: 80, w: 4, h: 4 };

test("主城 12 格內的敵方士兵：不算村民、民兵、自己的；12 格外的不算", () => {
  const near = (x: number, y: number, owner = 1, type: number = UnitType.Spearman) => ({ owner, type, x, y });
  const units = [
    near(13, 82), // 1 east of the footprint
    near(23.5, 82), // 11.5 out: in
    near(24.5, 82), // 12.5 out: not
    near(10, 70), // 10 north
    near(13, 82, 0), // ours
    near(13, 82, NEUTRAL, UnitType.Militia),
    near(13, 82, NO_OWNER),
    near(13, 82, 1, UnitType.Farmer),
    near(14, 83, 1, UnitType.Mage),
  ];
  assert.equal(enemiesNearHome(units, 0, HOME, 12), 4);
  assert.equal(enemiesNearHome([], 0, HOME, 12), 0);
});

test("什麼時候說：第一次馬上說；30 秒內不重複，除非多來 5 名；30 秒後還在再說一次；走光 10 秒後再來算新的一波", () => {
  assert.equal(HOME_NEAR_AGAIN_MS, 30_000);
  assert.equal(HOME_NEAR_MORE, 5);
  const a = new HomeNearAlert();
  assert.equal(a.seen(0, 0), null);
  assert.equal(a.seen(3, 1000), "敵軍 3 名接近主城");
  assert.equal(a.seen(4, 2000), null);
  assert.equal(a.seen(7, 3000), null, "4 more is not 5");
  assert.equal(a.seen(8, 4000), homeNearText(8), "5 more than said");
  assert.equal(a.seen(8, 4000 + HOME_NEAR_AGAIN_MS - 1), null);
  assert.equal(a.seen(6, 4000 + HOME_NEAR_AGAIN_MS), homeNearText(6), "still there 30 s later");
  // One stepping out and in: not a new approach.
  const t = 40_000;
  assert.equal(a.seen(0, t), null);
  assert.equal(a.seen(2, t + HOME_NEAR_CALM_MS - 1), null);
  // Gone for 10 s: the next ones are said at once.
  assert.equal(a.seen(0, t + 20_000), null);
  assert.equal(a.seen(0, t + 20_000 + HOME_NEAR_CALM_MS), null);
  assert.equal(a.seen(2, t + 20_000 + HOME_NEAR_CALM_MS + 1), homeNearText(2));
});
