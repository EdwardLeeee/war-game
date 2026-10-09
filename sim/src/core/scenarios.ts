// Starting situations, generated entirely by the simulation. Player 1's placements are the
// mirror images of player 0's (x <-> y on the fixed map; through the frames on a random map,
// D-074), so neither side starts with a better layout. "skirmish" is internal (tests and
// headless benchmarks), not part of the protocol. Random maps take "standard" only.

import { IDENTITY, toCanon } from "../frame.ts";
import { BuildingType, CELL_SHIFT, NEUTRAL, Order, PLAYER_COUNT, Resource, type ScenarioName, TownSize, UnitFlag, UnitType } from "../protocol.ts";
import { cellsAround, nearestWalkable } from "./paths.ts";
import { BUILDINGS, OUTPOST, START, TOWNS, UNITS } from "./rules.ts";
import type { World } from "./world.ts";

export type ScenarioKey = ScenarioName | "skirmish";

const SCENARIOS: readonly string[] = ["standard", "e2e", "perf", "skirmish"];

/** e2e: resources per side, and the squad placed beside the small town. */
export const E2E = {
  resources: { food: 2000, wood: 2000, gold: 2000, crystal: 300 },
  spearmen: 6,
  ranged: 4,
  /** Squad centre for player 0 (player 1: mirrored), about 11 cells from the small town. */
  squad: { x: 26, y: 40 },
};

const center = (c: number) => (c << CELL_SHIFT) + 512;

export function setupScenario(w: World, scenario: ScenarioKey): void {
  if (!SCENARIOS.includes(scenario)) throw new Error(`unknown scenario ${String(scenario)}`);
  if (w.map.mode === "random" && scenario !== "standard") throw new Error(`scenario ${scenario} is for the fixed map only`);
  standard(w);
  if (scenario === "skirmish") skirmish(w);
  if (scenario === "e2e") e2e(w);
  if (scenario === "perf") perf(w);
}

function standard(w: World): void {
  const n = w.size;
  const main = BUILDINGS[BuildingType.MainCity];
  const tops = w.map.spawns.map((s) => ({ x: s.cellX - 2, y: s.cellY - 2 }));
  for (let p = 0; p < PLAYER_COUNT; p++) w.addBuilding(p, BuildingType.MainCity, tops[p].x, tops[p].y, main.hp, 1000);
  // Five farmers on the free cells around each main city nearest the map centre; ties go to
  // the lowest canonical cell, so player 1's farmers stand on the mirror cells of player 0's.
  const mid = n >> 1;
  const farmer = UNITS[UnitType.Farmer];
  const cells = tops.map((top, p) => {
    const f = w.map.frames[p] ?? IDENTITY;
    const key = (c: number) => {
      const k = toCanon(f, c % n, Math.trunc(c / n));
      return k.v * n + k.u;
    };
    return cellsAround(w, top.x, top.y, main.size)
      .sort((a, b) => {
        const da = Math.abs((a % n) - mid) + Math.abs(Math.trunc(a / n) - mid);
        const db = Math.abs((b % n) - mid) + Math.abs(Math.trunc(b / n) - mid);
        return da - db || key(a) - key(b);
      })
      .slice(0, START.farmers);
  });
  for (let p = 0; p < PLAYER_COUNT; p++) {
    for (const c of cells[p]) w.addUnit(p, UnitType.Farmer, center(c % n), center(Math.trunc(c / n)), farmer.hp);
  }
  for (let p = 0; p < 2; p++) {
    w.res[p * 4 + Resource.Food] = START.resources.food;
    w.res[p * 4 + Resource.Wood] = START.resources.wood;
    w.res[p * 4 + Resource.Gold] = START.resources.gold;
    w.res[p * 4 + Resource.Crystal] = START.resources.crystal;
  }
  placeTownGuards(w);
}

/** Militia posts on the fixed map: a set closed under x <-> y, so towns on the axis stay symmetric (random maps: GameMap.posts). */
const POSTS = [
  [2, 0], [0, 2], [-2, 0], [0, -2], [2, 2], [-2, -2],
  [2, -2], [-2, 2], [3, 0], [0, 3], [-3, 0], [0, -3],
];

export function placeTownGuards(w: World): void {
  for (let t = 0; t < w.townSize.length; t++) {
    const rule = TOWNS[w.townSize[t]];
    spawnMilitia(w, t, rule.militia);
    if (rule.tower && w.townSize[t] === TownSize.Large) {
      const tower = BUILDINGS[BuildingType.TownTower];
      const id = w.addBuilding(NEUTRAL, BuildingType.TownTower, w.map.tower.cellX, w.map.tower.cellY, tower.hp, 1000);
      w.buildings.col.town[w.building(id)] = t;
    }
  }
}

/** Militia at the town's posts (the nearest open cell if a post has been built over). */
export function spawnMilitia(w: World, town: number, count: number): void {
  const militia = UNITS[UnitType.Militia];
  const posts = w.map.posts ?? POSTS;
  for (let k = 0; k < count && k < posts.length; k++) {
    const c = nearestWalkable(w, w.townX[town] + posts[k][0], w.townY[town] + posts[k][1]);
    const id = w.addUnit(NEUTRAL, UnitType.Militia, center(c % w.size), center(Math.trunc(c / w.size)), militia.hp);
    w.units.col.home[w.unit(id)] = town;
  }
}

/** Internal: each side also gets 30 spearmen and 20 ranged, in a block toward the centre. */
function skirmish(w: World): void {
  const s0 = w.map.spawns[0];
  const place = (p: number, type: UnitType, k: number) => {
    // A 10-wide block starting 7 cells from player 0's spawn toward the centre.
    // The map is mirror-symmetric, so the mirror of a walkable cell is walkable too.
    const c = nearestWalkable(w, s0.cellX + 4 + (k % 10), s0.cellY - 7 - Math.trunc(k / 10));
    const x = c % w.size;
    const y = Math.trunc(c / w.size);
    const [cx, cy] = p === 0 ? [x, y] : [y, x];
    w.addUnit(p, type, center(cx), center(cy), UNITS[type].hp);
  };
  for (let p = 0; p < 2; p++) {
    for (let k = 0; k < 30; k++) place(p, UnitType.Spearman, k);
    for (let k = 30; k < 50; k++) place(p, UnitType.Ranged, k);
  }
}

/**
 * e2e (PROTOCOL.md section 8): plenty of resources, two finished houses and a barracks by
 * each main city (population cap 20, so training works at once), and a squad of 6 spearmen
 * and 4 ranged about 11 cells from the small town, outside the militia's reach, so the
 * test and not the simulation starts the fight. Player 1 gets the mirror image.
 */
function e2e(w: World): void {
  for (let p = 0; p < 2; p++) {
    w.res[p * 4 + Resource.Food] = E2E.resources.food;
    w.res[p * 4 + Resource.Wood] = E2E.resources.wood;
    w.res[p * 4 + Resource.Gold] = E2E.resources.gold;
    w.res[p * 4 + Resource.Crystal] = E2E.resources.crystal;
  }
  const s0 = w.map.spawns[0];
  for (const type of [BuildingType.House, BuildingType.House, BuildingType.Barracks]) {
    const info = BUILDINGS[type];
    const spot = freeSpot(w, info.size, s0.cellX, s0.cellY);
    w.addBuilding(0, type, spot.x, spot.y, info.hp, 1000);
    w.addBuilding(1, type, spot.y, spot.x, info.hp, 1000);
  }
  const squad: UnitType[] = [];
  for (let k = 0; k < E2E.spearmen; k++) squad.push(UnitType.Spearman);
  for (let k = 0; k < E2E.ranged; k++) squad.push(UnitType.Ranged);
  squad.forEach((type, k) => {
    const c = nearestWalkable(w, E2E.squad.x - 2 + (k % 5), E2E.squad.y + Math.trunc(k / 5));
    const x = c % w.size;
    const y = Math.trunc(c / w.size);
    w.addUnit(0, type, center(x), center(y), UNITS[type].hp);
    w.addUnit(1, type, center(y), center(x), UNITS[type].hp);
  });
}

/**
 * The first free size x size spot (with a free one-cell ring around it) in rings of growing
 * Chebyshev distance from (cx, cy); inside a ring, row by row. Player 0's side of the map.
 */
function freeSpot(w: World, size: number, cx: number, cy: number): { x: number; y: number } {
  const n = w.size;
  const free = (x: number, y: number) => w.walkable(x, y) && w.buildingAt[y * n + x] < 0;
  for (let r = 1; r < n; r++) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r) continue;
        if (x - 1 < 0 || y - 1 < 0 || x + size >= n || y + size >= n || x >= y) continue;
        let ok = true;
        for (let yy = y - 1; yy <= y + size && ok; yy++) for (let xx = x - 1; xx <= x + size && ok; xx++) ok = free(xx, yy);
        if (ok) return { x, y };
      }
    }
  }
  throw new Error("e2e: no free spot");
}

/** perf: every system running, for the iPhone measurement (PROTOCOL.md section 8). */
export const PERF = {
  resources: { food: 3000, wood: 3000, gold: 3000, crystal: 500 },
  houses: 22,
  farmers: 40,
  spearmen: 34,
  ranged: 34,
  mages: 6,
  /** Top-left of player 0's army block (10 wide, spearmen nearest the big city). */
  army: { x: 40, y: 51 },
  /**
   * D-080, while OUTPOST is on: player 0's outposts, beside its block (each at the nearest free
   * spot), each manned by OUTPOST.slots of its spearmen, attacking.
   */
  outposts: [
    { x: 36, y: 50 },
    { x: 51, y: 59 },
  ],
};

/**
 * perf: both sides at 114 / 120 population. 22 houses by each main city; 40 farmers working
 * under the economy ratio; 34 spearmen, 34 ranged and 6 mages on autocast in a block beside
 * the big city, within reach of its militia, its tower and each other, so the battle starts
 * by itself. While OUTPOST is on (D-080), 2 outposts beside the block, each manned by 6 of its
 * spearmen. Fog is on as always. Player 1 gets the mirror image.
 */
function perf(w: World): void {
  const n = w.size;
  for (let p = 0; p < 2; p++) {
    w.res[p * 4 + Resource.Food] = PERF.resources.food;
    w.res[p * 4 + Resource.Wood] = PERF.resources.wood;
    w.res[p * 4 + Resource.Gold] = PERF.resources.gold;
    w.res[p * 4 + Resource.Crystal] = PERF.resources.crystal;
  }
  const s0 = w.map.spawns[0];
  const house = BUILDINGS[BuildingType.House];
  for (let k = 0; k < PERF.houses; k++) {
    const spot = freeSpot(w, house.size, s0.cellX, s0.cellY);
    w.addBuilding(0, BuildingType.House, spot.x, spot.y, house.hp, 1000);
    w.addBuilding(1, BuildingType.House, spot.y, spot.x, house.hp, 1000);
  }
  const outposts: number[] = [];
  if (OUTPOST.on) {
    const post = BUILDINGS[BuildingType.Outpost];
    for (const at of PERF.outposts) {
      const spot = freeSpot(w, post.size, at.x, at.y);
      outposts.push(w.addBuilding(0, BuildingType.Outpost, spot.x, spot.y, post.hp, 1000));
      outposts.push(w.addBuilding(1, BuildingType.Outpost, spot.y, spot.x, post.hp, 1000));
    }
  }
  const both = (type: UnitType, x: number, y: number): number => {
    const c = nearestWalkable(w, x, y);
    const cx = c % n;
    const cy = Math.trunc(c / n);
    w.addUnit(0, type, center(cx), center(cy), UNITS[type].hp);
    const id1 = w.addUnit(1, type, center(cy), center(cx), UNITS[type].hp);
    return id1;
  };
  // Farmers beside the base (the start's five are already there).
  for (let k = 0; k < PERF.farmers - START.farmers; k++) both(UnitType.Farmer, s0.cellX + 3 + (k % 7), s0.cellY - 6 + Math.trunc(k / 7));
  const army: UnitType[] = [];
  for (let k = 0; k < PERF.spearmen; k++) army.push(UnitType.Spearman);
  for (let k = 0; k < PERF.ranged; k++) army.push(UnitType.Ranged);
  for (let k = 0; k < PERF.mages; k++) army.push(UnitType.Mage);
  army.forEach((type, k) => both(type, PERF.army.x + (k % 10), PERF.army.y + Math.trunc(k / 10)));
  const u = w.units.col;
  for (let s = 0; s < w.units.count; s++) if (u.type[s] === UnitType.Mage) u.flags[s] |= UnitFlag.Autocast;
  // The outposts' guards: each side's spearmen in id order, as a post command would set them.
  for (const id of outposts) {
    const owner = w.buildings.col.owner[w.building(id)];
    let k = 0;
    for (let s = 0; s < w.units.count && k < OUTPOST.slots; s++) {
      if (u.owner[s] !== owner || u.type[s] !== UnitType.Spearman || u.order[s] === Order.Post) continue;
      u.order[s] = Order.Post;
      u.orderTarget[s] = id;
      u.target[s] = -1;
      u.group[s] = -1;
      u.squad[s] = 0;
      k++;
    }
  }
}
