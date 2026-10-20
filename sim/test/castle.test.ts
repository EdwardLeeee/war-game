// Castles round the towns (D-089, the user 2026-10-19: 「希望像一個城堡」): walls are terrain that
// nobody walks through, gates are open to everyone, the town is what lies inside the walls, arrow
// towers may go inside and up to 2 cells outside them, nothing is built on a gate's lane (ceo
// 2026-10-20), a way blocked all the same is broken through by its blocker (D-024) and never by a
// wall, and every map stays walkable, fair and not too round-about.

import assert from "node:assert/strict";
import { test } from "node:test";
import { castleOf } from "../src/core/castle.ts";
import { towerLand } from "../src/core/commands.ts";
import { Game } from "../src/core/game.ts";
import { generateMap, type GameMap } from "../src/core/map.ts";
import { generateRandomMap } from "../src/core/random-map.ts";
import { BUILDINGS, rules, TOWER_REACH } from "../src/core/rules.ts";
import { toCanon } from "../src/frame.ts";
import { checkPlacement } from "../src/placement.ts";
import { BuildingType, CELL_SHIFT, inTown, PlaceBit, Reject, Stance, Terrain, TOWN_STRIDE, TownField, TownFlag, TownSize, TownState, UnitType, walkableTerrain } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, put, run, slotOf } from "./helpers.ts";

/** Town 0 on the fixed map: the small town at (29, 29). */
const T = 0;

test("rules give each castle: the small town 9 x 9 inside, the big city 12 x 12, 13 x 13 with a 3 x 3 tower", () => {
  const r = rules();
  const small = r.towns[TownSize.Small].castle!;
  const large = r.towns[TownSize.Large].castle!;
  assert.deepEqual(small.inside, { x0: -4, y0: -4, x1: 4, y1: 4 });
  assert.deepEqual([small.wall.length, small.corner.length, small.gate.length, small.outside.length, small.behind.length], [28, 4, 12, 12, 12]);
  assert.deepEqual(large.inside, { x0: -6, y0: -6, x1: 5, y1: 5 });
  assert.deepEqual([large.wall.length, large.corner.length, large.gate.length], [48, 16, 8]);
  assert.equal(small.towerLand, TOWER_REACH.town + 1);
  assert.equal(small.militia.length, 6);
  assert.equal(large.militia.length, 12);
  const large3 = castleOf(TownSize.Large, { tower: { cellX: 9, cellY: 9 }, towerSize: 3, towns: [{ size: TownSize.Large, cellX: 10, cellY: 10 }] });
  assert.deepEqual(large3.inside, { x0: -6, y0: -6, x1: 6, y1: 6 });
  assert.deepEqual([large3.wall.length, large3.gate.length], [48, 12]);
  // Every militia post is inside the walls and not on the tower.
  for (const c of [small, large]) for (const [x, y] of c.militia) assert.ok(inTown(c, 0, 0, x, y), `post ${x},${y}`);
});

test("on the fixed map walls are terrain nobody walks; gates and the cell before each are open", () => {
  const g = new Game({ seed: 1, scenario: "standard" });
  const w = g.w;
  const n = w.size;
  const r = rules(w.map);
  w.map.towns.forEach((t, i) => {
    const c = r.towns[t.size].castle!;
    assert.deepEqual(c.inside, w.castles[i].inside);
    for (const [dx, dy] of c.wall) {
      assert.equal(w.map.terrain[(t.cellY + dy) * n + t.cellX + dx], Terrain.Wall);
      assert.equal(w.walkable(t.cellX + dx, t.cellY + dy), false);
    }
    for (const [dx, dy] of [...c.gate, ...c.outside]) assert.ok(w.walkable(t.cellX + dx, t.cellY + dy), `town ${i}: ${dx},${dy} open`);
  });
  // Placement: the walls are Blocked and Wall, the gates Gate.
  const v = buildView(g, 0);
  const t = w.map.towns[T];
  const c = r.towns[TownSize.Small].castle!;
  const at = ([dx, dy]: [number, number]) => v.placement[(t.cellY + dy) * n + t.cellX + dx];
  for (const cell of c.wall) assert.equal(at(cell) & (PlaceBit.Blocked | PlaceBit.Wall), PlaceBit.Blocked | PlaceBit.Wall);
  for (const cell of c.gate) assert.equal(at(cell) & (PlaceBit.Blocked | PlaceBit.Gate), PlaceBit.Gate);
  // The lane through each gate: the gate, the cell in front of it and the first cell behind it.
  for (const cell of [...c.gate, ...c.outside, ...c.behind]) assert.equal(at(cell) & (PlaceBit.Blocked | PlaceBit.GateLane), PlaceBit.GateLane);
  for (const [dx, dy] of c.behind) assert.ok(inTown(c, 0, 0, dx, dy), `${dx},${dy} behind a gate is inside`);
  for (const [dx, dy] of c.outside) assert.ok(!inTown(c, 0, 0, dx, dy), `${dx},${dy} in front of a gate is outside`);
});

test("seeing a town is seeing any of its castle: a farmer just outside the wall finds it, one 7 cells out does not, and it stays known", () => {
  const g = emptyGame();
  const w = g.w;
  const t = w.map.towns[T];
  const known = () => {
    const v = buildView(g, 0);
    for (let r = 0; r < v.towns.length; r += TOWN_STRIDE) if (v.towns[r + TownField.id] === T) return (v.towns[r + TownField.flags] & TownFlag.Visible) !== 0 ? "in sight" : "remembered";
    return "unknown";
  };
  // The north wall is 5 cells from the centre, as far as a farmer sees: from outside it the centre
  // is out of sight.
  put(g, 0, UnitType.Farmer, t.cellX, t.cellY - 12);
  g.fog.update(w);
  assert.equal(known(), "unknown", "7 cells off the wall");
  const near = put(g, 0, UnitType.Farmer, t.cellX, t.cellY - 6);
  g.fog.update(w);
  assert.equal(known(), "in sight", "a cell outside the wall");
  const u = w.units.col;
  u.y[slotOf(g, near)] = (t.cellY - 12) << CELL_SHIFT;
  g.fog.update(w);
  assert.equal(known(), "remembered", "and remembered once out of sight");
});

test("walls stop walking: a soldier sent to a town's centre from beside its corner goes in by a gate", () => {
  const g = emptyGame();
  const w = g.w;
  const n = w.size;
  const t = w.map.towns[T];
  const c = w.castles[T];
  const id = put(g, 0, UnitType.Spearman, t.cellX + 7, t.cellY + 7);
  g.fog.update(w);
  cmd(g, 0, { c: "move", u: [id], x: t.cellX, y: t.cellY });
  const u = w.units.col;
  const gates = new Set(c.gate.map(([dx, dy]) => (t.cellY + dy) * n + t.cellX + dx));
  let throughGate = false;
  for (let k = 0; k < 600; k++) {
    g.step();
    const s = slotOf(g, id);
    const cell = (u.y[s] >> CELL_SHIFT) * n + (u.x[s] >> CELL_SHIFT);
    assert.notEqual(w.map.terrain[cell], Terrain.Wall, `tick ${w.tick}: on a wall`);
    if (gates.has(cell)) throughGate = true;
  }
  const s = slotOf(g, id);
  assert.ok(w.inTown(T, u.x[s] >> CELL_SHIFT, u.y[s] >> CELL_SHIFT), "inside");
  assert.ok(throughGate, "by a gate");
});

test("a town is what lies inside its walls: a soldier in front of a gate does not take it, one inside does", () => {
  const g = emptyGame();
  const w = g.w;
  const t = w.map.towns[T];
  const c = w.castles[T];
  const [ox, oy] = c.outside[0];
  const id = put(g, 0, UnitType.Spearman, t.cellX + ox, t.cellY + oy);
  w.units.col.stance[slotOf(g, id)] = Stance.Hold;
  g.fog.update(w);
  run(g, 60);
  assert.equal(w.townState[T], TownState.Neutral, "outside the walls: nobody there");
  // Inside, in a corner of the square: farther from the centre than the old circle (radius 5) reached.
  const inX = t.cellX + c.inside.x1;
  const inY = t.cellY + c.inside.y1;
  assert.ok(w.inTown(T, inX, inY));
  put(g, 0, UnitType.Spearman, inX, inY);
  run(g, 5);
  assert.equal(w.townState[T], TownState.AwaitingChoice, "inside: taken");
  assert.equal(w.townOwner[T], 0);
});

test("arrow towers may go inside a held town's walls and up to 2 cells outside them, not 3", () => {
  const g = emptyGame();
  const w = g.w;
  const t = w.map.towns[T];
  const c = w.castles[T];
  w.townOwner[T] = 0;
  w.townState[T] = TownState.Governed;
  const y = t.cellY;
  assert.equal(towerLand(w, 0, t.cellX + 1, y), true, "inside");
  assert.equal(towerLand(w, 0, t.cellX + c.inside.x1 + 1 + TOWER_REACH.town, y), true, "2 cells outside the wall");
  assert.equal(towerLand(w, 0, t.cellX + c.inside.x1 + 2 + TOWER_REACH.town, y), false, "3 cells outside");
  const corner = 1 + TOWER_REACH.town;
  assert.equal(towerLand(w, 0, t.cellX + c.inside.x1 + corner, t.cellY + c.inside.y1 + corner), true, "2 cells outside the castle's corner (a square, not a circle)");
  assert.equal(towerLand(w, 1, t.cellX + 1, y), false, "not the other player's");
  const v = buildView(g, 0);
  assert.ok((v.placement[y * w.size + t.cellX + c.inside.x1 + 1 + TOWER_REACH.town] & PlaceBit.TowerLand) !== 0);
  assert.equal(v.placement[y * w.size + t.cellX + c.inside.x1 + 2 + TOWER_REACH.town] & PlaceBit.TowerLand, 0);
});

test("nothing is built on a gate's lane: on the gate, in front of it or right behind it; one cell to the side is fine", () => {
  const g = emptyGame();
  const w = g.w;
  const n = w.size;
  const t = w.map.towns[T];
  w.townOwner[T] = 0;
  w.townState[T] = TownState.Governed;
  w.ecoOn[0] = 0;
  w.res.set([0, 5000, 5000, 0], 0);
  g.fog.explored[0].fill(1);
  const farmer = put(g, 0, UnitType.Farmer, t.cellX, t.cellY);
  // The north gate is (-1..1, -5): in front of it (-1..1, -6), behind it (-1..1, -4); the south
  // gate is (-1..1, 5). Houses and arrow towers are 2 x 2; the towers stand on tower land.
  const lane: [string, number, number][] = [
    ["on the gate", -1, -5],
    ["in front of the gate", -1, -7],
    ["right behind the gate", 0, -4],
  ];
  const side: [string, BuildingType, number, number][] = [
    ["a house beside the cells behind the gate", BuildingType.House, 2, -4],
    ["a house beside the cells in front of the gate", BuildingType.House, 2, -7],
    ["an arrow tower beside the cells behind the south gate", BuildingType.ArrowTower, 2, 3],
    ["an arrow tower beside the cells in front of the south gate", BuildingType.ArrowTower, 2, 6],
  ];
  const v = buildView(g, 0);
  const grid = { size: n, cells: v.placement };
  for (const [name, type] of [["house", BuildingType.House], ["arrow tower", BuildingType.ArrowTower]] as const) {
    for (const [what, dx, dy] of lane) {
      assert.equal(checkPlacement(grid, BUILDINGS[type], t.cellX + dx, t.cellY + dy), Reject.GateLane, `screen: a ${name} ${what}`);
      cmd(g, 0, { c: "build", u: [farmer], type, x: t.cellX + dx, y: t.cellY + dy });
    }
  }
  for (const [what, type, dx, dy] of side) assert.equal(checkPlacement(grid, BUILDINGS[type], t.cellX + dx, t.cellY + dy), 0, `screen: ${what}`);
  const before = w.buildings.count;
  run(g, 1);
  assert.deepEqual(rejections(g, 0), Array(6).fill(Reject.GateLane), "the simulation rejects all six");
  assert.equal(w.buildings.count, before);
  for (const [, type, dx, dy] of side) cmd(g, 0, { c: "build", u: [farmer], type, x: t.cellX + dx, y: t.cellY + dy });
  run(g, 1);
  assert.deepEqual(rejections(g, 0), [], "and takes the four beside them");
  assert.equal(w.buildings.count, before + 4);
});

test("a way into a town blocked by the enemy's buildings all the same: a soldier sent at what is inside breaks through a blocker, never a wall (D-024)", () => {
  const g = emptyGame();
  const w = g.w;
  const n = w.size;
  const t = w.map.towns[T];
  // Off the lanes, a barracks and two houses before each gate keep it from the field (the gate is
  // 3 wide; no corner cutting past the wall): the barracks covers the 3 cells two before the gate,
  // the houses the cells beside the lane's front.
  const north: [BuildingType, number, number][] = [
    [BuildingType.Barracks, -1, -9],
    [BuildingType.House, -3, -7],
    [BuildingType.House, 2, -7],
  ];
  // The small castle is its own image under every turn: the other three gates turn the north's.
  const turns = [
    (x: number, y: number) => [x, y],
    (x: number, y: number, s: number) => [x, -y - s + 1],
    (x: number, y: number) => [y, x],
    (x: number, y: number, s: number) => [-y - s + 1, x],
  ];
  const blockers: number[] = [];
  for (const turn of turns) {
    for (const [type, dx, dy] of north) {
      const size = BUILDINGS[type].size;
      const [x, y] = turn(dx, dy, size);
      for (let yy = t.cellY + y; yy < t.cellY + y + size; yy++) {
        for (let xx = t.cellX + x; xx < t.cellX + x + size; xx++) {
          assert.equal(w.gateLane[yy * n + xx], 0, `${xx},${yy}: off the lanes`);
          assert.ok(w.walkable(xx, yy), `${xx},${yy}: open ground`);
        }
      }
      blockers.push(w.addBuilding(1, type, t.cellX + x, t.cellY + y, BUILDINGS[type].hp, 1000));
    }
  }
  const inside = put(g, 1, UnitType.Spearman, t.cellX, t.cellY);
  const iu = w.units.col;
  iu.hp[slotOf(g, inside)] = 100000;
  iu.stance[slotOf(g, inside)] = Stance.Hold;
  const attacker = put(g, 0, UnitType.Spearman, t.cellX, t.cellY - 12);
  iu.hp[slotOf(g, attacker)] = 100000;
  g.fog.update(w);
  cmd(g, 0, { c: "attack", u: [attacker], target: inside });
  let hit = -1;
  for (let k = 0; k < 400 && hit < 0; k++) {
    g.step();
    const tid = iu.target[slotOf(g, attacker)];
    if (tid >= 0 && w.building(tid) >= 0) hit = tid;
  }
  assert.ok(blockers.includes(hit), `breaks through a blocker (${hit})`);
  const b = w.buildings.col;
  const hp0 = b.hp[w.building(hit)];
  run(g, 100);
  assert.ok(w.building(hit) < 0 || b.hp[w.building(hit)] < hp0, "and hits it");
});

function rejections(g: Game, p: number): number[] {
  return g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

/** Walks (octile, 10 / 14, no corner cutting) from every cell of `from` over a map's open cells. */
function walks(map: GameMap, from: number[], open: Set<number>): Int32Array {
  const n = map.size;
  const blocked = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) if (!walkableTerrain(map.terrain[i])) blocked[i] = 1;
  for (const s of map.nodes) blocked[s.cellY * n + s.cellX] = 1;
  for (const s of map.spawns) for (let y = s.cellY - 2; y < s.cellY + 2; y++) for (let x = s.cellX - 2; x < s.cellX + 2; x++) blocked[y * n + x] = 1;
  const ts = map.towerSize ?? 2;
  for (let y = map.tower.cellY; y < map.tower.cellY + ts; y++) for (let x = map.tower.cellX; x < map.tower.cellX + ts; x++) blocked[y * n + x] = 1;
  for (const k of open) blocked[k] = 0;
  const dist = new Int32Array(n * n).fill(1 << 30);
  const buckets: number[][] = [];
  for (const k of from) dist[k] = 0;
  buckets[0] = [...from];
  for (let d = 0; d < buckets.length; d++) {
    for (const k of buckets[d] ?? []) {
      if (dist[k] !== d) continue;
      const x = k % n;
      const y = (k - x) / n;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n || blocked[ny * n + nx]) continue;
        if (dx !== 0 && dy !== 0 && (blocked[y * n + nx] || blocked[ny * n + x])) continue;
        const nk = ny * n + nx;
        const nd = d + (dx !== 0 && dy !== 0 ? 14 : 10);
        if (nd < dist[nk]) {
          dist[nk] = nd;
          (buckets[nd] ??= []).push(nk);
        }
      }
    }
  }
  return dist;
}

const footprint = (n: number, s: { cellX: number; cellY: number }) => {
  const out: number[] = [];
  for (let y = s.cellY - 2; y < s.cellY + 2; y++) for (let x = s.cellX - 2; x < s.cellX + 2; x++) out.push(y * n + x);
  return out;
};

/**
 * Every check of a map: castles where rules say, gates and the cells before them open, every open
 * cell reachable from both main cities (nothing walled off), walks to the other main city and to
 * every town no longer than D-089's caps, and both sides as far from their nearest small town.
 */
function checkMap(map: GameMap, label: string): { mainMain: number; town: number } {
  const n = map.size;
  const r = rules(map);
  const ts = map.towerSize ?? 2;
  const towerCells: number[] = [];
  for (let y = map.tower.cellY; y < map.tower.cellY + ts; y++) for (let x = map.tower.cellX; x < map.tower.cellX + ts; x++) towerCells.push(y * n + x);
  const nodeAt = new Set(map.nodes.map((s) => s.cellY * n + s.cellX));
  for (const t of map.towns) {
    const c = r.towns[t.size].castle!;
    for (const [dx, dy] of c.wall) assert.equal(map.terrain[(t.cellY + dy) * n + t.cellX + dx], Terrain.Wall, `${label} town ${t.id} wall ${dx},${dy}`);
    for (const [dx, dy] of [...c.gate, ...c.outside]) {
      const k = (t.cellY + dy) * n + t.cellX + dx;
      assert.ok(map.terrain[k] === Terrain.Open && !nodeAt.has(k), `${label} town ${t.id} gate ${dx},${dy} open`);
    }
  }
  const [s0, s1] = [0, 1].map((p) => map.spawns.find((s) => s.player === p)!);
  const open = new Set([...footprint(n, s0), ...footprint(n, s1), ...towerCells]);
  const d0 = walks(map, footprint(n, s0), open);
  const d1 = walks(map, footprint(n, s1), open);
  // Nothing walled off: every walkable, node-free cell (fords and bridges too) is reachable from
  // both main cities.
  for (let k = 0; k < n * n; k++) {
    if (!walkableTerrain(map.terrain[k]) || nodeAt.has(k)) continue;
    assert.ok(d0[k] < 1 << 30 && d1[k] < 1 << 30, `${label}: cell ${k % n},${Math.trunc(k / n)} cut off`);
  }
  // Walks from the main city's centre cell, against the walk with nothing in the way.
  const fromCentre = walks(map, [s0.cellY * n + s0.cellX], open);
  const ratio = (x: number, y: number) => {
    const ax = Math.abs(x - s0.cellX);
    const ay = Math.abs(y - s0.cellY);
    return fromCentre[y * n + x] / (Math.max(ax, ay) * 10 + Math.min(ax, ay) * 4);
  };
  const mainMain = ratio(s1.cellX, s1.cellY);
  const town = Math.max(...map.towns.map((t) => ratio(t.cellX, t.cellY)));
  assert.ok(mainMain <= 1.4, `${label}: main city to main city ${mainMain.toFixed(3)}`);
  assert.ok(town <= 1.6, `${label}: main city to a town ${town.toFixed(3)}`);
  // Both sides as far from their nearest small town (from the whole footprint: a mirror-image start).
  const nearest = (d: Int32Array) => Math.min(...map.towns.filter((t) => t.size === TownSize.Small).map((t) => d[t.cellY * n + t.cellX]));
  assert.equal(nearest(d0), nearest(d1), `${label}: nearest small town`);
  return { mainMain, town };
}

test("the fixed map: castles, nothing walled off, walks within the caps, fair; its obstacles make the way between the main cities at least 1.10 times the open walk", () => {
  const { mainMain } = checkMap(generateMap(), "fixed");
  assert.ok(mainMain >= 1.1, `main city to main city ${mainMain.toFixed(3)}`);
});

test("random maps (seeds 1-300): castles, nothing walled off, walks within the caps, fair; castles are mirror images", () => {
  for (let seed = 1; seed <= 300; seed++) {
    const map = generateRandomMap(seed, 129);
    checkMap(map, `seed ${seed} ${map.layout}`);
    // Each wall cell's mirror image is a wall cell too.
    const n = map.size;
    for (let k = 0; k < n * n; k++) {
      if (map.terrain[k] !== Terrain.Wall) continue;
      const m = toCanon(map.mirror, k % n, Math.trunc(k / n));
      assert.equal(map.terrain[m.v * n + m.u], Terrain.Wall, `seed ${seed}: wall ${k % n},${Math.trunc(k / n)}`);
    }
  }
});

test("the big city's castle follows its tower on a turned random map: rules, the world and the terrain agree", () => {
  let seed = 1;
  let map = generateRandomMap(seed, 129);
  const offset = (m: GameMap) => {
    const l = m.towns.find((t) => t.size === TownSize.Large)!;
    return [m.tower.cellX - l.cellX, m.tower.cellY - l.cellY];
  };
  while (!(map.layout === "diagonal" && offset(map)[0] === 0 && offset(map)[1] === 0)) map = generateRandomMap(++seed, 129);
  const g = new Game({ seed, scenario: "standard", map: "random" });
  const w = g.w;
  const n = w.size;
  const li = w.map.towns.findIndex((t) => t.size === TownSize.Large);
  const t = w.map.towns[li];
  const c = rules(w.map).towns[TownSize.Large].castle!;
  assert.deepEqual(c.inside, { x0: -5, y0: -5, x1: 6, y1: 6 }, "shifted with the tower");
  assert.deepEqual(c.inside, w.castles[li].inside);
  for (const [dx, dy] of c.wall) assert.equal(w.map.terrain[(t.cellY + dy) * n + t.cellX + dx], Terrain.Wall);
  for (let y = t.cellY - 9; y <= t.cellY + 9; y++) {
    for (let x = t.cellX - 9; x <= t.cellX + 9; x++) assert.equal(inTown(c, t.cellX, t.cellY, x, y), w.inTown(li, x, y));
  }
  // A player who has not explored it sees no wall or gate there.
  const v = buildView(g, 0);
  for (const [dx, dy] of [...c.wall, ...c.gate]) {
    const k = (t.cellY + dy) * n + t.cellX + dx;
    if ((v.placement[k] & PlaceBit.Unexplored) === 0) continue;
    assert.equal(v.placement[k] & (PlaceBit.Wall | PlaceBit.Gate | PlaceBit.Blocked), 0, `unexplored ${dx},${dy}`);
  }
});
