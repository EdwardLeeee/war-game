// What the screen knows about the game: the static data from `ready`, the last two
// snapshots (for interpolation), the resource-node table rebuilt from the snapshots'
// change rows, the latest fog and placement grids, and the player's selection. Answers the
// questions the intent rules ask (input/intent.ts). Never writes simulation state.
//
// Towns and rocks are what the player knows of them (D-074): on the fixed map all of them from
// `ready`; on a random map only those explored, learnt from the snapshots' town rows and from
// the placement grid, and kept once known.

import type { IntentWorld, Pick } from "../input/intent.ts";
import {
  Action,
  BuildingField as B,
  BUILDING_STRIDE,
  BuildingFlag,
  BuildingType,
  CELL,
  HeaderField as H,
  type MapInfo,
  NO_OWNER,
  NODE_STRIDE,
  NodeField as N,
  PlaceBit,
  type PlacementGrid,
  type Rules,
  type Snapshot,
  TICKS_PER_SECOND,
  TOWN_STRIDE,
  TownField as T,
  TownFlag,
  TownSize,
  TownState,
  Terrain,
  UNIT_STRIDE,
  UnitField as U,
  UnitFlag,
} from "../sim.ts";
import { features } from "../game/features.ts";
import { TILE_PX } from "../tuning.ts";

/** World px per fixed-point unit. */
export const FIXED_TO_PX = TILE_PX / CELL;

/** A town's place on the map, as MapInfo.towns has it. */
export type TownSpot = MapInfo["towns"][number];

export interface Frame {
  snap: Snapshot;
  /** performance.now() when it arrived. */
  at: number;
}

export class GameView implements IntentWorld {
  readonly me: number;
  readonly map: MapInfo;
  readonly rules: Rules;
  prev: Frame | null = null;
  curr: Frame | null = null;
  /** Resource nodes by id: [id, kind, cellX, cellY, amount, visible]. */
  readonly nodes = new Map<number, Int32Array>();
  /** Node id per cell (amount > 0), or -1. */
  readonly nodeAt: Int32Array;
  /** Bumped whenever the node table changes, so the renderer can skip unchanged frames. */
  nodesVersion = 0;
  fog: Uint8Array | null = null;
  fogVersion = 0;
  placement: PlacementGrid | null = null;
  /** Towns the player knows of, by id (D-074: on a random map, those explored). */
  readonly knownTowns = new Map<number, TownSpot>();
  /** Bumped when a town becomes known. */
  townsVersion = 0;
  /** 1 per cell known to be rock (D-074: on a random map, the explored ones). */
  readonly rocks: Uint8Array;
  /** Bumped when a rock becomes known. */
  rocksVersion = 0;
  /** learnRocks' cells under a known building, kept between snapshots (it runs on each one). */
  private built: Uint8Array | null = null;
  selection: { units: number[]; building: number | null } = { units: [], building: null };
  /** A foreign unit, building, node or town the player tapped with nothing of theirs selected. */
  inspected: Pick | null = null;
  /** Is this world point on screen? Set by the game from the camera. */
  onScreen: (wx: number, wy: number) => boolean = () => true;

  constructor(player: number, map: MapInfo, rules: Rules) {
    this.me = player;
    this.map = map;
    this.rules = rules;
    this.nodeAt = new Int32Array(map.size * map.size).fill(-1);
    this.rocks = new Uint8Array(map.size * map.size);
    for (const town of map.towns) this.knownTowns.set(town.id, town);
    // On a random map the terrain is all open ground: rocks come with exploration (learnRocks).
    if (!this.randomMap) for (let i = 0; i < this.rocks.length; i++) this.rocks[i] = map.terrain[i] === Terrain.Blocked ? 1 : 0;
  }

  /** A random map (D-074): towns, rocks and the enemy come into view only once explored. */
  get randomMap(): boolean {
    return this.map.mode === "random";
  }

  /** Every town the player knows of, by id. */
  townList(): TownSpot[] {
    return [...this.knownTowns.values()].sort((a, b) => a.id - b.id);
  }

  push(snap: Snapshot, at: number): void {
    this.prev = this.curr;
    this.curr = { snap, at };
    const size = this.map.size;
    const rows = snap.nodes;
    for (let o = 0; o < rows.length; o += NODE_STRIDE) {
      const row = rows.slice(o, o + NODE_STRIDE);
      const id = row[N.id];
      const old = this.nodes.get(id);
      if (old !== undefined) this.nodeAt[old[N.cellY] * size + old[N.cellX]] = -1;
      this.nodes.set(id, row);
      if (row[N.amount] > 0) this.nodeAt[row[N.cellY] * size + row[N.cellX]] = id;
      // A node's cell taken for rock before its row came (random map): it is not rock.
      if (this.rocks[row[N.cellY] * size + row[N.cellX]] === 1) {
        this.rocks[row[N.cellY] * size + row[N.cellX]] = 0;
        this.rocksVersion++;
      }
    }
    if (rows.length > 0) this.nodesVersion++;
    if (snap.fog !== null) {
      this.fog = snap.fog;
      this.fogVersion++;
    }
    if (snap.placement !== null) this.placement = { size, cells: snap.placement };
    this.learnTowns(snap.towns);
    if (this.randomMap && snap.placement !== null) this.learnRocks(snap);
    this.pruneSelection();
  }

  /** Towns explored (D-074): each row carries its place; the radius is the rules' for its size. */
  private learnTowns(t: Int32Array): void {
    for (let o = 0; o < t.length; o += TOWN_STRIDE) {
      const id = t[o + T.id];
      if (this.knownTowns.has(id)) continue;
      const size = t[o + T.size] as TownSize;
      const radius = this.rules.towns?.[size]?.radius ?? (size === TownSize.Large ? 6 : 4);
      this.knownTowns.set(id, { id, size, cellX: t[o + T.cellX], cellY: t[o + T.cellY], radius });
      this.townsVersion++;
    }
  }

  /**
   * Rocks explored on a random map (D-074): the placement grid blocks a cell for a rock, a
   * resource node or a known building; what is neither of the other two is rock. Kept once known
   * (rocks never move).
   */
  private learnRocks(snap: Snapshot): void {
    const size = this.map.size;
    const cells = snap.placement;
    if (cells === null) return;
    if (this.built === null) this.built = new Uint8Array(size * size);
    const built = this.built;
    built.fill(0);
    const b = snap.buildings;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      const s = this.rules.buildings[b[o + B.type]]?.size ?? 1;
      for (let y = b[o + B.cellY]; y < b[o + B.cellY] + s; y++) {
        for (let x = b[o + B.cellX]; x < b[o + B.cellX] + s; x++) if (x >= 0 && y >= 0 && x < size && y < size) built[y * size + x] = 1;
      }
    }
    let changed = false;
    for (let i = 0; i < cells.length; i++) {
      // A building's cells taken for rock before its row came: they are not rock.
      if (built[i] === 1 && this.rocks[i] === 1) {
        this.rocks[i] = 0;
        changed = true;
      }
      if (this.rocks[i] === 1 || (cells[i] & PlaceBit.Blocked) === 0 || this.nodeAt[i] >= 0 || built[i] === 1) continue;
      this.rocks[i] = 1;
      changed = true;
    }
    if (changed) this.rocksVersion++;
  }

  get header(): Int32Array | null {
    return this.curr?.snap.header ?? null;
  }

  /** Ticks per second the simulation is running at (for interpolation). */
  get tps(): number {
    const h = this.header;
    return h === null || h[H.speed] <= 0 ? TICKS_PER_SECOND : h[H.speed] / 100;
  }

  /** Row offset of a unit in the current snapshot, or -1 (rows are sorted by id). */
  unitRow(id: number, units = this.curr?.snap.units): number {
    if (units === undefined) return -1;
    let lo = 0;
    let hi = units.length / UNIT_STRIDE - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const v = units[mid * UNIT_STRIDE];
      if (v === id) return mid * UNIT_STRIDE;
      if (v < id) lo = mid + 1;
      else hi = mid - 1;
    }
    return -1;
  }

  /** Our units in training: the queues of our buildings (人口 counts them, D-050). */
  trainingCount(): number {
    const b = this.curr?.snap.buildings;
    if (b === undefined) return 0;
    let n = 0;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) if (b[o + B.owner] === this.me) n += b[o + B.queueLength];
    return n;
  }

  buildingRow(id: number): number {
    const b = this.curr?.snap.buildings;
    if (b === undefined) return -1;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) if (b[o + B.id] === id) return o;
    return -1;
  }

  unitType(id: number): number {
    const o = this.unitRow(id);
    return o < 0 ? -1 : (this.curr as Frame).snap.units[o + U.type];
  }

  unitStance(id: number): number {
    const o = this.unitRow(id);
    return o < 0 ? -1 : (this.curr as Frame).snap.units[o + U.stance];
  }

  /** The unit's order (Order: 撤退 is Order.Retreat), -1 for a unit not in the snapshot. */
  unitOrder(id: number): number {
    const o = this.unitRow(id);
    return o < 0 ? -1 : (this.curr as Frame).snap.units[o + U.order];
  }

  unitAutocast(id: number): boolean {
    const o = this.unitRow(id);
    return o >= 0 && ((this.curr as Frame).snap.units[o + U.flags] & UnitFlag.Autocast) !== 0;
  }

  /** 散開 (D-027): the unit has the Loose flag. */
  unitLoose(id: number): boolean {
    const o = this.unitRow(id);
    return o >= 0 && ((this.curr as Frame).snap.units[o + U.flags] & UnitFlag.Loose) !== 0;
  }

  /** World px position of a unit in the current snapshot. */
  unitPos(o: number): { x: number; y: number } {
    const u = (this.curr as Frame).snap.units;
    return { x: u[o + U.x] * FIXED_TO_PX, y: u[o + U.y] * FIXED_TO_PX };
  }

  pick(wx: number, wy: number, r: number): Pick | null {
    const snap = this.curr?.snap;
    if (snap === undefined) return null;
    const u = snap.units;
    let best: Pick | null = null;
    let bestD = r * r;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + U.action] === Action.Garrisoned) continue;
      const dx = u[o + U.x] * FIXED_TO_PX - wx;
      const dy = u[o + U.y] * FIXED_TO_PX - wy;
      const d = dx * dx + dy * dy;
      if (d <= bestD) {
        bestD = d;
        best = { kind: "unit", id: u[o + U.id], owner: u[o + U.owner], type: u[o + U.type] };
      }
    }
    if (best !== null) return best;

    const building = this.buildingAt(wx, wy);
    if (building !== null) return building;
    const cx = Math.floor(wx / TILE_PX);
    const cy = Math.floor(wy / TILE_PX);
    const size = this.map.size;
    if (cx >= 0 && cy >= 0 && cx < size && cy < size) {
      const node = this.nodeAt[cy * size + cx];
      if (node >= 0) return this.nodePick(node);
    }

    for (const town of this.knownTowns.values()) {
      const tx = (town.cellX + 0.5) * TILE_PX;
      const ty = (town.cellY + 0.5) * TILE_PX;
      const tr = town.radius * TILE_PX;
      if ((wx - tx) ** 2 + (wy - ty) ** 2 <= tr * tr) {
        const row = this.townRow(town.id);
        const owner = row < 0 ? NO_OWNER : snap.towns[row + T.owner];
        return { kind: "town", id: town.id, owner, type: town.size };
      }
    }
    return null;
  }

  buildingAt(wx: number, wy: number): Pick | null {
    const b = this.curr?.snap.buildings;
    if (b === undefined) return null;
    const cx = Math.floor(wx / TILE_PX);
    const cy = Math.floor(wy / TILE_PX);
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      const s = this.rules.buildings[b[o + B.type]]?.size ?? 1;
      if (cx >= b[o + B.cellX] && cx < b[o + B.cellX] + s && cy >= b[o + B.cellY] && cy < b[o + B.cellY] + s) {
        return { kind: "building", id: b[o + B.id], owner: b[o + B.owner], type: b[o + B.type] };
      }
    }
    return null;
  }

  buildingNeedsFarmers(id: number): boolean {
    const o = this.buildingRow(id);
    const b = this.curr?.snap.buildings;
    if (o < 0 || b === undefined) return false;
    const type = b[o + B.type];
    const max = this.rules.buildings[type]?.hp ?? 0;
    return b[o + B.progress] < 1000 || b[o + B.hp] < max || type === BuildingType.Farm;
  }

  /** Own main city hit in the last 10 s: repairs wait until the lock ends (sim/PROTOCOL.md 3.1, D-022). */
  buildingRepairLocked(id: number): boolean {
    const o = this.buildingRow(id);
    const b = this.curr?.snap.buildings;
    return o >= 0 && b !== undefined && (b[o + B.flags] & BuildingFlag.RepairLocked) !== 0;
  }

  pickNode(wx: number, wy: number, r: number): Pick | null {
    const size = this.map.size;
    const cx = Math.floor(wx / TILE_PX);
    const cy = Math.floor(wy / TILE_PX);
    if (cx >= 0 && cy >= 0 && cx < size && cy < size && this.nodeAt[cy * size + cx] >= 0) return this.nodePick(this.nodeAt[cy * size + cx]);
    const reach = Math.ceil(r / TILE_PX);
    let best = -1;
    let bestD = r * r;
    for (let y = Math.max(0, cy - reach); y <= Math.min(size - 1, cy + reach); y++) {
      for (let x = Math.max(0, cx - reach); x <= Math.min(size - 1, cx + reach); x++) {
        const id = this.nodeAt[y * size + x];
        if (id < 0) continue;
        const dx = (x + 0.5) * TILE_PX - wx;
        const dy = (y + 0.5) * TILE_PX - wy;
        const d = dx * dx + dy * dy;
        if (d <= bestD) {
          bestD = d;
          best = id;
        }
      }
    }
    return best < 0 ? null : this.nodePick(best);
  }

  private nodePick(id: number): Pick {
    return { kind: "node", id, owner: NO_OWNER, type: (this.nodes.get(id) as Int32Array)[N.kind] };
  }

  /**
   * 城鎮只能搶一次 (round 7, D-061): this town was plundered this game and, with the rule on,
   * can only be governed now.
   */
  townPlunderedOnce(id: number): boolean {
    const o = this.townRow(id);
    const t = this.curr?.snap.towns;
    return features(this.rules).plunderOnce && o >= 0 && t !== undefined && (t[o + T.flags] & TownFlag.Plundered) !== 0;
  }

  /** The types of our finished buildings (round 7's `requires`). */
  ownFinishedTypes(): Set<number> {
    const out = new Set<number>();
    const b = this.curr?.snap.buildings;
    if (b === undefined) return out;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) if (b[o + B.owner] === this.me && b[o + B.progress] >= 1000) out.add(b[o + B.type]);
    return out;
  }

  /** Our town waiting for 搶 or 治理. */
  townAwaitsMyChoice(id: number): boolean {
    const o = this.townRow(id);
    const t = this.curr?.snap.towns;
    return o >= 0 && t !== undefined && t[o + T.state] === TownState.AwaitingChoice && t[o + T.owner] === this.me;
  }

  /**
   * The towns we know of with what we know of them now: the snapshot's row (in fog, as last
   * seen), or `state` null for a town never explored (開局提示, 離民兵太近; fixed map only, as
   * a random map knows a town only once explored).
   */
  townsNow(): { id: number; size: number; cellX: number; cellY: number; radius: number; state: number | null; owner: number; militia: number }[] {
    const t = this.curr?.snap.towns;
    return this.townList().map((info) => {
      const o = this.townRow(info.id);
      if (t === undefined || o < 0) return { ...info, state: null, owner: NO_OWNER, militia: 0 };
      return { ...info, state: t[o + T.state], owner: t[o + T.owner], militia: t[o + T.militia] };
    });
  }

  townRow(id: number): number {
    const t = this.curr?.snap.towns;
    if (t === undefined) return -1;
    for (let o = 0; o < t.length; o += TOWN_STRIDE) if (t[o + T.id] === id) return o;
    return -1;
  }

  ownUnitsIn(x0: number, y0: number, x1: number, y1: number): { id: number; type: number }[] {
    const out: { id: number; type: number }[] = [];
    const u = this.curr?.snap.units;
    if (u === undefined) return out;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + U.owner] !== this.me || u[o + U.action] === Action.Garrisoned) continue;
      const x = u[o + U.x] * FIXED_TO_PX;
      const y = u[o + U.y] * FIXED_TO_PX;
      if (x >= x0 && x <= x1 && y >= y0 && y <= y1) out.push({ id: u[o + U.id], type: u[o + U.type] });
    }
    return out;
  }

  ownUnitsOnScreen(type: number): number[] {
    const out: number[] = [];
    const u = this.curr?.snap.units;
    if (u === undefined) return out;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + U.owner] !== this.me || u[o + U.type] !== type || u[o + U.action] === Action.Garrisoned) continue;
      if (this.onScreen(u[o + U.x] * FIXED_TO_PX, u[o + U.y] * FIXED_TO_PX)) out.push(u[o + U.id]);
    }
    return out;
  }

  /** Cell just outside the own main city's footprint, towards the map centre (退回主城). */
  homeCell(): { x: number; y: number } | null {
    const b = this.curr?.snap.buildings;
    if (b === undefined) return null;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      if (b[o + B.owner] !== this.me || b[o + B.type] !== BuildingType.MainCity) continue;
      const s = this.rules.buildings[BuildingType.MainCity]?.size ?? 1;
      const half = this.map.size / 2;
      const x = b[o + B.cellX] < half ? b[o + B.cellX] + s : b[o + B.cellX] - 1;
      const y = b[o + B.cellY] < half ? b[o + B.cellY] + s : b[o + B.cellY] - 1;
      return { x, y };
    }
    return null;
  }

  /** Drop selected ids that are gone (dead, or a building destroyed). */
  private pruneSelection(): void {
    const sel = this.selection;
    if (sel.units.length > 0) {
      const alive = sel.units.filter((id) => this.unitRow(id) >= 0);
      if (alive.length !== sel.units.length) sel.units = alive;
    }
    if (sel.building !== null && this.buildingRow(sel.building) < 0) sel.building = null;
  }
}
