// Starting situations, generated entirely by the simulation. Player 1's placements are the
// mirror images (x <-> y) of player 0's, so neither side starts with a better layout.
// "skirmish" is internal (tests and headless benchmarks), not part of the protocol.

import { BuildingType, CELL_SHIFT, NEUTRAL, Resource, type ScenarioName, TownSize, UnitType } from "../protocol.ts";
import { cellsAround, nearestWalkable } from "./paths.ts";
import { BUILDINGS, START, TOWNS, UNITS } from "./rules.ts";
import type { World } from "./world.ts";

export type ScenarioKey = ScenarioName | "skirmish";

/** Which PR brings each protocol scenario (before that, init fails with this message). */
const NOT_YET: Partial<Record<ScenarioKey, string>> = {
  perf: "the perf scenario arrives with PR-4",
};

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
  const missing = NOT_YET[scenario];
  if (missing !== undefined) throw new Error(missing);
  standard(w);
  if (scenario === "skirmish") skirmish(w);
  if (scenario === "e2e") e2e(w);
}

function standard(w: World): void {
  const n = w.size;
  const main = BUILDINGS[BuildingType.MainCity];
  const s0 = w.map.spawns[0];
  const top0 = { x: s0.cellX - 2, y: s0.cellY - 2 };
  w.addBuilding(0, BuildingType.MainCity, top0.x, top0.y, main.hp, 1000);
  w.addBuilding(1, BuildingType.MainCity, top0.y, top0.x, main.hp, 1000);
  // Five farmers on the free cells around player 0's main city nearest the map centre,
  // and the mirror cells for player 1.
  const mid = n >> 1;
  const around = cellsAround(w, top0.x, top0.y, main.size).sort((a, b) => {
    const da = Math.abs((a % n) - mid) + Math.abs(Math.trunc(a / n) - mid);
    const db = Math.abs((b % n) - mid) + Math.abs(Math.trunc(b / n) - mid);
    return da - db || a - b;
  });
  const farmer = UNITS[UnitType.Farmer];
  const cells = around.slice(0, START.farmers);
  for (const c of cells) w.addUnit(0, UnitType.Farmer, center(c % n), center(Math.trunc(c / n)), farmer.hp);
  for (const c of cells) w.addUnit(1, UnitType.Farmer, center(Math.trunc(c / n)), center(c % n), farmer.hp);
  for (let p = 0; p < 2; p++) {
    w.res[p * 4 + Resource.Food] = START.resources.food;
    w.res[p * 4 + Resource.Wood] = START.resources.wood;
    w.res[p * 4 + Resource.Gold] = START.resources.gold;
    w.res[p * 4 + Resource.Crystal] = START.resources.crystal;
  }
  placeTownGuards(w);
}

/** Militia posts: a set closed under x <-> y, so towns on the axis stay symmetric. */
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

export function spawnMilitia(w: World, town: number, count: number): void {
  const militia = UNITS[UnitType.Militia];
  for (let k = 0; k < count && k < POSTS.length; k++) {
    const x = w.townX[town] + POSTS[k][0];
    const y = w.townY[town] + POSTS[k][1];
    const id = w.addUnit(NEUTRAL, UnitType.Militia, center(x), center(y), militia.hp);
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
