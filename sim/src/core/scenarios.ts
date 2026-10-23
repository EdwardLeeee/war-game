// Starting situations, generated entirely by the simulation. Player 1's placements are the
// mirror images of player 0's (x <-> y on the fixed map; through the frames on a random map,
// D-074), so neither side starts with a better layout. "skirmish" is internal (tests and
// headless benchmarks), not part of the protocol. Random maps take "standard" only.

import { type Frame, fromCanon, IDENTITY, toCanon } from "../frame.ts";
import { Action, BuildingType, CELL_SHIFT, NEUTRAL, Order, PLAYER_COUNT, Resource, type ScenarioName, TownSize, UnitFlag, UnitType } from "../protocol.ts";
import { FIXED_POSTS } from "./castle.ts";
import { cellsAround, nearestWalkable } from "./paths.ts";
import { BUILDINGS, GATE, KEEP, OUTPOST, START, TOWNS, UNITS, WALLS } from "./rules.ts";
import type { World } from "./world.ts";

export type ScenarioKey = ScenarioName | "skirmish";

const SCENARIOS: readonly string[] = ["standard", "e2e", "perf", "perf200", "perf360", "skirmish"];

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
  if (scenario === "perf") perf(w, PERF);
  if (scenario === "perf200") perf(w, PERF_200);
  if (scenario === "perf360") perf(w, PERF_360);
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


export function placeTownGuards(w: World): void {
  for (let t = 0; t < w.townSize.length; t++) {
    const rule = TOWNS[w.townSize[t]];
    spawnMilitia(w, t, rule.militia);
    // Closed gates in its walls (D-096).
    if (GATE.on) for (let k = 0; k < w.castles[t].gates.length; k++) w.addGate(t, k);
    // Every town's keep (D-100); before, the big city's tower only.
    if (KEEP.on) addKeep(w, t, NEUTRAL);
    else if (rule.tower && w.townSize[t] === TownSize.Large) {
      const tower = BUILDINGS[BuildingType.Keep];
      const id = w.addBuilding(NEUTRAL, BuildingType.Keep, w.map.tower.cellX, w.map.tower.cellY, tower.hp, 1000);
      w.buildings.col.town[w.building(id)] = t;
    }
  }
}

/** Town t's keep (D-100, KEEP on), built whole for `owner` (NEUTRAL: for its militia) on its centre cell. */
export function addKeep(w: World, t: number, owner: number): void {
  const half = KEEP.size >> 1;
  const id = w.addBuilding(owner, BuildingType.Keep, w.townX[t] - half, w.townY[t] - half, KEEP.hp[w.townSize[t]], 1000);
  w.buildings.col.town[w.building(id)] = t;
}

/** Town t's keep's (or, KEEP off, the big city's tower's) slot, or -1 (fallen, or not built again yet). */
export function keepOf(w: World, t: number): number {
  const b = w.buildings.col;
  for (let s = 0; s < w.buildings.count; s++) if (b.type[s] === BuildingType.Keep && b.town[s] === t) return s;
  return -1;
}

/**
 * By TownSize, the militia (as militia posts, FIXED_POSTS order, read in a player's canonical frame)
 * who stand on the walls instead (D-096, WALLS), straight out from post k to the ring of walls; and
 * the posts of those who stay inside.
 */
const WALL_POSTS = [
  [0, 1, 4],
  [0, 1, 2, 3, 6, 7],
];
const INSIDE_POSTS = [
  [2, 3, 5],
  [4, 5, 8, 9, 10, 11],
];

/**
 * Militia at the town's posts (the nearest open cell if a post has been built over). With walls
 * and gates (D-096), one of every WALLS.militia stands on the walls instead, and the posts are read
 * in a player's frame (mirrorPick), so mirror-image towns get mirror-image militia.
 */
export function spawnMilitia(w: World, town: number, count: number): void {
  const militia = UNITS[UnitType.Militia];
  const posts = w.map.posts ?? FIXED_POSTS;
  const u = w.units.col;
  if (!WALLS.on || !GATE.on) {
    for (let k = 0; k < count && k < posts.length; k++) {
      const c = nearestWalkable(w, w.townX[town] + posts[k][0], w.townY[town] + posts[k][1]);
      const id = w.addUnit(NEUTRAL, UnitType.Militia, center(c % w.size), center(Math.trunc(c / w.size)), militia.hp);
      u.home[w.unit(id)] = town;
    }
    return;
  }
  const up = Math.trunc(count / WALLS.militia);
  const walls = mirrorPick(w, town, up, (f, k) => wallsFor(w, town, f, k));
  const inside = mirrorPick(w, town, count - walls.length, (f, k) => insideFor(w, town, f, k));
  for (const c of inside) {
    const id = w.addUnit(NEUTRAL, UnitType.Militia, center(c % w.size), center(Math.trunc(c / w.size)), militia.hp);
    u.home[w.unit(id)] = town;
  }
  for (const c of walls) {
    const id = w.addUnit(NEUTRAL, UnitType.Militia, center(c % w.size), center(Math.trunc(c / w.size)), militia.hp);
    const s = w.unit(id);
    u.home[s] = town;
    u.wall[s] = c;
    w.wallAt[c] = id;
    u.order[s] = Order.Wall;
    u.orderTarget[s] = town;
    u.action[s] = Action.OnWall;
  }
}

/**
 * `count` cells for town t's militia (D-096) from `pick` (the cells it gives in a frame, best
 * first), mirror images for mirror-image towns: a town nearer one player's main city takes them in
 * that player's canonical frame (its mirror image is nearer the other, and takes the images); a
 * town as near both (on the axis) takes, in pick's order, each cell that is its own image and each
 * other one together with its image, so its militia are their own image too (one fewer when only a
 * pair would fit the last place).
 */
function mirrorPick(w: World, t: number, count: number, pick: (f: Frame, count: number) => number[]): number[] {
  if (count <= 0) return [];
  const n = w.size;
  const f0 = w.map.frames[0] ?? IDENTITY;
  const f1 = w.map.frames[1] ?? IDENTITY;
  const d = (p: number) => {
    const dx = w.homes[p].cellX - w.townX[t];
    const dy = w.homes[p].cellY - w.townY[t];
    return dx * dx + dy * dy;
  };
  const d0 = d(0);
  const d1 = d(1);
  if (d0 !== d1) return pick(d0 < d1 ? f0 : f1, count);
  // On the axis: cell c's image is the cell with the same canonical place in the other frame.
  const image = (c: number) => {
    const k = toCanon(f0, c % n, Math.trunc(c / n));
    const m = fromCanon(f1, k.u, k.v);
    return m.y * n + m.x;
  };
  const out: number[] = [];
  for (const c of pick(f0, 4 * count)) {
    if (out.length >= count || out.includes(c)) continue;
    const m = image(c);
    if (m === c) out.push(c);
    else if (out.length + 2 <= count && !out.includes(m)) out.push(c, m);
  }
  return out;
}

/** Up to `count` cells inside town t for militia, in frame f: the INSIDE_POSTS as canonical offsets, each the nearest open cell to it. */
function insideFor(w: World, t: number, f: Frame, count: number): number[] {
  const at = toCanon(f, w.townX[t], w.townY[t]);
  const out: number[] = [];
  for (const k of INSIDE_POSTS[w.townSize[t]]) {
    if (out.length >= count) break;
    const [pu, pv] = FIXED_POSTS[k];
    const p = fromCanon(f, at.u + pu, at.v + pv);
    const c = nearestWalkable(w, p.x, p.y);
    // A post under a building (the big city's tower): out to the nearest open cell, as before.
    if (c >= 0) out.push(c);
  }
  return out;
}

/**
 * Up to `count` free wall cells of town t, in frame f: for each militia post of WALL_POSTS (as a
 * canonical offset), the free wall cell nearest the point straight out from it on the ring (from
 * the middle of the walls); equally near, the lower canonical u + v, then u. Then any free ones,
 * nearest the first, if more are asked for.
 */
function wallsFor(w: World, t: number, f: Frame, count: number): number[] {
  const n = w.size;
  const c = w.castles[t].inside;
  // The walls' middle and half sides in canonical cells, twice over (a cell's middle is 2u + 1).
  const a = toCanon(f, w.townX[t] + c.x0, w.townY[t] + c.y0);
  const b = toCanon(f, w.townX[t] + c.x1, w.townY[t] + c.y1);
  const cu2 = Math.min(a.u, b.u) + Math.max(a.u, b.u) + 1;
  const cv2 = Math.min(a.v, b.v) + Math.max(a.v, b.v) + 1;
  const hu2 = Math.abs(a.u - b.u) + 2;
  const hv2 = Math.abs(a.v - b.v) + 2;
  const taken: number[] = [];
  const posts = WALL_POSTS[w.townSize[t]];
  for (let k = 0; taken.length < count && k < Math.max(posts.length, count); k++) {
    const [pu, pv] = k < posts.length ? FIXED_POSTS[posts[k]] : FIXED_POSTS[posts[0]];
    const m = Math.max(Math.abs(pu), Math.abs(pv));
    let best = -1;
    let bestD = 0;
    let bestK = 0;
    for (const cell of w.wallCells[t]) {
      if (w.wallAt[cell] >= 0 || taken.includes(cell)) continue;
      const q = toCanon(f, cell % n, Math.trunc(cell / n));
      const du = m * (2 * q.u + 1 - cu2) - pu * hu2;
      const dv = m * (2 * q.v + 1 - cv2) - pv * hv2;
      const dd = du * du + dv * dv;
      const key = (q.u + q.v) * 2 * n + q.u;
      if (best >= 0 && (dd > bestD || (dd === bestD && key >= bestK))) continue;
      best = cell;
      bestD = dd;
      bestK = key;
    }
    if (best < 0) break;
    taken.push(best);
  }
  return taken;
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
  /** Top-left of player 0's army block (`width` wide, spearmen nearest the big city). */
  army: { x: 40, y: 51 },
  width: 10,
  /** Every player's population cap and ceiling, whatever is built (D-083); 0: by the rules. */
  population: 0,
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
 * D-083: perf with both sides full at 200 and at 360 (the random map's most: 200 and all seven
 * towns), farmers and soldiers in about perf's proportions (mages stay at MAGE_CAP), the block
 * 20 wide; the cap and ceiling held at 200 / 360 whatever the population rule says.
 */
export const PERF_200: typeof PERF = { ...PERF, farmers: 70, spearmen: 62, ranged: 62, army: { x: 30, y: 51 }, width: 20, population: 200 };
export const PERF_360: typeof PERF = { ...PERF, farmers: 126, spearmen: 114, ranged: 114, army: { x: 30, y: 51 }, width: 20, population: 360 };

/**
 * perf: both sides at 114 population, the cap 186 (D-083: the main city's 10 and 22 houses of
 * 8; 120 before, houses of 5). 22 houses by each main city; 40 farmers working
 * under the economy ratio; 34 spearmen, 34 ranged and 6 mages on autocast in a block beside
 * the big city, within reach of its militia, its tower and each other, so the battle starts
 * by itself. While OUTPOST is on (D-080), 2 outposts beside the block, each manned by 6 of its
 * spearmen. Fog is on as always. Player 1 gets the mirror image.
 */
function perf(w: World, c: typeof PERF): void {
  const n = w.size;
  w.fixedPopulation = c.population;
  for (let p = 0; p < 2; p++) {
    w.res[p * 4 + Resource.Food] = c.resources.food;
    w.res[p * 4 + Resource.Wood] = c.resources.wood;
    w.res[p * 4 + Resource.Gold] = c.resources.gold;
    w.res[p * 4 + Resource.Crystal] = c.resources.crystal;
  }
  const s0 = w.map.spawns[0];
  const house = BUILDINGS[BuildingType.House];
  for (let k = 0; k < c.houses; k++) {
    const spot = freeSpot(w, house.size, s0.cellX, s0.cellY);
    w.addBuilding(0, BuildingType.House, spot.x, spot.y, house.hp, 1000);
    w.addBuilding(1, BuildingType.House, spot.y, spot.x, house.hp, 1000);
  }
  const outposts: number[] = [];
  if (OUTPOST.on) {
    const post = BUILDINGS[BuildingType.Outpost];
    for (const at of c.outposts) {
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
  const rowOf = c.farmers > 40 ? 10 : 7;
  for (let k = 0; k < c.farmers - START.farmers; k++) both(UnitType.Farmer, s0.cellX + 3 + (k % rowOf), s0.cellY - 6 + Math.trunc(k / rowOf));
  const army: UnitType[] = [];
  for (let k = 0; k < c.spearmen; k++) army.push(UnitType.Spearman);
  for (let k = 0; k < c.ranged; k++) army.push(UnitType.Ranged);
  for (let k = 0; k < c.mages; k++) army.push(UnitType.Mage);
  army.forEach((type, k) => both(type, c.army.x + (k % c.width), c.army.y + Math.trunc(k / c.width)));
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
