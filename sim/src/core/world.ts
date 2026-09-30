// Simulation state. Every entity kind is a table of Int32Array columns kept in id order:
// new ids are appended and removal keeps the order, so "slot 0..count-1" is id order and
// iterating a table is deterministic. Units and buildings share one id sequence; resource
// nodes and towns have their own small, fixed id ranges.

import { BuildingType, NEUTRAL, PLAYER_COUNT, TownState, UnitType } from "../protocol.ts";
import type { GameMap } from "./map.ts";
import { BUILDINGS } from "./rules.ts";

export const UNIT_COLS = [
  "id", "owner", "type", "x", "y", "hp", "shield", "action", "facing", "carryKind", "carryAmount",
  "order", "orderTarget", "orderX", "orderY", "stance", "castProgress", "castCooldown", "flags",
  "cooldown", "target", "group", "speedCap", "anchorX", "anchorY", "lastHurt", "stuck", "home",
  "vx", "vy", "workX", "workY", "workTicks",
] as const;
export type UnitCol = (typeof UNIT_COLS)[number];

export const BUILDING_COLS = [
  "id", "owner", "type", "cellX", "cellY", "hp", "progress", "flags",
  "q0", "q1", "q2", "q3", "q4", "q5", "q6", "queueLength", "queueTicks",
  "rallyX", "rallyY", "garrisoned", "cooldown", "target", "lastHurt", "town",
] as const;
export type BuildingCol = (typeof BUILDING_COLS)[number];

/** A growable table of Int32Array columns, compacted in order on removal. */
export class Table<C extends string> {
  readonly names: readonly C[];
  count = 0;
  cap: number;
  col: Record<C, Int32Array>;
  constructor(names: readonly C[], cap = 256) {
    this.names = names;
    this.cap = cap;
    this.col = {} as Record<C, Int32Array>;
    for (const n of names) this.col[n] = new Int32Array(cap);
  }
  /** Appends a zeroed row and returns its slot. */
  add(): number {
    if (this.count === this.cap) {
      this.cap *= 2;
      for (const n of this.names) {
        const a = new Int32Array(this.cap);
        a.set(this.col[n]);
        this.col[n] = a;
      }
    }
    const s = this.count++;
    for (const n of this.names) this.col[n][s] = 0;
    return s;
  }
  /** Removes the rows with dead[slot] = 1, keeping the others in order; calls moved(from, to). */
  compact(dead: Uint8Array, moved: (from: number, to: number) => void): void {
    let w = 0;
    for (let r = 0; r < this.count; r++) {
      if (dead[r] === 1) continue;
      if (w !== r) {
        for (const n of this.names) this.col[n][w] = this.col[n][r];
      }
      moved(r, w);
      w++;
    }
    this.count = w;
  }
}

/** Grid bits: a cell is walkable when none of BLOCK_* is set. */
export const BLOCK_ROCK = 1;
export const BLOCK_NODE = 2;
export const BLOCK_BUILDING = 4;

export class World {
  readonly map: GameMap;
  readonly size: number;
  tick = 0;
  nextId = 0;
  units = new Table(UNIT_COLS, 256);
  buildings = new Table(BUILDING_COLS, 64);
  /** id -> slot in units / buildings, or -1. */
  unitSlot = new Int32Array(1024).fill(-1);
  buildingSlot = new Int32Array(1024).fill(-1);

  // Resource nodes (fixed set; amount 0 = gone).
  nodeKind: Int32Array;
  nodeX: Int32Array;
  nodeY: Int32Array;
  nodeAmount: Int32Array;
  /** Cell -> node id or -1. */
  nodeAt: Int32Array;

  // Towns (fixed set).
  townSize: Int32Array;
  townX: Int32Array;
  townY: Int32Array;
  townRadius: Int32Array;
  townState: Int32Array;
  townOwner: Int32Array;
  townTimer: Int32Array;
  townTimerTotal: Int32Array;
  townRevolt: Int32Array;

  /** Resources per player: [player * 4 + Resource]. Neutral has a row too. */
  res = new Int32Array((PLAYER_COUNT + 1) * 4);
  /** BLOCK_* bits per cell. */
  grid: Uint8Array;
  /** Bumped whenever grid changes, so cached paths know to rebuild. */
  gridVersion = 0;
  /** Winner once the game is over (-1 = draw), or -2 while running. */
  winner = -2;
  endReason = -1;

  constructor(map: GameMap) {
    this.map = map;
    const n = (this.size = map.size);
    this.grid = new Uint8Array(n * n);
    for (let i = 0; i < n * n; i++) if (map.terrain[i] === 1) this.grid[i] = BLOCK_ROCK;
    const k = map.nodes.length;
    this.nodeKind = new Int32Array(k);
    this.nodeX = new Int32Array(k);
    this.nodeY = new Int32Array(k);
    this.nodeAmount = new Int32Array(k);
    this.nodeAt = new Int32Array(n * n).fill(-1);
    map.nodes.forEach((s, i) => {
      this.nodeKind[i] = s.kind;
      this.nodeX[i] = s.cellX;
      this.nodeY[i] = s.cellY;
      this.nodeAmount[i] = s.amount;
      this.nodeAt[s.cellY * n + s.cellX] = i;
      this.grid[s.cellY * n + s.cellX] |= BLOCK_NODE;
    });
    const t = map.towns.length;
    this.townSize = new Int32Array(t);
    this.townX = new Int32Array(t);
    this.townY = new Int32Array(t);
    this.townRadius = new Int32Array(t);
    this.townState = new Int32Array(t).fill(TownState.Neutral);
    this.townOwner = new Int32Array(t).fill(NEUTRAL);
    this.townTimer = new Int32Array(t);
    this.townTimerTotal = new Int32Array(t);
    this.townRevolt = new Int32Array(t);
    map.towns.forEach((s, i) => {
      this.townSize[i] = s.size;
      this.townX[i] = s.cellX;
      this.townY[i] = s.cellY;
      this.townRadius[i] = s.radius;
    });
  }

  private newId(): number {
    const id = this.nextId++;
    if (id >= this.unitSlot.length) {
      const grow = (a: Int32Array) => {
        const b = new Int32Array(a.length * 2).fill(-1);
        b.set(a);
        return b;
      };
      this.unitSlot = grow(this.unitSlot);
      this.buildingSlot = grow(this.buildingSlot);
    }
    return id;
  }

  addUnit(owner: number, type: UnitType, x: number, y: number, hp: number): number {
    const u = this.units;
    const s = u.add();
    const id = this.newId();
    this.unitSlot[id] = s;
    const c = u.col;
    c.id[s] = id;
    c.owner[s] = owner;
    c.type[s] = type;
    c.x[s] = x;
    c.y[s] = y;
    c.hp[s] = hp;
    c.carryKind[s] = -1;
    c.orderTarget[s] = -1;
    c.target[s] = -1;
    c.group[s] = -1;
    c.anchorX[s] = x;
    c.anchorY[s] = y;
    c.lastHurt[s] = -100000;
    c.home[s] = -1;
    return id;
  }

  addBuilding(owner: number, type: BuildingType, cellX: number, cellY: number, hp: number, progress: number): number {
    const b = this.buildings;
    const s = b.add();
    const id = this.newId();
    this.buildingSlot[id] = s;
    const c = b.col;
    c.id[s] = id;
    c.owner[s] = owner;
    c.type[s] = type;
    c.cellX[s] = cellX;
    c.cellY[s] = cellY;
    c.hp[s] = hp;
    c.progress[s] = progress;
    c.rallyX[s] = -1;
    c.rallyY[s] = -1;
    c.target[s] = -1;
    c.lastHurt[s] = -100000;
    c.town[s] = -1;
    this.setFootprint(type, cellX, cellY, true);
    return id;
  }

  /** Marks or clears a building's footprint in the grid (walkable buildings leave it open). */
  setFootprint(type: BuildingType, cellX: number, cellY: number, on: boolean): void {
    const info = BUILDINGS[type];
    if (info.walkable) return;
    const n = this.size;
    for (let y = cellY; y < cellY + info.size; y++) {
      for (let x = cellX; x < cellX + info.size; x++) {
        if (on) this.grid[y * n + x] |= BLOCK_BUILDING;
        else this.grid[y * n + x] &= ~BLOCK_BUILDING;
      }
    }
    this.gridVersion++;
  }

  unit(id: number): number {
    return id >= 0 && id < this.unitSlot.length ? this.unitSlot[id] : -1;
  }
  building(id: number): number {
    return id >= 0 && id < this.buildingSlot.length ? this.buildingSlot[id] : -1;
  }

  walkable(cellX: number, cellY: number): boolean {
    const n = this.size;
    return cellX >= 0 && cellY >= 0 && cellX < n && cellY < n && this.grid[cellY * n + cellX] === 0;
  }

  get over(): boolean {
    return this.winner !== -2;
  }

  /** The main city of a player, or -1. */
  mainCity(player: number): number {
    const b = this.buildings.col;
    for (let s = 0; s < this.buildings.count; s++) {
      if (b.owner[s] === player && b.type[s] === BuildingType.MainCity) return s;
    }
    return -1;
  }
}

