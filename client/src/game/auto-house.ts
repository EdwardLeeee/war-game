// 自動蓋民居 (the user 2026-10-25: 「人口快滿時自動蓋民居」; two hard games were lost stuck at the
// population cap with resources unspent, replays d64475c4 and 3026f06e): when the population is
// nearly full, the screen sends one gathering villager to build a house near the main city, as
// 自動訓練 sends its trains (an auto command, kept in the game's log). Pure: Game gathers what it
// sees and sends the order.

import { BuildingType, checkPlacement, type Cost, PlaceBit, type PlacementGrid } from "../sim.ts";

/** How near the main city's footprint an enemy soldier is 家裡被攻擊 (cells, Chebyshev; the hud's warning too). */
export const HOME_CELLS = 12;
/** A house goes this far from the main city, centre to centre (cells). */
export const HOUSE_NEAR = 4;
export const HOUSE_FAR = 10;

/**
 * A house sent and neither in a snapshot nor refused after this long (ticks, 30 s) is taken for
 * lost: the screen decides again. A page behind its snapshots (WebKit at the start of a game) sees
 * the simulation take an order 40 steps and more after it was sent.
 */
export const HOUSE_SENT_TICKS = 600;
/** The first house sent in a game (ceo 2026-10-25). */
export const AUTO_HOUSE_TEXT = "人口快滿，自動蓋一間民居";
/** 自動訓練 stopped for a full population while 自動蓋民居 waits for wood: said instead of 「蓋民居」. */
export const HOUSE_WOOD_TEXT = "人口快滿，木頭不夠蓋民居";

/** Why no house is sent now (null: one is): in this order. */
export type HouseBlock = "off" | "room" | "ceiling" | "building" | "home" | "wood" | "farmer" | "spot";

/** A footprint in cells: top-left and size. */
export interface Footprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface HouseNeed {
  on: boolean;
  /** Population room: the cap less the living and those in training. */
  room: number;
  /** What a house adds to the cap (Rules: 8 with D-083's 200). */
  houseCap: number;
  cap: number;
  /** The highest the cap can be now, the towns' share included (HeaderField.populationCeiling). */
  ceiling: number;
  /** A house of ours not finished yet, or one sent and not in a snapshot yet. */
  unfinished: boolean;
  /** An enemy soldier within HOME_CELLS of the main city. */
  enemyNear: boolean;
  /** What we have, the reserve left out of it: a house comes first (nothing trains while the population is full). */
  have: Cost;
  cost: Cost;
}

/** Whether a house is wanted and can be paid for now; null when it is (a villager and a spot still to find). */
export function houseBlock(n: HouseNeed): HouseBlock | null {
  if (!n.on) return "off";
  if (n.room > n.houseCap) return "room";
  if (n.cap >= n.ceiling) return "ceiling";
  if (n.unfinished) return "building";
  if (n.enemyNear) return "home";
  const c = n.cost;
  const h = n.have;
  if (h.food < c.food || h.wood < c.wood || h.gold < c.gold || h.crystal < c.crystal) return "wood";
  return null;
}

/** Is cell point (x, y) within `cells` of the footprint (Chebyshev)? */
export function nearFootprint(f: Footprint, x: number, y: number, cells: number): boolean {
  return Math.max(f.x - x, 0, x - (f.x + f.w)) <= cells && Math.max(f.y - y, 0, y - (f.y + f.h)) <= cells;
}

export interface Gatherer {
  id: number;
  /** Cells. */
  x: number;
  y: number;
}

/** The villager to send: the gatherer nearest the main city's centre (the lower id on a tie); null with none. */
export function pickBuilder(gatherers: readonly Gatherer[], city: Footprint): number | null {
  const cx = city.x + city.w / 2;
  const cy = city.y + city.h / 2;
  let best: Gatherer | null = null;
  let bestD = Infinity;
  for (const g of gatherers) {
    const d = (g.x - cx) ** 2 + (g.y - cy) ** 2;
    if (d < bestD || (d === bestD && best !== null && g.id < best.id)) {
      best = g;
      bestD = d;
    }
  }
  return best?.id ?? null;
}

/** A town's ground no house goes on: its castle's cells (walls included), or its circle with no castle. */
export type TownGround = { x0: number; y0: number; x1: number; y1: number } | { cx: number; cy: number; r: number };

export interface SpotWorld {
  grid: PlacementGrid;
  /** Every known building's footprint, whoever's. */
  buildings: readonly Footprint[];
  towns: readonly TownGround[];
  /** Is there a resource node on this cell? */
  node(cell: number): boolean;
  /** Top-left cells (y * size + x) refused before: not tried again. */
  skip: ReadonlySet<number>;
}

function inTown(t: TownGround, x: number, y: number): boolean {
  if ("r" in t) return (x + 0.5 - t.cx) ** 2 + (y + 0.5 - t.cy) ** 2 <= t.r * t.r;
  return x >= t.x0 && x <= t.x1 && y >= t.y0 && y <= t.y1;
}

/**
 * Where the house goes: an empty spot HOUSE_NEAR–HOUSE_FAR cells from the main city (centre to
 * centre), on the side away from the map's centre first, the nearer first. One clear cell all
 * round it from every building (farms too) and from castle walls and gates' lanes, so it closes
 * no way; not in a town, not on a resource node. A spot with a tree, a rock or a node beside it
 * comes after every spot without. Null when there is none.
 */
export function houseSpot(world: SpotWorld, city: Footprint, size: number, mapCentre: { x: number; y: number }): { x: number; y: number } | null {
  const n = world.grid.size;
  const cells = world.grid.cells;
  const ccx = city.x + city.w / 2;
  const ccy = city.y + city.h / 2;
  // Away from the centre: the direction from the map's centre to the main city.
  const ax = ccx - mapCentre.x;
  const ay = ccy - mapCentre.y;
  const al = Math.hypot(ax, ay);
  const taken = new Uint8Array(n * n);
  for (const b of world.buildings) {
    for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) if (x >= 0 && y >= 0 && x < n && y < n) taken[y * n + x] = 1;
  }
  let best: { x: number; y: number; score: number } | null = null;
  const reach = Math.ceil(HOUSE_FAR + size);
  for (let y = Math.floor(ccy) - reach; y <= Math.ceil(ccy) + reach; y++) {
    for (let x = Math.floor(ccx) - reach; x <= Math.ceil(ccx) + reach; x++) {
      const dx = x + size / 2 - ccx;
      const dy = y + size / 2 - ccy;
      const d = Math.hypot(dx, dy);
      if (d < HOUSE_NEAR || d > HOUSE_FAR) continue;
      if (x < 1 || y < 1 || x + size + 1 > n || y + size + 1 > n) continue;
      if (world.skip.has(y * n + x)) continue;
      if (checkPlacement(world.grid, { type: BuildingType.House, size }, x, y) !== 0) continue;
      let ok = true;
      let beside = false;
      for (let cy = y - 1; ok && cy <= y + size; cy++) {
        for (let cx = x - 1; cx <= x + size; cx++) {
          const c = cy * n + cx;
          const inside = cx >= x && cx < x + size && cy >= y && cy < y + size;
          if (taken[c] === 1 || (cells[c] & (PlaceBit.Wall | PlaceBit.GateLane)) !== 0 || (inside && (world.node(c) || world.towns.some((t) => inTown(t, cx, cy))))) {
            ok = false;
            break;
          }
          if (!inside && ((cells[c] & PlaceBit.Blocked) !== 0 || world.node(c))) beside = true;
        }
      }
      if (!ok) continue;
      const away = al < 1 ? 0 : (dx * ax + dy * ay) / (d * al);
      const score = away - 0.05 * d - (beside ? 4 : 0);
      if (best === null || score > best.score + 1e-9) best = { x, y, score };
    }
  }
  return best === null ? null : { x: best.x, y: best.y };
}
