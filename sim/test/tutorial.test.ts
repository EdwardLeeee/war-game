// R25 (D-150, D-151): the tutorial's scene. Its own map and start; player 1 never thinks; `tutorial` commands put each
// step's outcome in the game (player 0, the tutorial only, the once-only ones once); the nine steps played with plain
// commands win in time; the laziest play cannot lose; it replays.

import assert from "node:assert/strict";
import { test } from "node:test";
import { rules } from "../src/core/rules.ts";
import { Runner } from "../src/runner.ts";
import { mapInfo } from "../src/view/view.ts";
import { BuildingType, NEUTRAL, Reject, TownChoice, TownState, UnitType } from "../src/protocol.ts";

const MIN = 1200;

function tutorial(): { r: Runner; cmd: (body: object) => number; step: (n: number) => void } {
  const r = new Runner({ seed: 7, scenario: "tutorial", ai: [true, true], maxTicks: 0, map: "random" });
  let seq = 0;
  const g = r.game;
  return {
    r,
    // A command run at once (its own tick); what it gave back (0: done).
    cmd: (body: object) => {
      r.command(0, { ...body, seq: seq++ } as never);
      r.tick();
      const rej = g.events.find((e) => e.ev.k === "rejected");
      return rej === undefined ? 0 : (rej.ev as { reason: number }).reason;
    },
    step: (n: number) => {
      for (let i = 0; i < n && !g.w.over; i++) r.tick();
    },
  };
}

const owned = (r: Runner, p: number, type: number) => {
  const w = r.game.w;
  const u = w.units.col;
  const out: number[] = [];
  for (let s = 0; s < w.units.count; s++) if (u.owner[s] === p && u.type[s] === type) out.push(u.id[s]);
  return out;
};
const buildingOf = (r: Runner, p: number, type: number) => {
  const w = r.game.w;
  const b = w.buildings.col;
  for (let s = 0; s < w.buildings.count; s++) if (b.owner[s] === p && b.type[s] === type) return s;
  return -1;
};

test("the tutorial's map and start: 65 x 65, known whole, one town with 3 militia and a 10 s repair, player 1's main city alone", () => {
  const { r } = tutorial();
  const w = r.game.w;
  assert.equal(w.size, 65);
  const info = mapInfo(w.map, 0);
  assert.equal(info.mode, "fixed");
  assert.equal(info.towns.length, 1);
  assert.equal(info.spawns.length, 2);
  assert.deepEqual(info.tutorial, { rally: w.map.tutorial!.rally });
  assert.equal(rules(w.map).towns[0].militia, 3);
  assert.equal(rules(w.map).towns[0].repairTicks, 10 * 20);
  assert.equal(rules().towns[0].repairTicks, 45 * 20, "a game's as before");
  assert.equal(rules(w.map).units[UnitType.Siege].trainTicks, 15 * 20, "a siege engine in 15 s (ceo 2026-11-15)");
  assert.equal(rules().units[UnitType.Siege].trainTicks, 40 * 20, "a game's as before");
  assert.equal(rules(w.map).units[UnitType.Spearman].trainTicks, rules().units[UnitType.Spearman].trainTicks);
  assert.equal(owned(r, 0, UnitType.Farmer).length, 5);
  assert.equal(owned(r, 1, UnitType.Farmer).length, 0);
  const u = w.units.col;
  assert.equal(Array.from({ length: w.units.count }, (_, s) => u.owner[s]).filter((o) => o === NEUTRAL).length, 3);
  assert.deepEqual(Array.from(w.res.slice(0, 8)), [300, 500, 200, 0, 0, 0, 0, 0]);
  // The town and player 1's main city explored; player 1's main city always seen.
  const n = w.size;
  const fog = r.game.fog;
  assert.equal(fog.explored[0][w.townY[0] * n + w.townX[0]], 1);
  assert.equal(fog.visible[0][w.homes[1].cellY * n + w.homes[1].cellX], 1);
});

test("player 1 never thinks in the tutorial; the `tutorial` command is the tutorial's and player 0's only", () => {
  const { r, step } = tutorial();
  step(5 * MIN);
  assert.equal(r.game.w.units.col.owner.slice(0, r.game.w.units.count).filter((o) => o === 1).length, 0);
  const other = new Runner({ seed: 7, scenario: "standard", ai: [false, false], maxTicks: 0 });
  other.command(0, { c: "tutorial", event: "spears", seq: 0 } as never);
  other.tick();
  assert.ok(other.game.events.some((e) => e.ev.k === "rejected" && (e.ev as { reason: number }).reason === Reject.NotAvailable));
  assert.equal(owned(other, 0, UnitType.Spearman).length, 0);
  const t = tutorial();
  t.r.command(1, { c: "tutorial", event: "spears", seq: 0 } as never);
  t.r.tick();
  assert.equal(owned(t.r, 1, UnitType.Spearman).length + owned(t.r, 0, UnitType.Spearman).length, 0);
});

test("the events: each step's outcome; the once-only ones once; near_home not while its squad lives", () => {
  const { r, cmd, step } = tutorial();
  const w = r.game.w;
  assert.equal(cmd({ c: "tutorial", event: "houses" }), 0);
  assert.ok(buildingOf(r, 0, BuildingType.Barracks) >= 0 && buildingOf(r, 0, BuildingType.House) >= 0);
  assert.equal(w.buildings.col.progress[buildingOf(r, 0, BuildingType.Barracks)], 1000);
  assert.equal(cmd({ c: "tutorial", event: "houses" }), Reject.NotAvailable);
  assert.equal(cmd({ c: "tutorial", event: "spears" }), 0);
  assert.equal(owned(r, 0, UnitType.Spearman).length, 5);
  const wood = w.res[1];
  assert.equal(cmd({ c: "tutorial", event: "siege" }), 0);
  assert.ok(buildingOf(r, 0, BuildingType.SiegeWorks) >= 0);
  assert.equal(w.res[1] - wood, 300);
  assert.equal(cmd({ c: "tutorial", event: "engines" }), 0);
  assert.equal(owned(r, 0, UnitType.Siege).length, 2);
  assert.equal(cmd({ c: "tutorial", event: "town" }), 0);
  step(2);
  assert.equal(w.townOwner[0], 0);
  assert.equal(w.townState[0], TownState.Governed);
  const keep = buildingOf(r, 0, BuildingType.Keep);
  assert.ok(keep >= 0, "its keep is player 0's");
  assert.equal(cmd({ c: "tutorial", event: "town" }), Reject.NotAvailable);
  step(MIN);
  assert.equal(w.townState[0], TownState.Governed, "manned: no revolt");
  assert.equal(cmd({ c: "tutorial", event: "near_home" }), 0);
  assert.equal(owned(r, 1, UnitType.Spearman).length, 4);
  assert.equal(cmd({ c: "tutorial", event: "near_home" }), Reject.NotAvailable);
  // Step 7 skipped: the squad falls; then nothing to clear, and a new squad may come.
  assert.equal(cmd({ c: "tutorial", event: "near_home_clear" }), 0);
  assert.equal(owned(r, 1, UnitType.Spearman).length, 0);
  assert.equal(cmd({ c: "tutorial", event: "near_home_clear" }), Reject.NotAvailable);
  assert.equal(cmd({ c: "tutorial", event: "near_home" }), 0);
});

test("the nine steps with plain commands: the army out at the rally point when step 7's squad comes, a win in time, no farmer lost", () => {
  const { r, cmd, step } = tutorial();
  const w = r.game.w;
  const u = w.units.col;
  const b = w.buildings.col;
  const home = w.homes[0];
  const rally = w.map.tutorial!.rally;
  const at = (id: number) => {
    const s = w.unit(id);
    return s < 0 ? null : { x: u.x[s] >> 10, y: u.y[s] >> 10 };
  };
  step(200);
  // Step 3: a barracks (the farmers the simulation picks).
  let built = false;
  for (let k = 0; k < 40 && !built; k++) built = cmd({ c: "build", u: [], type: BuildingType.Barracks, x: home.cellX + 4 + (k % 8), y: home.cellY + 4 + Math.trunc(k / 8) }) === 0;
  assert.ok(built);
  while (b.progress[buildingOf(r, 0, BuildingType.Barracks)] < 1000) step(20);
  // Step 4: 5 spearmen.
  assert.equal(cmd({ c: "train", building: b.id[buildingOf(r, 0, BuildingType.Barracks)], type: UnitType.Spearman, n: 5 }), 0);
  while (owned(r, 0, UnitType.Spearman).length < 5) step(20);
  const spears = owned(r, 0, UnitType.Spearman);
  // Step 5: to the rally point; nothing there attacks them.
  cmd({ c: "move", u: spears, x: rally.x, y: rally.y });
  step(40 * 20);
  assert.ok(spears.every((id) => { const p = at(id); return p !== null && Math.hypot(p.x - rally.x, p.y - rally.y) <= 4; }));
  // Step 7: the squad reaches the main city while the army waits at the rally point, never near it.
  assert.equal(cmd({ c: "tutorial", event: "near_home" }), 0);
  const squad = owned(r, 1, UnitType.Spearman);
  const city = buildingOf(r, 0, BuildingType.MainCity);
  let ticks = 0;
  let nearest = Infinity;
  while (b.hp[buildingOf(r, 0, BuildingType.MainCity)] === 1200 && ticks < 2 * MIN) {
    step(20);
    ticks += 20;
    for (const id of squad) for (const sid of spears) { const p = at(id); const q = at(sid); if (p && q) nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.y - q.y)); }
  }
  void city;
  assert.ok(ticks >= 20 * 20 && ticks <= 60 * 20, `the squad at the main city after ${ticks / 20} s`);
  assert.ok(nearest >= 8, `it came ${nearest.toFixed(1)} cells near the army`);
  cmd({ c: "retreat", u: spears, x: home.cellX, y: home.cellY + 3 });
  while (owned(r, 1, UnitType.Spearman).length > 0 && ticks < 5 * MIN) {
    step(20);
    ticks += 20;
    const left = spears.filter((id) => w.unit(id) >= 0);
    const foe = owned(r, 1, UnitType.Spearman)[0];
    if (ticks % 200 === 0 && foe !== undefined) cmd({ c: "attack", u: left, target: foe });
  }
  assert.equal(owned(r, 1, UnitType.Spearman).length, 0);
  // Step 8: the town, governed in 10 s.
  const alive = () => spears.filter((id) => w.unit(id) >= 0);
  for (let k = 0; w.townState[0] === TownState.Neutral && k < 4 * MIN; k += 20) {
    if (k % 200 === 0) cmd({ c: "move", u: alive(), x: w.townX[0], y: w.townY[0] });
    step(20);
  }
  assert.equal(w.townState[0], TownState.AwaitingChoice);
  assert.equal(cmd({ c: "town_choice", town: 0, choice: TownChoice.Govern }), 0);
  step(10 * 20 + 20);
  assert.equal(w.townState[0], TownState.Governed);
  // Step 9: the siege works given, 2 engines trained, the enemy's main city taken.
  assert.equal(cmd({ c: "tutorial", event: "siege" }), 0);
  assert.equal(cmd({ c: "train", building: b.id[buildingOf(r, 0, BuildingType.SiegeWorks)], type: UnitType.Siege, n: 2 }), 0);
  const trainFrom = w.tick;
  while (owned(r, 0, UnitType.Siege).length < 2) step(20);
  assert.ok(w.tick - trainFrom <= 32 * 20, `2 engines in ${(w.tick - trainFrom) / 20} s`);
  cmd({ c: "attack", u: [...owned(r, 0, UnitType.Siege), ...alive()], target: b.id[buildingOf(r, 1, BuildingType.MainCity)] });
  step(6 * MIN);
  assert.ok(w.over && w.winner === 0, "won");
  assert.ok(w.tick < 12 * MIN, `won at minute ${(w.tick / MIN).toFixed(1)}`);
  assert.equal(owned(r, 0, UnitType.Farmer).length >= 5, true);
  assert.deepEqual(Array.from(w.farmerDeaths.slice(0, 5)), [0, 0, 0, 0, 0]);
});

test("the laziest play cannot lose: the squad at an empty home for 10 minutes leaves the main city half its hp at least", () => {
  const { r, cmd, step } = tutorial();
  const w = r.game.w;
  assert.equal(cmd({ c: "tutorial", event: "near_home" }), 0);
  let least = 1200;
  for (let k = 0; k < 10 * MIN; k += 20) {
    step(20);
    least = Math.min(least, w.buildings.col.hp[buildingOf(r, 0, BuildingType.MainCity)]);
  }
  assert.equal(w.over, false);
  assert.ok(least >= 600, `least hp ${least}`);
});

test("a tutorial replays: the same commands, the same hashes", () => {
  const { r, cmd, step } = tutorial();
  cmd({ c: "tutorial", event: "spears" });
  cmd({ c: "tutorial", event: "near_home" });
  step(2 * MIN);
  cmd({ c: "tutorial", event: "town" });
  step(MIN);
  const log = r.game.log.slice();
  const again = new Runner({ seed: 7, scenario: "tutorial", ai: [false, false], maxTicks: 0, replay: log });
  while (again.game.tick < r.game.tick) again.tick();
  assert.equal(again.game.hash(), r.game.hash());
});
