// Natural obstacles (R6-51; the user 2026-10-20: 「全部照整張地圖加」, the dense forest as 甲): rock
// heaps and ridges, cliffs and water stop walking and building but not shots or sight; fords and
// bridges are walked as open ground and nobody builds on them; the snapshot tells a player the
// ground it knows, and on a random map nothing of what it has not explored.

import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXED_TERRAIN } from "../src/core/fixed-terrain.ts";
import { Game } from "../src/core/game.ts";
import { generateMap, type GameMap } from "../src/core/map.ts";
import { ATTEMPTS, generateRandomMap, WATER_TRIM } from "../src/core/random-map.ts";
import { BUILDINGS, KEEP } from "../src/core/rules.ts";
import { checkPlacement } from "../src/placement.ts";
import { BuildingType, CELL_SHIFT, crossingTerrain, NodeKind, PlaceBit, Reject, Stance, Terrain, UnitType } from "../src/protocol.ts";
import { buildView, SnapshotEncoder } from "../src/view/view.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOff, switchedOn } from "./helpers.ts";

const TERRAIN_OF: Record<string, number> = { R: Terrain.Blocked, K: Terrain.Cliff, "~": Terrain.Water, f: Terrain.Ford, "|": Terrain.BridgeNS, "=": Terrain.BridgeEW };

function rejections(g: Game, p: number): number[] {
  return g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

test("the fixed map carries war-game-ui's layout: every obstacle cell, every tree added and taken away", () => {
  const m = generateMap();
  const n = m.size;
  const tree = new Set(m.nodes.filter((s) => s.kind === NodeKind.Tree).map((s) => s.cellY * n + s.cellX));
  const node = new Set(m.nodes.map((s) => s.cellY * n + s.cellX));
  const count: Record<string, number> = {};
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const c = FIXED_TERRAIN[y][x];
      count[c] = (count[c] ?? 0) + 1;
      const k = y * n + x;
      if (c in TERRAIN_OF) {
        assert.equal(m.terrain[k], TERRAIN_OF[c], `${x},${y} ${c}`);
        assert.ok(!node.has(k), `${x},${y}: no resource on ${c}`);
      } else if (c === "T") assert.ok(tree.has(k), `${x},${y}: a tree`);
      else if (c === "x") assert.ok(!node.has(k), `${x},${y}: the tree taken away`);
    }
  }
  assert.deepEqual([count.R, count.K, count["~"], count.f, count["|"], count["="], count.T, count.x], [116, 26, 363, 18, 9, 9, 44, 8]);
});

/**
 * Every ford and bridge of a map: 3 cells wide across its way (a bridge's value is its way; a ford
 * goes across the water on its sides), open ground at both ends. Returns how many there are.
 */
function checkCrossings(m: GameMap, label: string): number {
  const n = m.size;
  const seen = new Uint8Array(n * n);
  let blocks = 0;
  const ground = (x: number, y: number) => (x < 0 || y < 0 || x >= n || y >= n ? Terrain.Blocked : m.terrain[y * n + x]);
  for (let k = 0; k < n * n; k++) {
    const t = m.terrain[k];
    if (seen[k] === 1 || (t !== Terrain.Ford && t !== Terrain.BridgeNS && t !== Terrain.BridgeEW)) continue;
    const cells: number[] = [];
    const stack = [k];
    seen[k] = 1;
    while (stack.length > 0) {
      const c = stack.pop()!;
      cells.push(c);
      for (const d of [1, -1, n, -n]) {
        const o = c + d;
        if (o >= 0 && o < n * n && seen[o] === 0 && m.terrain[o] === t && Math.abs((o % n) - (c % n)) <= 1) {
          seen[o] = 1;
          stack.push(o);
        }
      }
    }
    blocks++;
    const xs = cells.map((c) => c % n);
    const ys = cells.map((c) => Math.trunc(c / n));
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const dryNS = [...Array(x1 - x0 + 1).keys()].every((i) => ground(x0 + i, y0 - 1) !== Terrain.Water && ground(x0 + i, y1 + 1) !== Terrain.Water);
    const dryEW = [...Array(y1 - y0 + 1).keys()].every((i) => ground(x0 - 1, y0 + i) !== Terrain.Water && ground(x1 + 1, y0 + i) !== Terrain.Water);
    const ns = t === Terrain.BridgeNS || (t === Terrain.Ford && dryNS && !dryEW);
    const at = `${label}: crossing at ${x0},${y0}`;
    if (t === Terrain.BridgeNS) assert.ok(dryNS, `${at}: a north-south bridge`);
    if (t === Terrain.BridgeEW) assert.ok(dryEW, `${at}: an east-west bridge`);
    assert.equal(ns ? x1 - x0 + 1 : y1 - y0 + 1, 3, `${at}: 3 cells wide`);
    // Every cell of each of its 3 lines is the crossing's own, from bank to bank.
    for (let i = 0; i < 3; i++) {
      const line = cells.filter((c) => (ns ? c % n === x0 + i : Math.trunc(c / n) === y0 + i)).map((c) => (ns ? Math.trunc(c / n) : c % n));
      const lo = Math.min(...line);
      const hi = Math.max(...line);
      assert.equal(line.length, hi - lo + 1, `${at}: line ${i} unbroken`);
      const ends = ns ? [ground(x0 + i, lo - 1), ground(x0 + i, hi + 1)] : [ground(lo - 1, y0 + i), ground(hi + 1, y0 + i)];
      for (const e of ends) assert.equal(e, Terrain.Open, `${at}: open ground at its ends`);
    }
  }
  return blocks;
}

test("fords and bridges: 3 cells wide, across the water, their way from bank to bank", () => {
  assert.equal(checkCrossings(generateMap(), "fixed"), 4, "a bridge and a ford a side");
});

test("random maps (seeds 1-300): crossings 3 wide from bank to bank, water at least 2 wide, cliffs 1 wide; few maps fall back to no obstacles", () => {
  let fallbacks = 0;
  let rivers = 0;
  for (let seed = 1; seed <= 300; seed++) {
    const m = generateRandomMap(seed, 129);
    const n = m.size;
    if (m.redraws >= ATTEMPTS - 1) fallbacks++;
    if (checkCrossings(m, `seed ${seed}`) > 0) rivers++;
    const wet = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && (m.terrain[y * n + x] === Terrain.Water || crossingTerrain(m.terrain[y * n + x]));
    const cliff = (x: number, y: number) => x >= 0 && y >= 0 && x < n && y < n && m.terrain[y * n + x] === Terrain.Cliff;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (m.terrain[y * n + x] === Terrain.Water) {
          const in2x2 = [[0, 0], [-1, 0], [0, -1], [-1, -1]].some(([dx, dy]) => wet(x + dx, y + dy) && wet(x + dx + 1, y + dy) && wet(x + dx, y + dy + 1) && wet(x + dx + 1, y + dy + 1));
          assert.ok(in2x2, `seed ${seed}: water at ${x},${y} at least 2 wide`);
        }
        if (cliff(x, y)) assert.ok(!(cliff(x + 1, y) && cliff(x, y + 1) && cliff(x + 1, y + 1)), `seed ${seed}: a cliff 1 wide at ${x},${y}`);
      }
    }
  }
  assert.ok(rivers >= 150, `a river on most maps (${rivers} of 300)`);
  assert.ok(fallbacks <= 6, `under 2% fall back to no obstacles (${fallbacks})`);
});

/** Random maps 1-300 with and without WATER_TRIM: the cells that differ ("seed:x,y" and the terrains). */
function trimmed(): string[] {
  const out: string[] = [];
  for (let seed = 1; seed <= 300; seed++) {
    const a = generateRandomMap(seed, 129);
    WATER_TRIM.on = false;
    let b: ReturnType<typeof generateRandomMap>;
    try {
      b = generateRandomMap(seed, 129);
    } finally {
      WATER_TRIM.on = true;
    }
    assert.equal(a.size, b.size);
    for (let i = 0; i < a.terrain.length; i++) if (a.terrain[i] !== b.terrain[i]) out.push(`${seed}:${i % a.size},${Math.trunc(i / a.size)}:${b.terrain[i]}->${a.terrain[i]}`);
    assert.deepEqual(a.nodes, b.nodes, `seed ${seed}: the same resources`);
    assert.deepEqual([a.towns, a.spawns, a.tower, a.layout, a.redraws], [b.towns, b.spawns, b.tower, b.layout, b.redraws], `seed ${seed}: the same towns, starts and draws`);
  }
  return out;
}

test("D-100's walls on a river's edge (KEEP on): the water they leave 1 cell wide is ground; nothing else on random maps 1-300 changes", switchedOn(KEEP, () => {
  // Seed 30: the small town at (83, 29) and its mirror image at (29, 83) (ceo 2026-10-29).
  assert.deepEqual(trimmed(), [`30:89,37:${Terrain.Water}->${Terrain.Open}`, `30:37,89:${Terrain.Water}->${Terrain.Open}`]);
}));

test("KEEP off: the water trim changes no random map 1-300 (D-089's castles leave no water 1 cell wide)", switchedOff(KEEP, () => {
  assert.deepEqual(trimmed(), []);
}));

test("a soldier sent across the river walks over the bridge, never in the water", () => {
  const g = emptyGame();
  const w = g.w;
  const n = w.size;
  const id = put(g, 0, UnitType.Spearman, 18, 54);
  g.fog.update(w);
  cmd(g, 0, { c: "move", u: [id], x: 18, y: 64 });
  const u = w.units.col;
  let onBridge = false;
  for (let k = 0; k < 400; k++) {
    g.step();
    const s = slotOf(g, id);
    const t = w.map.terrain[(u.y[s] >> CELL_SHIFT) * n + (u.x[s] >> CELL_SHIFT)];
    assert.notEqual(t, Terrain.Water, `tick ${w.tick}: in the water`);
    if (t === Terrain.BridgeNS) onBridge = true;
  }
  const s = slotOf(g, id);
  assert.ok(onBridge, "over the bridge");
  assert.deepEqual([u.x[s] >> CELL_SHIFT, u.y[s] >> CELL_SHIFT], [18, 64], "on the other bank");
});

test("nothing is built on a ford or a bridge (its own reason); water and cliffs are like rock", () => {
  const g = emptyGame();
  const w = g.w;
  const n = w.size;
  w.ecoOn[0] = 0;
  w.res.set([0, 5000, 5000, 0], 0);
  g.fog.explored[0].fill(1);
  const farmer = put(g, 0, UnitType.Farmer, 18, 54);
  const house = BUILDINGS[BuildingType.House];
  const v = buildView(g, 0);
  const grid = { size: n, cells: v.placement };
  assert.equal(v.placement[59 * n + 18] & (PlaceBit.Crossing | PlaceBit.Blocked), PlaceBit.Crossing, "a bridge cell: a crossing, not blocked");
  assert.equal(v.placement[86 * n + 40] & (PlaceBit.Crossing | PlaceBit.Blocked), PlaceBit.Crossing, "a ford cell");
  assert.equal(checkPlacement(grid, house, 18, 57), Reject.Crossing, "on the bridge's north end");
  assert.equal(checkPlacement(grid, house, 39, 84), Reject.Crossing, "on the ford's corner");
  assert.equal(checkPlacement(grid, house, 15, 58), Reject.BadPlacement, "in the water");
  assert.equal(checkPlacement(grid, house, 21, 55), 0, "on the bank beside the bridge's way");
  cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.House, x: 18, y: 57 });
  cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.House, x: 15, y: 58 });
  run(g, 1);
  assert.deepEqual(rejections(g, 0), [Reject.Crossing, Reject.BadPlacement]);
});

test("water does not stop arrows: an archer on one bank hits a spearman on the other", () => {
  const g = emptyGame();
  const w = g.w;
  // The river west of the bridge: (13-16, 59) is water, banks at y 57 and 61.
  const archer = put(g, 0, UnitType.Ranged, 14, 57);
  const target = put(g, 1, UnitType.Spearman, 14, 61);
  const u = w.units.col;
  u.stance[slotOf(g, target)] = Stance.Hold;
  u.stance[slotOf(g, archer)] = Stance.Hold;
  assert.equal(w.map.terrain[59 * w.size + 14], Terrain.Water);
  g.fog.update(w);
  const hp0 = u.hp[slotOf(g, target)];
  cmd(g, 0, { c: "attack", u: [archer], target });
  run(g, 100);
  assert.ok(slotOf(g, target) < 0 || u.hp[slotOf(g, target)] < hp0, "hit across the water");
  const s = slotOf(g, archer);
  assert.equal(u.y[s] >> CELL_SHIFT, 57, "from its own bank");
});

test("the snapshot's ground: the fixed map whole; on a random map only what was explored, sent with the fog", () => {
  const fixed = new Game({ seed: 1, scenario: "standard" });
  assert.deepEqual(buildView(fixed, 0).terrain, fixed.w.map.terrain);
  const g = new Game({ seed: 3, scenario: "standard", map: "random" });
  const w = g.w;
  const n = w.size;
  const v = buildView(g, 0);
  const exp = g.fog.explored[0];
  let known = 0;
  for (let k = 0; k < n * n; k++) {
    if (exp[k] === 1) {
      assert.equal(v.terrain[k], w.map.terrain[k], `explored ${k % n},${Math.trunc(k / n)}`);
      known++;
    } else assert.equal(v.terrain[k], Terrain.Open, `unexplored ${k % n},${Math.trunc(k / n)}: nothing told`);
  }
  assert.ok(known > 0 && known < n * n);
  // Not all Open beyond the start: the map has other ground the player has not seen.
  let hidden = 0;
  for (let k = 0; k < n * n; k++) if (exp[k] === 0 && w.map.terrain[k] !== Terrain.Open) hidden++;
  assert.ok(hidden > 0, "unexplored ground other than open ground exists, and stays untold");
  const enc = new SnapshotEncoder(w.nodeAmount.length);
  assert.ok(enc.encode(v, []).terrain != null, "with the first fog");
  assert.equal(enc.encode(v, []).terrain, null, "not again until the fog moves on");
});
