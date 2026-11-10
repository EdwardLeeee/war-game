// ＋遠程／＋法師 with nobody near (D-138 B; the user chose 「每按一次多練一名」): the places a building keeps, the one a new
// soldier fills, given up with 全部離開 or the building gone; and 自動訓練's need with them.

import assert from "node:assert/strict";
import { test } from "node:test";
import { CallSlots, withCalls } from "../src/game/call-slots.ts";
import { UnitType } from "../src/sim.ts";

const R = UnitType.Ranged;
const M = UnitType.Mage;

test("每按一次多留一個位子；練好的新兵補最早留的那個；全部離開或建築不在了，位子取消", () => {
  const s = new CallSlots();
  s.add(10, R);
  s.add(11, R);
  s.add(10, M);
  s.add(10, R);
  assert.equal(s.count(10), 3);
  assert.equal(s.count(10, R), 2);
  assert.deepEqual(s.wanted(), { [R]: 3, [M]: 1 });
  assert.equal(s.take(R), 10, "the oldest place");
  assert.equal(s.take(R), 11);
  assert.equal(s.take(UnitType.Spearman), null, "nobody waits for spearmen");
  assert.equal(s.drop(10), 2, "全部離開: its ranged and its mage");
  assert.deepEqual(s.wanted(), {});
  s.add(12, M);
  s.add(13, R);
  assert.deepEqual(s.prune((b) => b !== 12), [12], "building 12 gone");
  assert.deepEqual(s.wanted(), { [R]: 1 });
});

test("自動訓練的需求加上位子：軍團原本缺的照舊、排隊中的先算給軍團；只要有位子就算缺", () => {
  const off = { reason: "off" as const, missing: {}, want: {} };
  const need = withCalls(off, {}, { [R]: 2 }, {});
  assert.equal(need.reason, "short");
  assert.deepEqual(need.missing, { [R]: 2 });
  assert.deepEqual(need.want, { [R]: 2 });
  // Groups short of 3 ranged, 2 queued: the groups' 1 and the places' 2.
  const short = { reason: "short" as const, missing: { [R]: 1 }, want: { [R]: 6 } };
  assert.deepEqual(withCalls(short, { [R]: 3 }, { [R]: 2 }, { [R]: 2 }).missing, { [R]: 3 });
  // Enough queued for all: none more.
  assert.deepEqual(withCalls(short, { [R]: 3 }, { [R]: 1 }, { [R]: 4 }).missing, { [R]: 0 });
  // No places: the need as it was.
  assert.equal(withCalls(short, { [R]: 3 }, {}, {}), short);
});

test("繼續上一局：留的位子存進存檔、讀回來照舊（最早留的先補）；舊存檔沒有位子", () => {
  const s = new CallSlots();
  s.add(10, R);
  s.add(11, M);
  s.add(10, R);
  const saved = JSON.parse(JSON.stringify(s.save()));
  const back = new CallSlots();
  back.restore(saved);
  assert.deepEqual(back.wanted(), { [R]: 2, [M]: 1 });
  assert.equal(back.count(10, R), 2);
  assert.equal(back.take(M), 11);
  assert.equal(back.take(R), 10);
  // The saved list is a copy: the book going on does not change it.
  s.take(R);
  assert.equal(saved.length, 3);
  const old = new CallSlots();
  old.add(5, R);
  old.restore(undefined);
  assert.deepEqual(old.wanted(), {});
});
