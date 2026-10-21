// 城牆 drawn (D-089; design/b1/atlas-buildings.md section 11, art/castle.ts): each known town's
// castle on the cells the simulation walls (rules.towns[size].castle). From war-game-ui's pictures
// (art-v4, square on only, D-088): the floor tiles on the ground, the wall pieces standing with the
// buildings and units, ordered by their front edges (depth.ts); standing for a town held or
// neutral, its owner's colour on the gates and towers (neutral #d8d2c0), burnt for ruins. Without
// them (no atlases, another projection on a test page, or a layout that fits none: an error), the
// castle's own cells as blocks on the ground, so a wall is never invisible. Walls and tiles show
// once explored, like rock; out of sight, darker, like a building remembered.

import { Container, Graphics, Sprite } from "pixi.js";
import { type CastleFit, type CastleState, fitLayout } from "../art/castle.ts";
import { viewFits } from "../art/structures.ts";
import type { Projection } from "../camera/projection.ts";
import { Fog, NEUTRAL, NO_OWNER, TownField as T, TownSize, TownState } from "../sim.ts";
import { TILE_PX } from "../tuning.ts";
import type { GameView, TownSpot } from "../view/view.ts";
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

interface PieceSprites {
  color: Sprite;
  team: Sprite;
  shadow: Sprite;
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
      const look = `${state}|${owner}`;
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
    fit.layout.walls.forEach((p, i) => {
      const color = new Sprite();
      const team = new Sprite();
      const shadow = new Sprite();
      color.visible = team.visible = shadow.visible = false;
      this.upright.addChild(color, team);
      this.shadowLayer.addChild(shadow);
      const front = this.projection.toPlane(0, (oy + p.front) * TILE_PX).y;
      const minX = Math.min(...p.cells.map(([x]) => x));
      const z = depthOf(front, ox + minX, 1_000_000 + town.id * 100 + i);
      color.zIndex = z;
      team.zIndex = z + 0.000001;
      const cells = p.cells.map(([x, y]) => [ox + x, oy + y]).filter(([x, y]) => x >= 0 && y >= 0 && x < n && y < n).map(([x, y]) => y * n + x);
      d.pieces.push({ color, team, shadow, box: { x0: 0, y0: 0, x1: 0, y1: 0 }, z, cells });
    });
    return d;
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
      const name = c.pieces[p.piece]?.frames[state] ?? "";
      const at = this.projection.toPlane((ox + p.anchor[0]) * TILE_PX, (oy + p.anchor[1]) * TILE_PX);
      const shown = s.cells.some(seen);
      const color = shown ? (this.art?.castleFrame("color", name) ?? null) : null;
      put(s.color, color, at.x, at.y, this.scale);
      put(s.team, shown && team !== null ? (this.art?.castleFrame("team", name) ?? null) : null, at.x, at.y, this.scale);
      put(s.shadow, shown ? (this.art?.castleFrame("shadow", name) ?? null) : null, at.x, at.y, this.scale);
      const tint = s.cells.some(inView) ? 0xffffff : OUT_OF_VIEW;
      s.color.tint = tint;
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
      for (const p of d.pieces) for (const s of [p.color, p.team, p.shadow]) s.destroy();
      for (const f of d.floor) f.sprite.destroy();
    }
    this.towns.clear();
  }
}
