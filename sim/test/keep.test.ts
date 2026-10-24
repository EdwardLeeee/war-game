// Towns about 1.5 x bigger with a keep in each (D-100, the user 2026-10-23: 「把城鎮的範圍做更大一點，然後
// 裡面也可以有一個主堡可以點，把這個主堡打下來跟殺完駐守的殘兵拿下了」; ceo: every keep shoots, the small
// town's too). All behind KEEP (off: the castles and the big city's tower of D-089, as before).

import assert from "node:assert/strict";
import { test } from "node:test";
import { Game } from "../src/core/game.ts";
import { generateMap, type GameMap } from "../src/core/map.ts";
import { generateRandomMap } from "../src/core/random-map.ts";
import { BUILDINGS, KEEP, rules, TOWNS } from "../src/core/rules.ts";
import { keepOf, spawnMilitia } from "../src/core/scenarios.ts";
import { toCanon } from "../src/frame.ts";
import { BuildingType, inTown, NEUTRAL, PlaceBit, Reject, Resource, Terrain, TownChoice, TownSize, TownState, UnitType, walkableTerrain } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
import { cmd, emptyGame, put, run, slotOf, switchedOn } from "./helpers.ts";

const keepOn = (body: () => void) => switchedOn(KEEP, body);

/** The small town (0) of an empty game (no militia), its centre, its keep's slot; the economy off. */
function smallTown() {
  const g = emptyGame();
  g.w.ecoOn[0] = 0;
  g.w.ecoOn[1] = 0;
  const t = 0;
  assert.equal(g.w.townSize[t], TownSize.Small);
  return { g, t, x: g.w.townX[t], y: g.w.townY[t] };
}

/** A soldier of p's in town t's square, `dx` cells east of its keep's edge (it does not die). */
function inside(g: Game, p: number, t: number, dx = 0, type: UnitType = UnitType.Spearman): number {
  const id = put(g, p, type, g.w.townX[t] + 2 + dx, g.w.townY[t]);
  g.w.units.col.hp[slotOf(g, id)] = 100000;
  return id;
}

function rejects(g: Game, p = 0): number[] {
  g.step();
  return g.events.filter((e) => e.to === p && e.ev.k === "rejected").map((e) => (e.ev as { reason: number }).reason);
}

test("KEEP off: the rules, the castles and the big city's tower are D-089's", () => {
  const r = rules();
  assert.equal(r.features.keep, undefined);
  assert.equal(r.towns[TownSize.Small].keep, undefined);
  assert.deepEqual(r.towns[TownSize.Small].castle!.inside, { x0: -4, y0: -4, x1: 4, y1: 4 });
  assert.deepEqual([BUILDINGS[BuildingType.Keep].size, BUILDINGS[BuildingType.Keep].hp, r.arrows.townTower.damage], [2, 400, 6]);
  assert.deepEqual([TOWNS[TownSize.Small].radius, TOWNS[TownSize.Large].radius], [5, 7]);
  assert.equal(BuildingType.TownTower, BuildingType.Keep, "the old name, one version");
});

test("KEEP on: the castles 13 x 13 and 17 x 17, centred; a 3 x 3 keep in each town, 600 / 4 and 1000 / 10", keepOn(() => {
  const r = rules();
  assert.equal(r.features.keep, true);
  const small = r.towns[TownSize.Small];
  const large = r.towns[TownSize.Large];
  assert.deepEqual(small.castle!.inside, { x0: -6, y0: -6, x1: 6, y1: 6 });
  assert.deepEqual(large.castle!.inside, { x0: -8, y0: -8, x1: 8, y1: 8 });
  assert.deepEqual([small.castle!.wall.length, small.castle!.gate.length, small.castle!.gates!.length], [44, 12, 4]);
  assert.deepEqual([large.castle!.wall.length, large.castle!.gate.length, large.castle!.gates!.length], [64, 12, 4]);
  assert.deepEqual([small.radius, large.radius], [7, 9]);
  assert.deepEqual([small.keep!.hp, small.keep!.size, small.keep!.arrow.damage], [600, 3, 4]);
  assert.deepEqual([large.keep!.hp, large.keep!.size, large.keep!.arrow.damage], [1000, 3, 10]);
  assert.equal(small.keep!.rebuildTicks, 60 * 20);
  assert.deepEqual([r.buildings[BuildingType.Keep].size, r.buildings[BuildingType.Keep].hp, r.buildings[BuildingType.Keep].holds], [3, 1000, 0]);
  assert.equal(r.arrows.townTower.damage, 10);
  // The keep's cells are not a militia post, and every post is inside the walls.
  for (const c of [small.castle!, large.castle!]) {
    for (const [x, y] of c.militia) {
      assert.ok(Math.max(Math.abs(x), Math.abs(y)) >= 2, `post ${x},${y} off the keep`);
      assert.ok(inTown(c, 0, 0, x, y));
    }
  }
  // Every town of the fixed map has its keep, the militia's, on its centre cell, whole.
  const g = new Game({ seed: 1, scenario: "standard" });
  const w = g.w;
  const b = w.buildings.col;
  for (let t = 0; t < w.townSize.length; t++) {
    const s = keepOf(w, t);
    assert.ok(s >= 0, `town ${t}`);
    assert.deepEqual([b.owner[s], b.cellX[s], b.cellY[s], b.hp[s], w.maxHp(s), b.progress[s]], [NEUTRAL, w.townX[t] - 1, w.townY[t] - 1, KEEP.hp[w.townSize[t]], KEEP.hp[w.townSize[t]], 1000]);
  }
}));

/** Walks from cells over open ground (octile 10 / 14, no corner cutting), as castle.test.ts measures. */
function walks(map: GameMap, from: number[], open: number[]): Int32Array {
  const n = map.size;
  const blocked = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) if (!walkableTerrain(map.terrain[i])) blocked[i] = 1;
  for (const s of map.nodes) blocked[s.cellY * n + s.cellX] = 1;
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
        const nd = d + (dx !== 0 && dy !== 0 ? 14 : 10);
        if (nd < dist[ny * n + nx]) {
          dist[ny * n + nx] = nd;
          (buckets[nd] ??= []).push(ny * n + nx);
        }
      }
    }
  }
  return dist;
}

/** The walls where rules say, the gates open ground, and the walks (D-089's caps) from player 0's main city. */
function walksOf(map: GameMap, label: string): { mainMain: number; town: number } {
  const n = map.size;
  const r = rules(map);
  for (const t of map.towns) {
    const c = r.towns[t.size].castle!;
    for (const [dx, dy] of c.wall) assert.equal(map.terrain[(t.cellY + dy) * n + t.cellX + dx], Terrain.Wall, `${label} town ${t.id} wall ${dx},${dy}`);
    for (const [dx, dy] of [...c.gate, ...c.outside]) assert.equal(map.terrain[(t.cellY + dy) * n + t.cellX + dx], Terrain.Open, `${label} town ${t.id} gate ${dx},${dy}`);
  }
  const [s0, s1] = [0, 1].map((p) => map.spawns.find((s) => s.player === p)!);
  const fp = (s: { cellX: number; cellY: number }) => {
    const o: number[] = [];
    for (let y = s.cellY - 2; y < s.cellY + 2; y++) for (let x = s.cellX - 2; x < s.cellX + 2; x++) o.push(y * n + x);
    return o;
  };
  const d = walks(map, [s0.cellY * n + s0.cellX], [...fp(s0), ...fp(s1)]);
  const ratio = (x: number, y: number) => {
    const ax = Math.abs(x - s0.cellX);
    const ay = Math.abs(y - s0.cellY);
    return d[y * n + x] / (Math.max(ax, ay) * 10 + Math.min(ax, ay) * 4);
  };
  const mainMain = ratio(s1.cellX, s1.cellY);
  const town = Math.max(...map.towns.map((t) => ratio(t.cellX, t.cellY)));
  assert.ok(mainMain <= 1.4, `${label}: main city to main city ${mainMain.toFixed(3)}`);
  assert.ok(town <= 1.6, `${label}: main city to a town ${town.toFixed(3)}`);
  return { mainMain, town };
}

test("KEEP on, the fixed map: the towns where they were, the walls where rules say, walks within D-089's caps and 1.10 or more between the main cities", keepOn(() => {
  const m = generateMap();
  assert.deepEqual(m.towns.map((t) => [t.cellX, t.cellY, t.radius]), [[29, 29, 7], [48, 48, 9], [14, 14, 7], [81, 81, 7]]);
  assert.deepEqual([m.tower, m.towerSize], [{ cellX: 47, cellY: 47 }, 3]);
  const { mainMain } = walksOf(m, "fixed");
  assert.ok(mainMain >= 1.1, `main city to main city ${mainMain.toFixed(3)}`);
}));

test("KEEP on, random maps 1-40: walls where rules say and mirror images, keeps on the centre cells, walks within the caps", keepOn(() => {
  for (let seed = 1; seed <= 40; seed++) {
    const map = generateRandomMap(seed, 129);
    walksOf(map, `seed ${seed}`);
    const n = map.size;
    for (let k = 0; k < n * n; k++) {
      if (map.terrain[k] !== Terrain.Wall) continue;
      const m = toCanon(map.mirror, k % n, Math.trunc(k / n));
      assert.equal(map.terrain[m.v * n + m.u], Terrain.Wall, `seed ${seed}: wall ${k % n},${Math.trunc(k / n)}`);
    }
    const large = map.towns.find((t) => t.size === TownSize.Large)!;
    assert.deepEqual([map.tower, map.towerSize], [{ cellX: large.cellX - 1, cellY: large.cellY - 1 }, 3], `seed ${seed}`);
  }
}));

test("KEEP on: a town falls only once its keep has fallen too; the keep shoots the soldiers in it for the militia", keepOn(() => {
  const { g, t, x, y } = smallTown();
  const w = g.w;
  const k = keepOf(w, t);
  const a = put(g, 0, UnitType.Spearman, x + 2, y);
  const hp0 = w.units.col.hp[slotOf(g, a)];
  run(g, 60);
  assert.equal(w.townState[t], TownState.Neutral, "no militia, but the keep stands");
  assert.ok(w.units.col.hp[slotOf(g, a)] < hp0, "the keep shot the spearman");
  // It dies without a target given: the spearman beside it hits it by himself (an enemy building).
  w.units.col.hp[slotOf(g, a)] = 100000;
  w.buildings.col.hp[k] = 1;
  run(g, 60);
  assert.equal(keepOf(w, t), -1, "fallen");
  assert.equal(w.townState[t], TownState.AwaitingChoice);
  assert.equal(w.townOwner[t], 0);
}));

test("KEEP on: governed, the keep is built again for the governor and shoots for him; the town falls to the other only with it down", keepOn(() => {
  const { g, t } = smallTown();
  const w = g.w;
  w.buildings.col.hp[keepOf(w, t)] = 0;
  inside(g, 0, t);
  run(g, 3);
  assert.equal(w.townState[t], TownState.AwaitingChoice);
  w.res[Resource.Wood] = 500;
  w.res[Resource.Gold] = 500;
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Govern });
  run(g, TOWNS[TownSize.Small].repairTicks + 5);
  assert.equal(w.townState[t], TownState.Governed);
  const k = keepOf(w, t);
  assert.ok(k >= 0, "built again when repaired");
  assert.deepEqual([w.buildings.col.owner[k], w.buildings.col.hp[k]], [0, KEEP.hp[TownSize.Small]]);
  // Player 1 comes in and player 0's soldier dies: with the keep standing, the town stays player 0's,
  // and the keep shoots the newcomer.
  const e = inside(g, 1, t, 1);
  w.units.col.hp[slotOf(g, e)] = 300;
  for (let s = 0; s < w.units.count; s++) if (w.units.col.owner[s] === 0) w.units.col.hp[s] = 0;
  run(g, 3);
  assert.equal(w.townOwner[t], 0, "the keep stands");
  run(g, 40);
  assert.ok(w.units.col.hp[slotOf(g, e)] < 300, "the governor's keep shot player 1's soldier");
  w.units.col.hp[slotOf(g, e)] = 100000;
  w.buildings.col.hp[keepOf(w, t)] = 0;
  run(g, 3);
  assert.deepEqual([w.townState[t], w.townOwner[t]], [TownState.AwaitingChoice, 1]);
}));

test("KEEP on: a governed town's fallen keep stands again after 60 s with no enemy inside; an enemy inside starts the count over", keepOn(() => {
  const { g, t } = smallTown();
  const w = g.w;
  w.buildings.col.hp[keepOf(w, t)] = 0;
  inside(g, 0, t);
  run(g, 3);
  w.res[Resource.Wood] = 500;
  w.res[Resource.Gold] = 500;
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Govern });
  run(g, TOWNS[TownSize.Small].repairTicks + 5);
  // Its keep falls while player 0's soldier is still inside: no capture.
  w.buildings.col.hp[keepOf(w, t)] = 0;
  run(g, 2);
  assert.equal(keepOf(w, t), -1);
  assert.equal(w.townState[t], TownState.Governed);
  // An enemy steps in for a while (both inside: contested), then leaves: the count starts over.
  run(g, KEEP.rebuildTicks - 100);
  assert.equal(keepOf(w, t), -1);
  const e = inside(g, 1, t, 2);
  run(g, 5);
  w.units.col.hp[slotOf(g, e)] = 0;
  run(g, KEEP.rebuildTicks - 10);
  assert.equal(keepOf(w, t), -1, "the count started over");
  run(g, 20);
  const k = keepOf(w, t);
  assert.ok(k >= 0, "built again");
  assert.deepEqual([w.buildings.col.owner[k], w.buildings.col.hp[k]], [0, KEEP.hp[TownSize.Small]]);
}));

test("KEEP on: a revolt hands the keep to the militia, whole; ruins turning neutral build it for them", keepOn(() => {
  const { g, t } = smallTown();
  const w = g.w;
  w.buildings.col.hp[keepOf(w, t)] = 0;
  const own = inside(g, 0, t);
  run(g, 3);
  w.res[Resource.Wood] = 500;
  w.res[Resource.Gold] = 500;
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Govern });
  run(g, TOWNS[TownSize.Small].repairTicks + 5);
  const k = keepOf(w, t);
  w.buildings.col.hp[k] = 100;
  w.units.col.hp[slotOf(g, own)] = 0;
  run(g, TOWNS[TownSize.Small].revoltTicks + 5);
  assert.equal(w.townState[t], TownState.Neutral);
  const after = keepOf(w, t);
  assert.deepEqual([w.buildings.col.owner[after], w.buildings.col.hp[after]], [NEUTRAL, KEEP.hp[TownSize.Small]]);
  // Plundered: no keep while ruins; neutral again, the militia's keep stands.
  for (let s = 0; s < w.units.count; s++) if (w.units.col.owner[s] === NEUTRAL) w.units.col.hp[s] = 0;
  w.buildings.col.hp[after] = 0;
  inside(g, 0, t);
  run(g, 3);
  assert.equal(w.townState[t], TownState.AwaitingChoice);
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Plunder });
  run(g, TOWNS[TownSize.Small].plunderTicks + 5);
  assert.equal(w.townState[t], TownState.Ruins);
  assert.equal(keepOf(w, t), -1);
  for (let s = 0; s < w.units.count; s++) if (w.units.col.owner[s] === 0) w.units.col.hp[s] = 0;
  run(g, TOWNS[TownSize.Small].ruinsTicks + 5);
  assert.equal(w.townState[t], TownState.Neutral);
  const again = keepOf(w, t);
  assert.ok(again >= 0);
  assert.deepEqual([w.buildings.col.owner[again], w.buildings.col.hp[again]], [NEUTRAL, KEEP.hp[TownSize.Small]]);
}));

test("KEEP on: the keep holds no one, nobody builds one, and its owner's farmers repair it", keepOn(() => {
  const { g, t, x, y } = smallTown();
  const w = g.w;
  w.buildings.col.hp[keepOf(w, t)] = 0;
  inside(g, 0, t);
  run(g, 3);
  w.res[Resource.Wood] = 500;
  w.res[Resource.Gold] = 500;
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Govern });
  run(g, TOWNS[TownSize.Small].repairTicks + 5);
  const k = keepOf(w, t);
  const id = w.buildings.col.id[k];
  const archer = inside(g, 0, t, 1, UnitType.Ranged);
  cmd(g, 0, { c: "garrison", u: [archer], building: id });
  assert.notDeepEqual(rejects(g), [], "the keep holds no one");
  cmd(g, 0, { c: "build", u: [archer], type: BuildingType.Keep, x: x + 3, y: y + 3 });
  assert.deepEqual(rejects(g), [Reject.NotAvailable]);
  w.buildings.col.hp[k] = 100;
  const farmer = put(g, 0, UnitType.Farmer, x + 2, y + 1);
  cmd(g, 0, { c: "repair", u: [farmer], building: id });
  run(g, 400);
  assert.ok(w.buildings.col.hp[keepOf(w, t)] > 100, "repaired");
}));

test("KEEP on: nobody builds on a keep's ground while it is down, and whoever stands there steps aside when it stands again", keepOn(() => {
  const { g, t, x, y } = smallTown();
  const w = g.w;
  w.buildings.col.hp[keepOf(w, t)] = 0;
  inside(g, 0, t);
  run(g, 3);
  w.res[Resource.Wood] = 2000;
  w.res[Resource.Gold] = 2000;
  cmd(g, 0, { c: "town_choice", town: t, choice: TownChoice.Govern });
  // While it repairs, a farmer stands on the keep's ground and a tower is asked for there.
  const farmer = put(g, 0, UnitType.Farmer, x, y);
  cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.ArrowTower, x: x - 1, y: y - 1 });
  assert.deepEqual(rejects(g), [Reject.BadPlacement], "the keep's ground");
  const v = buildView(g, 0);
  assert.notEqual(v.placement[y * w.size + x] & PlaceBit.Blocked, 0, "the screen sees it blocked");
  // Off the ground, a tower inside the town is fine (once its cells are explored).
  run(g, 20);
  cmd(g, 0, { c: "build", u: [farmer], type: BuildingType.ArrowTower, x: x + 3, y: y + 3 });
  assert.deepEqual(rejects(g), []);
  const f = slotOf(g, farmer);
  w.units.col.x[f] = (x << 10) + 512;
  w.units.col.y[f] = (y << 10) + 512;
  w.units.col.order[f] = 0;
  run(g, TOWNS[TownSize.Small].repairTicks + 5);
  assert.ok(keepOf(w, t) >= 0);
  const cx = w.units.col.x[slotOf(g, farmer)] >> 10;
  const cy = w.units.col.y[slotOf(g, farmer)] >> 10;
  assert.ok(Math.max(Math.abs(cx - x), Math.abs(cy - y)) >= 2, `farmer at ${cx - x},${cy - y} off the keep`);
}));

test("KEEP on: the keep fallen, the 2 militia left on the walls come down and fight it out, so soldiers in the middle take the town within 30 s (the stuck town, war-game-ai 2026-10-24)", keepOn(() => {
  const { g, t, x, y } = smallTown();
  const w = g.w;
  spawnMilitia(w, t, TOWNS[TownSize.Small].militia);
  const u = w.units.col;
  // Only 2 of those on the walls stand; the keep falls.
  let onWalls = 0;
  for (let s = 0; s < w.units.count; s++) {
    if (u.owner[s] !== NEUTRAL) continue;
    if (u.wall[s] >= 0 && onWalls < 2) onWalls++;
    else u.hp[s] = 0;
  }
  assert.equal(onWalls, 2, "2 militia on the walls");
  w.buildings.col.hp[keepOf(w, t)] = 0;
  for (let k = 0; k < 3; k++) put(g, 0, UnitType.Spearman, x + 2, y + k - 1);
  let fell = -1;
  for (let k = 0; k < 600 && fell < 0; k++) {
    g.step();
    if (w.townState[t] === TownState.AwaitingChoice) fell = k;
  }
  assert.ok(fell >= 0, "taken within 600 ticks");
  assert.equal(w.townOwner[t], 0);
}));
