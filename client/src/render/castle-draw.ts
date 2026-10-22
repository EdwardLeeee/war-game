// 城牆 drawn (D-089; design/b1/atlas-buildings.md section 11, art/castle.ts): each known town's
// castle on the cells the simulation walls (rules.towns[size].castle). From war-game-ui's pictures
// (art-v4, square on only, D-088): the floor tiles on the ground, the wall pieces standing with the
// buildings and units, ordered by their front edges (depth.ts); standing for a town held or
// neutral, its owner's colour on the gates and towers (neutral #d8d2c0), burnt for ruins. Without
// them (no atlases, another projection on a test page, or a layout that fits none: an error), the
// castle's own cells as blocks on the ground, so a wall is never invisible. Walls and tiles show
// once explored, like rock; out of sight, darker, like a building remembered.
// D-096 (art-v6, atlas-buildings.md section 11): those on a wall stand on its walk (walk_m up,
// stand_in_m towards the town), drawn over the wall's pieces in their row and under the pieces'
// front parts (intact_front); a gate closed, open, damaged or broken (gate pieces' frames), the
// tower's arrows leaving from its shoot_at_m.

import { Container, Graphics, Sprite } from "pixi.js";
import { type CastleFit, type CastlePieceInfo, type CastleState, GATE_OPEN_CELLS, type GateLook, fitLayout, gateLook, inward } from "../art/castle.ts";
import { viewFits } from "../art/structures.ts";
import type { Projection } from "../camera/projection.ts";
import { BUILDING_STRIDE, BuildingField as B, BuildingType, Fog, NEUTRAL, NO_OWNER, TownField as T, TownSize, TownState, UNIT_STRIDE, UnitField as U } from "../sim.ts";
import { TILE_PX } from "../tuning.ts";
import { FIXED_TO_PX, type GameView, type TownSpot } from "../view/view.ts";
import { NEUTRAL_TINT, ownerTint } from "./atlas.ts";
import { depthOf } from "./depth.ts";
import type { ArtFrame, UnitArt } from "./unit-art.ts";

/** What is not in view now, drawn darker (as buildings remembered). */
const OUT_OF_VIEW = 0x8a8a8a;
/** The blocks: stone, the corner towers darker, the gates' edges. */
const BLOCK_WALL = 0x8c8478;
const BLOCK_CORNER = 0x6f675c;
const BLOCK_EDGE = 0x3a332b;
const BLOCK_GATE = 0xd8d2c0;
/** Up on the plane per metre up (as the bridge's deck, terrain-draw.ts). */
const UP_PER_M = Math.sqrt(3) / 2;
/**
 * Over a piece's depth (D-096): those on the wall, then the pieces' front parts. Pieces in a row step
 * 1e-4 apart (depth.ts), so those on a stretch are drawn over its row's pieces four either side (the
 * walk and what is behind it) and under their front parts (stakes, parapets in front of them).
 */
const ON_WALL_Z = 5e-4;
const FRONT_Z = 1e-3;

interface PieceSprites {
  color: Sprite;
  team: Sprite;
  shadow: Sprite;
  /** Its part in front of those on the wall (intact_front, D-096): colour only. */
  front: Sprite;
  /** A gate's: its opening's map cells, its look as last drawn. */
  gate: { cells: number[]; look: GateLook } | null;
  /** Its picture on the plane, and its depth. */
  box: { x0: number; y0: number; x1: number; y1: number };
  z: number;
  /** Map cells, for the fog. */
  cells: number[];
}

interface TownDraw {
  fit: CastleFit | null;
  pieces: PieceSprites[];
  floor: { sprite: Sprite; cell: number }[];
  /** Its look as last drawn (state, owner). */
  look: string;
}

function put(s: Sprite, f: ArtFrame | null, x: number, y: number, scale: number): void {
  if (f === null) {
    s.visible = false;
    return;
  }
  s.visible = true;
  s.texture = f.texture;
  s.anchor.set(f.ax, f.ay);
  s.position.set(x, y);
  s.scale.set(f.half ? scale * 2 : scale);
}

export class CastleDraw {
  private readonly art: UnitArt | null;
  private readonly view: GameView;
  private readonly projection: Projection;
  private readonly floorLayer: Container;
  private readonly shadowLayer: Container;
  private readonly upright: Container;
  /** The blocks, in world px on the ground (under the fog). */
  private readonly blocks: Graphics;
  /** The pictures fit the projection (art-v4 on, square on). */
  readonly pictures: boolean;
  private readonly scale: number;
  private readonly towns = new Map<number, TownDraw>();
  private blocksKey = "";
  private fogVersion = -1;
  private lastSnap: unknown = null;
  /** Towns whose castle no layout fits (logged once each). */
  private readonly misfit = new Set<number>();
  /**
   * Each wall cell drawn from the pictures (map cell) where someone may stand (D-096): its piece's
   * depth, its walk's height (metres) and where they stand from the cell's middle (world px).
   */
  private readonly wallStand = new Map<number, { z: number; walkM: number; dx: number; dy: number }>();
  /** Each gate piece's cells (map cell): its town and piece. */
  private readonly gateCells = new Map<number, { town: number; piece: number }>();

  constructor(art: UnitArt | null, view: GameView, projection: Projection, layers: { floor: Container; shadows: Container; upright: Container; blocks: Graphics }) {
    this.art = art;
    this.view = view;
    this.projection = projection;
    this.floorLayer = layers.floor;
    this.shadowLayer = layers.shadows;
    this.upright = layers.upright;
    this.blocks = layers.blocks;
    const c = art?.castle ?? null;
    this.pictures = c !== null && viewFits(c.view, projection.kind);
    this.scale = projection.ptPerM / (c?.px_per_m ?? 60);
  }

  /** Every frame: new towns, their looks and the fog, when the snapshot changed. */
  update(): void {
    const snap = this.view.curr?.snap;
    if (snap === undefined || snap === this.lastSnap) return;
    this.lastSnap = snap;
    const fogChanged = this.view.fogVersion !== this.fogVersion;
    this.fogVersion = this.view.fogVersion;
    const blockTowns: { town: TownSpot; tint: number | null }[] = [];
    const around = this.gateSurroundings();
    for (const town of this.view.knownTowns.values()) {
      const castle = this.view.castleOf(town);
      if (castle === null) continue;
      let d = this.towns.get(town.id);
      if (d === undefined) {
        d = this.build(town);
        this.towns.set(town.id, d);
      }
      const o = this.view.townRow(town.id);
      const state = o < 0 ? TownState.Neutral : snap.towns[o + T.state];
      const owner = o < 0 ? NEUTRAL : snap.towns[o + T.owner];
      if (d.fit === null) {
        // No pictures: blocks, tinted inside only when there are no pictures at all (ceo: the walls are the range).
        blockTowns.push({ town, tint: this.pictures ? null : state === TownState.Ruins ? NEUTRAL_TINT : ownerTint(owner, this.view.me) });
        continue;
      }
      const gates = this.gateLooks(d, state === TownState.Ruins, owner, around);
      const look = `${state}|${owner}|${gates}`;
      if (look !== d.look || fogChanged) {
        d.look = look;
        this.dress(town, d, state === TownState.Ruins ? "ruin" : "intact", owner);
      }
    }
    const key = blockTowns.map((b) => `${b.town.id}:${b.tint}`).join(",");
    if (key !== this.blocksKey) {
      this.blocksKey = key;
      this.drawBlocks(blockTowns);
    }
  }

  /** The town's pieces and tiles, laid on its castle; null fit (blocks) when the pictures are off or none fits. */
  private build(town: TownSpot): TownDraw {
    const d: TownDraw = { fit: null, pieces: [], floor: [], look: "" };
    const c = this.art?.castle ?? null;
    const castle = this.view.castleOf(town);
    if (!this.pictures || c === null || castle === null) return d;
    const fit = fitLayout(c, castle, town.size === TownSize.Large);
    if (fit === null) {
      if (!this.misfit.has(town.id)) {
        this.misfit.add(town.id);
        console.error(`castle: no layout of castle_${c.culture} fits town ${town.id}'s walls (size ${town.size}); drawn as blocks`);
      }
      return d;
    }
    d.fit = fit;
    const n = this.view.map.size;
    const ox = town.cellX + fit.dx;
    const oy = town.cellY + fit.dy;
    for (const tile of fit.layout.floor) {
      const s = new Sprite();
      s.visible = false;
      this.floorLayer.addChild(s);
      const at = this.projection.toPlane((ox + tile.cell[0] + 0.5) * TILE_PX, (oy + tile.cell[1] + 0.5) * TILE_PX);
      put(s, this.art?.castleFrame("color", c.tiles[tile.tile] ?? "") ?? null, at.x, at.y, this.scale);
      const x = ox + tile.cell[0];
      const y = oy + tile.cell[1];
      d.floor.push({ sprite: s, cell: x >= 0 && y >= 0 && x < n && y < n ? y * n + x : -1 });
    }
    const cellM = c.cell_m ?? 2;
    const openings = new Set(castle.gate.map(([x, y]) => (town.cellY + y) * n + town.cellX + x));
    const borrow: { cell: number; z: number }[] = [];
    fit.layout.walls.forEach((p, i) => {
      const color = new Sprite();
      const team = new Sprite();
      const shadow = new Sprite();
      const frontPart = new Sprite();
      color.visible = team.visible = shadow.visible = frontPart.visible = false;
      this.upright.addChild(color, team, frontPart);
      this.shadowLayer.addChild(shadow);
      const front = this.projection.toPlane(0, (oy + p.front) * TILE_PX).y;
      const minX = Math.min(...p.cells.map(([x]) => x));
      const z = depthOf(front, ox + minX, 1_000_000 + town.id * 100 + i);
      color.zIndex = z;
      team.zIndex = z + 0.000001;
      frontPart.zIndex = z + FRONT_Z;
      const cells = p.cells.map(([x, y]) => [ox + x, oy + y]).filter(([x, y]) => x >= 0 && y >= 0 && x < n && y < n).map(([x, y]) => y * n + x);
      const info: CastlePieceInfo | undefined = c.pieces[p.piece];
      // A plain stretch: its walk, and where they stand on it (towards the town by stand_in_m).
      const way = inward(p.piece);
      if (info?.walk_m !== undefined && way !== null) {
        const inPx = ((info.stand_in_m ?? 0) / cellM) * TILE_PX;
        for (const cell of cells) this.wallStand.set(cell, { z, walkM: info.walk_m, dx: way[0] * inPx, dy: way[1] * inPx });
      } else {
        for (const cell of cells) if (!openings.has(cell)) borrow.push({ cell, z });
      }
      const opening = cells.filter((cell) => openings.has(cell));
      if (opening.length > 0) for (const cell of cells) this.gateCells.set(cell, { town: town.id, piece: i });
      d.pieces.push({ color, team, shadow, front: frontPart, gate: opening.length > 0 ? { cells: opening, look: "closed" } : null, box: { x0: 0, y0: 0, x1: 0, y1: 0 }, z, cells });
    });
    // Corners, towers and a gate's piers have no walk of their own (art-v6): its neighbour's height, in the cell's middle.
    for (const { cell, z } of borrow) {
      const near = [cell - 1, cell + 1, cell - n, cell + n].map((c2) => this.wallStand.get(c2)).find((v) => v !== undefined);
      if (near !== undefined) this.wallStand.set(cell, { z, walkM: near.walkM, dx: 0, dy: 0 });
    }
    return d;
  }

  /** This snapshot's gate buildings (row by top-left cell) and everyone's cells by owner, for the gates' looks. */
  private gateSurroundings(): { gateRows: Map<number, number>; cells: Map<number, Set<number>> } {
    const gateRows = new Map<number, number>();
    const cells = new Map<number, Set<number>>();
    const snap = this.view.curr?.snap;
    if (snap === undefined || !this.pictures) return { gateRows, cells };
    const n = this.view.map.size;
    const b = snap.buildings;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) if (b[o + B.type] === BuildingType.Gate) gateRows.set(b[o + B.cellY] * n + b[o + B.cellX], o);
    const u = snap.units;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      let set = cells.get(u[o + U.owner]);
      if (set === undefined) cells.set(u[o + U.owner], (set = new Set()));
      set.add(Math.floor((u[o + U.y] * FIXED_TO_PX) / TILE_PX) * n + Math.floor((u[o + U.x] * FIXED_TO_PX) / TILE_PX));
    }
    return { gateRows, cells };
  }

  /**
   * Its gates' looks now (D-096, art/castle.ts gateLook), kept on their pieces; a key of them. An
   * opening out of view with no gate on it keeps the look last seen (a gate remembered stands).
   */
  private gateLooks(d: TownDraw, ruins: boolean, owner: number, around: { gateRows: Map<number, number>; cells: Map<number, Set<number>> }): string {
    const snap = this.view.curr?.snap;
    if (snap === undefined || d.pieces.every((p) => p.gate === null)) return "";
    const n = this.view.map.size;
    const fog = this.view.fog;
    const gates = this.view.rules.features?.gates === true;
    const b = snap.buildings;
    const gateRows = around.gateRows;
    // The holder's soldiers' cells.
    const near = owner === NO_OWNER ? undefined : around.cells.get(owner);
    let key = "";
    for (const p of d.pieces) {
      const g = p.gate;
      if (g === null) continue;
      const xs = g.cells.map((c) => c % n);
      const ys = g.cells.map((c) => Math.floor(c / n));
      const o = gateRows.get(Math.min(...ys) * n + Math.min(...xs));
      const visible = fog === null || g.cells.every((c) => fog[c] === Fog.Visible);
      if (o !== undefined || visible || ruins || !gates) {
        let holderNear = false;
        for (let y = Math.min(...ys) - GATE_OPEN_CELLS; y <= Math.max(...ys) + GATE_OPEN_CELLS && !holderNear; y++) {
          for (let x = Math.min(...xs) - GATE_OPEN_CELLS; x <= Math.max(...xs) + GATE_OPEN_CELLS; x++) {
            if (near?.has(y * n + x) === true) {
              holderNear = true;
              break;
            }
          }
        }
        g.look = gateLook({ gates, ruins, standing: o !== undefined, hp: o === undefined ? 0 : b[o + B.hp], max: o === undefined ? 0 : this.view.buildingMaxHp(b, o), holderNear });
      }
      key += g.look[0];
    }
    return key;
  }

  /** Its pieces standing or burnt, its owner's colour on them, each shown once explored and darker out of sight. */
  private dress(town: TownSpot, d: TownDraw, state: CastleState, owner: number): void {
    const fit = d.fit;
    const c = this.art?.castle ?? null;
    if (fit === null || c === null) return;
    const fog = this.view.fog;
    const seen = (cell: number) => fog === null || (cell >= 0 && fog[cell] !== Fog.Unexplored);
    const inView = (cell: number) => fog === null || (cell >= 0 && fog[cell] === Fog.Visible);
    for (const f of d.floor) {
      f.sprite.visible = seen(f.cell) && f.sprite.texture !== undefined;
      f.sprite.tint = inView(f.cell) ? 0xffffff : OUT_OF_VIEW;
    }
    const ox = town.cellX + fit.dx;
    const oy = town.cellY + fit.dy;
    const team = state === "ruin" ? null : owner === NEUTRAL || owner === NO_OWNER ? NEUTRAL_TINT : ownerTint(owner, this.view.me);
    fit.layout.walls.forEach((p, i) => {
      const s = d.pieces[i];
      const frames = c.pieces[p.piece]?.frames;
      // A gate's own look when its pictures have it (art-v6), else open as before; a stretch's front part while standing.
      const look = s.gate === null || state === "ruin" ? state : s.gate.look;
      const name = frames?.[look] ?? frames?.[state] ?? "";
      const frontName = state === "intact" ? frames?.intact_front : undefined;
      const at = this.projection.toPlane((ox + p.anchor[0]) * TILE_PX, (oy + p.anchor[1]) * TILE_PX);
      const shown = s.cells.some(seen);
      const color = shown ? (this.art?.castleFrame("color", name) ?? null) : null;
      put(s.color, color, at.x, at.y, this.scale);
      put(s.team, shown && team !== null ? (this.art?.castleFrame("team", name) ?? null) : null, at.x, at.y, this.scale);
      put(s.shadow, shown ? (this.art?.castleFrame("shadow", name) ?? null) : null, at.x, at.y, this.scale);
      put(s.front, shown && frontName !== undefined ? (this.art?.castleFrame("color", frontName) ?? null) : null, at.x, at.y, this.scale);
      const tint = s.cells.some(inView) ? 0xffffff : OUT_OF_VIEW;
      s.color.tint = tint;
      s.front.tint = tint;
      if (team !== null) s.team.tint = tint === OUT_OF_VIEW ? OUT_OF_VIEW : team;
      if (color !== null) {
        const w = color.texture.width * this.scale;
        const h = color.texture.height * this.scale;
        s.box = { x0: at.x - color.ax * w, y0: at.y - color.ay * h, x1: at.x + (1 - color.ax) * w, y1: at.y + (1 - color.ay) * h };
      }
    });
  }

  /** The castles with no pictures: their wall cells as stone blocks, the gates marked; inside tinted only when there are no pictures at all. */
  private drawBlocks(list: { town: TownSpot; tint: number | null }[]): void {
    const g = this.blocks;
    g.clear();
    for (const { town, tint } of list) {
      const c = this.view.castleOf(town);
      if (c === null) continue;
      const cell = (x: number, y: number) => g.rect((town.cellX + x) * TILE_PX, (town.cellY + y) * TILE_PX, TILE_PX, TILE_PX);
      if (tint !== null) {
        g.rect((town.cellX + c.inside.x0) * TILE_PX, (town.cellY + c.inside.y0) * TILE_PX, (c.inside.x1 - c.inside.x0 + 1) * TILE_PX, (c.inside.y1 - c.inside.y0 + 1) * TILE_PX).fill({ color: tint, alpha: 0.1 });
      }
      const corners = new Set(c.corner.map(([x, y]) => `${x},${y}`));
      for (const [x, y] of c.wall) cell(x, y).fill(corners.has(`${x},${y}`) ? BLOCK_CORNER : BLOCK_WALL).stroke({ width: 2, color: BLOCK_EDGE });
      for (const [x, y] of c.gate) cell(x, y).stroke({ width: 2, color: BLOCK_GATE, alpha: 0.9 });
    }
  }

  /** The town whose wall's picture (shown) is under a point of the plane, the last drawn first; or null. */
  wallPictureAt(px: number, py: number): number | null {
    let best: { town: number; z: number } | null = null;
    for (const [town, d] of this.towns) {
      for (const p of d.pieces) {
        if (!p.color.visible || px < p.box.x0 || px > p.box.x1 || py < p.box.y0 || py > p.box.y1) continue;
        if (best === null || p.z > best.z) best = { town, z: p.z };
      }
    }
    return best?.town ?? null;
  }

  /** Whether a wall piece drawn after depth `z` (in front) covers part of this box on the plane: the unit there is behind it. */
  covers(box: { x0: number; y0: number; x1: number; y1: number }, z: number): boolean {
    for (const d of this.towns.values()) {
      for (const p of d.pieces) {
        if (!p.color.visible || p.z <= z) continue;
        if (box.x1 > p.box.x0 && box.x0 < p.box.x1 && box.y1 > p.box.y0 && box.y0 < p.box.y1) return true;
      }
    }
    return false;
  }

  /**
   * Someone standing on the wall at map cell (cellX, cellY) (D-096, UnitFlag.OnWall): where on the
   * ground they stand (world px from the cell's middle, towards the town by stand_in_m), how far up
   * (the walk, points on the plane) and their depth (over the wall, under its front parts); null
   * where the wall is drawn as blocks or its pictures have no walk (art-v5): drawn where they stand.
   */
  onWall(cellX: number, cellY: number): { dx: number; dy: number; lift: number; z: number } | null {
    const at = this.wallStand.get(cellY * this.view.map.size + cellX);
    if (at === undefined) return null;
    return { dx: at.dx, dy: at.dy, lift: at.walkM * this.projection.ptPerM * UP_PER_M, z: at.z + ON_WALL_Z };
  }

  /** The castle's gate piece over this map cell, drawn from pictures with the gate's own looks (art-v6); null otherwise. */
  private gatePiece(cellX: number, cellY: number): { town: number; d: TownDraw; i: number; info: CastlePieceInfo } | null {
    const g = this.gateCells.get(cellY * this.view.map.size + cellX);
    const d = g === undefined ? undefined : this.towns.get(g.town);
    const c = this.art?.castle ?? null;
    const p = d?.fit?.layout.walls[g?.piece ?? -1];
    const info = p === undefined ? undefined : c?.pieces[p.piece];
    if (d === undefined || g === undefined || info?.frames.closed === undefined) return null;
    return { town: g.town, d, i: g.piece, info };
  }

  /** Whether the gate on this cell is drawn as the castle's picture (closed, open, damaged, broken: D-096): no block for its building, no rubble. */
  drawsGate(cellX: number, cellY: number): boolean {
    return this.gatePiece(cellX, cellY) !== null;
  }

  /** The top of that gate's picture on the plane (its bar above it), or null. */
  gateTop(cellX: number, cellY: number): number | null {
    const g = this.gatePiece(cellX, cellY);
    const p = g?.d.pieces[g.i];
    return p === undefined || !p.color.visible ? null : p.box.y0;
  }

  /**
   * Where a gate's arrows leave (D-096): of its two shoot_at_m, the nearer the target (world px):
   * a point on the ground (world px) and how far up (points on the plane); null without them.
   */
  gateShootFrom(cellX: number, cellY: number, toX: number, toY: number): { x: number; y: number; lift: number } | null {
    const g = this.gatePiece(cellX, cellY);
    const c = this.art?.castle ?? null;
    const fit = g?.d.fit ?? null;
    const town = g === null ? undefined : this.view.knownTowns.get(g.town);
    if (g === null || c === null || fit === null || town === undefined || g.info.shoot_at_m === undefined || g.info.shoot_at_m.length === 0) return null;
    const p = fit.layout.walls[g.i];
    const cellPx = TILE_PX / (c.cell_m ?? 2);
    const ax = (town.cellX + fit.dx + p.anchor[0]) * TILE_PX;
    const ay = (town.cellY + fit.dy + p.anchor[1]) * TILE_PX;
    let best: { x: number; y: number; lift: number } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const [mx, my, mz] of g.info.shoot_at_m) {
      const x = ax + mx * cellPx;
      const y = ay + my * cellPx;
      const dist = (x - toX) ** 2 + (y - toY) ** 2;
      if (dist < bestD) {
        bestD = dist;
        best = { x, y, lift: mz * this.projection.ptPerM * UP_PER_M };
      }
    }
    return best;
  }

  /** For the test page: the gates drawn from pictures, by look. */
  get gateLookCounts(): Record<GateLook, number> {
    const counts: Record<GateLook, number> = { intact: 0, closed: 0, damaged: 0, broken: 0, ruin: 0 };
    const c = this.art?.castle ?? null;
    for (const d of this.towns.values()) {
      d.fit?.layout.walls.forEach((p, i) => {
        const g = d.pieces[i].gate;
        if (g !== null && d.pieces[i].color.visible && c?.pieces[p.piece]?.frames.closed !== undefined) counts[g.look]++;
      });
    }
    return counts;
  }

  /** Whether the castles' pictures say where those on a wall stand (art-v6). */
  get walkable(): boolean {
    return this.wallStand.size > 0;
  }

  /** Some town's castle is drawn from the pictures (units can stand behind its walls). */
  get hasPieces(): boolean {
    for (const d of this.towns.values()) if (d.pieces.length > 0) return true;
    return false;
  }

  /** For the test page: pieces and tiles shown, towns drawn as blocks, and those no layout fits. */
  get counts(): { pieces: number; tiles: number; blockTowns: number; misfit: number } {
    let pieces = 0;
    let tiles = 0;
    let blockTowns = 0;
    for (const d of this.towns.values()) {
      if (d.fit === null) blockTowns++;
      pieces += d.pieces.filter((p) => p.color.visible).length;
      tiles += d.floor.filter((f) => f.sprite.visible).length;
    }
    return { pieces, tiles, blockTowns, misfit: this.misfit.size };
  }

  destroy(): void {
    for (const d of this.towns.values()) {
      for (const p of d.pieces) for (const s of [p.color, p.team, p.shadow, p.front]) s.destroy();
      for (const f of d.floor) f.sprite.destroy();
    }
    this.towns.clear();
    this.wallStand.clear();
    this.gateCells.clear();
  }
}
