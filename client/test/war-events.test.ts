// 戰事標記 (R17-03): the events of three of the player's games (e2e/fixtures/r17-*.json, replayed with their own
// simulation), as ui's board counts them: 進攻／防守／團戰 17/20/13, 13/3/14, 7/3/3, and its three cards.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DIAMOND } from "../src/camera/projection.ts";
import type { GameTimeline } from "../src/sim.ts";
import { eventCard, lasted, type WarEvent, warEvents } from "../src/ui/stats/events.ts";
import { type StatsWorld, statsModel, withPlaces } from "../src/ui/stats/model.ts";

type Fix = { winner: number; reason: number; ticks: number; mapSize: number; timeline: GameTimeline };
const load = (name: string) => JSON.parse(readFileSync(new URL(`../e2e/fixtures/${name}.json`, import.meta.url), "utf8")) as Fix;
const world = (f: Fix): StatsWorld => withPlaces({ me: 0, towns: new Map(), townCount: null, cities: [null, null], mapSize: f.mapSize, projection: DIAMOND, mapLabel: "固定地圖", crystal: false }, f.timeline);
const count = (es: WarEvent[]) => [es.filter((e) => e.kind === "進攻").length, es.filter((e) => e.kind === "防守").length, es.filter((e) => e.kind === "團戰").length];
const at = (es: WarEvent[], kind: string, clockText: string) => es.find((e) => e.kind === kind && eventCard(e).title === `${kind} ${clockText}`);

test("三局的次數和 ui 的稿一樣：敗 92:39 進攻 17、防守 20、團戰 13；勝 102:04 13、3、14；敗 23:53 7、3、3", () => {
  for (const [name, want] of [
    ["r17-lost-92m", [17, 20, 13]],
    ["r17-won-102m", [13, 3, 14]],
    ["r17-lost-24m", [7, 3, 3]],
  ] as const) {
    const f = load(name);
    const es = warEvents(f.timeline, world(f));
    assert.deepEqual(count(es), want, name);
    // By when each began.
    assert.ok(es.every((e, i) => i === 0 || es[i - 1].from <= e.from), `${name} in order`);
  }
});

test("稿上的三張卡：防守 39:30 失守後搶回（第 22／50 件）、進攻 40:50 沒攻下、團戰 15:37 平手；人數寫「最多 N 名」", () => {
  const lost = load("r17-lost-92m");
  const a = warEvents(lost.timeline, world(lost));
  const d = at(a, "防守", "39:30");
  assert.ok(d !== undefined);
  assert.deepEqual(eventCard(d), { title: "防守 39:30", place: "大城・中", detail: "敵方最多 39 名", result: "失守後搶回", dead: "敵死 2、我死 1" });
  assert.equal(a.indexOf(d) + 1, 22);
  assert.equal(a.length, 50);
  // The town lost then taken back is not a 進攻 of its own.
  assert.equal(at(a, "進攻", "40:50"), undefined);

  const won = load("r17-won-102m");
  const b = warEvents(won.timeline, world(won));
  const r = at(b, "進攻", "40:50");
  assert.ok(r !== undefined);
  assert.deepEqual(eventCard(r), { title: "進攻 40:50", place: "大城・中", detail: "我方最多 83 名", result: "沒攻下", dead: "我死 109、敵死 73" });
  assert.equal(b.indexOf(r) + 1, 11);
  assert.equal(b.length, 30);

  const short = load("r17-lost-24m");
  const c = warEvents(short.timeline, world(short));
  const f = c.find((e) => e.kind === "團戰" && eventCard(e).title === "團戰 15:37");
  assert.ok(f !== undefined);
  assert.deepEqual(eventCard(f), { title: "團戰 15:37", place: "小鎮・右上", detail: "打了 2 分 28 秒", result: "平手", dead: "我死 31、敵死 31" });
  assert.equal(c.indexOf(f) + 1, 8);
  assert.equal(c.length, 13);
  // 17:40 by 小鎮・右上, lost at 17:15: its dead went to that 防守, still lost.
  assert.equal(at(c, "進攻", "17:40"), undefined);
  const lostTown = at(c, "防守", "15:30");
  assert.equal(lostTown?.result, "城鎮失守");
});

test("一個取樣、沒人死的不算（進攻、防守都是）；路過中立城鎮不算；打電腦主城、攻下後搶／治理", () => {
  const won = load("r17-won-102m");
  const b = warEvents(won.timeline, world(won));
  // 75:40 大城・中, five of theirs one sample, nobody dead: not a 防守 (it was in client's first count).
  assert.equal(at(b, "防守", "75:40"), undefined);
  // 13:00 小鎮・左上, six of ours for 20 s, nobody dead, not taken: passing by.
  assert.equal(at(b, "進攻", "13:00"), undefined);
  assert.equal(at(b, "進攻", "6:30")?.result, "攻下後搶");
  assert.equal(at(b, "進攻", "14:50")?.result, "攻下後治理");
  assert.equal(at(b, "進攻", "100:10")?.place, "敵方主城");
  assert.equal(at(b, "進攻", "100:10")?.result, "攻下敵方主城");
  // Militia are theirs on the card: 6:30, 7 dead of theirs (6 militia).
  assert.equal(eventCard(at(b, "進攻", "6:30") as WarEvent).dead, "我死 1、敵死 7");
});

test("打了多久的寫法；統計頁的資料帶著這局的戰事", () => {
  assert.equal(lasted(20 * 148), "2 分 28 秒");
  assert.equal(lasted(20 * 45), "45 秒");
  assert.equal(lasted(20 * 180), "3 分");
  const f = load("r17-lost-24m");
  const m = statsModel(f.winner, f.reason, f.ticks, f.timeline, world(f));
  assert.equal(m.events.length, 13);
});
