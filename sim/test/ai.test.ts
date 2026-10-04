// The simple AI (PR-5): fairness on the mirrored map, its styles, and that it gets going.

import assert from "node:assert/strict";
import test from "node:test";
import { type AiStyle, createAi, type HardPlan } from "../src/ai/ai.ts";
import { Game } from "../src/core/game.ts";
import { rules } from "../src/core/rules.ts";
import { startCast } from "../src/core/units.ts";
import { type AiDifficulty, BuildingType, type CommandBody, HeaderField, MAX_TICKS, NO_OWNER, NodeKind, Order, TownChoice, TownState, UnitType } from "../src/protocol.ts";
import { Runner } from "../src/runner.ts";
import { buildView } from "../src/view/view.ts";
import { emptyGame, put, slotOf } from "./helpers.ts";

/** Units of a player as sortable strings in player 0's frame (x <-> y for player 1). */
function units(g: Game, p: number): string {
  const u = g.w.units.col;
  const out: string[] = [];
  for (let i = 0; i < g.w.units.count; i++) {
    if (u.owner[i] !== p) continue;
    const [x, y] = p === 0 ? [u.x[i], u.y[i]] : [u.y[i], u.x[i]];
    out.push([u.type[i], x, y, u.hp[i], u.order[i], u.carryAmount[i]].join(","));
  }
  return out.sort().join("|");
}

test("two identical AIs on the mirrored spawns play mirror images of each other", () => {
  const g = new Game({ seed: 7, scenario: "standard" });
  const w = g.w;
  const ais = [0, 1].map((p) => createAi(p, 7, { map: w.map, rules: rules(), frame: w.map.frames[p], maxTicks: MAX_TICKS }, 0, "balanced"));
  let seq = 0;
  for (let t = 0; t < 3000; t++) {
    if (g.tick % 10 === 0) {
      for (let p = 0; p < 2; p++) for (const body of ais[p].think(buildView(g, p))) g.push({ ...body, t: g.tick, p, seq: seq++ } as never);
    }
    g.step();
    assert.equal(units(g, 1), units(g, 0), `tick ${g.tick}`);
    assert.deepEqual(Array.from(w.res.subarray(4, 8)), Array.from(w.res.subarray(0, 4)), `resources at tick ${g.tick}`);
  }
});

function choice(style: AiStyle): CommandBody | undefined {
  const g = emptyGame();
  const w = g.w;
  w.townState[0] = TownState.AwaitingChoice;
  w.townOwner[0] = 0;
  w.res.set([1000, 1000, 1000, 0], 0);
  for (let k = 0; k < 10; k++) put(g, 0, UnitType.Spearman, w.townX[0] + (k % 3), w.townY[0] + 1 + Math.trunc(k / 3));
  g.fog.update(w);
  const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: MAX_TICKS }, 0, style);
  return ai.think(buildView(g, 0)).find((c) => c.c === "town_choice");
}

test("styles: with money and spare soldiers, a governor governs and a plunderer plunders", () => {
  assert.deepEqual(choice("govern"), { c: "town_choice", town: 0, choice: TownChoice.Govern });
  assert.deepEqual(choice("plunder"), { c: "town_choice", town: 0, choice: TownChoice.Plunder });
});

test("an AI against itself builds up an economy and an army", () => {
  const r = new Runner({ seed: 4, scenario: "standard", ai: [true, true] });
  while (r.game.tick < 6000) r.tick();
  const w = r.game.w;
  for (const p of [0, 1]) {
    let farmers = 0;
    let soldiers = 0;
    for (let s = 0; s < w.units.count; s++) {
      if (w.units.col.owner[s] !== p) continue;
      if (w.units.col.type[s] === UnitType.Farmer) farmers++;
      else soldiers++;
    }
    let camp = false;
    for (let s = 0; s < w.buildings.count; s++) if (w.buildings.col.owner[s] === p && w.buildings.col.type[s] === BuildingType.LumberCamp) camp = true;
    assert.ok(farmers >= 10, `player ${p}: ${farmers} farmers`);
    assert.ok(camp, `player ${p} built a lumber camp`);
    assert.ok(soldiers + w.trained[p * 5 + UnitType.Spearman] > 0, `player ${p} started an army`);
  }
});

/** The first think of a balanced AI whose 18 spearmen stand near home, with `foes` enemy spearmen in view beside them. */
function firstMove(foes: number): CommandBody | undefined {
  const g = emptyGame();
  const w = g.w;
  const s0 = w.map.spawns[0];
  for (let k = 0; k < 18; k++) put(g, 0, UnitType.Spearman, s0.cellX + 6 + (k % 6), s0.cellY - 8 - Math.trunc(k / 6));
  for (let k = 0; k < foes; k++) put(g, 1, UnitType.Spearman, s0.cellX + 6 + (k % 6), s0.cellY - 13 - Math.trunc(k / 6));
  g.fog.update(w);
  const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: MAX_TICKS }, 0, "balanced");
  return ai.think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length >= 18);
}

test("the AI weighs up: it goes for a town when stronger, not when the enemy in view outnumbers it", () => {
  const towns = new Set(emptyGame().w.map.towns.map((t) => `${t.cellX},${t.cellY}`));
  const alone = firstMove(0) as { x: number; y: number } | undefined;
  assert.ok(alone !== undefined && towns.has(`${alone.x},${alone.y}`), "no enemy in sight: off to a town");
  const outnumbered = firstMove(24) as { x: number; y: number } | undefined;
  assert.ok(outnumbered === undefined || !towns.has(`${outnumbered.x},${outnumbered.y}`), "24 enemies in sight: stays");
});
test("an army sent to a town moves on once the town lies in ruins, instead of waiting there", () => {
  const g = emptyGame();
  const w = g.w;
  const [small, big] = w.map.towns;
  // The corner towns (round 6) lie in ruins, a farmer by each so the AI sees it: this is
  // about the middle town and the big one.
  for (const t of w.map.towns.slice(2)) {
    w.townState[t.id] = TownState.Ruins;
    w.townOwner[t.id] = NO_OWNER;
    put(g, 0, UnitType.Farmer, t.cellX + 2, t.cellY + 2);
  }
  for (let k = 0; k < 18; k++) put(g, 0, UnitType.Spearman, small.cellX + 2 + (k % 6), small.cellY + 3 + Math.trunc(k / 6));
  g.fog.update(w);
  const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: MAX_TICKS }, 0, "plunder");
  const bigMove = () => {
    const m = ai.think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length >= 18) as { x: number; y: number } | undefined;
    return m && { x: m.x, y: m.y };
  };
  assert.deepEqual(bigMove(), { x: small.cellX, y: small.cellY }, "off to the small town first");
  // Plundered (by anyone): ruins belong to no one until they turn neutral again.
  w.townState[small.id] = TownState.Ruins;
  w.townOwner[small.id] = NO_OWNER;
  g.fog.update(w);
  assert.deepEqual(bigMove(), { x: big.cellX, y: big.cellY }, "then on to the big town, not waiting in the ruins");
});

/**
 * Where the first big move of an AI with `n` spearmen out from home goes at `minute` (no enemy
 * in view): in a 30-minute game unless `maxTicks` says otherwise; `full`: population at 120 / 120.
 */
function goesAt(n: number, minute: number, opt: { maxTicks?: number; difficulty?: AiDifficulty; full?: boolean } = {}): string {
  const g = emptyGame();
  const w = g.w;
  w.tick = minute * 1200;
  const s0 = w.map.spawns[0];
  for (let k = 0; k < n; k++) put(g, 0, UnitType.Spearman, s0.cellX + 14 + (k % 6), s0.cellY - 14 - Math.trunc(k / 6));
  g.fog.update(w);
  const know = { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: opt.maxTicks ?? MAX_TICKS, difficulty: opt.difficulty };
  const ai = createAi(0, 1, know, 0, "balanced");
  const view = buildView(g, 0);
  if (opt.full === true) {
    view.header[HeaderField.population] = 120;
    view.header[HeaderField.populationCap] = 120;
  }
  const m = ai.think(view).find((c) => c.c === "move" && c.u.length >= n) as { x: number; y: number } | undefined;
  if (m === undefined) return "none";
  const s1 = w.map.spawns[1];
  if (m.x === s1.cellX && m.y === s1.cellY) return "enemy base";
  return w.map.towns.some((t) => t.cellX === m.x && t.cellY === m.y) ? "town" : "rally";
}

test("from minute 22 no more towns: the army gathers and goes for the enemy base with 15, from minute 24 with 8", () => {
  assert.equal(goesAt(18, 21), "town", "minute 21: still takes towns");
  assert.equal(goesAt(18, 22), "enemy base", "minute 22: 18 >= 15 go");
  assert.equal(goesAt(12, 22), "rally", "minute 22: 12 wait for more, and no town");
  assert.equal(goesAt(9, 23), "rally", "minute 23: 9 wait");
  assert.equal(goesAt(9, 24), "enemy base", "minute 24: 9 >= 8 go");
  assert.equal(goesAt(5, 24), "rally", "minute 24: not with 5");
});

/** An AI whose 20 spearmen stand by the enemy main city at minute 23 (so it marches on it). */
function atEnemyCity() {
  const g = emptyGame();
  const w = g.w;
  w.tick = 23 * 1200;
  const s1 = w.map.spawns[1];
  const ids: number[] = [];
  for (let k = 0; k < 20; k++) ids.push(put(g, 0, UnitType.Spearman, s1.cellX - 6 + (k % 5), s1.cellY + 3 + Math.trunc(k / 5)));
  g.fog.update(w);
  const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: MAX_TICKS }, 0, "balanced");
  const first = ai.think(buildView(g, 0));
  assert.ok(first.some((c) => c.c === "move" && c.u.length === 20 && c.x === s1.cellX && c.y === s1.cellY), "marches on the city");
  let city = -1;
  for (let s = 0; s < w.buildings.count; s++) if (w.buildings.col.owner[s] === 1 && w.buildings.col.type[s] === BuildingType.MainCity) city = s;
  return { g, w, s1, ai, ids, city };
}

test("it does not break off from an enemy main city at 40% hp or less, but does from a sound one", () => {
  for (const [hp, retreats] of [[1200, true], [480, false], [300, false]] as const) {
    const { g, w, s1, ai, city } = atEnemyCity();
    // 25 defenders turn up around the army: outnumbered.
    for (let k = 0; k < 25; k++) put(g, 1, UnitType.Spearman, s1.cellX - 7 + (k % 5), s1.cellY + 8 + Math.trunc(k / 5));
    w.buildings.col.hp[city] = hp;
    w.tick += 20;
    g.fog.update(w);
    assert.equal(ai.think(buildView(g, 0)).some((c) => c.c === "retreat"), retreats, `city at ${hp} hp`);
  }
});

test("soldiers trained during the assault join it", () => {
  const { g, w, ai } = atEnemyCity();
  const s0 = w.map.spawns[0];
  const fresh = put(g, 0, UnitType.Spearman, s0.cellX + 3, s0.cellY - 3);
  w.tick += 200;
  g.fog.update(w);
  const attack = ai.think(buildView(g, 0)).find((c) => c.c === "attack") as { u: number[] } | undefined;
  assert.ok(attack !== undefined && attack.u.includes(fresh) && attack.u.length === 21, "the new spearman is in the attack order");
});

test("from minute 26 the garrison of a governed town joins the assault", () => {
  const g = emptyGame();
  const w = g.w;
  const [small] = w.map.towns;
  w.townState[small.id] = TownState.Governed;
  w.townOwner[small.id] = 0;
  const s0 = w.map.spawns[0];
  // A small town keeps garrisonNeeded (1) + 1 soldiers: these two, the nearest.
  const guards = [0, 1].map((k) => put(g, 0, UnitType.Spearman, small.cellX + k, small.cellY + 1));
  for (let k = 0; k < 16; k++) put(g, 0, UnitType.Spearman, s0.cellX + 14 + (k % 6), s0.cellY - 14 - Math.trunc(k / 6));
  const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: MAX_TICKS }, 0, "balanced");
  const orders = (minute: number) => {
    w.tick = minute * 1200;
    g.fog.update(w);
    return ai.think(buildView(g, 0)).filter((c) => c.c === "move" || c.c === "attack") as { u: number[] }[];
  };
  const before = orders(25).find((c) => c.u.length >= 16);
  assert.ok(before !== undefined && !guards.some((id) => before.u.includes(id)), "minute 25: the garrison stays");
  const after = orders(26).find((c) => c.u.length >= 16);
  assert.ok(after !== undefined && guards.every((id) => after.u.includes(id)), "minute 26: the garrison goes too");
});
test("from minute 26 it no longer goes back to finish a plunder", () => {
  const where = (minute: number) => {
    const g = emptyGame();
    const w = g.w;
    w.tick = minute * 1200;
    const [small] = w.map.towns;
    w.townState[small.id] = TownState.Plundering;
    w.townOwner[small.id] = 0;
    put(g, 0, UnitType.Spearman, small.cellX, small.cellY + 1);
    const s0 = w.map.spawns[0];
    for (let k = 0; k < 10; k++) put(g, 0, UnitType.Spearman, s0.cellX + 14 + (k % 5), s0.cellY - 14 - Math.trunc(k / 5));
    g.fog.update(w);
    const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: MAX_TICKS }, 0, "balanced");
    const m = ai.think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length === 11) as { x: number; y: number } | undefined;
    return m && (m.x === small.cellX && m.y === small.cellY ? "town" : m.x === w.map.spawns[1].cellX && m.y === w.map.spawns[1].cellY ? "enemy base" : "other");
  };
  assert.equal(where(25), "town", "minute 25: finishes the plunder first");
  assert.equal(where(26), "enemy base", "minute 26: straight for the enemy main city");
});


test("without a time limit (a person plays) there is no end game: towns as ever, no march at a fixed minute", () => {
  const none = { maxTicks: 0 };
  assert.equal(goesAt(18, 22, none), "town", "minute 22: still takes towns");
  assert.equal(goesAt(18, 40, none), "town", "minute 40: still takes towns");
  assert.equal(goesAt(9, 24, none), "rally", "minute 24: no small army sent off to die");
  assert.equal(goesAt(9, 60, none), "rally", "minute 60: nor later");
  // The limit is counted back from: in a 40-minute game, minute 32 is what minute 22 is in 30.
  assert.equal(goesAt(18, 31, { maxTicks: 40 * 1200 }), "town");
  assert.equal(goesAt(18, 32, { maxTicks: 40 * 1200 }), "enemy base");
});

test("without a time limit it also marches once its population is full", () => {
  assert.equal(goesAt(24, 12, { maxTicks: 0 }), "town", "can still grow: a town first");
  assert.equal(goesAt(24, 12, { maxTicks: 0, full: true }), "enemy base", "120 of 120: it goes");
  assert.equal(goesAt(24, 12, { full: true }), "town", "with a time limit the old rules stand");
});

test("easy waits: no town before minute 18, no march on the enemy base before minute 20", () => {
  const easy = { maxTicks: 0, difficulty: "easy" as const };
  assert.equal(goesAt(18, 17, easy), "rally");
  assert.equal(goesAt(18, 18, easy), "town");
  assert.equal(goesAt(24, 19, { ...easy, full: true }), "town", "full, but too early for the base");
  assert.equal(goesAt(24, 20, { ...easy, full: true }), "enemy base");
  assert.equal(goesAt(18, 14, { maxTicks: 0 }), "town", "normal does not wait");
});

test("easy holds back: fewer farmers, one barracks and one range, nobody on the crystal vein", () => {
  const r = new Runner({ seed: 4, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", "easy"] });
  while (r.game.tick < 16000) r.tick();
  const w = r.game.w;
  const u = w.units.col;
  let farmers = 0;
  let onVein = 0;
  for (let s = 0; s < w.units.count; s++) {
    if (u.owner[s] !== 1 || u.type[s] !== UnitType.Farmer) continue;
    farmers++;
    if (u.order[s] === Order.Gather && u.onFarm[s] === 0 && w.nodeKind[u.orderTarget[s]] === NodeKind.CrystalVein) onVein++;
  }
  let production = 0;
  for (let s = 0; s < w.buildings.count; s++) {
    const t = w.buildings.col.type[s];
    if (w.buildings.col.owner[s] === 1 && (t === BuildingType.Barracks || t === BuildingType.Range)) production++;
  }
  assert.ok(farmers <= 22, `${farmers} farmers`);
  assert.ok(production <= 2, `${production} barracks and ranges`);
  assert.equal(onVein, 0);
});

test("easy leaves the second town alone for a while (normal does not)", () => {
  for (const difficulty of ["easy", "normal"] as const) {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    for (let k = 0; k < 12; k++) put(g, 0, UnitType.Spearman, s0.cellX + 14 + (k % 6), s0.cellY - 14 - Math.trunc(k / 6));
    const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty }, 0, "balanced");
    const [small, big] = w.map.towns;
    // The corner towns (round 6) lie in ruins, a farmer by each so the AI sees it: this is
    // about the middle town and the big one.
    for (const t of w.map.towns.slice(2)) {
      w.townState[t.id] = TownState.Ruins;
      w.townOwner[t.id] = NO_OWNER;
      put(g, 0, UnitType.Farmer, t.cellX + 2, t.cellY + 2);
    }
    const s1 = w.map.spawns[1];
    // A lookout by the small town, so the AI sees what becomes of it.
    put(g, 0, UnitType.Spearman, small.cellX + 3, small.cellY + 3);
    const at = (minute: number) => {
      w.tick = minute * 1200;
      g.fog.update(w);
      const m = ai.think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length >= 10) as { x: number; y: number } | undefined;
      if (m === undefined) return "none";
      if (m.x === small.cellX && m.y === small.cellY) return "small";
      if (m.x === big.cellX && m.y === big.cellY) return "big";
      return m.x === s1.cellX && m.y === s1.cellY ? "base" : "rally";
    };
    assert.equal(at(18), "small", `${difficulty}: the first trip`);
    // Taken (plundered: ruins); the army comes back.
    w.townState[small.id] = TownState.Ruins;
    w.townOwner[small.id] = NO_OWNER;
    if (difficulty === "easy") {
      assert.equal(at(19), "rally", "easy: not yet for the big town");
      assert.equal(at(20), "base", "easy: from minute 20 the enemy base, if it has the soldiers");
    } else {
      assert.equal(at(19), "big", "normal: straight on to the big town");
    }
  }
});

/**
 * No time limit, both towns in ruins (nothing to take): an AI whose 30 spearmen, out from
 * home, march on the enemy base. Returns the game, the AI and the 30 ids.
 */
function marchOnBase() {
  const g = emptyGame();
  const w = g.w;
  for (const t of w.map.towns) {
    w.townState[t.id] = TownState.Ruins;
    w.townOwner[t.id] = NO_OWNER;
    w.townTimer[t.id] = 4800; // ruins for 4 minutes
    // A farmer by each town, so the AI sees the ruins (farmers are not part of the army).
    put(g, 0, UnitType.Farmer, t.cellX + 2, t.cellY + 2);
  }
  w.tick = 12 * 1200;
  const s0 = w.map.spawns[0];
  const ids: number[] = [];
  for (let k = 0; k < 30; k++) ids.push(put(g, 0, UnitType.Spearman, s0.cellX + 14 + (k % 6), s0.cellY - 14 - Math.trunc(k / 6)));
  g.fog.update(w);
  const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0 }, 0, "balanced");
  const s1 = w.map.spawns[1];
  const first = ai.think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length === 30) as { x: number; y: number } | undefined;
  assert.deepEqual(first && [first.x, first.y], [s1.cellX, s1.cellY], "marches on the enemy base");
  return { g, w, ai, ids, s0, s1 };
}

/** Removes these units (hp 0, then one step takes the dead away). */
function kill(g: Game, ids: number[]): void {
  for (const id of ids) g.w.units.col.hp[slotOf(g, id)] = 0;
  g.step();
  g.fog.update(g.w);
}

test("an attack breaks off once the soldiers that set out are ground down, however many newcomers follow", () => {
  const { g, ai, ids, s0 } = marchOnBase();
  // 20 of the 30 fall while 25 newcomers are on their way: 35 soldiers, 10 of those that set out.
  for (let k = 0; k < 25; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + (k % 5), s0.cellY - 4 - Math.trunc(k / 5));
  kill(g, ids.slice(0, 20));
  assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "retreat"), "breaks off and gathers again");
});

test("after a broken-off attack on the enemy base it goes again only with the full army for the base", () => {
  // 24 soldiers, towns done: enough for the shortcut (town army + 6 is at most 23), not for the
  // full army for the base (at least 26).
  const fresh = marchOnBase();
  kill(fresh.g, fresh.ids.slice(0, 6));
  const again = marchOnBase();
  kill(again.g, again.ids.slice(0, 20)); // ground down: breaks off
  assert.ok(again.ai.think(buildView(again.g, 0)).some((c) => c.c === "retreat"));
  for (let k = 0; k < 14; k++) put(again.g, 0, UnitType.Spearman, again.s0.cellX + 4 + (k % 5), again.s0.cellY - 4 - Math.trunc(k / 5));
  again.g.fog.update(again.g.w);
  const toBase = (orders: CommandBody[], s1: { cellX: number; cellY: number }) =>
    orders.some((c) => c.c === "move" && c.u.length >= 24 && c.x === s1.cellX && c.y === s1.cellY);
  // The fresh AI (never broken off) is already marching; a new AI with the same 24 would go.
  const other = marchOnBase();
  kill(other.g, other.ids.slice(0, 6));
  const newcomer = createAi(0, 1, { map: other.w.map, rules: rules(), frame: other.w.map.frames[0], maxTicks: 0 }, 0, "balanced");
  assert.ok(toBase(newcomer.think(buildView(other.g, 0)), other.s1), "24 go on the shortcut");
  assert.equal(toBase(again.ai.think(buildView(again.g, 0)), again.s1), false, "after breaking off: 24 wait for more");
});

test("marching on a known enemy main city it keeps together until it is there, then attacks", () => {
  const { g, w, ai, ids, s1 } = marchOnBase();
  // A farmer by the enemy main city: the city is in view (farmers are not part of the army).
  put(g, 0, UnitType.Farmer, s1.cellX - 5, s1.cellY + 5);
  g.fog.update(w);
  const orders = (ticks: number) => {
    w.tick += ticks;
    g.fog.update(w);
    return ai.think(buildView(g, 0));
  };
  const on = orders(200);
  assert.equal(on.some((c) => c.c === "attack"), false, "far from the city: no attack order (it would stream in one by one)");
  const regroup = orders(200).find((c) => c.c === "move" && c.u.length === 30) as { x: number; y: number } | undefined;
  assert.deepEqual(regroup && [regroup.x, regroup.y], [s1.cellX, s1.cellY], "the march goes on as a group");
  // There: the 30 stand by the enemy main city, no defenders in view.
  ids.forEach((id, k) => {
    const s = slotOf(g, id);
    w.units.col.x[s] = ((s1.cellX - 7 + (k % 6)) << 10) + 512;
    w.units.col.y[s] = ((s1.cellY + 5 + Math.trunc(k / 6)) << 10) + 512;
  });
  const at = orders(200).find((c) => c.c === "attack") as { u: number[] } | undefined;
  assert.ok(at !== undefined && at.u.length === 30, "attacks the city");
});

test("the AI's ratio does not send a farmer back and forth (operations round, D-050)", () => {
  const r = new Runner({ seed: 1, scenario: "standard", ai: [true, true], maxTicks: 0 });
  const w = r.game.w;
  const u = w.units.col;
  const gathering = (s: number) => {
    if (u.order[s] !== Order.Gather) return -1;
    if (u.onFarm[s] === 1) return 0;
    const kind = w.nodeKind[u.orderTarget[s]];
    return kind === NodeKind.Tree ? 1 : kind === NodeKind.GoldMine ? 2 : kind === NodeKind.Berries ? 0 : 3;
  };
  const last = new Map<number, { r: number; t: number }>();
  const lastMove = new Map<number, { tick: number; from: number; to: number }>();
  let moves = 0;
  let back = 0;
  while (!r.over && w.tick < 12000) {
    r.tick();
    for (let s = 0; s < w.units.count; s++) {
      if (u.type[s] !== UnitType.Farmer) continue;
      const id = u.id[s];
      const now = gathering(s);
      const prev = last.get(id);
      // Moved by the ratio: on to another resource while the old node was still there.
      if (prev && now >= 0 && prev.r >= 0 && now !== prev.r && prev.t >= 0 && w.nodeAmount[prev.t] > 0) {
        moves++;
        const m = lastMove.get(id);
        if (m && m.from === now && m.to === prev.r && w.tick - m.tick < 600) back++;
        lastMove.set(id, { tick: w.tick, from: prev.r, to: now });
      }
      last.set(id, { r: now, t: u.onFarm[s] === 1 ? -1 : u.orderTarget[s] });
    }
  }
  assert.ok(moves > 0, "the ratio moved some farmers");
  assert.equal(back, 0, "none of them back within 30 s");
});

// --- hard (D-052, D-055) ---------------------------------------------------------------------------

/** A hard AI for player 0 of `g`, without a time limit (a person plays), with plan numbers replaced. */
function hardAi(g: Game, plan: Partial<HardPlan> = {}, player = 0) {
  return createAi(player, 1, { map: g.w.map, rules: rules(), frame: g.w.map.frames[player], maxTicks: 0, difficulty: "hard", hard: plan }, player);
}

test("hard: two identical hard AIs on the mirrored spawns play mirror images of each other", () => {
  const g = new Game({ seed: 7, scenario: "standard" });
  const w = g.w;
  const ais = [0, 1].map((p) => createAi(p, 7, { map: w.map, rules: rules(), frame: w.map.frames[p], maxTicks: MAX_TICKS, difficulty: "hard" }, 0));
  let seq = 0;
  for (let t = 0; t < 4000; t++) {
    if (g.tick % 10 === 0) {
      for (let p = 0; p < 2; p++) for (const body of ais[p].think(buildView(g, p))) g.push({ ...body, t: g.tick, p, seq: seq++ } as never);
    }
    g.step();
    assert.equal(units(g, 1), units(g, 0), `tick ${g.tick}`);
  }
});

/** Three spearmen of player 0 side by side, an enemy mage 7-8 cells off calibrating a shot on the first. */
function cannonOnThree() {
  const g = emptyGame();
  const w = g.w;
  const ids = [put(g, 0, UnitType.Spearman, 40, 40), put(g, 0, UnitType.Spearman, 40, 41), put(g, 0, UnitType.Spearman, 41, 40)];
  // 7 cells and more from them: beyond the 6 cells at which idle soldiers go after an enemy.
  const mage = put(g, 1, UnitType.Mage, 48, 40);
  w.res[1 * 4 + 3] = 100;
  const s = slotOf(g, ids[0]);
  startCast(w, slotOf(g, mage), w.units.col.x[s], w.units.col.y[s], false);
  g.fog.update(w);
  return { g, w, ids };
}

test("hard: soldiers step out of a crystal cannon's warning; only the one it aims at, too late to get out, is hit", () => {
  for (const dodge of [true, false]) {
    const { g, w, ids } = cannonOnThree();
    const ai = hardAi(g, { dodge });
    const orders = ai.think(buildView(g, 0));
    const out = orders.filter((c) => c.c === "retreat") as { u: number[] }[];
    if (dodge) assert.deepEqual(out.map((c) => c.u[0]).sort(), [ids[1], ids[2]].sort(), "the two at the edge step out");
    else assert.equal(out.length, 0);
    // Only the steps out go into the game (the army's own orders would move it anyway).
    let seq = 0;
    for (const body of out) g.push({ ...body, t: g.tick, p: 0, seq: seq++ } as never);
    for (let k = 0; k < 40; k++) g.step();
    assert.equal(w.cannonHits[1], dodge ? 1 : 3, dodge ? "one hit" : "without stepping out all three are hit");
  }
});

test("hard: army orders leave out a mage calibrating a shot (an order would call it off)", () => {
  const g = emptyGame();
  const w = g.w;
  const s0 = w.map.spawns[0];
  const ids: number[] = [];
  for (let k = 0; k < 8; k++) ids.push(put(g, 0, UnitType.Spearman, s0.cellX + 14 + k, s0.cellY - 14));
  const mage = put(g, 0, UnitType.Mage, s0.cellX + 14, s0.cellY - 15);
  w.res[3] = 100;
  startCast(w, slotOf(g, mage), (s0.cellX + 20) << 10, (s0.cellY - 20) << 10, true);
  g.fog.update(w);
  const move = hardAi(g).think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length >= 8) as { u: number[] } | undefined;
  assert.ok(move !== undefined && ids.every((id) => move.u.includes(id)), "the spearmen get the order");
  assert.equal(move.u.includes(mage), false, "the calibrating mage does not");
});

/** Where hard's army of 26 spearmen (out in the field, no town worth taking) goes after it saw 40 enemy soldiers that then vanished. */
function afterSighting(how: "fog" | "fell"): string {
  const g = emptyGame();
  const w = g.w;
  for (const t of w.map.towns) {
    w.townState[t.id] = TownState.Ruins;
    w.townOwner[t.id] = NO_OWNER;
    w.townTimer[t.id] = 4800;
    put(g, 0, UnitType.Farmer, t.cellX + 2, t.cellY + 2);
  }
  w.tick = 12 * 1200;
  for (let k = 0; k < 26; k++) put(g, 0, UnitType.Spearman, 40 + (k % 6), 60 + Math.trunc(k / 6));
  const foes: number[] = [];
  for (let k = 0; k < 40; k++) foes.push(put(g, 1, UnitType.Spearman, 38 + (k % 10), 55 + Math.trunc(k / 10)));
  g.fog.update(w);
  const ai = hardAi(g, { pushArmy: 20, dodge: false });
  ai.think(buildView(g, 0));
  const s1 = w.map.spawns[1];
  const marches = () => {
    w.tick += 10;
    g.fog.update(w);
    return ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.u.length >= 20 && c.x === s1.cellX && c.y === s1.cellY);
  };
  if (how === "fell") {
    kill(g, foes);
    return marches() ? "enemy base" : "other";
  }
  // They walk off north into the fog, half a cell a think, as soldiers do.
  let marched = false;
  for (let step = 0; step < 20; step++) {
    for (const id of foes) w.units.col.y[slotOf(g, id)] -= 512;
    if (marches()) marched = true;
  }
  return marched ? "enemy base" : "other";
}

test("hard: it remembers enemy soldiers that walked into the fog, and counts those it saw fall", () => {
  assert.equal(afterSighting("fog"), "other", "40 enemy soldiers still out there: it does not march with 26");
  assert.equal(afterSighting("fell"), "enemy base", "it saw all 40 fall: it marches");
});

/** Hard's 30 spearmen marched on the enemy main city and stand by it; `fallen` of them die, `defenders` enemy spearmen turn up. */
function siege(fallen: number, defenders: number): CommandBody[] {
  const g = emptyGame();
  const w = g.w;
  for (const t of w.map.towns) {
    w.townState[t.id] = TownState.Ruins;
    w.townOwner[t.id] = NO_OWNER;
    w.townTimer[t.id] = 4800;
  }
  w.tick = 12 * 1200;
  const s0 = w.map.spawns[0];
  const s1 = w.map.spawns[1];
  const ids: number[] = [];
  for (let k = 0; k < 30; k++) ids.push(put(g, 0, UnitType.Spearman, s0.cellX + 10 + (k % 6), s0.cellY - 10 - Math.trunc(k / 6)));
  g.fog.update(w);
  const ai = hardAi(g, { dodge: false, pushArmy: 24 });
  const go = ai.think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length === 30) as { x: number; y: number } | undefined;
  assert.deepEqual(go && [go.x, go.y], [s1.cellX, s1.cellY], "marches on the enemy base");
  ids.forEach((id, k) => {
    const s = slotOf(g, id);
    w.units.col.x[s] = ((s1.cellX - 6 + (k % 6)) << 10) + 512;
    w.units.col.y[s] = ((s1.cellY + 3 + Math.trunc(k / 6)) << 10) + 512;
  });
  kill(g, ids.slice(0, fallen));
  for (let k = 0; k < defenders; k++) put(g, 1, UnitType.Spearman, s1.cellX - 7 + (k % 5), s1.cellY + 8 + Math.trunc(k / 5));
  w.tick += 200;
  g.fog.update(w);
  return ai.think(buildView(g, 0));
}

test("hard: an attack on an undefended main city goes on however many the arrows took; it breaks off against stronger defenders", () => {
  const alone = siege(20, 0);
  assert.equal(alone.some((c) => c.c === "retreat"), false, "10 of 30 left, nobody defends: no retreat (normal would)");
  assert.ok(alone.some((c) => c.c === "attack" && c.u.length === 10), "the 10 attack the city");
  assert.ok(siege(20, 15).some((c) => c.c === "retreat"), "15 defenders against 10: breaks off");
});

test("hard: soldiers trained while the army is away wait at home and follow six at a time", () => {
  const g = emptyGame();
  const w = g.w;
  for (const t of w.map.towns) {
    w.townState[t.id] = TownState.Ruins;
    w.townOwner[t.id] = NO_OWNER;
    w.townTimer[t.id] = 4800;
  }
  w.tick = 12 * 1200;
  const s0 = w.map.spawns[0];
  const s1 = w.map.spawns[1];
  for (let k = 0; k < 30; k++) put(g, 0, UnitType.Spearman, s0.cellX + 10 + (k % 6), s0.cellY - 10 - Math.trunc(k / 6));
  g.fog.update(w);
  const ai = hardAi(g, { dodge: false, pushArmy: 24 });
  ai.think(buildView(g, 0));
  const fresh: number[] = [];
  const toBase = () => {
    w.tick += 400;
    g.fog.update(w);
    return ai.think(buildView(g, 0)).filter((c) => c.c === "move" && c.x === s1.cellX && c.y === s1.cellY) as { u: number[] }[];
  };
  for (let k = 0; k < 5; k++) fresh.push(put(g, 0, UnitType.Spearman, s0.cellX + 3 + k, s0.cellY - 3));
  assert.ok(toBase().every((c) => !fresh.some((id) => c.u.includes(id))), "five new ones wait");
  fresh.push(put(g, 0, UnitType.Spearman, s0.cellX + 3, s0.cellY - 4));
  assert.ok(toBase().some((c) => fresh.every((id) => c.u.includes(id))), "the sixth: all six go");
});

test("hard: the mage hall comes first once there is the crystal for a mage", () => {
  const plan = (crystal: number) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    for (let k = 0; k < 12; k++) {
      const id = put(g, 0, UnitType.Farmer, s0.cellX - 4 + k, s0.cellY + 4);
      w.units.col.order[slotOf(g, id)] = Order.Gather;
    }
    w.res.set([500, 500, 500, crystal], 0);
    g.fog.update(w);
    return (hardAi(g).think(buildView(g, 0)).find((c) => c.c === "build") as { type: number } | undefined)?.type;
  };
  assert.equal(plan(50), BuildingType.MageHall);
  assert.notEqual(plan(0), BuildingType.MageHall);
});

test("hard: it trains spearmen rather than ranged units against an enemy with mages", () => {
  const first = (enemyMages: number) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.addBuilding(0, BuildingType.Barracks, s0.cellX + 4, s0.cellY - 8, 500, 1000);
    w.addBuilding(0, BuildingType.Range, s0.cellX + 8, s0.cellY - 8, 500, 1000);
    for (let k = 0; k < 3; k++) w.addBuilding(0, BuildingType.House, s0.cellX - 8 + 3 * k, s0.cellY + 6, 200, 1000);
    for (let k = 0; k < 6; k++) put(g, 0, UnitType.Spearman, 40 + k, 60);
    for (let k = 0; k < 4; k++) put(g, 0, UnitType.Ranged, 40 + k, 61);
    for (let k = 0; k < enemyMages; k++) put(g, 1, UnitType.Mage, 40 + k, 55);
    // Enough for one soldier only: food 40, wood 40, gold 30.
    w.res.set([40, 40, 30, 0], 0);
    g.fog.update(w);
    return (hardAi(g, { dodge: false }).think(buildView(g, 0)).find((c) => c.c === "train") as { type: number } | undefined)?.type;
  };
  assert.equal(first(0), UnitType.Ranged, "6 spearmen, 4 ranged, no mages seen: a ranged unit");
  assert.equal(first(2), UnitType.Spearman, "two enemy mages seen: a spearman");
});

test("hard: the economy ratio leans away from what piles up", () => {
  const ratio = (gold: number) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.addBuilding(0, BuildingType.Range, s0.cellX + 8, s0.cellY - 8, 500, 1000);
    w.res.set([200, 50, gold, 0], 0);
    g.fog.update(w);
    return hardAi(g).think(buildView(g, 0)).find((c) => c.c === "eco_ratio") as { food: number; wood: number; gold: number };
  };
  const some = ratio(200);
  const pile = ratio(1000);
  assert.ok(pile.gold < some.gold && pile.wood > some.wood, `${JSON.stringify(some)} then ${JSON.stringify(pile)}`);
  assert.equal(pile.gold, 5, "a quarter of its share, at least 5");
});

test("hard: a lone raider at home draws back a few soldiers, not the army out at a town", () => {
  const orders = (raiders: number) => {
    const g = emptyGame();
    const w = g.w;
    const [small] = w.map.towns;
    const ids: number[] = [];
    for (let k = 0; k < 14; k++) ids.push(put(g, 0, UnitType.Spearman, 40 + (k % 7), 60 + Math.trunc(k / 7)));
    g.fog.update(w);
    const ai = hardAi(g, { dodge: false });
    // Off to the small town (the nearest one it can take).
    const go = ai.think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length === 14) as { x: number; y: number } | undefined;
    assert.ok(go !== undefined && w.map.towns.some((t) => t.cellX === go.x && t.cellY === go.y), "off to a town");
    const s0 = w.map.spawns[0];
    for (let k = 0; k < raiders; k++) put(g, 1, UnitType.Spearman, s0.cellX + 5 + k, s0.cellY - 5);
    // A farmer at home sees them.
    put(g, 0, UnitType.Farmer, s0.cellX + 3, s0.cellY - 3);
    w.tick += 10;
    g.fog.update(w);
    return { out: ai.think(buildView(g, 0)).filter((c) => c.c === "move") as { u: number[]; x: number; y: number }[], small, s0 };
  };
  const one = orders(1);
  const back = one.out.filter((c) => Math.abs(c.x - one.s0.cellX) <= 8 && Math.abs(c.y - one.s0.cellY) <= 8);
  assert.equal(back.length, 1);
  assert.equal(back[0].u.length, 3, "two for the raider and one more");
  const five = orders(5);
  assert.ok(five.out.some((c) => c.u.length === 14 && Math.abs(c.x - five.s0.cellX) <= 8 && Math.abs(c.y - five.s0.cellY) <= 8), "five raiders: everyone home");
});
