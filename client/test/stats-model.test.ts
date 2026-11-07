// 局後統計's model (ui/stats/model.ts; R13-02 A, R14-09, b2 2026-11-07): a real game played to its end by two
// computers, read from both sides as the screen knew the map (the fixed map: every town) and as a random map's
// player may have (no town explored); and small timelines for each rule: the header, the axis, town bars and their
// marks, names, the moments, the numbers.

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { Runner } from "../../sim/src/runner.ts";
import { mapInfo } from "../../sim/src/view/view.ts";
import { PROJECTIONS } from "../src/camera/projection.ts";
import { type GameTimeline, GameOverReason, NEUTRAL, NO_OWNER, TownSize, TownState, UnitType } from "../src/sim.ts";
import { axisMinutes, moments, type StatsWorld, statsHead, statsModel, townBars, townCounts, townNames } from "../src/ui/stats/model.ts";

const S = 20;
const MIN = 60 * S;

let game: { t: GameTimeline; winner: number; reason: number; ticks: number; world: (me: number) => StatsWorld };
before(() => {
  const r = new Runner({ seed: 3, scenario: "standard", ai: [true, true], maxTicks: 60 * MIN, difficulty: ["hard", "normal"], autoTrain: [false, false], build: "t" });
  while (!r.over) r.tick();
  const w = r.game.w;
  const mi = mapInfo(w.map, null);
  game = {
    t: r.timeline(),
    winner: w.winner,
    reason: w.endReason,
    ticks: w.tick,
    world: (me) => ({
      me,
      towns: new Map(mi.towns.map((x) => [x.id, x])),
      townCount: mi.towns.length,
      cities: [0, 1].map((p) => mi.spawns.find((s) => s.player === p) ?? null),
      mapSize: mi.size,
      projection: PROJECTIONS.oblique,
      mapLabel: "固定地圖",
    }),
  };
});

const nondecreasing = (pts: readonly (readonly [number, number])[]) => pts.every((p, i) => i === 0 || (p[0] > pts[i - 1][0] && p[1] >= pts[i - 1][1]));

test("a real game, from the winner's side: the header, lines that only climb, kills from deaths[].by, bars that cover the game", () => {
  const { t, winner, reason, ticks } = game;
  assert.equal(reason, GameOverReason.MainCityDestroyed);
  const me = winner;
  const foe = 1 - me;
  const m = statsModel(winner, reason, ticks, t, game.world(me));
  assert.equal(m.head.title, "勝利");
  assert.equal(m.head.reason, "敵方主城被摧毀");
  assert.equal(m.head.map, "固定地圖");
  const ai = t.sides[foe].ai;
  assert.ok(ai !== null);
  assert.equal(m.head.foe, `電腦・${{ easy: "簡單", normal: "普通", hard: "困難" }[ai.difficulty]}・${{ plunder: "掠奪型", govern: "治理型", balanced: "均衡型" }[ai.style]}`);
  for (const k of ["food", "wood", "gold", "crystal"] as const) {
    assert.ok(nondecreasing(m.resources[k].me) && nondecreasing(m.resources[k].foe), `${k} earned only climbs`);
    assert.equal(m.resources[k].me.length, t.samples.length);
  }
  assert.equal(m.resources.food.me.at(-1)?.[1], t.samples.at(-1)?.earned[me][0]);
  // Soldiers: all but farmers.
  const s = t.samples[t.samples.length >> 1];
  assert.equal(m.army.me[t.samples.length >> 1][1], s.units[me].reduce((a, b) => a + b, 0) - s.units[me][UnitType.Farmer]);
  // 我方擊殺 from deaths[].by, not the enemy's losses (those count militia's kills too).
  const byMe = t.deaths.filter((d) => d[1] === foe && d[5] === me).length;
  assert.equal(m.fight.killed, byMe);
  assert.equal(m.fight.lost, t.sides[me].lost.reduce((a, b) => a + b, 0));
  for (const r of m.fight.rows) assert.equal(r.lost, t.sides[me].lost[r.type]);
  // Every bar runs from 0 to the end without gaps.
  assert.ok(m.towns.length > 0);
  for (const b of m.towns) {
    assert.equal(b.segments[0].from, 0, b.name);
    assert.equal(b.segments.at(-1)?.to, ticks, b.name);
    b.segments.forEach((g, i) => i > 0 && assert.equal(g.from, b.segments[i - 1].to, `${b.name} has no gap`));
    assert.ok(!b.name.includes("沒去過"), "the fixed map: every town known");
  }
  // Moments: at most 4, in order, none within 30 s of another; the enemy's main city is in.
  assert.ok(m.moments.length <= 4);
  m.moments.forEach((x, i) => i > 0 && assert.ok(x.tick - m.moments[i - 1].tick >= 30 * S));
  assert.equal(t.sides[foe].cityHits.length > 0, true);
  const at = m.moments.find((x) => x.title === "攻進敵方主城");
  assert.equal(at?.tick, t.sides[foe].cityHits[0][0]);
  assert.match(at?.text ?? "", /^我方 \d+ 名到敵方主城下$/);
  assert.equal(m.axisMinutes, 5);
  assert.equal(m.numbers.find((r) => r.name === "損失（含村民）")?.me, `${m.fight.lost}`);
});

test("the same game from the loser's side: 我方主城被摧毀, mirrored numbers, the spell the city fell in", () => {
  const { t, winner, reason, ticks } = game;
  const me = 1 - winner;
  const m = statsModel(winner, reason, ticks, t, game.world(me));
  const won = statsModel(winner, reason, ticks, t, game.world(winner));
  assert.equal(m.head.title, "失敗");
  assert.equal(m.head.reason, "我方主城被摧毀");
  assert.deepEqual(m.townCounts, { me: won.townCounts.foe, foe: won.townCounts.me });
  assert.deepEqual(
    m.numbers.map((r) => [r.me, r.foe]),
    won.numbers.map((r) => [r.foe, r.me]),
  );
  const hits = t.sides[me].cityHits;
  if (hits.length > 1) assert.ok(m.moments.some((x) => x.title === "敵方攻進主城" && x.tick === hits[hits.length - 1][0]));
});

test("a random map's player who explored nothing: 城鎮（沒去過）, numbered, and main cities with no numbers", () => {
  const { t, winner, reason, ticks } = game;
  const w = { ...game.world(winner), towns: new Map(), townCount: null };
  const m = statsModel(winner, reason, ticks, t, w);
  const names = m.towns.map((b) => b.name);
  assert.deepEqual(names, names.map((_, i) => (names.length > 1 ? `城鎮（沒去過） ${i + 1}` : "城鎮（沒去過）")));
  const at = m.moments.find((x) => x.title === "攻進敵方主城");
  assert.equal(at?.text, "我方到敵方主城下", "b2: no number when near[]'s main cities cannot be told");
});

test("the timeline's places (core #425): every town and both main cities known whatever the screen explored", () => {
  const { t, winner, reason, ticks } = game;
  const full = game.world(winner);
  const places = { towns: [...full.towns.values()].map((x) => ({ size: x.size, cellX: x.cellX, cellY: x.cellY })), cities: full.cities as [{ cellX: number; cellY: number }, { cellX: number; cellY: number }] };
  const m = statsModel(winner, reason, ticks, { ...t, places } as GameTimeline, { ...full, towns: new Map(), townCount: null, cities: [null, null] });
  assert.deepEqual(m, statsModel(winner, reason, ticks, t, full));
});

/** A timeline with nothing in it but what a test puts there. */
function empty(ticks: number): GameTimeline {
  const side = () => ({ trained: [0, 0, 0, 0, 0, 0, 0], lost: [0, 0, 0, 0, 0, 0, 0], cannon: { shots: 0, hits: 0, kills: 0, best: null }, cityHits: [] as [number, number, number][], ai: null });
  const sample = (tick: number) => ({ tick, earned: [[0, 0, 0, 0], [0, 0, 0, 0]] as [number[], number[]], stock: [[0, 0, 0, 0], [0, 0, 0, 0]] as [number[], number[]], units: [[0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0]] as [number[], number[]], near: [] as [number, number, number][] });
  const samples = [];
  for (let tick = 0; tick < ticks; tick += 10 * S) samples.push(sample(tick));
  samples.push(sample(ticks));
  return { every: 10 * S, samples, towns: [], deaths: [], sides: [side(), side()] };
}

/** A square map of 100 cells: town 0 east of the centre, town 1 at it, town 2 further east; main cities at the bottom left and top right. */
const WORLD: StatsWorld = {
  me: 0,
  towns: new Map([
    [0, { size: TownSize.Small, cellX: 80, cellY: 50 }],
    [1, { size: TownSize.Large, cellX: 52, cellY: 48 }],
    [2, { size: TownSize.Small, cellX: 95, cellY: 50 }],
  ]),
  townCount: 3,
  cities: [
    { cellX: 10, cellY: 90 },
    { cellX: 90, cellY: 10 },
  ],
  mapSize: 100,
  projection: PROJECTIONS.oblique,
  mapLabel: "固定地圖",
};

test("the header: a draw at the limit, a surrender either way, a person as the opponent", () => {
  const t = empty(MIN);
  assert.deepEqual(statsHead(-1, GameOverReason.TimeLimit, MIN, t, WORLD), { result: "draw", title: "平手", reason: "時間到", time: "1:00", foe: "玩家", map: "固定地圖" });
  assert.equal(statsHead(1, GameOverReason.Surrender, MIN, t, WORLD).reason, "我方投降");
  assert.equal(statsHead(0, GameOverReason.Surrender, MIN, t, WORLD).reason, "敵方投降");
  t.sides[1].ai = { difficulty: "hard", style: "govern" };
  assert.equal(statsHead(0, GameOverReason.MainCityDestroyed, MIN, t, WORLD).foe, "電腦・困難・治理型");
});

test("the time axis: 5 minutes up to half an hour, then 10, 15… (at most 6 steps)", () => {
  assert.equal(axisMinutes(26 * MIN + 40 * S), 5);
  assert.equal(axisMinutes(30 * MIN), 5);
  assert.equal(axisMinutes(31 * MIN), 10);
  assert.equal(axisMinutes(80 * MIN), 15);
  assert.equal(axisMinutes(100 * MIN), 20);
});

test("names: size and the screen's direction from the centre (D-132), 中 by it, numbered from the centre out; 我方附近", () => {
  const n = townNames(WORLD, [0, 1, 2]);
  assert.deepEqual(n.get(1), { name: "大城・中", note: "" });
  assert.equal(n.get(0)?.name, "小鎮・右 1");
  assert.equal(n.get(2)?.name, "小鎮・右 2", "the one further out second");
  // The diamond turns the map: east is down and to the right.
  const d = townNames({ ...WORLD, projection: PROJECTIONS.diamond }, [0]);
  assert.equal(d.get(0)?.name, "小鎮・右下");
  // Clearly nearer one main city.
  const w = { ...WORLD, towns: new Map([[0, { size: TownSize.Small, cellX: 20, cellY: 75 }]]) };
  assert.deepEqual(townNames(w, [0]).get(0), { name: "小鎮・左下", note: "我方附近" });
  assert.equal(townNames({ ...w, me: 1 }, [0]).get(0)?.note, "敵方附近");
});

test("town bars: AwaitingChoice drawn as before it, plunder and ruins, a revolt, the marks and the counts", () => {
  const t = empty(30 * MIN);
  t.towns = [
    [1 * MIN, 0, TownState.AwaitingChoice, 0],
    [1 * MIN + 40, 0, TownState.Repairing, 0],
    [2 * MIN, 0, TownState.Governed, 0],
    [10 * MIN, 0, TownState.AwaitingChoice, 1],
    [10 * MIN + 30, 0, TownState.Plundering, 1],
    [11 * MIN, 0, TownState.Ruins, NO_OWNER],
    [15 * MIN, 0, TownState.Neutral, NEUTRAL],
    [16 * MIN, 1, TownState.AwaitingChoice, 1],
    [16 * MIN + 20, 1, TownState.Repairing, 1],
    [20 * MIN, 1, TownState.Neutral, NEUTRAL],
  ];
  const [a, b] = townBars(t, 30 * MIN, WORLD);
  assert.deepEqual(
    a.segments.map((g) => [g.kind, g.who, g.from, g.to, g.label]),
    [
      ["neutral", null, 0, 1 * MIN + 40, "中立"],
      ["repair", "me", 1 * MIN + 40, 2 * MIN, ""],
      ["gov", "me", 2 * MIN, 10 * MIN + 30, "我方治理"],
      ["plunder", "foe", 10 * MIN + 30, 11 * MIN, ""],
      ["ruin", null, 11 * MIN, 15 * MIN, "廢墟"],
      ["neutral", null, 15 * MIN, 30 * MIN, "中立"],
    ],
  );
  assert.deepEqual(a.events, [
    { tick: 1 * MIN + 40, mark: "治", who: "me" },
    { tick: 10 * MIN + 30, mark: "搶", who: "foe" },
  ]);
  assert.deepEqual(b.events, [
    { tick: 16 * MIN + 20, mark: "治", who: "foe" },
    { tick: 20 * MIN, mark: "叛", who: "foe" },
  ]);
  assert.deepEqual(townCounts(t), [
    [0, 1, 0],
    [1, 1, 1],
  ]);
});

test("moments: 第一次進攻 from 5 soldiers by a place the other holds, with the deaths after it; none: an empty list", () => {
  const t = empty(10 * MIN);
  t.towns = [[0, 0, TownState.Governed, 0]];
  t.samples[6].near = [[0, 0, 4]];
  assert.deepEqual(moments(t, WORLD, "draw"), [], "4 is not an attack");
  t.samples[7].near = [[0, 0, 5]];
  t.deaths = [
    [t.samples[7].tick + 5 * S, 1, UnitType.Spearman, 80, 52, 0, 2],
    [t.samples[7].tick + 9 * S, 0, UnitType.Ranged, 82, 50, 1, 2],
    [t.samples[7].tick + 9 * S, 0, UnitType.Ranged, 40, 40, 1, 2],
  ];
  assert.deepEqual(moments(t, WORLD, "draw"), [{ tick: t.samples[7].tick, title: "第一次進攻", text: "敵方 5 名到小鎮・右 1（敵死 1、我死 1）" }]);
});

test("moments: 大仗 the minute with most soldiers killed, at a place; 30 s apart or one; at most 4, the lowest kind dropped", () => {
  const t = empty(30 * MIN);
  // 12 soldiers killed by players within a minute by the big city, from 10:00.
  for (let i = 0; i < 12; i++) t.deaths.push([10 * MIN + i * 4 * S, i % 3 === 0 ? 0 : 1, UnitType.Spearman, 50 + (i % 3), 47, i % 3 === 0 ? 1 : 0, 2]);
  t.samples[60].near = [[1, 20, 25]];
  t.samples[61].near = [[1, 18, 30]];
  t.sides[0].cityHits = [[20 * MIN, 21 * MIN, 500]];
  t.sides[1].cityHits = [[10 * MIN + 10 * S, 11 * MIN, 900]];
  t.towns = [[0, 0, TownState.Governed, 0]];
  t.samples[30].near = [[0, 0, 6]];
  const m = moments(t, WORLD, "won");
  assert.deepEqual(
    m.map((x) => [x.tick, x.title]),
    [
      [5 * MIN, "第一次進攻"],
      [10 * MIN, "大仗"],
      [20 * MIN, "主城第一次被打"],
    ],
    "攻進敵方主城 10 s after the big fight is one with it",
  );
  assert.equal(m[1].text, "大城・中：20 名對 30 名，我死 4、敵死 8");
  // Five kinds: the lowest (第一次進攻) goes.
  t.sides[1].cityHits = [[25 * MIN, 26 * MIN, 900]];
  t.sides[0].cityHits.push([28 * MIN, 29 * MIN, 0]);
  assert.deepEqual(
    moments(t, WORLD, "lost").map((x) => x.title),
    ["大仗", "主城第一次被打", "攻進敵方主城", "敵方攻進主城"],
  );
});

test("the best shot's note names the kinds, and 大仗 when it fell in it", () => {
  const t = empty(30 * MIN);
  for (let i = 0; i < 12; i++) t.deaths.push([10 * MIN + i * 4 * S, 1, UnitType.Spearman, 50, 47, 0, 3]);
  t.sides[0].cannon = { shots: 3, hits: 9, kills: 7, best: { kills: 5, tick: 10 * MIN + 20 * S, x: 50, y: 47, types: [0, 4, 1, 0, 0, 0, 0] } };
  t.sides[0].trained[UnitType.Mage] = 2;
  const m = statsModel(0, GameOverReason.Surrender, 30 * MIN, t, WORLD);
  assert.equal(m.mages.bestNote, "晶砲擊殺最多的一發：10:20 大仗，炸死 5 名（槍兵 4、遠程兵 1）");
  assert.deepEqual(m.mages.me, { trained: 2, lost: 0, shots: 3, kills: 7, best: { kills: 5, tick: 10 * MIN + 20 * S } });
  // Kinds no one had are left out of 戰鬥 (騎兵, 攻城砲), the four first always there.
  assert.deepEqual(
    m.fight.rows.map((r) => r.name),
    ["村民", "槍兵", "遠程兵", "法師"],
  );
});
