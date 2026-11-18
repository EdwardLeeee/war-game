// D-154 (OWN_PASS): a player's units walk through its own buildings (finished or going up, towers and the main city
// too), as through its outposts (D-115); nobody else does, walls stay terrain. They do not stop or fight inside one.

import assert from "node:assert/strict";
import { test } from "node:test";
import { createAi } from "../src/ai/ai.ts";
import { Game } from "../src/core/game.ts";
import { BUILDINGS, OWN_PASS, rules, UNITS } from "../src/core/rules.ts";
import { BLOCK_BUILDING, BLOCK_ROCK, BLOCK_WALL } from "../src/core/world.ts";
import { Action, BuildingType, CELL_SHIFT, NEUTRAL, Stance, UnitType } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, openArea, put, run, slotOf, switchedOff } from "./helpers.ts";

/** A building of player 0 standing across a corridor as wide as it, rock either side. */
function corridor(type: BuildingType, built = true) {
  const g = emptyGame();
  const w = g.w;
  const { x, y } = openArea(g, 24);
  const n = w.size;
  const size = BUILDINGS[type].size;
  for (let yy = y; yy < y + 24; yy++) {
    if (yy >= y + 11 && yy < y + 11 + size) continue;
    for (let xx = x + 12; xx < x + 12 + size; xx++) w.grid[yy * n + xx] |= BLOCK_ROCK;
  }
  w.blockVersion++;
  const id = w.addBuilding(0, type, x + 12, y + 11, BUILDINGS[type].hp, built ? 1000 : 0);
  g.fog.update(w);
  return { g, w, x, y, id, size };
}

const cellX = (g: Game, id: number) => g.w.units.col.x[slotOf(g, id)] >> CELL_SHIFT;

/** Runs `ticks`; whether unit `id` ever stood on a cell of building `b` (the corridor is open round the ends of its rock). */
function walk(g: Game, id: number, b: number, ticks: number): boolean {
  const w = g.w;
  let inside = false;
  for (let t = 0; t < ticks; t++) {
    run(g, 1);
    const s = slotOf(g, id);
    if (s >= 0 && w.buildingAt[(w.units.col.y[s] >> CELL_SHIFT) * w.size + (w.units.col.x[s] >> CELL_SHIFT)] === b) inside = true;
  }
  return inside;
}

test("D-154: its owner's soldier walks through its house, barracks and arrow tower, finished or going up; an enemy's stops and breaks it", () => {
  for (const type of [BuildingType.House, BuildingType.Barracks, BuildingType.ArrowTower]) {
    for (const built of [true, false]) {
      const { g, w, x, y, id, size } = corridor(type, built);
      const mine = put(g, 0, UnitType.Spearman, x + 6, y + 12);
      g.fog.update(w);
      cmd(g, 0, { c: "retreat", u: [mine], x: x + 20, y: y + 12 });
      const through = walk(g, mine, id, 300);
      const what = `${size}x${size} type ${type} (${built ? "finished" : "going up"})`;
      assert.ok(through, `through ${what}`);
      assert.equal(cellX(g, mine), x + 20, `there, ${what}`);
    }
  }
  const { g, w, x, y, id } = corridor(BuildingType.House);
  const foe = put(g, 1, UnitType.Spearman, x + 6, y + 12);
  g.fog.update(w);
  cmd(g, 1, { c: "move", u: [foe], x: x + 20, y: y + 12 });
  const hp = w.buildings.col.hp[w.building(id)];
  run(g, 120);
  assert.ok(cellX(g, foe) < x + 12, "not into it");
  assert.ok(w.buildings.col.hp[w.building(id)] < hp, "it breaks through it (D-024)");
});

test("D-154: only its owner's grid opens it; the shared grid, walls and other players' grids stay blocked", () => {
  const { w, x, y } = corridor(BuildingType.Barracks);
  const n = w.size;
  const c = (y + 12) * n + x + 13;
  assert.notEqual(w.grid[c] & BLOCK_BUILDING, 0, "the shared grid: goals, slots and drop cells stay outside");
  assert.equal(w.passGrid(w.passClass(0))[c], 0, "its owner walks it");
  assert.notEqual(w.passGrid(w.passClass(1))[c] & BLOCK_BUILDING, 0, "the other player does not");
  assert.equal(w.passClass(NEUTRAL), 0);
  const wall = w.wallCells.flatMap((cells) => Array.from(cells)).find((k) => (w.grid[k] & BLOCK_WALL) !== 0);
  assert.ok(wall !== undefined);
  assert.notEqual(w.passGrid(w.passClass(0))[wall] & BLOCK_WALL, 0, "a castle wall stops everyone");
});

test("D-154: one standing in its own building walks out and takes its place outside; it does not shoot from inside", () => {
  const { g, w, x, y } = corridor(BuildingType.Barracks);
  const u = w.units.col;
  // An archer put in the barracks' middle cell, idle: it walks out and stays out.
  const archer = put(g, 0, UnitType.Ranged, x + 13, y + 12);
  g.fog.update(w);
  run(g, 60);
  let s = slotOf(g, archer);
  assert.equal(w.insideOwn(s), false, "out");
  assert.equal(u.action[s], Action.Idle);
  const ax = u.anchorX[s] >> CELL_SHIFT;
  const ay = u.anchorY[s] >> CELL_SHIFT;
  assert.equal(w.grid[ay * w.size + ax], 0, "its place is outside");
  run(g, 200);
  assert.equal(w.insideOwn(slotOf(g, archer)), false, "and stays out");
  // Put back in, an enemy in reach outside: it steps out before it shoots.
  s = slotOf(g, archer);
  u.x[s] = ((x + 13) << CELL_SHIFT) + 512;
  u.y[s] = ((y + 12) << CELL_SHIFT) + 512;
  u.anchorX[s] = u.x[s];
  u.anchorY[s] = u.y[s];
  const foe = put(g, 1, UnitType.Spearman, x + 17, y + 12);
  g.fog.update(w);
  const hp = u.hp[slotOf(g, foe)];
  for (let t = 0; t < 120; t++) {
    run(g, 1);
    const a = slotOf(g, archer);
    if (a < 0) break;
    assert.ok(!(w.insideOwn(a) && u.action[a] === Action.Attack), `not shooting from inside (tick ${t})`);
  }
  const f = slotOf(g, foe);
  assert.ok(f < 0 || u.hp[f] < hp, "it shot from outside");
});

test("D-154 (core's review): in reach only from inside the far half of its own building, it steps out on the target's side and shoots", () => {
  // Player 0's main city (4 x 4) on the fixed map; an archer south of it told to attack a spearman holding north of it, so
  // far that the archer first comes in reach in the city's south half. Stepping out to the nearest open cell (south) took
  // it out of reach and its approach walked it back in: it stood at the city's edge and never shot (main 2026-11-18).
  const g = new Game({ seed: 1, scenario: "standard", maxTicks: 0 });
  const w = g.w;
  const u = w.units.col;
  const b = w.buildings.col;
  for (let s = 0; s < w.units.count; s++) w.unitSlot[u.id[s]] = -1;
  w.units.count = 0;
  let city = -1;
  for (let s = 0; s < w.buildings.count; s++) if (b.type[s] === BuildingType.MainCity && b.owner[s] === 0) city = s;
  const cx = b.cellX[city];
  const cy = b.cellY[city];
  const size = BUILDINGS[BuildingType.MainCity].size;
  const range = UNITS[UnitType.Ranged].range >> CELL_SHIFT;
  const archer = put(g, 0, UnitType.Ranged, cx + 2, cy + size + 1);
  const foe = put(g, 1, UnitType.Spearman, cx + 2, cy - range + 3);
  u.hp[slotOf(g, foe)] = 5000;
  g.fog.update(w);
  cmd(g, 1, { c: "stance", u: [foe], stance: Stance.Hold });
  cmd(g, 0, { c: "attack", u: [archer], target: foe });
  let inside = 0;
  let shooting = 0;
  for (let t = 0; t < 30 * 20; t++) {
    run(g, 1);
    const a = slotOf(g, archer);
    if (w.insideOwn(a)) inside++;
    else if (u.action[a] === Action.Attack) shooting++;
  }
  assert.ok(inside <= 5 * 20, `${inside} ticks inside its main city`);
  assert.ok(shooting >= 20 * 20, `${shooting} ticks shooting from outside`);
});

test("D-154: a move ordered onto its own building ends outside it", () => {
  const { g, w, x, y } = corridor(BuildingType.Barracks);
  const mine = put(g, 0, UnitType.Spearman, x + 6, y + 12);
  g.fog.update(w);
  cmd(g, 0, { c: "move", u: [mine], x: x + 13, y: y + 12 });
  run(g, 300);
  assert.equal(w.insideOwn(slotOf(g, mine)), false);
});

test("D-154: a keep that goes over as one walks through it: the walker is put out", () => {
  const { g, w, x, y, id } = corridor(BuildingType.Barracks);
  const mine = put(g, 0, UnitType.Spearman, x + 13, y + 12);
  g.fog.update(w);
  w.setBuildingOwner(w.building(id), NEUTRAL);
  run(g, 2);
  const s = slotOf(g, mine);
  assert.equal(w.grid[(w.units.col.y[s] >> CELL_SHIFT) * w.size + (w.units.col.x[s] >> CELL_SHIFT)], 0, "on an open cell");
  assert.equal(w.passClass(0) === 0 || w.passGrid(w.passClass(0))[(y + 12) * w.size + x + 13] !== 0, true, "no longer its to walk");
});

test("switched off (OWN_PASS): its own buildings stop its owner as before", switchedOff(OWN_PASS, () => {
  const { g, w, x, y, id } = corridor(BuildingType.House);
  const mine = put(g, 0, UnitType.Spearman, x + 6, y + 12);
  g.fog.update(w);
  cmd(g, 0, { c: "retreat", u: [mine], x: x + 20, y: y + 12 });
  assert.equal(walk(g, mine, id, 300), false, "never in its own house");
  assert.equal(w.passClass(0), 0, "no gate or outpost of its own: the shared grid");
  assert.equal(w.insideOwn(slotOf(g, mine)), false);
}));

/**
 * The watcher (D-154): two hard computers for 15 minutes on random maps; no unit (not hidden, not on a wall) stands in
 * its own building (moves less than 8 a tick: walking through the main city, 4 x 4, takes a farmer up to 6 seconds)
 * more than 2 seconds running.
 */
// core's review: and nobody stays in one more than 15 s running, moving or not (stepping out and back in, the bug the
// test above shows, moved every tick); 15 s is a siege engine's walk across a main city diagonally, with room.
test("D-154 watcher: in computer games nobody stands in its own building more than 2 seconds, nor stays in one 15", () => {
  for (const seed of [3, 11]) {
    const was = new Map<number, number>();
    const g = new Game({ seed, scenario: "standard", map: "random" } as never);
    const w = g.w;
    const ais = [0, 1].map((p) => createAi(p, seed, { map: w.map, rules: rules(w.map), frame: w.map.frames[p], maxTicks: 18000, difficulty: "hard" }, p));
    const still = new Map<number, number>();
    const stay = new Map<number, number>();
    let worst = 0;
    let longest = 0;
    let seq = 0;
    for (let t = 0; t < 15 * 1200 && !w.over; t++) {
      if (g.tick % 10 === 0) {
        for (let p = 0; p < 2; p++) for (const body of ais[p].think(buildView(g, p))) g.push({ ...body, t: g.tick, p, seq: seq++ } as never);
      }
      g.step();
      const u = w.units.col;
      const seen = new Set<number>();
      const staying = new Set<number>();
      for (let i = 0; i < w.units.count; i++) {
        const at = u.x[i] * 65536 + u.y[i];
        const before = was.get(u.id[i]);
        was.set(u.id[i], at);
        if (u.action[i] === Action.Garrisoned || u.wall[i] >= 0 || !w.insideOwn(i)) continue;
        const left = (stay.get(u.id[i]) ?? 0) + 1;
        stay.set(u.id[i], left);
        staying.add(u.id[i]);
        longest = Math.max(longest, left);
        if (before !== undefined && (Math.abs(Math.trunc(before / 65536) - u.x[i]) >= 8 || Math.abs((before % 65536) - u.y[i]) >= 8)) continue;
        const k = (still.get(u.id[i]) ?? 0) + 1;
        still.set(u.id[i], k);
        seen.add(u.id[i]);
        worst = Math.max(worst, k);
      }
      for (const id of still.keys()) if (!seen.has(id)) still.delete(id);
      for (const id of stay.keys()) if (!staying.has(id)) stay.delete(id);
    }
    assert.ok(worst <= 40, `seed ${seed}: one stood in its own building ${worst} ticks running`);
    assert.ok(longest <= 15 * 20, `seed ${seed}: one stayed in its own building ${longest} ticks running`);
  }
});
