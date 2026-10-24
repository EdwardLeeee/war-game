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
  type TownCastle,
  UNIT_STRIDE,
  UnitField as U,
  UnitFlag,
} from "../sim.ts";
import { features } from "../game/features.ts";
import { TILE_PX } from "../tuning.ts";
import { type Projection, tilted, TOP } from "../camera/projection.ts";

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
  /**
   * The ground the player knows, a Terrain value a cell (R6-51: rock, castle walls, water, fords,
   * bridges, cliffs; D-074: on a random map the explored cells, Open elsewhere).
   */
  readonly ground: Uint8Array;
  /** Bumped when the known ground changes. */
  groundVersion = 0;
  /** learnRocks' cells under a known building, kept between snapshots (it runs on each one). */
  private built: Uint8Array | null = null;
  selection: { units: number[]; building: number | null } = { units: [], building: null };
  /** A foreign unit, building, node or town the player tapped with nothing of theirs selected. */
  inspected: Pick | null = null;
  /** Is this world point on screen? Set by the game from the camera. */
  onScreen: (wx: number, wy: number) => boolean = () => true;
  /**
   * How the ground is laid on the screen (D-085). Taps and boxes are measured on its plane, as
   * the screen shows them: as a diamond a round tap is not round on the ground, and a box on
   * the screen is not a box of cells. Distances given (r) are the plane's.
   */
  projection: Projection = TOP;
  /** The building whose picture (taller than its footprint, D-085) is under a point of the plane, from the renderer; null: none drawn. */
  pictureAt: ((px: number, py: number) => number | null) | null = null;
  /** The town whose wall's picture is under a point of the plane (D-089: a stone wall stands tall over the cells behind it), or null. */
  wallPictureAt: ((px: number, py: number) => number | null) | null = null;
  /** The building whose picture, under a point of the plane, stands in front of a unit at (ux, uy) (it hides the unit there). */
  coverAt: ((px: number, py: number, ux: number, uy: number) => number | null) | null = null;

  /** On the plane, a unit's body is this high above its feet (as a diamond 0.9 m: the pictures stand up); a tap there takes it too. */
  bodyLift(): number {
    return tilted(this.projection) ? 0.9 * this.projection.ptPerM : 0;
  }

  constructor(player: number, map: MapInfo, rules: Rules) {
    this.me = player;
    this.map = map;
    this.rules = rules;
    this.nodeAt = new Int32Array(map.size * map.size).fill(-1);
    // On a random map the terrain is all open ground: the rest comes with exploration (learnGround).
    this.ground = map.terrain.slice();
    for (const town of map.towns) this.knownTowns.set(town.id, town);
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
      // A node's cell taken for rock before its row came (the fake world's random map): it is not rock.
      if (this.ground[row[N.cellY] * size + row[N.cellX]] === Terrain.Blocked) {
        this.ground[row[N.cellY] * size + row[N.cellX]] = Terrain.Open;
        this.groundVersion++;
      }
    }
    if (rows.length > 0) this.nodesVersion++;
    if (snap.fog !== null) {
      this.fog = snap.fog;
      this.fogVersion++;
    }
    if (snap.placement !== null) this.placement = { size, cells: snap.placement };
    this.learnTowns(snap.towns);
    if (snap.terrain !== undefined && snap.terrain !== null) this.learnGround(snap.terrain);
    // The fake world sends no terrain: its random map's rocks from the placement grid.
    else if (this.randomMap && snap.terrain === undefined && snap.placement !== null) this.learnRocks(snap);
    this.pruneSelection();
  }

  /** A town's castle (D-089, PROTOCOL.md 3.5): offsets from its centre cell, as this game's rules have it; null before #239's rules. */
  castleOf(town: { size: number }): TownCastle | null {
    return this.rules.towns?.[town.size]?.castle ?? null;
  }

  /** Gate openings by their top-left cell (D-096): width and height in cells; rebuilt as towns become known. */
  private gateBoxes = new Map<number, { w: number; h: number }>();
  private gateBoxesFor = -1;

  /**
   * A building's footprint in cells. A gate (D-096, PROTOCOL.md 3.7) is its opening, a row or a
   * column of cells from its town's `castle.gates` (`buildings[Gate].size` is 1); any other its square.
   */
  footprint(b: Int32Array, o: number): { x: number; y: number; w: number; h: number } {
    const x = b[o + B.cellX];
    const y = b[o + B.cellY];
    const type = b[o + B.type];
    if (type === BuildingType.Gate) {
      const box = this.gateOpenings().get(y * this.map.size + x);
      if (box !== undefined) return { x, y, ...box };
    }
    const s = this.rules.buildings[type]?.size ?? 1;
    return { x, y, w: s, h: s };
  }

  /** A footprint's middle (cells). */
  footprintCentre(b: Int32Array, o: number): { x: number; y: number } {
    const f = this.footprint(b, o);
    return { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  }

  /** Every known town's gate openings (D-096), keyed by top-left cell. */
  private gateOpenings(): Map<number, { w: number; h: number }> {
    if (this.gateBoxesFor === this.townsVersion) return this.gateBoxes;
    this.gateBoxesFor = this.townsVersion;
    this.gateBoxes = new Map();
    const n = this.map.size;
    for (const town of this.knownTowns.values()) {
      for (const opening of this.castleOf(town)?.gates ?? []) {
        if (opening.length === 0) continue;
        const xs = opening.map(([x]) => x);
        const ys = opening.map(([, y]) => y);
        const x0 = Math.min(...xs);
        const y0 = Math.min(...ys);
        this.gateBoxes.set((town.cellY + y0) * n + town.cellX + x0, { w: Math.max(...xs) - x0 + 1, h: Math.max(...ys) - y0 + 1 });
      }
    }
    return this.gateBoxes;
  }

  /** The town a gate building stands in (D-096): the known town whose opening starts at its cell, or null. */
  gateTown(b: Int32Array, o: number): TownSpot | null {
    const x = b[o + B.cellX];
    const y = b[o + B.cellY];
    for (const town of this.knownTowns.values()) {
      for (const opening of this.castleOf(town)?.gates ?? []) {
        if (opening.length === 0) continue;
        if (town.cellX + Math.min(...opening.map(([cx]) => cx)) === x && town.cellY + Math.min(...opening.map(([, cy]) => cy)) === y) return town;
      }
    }
    return null;
  }

  /**
   * A building's full hit points: a gate's are its town's size's (`rules.towns[size].gateHp`,
   * D-096), a keep's too (`rules.towns[size].keep.hp`, D-100), any other its type's.
   */
  buildingMaxHp(b: Int32Array, o: number): number {
    const type = b[o + B.type];
    if (type === BuildingType.Gate) {
      const town = this.gateTown(b, o);
      const hp = town === null ? undefined : this.rules.towns?.[town.size]?.gateHp;
      if (hp !== undefined) return hp;
    }
    if (type === BuildingType.Keep) {
      const town = this.keepTown(b, o);
      const hp = town === null ? undefined : this.rules.towns?.[town.size]?.keep?.hp;
      if (hp !== undefined) return hp;
    }
    return this.rules.buildings[type]?.hp ?? b[o + B.hp];
  }

  /** The town a keep stands in (D-100: on its centre cell), or null. */
  keepTown(b: Int32Array, o: number): TownSpot | null {
    const f = this.footprint(b, o);
    for (const town of this.knownTowns.values()) {
      if (town.cellX >= f.x && town.cellX < f.x + f.w && town.cellY >= f.y && town.cellY < f.y + f.h) return town;
    }
    return null;
  }

  /** A town's keep in the snapshot (D-100; standing, or remembered so), its row offset, or -1. */
  keepRow(town: number): number {
    const spot = this.knownTowns.get(town);
    const b = this.curr?.snap.buildings;
    if (spot === undefined || b === undefined) return -1;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      if (b[o + B.type] !== BuildingType.Keep) continue;
      const f = this.footprint(b, o);
      if (spot.cellX >= f.x && spot.cellX < f.x + f.w && spot.cellY >= f.y && spot.cellY < f.y + f.h) return o;
    }
    return -1;
  }

  /** 點城鎮就是進攻 (D-100): towns have keeps (`features.keep`). */
  attacksTowns(): boolean {
    return features(this.rules).keep === true;
  }

  /** A town's keep's centre cell while it stands (D-100), else null. */
  keepCell(town: number): { x: number; y: number } | null {
    const spot = this.knownTowns.get(town);
    return spot === undefined || this.keepRow(town) < 0 ? null : { x: spot.cellX, y: spot.cellY };
  }

  /** The cells a town's castle covers, walls and gates included (map cells, inclusive), or null with no castle. */
  castleBox(town: { size: number; cellX: number; cellY: number }): { x0: number; y0: number; x1: number; y1: number } | null {
    const c = this.castleOf(town);
    if (c === null) return null;
    let x0 = c.inside.x0;
    let y0 = c.inside.y0;
    let x1 = c.inside.x1;
    let y1 = c.inside.y1;
    for (const [x, y] of [...c.wall, ...c.gate]) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return { x0: town.cellX + x0, y0: town.cellY + y0, x1: town.cellX + x1, y1: town.cellY + y1 };
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

  /** The ground as the simulation tells it (R6-51: Snapshot.terrain, with each fog update). */
  private learnGround(terrain: Uint8Array): void {
    const g = this.ground;
    if (terrain.length !== g.length) return;
    let changed = false;
    for (let i = 0; i < g.length; i++) {
      if (g[i] === terrain[i]) continue;
      g[i] = terrain[i];
      changed = true;
    }
    if (changed) this.groundVersion++;
  }

  /**
   * The fake world's rocks explored on a random map (D-074; the simulation sends Snapshot.terrain):
   * the placement grid blocks a cell for a rock, a resource node or a known building; what is
   * neither of the other two is rock. Kept once known (rocks never move).
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
      const f = this.footprint(b, o);
      for (let y = f.y; y < f.y + f.h; y++) {
        for (let x = f.x; x < f.x + f.w; x++) if (x >= 0 && y >= 0 && x < size && y < size) built[y * size + x] = 1;
      }
    }
    const g = this.ground;
    let changed = false;
    for (let i = 0; i < cells.length; i++) {
      // A building's cells taken for rock before its row came: they are not rock.
      if (built[i] === 1 && g[i] === Terrain.Blocked) {
        g[i] = Terrain.Open;
        changed = true;
      }
      // A castle's wall (D-089) is Blocked too, and drawn as a wall: not rock.
      if (g[i] === Terrain.Blocked || (cells[i] & PlaceBit.Blocked) === 0 || (cells[i] & PlaceBit.Wall) !== 0 || this.nodeAt[i] >= 0 || built[i] === 1) continue;
      g[i] = Terrain.Blocked;
      changed = true;
    }
    if (changed) this.groundVersion++;
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
    const P = this.projection;
    const t = P.toPlane(wx, wy);
    const lift = this.bodyLift();
    let bestAt = t;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + U.action] === Action.Garrisoned) continue;
      const q = P.toPlane(u[o + U.x] * FIXED_TO_PX, u[o + U.y] * FIXED_TO_PX);
      const dx = q.x - t.x;
      const dy = q.y - t.y;
      // Its feet, or its body above them.
      const d = Math.min(dx * dx + dy * dy, dx * dx + (dy - lift) * (dy - lift));
      if (d <= bestD) {
        bestD = d;
        bestAt = q;
        best = { kind: "unit", id: u[o + U.id], owner: u[o + U.owner], type: u[o + U.type] };
      }
    }
    // Behind a building's picture where the finger is, the unit is hidden: the building.
    if (best !== null) return this.buildingById(this.coverAt?.(t.x, t.y, bestAt.x, bestAt.y) ?? null) ?? best;

    const building = this.buildingAt(wx, wy);
    if (building !== null) return building;
    const cx = Math.floor(wx / TILE_PX);
    const cy = Math.floor(wy / TILE_PX);
    const size = this.map.size;
    if (cx >= 0 && cy >= 0 && cx < size && cy < size) {
      const node = this.nodeAt[cy * size + cx];
      if (node >= 0) return this.nodePick(node);
    }
    // A building's picture stands above its footprint: a tap on its roof is on it too.
    const pictured = this.buildingById(this.pictureAt?.(t.x, t.y) ?? null);
    if (pictured !== null) return pictured;

    // A town (D-089): within its walls, on them, or on their pictures (a stone wall stands tall
    // over the cells behind it): only once no unit, building or node is there.
    const walled = this.wallPictureAt?.(t.x, t.y) ?? null;
    for (const town of this.knownTowns.values()) {
      const box = this.castleBox(town);
      const hit =
        town.id === walled ||
        (box !== null
          ? cx >= box.x0 && cx <= box.x1 && cy >= box.y0 && cy <= box.y1
          : (wx - (town.cellX + 0.5) * TILE_PX) ** 2 + (wy - (town.cellY + 0.5) * TILE_PX) ** 2 <= (town.radius * TILE_PX) ** 2);
      if (hit) {
        const row = this.townRow(town.id);
        const owner = row < 0 ? NO_OWNER : snap.towns[row + T.owner];
        return { kind: "town", id: town.id, owner, type: town.size };
      }
    }
    return null;
  }

  private buildingById(id: number | null): Pick | null {
    const o = id === null ? -1 : this.buildingRow(id);
    const b = this.curr?.snap.buildings;
    return o < 0 || b === undefined ? null : { kind: "building", id: b[o + B.id], owner: b[o + B.owner], type: b[o + B.type] };
  }

  buildingAt(wx: number, wy: number): Pick | null {
    const b = this.curr?.snap.buildings;
    if (b === undefined) return null;
    const cx = Math.floor(wx / TILE_PX);
    const cy = Math.floor(wy / TILE_PX);
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      const f = this.footprint(b, o);
      if (cx >= f.x && cx < f.x + f.w && cy >= f.y && cy < f.y + f.h) {
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
    // r is the plane's: as a diamond a cell is flattened to half its height, so look twice as far.
    const reach = Math.ceil(r / TILE_PX) * (tilted(this.projection) ? 2 : 1);
    let best = -1;
    let bestD = r * r;
    const P = this.projection;
    const t = P.toPlane(wx, wy);
    for (let y = Math.max(0, cy - reach); y <= Math.min(size - 1, cy + reach); y++) {
      for (let x = Math.max(0, cx - reach); x <= Math.min(size - 1, cx + reach); x++) {
        const id = this.nodeAt[y * size + x];
        if (id < 0) continue;
        const q = P.toPlane((x + 0.5) * TILE_PX, (y + 0.5) * TILE_PX);
        const dx = q.x - t.x;
        const dy = q.y - t.y;
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

  /** Own units whose feet are in this box of the plane (the screen's box: D-085). */
  ownUnitsIn(x0: number, y0: number, x1: number, y1: number): { id: number; type: number }[] {
    const out: { id: number; type: number }[] = [];
    const u = this.curr?.snap.units;
    if (u === undefined) return out;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + U.owner] !== this.me || u[o + U.action] === Action.Garrisoned) continue;
      const { x, y } = this.projection.toPlane(u[o + U.x] * FIXED_TO_PX, u[o + U.y] * FIXED_TO_PX);
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
