// The simple AI (PR-5): fairness on the mirrored map, its styles, and that it gets going.

import assert from "node:assert/strict";
import test from "node:test";
import { type AiStyle, aroundForts, createAi, enemyForts, type Fort, fortGroups, fortStagePoint, fortValues, GATE_AI, gateLoss, KEEP_AI, mopUpOrders, townDefence, gateOrders, groupsOnWay, HARD, type HardPlan, NORMAL_FORT, onWalls, SIEGE, STAGING, stagePoint, townGates } from "../src/ai/ai.ts";
import { ARMY_BASE, ARMY_HOME, AS_HARD, asHardNet, BUILD_FARMERS, choose, features, forward, MIX_SPEAR, NET_HEADS, NET_INPUTS, NET_SHAPE, type NetWeights, TOWN_GOVERN, TOWN_PLUNDER } from "../src/ai/net.ts";
import { readFileSync } from "node:fs";
import { Game } from "../src/core/game.ts";
import { CAVALRY, DODGE, GARRISON, POPULATION_200, rules, TOWN_ONCE } from "../src/core/rules.ts";
import * as RULES from "../src/core/rules.ts";
import { UNIT_KINDS } from "../src/core/world.ts";
import { startCast } from "../src/core/units.ts";
import { Action, type AiDifficulty, BuildingType, CELL, type CommandBody, HeaderField, MAX_TICKS, NO_OWNER, NodeKind, Order, Reject, TownChoice, TownSize, TownState, UNIT_STRIDE, UnitField, UnitType } from "../src/protocol.ts";
import { aiKnowledge, Runner } from "../src/runner.ts";
import { buildView, mapInfo } from "../src/view/view.ts";
import { fromCanon, spawnCentre, toCanon } from "../src/frame.ts";
import { emptyGame, put, slotOf, switchedOff, switchedOn } from "./helpers.ts";
import { KEEP } from "../src/core/keep.ts";
import { createScriptedPlayer, planFor, SCRIPTED_THINK_EVERY } from "../src/ai/scripted-player.ts";

// D-089: gathering outside the enemy main city first has its own tests (at the end); the tests before them
// are about when and how it marches, and expect it to march straight on.
STAGING.on = false;

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
    assert.ok(soldiers + w.trained[p * UNIT_KINDS + UnitType.Spearman] > 0, `player ${p} started an army`);
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
 * in view): in a 30-minute game unless `maxTicks` says otherwise; `full`: population and cap at the ceiling
 * (120 with the population rules off, 200 on: D-083).
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
    view.header[HeaderField.population] = view.header[HeaderField.populationCeiling];
    view.header[HeaderField.populationCap] = view.header[HeaderField.populationCeiling];
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
  assert.equal(goesAt(24, 12, { maxTicks: 0, full: true }), "enemy base", "at the ceiling: it goes");
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

// Round 8 (D-069): with soldiers stepping out on their own (DODGE), the control would not be hit.
test("hard: soldiers step out of a crystal cannon's warning; only the one it aims at, too late to get out, is hit", switchedOff(DODGE, () => {
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
}));

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
  const ai = hardAi(g, { dodge: false, pushArmy: 24, peekFirst: 0 });
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

test("hard: an attack on an undefended main city goes on however many the arrows took; it breaks off against stronger defenders", () =>
  withSwitches({}, () => {
    const alone = siege(20, 0);
    assert.equal(alone.some((c) => c.c === "retreat"), false, "10 of 30 left, nobody defends: no retreat (normal would)");
    assert.ok(alone.some((c) => c.c === "attack" && c.u.length === 10), "the 10 attack the city");
    assert.ok(siege(20, 15).some((c) => c.c === "retreat"), "15 defenders against 10: breaks off");
  }));

test("hard: soldiers trained while the army is away wait at home and follow six at a time", () =>
  withSwitches({}, () => {
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
    const ai = hardAi(g, { dodge: false, pushArmy: 24, peekFirst: 0 });
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
  }));

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

// --- round 7 (D-061) ------------------------------------------------------------------------------------

/** Runs `f` with these round 7 switches on, then puts them back (the AI reads them from rules().features). */
function withSwitches<T>(on: { once?: boolean; garrison?: boolean; cavalry?: boolean }, f: () => T): T {
  const was = [TOWN_ONCE.on, GARRISON.on, CAVALRY.on];
  TOWN_ONCE.on = on.once ?? false;
  GARRISON.on = on.garrison ?? false;
  CAVALRY.on = on.cavalry ?? false;
  try {
    return f();
  } finally {
    [TOWN_ONCE.on, GARRISON.on, CAVALRY.on] = was;
  }
}

/** The town choice an AI of `difficulty` makes for a small town it took that was plundered before. */
function plunderedChoice(difficulty: AiDifficulty, rich: boolean, once: boolean): CommandBody | undefined {
  return withSwitches({ once }, () => {
    const g = emptyGame();
    const w = g.w;
    w.townState[0] = TownState.AwaitingChoice;
    w.townOwner[0] = 0;
    w.townPlundered[0] = 1;
    w.res.set(rich ? [1000, 1000, 1000, 0] : [0, 0, 0, 0], 0);
    for (let k = 0; k < 10; k++) put(g, 0, UnitType.Spearman, w.townX[0] + (k % 3), w.townY[0] + 1 + Math.trunc(k / 3));
    g.fog.update(w);
    const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty }, 0, "plunder");
    return ai.think(buildView(g, 0)).find((c) => c.c === "town_choice");
  });
}

test("round 7: a town plundered before is governed when the AI can pay, and nothing is sent when it cannot (every difficulty)", () => {
  for (const difficulty of ["easy", "normal", "hard"] as const) {
    assert.deepEqual(plunderedChoice(difficulty, true, true), { c: "town_choice", town: 0, choice: TownChoice.Govern }, `${difficulty}, rich`);
    assert.equal(plunderedChoice(difficulty, false, true), undefined, `${difficulty}, poor: no plunder (it would be refused)`);
    // The rule off: these plunderers plunder as before.
    assert.deepEqual(plunderedChoice(difficulty, true, false), { c: "town_choice", town: 0, choice: TownChoice.Plunder }, `${difficulty}, rule off`);
  }
});

/** A normal (or easy) AI with a barracks, a range and a stable at home, soldiers in the field and an enemy ranged unit in view. */
function cavalryGame(difficulty: AiDifficulty) {
  return withSwitches({ cavalry: true }, () => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.addBuilding(0, BuildingType.Barracks, s0.cellX + 4, s0.cellY - 9, 500, 1000);
    w.addBuilding(0, BuildingType.Range, s0.cellX + 8, s0.cellY - 9, 500, 1000);
    const stable = w.addBuilding(0, BuildingType.Stable, s0.cellX + 12, s0.cellY - 9, 500, 1000);
    for (let k = 0; k < 4; k++) w.addBuilding(0, BuildingType.House, s0.cellX - 9 + 3 * k, s0.cellY + 6, 200, 1000);
    for (let k = 0; k < 6; k++) put(g, 0, UnitType.Spearman, 40 + k, 60);
    for (let k = 0; k < 6; k++) put(g, 0, UnitType.Ranged, 40 + k, 61);
    put(g, 1, UnitType.Ranged, 42, 55);
    w.res.set([1000, 1000, 1000, 0], 0);
    g.fog.update(w);
    const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty }, 0, "balanced");
    return { trains: ai.think(buildView(g, 0)).filter((c) => c.c === "train") as { building: number; type: number }[], stable };
  });
}

test("round 7: normal trains cavalry, about one soldier in four, at its stable; easy does not", () => {
  const normal = cavalryGame("normal");
  assert.ok(normal.trains.some((c) => c.type === UnitType.Cavalry && c.building === normal.stable), "6 spearmen, 6 ranged, no cavalry: a horseman");
  const easy = cavalryGame("easy");
  assert.equal(easy.trains.some((c) => c.type === UnitType.Cavalry), false);
});

test("round 7: normal builds a stable once it has seen enemy ranged units or mages", () => {
  const plan = (enemyRanged: boolean) =>
    withSwitches({ cavalry: true }, () => {
      const g = emptyGame();
      const w = g.w;
      const s0 = w.map.spawns[0];
      w.addBuilding(0, BuildingType.Barracks, s0.cellX + 4, s0.cellY - 9, 500, 1000);
      w.addBuilding(0, BuildingType.Range, s0.cellX + 8, s0.cellY - 9, 500, 1000);
      for (let k = 0; k < 4; k++) w.addBuilding(0, BuildingType.House, s0.cellX - 9 + 3 * k, s0.cellY + 6, 200, 1000);
      for (let k = 0; k < 3; k++) w.addBuilding(0, BuildingType.Farm, s0.cellX - 9 + 3 * k, s0.cellY + 2, 100, 1000);
      // Four farmers at work: too few for a lumber camp, granary or mine, enough to send builders.
      for (let k = 0; k < 4; k++) {
        const id = put(g, 0, UnitType.Farmer, s0.cellX - 4 + k, s0.cellY + 4);
        w.units.col.order[slotOf(g, id)] = Order.Gather;
      }
      if (enemyRanged) put(g, 1, UnitType.Ranged, s0.cellX + 6, s0.cellY - 14);
      w.res.set([200, 300, 300, 0], 0);
      g.fog.update(w);
      const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty: "normal" }, 0, "balanced");
      ai.think(buildView(g, 0));
      w.tick += 10;
      return (ai.think(buildView(g, 0)).find((c) => c.c === "build") as { type: number } | undefined)?.type;
    });
  assert.equal(plan(true), BuildingType.Stable);
  assert.notEqual(plan(false), BuildingType.Stable);
});

/** Normal's ranged units, mage and spearmen at home with `foes` enemy spearmen 10 cells from its main city. */
function homeRaid(difficulty: AiDifficulty, foes: number) {
  return withSwitches({ garrison: true }, () => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    const city = w.buildings.col.id[w.mainCity(0)];
    const shooters = [0, 1, 2].map((k) => put(g, 0, UnitType.Ranged, s0.cellX + 4 + k, s0.cellY - 5));
    shooters.push(put(g, 0, UnitType.Mage, s0.cellX + 7, s0.cellY - 5));
    const spears = [0, 1, 2, 3].map((k) => put(g, 0, UnitType.Spearman, s0.cellX + 4 + k, s0.cellY - 6));
    for (let k = 0; k < foes; k++) put(g, 1, UnitType.Spearman, s0.cellX + 7 + k, s0.cellY - 7);
    g.fog.update(w);
    const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty }, 0, "balanced");
    return { g, w, ai, city, shooters, spears, out: ai.think(buildView(g, 0)) };
  });
}

test("round 7: with enemies near its main city normal hides its ranged units and mages in it, and brings them out after", () => {
  const { g, w, ai, city, shooters, spears, out } = homeRaid("normal", 3);
  const hide = out.find((c) => c.c === "garrison") as { u: number[]; building: number } | undefined;
  assert.ok(hide !== undefined && hide.building === city, "into the main city");
  assert.deepEqual([...hide.u].sort(), [...shooters].sort(), "the three ranged units and the mage");
  const meet = out.find((c) => c.c === "move") as { u: number[] } | undefined;
  assert.ok(meet !== undefined && spears.every((id) => meet.u.includes(id)) && !shooters.some((id) => meet.u.includes(id)), "the spearmen go out, the others do not");
  // Inside; the enemies are gone; 10 s later they come out.
  withSwitches({ garrison: true }, () => {
    for (const id of shooters) {
      const s = slotOf(g, id);
      w.units.col.order[s] = Order.Garrison;
      w.units.col.orderTarget[s] = city;
    }
    for (let s = 0; s < w.units.count; s++) if (w.units.col.owner[s] === 1) w.units.col.hp[s] = 0;
    g.step();
    g.fog.update(w);
    w.tick += 300;
    assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "leave" && c.building === city), "they come out");
  });
  assert.equal(homeRaid("easy", 3).out.some((c) => c.c === "garrison"), false, "easy does not");
});

test("round 7: hard counts enemy mages that went into a building where someone hides as alive, as many as it holds", () => {
  const goes = (occupied: boolean) =>
    withSwitches({ garrison: true }, () => {
      const g = emptyGame();
      const w = g.w;
      for (const t of w.map.towns) {
        w.townState[t.id] = TownState.Ruins;
        w.townOwner[t.id] = NO_OWNER;
        w.townTimer[t.id] = 4800;
        put(g, 0, UnitType.Farmer, t.cellX + 2, t.cellY + 2);
      }
      w.tick = 12 * 1200;
      for (let k = 0; k < 8; k++) put(g, 0, UnitType.Spearman, 40 + k, 58);
      // An enemy arrow tower in sight (it holds 3), 3 enemy mages beside it.
      const tower = w.addBuilding(1, BuildingType.ArrowTower, 44, 50, 500, 1000);
      const foes = [0, 1, 2].map((k) => put(g, 1, UnitType.Mage, 43 + k, 53));
      g.fog.update(w);
      const ai = hardAi(g, { pushArmy: 4, dodge: false });
      ai.think(buildView(g, 0));
      // They are gone from view; the tower shows someone inside, or nobody.
      kill(g, foes);
      w.buildings.col.soldiers[w.building(tower)] = occupied ? 3 : 0;
      w.tick += 10;
      g.fog.update(w);
      const s1 = w.map.spawns[1];
      return ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.u.length === 8 && c.x === s1.cellX && c.y === s1.cellY);
    });
  assert.equal(goes(true), false, "someone inside: three mages (worth 75) may be in there; 8 spearmen (80) do not march");
  assert.equal(goes(false), true, "nobody inside: they fell, it marches");
});

test("hard keeps a garrison in a town it governs", () => {
  const g = emptyGame();
  const w = g.w;
  const [small] = w.map.towns;
  w.townState[small.id] = TownState.Governed;
  w.townOwner[small.id] = 0;
  w.tick = 12 * 1200;
  const s0 = w.map.spawns[0];
  for (let k = 0; k < 10; k++) put(g, 0, UnitType.Spearman, s0.cellX + 6 + (k % 5), s0.cellY - 6 - Math.trunc(k / 5));
  // A farmer in the town: it sees what it holds.
  put(g, 0, UnitType.Farmer, small.cellX + 1, small.cellY + 1);
  g.fog.update(w);
  const move = hardAi(g, { dodge: false }).think(buildView(g, 0)).find((c) => c.c === "move" && c.x === small.cellX && c.y === small.cellY) as { u: number[] } | undefined;
  assert.ok(move !== undefined && move.u.length === 2, "a small town needs 1: two go");
});

test("round 7: hard's siege when soldiers can hide in the city: ground down it breaks off, and reinforcements wait for the next march", () => {
  // The same siege as above (20 of 30 fallen by the city, nobody in sight), with the rule on.
  const on = withSwitches({ garrison: true }, () => siege(20, 0));
  assert.ok(on.some((c) => c.c === "retreat"), "hiding defenders cannot be seen: ground down, it breaks off");
  assert.equal(withSwitches({}, () => siege(20, 0)).some((c) => c.c === "retreat"), false, "rule off: it goes on, as before");
  // Six new soldiers at home while the army is away: they stay home.
  const sent = withSwitches({ garrison: true }, () => {
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
    const ai = hardAi(g, { dodge: false, pushArmy: 24, peekFirst: 0 });
    ai.think(buildView(g, 0));
    const fresh: number[] = [];
    for (let k = 0; k < 6; k++) fresh.push(put(g, 0, UnitType.Spearman, s0.cellX + 3 + k, s0.cellY - 3));
    w.tick += 400;
    g.fog.update(w);
    return ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.x === s1.cellX && c.y === s1.cellY && fresh.some((id) => c.u.includes(id)));
  });
  assert.equal(sent, false);
});

test("round 7: hard hides its ranged units and mages in its main city when enemies come near it", () => {
  const hides = (on: boolean) =>
    withSwitches({ garrison: on }, () => {
      const g = emptyGame();
      const w = g.w;
      const s0 = w.map.spawns[0];
      const city = w.buildings.col.id[w.mainCity(0)];
      const shooters = [0, 1, 2].map((k) => put(g, 0, UnitType.Ranged, s0.cellX + 4 + k, s0.cellY - 5));
      for (let k = 0; k < 4; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + k, s0.cellY - 6);
      for (let k = 0; k < 3; k++) put(g, 1, UnitType.Spearman, s0.cellX + 7 + k, s0.cellY - 7);
      g.fog.update(w);
      const hide = hardAi(g, { dodge: false }).think(buildView(g, 0)).find((c) => c.c === "garrison") as { u: number[]; building: number } | undefined;
      return hide !== undefined && hide.building === city && shooters.every((id) => hide.u.includes(id));
    });
  assert.equal(hides(true), true);
  assert.equal(hides(false), false, "rule off: nothing to hide in");
});

// --- round 8 sieges (D-073) -------------------------------------------------------------------------------

test("round 8: hard marches on the enemy base with 41–47 soldiers, not the 31–37 of round 7 (D-073); 45–51 with the population rules on (D-083 (c))", () => {
  const marches = (n: number) => {
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
    for (let k = 0; k < n; k++) put(g, 0, UnitType.Spearman, s0.cellX + 8 + (k % 8), s0.cellY - 8 - Math.trunc(k / 8));
    g.fog.update(w);
    // Several games: the number is drawn per game.
    return [1, 2, 3, 4, 5, 6].map((seed) =>
      createAi(0, seed, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty: "hard", hard: { dodge: false, peekFirst: 0 } }, 0)
        .think(buildView(g, 0))
        .some((c) => c.c === "move" && c.u.length === n && c.x === s1.cellX && c.y === s1.cellY),
    );
  };
  const no = [false, false, false, false, false, false];
  const yes = [true, true, true, true, true, true];
  assert.deepEqual(withPopulation(false, () => marches(40)), no, "off, 40: not yet");
  assert.deepEqual(withPopulation(false, () => marches(48)), yes, "off, 48: always");
  assert.deepEqual(withPopulation(true, () => marches(44)), no, "on, 44: not yet");
  assert.deepEqual(withPopulation(true, () => marches(52)), yes, "on, 52: always");
});

// --- random maps: scouting (D-074) -------------------------------------------------------------------------

/** A random map (seed 1: diagonal, player 0 at (111, 16), player 1 at (16, 111)) with every unit removed. */
function emptyRandom(): Game {
  const g = new Game({ seed: 1, scenario: "standard", map: "random" });
  const w = g.w;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[w.units.col.id[s]] = -1;
  w.units.count = 0;
  g.fog.update(w);
  return g;
}

test("random maps: the AI is told what a person is (only its own main city); the fixed map as before", () => {
  const r = emptyRandom();
  for (const p of [0, 1]) {
    const know = aiKnowledge(r.w.map, p, 0, "hard");
    assert.deepEqual(know.map, mapInfo(r.w.map, p));
    assert.deepEqual(know.map.spawns.map((s) => s.player), [p], "no enemy main city");
    assert.equal(know.map.towns.length, 0, "no towns");
  }
  const f = emptyGame();
  for (const p of [0, 1]) {
    const know = aiKnowledge(f.w.map, p, 0, "normal");
    assert.equal(know.map.spawns, f.w.map.spawns, "the same objects as before");
    assert.equal(know.map.towns, f.w.map.towns);
    // The main city's centre cell is the spawn cell itself on the fixed map's frames.
    for (const s of f.w.map.spawns) assert.deepEqual(spawnCentre(f.w.map.frames[p], s), { x: s.cellX, y: s.cellY });
  }
});

test("random maps: a soldier scouts round the edge through the other corners; the next after a fallen one goes the other way", () => {
  for (const difficulty of ["normal", "hard"] as AiDifficulty[]) {
    const g = emptyRandom();
    const w = g.w;
    const frame = w.map.frames[0];
    const n = w.size;
    const ai = createAi(0, 1, { ...aiKnowledge(w.map, 0, 0, difficulty), hard: { dodge: false } }, 0);
    const home = spawnCentre(frame, w.map.spawns[0]);
    const h = toCanon(frame, home.x, home.y);
    const at = (du: number, dv: number) => fromCanon(frame, h.u + du, h.v + dv);
    const a = at(6, -6);
    const first = put(g, 0, UnitType.Spearman, a.x, a.y);
    g.fog.update(w);
    const go = (id: number) => ai.think(buildView(g, 0)).find((c) => c.c === "retreat" && c.u.length === 1 && c.u[0] === id) as { x: number; y: number } | undefined;
    // Canonically it starts bottom-left: first along its own (bottom) edge, 12 cells in.
    const along = go(first);
    assert.deepEqual(along && toCanon(frame, along.x, along.y), { u: n - 1 - 12, v: n - 1 - 12 }, `${difficulty}: along the edge`);
    kill(g, [first]);
    const second = put(g, 0, UnitType.Spearman, a.x, a.y);
    w.tick += 10;
    g.fog.update(w);
    const back = go(second);
    assert.deepEqual(back && toCanon(frame, back.x, back.y), { u: 12, v: 12 }, `${difficulty}: the other way round`);
  }
});

test("random maps: hard marches on the enemy only once it has seen where it is, at its corner first, then at its main city", () => {
  const g = emptyRandom();
  const w = g.w;
  w.tick = 12 * 1200;
  const frame = w.map.frames[0];
  const home = spawnCentre(frame, w.map.spawns[0]);
  const h = toCanon(frame, home.x, home.y);
  const at = (du: number, dv: number) => fromCanon(frame, h.u + du, h.v + dv);
  for (let k = 0; k < 12; k++) {
    const c = at(5 + (k % 4), -5 - Math.trunc(k / 4));
    put(g, 0, UnitType.Spearman, c.x, c.y);
  }
  g.fog.update(w);
  const ai = createAi(0, 1, { ...aiKnowledge(w.map, 0, 0, "hard"), hard: { dodge: false, pushArmy: 6, townArmy: 99, bigArmy: 99, peekFirst: 0 } }, 0);
  // Moves of the army far from home (not to its waiting place by the city).
  const marches = () => (ai.think(buildView(g, 0)).filter((c) => c.c === "move" && c.u.length >= 6) as { x: number; y: number }[]).filter((c) => (c.x - home.x) ** 2 + (c.y - home.y) ** 2 > 30 * 30);
  assert.equal(marches().length, 0, "nothing seen: no march");
  // An enemy house toward the far corner (some 23 cells from its main city, out of sight of
  // it), where one of its soldiers sees it.
  const n = w.size;
  const e = fromCanon(frame, n - 1 - 40, 20);
  w.addBuilding(1, BuildingType.House, e.x, e.y, 200, 1000);
  const eye = fromCanon(frame, n - 1 - 40, 24);
  put(g, 0, UnitType.Ranged, eye.x, eye.y);
  w.tick += 10;
  g.fog.update(w);
  const corner = marches()[0];
  assert.deepEqual(corner && toCanon(frame, corner.x, corner.y), { u: n - 1 - h.u, v: n - 1 - h.v }, "to the corner it was seen in");
  // Its main city in sight: at its centre.
  const city = w.buildings.col;
  const s = w.mainCity(1);
  const near = { x: city.cellX[s] + 2, y: city.cellY[s] + 6 };
  put(g, 0, UnitType.Ranged, near.x, near.y);
  w.tick += 500;
  g.fog.update(w);
  const exact = marches().find((c) => c.x !== corner.x || c.y !== corner.y);
  assert.deepEqual(exact && [exact.x, exact.y], (() => {
    const c = spawnCentre(frame, w.map.spawns[1]);
    return [c.x, c.y];
  })(), "to the main city itself");
});

// --- D-080: enemy outposts and arrow towers ----------------------------------------------------------

/**
 * An AI (player 0) with `spears` spearmen by its main city, `farmers` farmers at work there, and an
 * enemy fort (`type`, finished or a site) at `at` cells from its main city's centre, seen by a farmer
 * of its own beside it; `guards` enemy spearmen and `builders` enemy farmers stand by the fort.
 */
function fortGame(opt: { type: BuildingType; at: [number, number]; done?: boolean; spears?: number; farmers?: number; guards?: number; builders?: number; difficulty?: AiDifficulty }) {
  const g = emptyGame();
  const w = g.w;
  const home = spawnCentre(w.map.frames[0], w.map.spawns[0]);
  const fx = home.x + opt.at[0];
  const fy = home.y + opt.at[1];
  const info = rules().buildings[opt.type];
  const fort = w.addBuilding(1, opt.type, fx, fy, info.hp, opt.done === false ? 300 : 1000);
  const spears = Array.from({ length: opt.spears ?? 0 }, (_, k) => put(g, 0, UnitType.Spearman, home.x + 4 + (k % 6), home.y - 4 - Math.trunc(k / 6)));
  const farmers = Array.from({ length: opt.farmers ?? 0 }, (_, k) => {
    const id = put(g, 0, UnitType.Farmer, home.x - 3 + (k % 4), home.y + 3 + Math.trunc(k / 4));
    w.units.col.order[slotOf(g, id)] = Order.Gather;
    return id;
  });
  put(g, 0, UnitType.Farmer, fx - 3, fy);
  const guards = Array.from({ length: opt.guards ?? 0 }, (_, k) => put(g, 1, UnitType.Spearman, fx - 1 + (k % 3), fy - 1 - Math.trunc(k / 3)));
  const builders = Array.from({ length: opt.builders ?? 0 }, (_, k) => put(g, 1, UnitType.Farmer, fx + k, fy + info.size));
  g.fog.update(w);
  const ai = createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty: opt.difficulty }, 0, "balanced");
  return { g, w, ai, fort, spears, farmers, guards, builders, centre: { x: fx + (info.size >> 1), y: fy + (info.size >> 1) }, out: ai.think(buildView(g, 0)) };
}

test("D-080: an enemy outpost or arrow tower is a fort; a neutral town's tower is not", () => {
  const g = emptyGame();
  const w = g.w;
  const all = () => enemyForts(buildView(g, null), 0, rules());
  assert.deepEqual(all(), [], "the big town's tower is neutral");
  w.addBuilding(1, BuildingType.ArrowTower, 40, 40, 500, 1000);
  w.addBuilding(1, BuildingType.Outpost, 44, 40, 400, 300);
  w.addBuilding(0, BuildingType.ArrowTower, 50, 40, 500, 1000);
  const [tower, outpost] = all();
  assert.equal(all().length, 2, "its own tower is not");
  // From the rules: the tower's arrows (cells, rounded up), the outpost's guards and towers beside it.
  const r = rules();
  const arrows = Math.ceil(r.arrows.arrowTower.range / CELL);
  assert.deepEqual([tower.type, tower.hits, tower.reach, tower.done], [BuildingType.ArrowTower, arrows, arrows, true]);
  assert.deepEqual([outpost.type, outpost.hits, outpost.reach, outpost.done], [BuildingType.Outpost, r.outpost.reach, Math.max(r.outpost.reach, r.towerReach.outpost! + arrows), false], "an outpost: its guards' reach, and the arrows of towers beside it");
});

test("D-080: an arrow tower by its main city: the army goes and pulls it down; one far off it leaves alone", () => {
  for (const difficulty of ["normal", "hard"] as const) {
    const near = fortGame({ type: BuildingType.ArrowTower, at: [2, -14], spears: 8, difficulty });
    const hit = near.out.find((c) => c.c === "attack" && c.target === near.fort) as { u: number[] } | undefined;
    assert.ok(hit !== undefined && near.spears.every((id) => hit.u.includes(id)), `${difficulty}: the army attacks the tower`);
    const far = fortGame({ type: BuildingType.ArrowTower, at: [30, -40], spears: 8, difficulty });
    assert.ok(!far.out.some((c) => (c.c === "attack" && c.target === far.fort) || (c.c === "move" && c.x === far.centre.x && c.y === far.centre.y)), `${difficulty}: not one far off`);
  }
});

test("D-080: an outpost out past the home raid's reach, with guards by it: the army goes for the guards first", () => {
  // 22 cells out the guards do not call the army home (16), but towers beside the outpost would reach its ground.
  const { out, centre, fort } = fortGame({ type: BuildingType.Outpost, at: [0, -22], spears: 12, guards: 2 });
  assert.ok(out.some((c) => c.c === "move" && c.u.length === 12 && c.x === centre.x && c.y === centre.y), "a move to it (fights what it meets)");
  assert.ok(!out.some((c) => c.c === "attack" && c.target === fort), "not the outpost itself yet");
  // Too many guards for it: it stays.
  const strong = fortGame({ type: BuildingType.Outpost, at: [0, -22], spears: 4, guards: 6 });
  assert.ok(!strong.out.some((c) => c.c === "move" && c.x === strong.centre.x && c.y === strong.centre.y), "outnumbered: not");
});

test("D-080: too few soldiers for an unguarded fort site: farmers go for its builders, then the site, and back to work once it is gone", () => {
  for (const difficulty of ["normal", "hard"] as const) {
    const { g, w, ai, fort, farmers, builders, out } = fortGame({ type: BuildingType.ArrowTower, at: [2, -12], done: false, farmers: 8, builders: 2, difficulty });
    const go = out.find((c) => c.c === "attack" && c.u.every((id) => farmers.includes(id))) as { u: number[]; target: number } | undefined;
    assert.ok(go !== undefined && go.u.length === 6, `${difficulty}: three farmers for each of the two builders`);
    assert.ok(builders.includes(go.target), `${difficulty}: at a builder first`);
    for (const id of builders) w.units.col.hp[slotOf(g, id)] = 0;
    g.step();
    g.fog.update(w);
    w.tick += 10;
    assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "attack" && c.target === fort), `${difficulty}: then the site`);
    w.buildings.col.hp[w.building(fort)] = 0;
    g.step();
    g.fog.update(w);
    w.tick += 10;
    const back = ai.think(buildView(g, 0)).find((c) => c.c === "release") as { u: number[] } | undefined;
    assert.deepEqual(back?.u, go.u, `${difficulty}: back to work`);
    // Released, the economy hands them work again (told to attack, a farmer would wait where he is).
    for (let k = 0; k < 40; k++) g.step();
    for (const id of go.u) assert.equal(w.units.col.order[slotOf(g, id)], Order.Gather, `${difficulty}: farmer ${id} at work`);
  }
  // With enemy soldiers by it, the farmers stay at work.
  const guarded = fortGame({ type: BuildingType.ArrowTower, at: [2, -12], done: false, farmers: 8, builders: 2, guards: 1 });
  assert.ok(!guarded.out.some((c) => c.c === "attack" && c.u.some((id) => guarded.farmers.includes(id))), "not against guards");
});

test("D-080: marching, an arrow tower by the way comes first; then on to the enemy base", withFortsOff(() => {
  const { g, w, ai, ids, s0, s1 } = marchOnBase();
  // A tower beside the army's way (not by the enemy's main city).
  const tower = w.addBuilding(1, BuildingType.ArrowTower, s0.cellX + 22, s0.cellY - 18, 500, 1000);
  w.tick += 10;
  g.fog.update(w);
  const hit = ai.think(buildView(g, 0)).find((c) => c.c === "attack" && c.target === tower) as { u: number[] } | undefined;
  assert.ok(hit !== undefined && hit.u.length === ids.length, "the army attacks it");
  w.buildings.col.hp[w.building(tower)] = 0;
  g.step();
  g.fog.update(w);
  w.tick += 10;
  assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.x === s1.cellX && c.y === s1.cellY), "then on");
}));

test("D-080: hard's army away at the enemy base, the soldiers waiting at home pull down a tower by the main city", () => {
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
  const ai = hardAi(g, { dodge: false, pushArmy: 24, peekFirst: 0 });
  assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.u.length === 30 && c.x === s1.cellX && c.y === s1.cellY), "off to the enemy base");
  const home = spawnCentre(w.map.frames[0], s0);
  const fresh = [0, 1, 2, 3, 4].map((k) => put(g, 0, UnitType.Spearman, home.x + 3 + k, home.y - 3));
  const tower = w.addBuilding(1, BuildingType.ArrowTower, home.x + 2, home.y - 12, 500, 1000);
  put(g, 0, UnitType.Farmer, home.x, home.y - 11);
  w.tick += 10;
  g.fog.update(w);
  const hit = ai.think(buildView(g, 0)).find((c) => c.c === "attack" && c.target === tower) as { u: number[] } | undefined;
  assert.deepEqual(hit && [...hit.u].sort(), [...fresh].sort(), "the five at home");
});

test("D-080: normal's army away at the enemy base, the soldiers trained since pull down a tower by the main city", () => {
  const { g, w, ai, ids } = marchOnBase();
  const home = spawnCentre(w.map.frames[0], w.map.spawns[0]);
  const fresh = [0, 1, 2, 3, 4].map((k) => put(g, 0, UnitType.Spearman, home.x + 3 + k, home.y - 3));
  const tower = w.addBuilding(1, BuildingType.ArrowTower, home.x + 2, home.y - 12, 500, 1000);
  put(g, 0, UnitType.Farmer, home.x, home.y - 11);
  w.tick += 10;
  g.fog.update(w);
  const out = ai.think(buildView(g, 0));
  const hit = out.find((c) => c.c === "attack" && c.target === tower) as { u: number[] } | undefined;
  assert.deepEqual(hit && [...hit.u].sort(), [...fresh].sort(), "the five at home");
  assert.ok(!out.some((c) => (c.c === "move" || c.c === "attack") && c !== hit && c.u.some((id) => fresh.includes(id))), "not sent after the army");
  assert.ok(!out.some((c) => c === hit) || !hit!.u.some((id) => ids.includes(id)), "the army marches on");
});

test("D-080: farmers go for a lone finished arrow tower, all at once; not under two towers' arrows without soldiers at home", () => {
  const one = fortGame({ type: BuildingType.ArrowTower, at: [2, -12], farmers: 14 });
  const go = one.out.find((c) => c.c === "attack" && c.target === one.fort) as { u: number[] } | undefined;
  assert.ok(go !== undefined && go.u.length === 12 && go.u.every((id) => one.farmers.includes(id)), "twelve farmers at the tower");
  // A second finished tower beside it: not without four soldiers at home.
  const two = (spears: number) => {
    const g = fortGame({ type: BuildingType.ArrowTower, at: [2, -12], farmers: 14, spears });
    const home = spawnCentre(g.w.map.frames[0], g.w.map.spawns[0]);
    g.w.addBuilding(1, BuildingType.ArrowTower, home.x + 6, home.y - 12, 600, 1000);
    put(g.g, 0, UnitType.Farmer, home.x + 5, home.y - 9);
    // Orders against a fort go again every 100 ticks.
    g.w.tick += 100;
    g.g.fog.update(g.w);
    return { ...g, next: g.ai.think(buildView(g.g, 0)) };
  };
  const alone = two(0);
  assert.ok(!alone.next.some((c) => c.c === "attack" && c.u.some((id) => alone.farmers.includes(id))), "two towers, no soldiers: not");
  const helped = two(4);
  const farmers = helped.next.find((c) => c.c === "attack" && c.u.some((id) => helped.farmers.includes(id))) as { target: number } | undefined;
  assert.ok(farmers !== undefined, "two towers, four soldiers at home: the farmers go");
  assert.ok(helped.next.some((c) => (c.c === "attack" && c.target === farmers.target && c.u.every((id) => helped.spears.includes(id))) || (c.c === "move" && c.u.every((id) => helped.spears.includes(id)))), "and the soldiers with them");
});

// --- D-081: groups of forts, what they are worth, and the way round them ---------------------------------

test("D-081: what forts and attackers are worth comes from the live rules (a spearman is 10)", () => {
  const v = fortValues(rules());
  // A finished arrow tower (600 hp, 10 every 2 s) against a spearman (100 hp, 6 every 1.5 s): about 2.7 spearmen.
  assert.equal(v.tower, 27);
  assert.ok(v.hidden > 0 && v.hidden < v.tower, `a hidden shooter ${v.hidden}`);
  assert.equal(v.vs[UnitType.Spearman], 10);
  assert.ok(v.vs[UnitType.Ranged] < 10, `ranged against forts ${v.vs[UnitType.Ranged]}: 35 hp`);
  assert.equal(v.holds, rules().buildings[BuildingType.ArrowTower].holds);
});

/** A finished enemy fort for the pure functions. */
function fort(id: number, type: BuildingType, x: number, y: number, more: Partial<Fort> = {}): Fort {
  const tower = type === BuildingType.ArrowTower;
  return { id, type, x, y, size: 2, hits: tower ? 9 : 8, reach: tower ? 9 : 15, done: true, seen: true, occupied: false, ...more };
}

test("D-081: forts that reach each other are one group; a tower seen with someone in, or only remembered, counts full", () => {
  const v = fortValues(rules());
  const near = [fort(1, BuildingType.ArrowTower, 20, 20), fort(2, BuildingType.ArrowTower, 24, 20), fort(3, BuildingType.Outpost, 22, 23)];
  const far = fort(4, BuildingType.ArrowTower, 60, 60);
  const groups = fortGroups([...near, far, fort(5, BuildingType.ArrowTower, 61, 60, { done: false })], () => 2, v);
  assert.equal(groups.length, 2, "the three together, the far one alone; a site is no group's");
  const [a, b] = groups.sort((p, q) => p.ids[0] - q.ids[0]);
  assert.deepEqual(a.ids, [1, 2, 3]);
  assert.equal(a.worth, 2 * v.tower + 2 * v.guard, "two empty towers seen, an outpost with 2 guards in sight");
  assert.equal(b.worth, v.tower);
  const full = fortGroups([fort(1, BuildingType.ArrowTower, 20, 20, { occupied: true }), fort(2, BuildingType.ArrowTower, 24, 20, { seen: false })], () => 0, v);
  assert.equal(full[0].worth, 2 * (v.tower + v.holds * v.hidden), "seen with someone in, and remembered: full");
});

test("D-081: a group on the straight way is on the way; one beside another way is not", () => {
  const v = fortValues(rules());
  const g = fortGroups([fort(1, BuildingType.ArrowTower, 47, 47), fort(2, BuildingType.ArrowTower, 51, 47)], () => 0, v);
  assert.equal(groupsOnWay(g, { x: 10, y: 48 }, { x: 90, y: 48 }).length, 1, "on the way");
  assert.equal(groupsOnWay(g, { x: 10, y: 10 }, { x: 90, y: 10 }).length, 0, "another way: clear");
});

/** D-081 / A4: a test of the rules before fortStage and fortAgain (on since ceo 2026-10-22), with both off for normal and hard. */
function withFortsOff(body: () => void): () => void {
  return () => {
    const saved = [NORMAL_FORT.stage, NORMAL_FORT.again, HARD.fortStage, HARD.fortAgain] as const;
    NORMAL_FORT.stage = NORMAL_FORT.again = HARD.fortStage = HARD.fortAgain = false;
    try {
      body();
    } finally {
      [NORMAL_FORT.stage, NORMAL_FORT.again, HARD.fortStage, HARD.fortAgain] = saved;
    }
  };
}

/** Hard with 20 spearmen at home, and enemy arrow towers (someone hiding in each) on the straight way to the enemy's main city, seen by farmers of its own. */
function fortsOnTheWay(towers: number, hidden: boolean, more: Partial<HardPlan> = {}, difficulty: AiDifficulty = "hard", at: [number, number] = [34, 56]) {
  const g = emptyGame();
  const w = g.w;
  for (const t of w.map.towns) {
    w.townState[t.id] = TownState.Ruins;
    w.townOwner[t.id] = NO_OWNER;
    w.townTimer[t.id] = 4800;
  }
  w.tick = 12 * 1200;
  const s0 = w.map.spawns[0];
  for (let k = 0; k < 20; k++) put(g, 0, UnitType.Spearman, s0.cellX + 6 + (k % 6), s0.cellY - 6 - Math.trunc(k / 6));
  // On the way from (16, 78) to (78, 16): about a third of it.
  const ids: number[] = [];
  for (let k = 0; k < towers; k++) {
    const id = w.addBuilding(1, BuildingType.ArrowTower, at[0] + 3 * k, at[1] - 3 * k, 600, 1000);
    if (hidden) w.buildings.col.soldiers[w.building(id)] = 3;
    ids.push(id);
    // A farmer of its own sees each.
    put(g, 0, UnitType.Farmer, at[0] - 1 + 3 * k, at[1] + 3 - 3 * k);
  }
  g.fog.update(w);
  const ai =
    difficulty === "hard"
      ? hardAi(g, { dodge: false, pushArmy: 18, townArmy: 99, bigArmy: 99, peekFirst: 0, ...more })
      : createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty }, 0, "balanced");
  return { g, w, ai, s1: w.map.spawns[1], ids };
}

test("D-081: hard does not march into forts too strong for it on the way; it does when stronger", () => {
  const strong = fortsOnTheWay(5, true);
  const out = strong.ai.think(buildView(strong.g, 0));
  assert.ok(!out.some((c) => c.c === "move" && c.u.length === 20 && c.x === strong.s1.cellX && c.y === strong.s1.cellY), "not to the enemy base");
  assert.ok(!out.some((c) => c.c === "attack" && strong.ids.includes(c.target)), "not at the towers");
  // Two towers without anyone hiding: 20 spearmen are stronger, straight on.
  const weak = fortsOnTheWay(2, false);
  const straight = weak.ai.think(buildView(weak.g, 0)).find((c) => c.c === "move" && c.u.length === 20) as { x: number; y: number } | undefined;
  assert.deepEqual(straight && [straight.x, straight.y], [weak.s1.cellX, weak.s1.cellY], "straight to the enemy base");
});

test("D-081 / A4: the gathering point before forts is open ground beyond their reach (2 to 6 cells), the nearest to the army", () => {
  const n = 128;
  const placement = new Uint8Array(n * n);
  const rank = (x: number, y: number) => y * n + x;
  const tower = { id: 1, type: BuildingType.ArrowTower, x: 60, y: 60, size: 2, done: true, hits: 8, reach: 8, seen: true, occupied: false } as Fort;
  const g = fortGroups([tower], () => 0, fortValues(rules()));
  const reach = (x: number, y: number) => {
    const dx = Math.max(60 - x, 0, x - 61);
    const dy = Math.max(60 - y, 0, y - 61);
    return Math.sqrt(dx * dx + dy * dy);
  };
  const p = fortStagePoint({ placement }, { size: n, mode: "fixed" }, [tower], g[0], { x: 20, y: 60 }, rank);
  assert.ok(p !== null && reach(p.x, p.y) > 10 && reach(p.x, p.y) <= 14 && p.x < 60, `beyond its reach, on the army's side (${JSON.stringify(p)})`);
  // A wall of rock round it beyond 9 cells: nothing it can get to from the tower's side.
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (reach(x, y) > 9 && reach(x, y) <= 10.5) placement[y * n + x] = 1;
  assert.equal(fortStagePoint({ placement }, { size: n, mode: "fixed" }, [tower], g[0], { x: 20, y: 60 }, rank), null);
});

test("D-081 / A4 (fortStage): forts on the way it can take, it gathers outside their reach first, then goes for them together; off, straight on (normal and hard)", () => {
  for (const difficulty of ["hard", "normal"] as const) {
    const run = (on: boolean) => {
      const was = NORMAL_FORT.stage;
      NORMAL_FORT.stage = on;
      // Normal goes for the town at (29, 29) first: the towers on that way.
      const t = fortsOnTheWay(2, false, { fortStage: on }, difficulty, difficulty === "hard" ? [34, 56] : [25, 44]);
      NORMAL_FORT.stage = was;
      const first = t.ai.think(buildView(t.g, 0));
      t.w.tick += 10;
      t.g.fog.update(t.w);
      return { ...t, first, out: t.ai.think(buildView(t.g, 0)) };
    };
    const off = run(false);
    assert.ok(off.first.some((c) => c.c === "move" && c.u.length === 20 && (difficulty === "hard" ? c.x === off.s1.cellX && c.y === off.s1.cellY : c.x === 29 && c.y === 29)), `${difficulty}: sets out`);
    assert.ok(!off.out.some((c) => c.c === "move" && c.u.length === 20), `${difficulty} off: straight on`);
    const on = run(true);
    const to = on.out.find((c) => c.c === "move" && c.u.length === 20) as { x: number; y: number; u: number[] } | undefined;
    assert.ok(to !== undefined, `${difficulty} on: to a gathering point`);
    const forts = enemyForts(buildView(on.g, 0), 0, rules());
    const d2 = (f: Fort) => {
      const dx = Math.max(f.x - to.x, 0, to.x - (f.x + f.size - 1));
      const dy = Math.max(f.y - to.y, 0, to.y - (f.y + f.size - 1));
      return dx * dx + dy * dy;
    };
    assert.ok(forts.every((f) => d2(f) > (f.hits + 2) * (f.hits + 2)) && forts.some((f) => d2(f) <= (f.hits + 6) * (f.hits + 6)), `${difficulty}: beyond their reach, by them`);
    // All there: on for the towers together.
    for (const id of to.u) {
      const s = slotOf(on.g, id);
      on.w.units.col.x[s] = to.x * CELL + (CELL >> 1);
      on.w.units.col.y[s] = to.y * CELL + (CELL >> 1);
    }
    on.w.tick += 10;
    on.g.fog.update(on.w);
    const go = on.ai.think(buildView(on.g, 0));
    assert.ok(go.some((c) => (c.c === "attack" && on.ids.includes(c.target) && c.u.length === 20) || (c.c === "move" && c.u.length === 20 && forts.some((f) => Math.abs(c.x - f.x) <= 2 && Math.abs(c.y - f.y) <= 2))), `${difficulty}: then for the towers`);
  }
});

test("D-081: with townRest (off by default), hard leaves a town it fell back from alone for a while", () => {
  const g = emptyGame();
  const w = g.w;
  const ids: number[] = [];
  for (let k = 0; k < 14; k++) ids.push(put(g, 0, UnitType.Spearman, 40 + (k % 7), 60 + Math.trunc(k / 7)));
  g.fog.update(w);
  const ai = hardAi(g, { dodge: false, townRest: 2 });
  const toTown = (out: CommandBody[], x: number, y: number) => out.some((c) => c.c === "move" && c.u.length >= 10 && c.x === x && c.y === y);
  const go = ai.think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length === 14) as { x: number; y: number } | undefined;
  assert.ok(go !== undefined && w.map.towns.some((t) => t.cellX === go.x && t.cellY === go.y), "off to a town");
  // Twenty enemy spearmen by the army: it falls back.
  const foes = Array.from({ length: 20 }, (_, k) => put(g, 1, UnitType.Spearman, 38 + (k % 10), 56 + Math.trunc(k / 10)));
  w.tick += 10;
  g.fog.update(w);
  assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "retreat" && c.u.length === 14), "falls back");
  kill(g, foes);
  w.tick += 10;
  g.fog.update(w);
  assert.ok(!toTown(ai.think(buildView(g, 0)), go.x, go.y), "not straight back to that town");
  // With the rest off (the default, as before D-081), straight back.
  const g2 = emptyGame();
  for (let k = 0; k < 14; k++) put(g2, 0, UnitType.Spearman, 40 + (k % 7), 60 + Math.trunc(k / 7));
  g2.fog.update(g2.w);
  const ai2 = hardAi(g2, { dodge: false });
  ai2.think(buildView(g2, 0));
  const foes2 = Array.from({ length: 20 }, (_, k) => put(g2, 1, UnitType.Spearman, 38 + (k % 10), 56 + Math.trunc(k / 10)));
  g2.w.tick += 10;
  g2.fog.update(g2.w);
  ai2.think(buildView(g2, 0));
  kill(g2, foes2);
  g2.w.tick += 10;
  g2.fog.update(g2.w);
  assert.ok(toTown(ai2.think(buildView(g2, 0)), go.x, go.y), "off: straight back");
});

test("D-081: after breaking off from a fort on its ground, it goes again within 5 minutes only with 1.5 x the army (ceo 2026-10-10)", withFortsOff(() => {
  for (const difficulty of ["normal", "hard"] as const) {
    /** Eight spearmen go for a tower by the main city, six fall and it breaks off; `more` than eight again, `later` ticks on. */
    const again = (more: number, later: number) => {
      const { g, w, ai, fort, spears, centre, out } = fortGame({ type: BuildingType.ArrowTower, at: [2, -14], spears: 8, difficulty });
      assert.ok(out.some((c) => c.c === "attack" && c.target === fort), `${difficulty}: the army goes for it`);
      // Its farmer too: with two soldiers left farmers would join them to the end (D-080), not this path.
      const farmers: number[] = [];
      for (let s = 0; s < w.units.count; s++) if (w.units.col.owner[s] === 0 && w.units.col.type[s] === UnitType.Farmer) farmers.push(w.units.col.id[s]);
      kill(g, [...spears.slice(2), ...farmers]);
      w.tick += 10;
      g.fog.update(w);
      assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "retreat"), `${difficulty}: ground down, it breaks off`);
      const home = spawnCentre(w.map.frames[0], w.map.spawns[0]);
      for (let k = 0; k < 6 + more; k++) put(g, 0, UnitType.Spearman, home.x - 4 - (k % 6), home.y - 4 - Math.trunc(k / 6));
      w.tick += later;
      g.fog.update(w);
      return ai.think(buildView(g, 0)).some((c) => (c.c === "attack" && c.target === fort) || (c.c === "move" && c.x === centre.x && c.y === centre.y));
    };
    // Before D-081's memory here it went again 30 s on with as many (FORT_AGAIN): every 0.6–3 minutes in the fortress-hold runs.
    assert.ok(!again(0, 700), `${difficulty}: not with as many as set out, 35 s on`);
    assert.ok(again(4, 700), `${difficulty}: with 1.5 x (12 spearmen)`);
    assert.ok(again(0, 5 * 1200 + 10), `${difficulty}: with as many once 5 minutes are past`);
  }
}));

test("D-081 / A4 (fortAgain): after breaking off from a fort, the next go takes 2 x the army and it remembers for 10 minutes (normal and hard)", () => {
  for (const difficulty of ["normal", "hard"] as const) {
    const again = (more: number, later: number) => {
      const saved = [NORMAL_FORT.again, HARD.fortAgain];
      NORMAL_FORT.again = true;
      HARD.fortAgain = true;
      const { g, w, ai, fort, spears, centre } = fortGame({ type: BuildingType.ArrowTower, at: [2, -14], spears: 8, difficulty });
      [NORMAL_FORT.again, HARD.fortAgain] = saved;
      const farmers: number[] = [];
      for (let s = 0; s < w.units.count; s++) if (w.units.col.owner[s] === 0 && w.units.col.type[s] === UnitType.Farmer) farmers.push(w.units.col.id[s]);
      kill(g, [...spears.slice(2), ...farmers]);
      w.tick += 10;
      g.fog.update(w);
      assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "retreat"), `${difficulty}: ground down, it breaks off`);
      const home = spawnCentre(w.map.frames[0], w.map.spawns[0]);
      for (let k = 0; k < 6 + more; k++) put(g, 0, UnitType.Spearman, home.x - 4 - (k % 6), home.y - 4 - Math.trunc(k / 6));
      w.tick += later;
      g.fog.update(w);
      return ai.think(buildView(g, 0)).some((c) => (c.c === "attack" && c.target === fort) || (c.c === "move" && c.x === centre.x && c.y === centre.y));
    };
    assert.ok(!again(4, 700), `${difficulty}: not with 1.5 x (12 spearmen)`);
    assert.ok(again(8, 700), `${difficulty}: with 2 x (16)`);
    assert.ok(!again(0, 5 * 1200 + 10), `${difficulty}: not with as many 5 minutes on`);
    assert.ok(again(0, 10 * 1200 + 10), `${difficulty}: with as many once 10 minutes are past`);
  }
});

test("D-081: hard does not go back to a town it fell back from because of forts while it remembers them, though the straight way from home misses them", () => {
  const g = emptyGame();
  const w = g.w;
  for (let k = 0; k < 14; k++) put(g, 0, UnitType.Spearman, 40 + (k % 7), 60 + Math.trunc(k / 7));
  g.fog.update(w);
  // Small towns take more soldiers than it has: the big one is the only one to go for.
  const ai = hardAi(g, { dodge: false, townArmy: 99 });
  const go = ai.think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length === 14) as { x: number; y: number } | undefined;
  assert.ok(go !== undefined && w.map.towns.some((t) => t.cellX === go.x && t.cellY === go.y), "off to a town");
  // Four towers with three hiding in each, by the army but beside the straight way from home to the town.
  const towers: number[] = [];
  for (const [dx, dy] of [[0, 0], [3, 0], [0, 3], [3, 3]]) {
    const id = w.addBuilding(1, BuildingType.ArrowTower, 50 + dx, 66 + dy, 600, 1000);
    w.buildings.col.soldiers[w.building(id)] = 3;
    towers.push(id);
    put(g, 0, UnitType.Farmer, 49 + dx, 65 + dy);
  }
  w.tick += 10;
  g.fog.update(w);
  const groups = fortGroups(enemyForts(buildView(g, 0), 0, rules()), () => 0, fortValues(rules()));
  const s0 = w.map.spawns[0];
  assert.equal(groupsOnWay(groups, { x: s0.cellX, y: s0.cellY }, go).length, 0, "not on the straight way from home");
  assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "retreat" && c.u.length === 14), "too strong for it: back");
  const toTown = () => ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.u.length === 14 && c.x === go.x && c.y === go.y);
  w.tick += 10;
  g.fog.update(w);
  assert.ok(!toTown(), "not straight back to that town (it went to and fro for 12 minutes in 931495929)");
  w.tick += 10 * 1200;
  g.fog.update(w);
  assert.ok(!toTown(), "nor 10 minutes on");
  // Those hiding in the towers gone: the towers alone are weaker than the army.
  for (const id of towers) w.buildings.col.soldiers[w.building(id)] = 0;
  w.tick += 10;
  g.fog.update(w);
  assert.ok(toTown(), "once the forts are weaker, again");
});

test("D-081: farmers do not lead the soldiers at home back to a fort the army broke off from, within 5 minutes (ceo 2026-10-10)", withFortsOff(() => {
  for (const difficulty of ["normal", "hard"] as const) {
    const { g, w, ai, fort, spears } = fortGame({ type: BuildingType.ArrowTower, at: [2, -14], spears: 8, difficulty });
    w.buildings.col.soldiers[w.building(fort)] = 3;
    w.tick += 10;
    g.fog.update(w);
    ai.think(buildView(g, 0));
    const sight: number[] = [];
    for (let s = 0; s < w.units.count; s++) if (w.units.col.owner[s] === 0 && w.units.col.type[s] === UnitType.Farmer) sight.push(w.units.col.id[s]);
    kill(g, [...spears.slice(2), ...sight]);
    w.tick += 10;
    g.fog.update(w);
    assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "retreat"), `${difficulty}: ground down, it breaks off`);
    // As many soldiers again, and farmers at work: farmers would go for a lone tower with two soldiers at home (D-080),
    // and the soldiers at home with them, to the end.
    const home = spawnCentre(w.map.frames[0], w.map.spawns[0]);
    for (let k = 0; k < 6; k++) put(g, 0, UnitType.Spearman, home.x - 4 - k, home.y - 4);
    for (let k = 0; k < 8; k++) {
      const id = put(g, 0, UnitType.Farmer, home.x - 3 + (k % 4), home.y + 3 + Math.trunc(k / 4));
      w.units.col.order[slotOf(g, id)] = Order.Gather;
    }
    w.tick += 700;
    g.fog.update(w);
    assert.ok(!ai.think(buildView(g, 0)).some((c) => c.c === "attack" && c.target === fort), `${difficulty}: neither farmers nor soldiers, 35 s on`);
    w.tick += 5 * 1200;
    g.fog.update(w);
    assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "attack" && c.target === fort), `${difficulty}: once 5 minutes are past, again`);
  }
}));

test("D-081: falling back past forts, the way round them: a point beside the first group on the way, on the army's side and out of its reach", () => {
  const v = fortValues(rules());
  const [g] = fortGroups([fort(1, BuildingType.ArrowTower, 49, 49), fort(2, BuildingType.ArrowTower, 53, 49)], () => 0, v);
  const from = { x: 30, y: 46 };
  const to = { x: 90, y: 48 };
  const p = aroundForts([g], from, to, 96);
  assert.ok(p !== undefined, "the straight way passes them");
  const reach2 = (g.radius + 2) * (g.radius + 2);
  assert.ok((p.x - g.x) * (p.x - g.x) + (p.y - g.y) * (p.y - g.y) > reach2, `out of their reach: ${p.x},${p.y}`);
  assert.ok(p.y < g.y, "on the army's side (it is north of the way through them)");
  assert.equal(aroundForts([g], from, { x: 10, y: 46 }, 96), undefined, "a way home leading away from them: straight on");
  assert.equal(aroundForts([g], { x: 30, y: 10 }, { x: 90, y: 10 }, 96), undefined, "a way clear of them: straight on");
});

test("D-081: hard falling back from forts too strong for it goes round them, then home", () => {
  const g = emptyGame();
  const w = g.w;
  const s0 = w.map.spawns[0];
  // The army out at (60, 40); four towers with three hiding in each between it and home (16, 78).
  const army: number[] = [];
  for (let k = 0; k < 14; k++) army.push(put(g, 0, UnitType.Spearman, 58 + (k % 7), 40 + Math.trunc(k / 7)));
  g.fog.update(w);
  const ai = hardAi(g, { dodge: false, townArmy: 99 });
  ai.think(buildView(g, 0));
  for (const [dx, dy] of [[0, 0], [3, 0], [0, 3], [3, 3]]) {
    const id = w.addBuilding(1, BuildingType.ArrowTower, 44 + dx, 52 + dy, 600, 1000);
    w.buildings.col.soldiers[w.building(id)] = 3;
    put(g, 0, UnitType.Farmer, 43 + dx, 51 + dy);
  }
  w.tick += 10;
  g.fog.update(w);
  const back = ai.think(buildView(g, 0)).find((c) => c.c === "retreat" && c.u.length === 14) as { x: number; y: number } | undefined;
  const home = spawnCentre(w.map.frames[0], s0);
  assert.ok(back !== undefined, "too strong for it: back");
  const groups = fortGroups(enemyForts(buildView(g, 0), 0, rules()), () => 0, fortValues(rules()));
  assert.ok(groupsOnWay(groups, { x: 61, y: 40 }, home).length > 0, "the straight way home passes them");
  // Straight home it would walk through their reach (D-081: half of those lost fell so).
  assert.equal(groupsOnWay(groups, { x: 61, y: 40 }, back).length, 0, `round them first, to ${back.x},${back.y}: the way there keeps out of their reach`);
  // There: on home.
  for (const id of army) {
    const s = slotOf(g, id);
    w.units.col.x[s] = back.x * CELL + CELL / 2;
    w.units.col.y[s] = back.y * CELL + CELL / 2;
  }
  w.tick += 10;
  g.fog.update(w);
  const on = ai.think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length === 14) as { x: number; y: number } | undefined;
  assert.ok(on !== undefined && (on.x !== back.x || on.y !== back.y), "on from there");
});

test("D-081: no garrison in a town under the arrows of an enemy fort (normal and hard)", () => {
  for (const difficulty of ["normal", "hard"] as const) {
    /** It holds the small town, with ten spearmen at home; an enemy tower by the town, or not. */
    const garrisoned = (tower: boolean) => {
      const g = emptyGame();
      const w = g.w;
      const [small] = w.map.towns;
      w.townState[small.id] = TownState.Governed;
      w.townOwner[small.id] = 0;
      w.tick = 12 * 1200;
      const s0 = w.map.spawns[0];
      for (let k = 0; k < 10; k++) put(g, 0, UnitType.Spearman, s0.cellX + 6 + (k % 5), s0.cellY - 6 - Math.trunc(k / 5));
      put(g, 0, UnitType.Farmer, small.cellX + 1, small.cellY + 1);
      if (tower) {
        w.addBuilding(1, BuildingType.ArrowTower, small.cellX + 5, small.cellY + 5, 600, 1000);
        put(g, 0, UnitType.Farmer, small.cellX + 4, small.cellY + 7);
      }
      g.fog.update(w);
      const ai = difficulty === "hard" ? hardAi(g, { dodge: false }) : createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty }, 0, "balanced");
      return ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.x === small.cellX && c.y === small.cellY && c.u.length <= 3);
    };
    assert.ok(garrisoned(false), `${difficulty}: a garrison goes to the town`);
    assert.ok(!garrisoned(true), `${difficulty}: none under the tower's arrows (seed 9 of the fortress-hold runs: 21 shot one by one)`);
  }
});

// --- D-083: the population rules (base 200, more for governed towns, houses +8), and D-081's leftovers ------

/** Runs `f` with the population rules on or off, then puts them back (AIs made inside read them from rules()). */
function withPopulation<T>(on: boolean, f: () => T): T {
  const was = POPULATION_200.on;
  POPULATION_200.on = on;
  try {
    return f();
  } finally {
    POPULATION_200.on = was;
  }
}

test("D-083: with the population rules on, normal and hard build houses up to the ceiling (200), past the old 120", () => {
  for (const difficulty of ["normal", "hard"] as const) {
    /** Its cap at 122 (main city 10 and 14 houses of 8), 116 farmers at work: a house next? */
    const house = (on: boolean) =>
      withPopulation(on, () => {
        const g = emptyGame();
        const w = g.w;
        const s0 = w.map.spawns[0];
        const per = rules().buildings[BuildingType.House].populationCap;
        const houses = Math.ceil((122 - 10) / per);
        for (let k = 0; k < houses; k++) w.addBuilding(0, BuildingType.House, s0.cellX - 12 + 3 * (k % 8), s0.cellY + 6 + 3 * Math.trunc(k / 8), 200, 1000);
        const cap = w.populationCap(0);
        for (let k = 0; w.population(0) < cap - 6; k++) {
          const id = put(g, 0, UnitType.Farmer, s0.cellX - 10 + (k % 20), s0.cellY - 10 - Math.trunc(k / 20));
          w.units.col.order[slotOf(g, id)] = Order.Gather;
        }
        w.res.set([500, 500, 500, 0], 0);
        g.fog.update(w);
        const ai = difficulty === "hard" ? hardAi(g, { dodge: false }) : createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty }, 0, "balanced");
        return { cap, ceiling: w.populationCeiling(0), out: ai.think(buildView(g, 0)).some((c) => c.c === "build" && c.type === BuildingType.House) };
      });
    const on = house(true);
    assert.deepEqual([on.cap >= 120, on.ceiling], [true, 200], `${difficulty}: on, the cap past 120 and the ceiling 200`);
    assert.ok(on.out, `${difficulty}: on, another house (cap ${on.cap})`);
    const off = house(false);
    assert.ok(off.cap >= 120 && !off.out, `${difficulty}: off, none past 120 (cap ${off.cap}), as before`);
  }
});

test("D-083 (D-081's leftover (a)): with the population rules on, a town whose plunder it holds gets no soldiers one by one against an enemy army there", () => {
  for (const difficulty of ["normal", "hard"] as const) {
    /** It holds the small town in a plunder; 12 enemy spearmen in it, seen by a farmer of its own; `spears` of its own at home. */
    const sent = (on: boolean, spears: number) =>
      withPopulation(on, () => {
        const g = emptyGame();
        const w = g.w;
        const [small] = w.map.towns;
        w.townState[small.id] = TownState.Plundering;
        w.townOwner[small.id] = 0;
        w.townTimer[small.id] = 200;
        w.tick = 12 * 1200;
        const s0 = w.map.spawns[0];
        for (let k = 0; k < spears; k++) put(g, 0, UnitType.Spearman, s0.cellX + 6 + (k % 6), s0.cellY - 6 - Math.trunc(k / 6));
        for (let k = 0; k < 12; k++) put(g, 1, UnitType.Spearman, small.cellX - 1 + (k % 4), small.cellY - 1 + Math.trunc(k / 4));
        put(g, 0, UnitType.Farmer, small.cellX + 3, small.cellY + 3);
        g.fog.update(w);
        const ai = difficulty === "hard" ? hardAi(g, { dodge: false }) : createAi(0, 1, { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty }, 0, "balanced");
        return ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.x === small.cellX && c.y === small.cellY && c.u.length === spears);
      });
    assert.ok(sent(false, 2), `${difficulty}: off, the two at home go back to it, as before`);
    assert.ok(!sent(true, 2), `${difficulty}: on, not two against twelve`);
    assert.ok(sent(true, 20), `${difficulty}: on, twenty go`);
  }
});

test("D-083 (c): with the population rules on and food and gold piling up, hard builds a barracks or range before a farm", () => {
  /** Hard with a barracks, a range, a granary, a lumber camp and a mine, 16 farmers at work and food and gold to spare: what does it build? */
  const built = (on: boolean) =>
    withPopulation(on, () => {
      const g = emptyGame();
      const w = g.w;
      const s0 = w.map.spawns[0];
      w.tick = 8 * 1200;
      w.addBuilding(0, BuildingType.Barracks, s0.cellX + 4, s0.cellY - 8, 500, 1000);
      w.addBuilding(0, BuildingType.Range, s0.cellX + 8, s0.cellY - 8, 500, 1000);
      w.addBuilding(0, BuildingType.Granary, s0.cellX - 6, s0.cellY - 6, 400, 1000);
      w.addBuilding(0, BuildingType.LumberCamp, s0.cellX - 10, s0.cellY + 2, 400, 1000);
      w.addBuilding(0, BuildingType.Mine, s0.cellX + 12, s0.cellY + 2, 400, 1000);
      for (let k = 0; k < 4; k++) w.addBuilding(0, BuildingType.House, s0.cellX - 8 + 3 * k, s0.cellY + 6, 200, 1000);
      for (let k = 0; k < 16; k++) {
        const id = put(g, 0, UnitType.Farmer, s0.cellX - 4 + (k % 8), s0.cellY - 2 - Math.trunc(k / 8));
        w.units.col.order[slotOf(g, id)] = Order.Gather;
      }
      w.res.set([700, 300, 400, 0], 0);
      g.fog.update(w);
      // D-086 A6's stable for piled gold aside (goldCavalry): this is about barracks and ranges.
      const b = hardAi(g, { dodge: false, goldCavalry: 0 }).think(buildView(g, 0)).find((c) => c.c === "build") as { type: BuildingType } | undefined;
      return b?.type;
    });
  const on = built(true);
  assert.ok(on === BuildingType.Barracks || on === BuildingType.Range, `on: a barracks or range first (built ${on})`);
  assert.equal(built(false), BuildingType.Farm, "off: a farm first, as before");
});

// --- D-086 B: the network (net.ts), off unless HardPlan.net holds weights --------------------------------------

/** Weights from a fixed integer sequence (the shapes training uses). */
function testNet(): NetWeights {
  let r = 12345;
  const next = () => {
    r = (Math.imul(r, 1103515245) + 12345) >>> 0;
    return r >>> 16;
  };
  const layers = [];
  for (let l = 0; l + 1 < NET_SHAPE.length; l++) {
    const inputs = NET_SHAPE[l];
    const outputs = NET_SHAPE[l + 1];
    const w: number[] = [];
    const b: number[] = [];
    for (let k = 0; k < inputs * outputs; k++) w.push((next() % 255) - 127);
    for (let k = 0; k < outputs; k++) b.push((next() % 2001) - 1000);
    layers.push({ inputs, outputs, w, b, shift: 8 });
  }
  return { layers };
}

/** A network that always makes these choices (one per head): every weight 0, the chosen outputs' biases 1. */
function forcedNet(picks: number[]): NetWeights {
  const layers = [];
  for (let l = 0; l + 1 < NET_SHAPE.length; l++) {
    const inputs = NET_SHAPE[l];
    const outputs = NET_SHAPE[l + 1];
    const b = new Array(outputs).fill(0);
    if (l + 2 === NET_SHAPE.length) {
      let at = 0;
      NET_HEADS.forEach((k, h) => {
        b[at + picks[h]] = 1;
        at += k;
      });
    }
    layers.push({ inputs, outputs, w: new Array(inputs * outputs).fill(0), b, shift: 8 });
  }
  return { layers };
}

test("D-086 B: the network's sums are integers: these weights and inputs give exactly these scores and choices", () => {
  const x = Array.from({ length: NET_INPUTS }, (_, i) => (i * 37 + 11) % 256);
  assert.deepEqual(forward(testNet(), x), [8716, 18894, 22123, -5343, -24979, -12751, -52341, -56921, -40853, -17770, 61455, 69509]);
  assert.deepEqual(choose(testNet(), x), [2, 0, 2, 2]);
  assert.deepEqual(choose(forcedNet([0, 0, 0, 0]), x), [0, 0, 0, 0], "a tie: the lowest index");
});

test("D-086 B: net.ts uses no floating point and no Math functions", () => {
  const code = readFileSync(new URL("../src/ai/net.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.ok(!/Math\./.test(code), "no Math.*");
  assert.ok(!/\d\.\d/.test(code), "no decimal literals");
  assert.ok(!/Float(32|64)Array/.test(code), "no float arrays");
});

test("D-086 B: the network's inputs, 0..255 each, come from the AI's own view: enemy soldiers in the fog change nothing", () => {
  /** Hard (network on) at minute 12 with 12 spearmen at home; `hidden`: 30 enemy spearmen far off in the fog; `near`: 6 in sight. */
  const think = (hidden: boolean, near = false) => {
    const g = emptyGame();
    const w = g.w;
    w.tick = 12 * 1200;
    const s0 = w.map.spawns[0];
    const s1 = w.map.spawns[1];
    for (let k = 0; k < 12; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + (k % 6), s0.cellY - 4 - Math.trunc(k / 6));
    if (hidden) for (let k = 0; k < 30; k++) put(g, 1, UnitType.Spearman, s1.cellX - 6 + (k % 6), s1.cellY + 6 + Math.trunc(k / 6));
    if (near) for (let k = 0; k < 6; k++) put(g, 1, UnitType.Spearman, s0.cellX + 8 + k, s0.cellY - 10);
    g.fog.update(w);
    const xs: number[][] = [];
    const out = hardAi(g, { dodge: false, net: testNet(), netLog: (x) => xs.push(x) }).think(buildView(g, 0));
    return { out, x: xs[0] };
  };
  const a = think(false);
  const b = think(true);
  assert.equal(a.x.length, NET_INPUTS);
  assert.ok(a.x.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
  assert.deepEqual(b.x, a.x, "the same inputs");
  assert.deepEqual(b.out, a.out, "the same commands");
  assert.notDeepEqual(think(false, true).x, a.x, "enemy soldiers in sight do count");
});

test("D-086 B: the simulation worker never imports the training code (sim/src/ai/learn/)", () => {
  const seen = new Set<string>();
  const walk = (url: URL) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const code = readFileSync(url, "utf8");
    for (const m of code.matchAll(/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g)) walk(new URL(m[1], url));
  };
  walk(new URL("../src/worker.ts", import.meta.url));
  assert.ok(seen.size > 10, `walked ${seen.size} files`);
  assert.ok([...seen].some((f) => f.endsWith("/ai/net.ts")), "net.ts is in the worker");
  assert.deepEqual([...seen].filter((f) => f.includes("/ai/learn/")), []);
});

test("D-086 B: with the network on, its choice at home wins: it marches with 16, or waits with 60; never with fewer than netMarch (14)", () => {
  /** Hard at minute 12 on the fixed map (it knows where the enemy is) with `n` spearmen at home, no towns open. */
  const marches = (n: number, net: NetWeights | null) => {
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
    for (let k = 0; k < n; k++) put(g, 0, UnitType.Spearman, s0.cellX + 8 + (k % 8), s0.cellY - 8 - Math.trunc(k / 8));
    g.fog.update(w);
    // Looking first (D-086 A3) off: this is about the march itself.
    return hardAi(g, { dodge: false, net, peekFirst: 0 }).think(buildView(g, 0)).some((c) => c.c === "move" && c.u.length === n && c.x === s1.cellX && c.y === s1.cellY);
  };
  const march = forcedNet([ARMY_BASE, AS_HARD, AS_HARD, AS_HARD]);
  assert.equal(marches(16, null), false, "off: not with 16");
  assert.equal(marches(16, march), true, "on, march: with 16");
  assert.equal(marches(12, march), false, "on, march, but 12 is under netMarch: not allowed");
  assert.equal(marches(60, null), true, "off: with 60");
  assert.equal(marches(60, forcedNet([ARMY_HOME, AS_HARD, AS_HARD, AS_HARD])), false, "on, wait: not even with 60");
  assert.equal(marches(60, forcedNet([AS_HARD, AS_HARD, AS_HARD, AS_HARD])), true, "on, as hard: with 60, as hard does");
  assert.equal(marches(16, forcedNet([AS_HARD, AS_HARD, AS_HARD, AS_HARD])), false, "on, as hard: not with 16, as hard does not");
});

test("D-086 B: with the network on, a first capture is governed when it chooses so and can pay", () => {
  const chosen = (net: NetWeights | null) => {
    const g = emptyGame();
    const w = g.w;
    w.townState[0] = TownState.AwaitingChoice;
    w.townOwner[0] = 0;
    w.res.set([1000, 1000, 1000, 0], 0);
    for (let k = 0; k < 10; k++) put(g, 0, UnitType.Spearman, w.townX[0] + (k % 3), w.townY[0] + 1 + Math.trunc(k / 3));
    g.fog.update(w);
    return (hardAi(g, { dodge: false, net }).think(buildView(g, 0)).find((c) => c.c === "town_choice") as { choice: number } | undefined)?.choice;
  };
  assert.equal(chosen(null), TownChoice.Plunder, "off: plundered, as before");
  assert.equal(chosen(forcedNet([AS_HARD, AS_HARD, AS_HARD, AS_HARD])), TownChoice.Plunder, "as hard: plundered, as hard does");
  assert.equal(chosen(forcedNet([AS_HARD, AS_HARD, AS_HARD, TOWN_GOVERN])), TownChoice.Govern);
  assert.equal(chosen(forcedNet([AS_HARD, AS_HARD, AS_HARD, TOWN_PLUNDER])), TownChoice.Plunder);
});

test("D-086 B: the network's inputs follow the AI's state (features)", () => {
  const x = features({
    tick: 12 * 1200,
    food: 400,
    wood: 160,
    gold: 80,
    crystal: 20,
    pop: 40,
    cap: 60,
    ceiling: 200,
    farmers: 30,
    spear: 6,
    ranged: 4,
    mages: 1,
    cavalry: 0,
    buildings: [1, 1, 0, 0, 3, 4, 1, 1, 0],
    worth: 125,
    home: 10,
    away: 1,
    cityHp: 1200,
    enemy: [5, 3, 0, 0],
    enemyWorth: 80,
    enemyNear: 0,
    enemyCityKnown: 1,
    enemyCityHp: 1200,
    enemyForts: 0,
    towns: [0, 0, 1, 5, 1],
    townDist: 30,
    mode: 0,
    lost: 2,
    killed: 3,
  });
  assert.equal(x.length, NET_INPUTS);
  assert.deepEqual(x.slice(0, 5), [12, 25, 10, 5, 5]);
  assert.deepEqual(x.slice(-7), [255, 0, 0, 0, 0, 2, 3], "mode home, then the losses and the falls");
});

test("D-086 B: with the network on, hard plays 12 minutes of a game against hard without an error, both maps", () => {
  // Choices that take it to towns and govern them (its march to a town once read the cost before it could).
  const runs: [("fixed" | "random"), NetWeights][] = [
    ["fixed", forcedNet([AS_HARD, AS_HARD, AS_HARD, TOWN_GOVERN])],
    ["random", forcedNet([AS_HARD, MIX_SPEAR, BUILD_FARMERS, TOWN_GOVERN])],
    ["fixed", testNet()],
  ];
  for (const [map, net] of runs) {
    {
      const g = new Game({ seed: 3, scenario: "standard", map });
      const ais = [0, 1].map((p) => createAi(p, 3, { ...aiKnowledge(g.w.map, p, MAX_TICKS, "hard"), hard: p === 0 ? { net } : {} }, p));
      let seq = 0;
      for (let t = 0; t < 12 * 1200 && !g.w.over; t++) {
        if (g.tick % 10 === 0) for (let p = 0; p < 2; p++) for (const body of ais[p].think(buildView(g, p))) g.push({ ...body, t: g.tick, p, seq: seq++ } as never);
        g.step();
      }
      assert.ok(g.tick > 0);
    }
  }
});

test("D-086 B: the network that always chooses AS_HARD (every weight 0) plays exactly as hard: the same game, both maps, one side or both", () => {
  /** The final hash of 12 minutes of hard against hard, each side with `nets[p]` (null: off). */
  const play = (map: "fixed" | "random", nets: (NetWeights | null)[]) => {
    const g = new Game({ seed: 5, scenario: "standard", map });
    const ais = [0, 1].map((p) => createAi(p, 5, { ...aiKnowledge(g.w.map, p, MAX_TICKS, "hard"), hard: { net: nets[p] } }, p));
    let seq = 0;
    for (let t = 0; t < 12 * 1200 && !g.w.over; t++) {
      if (g.tick % 10 === 0) for (let p = 0; p < 2; p++) for (const body of ais[p].think(buildView(g, p))) g.push({ ...body, t: g.tick, p, seq: seq++ } as never);
      g.step();
    }
    return g.hash();
  };
  for (const map of ["fixed", "random"] as const) {
    const off = play(map, [null, null]);
    assert.equal(play(map, [asHardNet(), null]), off, `${map}: one side`);
    assert.equal(play(map, [asHardNet(), asHardNet()]), off, `${map}: both sides`);
  }
  assert.notEqual(play("fixed", [forcedNet([ARMY_HOME, AS_HARD, AS_HARD, AS_HARD]), null]), play("fixed", [null, null]), "a network that waits plays another game");
});

test("D-086 B: choices can be ruled out (masking): the best allowed one is made", () => {
  const x = Array.from({ length: NET_INPUTS }, (_, i) => (i * 37 + 11) % 256);
  const all = new Array(NET_HEADS.reduce((s, k) => s + k, 0)).fill(true);
  assert.deepEqual(choose(testNet(), x, all), choose(testNet(), x));
  const noBase = [...all];
  noBase[2] = false;
  assert.notEqual(choose(testNet(), x, noBase)[0], 2, "army: not the ruled-out march");
  const farmersOnly = [...all];
  farmersOnly[7] = false;
  farmersOnly[8] = false;
  assert.equal(choose(testNet(), x, farmersOnly)[2], AS_HARD, "build: as hard, the only one allowed");
});

// --- D-086 A: food and gold piling up while wood is short; governing earlier ----------------------------------

/**
 * Hard at minute 13 with 2 barracks, 2 ranges, a mage hall, granary, lumber camp, mine, 9 farms and 12
 * houses (room to spare), `farmers` farmers at work and 10 spearmen at home, `res` in stock, a finished
 * stable when `stable`; what it sends with `plan`.
 */
function richHard(res: number[], plan: Partial<HardPlan>, opt: { stable?: boolean; farmers?: number } = {}): CommandBody[] {
  const g = emptyGame();
  const w = g.w;
  const s0 = w.map.spawns[0];
  w.tick = 13 * 1200;
  const at = (type: BuildingType, x: number, y: number) => w.addBuilding(0, type, s0.cellX + x, s0.cellY + y, rules().buildings[type].hp, 1000);
  at(BuildingType.Barracks, 4, -8);
  at(BuildingType.Barracks, 8, -8);
  at(BuildingType.Range, 12, -8);
  at(BuildingType.Range, 16, -8);
  at(BuildingType.MageHall, 4, -13);
  at(BuildingType.Granary, -6, -6);
  at(BuildingType.LumberCamp, -10, 2);
  at(BuildingType.Mine, 12, 2);
  for (let k = 0; k < 9; k++) at(BuildingType.Farm, -14 + 3 * (k % 3), -14 + 3 * Math.trunc(k / 3));
  for (let k = 0; k < 12; k++) at(BuildingType.House, -8 + 3 * (k % 6), 6 + 3 * Math.trunc(k / 6));
  if (opt.stable === true) at(BuildingType.Stable, 8, -13);
  for (let k = 0; k < (opt.farmers ?? 30); k++) {
    const id = put(g, 0, UnitType.Farmer, s0.cellX - 4 + (k % 10), s0.cellY - 2 - Math.trunc(k / 10));
    w.units.col.order[slotOf(g, id)] = Order.Gather;
  }
  for (let k = 0; k < 10; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + (k % 5), s0.cellY + 2 + Math.trunc(k / 5));
  w.res.set(res, 0);
  g.fog.update(w);
  return hardAi(g, { dodge: false, ...plan }).think(buildView(g, 0));
}
const trains = (out: CommandBody[], type: UnitType) => out.some((c) => c.c === "train" && c.type === type);

test("D-086 A (plan.cavalry): with wood short and food and gold piling up, hard puts up a stable and trains cavalry; 0, as before", () => {
  // D-086 A6's cavalry for piled gold aside (goldCavalry).
  const built = (cavalry: number) => (richHard([500, 200, 300, 0], { cavalry, goldCavalry: 0 }).find((c) => c.c === "build") as { type: BuildingType } | undefined)?.type;
  assert.equal(built(25), BuildingType.Stable, "rich: a stable");
  assert.notEqual(built(0), BuildingType.Stable, "off: no stable");
  assert.ok(trains(richHard([700, 20, 300, 0], { cavalry: 25 }, { stable: true }), UnitType.Cavalry), "wood short: cavalry");
  assert.ok(!trains(richHard([700, 20, 300, 0], { cavalry: 0, goldCavalry: 0 }, { stable: true }), UnitType.Cavalry), "off: no cavalry");
  assert.ok(!trains(richHard([700, 300, 300, 0], { cavalry: 25 }, { stable: true }), UnitType.Cavalry), "wood enough: spearmen and ranged as before");
});

test("D-086 A (plan.woodShift, plan.woodFarmers): with wood short and food and gold piling up, more farmers go to wood, and more are trained", () => {
  const ratio = (woodShift: boolean) => richHard([700, 20, 300, 0], { woodShift }).find((c) => c.c === "eco_ratio") as { food: number; wood: number; gold: number } | undefined;
  assert.deepEqual(ratio(true) && [ratio(true)!.food, ratio(true)!.wood, ratio(true)!.gold], [15, 75, 10]);
  assert.notDeepEqual(ratio(false) && [ratio(false)!.food, ratio(false)!.wood, ratio(false)!.gold], [15, 75, 10], "off: the ratio as before");
  // 36 farmers: past the target (32 +-2) already.
  assert.ok(trains(richHard([700, 20, 300, 0], { woodFarmers: 8 }, { farmers: 36 }), UnitType.Farmer), "wood short: one more farmer");
  assert.ok(!trains(richHard([700, 20, 300, 0], { woodFarmers: 0 }, { farmers: 36 }), UnitType.Farmer), "off: none");
  assert.ok(!trains(richHard([700, 300, 300, 0], { woodFarmers: 8 }, { farmers: 36 }), UnitType.Farmer), "wood enough: none");
  // What hard plays (HARD_POP, D-086 A): with the population rules on, 8 more; off, as before.
  assert.ok(trains(richHard([700, 20, 300, 0], {}, { farmers: 36 }), UnitType.Farmer), "hard as it plays: one more farmer");
  assert.ok(!withPopulation(false, () => trains(richHard([700, 20, 300, 0], {}, { farmers: 36 }), UnitType.Farmer)), "population rules off: as before");
});

test("D-086 A (plan.governFrom, governSpare, governNearest): from that minute a first capture is governed when hard can pay; else plundered, as before", () => {
  /** Hard at minute 13 has just taken small town `which` (first capture), 10 spearmen in it, `res` in stock. */
  const chosen = (which: "nearest" | "other", res: number[], plan: Partial<HardPlan>) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    const small = w.map.towns
      .filter((t) => t.size === 0)
      .sort((a, b) => (a.cellX - s0.cellX) ** 2 + (a.cellY - s0.cellY) ** 2 - ((b.cellX - s0.cellX) ** 2 + (b.cellY - s0.cellY) ** 2) || a.id - b.id);
    const t = which === "nearest" ? small[0] : small[1];
    w.tick = 13 * 1200;
    w.townState[t.id] = TownState.AwaitingChoice;
    w.townOwner[t.id] = 0;
    w.res.set(res, 0);
    for (let k = 0; k < 10; k++) put(g, 0, UnitType.Spearman, t.cellX + (k % 3), t.cellY + 1 + Math.trunc(k / 3));
    g.fog.update(w);
    const c = hardAi(g, { dodge: false, ...plan }).think(buildView(g, 0)).find((x) => x.c === "town_choice") as { choice: number } | undefined;
    return c?.choice;
  };
  const rich = [1000, 1000, 1000, 0];
  assert.equal(chosen("nearest", rich, { governFrom: 12 }), TownChoice.Govern, "from minute 12, rich: governed");
  assert.equal(chosen("nearest", rich, { governFrom: 0 }), TownChoice.Plunder, "off: plundered, as before");
  assert.equal(chosen("nearest", rich, { governFrom: 14 }), TownChoice.Plunder, "before its minute: plundered");
  assert.equal(chosen("other", rich, { governFrom: 12 }), TownChoice.Plunder, "not the nearest small town: plundered");
  assert.equal(chosen("other", rich, { governFrom: 12, governNearest: false }), TownChoice.Govern, "any town: governed");
  // A small town costs wood 80 and gold 80 to govern.
  assert.equal(chosen("nearest", [100, 80, 80, 0], { governFrom: 12 }), TownChoice.Govern, "just enough: governed");
  assert.equal(chosen("nearest", [100, 80, 80, 0], { governFrom: 12, governSpare: 100 }), TownChoice.Plunder, "nothing to spare: plundered");
  // What hard plays (HARD_POP, D-086 A): with the population rules on, governed from minute 12; off, plundered as before.
  assert.equal(chosen("nearest", rich, {}), TownChoice.Govern, "hard as it plays: governed");
  assert.equal(withPopulation(false, () => chosen("nearest", rich, {})), TownChoice.Plunder, "population rules off: plundered");
});

// --- D-086 A3: looking before a march -----------------------------------------------------------------------

test("D-086 A3 (plan.peekFirst): no enemy soldier seen for a minute, one goes to look and the march waits; seen, it marches", () => {
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
  const march = (out: CommandBody[]) => out.some((c) => c.c === "move" && c.u.length >= 29 && c.x === s1.cellX && c.y === s1.cellY);
  assert.ok(march(hardAi(g, { dodge: false, pushArmy: 24, peekFirst: 0 }).think(buildView(g, 0))), "off: marches at once, as before");
  const ai = hardAi(g, { dodge: false, pushArmy: 24, peekFirst: 1 });
  const first = ai.think(buildView(g, 0));
  const look = first.find((c) => c.c === "retreat" && c.u.length === 1 && c.x === s1.cellX && c.y === s1.cellY) as { u: number[] } | undefined;
  assert.ok(look !== undefined, "one goes to look");
  assert.ok(!march(first), "the march waits");
  assert.equal(ai.stats?.().peekSent, 1);
  // Halfway there it sees enemy soldiers: the one comes home, and the army marches.
  const scout = slotOf(g, look!.u[0]);
  const mx = (s0.cellX + s1.cellX) >> 1;
  const my = (s0.cellY + s1.cellY) >> 1;
  w.units.col.x[scout] = (mx << 10) + 512;
  w.units.col.y[scout] = (my << 10) + 512;
  for (let k = 0; k < 3; k++) put(g, 1, UnitType.Spearman, mx + 2 + k, my);
  w.tick += 10;
  g.fog.update(w);
  const second = ai.think(buildView(g, 0));
  assert.equal(ai.stats?.().peekSaw, 1, "it saw them");
  w.tick += 10;
  assert.ok(march(second) || march(ai.think(buildView(g, 0))), "then it marches");
});

/** D-096 (core 2026-10-22): gates, when the rules have them (GATE). */
const GATES = (RULES as unknown as { GATE?: { on: boolean } }).GATE;

test(
  "D-086 A3: hard never changes an order after sending it (the log must replay), with its farmers hunted far from home",
  // The bug was the AI's, not the map's: with gates hard plays seed 7 otherwise and never sends its farmers home
  // (war-game-core 2026-10-22), so they are off here.
  switchedOff(GATES === undefined ? [] : [GATES], () => {
    // The late group with its farmer hunters (scripted-games --late --harass 10) against hard, 20 minutes.

    // Seed 7 (D-089's map): farmers sent home from one spot twice from minute 11 (an order shared with its list was changed then).
    // That game is hard's without D-086 A6 (with it, its farmers are not hunted far from home there); with it on, the orders
    // are checked too.
    const play = (a6: boolean) => {
      const was = { holdTowns: HARD.holdTowns, econBehind: HARD.econBehind, goldCavalry: HARD.goldCavalry, crystalStop: HARD.crystalStop, woodShift: HARD.woodShift };
      if (!a6) Object.assign(HARD, { holdTowns: false, econBehind: false, goldCavalry: 0, crystalStop: false, woodShift: false });
      try {
        const r = new Runner({ seed: 7, scenario: "standard", ai: [false, true], maxTicks: 0, difficulty: ["normal", "hard"] });
        const g = r.game;
        const m = g.w.map;
        const plan = planFor("push", "h1", "close");
        Object.assign(plan, { farmers: 24, production: 4, spearShare: 35, choice: "govern", corners: true, townAt: 10, homeTowers: 2, cavalryShare: 15, pushAt: 50, counterAt: 50, pushAhead: true, harass: 10 });
        const player = createScriptedPlayer(0, { map: mapInfo(m, 0), rules: rules(m), frame: m.frames[0] }, plan);
        const sent: { at: number; json: string }[] = [];
        let seen = 0;
        let seq = 0;
        while (!r.over && g.tick < 20 * 1200) {
          if (g.tick % SCRIPTED_THINK_EVERY === 0) for (const body of player.think(buildView(g, 0))) r.command(0, { ...body, seq: seq++ } as never);
          r.tick();
          for (; seen < g.log.length; seen++) if (g.log[seen].p === 1) sent.push({ at: seen, json: JSON.stringify(g.log[seen]) });
        }
        const stats = (r as unknown as { ais: ({ stats?: () => Record<string, number> } | null)[] }).ais[1]!.stats!();
        const changed = sent.filter((x) => JSON.stringify(g.log[x.at]) !== x.json);
        return { hid: stats.farmersHid, changed: changed.map((x) => x.json).slice(0, 2) };
      } finally {
        Object.assign(HARD, was);
      }
    };
    const before = play(false);
    assert.ok(before.hid > 0, "its farmers were sent home");
    assert.deepEqual(before.changed, [], "orders as sent");
    assert.deepEqual(play(true).changed, [], "orders as sent, with D-086 A6");
  }),
);


// --- D-089: gathering outside the enemy main city before the attack ----------------------------------

/** Runs `f` with the gathering point on (the game always has it; the tests above turn it off). */
function staging<T>(f: () => T): T {
  STAGING.on = true;
  try {
    return f();
  } finally {
    STAGING.on = false;
  }
}

/** The 30 spearmen of marchOnBase (a normal AI, or hard), towns in ruins, set out; what it sends first, and its gathering point. */
function stagedMarch(difficulty: AiDifficulty) {
  const g = emptyGame();
  const w = g.w;
  for (const t of w.map.towns) {
    w.townState[t.id] = TownState.Ruins;
    w.townOwner[t.id] = NO_OWNER;
    w.townTimer[t.id] = 4800;
    put(g, 0, UnitType.Farmer, t.cellX + 2, t.cellY + 2);
  }
  w.tick = 12 * 1200;
  const s0 = w.map.spawns[0];
  const s1 = w.map.spawns[1];
  const ids: number[] = [];
  for (let k = 0; k < 30; k++) ids.push(put(g, 0, UnitType.Spearman, s0.cellX + 14 + (k % 6), s0.cellY - 14 - Math.trunc(k / 6)));
  g.fog.update(w);
  const know = { map: w.map, rules: rules(), frame: w.map.frames[0], maxTicks: 0, difficulty, ...(difficulty === "hard" ? { hard: { dodge: false, pushArmy: 24, peekFirst: 0 } } : {}) };
  const ai = createAi(0, 1, know, 0, "balanced");
  const first = ai.think(buildView(g, 0)).find((c) => c.c === "move" && c.u.length === 30) as { x: number; y: number } | undefined;
  return { g, w, ai, ids, s0, s1, first };
}

for (const difficulty of ["normal", "hard"] as AiDifficulty[]) {
  test(`D-089 (${difficulty}): marching on the enemy base, those that set out gather some 16 cells out first, then go on together`, () =>
    staging(() => {
      const { g, w, ai, ids, s1, first } = stagedMarch(difficulty);
      assert.ok(first !== undefined, "it sets out");
      const d2 = (first!.x - s1.cellX) ** 2 + (first!.y - s1.cellY) ** 2;
      assert.ok(d2 >= 12 * 12 && d2 <= 20 * 20, `to the gathering point, not the city (${first!.x},${first!.y})`);
      const think = (ticks: number) => {
        w.tick += ticks;
        g.fog.update(w);
        return ai.think(buildView(g, 0));
      };
      // On the way: still to the gathering point.
      assert.ok(!think(400).some((c) => c.c === "move" && c.x === s1.cellX && c.y === s1.cellY), "not on to the city yet");
      // 25 of the 30 by it: gathered, on to the city.
      ids.forEach((id, k) => {
        const s = slotOf(g, id);
        const at = k < 25 ? { x: first!.x + (k % 5) - 2, y: first!.y + Math.trunc(k / 5) - 2 } : { x: first!.x - 20, y: first!.y + 20 };
        w.units.col.x[s] = (at.x << 10) + 512;
        w.units.col.y[s] = (at.y << 10) + 512;
      });
      const on = think(20);
      assert.ok(on.some((c) => c.c === "move" && c.u.length >= 25 && c.x === s1.cellX && c.y === s1.cellY), "gathered: on to the city");
    }));
}

test("D-089 (normal): soldiers trained after it set out wait at the gathering point and go on six or more together", () =>
  staging(() => {
    const { g, w, ai, ids, s0, s1, first } = stagedMarch("normal");
    // Gathered and on to the city.
    ids.forEach((id, k) => {
      const s = slotOf(g, id);
      w.units.col.x[s] = ((first!.x + (k % 6) - 3) << 10) + 512;
      w.units.col.y[s] = ((first!.y + Math.trunc(k / 6) - 2) << 10) + 512;
    });
    w.tick += 20;
    g.fog.update(w);
    ai.think(buildView(g, 0));
    // Four newcomers at home: told to the gathering point, not the city.
    const fresh: number[] = [];
    for (let k = 0; k < 4; k++) fresh.push(put(g, 0, UnitType.Spearman, s0.cellX + 4 + k, s0.cellY - 4));
    w.tick = Math.ceil((w.tick + 1) / 100) * 100;
    g.fog.update(w);
    const out = ai.think(buildView(g, 0));
    assert.ok(out.some((c) => c.c === "move" && fresh.every((id) => c.u.includes(id)) && c.x === first!.x && c.y === first!.y), "newcomers to the gathering point");
    assert.ok(!out.some((c) => c.c === "move" && fresh.some((id) => c.u.includes(id)) && c.x === s1.cellX && c.y === s1.cellY), "not on their own to the city");
  }));

test("D-089: the gathering point is open ground it knows, out of enemy forts' reach; none when already that near", () => {
  const n = 128;
  const placement = new Uint8Array(n * n);
  const enemy = { cellX: 100, cellY: 20 };
  const rank = (x: number, y: number) => y * n + x;
  const from = { x: 20, y: 100 };
  const p = staging(() => stagePoint({ placement }, { size: n, mode: "fixed" }, [], from, enemy, rank));
  assert.ok(p !== null);
  const d = Math.sqrt((p!.x - enemy.cellX) ** 2 + (p!.y - enemy.cellY) ** 2);
  assert.ok(d >= 12 && d <= 20, `some 16 cells out (${d})`);
  // Blocked there (a river, say): the nearest open cell instead; all blocked round both nearer and further: none at all.
  placement[p!.y * n + p!.x] = 1;
  const q = staging(() => stagePoint({ placement }, { size: n, mode: "fixed" }, [], from, enemy, rank));
  assert.ok(q !== null && (q.x !== p!.x || q.y !== p!.y));
  placement.fill(1);
  assert.equal(staging(() => stagePoint({ placement }, { size: n, mode: "fixed" }, [], from, enemy, rank)), null);
  // A random map: only explored ground.
  placement.fill(2);
  assert.equal(staging(() => stagePoint({ placement }, { size: n, mode: "random" }, [], from, enemy, rank)), null, "nothing explored there: none");
  placement.fill(0);
  // An enemy tower reaching it: further out or nearer, not under its arrows.
  const tower = { id: 1, type: BuildingType.ArrowTower, x: p!.x, y: p!.y, size: 2, done: true, hits: 8, seen: true, occupied: false } as unknown as Fort;
  const r = staging(() => stagePoint({ placement }, { size: n, mode: "fixed" }, [tower], from, enemy, rank));
  assert.ok(r === null || (r.x - p!.x) ** 2 + (r.y - p!.y) ** 2 > 10 * 10, "out of the tower's reach");
  assert.equal(staging(() => stagePoint({ placement }, { size: n, mode: "fixed" }, [], { x: 95, y: 25 }, enemy, rank)), null, "already that near: none");
});

test("D-089 (SIEGE.failed): after an attack on the enemy main city is ground down, normal goes again only with 120% of those that set out", () => {
  const again = (failed: number) => {
    const was = SIEGE.failed;
    SIEGE.failed = failed;
    try {
      const { g, ai, ids, s0, s1 } = marchOnBase();
      kill(g, ids.slice(0, 20)); // 10 of the 30 left: breaks off
      assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "retreat"), "breaks off");
      // 40 at home now: the full army for the base (at most 37), and 40 is 133% of the 30 that set out.
      for (let k = 0; k < 30; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + (k % 6), s0.cellY - 4 - Math.trunc(k / 6));
      g.w.tick += 10;
      g.fog.update(g.w);
      return ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.u.length >= 30 && c.x === s1.cellX && c.y === s1.cellY);
    } finally {
      SIEGE.failed = was;
    }
  };
  assert.equal(again(120), true, "120%: 40 of 30 is enough, it goes");
  assert.equal(again(200), false, "200%: 40 of 30 is not");
  assert.equal(again(0), true, "off: it goes, as before");
});


// --- D-086 A4: cavalry against ranged units and mages; arrow towers ------------------------------------------

test("D-086 A4 (plan.cavalryCounter): cavalry once the enemy it knows of is mostly ranged and mages; not against spearmen; 0, as before", () => {
  const withFoes = (type: UnitType, cavalryCounter: number) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.tick = 13 * 1200;
    const at = (t: BuildingType, x: number, y: number) => w.addBuilding(0, t, s0.cellX + x, s0.cellY + y, rules().buildings[t].hp, 1000);
    at(BuildingType.Barracks, 4, -8);
    at(BuildingType.Range, 12, -8);
    at(BuildingType.Stable, 8, -13);
    for (let k = 0; k < 6; k++) at(BuildingType.House, -8 + 3 * k, 6);
    for (let k = 0; k < 10; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + (k % 5), s0.cellY + 2 + Math.trunc(k / 5));
    for (let k = 0; k < 8; k++) put(g, 1, type, s0.cellX + 6 + (k % 4), s0.cellY - 15 - Math.trunc(k / 4));
    w.res.set([700, 300, 300, 0], 0);
    g.fog.update(w);
    // The rule by counters (cavalryWhen 50) on this fixed map (the defaults since D-097: 20% on random maps only).
    return trains(hardAi(g, { dodge: false, cavalryCounter, cavalryWhen: 50, cavalryRandomOnly: false }).think(buildView(g, 0)), UnitType.Cavalry);
  };
  assert.ok(withFoes(UnitType.Ranged, 25), "ranged in sight: cavalry");
  assert.ok(withFoes(UnitType.Mage, 25), "mages in sight: cavalry");
  assert.ok(!withFoes(UnitType.Spearman, 25), "spearmen: no cavalry");
  assert.ok(!withFoes(UnitType.Ranged, 0), "off: no cavalry, as before");
});

/** Player 0's `cav` cavalry with an enemy ranged unit 6 cells off, and `spears` enemy spearmen by it: what hard (plan) sends them. */
function chargeAt(cav: number, spears: number, plan: Partial<HardPlan>): { ids: number[]; target: number; out: CommandBody[] } {
  const g = emptyGame();
  const w = g.w;
  const s0 = w.map.spawns[0];
  // By the main city: in sight of what it has there.
  const x = s0.cellX + 8;
  const y = s0.cellY - 12;
  const ids: number[] = [];
  for (let k = 0; k < cav; k++) ids.push(put(g, 0, UnitType.Cavalry, x + k, y));
  const target = put(g, 1, UnitType.Ranged, x + 1, y - 6);
  // In front of it, in sight of the cavalry.
  for (let k = 0; k < spears; k++) put(g, 1, UnitType.Spearman, x - 2 + k, y - 5);
  g.fog.update(w);
  return { ids, target, out: hardAi(g, { dodge: false, ...plan }).think(buildView(g, 0)) };
}
const charged = (r: { ids: number[]; target: number; out: CommandBody[] }) =>
  r.out.some((c) => c.c === "attack" && c.target === r.target && r.ids.every((id) => c.u.includes(id)));

test("D-086 A4 (plan.charge): cavalry charge an enemy ranged unit in sight; not with more spearmen than they are by it; off, as before", () => {
  assert.ok(charged(chargeAt(4, 0, { charge: true })), "4 cavalry, no spearmen: they charge it");
  assert.ok(charged(chargeAt(4, 3, { charge: true })), "3 spearmen by it: still");
  assert.ok(!charged(chargeAt(4, 6, { charge: true })), "6 spearmen by it: no charge");
  assert.ok(!charged(chargeAt(2, 0, { charge: true })), "fewer than CHARGE_MIN: no charge");
  assert.ok(!charged(chargeAt(4, 0, { charge: false })), "off: no charge, as before");
});

test("D-086 A4 (plan.towers): hard's arrow towers in a 15-minute game leave 2 cells open round its main city and production buildings, and none is refused for its place (gates' lanes, crossings)", () => {
  const g = new Game({ seed: 3, scenario: "standard" });
  const w = g.w;
  const ais = [0, 1].map((p) => createAi(p, 3, { map: w.map, rules: rules(), frame: w.map.frames[p], maxTicks: 0, difficulty: "hard", hard: { towers: 2, towerSpare: 0 } }, p));
  let seq = 0;
  let placed = 0;
  let badPlace = 0;
  const size = (t: number) => rules().buildings[t].size;
  for (let t = 0; t < 15 * 1200; t++) {
    // Towers go up only with wood and gold to spare, and whether there is any is the game's turn (D-096 changed it):
    // some each minute, so they do; this is about where they go.
    if (g.tick % 1200 === 0) for (let p = 0; p < 2; p++) {
      w.res[p * 4 + 1] += 150;
      w.res[p * 4 + 2] += 60;
    }
    if (g.tick % 10 === 0) {
      for (let p = 0; p < 2; p++) {
        for (const body of ais[p].think(buildView(g, p))) {
          if (body.c === "build" && body.type === BuildingType.ArrowTower) {
            placed++;
            const b = w.buildings.col;
            for (let s = 0; s < w.buildings.count; s++) {
              const bt = b.type[s];
              const doors: number[] = [BuildingType.MainCity, BuildingType.Barracks, BuildingType.Range, BuildingType.Stable, BuildingType.MageHall];
              if (b.owner[s] !== p || !doors.includes(bt)) continue;
              const apart: boolean =
                body.x + size(BuildingType.ArrowTower) + 2 <= b.cellX[s] || b.cellX[s] + size(bt) + 2 <= body.x || body.y + size(BuildingType.ArrowTower) + 2 <= b.cellY[s] || b.cellY[s] + size(bt) + 2 <= body.y;
              assert.ok(apart, `player ${p}'s tower at (${body.x},${body.y}) by its building type ${bt} at (${b.cellX[s]},${b.cellY[s]})`);
            }
          }
          g.push({ ...body, t: g.tick, p, seq: seq++ } as never);
        }
      }
    }
    g.step();
    // D-089: a gate's lane or a crossing is refused by the simulation (Reject.GateLane, Reject.Crossing); none of its builds may be.
    for (const e of g.events) if (e.ev.k === "rejected" && [Reject.BadPlacement, Reject.GateLane, Reject.Crossing].includes(e.ev.reason as never)) badPlace++;
  }
  assert.ok(placed > 0, "it put up towers");
  assert.equal(badPlace, 0, "no build refused for its place");
});

test("D-086 A4 (plan.counterCavalry): against an enemy with many cavalry hard leans to spearmen; off, cavalry is not counted", () => {
  // 12 spearmen and 8 ranged at home (60% spearmen, over its 45-55% share): which it trains first.
  const first = (counterCavalry: boolean) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.tick = 13 * 1200;
    w.addBuilding(0, BuildingType.Barracks, s0.cellX + 4, s0.cellY - 9, 500, 1000);
    w.addBuilding(0, BuildingType.Range, s0.cellX + 8, s0.cellY - 9, 500, 1000);
    for (let k = 0; k < 6; k++) w.addBuilding(0, BuildingType.House, s0.cellX - 8 + 3 * k, s0.cellY + 6, 200, 1000);
    for (let k = 0; k < 12; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + (k % 6), s0.cellY + 2 + Math.trunc(k / 6));
    for (let k = 0; k < 8; k++) put(g, 0, UnitType.Ranged, s0.cellX + 4 + (k % 4), s0.cellY + 4 + Math.trunc(k / 4));
    for (let k = 0; k < 8; k++) put(g, 1, UnitType.Cavalry, s0.cellX + 6 + (k % 4), s0.cellY - 12 - Math.trunc(k / 4));
    w.res.set([1000, 1000, 1000, 0], 0);
    g.fog.update(w);
    const out = hardAi(g, { dodge: false, counterCavalry }).think(buildView(g, 0));
    return (out.find((c) => c.c === "train" && c.type !== UnitType.Farmer) as { type: number } | undefined)?.type;
  };
  assert.equal(first(true), UnitType.Spearman, "8 cavalry in sight: spearmen first");
  assert.equal(first(false), UnitType.Ranged, "off: cavalry not counted, ranged first as before");
});

test("D-086 A4 (plan.mineMove): the gold by its mine gone, hard puts up another mine by the nearest gold left; off, as before", () => {
  const built = (mineMove: boolean) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.tick = 13 * 1200;
    const at = (type: BuildingType, x: number, y: number) => w.addBuilding(0, type, s0.cellX + x, s0.cellY + y, rules().buildings[type].hp, 1000);
    for (const [t, x, y] of [[BuildingType.Barracks, 4, -8], [BuildingType.Barracks, 8, -8], [BuildingType.Range, 12, -8], [BuildingType.Range, 16, -8], [BuildingType.MageHall, 4, -13], [BuildingType.Granary, -6, -6], [BuildingType.LumberCamp, -10, 2]] as [BuildingType, number, number][]) at(t, x, y);
    for (let k = 0; k < 10; k++) at(BuildingType.Farm, -14 + 3 * (k % 3), -14 + 3 * Math.trunc(k / 3));
    for (let k = 0; k < 12; k++) at(BuildingType.House, -8 + 3 * (k % 6), 6 + 3 * Math.trunc(k / 6));
    // Its mine by the nearest gold, all of that gold gone; more gold further out.
    let first = -1;
    let bestD = 0;
    for (let i = 0; i < w.nodeKind.length; i++) {
      if (w.nodeKind[i] !== NodeKind.GoldMine) continue;
      const d = (w.nodeX[i] - s0.cellX) ** 2 + (w.nodeY[i] - s0.cellY) ** 2;
      if (first < 0 || d < bestD) {
        first = i;
        bestD = d;
      }
    }
    w.addBuilding(0, BuildingType.Mine, w.nodeX[first] + 1, w.nodeY[first] + 1, rules().buildings[BuildingType.Mine].hp, 1000);
    for (let i = 0; i < w.nodeKind.length; i++) if (w.nodeKind[i] === NodeKind.GoldMine && (w.nodeX[i] - w.nodeX[first]) ** 2 + (w.nodeY[i] - w.nodeY[first]) ** 2 <= 49) w.nodeAmount[i] = 0;
    for (let k = 0; k < 30; k++) {
      const id = put(g, 0, UnitType.Farmer, s0.cellX - 4 + (k % 10), s0.cellY - 2 - Math.trunc(k / 10));
      w.units.col.order[slotOf(g, id)] = Order.Gather;
    }
    w.res.set([700, 600, 300, 0], 0);
    // A soldier of its own by the next gold (some 25 cells off): it has seen it and the ground there.
    let next = -1;
    let nextD = 0;
    for (let i = 0; i < w.nodeKind.length; i++) {
      if (w.nodeKind[i] !== NodeKind.GoldMine || w.nodeAmount[i] <= 0) continue;
      const d = (w.nodeX[i] - s0.cellX) ** 2 + (w.nodeY[i] - s0.cellY) ** 2;
      if (next < 0 || d < nextD) {
        next = i;
        nextD = d;
      }
    }
    put(g, 0, UnitType.Spearman, w.nodeX[next] + 2, w.nodeY[next] + 2);
    g.fog.update(w);
    const out = hardAi(g, { dodge: false, mineMove, goldCavalry: 0 }).think(buildView(g, 0));
    return out.some((c) => c.c === "build" && c.type === BuildingType.Mine);
  };
  assert.equal(built(true), true, "on: a new mine");
  assert.equal(built(false), false, "off: none, as before");
});

test("D-086 A4 (plan.mineMove): the only gold left nearer the enemy's main city, hard puts no mine there", () => {
  const g = emptyGame();
  const w = g.w;
  const s0 = w.map.spawns[0];
  const s1 = w.map.spawns[1];
  w.tick = 13 * 1200;
  const at = (type: BuildingType, x: number, y: number) => w.addBuilding(0, type, s0.cellX + x, s0.cellY + y, rules().buildings[type].hp, 1000);
  for (const [t, x, y] of [[BuildingType.Barracks, 4, -8], [BuildingType.Barracks, 8, -8], [BuildingType.Range, 12, -8], [BuildingType.Range, 16, -8], [BuildingType.MageHall, 4, -13], [BuildingType.Granary, -6, -6], [BuildingType.LumberCamp, -10, 2]] as [BuildingType, number, number][]) at(t, x, y);
  for (let k = 0; k < 10; k++) at(BuildingType.Farm, -14 + 3 * (k % 3), -14 + 3 * Math.trunc(k / 3));
  for (let k = 0; k < 12; k++) at(BuildingType.House, -8 + 3 * (k % 6), 6 + 3 * Math.trunc(k / 6));
  // A mine of its own, and all the gold on its side of the map gone (a09c2367 at minute 30).
  const d2 = (i: number, s: { cellX: number; cellY: number }) => (w.nodeX[i] - s.cellX) ** 2 + (w.nodeY[i] - s.cellY) ** 2;
  let first = -1;
  for (let i = 0; i < w.nodeKind.length; i++) if (w.nodeKind[i] === NodeKind.GoldMine && (first < 0 || d2(i, s0) < d2(first, s0))) first = i;
  w.addBuilding(0, BuildingType.Mine, w.nodeX[first] + 1, w.nodeY[first] + 1, rules().buildings[BuildingType.Mine].hp, 1000);
  for (let i = 0; i < w.nodeKind.length; i++) if (w.nodeKind[i] === NodeKind.GoldMine && d2(i, s0) < d2(i, s1)) w.nodeAmount[i] = 0;
  for (let k = 0; k < 30; k++) {
    const id = put(g, 0, UnitType.Farmer, s0.cellX - 4 + (k % 10), s0.cellY - 2 - Math.trunc(k / 10));
    w.units.col.order[slotOf(g, id)] = Order.Gather;
  }
  w.res.set([700, 600, 300, 0], 0);
  // It sees the nearest gold left (on the enemy's side) and the ground there.
  let next = -1;
  for (let i = 0; i < w.nodeKind.length; i++) if (w.nodeKind[i] === NodeKind.GoldMine && w.nodeAmount[i] > 0 && (next < 0 || d2(i, s0) < d2(next, s0))) next = i;
  put(g, 0, UnitType.Spearman, w.nodeX[next] + 2, w.nodeY[next] + 2);
  g.fog.update(w);
  const out = hardAi(g, { dodge: false, mineMove: true }).think(buildView(g, 0));
  assert.equal(out.some((c) => c.c === "build" && c.type === BuildingType.Mine), false);
});

test("D-086 A4 (plan.buildSafe): a site razed before it was done, hard puts nothing there again for a while; off, as before", () => {
  const again = (buildSafe: boolean) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.tick = 4 * 1200;
    for (let k = 0; k < 12; k++) {
      const id = put(g, 0, UnitType.Farmer, s0.cellX - 4 + k, s0.cellY + 4);
      w.units.col.order[slotOf(g, id)] = Order.Gather;
    }
    w.res.set([1000, 1000, 1000, 0], 0);
    g.fog.update(w);
    const ai = hardAi(g, { dodge: false, buildSafe });
    let seq = 0;
    const first = ai.think(buildView(g, 0)).find((c) => c.c === "build");
    assert.ok(first !== undefined && first.c === "build", "it builds something");
    g.push({ ...first, t: g.tick, p: 0, seq: seq++ } as never);
    g.step();
    const site = w.building(w.buildings.col.id[w.buildings.count - 1]);
    assert.equal(w.buildings.col.type[site], first.type);
    assert.ok(w.buildings.col.progress[site] < 1000);
    g.fog.update(w);
    ai.think(buildView(g, 0));
    // Razed before it was done.
    w.buildings.col.hp[site] = 0;
    for (let k = 0; k < 100; k++) g.step();
    w.res.set([1000, 1000, 1000, 0], 0);
    g.fog.update(w);
    return ai.think(buildView(g, 0)).some((c) => c.c === "build" && (c.x - first.x) ** 2 + (c.y - first.y) ** 2 <= 64);
  };
  assert.equal(again(false), true, "off: put down there again, as before");
  assert.equal(again(true), false, "on: not there again yet");
});

test("D-086 A4 (plan.buildSafe): with enemy soldiers in sight by the spot, hard puts nothing down there; off, as before", () => {
  const builds = (buildSafe: boolean) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.tick = 4 * 1200;
    for (let k = 0; k < 8; k++) {
      const id = put(g, 0, UnitType.Farmer, s0.cellX - 4 + k, s0.cellY + 4);
      w.units.col.order[slotOf(g, id)] = Order.Gather;
    }
    // Enemy spearmen all round its main city, in sight.
    for (let k = 0; k < 12; k++) put(g, 1, UnitType.Spearman, s0.cellX - 6 + k, s0.cellY - 3);
    w.res.set([1000, 1000, 1000, 0], 0);
    g.fog.update(w);
    return hardAi(g, { dodge: false, buildSafe }).think(buildView(g, 0)).some((c) => c.c === "build");
  };
  assert.equal(builds(false), true, "off: it builds, as before");
  assert.equal(builds(true), false, "on: nothing put down by the enemy");
});


// --- D-096: castle gates ------------------------------------------------------------------------------------------

/** A new game (the militia on the walls, the gates closed) and player 0's soldiers 9 cells west of the small town: `spears` and `ranged`. */
function atGate(spears: number, ranged: number) {
  const g = new Game({ seed: 1, scenario: "standard" });
  const w = g.w;
  const t = w.map.towns.find((x) => x.size === TownSize.Small)!;
  const ids = [
    ...Array.from({ length: spears }, (_, k) => put(g, 0, UnitType.Spearman, t.cellX - 9 - (k % 2), t.cellY - 2 + Math.trunc(k / 2))),
    ...Array.from({ length: ranged }, (_, k) => put(g, 0, UnitType.Ranged, t.cellX - 11 - (k % 2), t.cellY - 2 + Math.trunc(k / 2))),
  ];
  g.fog.update(w);
  const town = { x: t.cellX, y: t.cellY, size: t.size, state: w.townState[t.id], owner: w.townOwner[t.id] };
  const army = ids.map((id) => ({ id, type: w.units.col.type[slotOf(g, id)] }));
  return { g, w, t, town, army, view: buildView(g, 0), r: rules(w.map) };
}

test("D-096: an AI reads a town's gates from the view by their openings, and those on its walls", () => {
  if (!rules().features?.gates) return;
  const { g, t, town, r } = atGate(0, 0);
  const all = townGates(buildView(g, null), r, town);
  assert.equal(all.length, 4, "four gates");
  assert.ok(all.every((x) => x.owner === NO_OWNER || x.owner === 255 || x.owner < 0 || x.owner > 1), "none of the players'");
  assert.ok(all.every((x) => x.hp === r.towns[t.size].gateHp), "full");
  assert.equal(onWalls(buildView(g, null), 0, r, town).length, r.towns[t.size].militia >> 1, "half the militia on the walls");
});

test("D-096 (GATE_AI.focus, off by default): by a town with its gates closed, the melee go for the gate nearest the army, ranged units for those on the walls", () => {
  if (!rules().features?.gates) return;
  const { town, army, view, r } = atGate(6, 6);
  const rank = (x: number, y: number) => y * 1000 + x;
  // Off by default (scratch run 39696604780); on here.
  const was = GATE_AI.focus;
  GATE_AI.focus = true;
  const go = gateOrders(view, r, 0, town, army, { x: town.x - 10, y: town.y }, rank);
  assert.ok(go !== null);
  assert.ok(go.gate.x < town.x, "the west gate");
  const melee = go.orders.find((c) => c.c === "attack" && c.target === go.gate.id) as { u: number[] } | undefined;
  assert.deepEqual(melee?.u, army.slice(0, 6).map((u) => u.id), "the spearmen on it");
  const walls = new Set(onWalls(view, 0, r, town).map((u) => u.id));
  const shots = go.orders.filter((c) => c.c === "attack" && c.target !== go.gate.id) as { u: number[]; target: number }[];
  if (walls.size > 0) {
    assert.ok(shots.length > 0 && shots.every((c) => walls.has(c.target)), "the archers on those on the walls");
    assert.deepEqual(shots.flatMap((c) => c.u).sort((a, b) => a - b), army.slice(6).map((u) => u.id).sort((a, b) => a - b), "every archer");
  }
  assert.equal(gateOrders(view, r, 0, town, army, { x: town.x - 40, y: town.y }, rank), null, "not by the town: none");
  GATE_AI.focus = false;
  assert.equal(gateOrders(view, r, 0, town, army, { x: town.x - 10, y: town.y }, rank), null, "off: none");
  GATE_AI.focus = was;
});

test("D-096 (GATE_AI.retreat b): what breaking in would cost falls with a bigger army and with archers for the slingers", () => {
  if (!rules().features?.gates) return;
  const few = atGate(4, 0);
  const many = atGate(24, 0);
  const mixed = atGate(18, 6);
  const loss = (x: ReturnType<typeof atGate>) => gateLoss(x.view, x.r, 0, x.town, x.army);
  assert.ok(loss(few) > loss(many), `${loss(few)} > ${loss(many)}`);
  assert.ok(loss(mixed) < loss(many), `${loss(mixed)} < ${loss(many)}`);
  assert.equal(gateLoss(few.view, few.r, 0, { ...few.town, state: TownState.Ruins }, few.army), 0, "ruins: open");
});

test("D-096 (GATE_AI.walls): plundering a town with enemy soldiers coming, hard sends its ranged units and mages there up the walls", () => {
  if (!rules().features?.walls) return;
  const up = (foes: boolean) => {
    const g = emptyGame();
    const w = g.w;
    const t = w.map.towns.find((x) => x.size === TownSize.Small)!;
    w.townState[t.id] = TownState.Plundering;
    w.townOwner[t.id] = 0;
    w.townTimer[t.id] = 600;
    w.refreshGates(t.id);
    w.tick = 12 * 1200;
    const archers = [put(g, 0, UnitType.Ranged, t.cellX, t.cellY), put(g, 0, UnitType.Ranged, t.cellX + 1, t.cellY), put(g, 0, UnitType.Mage, t.cellX, t.cellY + 1)];
    for (let k = 0; k < 6; k++) put(g, 0, UnitType.Spearman, t.cellX - 1 + (k % 3), t.cellY - 1);
    if (foes) for (let k = 0; k < 8; k++) put(g, 1, UnitType.Spearman, t.cellX + 9 + (k % 4), t.cellY + Math.trunc(k / 4));
    g.fog.update(w);
    const out = hardAi(g, { dodge: false }).think(buildView(g, 0));
    return { archers, wall: out.find((c) => c.c === "wall") as { u: number[]; town: number } | undefined, t };
  };
  const yes = up(true);
  assert.ok(yes.wall !== undefined && yes.wall.town === yes.t.id, "up the walls");
  assert.deepEqual([...yes.wall.u].sort((a, b) => a - b), [...yes.archers].sort((a, b) => a - b), "the ranged units and the mage");
  assert.equal(up(false).wall, undefined, "nobody coming: no");
});

test("D-096: hard plays a game against hard with the gates closed: it breaks a gate and takes a town", () => {
  if (!rules().features?.gates) return;
  const r = new Runner({ seed: 3, scenario: "standard", ai: [true, true], maxTicks: 0, difficulty: ["hard", "hard"] });
  const g = r.game;
  const w = g.w;
  const gates = new Set<number>();
  for (let s = 0; s < w.buildings.count; s++) if (w.buildings.col.type[s] === BuildingType.Gate) gates.add(w.buildings.col.id[s]);
  let taken = false;
  while (!r.over && g.tick < 16 * 1200 && !taken) {
    r.tick();
    for (let t = 0; t < w.townSize.length; t++) if (w.townOwner[t] === 0 || w.townOwner[t] === 1) taken = true;
  }
  assert.ok(taken, "a town taken by minute 16");
  assert.ok([...gates].some((id) => w.building(id) < 0), "a gate broken");
});

test("normal: on a random map each normal AI goes first for a town nearer itself (by town id both went for the one by player 0, war-game-core 2026-10-22)", () => {
  for (const seed of [7, 2]) {
    const r = new Runner({ seed, scenario: "standard", ai: [true, true], maxTicks: 36000, difficulty: ["normal", "normal"], map: "random" });
    const g = r.game;
    const m = g.w.map;
    const centre = [0, 1].map((p) => spawnCentre(m.frames[p], m.spawns.find((s) => s.player === p)!));
    const d2 = (p: number, t: { cellX: number; cellY: number }) => (t.cellX - centre[p].x) ** 2 + (t.cellY - centre[p].y) ** 2;
    const first = [-1, -1];
    let at = 0;
    while (g.tick < 12 * 1200 && (first[0] < 0 || first[1] < 0)) {
      r.tick();
      for (; at < g.log.length; at++) {
        const c = g.log[at];
        if (c.c !== "move" || c.u.length < 5 || first[c.p] >= 0) continue;
        const t = m.towns.find((t0) => (t0.cellX - c.x) ** 2 + (t0.cellY - c.y) ** 2 <= 9);
        if (t) first[c.p] = t.id;
      }
    }
    assert.ok(first[0] >= 0 && first[1] >= 0, `seed ${seed}: both march on a town`);
    for (const p of [0, 1]) {
      const t = m.towns.find((x) => x.id === first[p])!;
      assert.ok(d2(p, t) < d2(1 - p, t), `seed ${seed}: player ${p} goes for town ${t.id}, nearer itself`);
    }
  }
});

test("D-096 (plan.lumberMove): the trees by its lumber camp gone, hard puts up another by the nearest trees left on its side; off, as before", () => {
  const built = (lumberMove: boolean) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.tick = 13 * 1200;
    const at = (type: BuildingType, x: number, y: number) => w.addBuilding(0, type, s0.cellX + x, s0.cellY + y, rules().buildings[type].hp, 1000);
    for (const [t, x, y] of [[BuildingType.Barracks, 4, -8], [BuildingType.Barracks, 8, -8], [BuildingType.Range, 12, -8], [BuildingType.Range, 16, -8], [BuildingType.MageHall, 4, -13], [BuildingType.Granary, -6, -6], [BuildingType.Mine, 12, 2]] as [BuildingType, number, number][]) at(t, x, y);
    for (let k = 0; k < 10; k++) at(BuildingType.Farm, -14 + 3 * (k % 3), -14 + 3 * Math.trunc(k / 3));
    for (let k = 0; k < 12; k++) at(BuildingType.House, -8 + 3 * (k % 6), 6 + 3 * Math.trunc(k / 6));
    // Its lumber camp by the nearest trees, all of those cut; more trees further out.
    const d2 = (i: number) => (w.nodeX[i] - s0.cellX) ** 2 + (w.nodeY[i] - s0.cellY) ** 2;
    let first = -1;
    for (let i = 0; i < w.nodeKind.length; i++) if (w.nodeKind[i] === NodeKind.Tree && (first < 0 || d2(i) < d2(first))) first = i;
    w.addBuilding(0, BuildingType.LumberCamp, w.nodeX[first] + 1, w.nodeY[first] + 1, rules().buildings[BuildingType.LumberCamp].hp, 1000);
    for (let i = 0; i < w.nodeKind.length; i++) if (w.nodeKind[i] === NodeKind.Tree && (w.nodeX[i] - w.nodeX[first]) ** 2 + (w.nodeY[i] - w.nodeY[first]) ** 2 <= 100) w.nodeAmount[i] = 0;
    for (let k = 0; k < 30; k++) {
      const id = put(g, 0, UnitType.Farmer, s0.cellX - 4 + (k % 10), s0.cellY - 2 - Math.trunc(k / 10));
      w.units.col.order[slotOf(g, id)] = Order.Gather;
    }
    w.res.set([700, 600, 300, 0], 0);
    // It sees the nearest trees left and the ground there.
    let next = -1;
    for (let i = 0; i < w.nodeKind.length; i++) if (w.nodeKind[i] === NodeKind.Tree && w.nodeAmount[i] > 0 && (next < 0 || d2(i) < d2(next))) next = i;
    put(g, 0, UnitType.Spearman, w.nodeX[next] + 2, w.nodeY[next] + 2);
    g.fog.update(w);
    const out = hardAi(g, { dodge: false, lumberMove, goldCavalry: 0 }).think(buildView(g, 0));
    return out.some((c) => c.c === "build" && c.type === BuildingType.LumberCamp);
  };
  assert.equal(built(true), true, "on: another lumber camp");
  assert.equal(built(false), false, "off: none, as before");
});

// --- D-086 A5: hard that stopped attacking after failed waves (the user's f331df3c) --------------------------------

test("D-086 A5 (plan.cityForts): with arrow towers by the enemy's main city and few enemy soldiers in sight, hard does not march; off, as before", () => {
  const march = (cityForts: boolean) => {
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
    for (let k = 0; k < 40; k++) put(g, 0, UnitType.Spearman, s0.cellX + 6 + (k % 8), s0.cellY - 6 - Math.trunc(k / 8));
    // Eight towers round the enemy's main city, three soldiers in each, seen by a farmer of its own.
    for (let k = 0; k < 8; k++) {
      const id = w.addBuilding(1, BuildingType.ArrowTower, s1.cellX - 6 + 3 * (k % 4), s1.cellY + 8 + 3 * Math.trunc(k / 4), 600, 1000);
      w.buildings.col.soldiers[w.building(id)] = 3;
    }
    put(g, 0, UnitType.Farmer, s1.cellX - 4, s1.cellY + 13);
    put(g, 0, UnitType.Farmer, s1.cellX + 1, s1.cellY + 13);
    g.fog.update(w);
    assert.equal(enemyForts(buildView(g, 0), 0, rules()).length, 8, "it sees the towers");
    const out = hardAi(g, { dodge: false, pushArmy: 18, townArmy: 99, bigArmy: 99, peekFirst: 0, cityAgain: 0, cityForts }).think(buildView(g, 0));
    return out.some((c) => c.c === "move" && c.u.length === 40 && c.x === s1.cellX && c.y === s1.cellY);
  };
  assert.equal(march(false), true, "off: on to the enemy base");
  assert.equal(march(true), false, "on: not into the towers");
});

test("D-086 A5 (plan.foeMemory): what hard believes of the enemy comes only from soldiers it saw; enemy soldiers in the fog change nothing", () => {
  const believed = (hidden: number) => {
    const g = emptyGame();
    const w = g.w;
    w.tick = 12 * 1200;
    const s0 = w.map.spawns[0];
    const s1 = w.map.spawns[1];
    for (let k = 0; k < 10; k++) put(g, 0, UnitType.Spearman, s0.cellX + 6 + (k % 5), s0.cellY - 6 - Math.trunc(k / 5));
    // Six enemy spearmen in sight by its army; `hidden` more by their own main city, in the fog.
    for (let k = 0; k < 6; k++) put(g, 1, UnitType.Spearman, s0.cellX + 6 + k, s0.cellY - 10);
    for (let k = 0; k < hidden; k++) put(g, 1, UnitType.Spearman, s1.cellX - 4 + (k % 8), s1.cellY + 4 + Math.trunc(k / 8));
    g.fog.update(w);
    const ai = hardAi(g, { dodge: false, foeMemory: true, foeDecay: 10 }) as unknown as { think: (v: unknown) => unknown; peek: () => Record<string, number> };
    ai.think(buildView(g, 0));
    // Those in sight leave; a minute and more on it still remembers them, less 10% a minute.
    for (let s = 0; s < w.units.count; s++) if (w.units.col.owner[s] === 1 && (w.units.col.y[s] >> 10) === s0.cellY - 10) w.units.col.hp[s] = 0;
    g.step();
    for (let t = 0; t < 3; t++) {
      w.tick += 1200;
      g.fog.update(w);
      ai.think(buildView(g, 0));
    }
    return ai.peek();
  };
  const none = believed(0);
  const many = believed(40);
  assert.ok(none.believedWorth > 0, "it remembers those it saw");
  assert.deepEqual(many, none, "the 40 in the fog change nothing");
});

test("D-086 A5 (plan.cityCap, cityForget): after a march is ground down, cityAgain asks no more than the share it can field, and not after cityForget minutes; off, as before", () => {
  const again = (plan: Partial<HardPlan>, later: number) => {
    const g = emptyGame();
    const w = g.w;
    for (const t of w.map.towns) {
      w.townState[t.id] = TownState.Ruins;
      w.townOwner[t.id] = NO_OWNER;
      w.townTimer[t.id] = 48000;
      put(g, 0, UnitType.Farmer, t.cellX + 2, t.cellY + 2);
    }
    w.tick = 12 * 1200;
    const s0 = w.map.spawns[0];
    const s1 = w.map.spawns[1];
    const ids: number[] = [];
    for (let k = 0; k < 30; k++) ids.push(put(g, 0, UnitType.Spearman, s0.cellX + 14 + (k % 6), s0.cellY - 14 - Math.trunc(k / 6)));
    g.fog.update(w);
    const ai = hardAi(g, { dodge: false, pushArmy: 18, townArmy: 99, bigArmy: 99, peekFirst: 0, cityAgain: 200, ...plan });
    assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.u.length === 30 && c.x === s1.cellX && c.y === s1.cellY), "marches");
    kill(g, ids.slice(0, 20));
    assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "retreat"), "ground down, it breaks off");
    // 40 at home now: 133% of the 30 that set out, under cityAgain's 200%.
    for (let k = 0; k < 30; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + (k % 6), s0.cellY - 4 - Math.trunc(k / 6));
    w.tick += later;
    g.fog.update(w);
    return ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.u.length >= 30 && c.x === s1.cellX && c.y === s1.cellY);
  };
  assert.equal(again({}, 10), false, "off: 40 of 30 is short of 200%");
  // The ceiling less its farmers is what it can field: 20% of it is under 40.
  assert.equal(again({ cityCap: 20 }, 10), true, "cityCap 20: no more than 20% of what it can field");
  assert.equal(again({ cityForget: 1 }, 10), false, "cityForget 1, 10 ticks on: still held");
  assert.equal(again({ cityForget: 1 }, 1200), true, "cityForget 1, a minute on: forgotten");
});

test("D-086 A5 (plan.townSave): at home with a town it could take but for the cost of governing it, hard keeps that cost aside, then goes; off, it spends it", () => {
  const run = (townSave: boolean) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.tick = 12 * 1200;
    // Every town neutral and plundered before (so only to be governed), seen by a farmer of its own.
    for (const t of w.map.towns) {
      w.townPlundered[t.id] = 1;
      put(g, 0, UnitType.Farmer, t.cellX + 3, t.cellY + 3);
    }
    w.addBuilding(0, BuildingType.Range, s0.cellX + 8, s0.cellY - 8, rules().buildings[BuildingType.Range].hp, 1000);
    for (let k = 0; k < 6; k++) w.addBuilding(0, BuildingType.House, s0.cellX - 8 + 3 * k, s0.cellY + 6, rules().buildings[BuildingType.House].hp, 1000);
    for (let k = 0; k < 20; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + (k % 5), s0.cellY + 2 + Math.trunc(k / 5));
    w.res.set([300, 40, 200, 0], 0);
    g.fog.update(w);
    const ai = hardAi(g, { dodge: false, townArmy: 10, bigArmy: 99, pushArmy: 99, peekFirst: 0, townSave });
    ai.think(buildView(g, 0));
    w.res.set([300, 40, 200, 0], 0);
    w.tick += 10;
    g.fog.update(w);
    const second = ai.think(buildView(g, 0));
    // Wood enough to govern a small town now.
    w.res.set([300, 120, 200, 0], 0);
    w.tick += 10;
    g.fog.update(w);
    const third = ai.think(buildView(g, 0));
    return {
      ranged: trains(second, UnitType.Ranged),
      goes: third.some((c) => c.c === "move" && c.u.length >= 10 && w.map.towns.some((t) => (c.x - t.cellX) ** 2 + (c.y - t.cellY) ** 2 <= 9)),
    };
  };
  const off = run(false);
  const on = run(true);
  assert.equal(off.ranged, true, "off: its 40 wood on a ranged unit, as before");
  assert.equal(on.ranged, false, "on: kept for governing");
  assert.equal(on.goes, true, "on: it can pay now, it goes");
});


// --- D-100: a keep in every town ---------------------------------------------------------------------------------

test(
  "D-100 (KEEP_AI.mop, off by default): inside a town with its keep down, the militia left on the walls are told to fight; none in sight, the army walks the walls; off, none",
  switchedOn(KEEP, () => {
    const g = new Game({ seed: 1, scenario: "standard" });
    const w = g.w;
    const t = w.map.towns.find((x) => x.size === TownSize.Small)!;
    const r = rules(w.map);
    // The keep down.
    for (let s = 0; s < w.buildings.count; s++) if (w.buildings.col.type[s] === BuildingType.Keep && w.buildings.col.town[s] === t.id) w.buildings.col.hp[s] = 0;
    g.step();
    // Its militia: all gone but those on its walls.
    const u = w.units.col;
    for (let s = 0; s < w.units.count; s++) if (u.type[s] === UnitType.Militia && u.action[s] !== Action.OnWall) u.hp[s] = 0;
    g.step();
    const army = Array.from({ length: 6 }, (_, k) => put(g, 0, UnitType.Spearman, t.cellX - 1 + (k % 3), t.cellY + 2 + Math.trunc(k / 3)));
    g.fog.update(w);
    const town = { x: t.cellX, y: t.cellY, size: t.size, state: w.townState[t.id], owner: w.townOwner[t.id] };
    const mine = army.map((id) => ({ id, type: UnitType.Spearman, x: u.x[slotOf(g, id)] >> 10, y: u.y[slotOf(g, id)] >> 10 }));
    const view = buildView(g, 0);
    const was = KEEP_AI.mop;
    KEEP_AI.mop = true;
    // The militia left in sight (since war-game-core cf6a5c0 those on the walls come down once the keep falls).
    const left = new Set<number>();
    for (let k = 0; k < view.units.length; k += UNIT_STRIDE) if (view.units[k + UnitField.type] === UnitType.Militia) left.add(view.units[k + UnitField.id]);
    const out = mopUpOrders(view, r, 0, town, mine);
    assert.ok(out !== null && out.length > 0, "orders");
    if (left.size > 0) assert.ok(out.every((c) => c.c === "attack" && left.has((c as { target: number }).target)), "at the militia in sight");
    else assert.ok(out.every((c) => c.c === "move"), "none in sight: along the walls");
    assert.deepEqual(out.flatMap((c) => (c as { u: number[] }).u).sort((a, b) => a - b), [...army].sort((a, b) => a - b), "every soldier");
    KEEP_AI.mop = false;
    assert.equal(mopUpOrders(view, r, 0, town, mine), null, "off: none");
    KEEP_AI.mop = was;
  }),
);

test(
  "D-100: hard against hard on a random map with keeps takes a town by minute 14 (seed 101: none taken all game before war-game-core cf6a5c0)",
  switchedOn(KEEP, () => {
    const r = new Runner({ seed: 101, scenario: "standard", ai: [true, true], maxTicks: 36000, difficulty: ["hard", "hard"], map: "random" });
    const w = r.game.w;
    let taken = false;
    while (!r.over && r.game.tick < 14 * 1200 && !taken) {
      r.tick();
      for (let t = 0; t < w.townSize.length; t++) if (w.townOwner[t] === 0 || w.townOwner[t] === 1) taken = true;
    }
    assert.ok(taken, "a town taken");
  }),
);


test(
  "D-100 (KEEP_AI.strength): a town's defence is its keep with its militia (all, as its rules give), or an enemy town's keep and garrison; 0 without keeps",
  switchedOn(KEEP, () => {
    const r = rules();
    const fv = fortValues(r);
    const small = townDefence(r, fv, 0, { size: TownSize.Small, state: TownState.Neutral, owner: NO_OWNER, needed: 0 }, []);
    const large = townDefence(r, fv, 0, { size: TownSize.Large, state: TownState.Neutral, owner: NO_OWNER, needed: 0 }, []);
    assert.ok(small > 0 && large > small, `${small} < ${large}`);
    const governed = townDefence(r, fv, 0, { size: TownSize.Small, state: TownState.Governed, owner: 1, needed: 3 }, []);
    const seen = townDefence(r, fv, 0, { size: TownSize.Small, state: TownState.Governed, owner: 1, needed: 3 }, Array.from({ length: 8 }, () => ({ type: UnitType.Spearman })));
    assert.ok(seen > governed, "the garrison it knows of, more than the minimum");
    assert.equal(townDefence(r, fv, 0, { size: TownSize.Small, state: TownState.Plundering, owner: 1, needed: 0 }, []), 0, "no keep while plundered");
  }),
);

test("D-100 (KEEP_AI.strength): without keeps a town's defence counts nothing (as before)", () => {
  const r = rules();
  if (r.features?.keep === true) return;
  assert.equal(townDefence(r, fortValues(r), 0, { size: TownSize.Small, state: TownState.Neutral, owner: NO_OWNER, needed: 0 }, []), 0);
});

test(
  "D-100 (KEEP_AI.strength): hard goes for a small town with a keep only with 1.3 x its keep and militia",
  switchedOn(KEEP, () => {
    const goes = (spears: number) => {
      const g = new Game({ seed: 1, scenario: "standard" });
      const w = g.w;
      for (let s = 0; s < w.units.count; s++) if (w.units.col.type[s] !== UnitType.Militia) w.units.col.hp[s] = 0;
      g.step();
      w.tick = 10 * 1200;
      const s0 = w.map.spawns[0];
      const near = [...w.map.towns].filter((t) => t.size === TownSize.Small).sort((a, b) => (a.cellX - s0.cellX) ** 2 + (a.cellY - s0.cellY) ** 2 - ((b.cellX - s0.cellX) ** 2 + (b.cellY - s0.cellY) ** 2))[0];
      for (const t of w.map.towns) put(g, 0, UnitType.Farmer, t.cellX + 10, t.cellY + 10);
      for (let k = 0; k < spears; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + (k % 5), s0.cellY - 4 - Math.trunc(k / 5));
      g.fog.update(w);
      const out = hardAi(g, { dodge: false, townArmy: 3, bigArmy: 99, pushArmy: 99, peekFirst: 0 }).think(buildView(g, 0));
      return out.some((c) => c.c === "move" && c.u.length === spears && (c.x - near.cellX) ** 2 + (c.y - near.cellY) ** 2 <= 9);
    };
    assert.equal(goes(5), false, "5 spearmen: not into its keep and militia");
    assert.equal(goes(8), true, "8: they go");
  }),
);

test("D-100 (plan.strongPush): clearly stronger than the enemy it saw lately, hard marches on the enemy's main city short of pushArmy; off, as before", () => {
  const march = (strongPush: number) => {
    const g = emptyGame();
    const w = g.w;
    for (const t of w.map.towns) {
      w.townState[t.id] = TownState.Ruins;
      w.townOwner[t.id] = NO_OWNER;
      w.townTimer[t.id] = 48000;
      put(g, 0, UnitType.Farmer, t.cellX + 2, t.cellY + 2);
    }
    w.tick = 15 * 1200;
    const s0 = w.map.spawns[0];
    const s1 = w.map.spawns[1];
    for (let k = 0; k < 30; k++) put(g, 0, UnitType.Spearman, s0.cellX + 6 + (k % 6), s0.cellY - 6 - Math.trunc(k / 6));
    // Five enemy spearmen in sight.
    for (let k = 0; k < 5; k++) put(g, 1, UnitType.Spearman, s0.cellX + 8 + k, s0.cellY - 14);
    g.fog.update(w);
    const out = hardAi(g, { dodge: false, pushArmy: 49, townArmy: 99, bigArmy: 99, peekFirst: 0, strongPush }).think(buildView(g, 0));
    return out.some((c) => c.c === "move" && c.u.length >= 25 && (c.x - s1.cellX) ** 2 + (c.y - s1.cellY) ** 2 <= 20 * 20);
  };
  assert.equal(march(0), false, "off: 30 is short of pushArmy 49");
  assert.equal(march(25), true, "strongPush 25: 30 against 5, it marches");
});

// --- D-086 A5: behind (the user 2026-10-25: 「你的ai逆風局只會龜縮但又不蓋防禦工事」) ------------------------------------

/** D-086 A5: its base all built (as the mineMove test), `spears` spearmen at home, and `foes` enemy spearmen in sight away from the enemy's side. */
function behindGame(foes: number, spears = 6): Game {
  const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    const s1 = w.map.spawns[1];
    w.tick = 15 * 1200;
    // Everything else it builds already standing (as the mineMove test), so a tower is what is left.
    const at = (type: BuildingType, x: number, y: number) => w.addBuilding(0, type, s0.cellX + x, s0.cellY + y, rules().buildings[type].hp, 1000);
    for (const [t, x, y] of [[BuildingType.Barracks, 4, -8], [BuildingType.Barracks, 8, -8], [BuildingType.Range, 12, -8], [BuildingType.Range, 16, -8], [BuildingType.MageHall, 4, -13], [BuildingType.Granary, -6, -6], [BuildingType.LumberCamp, -10, 2], [BuildingType.Mine, 12, 2]] as [BuildingType, number, number][]) at(t, x, y);
    for (let k = 0; k < 10; k++) at(BuildingType.Farm, -14 + 3 * (k % 3), -14 + 3 * Math.trunc(k / 3));
    for (let k = 0; k < 12; k++) at(BuildingType.House, -8 + 3 * (k % 6), 6 + 3 * Math.trunc(k / 6));
    for (let k = 0; k < 30; k++) {
      const id = put(g, 0, UnitType.Farmer, s0.cellX - 4 + (k % 10), s0.cellY - 2 - Math.trunc(k / 10));
      w.units.col.order[slotOf(g, id)] = Order.Gather;
    }
    for (let k = 0; k < spears; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + k, s0.cellY + 2);
    // The enemy army away from the enemy's side (the towers go that way, TOWER_SAFE from enemies), in sight of a farmer of its own.
    const fx = s0.cellX - Math.sign(s1.cellX - s0.cellX) * 4;
    const fy = s0.cellY - Math.sign(s1.cellY - s0.cellY) * 14;
    put(g, 0, UnitType.Farmer, fx, fy + Math.sign(s1.cellY - s0.cellY) * 3);
    for (let k = 0; k < foes; k++) put(g, 1, UnitType.Spearman, fx + (k % 4), fy - Math.trunc(k / 4) * Math.sign(s1.cellY - s0.cellY));
    w.res.set([700, 600, 600, 0], 0);
    g.fog.update(w);
    return g;
}

test("D-086 A5 (plan.behind): with an enemy army 1.3 x its own in sight, hard saves for arrow towers by its main city; not behind or off, none", () => {
  const towers = (behind: boolean, foes: number, spears = 6) => {
    const g = behindGame(foes, spears);
    const out = hardAi(g, { dodge: false, behind }).think(buildView(g, 0));
    return out.some((c) => c.c === "build" && c.type === BuildingType.ArrowTower);
  };
  assert.equal(towers(true, 16), true, "behind: a tower");
  assert.equal(towers(true, 2), false, "not behind: none");
  assert.equal(towers(true, 0, 0), false, "no army on either side (the start): not behind");
  assert.equal(towers(true, 7, 0), false, "fewer than BEHIND_MIN's worth: not behind");
  assert.equal(towers(false, 16), false, "off: none, as before");
});

test("D-086 A5 (plan.behindFail): a march that broke off makes hard behind; with behindFail off, only an enemy army it saw does", () => {
  const behindAfter = (behindFail: boolean) => {
    const g = emptyGame();
    const w = g.w;
    for (const t of w.map.towns) {
      w.townState[t.id] = TownState.Ruins;
      w.townOwner[t.id] = NO_OWNER;
      w.townTimer[t.id] = 48000;
    }
    w.tick = 12 * 1200;
    const s0 = w.map.spawns[0];
    const s1 = w.map.spawns[1];
    const ids: number[] = [];
    for (let k = 0; k < 30; k++) ids.push(put(g, 0, UnitType.Spearman, s0.cellX + 14 + (k % 6), s0.cellY - 14 - Math.trunc(k / 6)));
    g.fog.update(w);
    const ai = hardAi(g, { dodge: false, pushArmy: 18, townArmy: 99, bigArmy: 99, peekFirst: 0, behind: true, behindFail });
    assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "move" && c.u.length === 30 && c.x === s1.cellX && c.y === s1.cellY), "marches");
    kill(g, ids.slice(0, 20));
    assert.ok(ai.think(buildView(g, 0)).some((c) => c.c === "retreat"), "ground down, it breaks off");
    const before = ai.stats?.().behindThinks ?? 0;
    w.tick += 10;
    g.fog.update(w);
    ai.think(buildView(g, 0));
    return (ai.stats?.().behindThinks ?? 0) > before;
  };
  assert.equal(behindAfter(true), true, "behindFail: behind");
  assert.equal(behindAfter(false), false, "off: no enemy in sight, not behind");
});

test("D-086 A5 (plan.behindOutpost): behind, hard builds an outpost by its main city and posts spearmen there; not behind for a while, they come off it; off, none", () => {
  const think = (behindOutpost: boolean, foes: number, outpost: "none" | "done" | "manned") => {
    const g = behindGame(foes);
    const w = g.w;
    const s0 = w.map.spawns[0];
    if (outpost !== "none") {
      const id = w.addBuilding(0, BuildingType.Outpost, s0.cellX + 10, s0.cellY + 4, rules().buildings[BuildingType.Outpost].hp, 1000);
      if (outpost === "manned") {
        const s = slotOf(g, put(g, 0, UnitType.Spearman, s0.cellX + 10, s0.cellY + 6));
        w.units.col.order[s] = Order.Post;
        w.units.col.orderTarget[s] = id;
      }
      g.fog.update(w);
    }
    return hardAi(g, { dodge: false, behind: true, behindOutpost }).think(buildView(g, 0));
  };
  const builds = (out: CommandBody[]) => out.some((c) => c.c === "build" && c.type === BuildingType.Outpost);
  assert.equal(builds(think(true, 16, "none")), true, "behind: an outpost");
  assert.equal(builds(think(true, 2, "none")), false, "not behind: none");
  assert.equal(builds(think(false, 16, "none")), false, "off: none, as before");
  const post = think(true, 16, "done").find((c) => c.c === "post");
  assert.ok(post !== undefined && post.c === "post" && post.u.length === HARD.behindGuards, "behind: its guards posted");
  assert.equal(think(true, 2, "manned").some((c) => c.c === "unpost"), true, "not behind: off the outpost");
  assert.equal(think(true, 16, "manned").some((c) => c.c === "unpost"), false, "behind: they stay");
});

// --- D-086 A6: towns on even terms, and stock it cannot spend (the user's 9170fab0 and 4fd7b823) ----------------------

test("D-086 A6 (plan.econBehind): its army IDLE_HOME at home, hard goes for a town with an enemy army by it nearly its own; not before, nor off", () => {
  const goes = (econBehind: boolean, wait: number) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.tick = 15 * 1200;
    const t = [...w.map.towns].filter((x) => x.size === TownSize.Small).sort((a, b) => (a.cellX - s0.cellX) ** 2 + (a.cellY - s0.cellY) ** 2 - ((b.cellX - s0.cellX) ** 2 + (b.cellY - s0.cellY) ** 2))[0];
    // The others ruins it sees (unseen towns count as neutral ones).
    for (const o of w.map.towns) if (o.id !== t.id) {
      w.townState[o.id] = TownState.Ruins;
      w.townOwner[o.id] = NO_OWNER;
      w.townTimer[o.id] = 48000;
      put(g, 0, UnitType.Farmer, o.cellX, o.cellY);
    }
    for (let k = 0; k < 20; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + (k % 5), s0.cellY - 4 - Math.trunc(k / 5));
    // 17 enemy spearmen by the town (0.85 x its 20), in sight of a farmer of its own.
    put(g, 0, UnitType.Farmer, t.cellX + t.radius + 4, t.cellY);
    for (let k = 0; k < 17; k++) put(g, 1, UnitType.Spearman, t.cellX + t.radius + 1 + (k % 3), t.cellY - 3 + Math.trunc(k / 3));
    g.fog.update(w);
    const ai = hardAi(g, { dodge: false, econBehind, townArmy: 8, bigArmy: 99, pushArmy: 99, peekFirst: 0 });
    const first = ai.think(buildView(g, 0));
    w.tick += wait;
    g.fog.update(w);
    const out = [...first, ...ai.think(buildView(g, 0))];
    return out.some((c) => c.c === "move" && c.u.length >= 15 && c.x === t.cellX && c.y === t.cellY);
  };
  assert.equal(goes(true, 3 * 1200 + 10), true, "idle at home 3 minutes: on even terms");
  assert.equal(goes(true, 10), false, "not yet idle: as before (0.8 x)");
  assert.equal(goes(false, 3 * 1200 + 10), false, "off: as before");
});

test("D-086 A6 (plan.goldCavalry): wood short and gold piled up, hard trains cavalry (no wood) first; off, as before", () => {
  const cavalry = (goldCavalry: number) => {
    const g = behindGame(0);
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.addBuilding(0, BuildingType.Stable, s0.cellX + 20, s0.cellY - 8, rules().buildings[BuildingType.Stable].hp, 1000);
    w.res.set([600, 10, 600, 0], 0);
    g.fog.update(w);
    return hardAi(g, { dodge: false, goldCavalry }).think(buildView(g, 0)).some((c) => c.c === "train" && c.type === UnitType.Cavalry);
  };
  assert.equal(cavalry(25), true, "on: cavalry");
  assert.equal(cavalry(0), false, "off: none");
});

test("D-086 A6 (plan.crystalStop): its mages at the cap with crystal for 4 more, hard takes its farmers off the crystal vein; off, they stay", () => {
  const released = (crystalStop: boolean) => {
    const g = behindGame(0);
    const w = g.w;
    const s0 = w.map.spawns[0];
    // A soldier of its own by a crystal vein, so it knows of one.
    const vein = w.nodeKind.findIndex((k) => k === NodeKind.CrystalVein);
    put(g, 0, UnitType.Spearman, w.nodeX[vein] - 2, w.nodeY[vein] - 2);
    g.fog.update(w);
    const ai = hardAi(g, { dodge: false, crystalStop });
    const crew = ai.think(buildView(g, 0)).find((c) => c.c === "gather" && c.u.length === HARD.vein);
    assert.ok(crew !== undefined && crew.c === "gather", "a crew to the vein");
    for (let k = 0; k < rules().mageCap; k++) put(g, 0, UnitType.Mage, s0.cellX + 4 + k, s0.cellY + 3);
    w.res.set([200, 200, 200, 4 * rules().units[UnitType.Mage].cost.crystal], 0);
    w.tick += 10;
    g.fog.update(w);
    const out = ai.think(buildView(g, 0));
    return out.some((c) => c.c === "release" && crew.u.every((id) => c.u.includes(id)));
  };
  assert.equal(released(true), true, "on: off the vein");
  assert.equal(released(false), false, "off: they stay");
});

test("D-086 A5 (plan.holdTowns): enemy soldiers by a town it governs and the army at home 1.3 x them, hard goes to hold it; off, it stays", () => {
  const goes = (holdTowns: boolean) => {
    const g = emptyGame();
    const w = g.w;
    const s0 = w.map.spawns[0];
    w.tick = 15 * 1200;
    const t = [...w.map.towns].filter((x) => x.size === TownSize.Small).sort((a, b) => (a.cellX - s0.cellX) ** 2 + (a.cellY - s0.cellY) ** 2 - ((b.cellX - s0.cellX) ** 2 + (b.cellY - s0.cellY) ** 2))[0];
    w.townState[t.id] = TownState.Governed;
    w.townOwner[t.id] = 0;
    for (const o of w.map.towns) if (o.id !== t.id) {
      w.townState[o.id] = TownState.Ruins;
      w.townOwner[o.id] = NO_OWNER;
      w.townTimer[o.id] = 48000;
    }
    put(g, 0, UnitType.Spearman, t.cellX, t.cellY);
    for (let k = 0; k < 20; k++) put(g, 0, UnitType.Spearman, s0.cellX + 4 + (k % 5), s0.cellY - 4 - Math.trunc(k / 5));
    // In sight of its soldier in the town.
    for (let k = 0; k < 5; k++) put(g, 1, UnitType.Spearman, t.cellX + 6, t.cellY - 2 + k);
    g.fog.update(w);
    const out = hardAi(g, { dodge: false, holdTowns, townArmy: 99, bigArmy: 99, pushArmy: 99, peekFirst: 0 }).think(buildView(g, 0));
    return out.some((c) => c.c === "move" && c.u.length >= 15 && c.x === t.cellX && c.y === t.cellY);
  };
  assert.equal(goes(true), true, "on: to the town");
  assert.equal(goes(false), false, "off: as before");
});
