// 地形 drawn from war-game-ui's pictures (R6-51, art-v5; design/b1/atlas-buildings.md section 12,
// art/terrain.ts): the ground the player knows (GameView.ground), its pieces as ui's rules lay them.
// The water, fords and bridge decks lie flat, in that order, under the farms and the castles'
// floors; rock, cliffs and the bridges' rails stand with the buildings and units, by their front
// edges (depth.ts), their shadows in the shadow layer. Shown once explored, darker out of sight, as
// the castles are. Square on only (the pictures' view); otherwise world.ts paints flat colours.

import { Container, Sprite } from "pixi.js";
import { GROUND_ORDER, pieceCells, type TerrainGround, type TerrainPiece, terrainPieces } from "../art/terrain.ts";
import { viewFits } from "../art/structures.ts";
import type { Projection } from "../camera/projection.ts";
import { Fog, Terrain } from "../sim.ts";
import { TILE_PX } from "../tuning.ts";
import type { GameView } from "../view/view.ts";
import { depthOf } from "./depth.ts";
import type { ArtFrame, UnitArt } from "./unit-art.ts";

/** What is not in view now, drawn darker (as buildings remembered). */
const OUT_OF_VIEW = 0x8a8a8a;
/** A metre up on the plane (atlas-buildings.md section 0: 20 × cos 30°). */
const UP_PER_M = Math.sqrt(3) / 2;

interface Drawn {
  color: Sprite;
  shadow: Sprite | null;
  /** Map cells under it, for the fog. */
  cells: number[];
}

export class TerrainDraw {
  private readonly art: UnitArt | null;
  private readonly view: GameView;
  private readonly projection: Projection;
  private readonly flat: Record<TerrainGround, Container>;
  private readonly shadowLayer: Container;
  private readonly upright: Container;
  /** The pictures fit the projection (art-v5 on, square on). */
  readonly pictures: boolean;
  private readonly scale: number;
  /** By frame and anchor: a piece kept while the ground still asks for it (a random map's grows as it is explored). */
  private readonly drawn = new Map<string, Drawn>();
  private groundVersion = -1;
  private fogVersion = -1;
  /** How far up a bridge's deck is on the plane (rules.bridge.deck_top_m): someone on it stands there. */
  private readonly deck: number;

  constructor(art: UnitArt | null, view: GameView, projection: Projection, layers: { ground: Container; shadows: Container; upright: Container }) {
    this.art = art;
    this.view = view;
    this.projection = projection;
    this.shadowLayer = layers.shadows;
    this.upright = layers.upright;
    const t = art?.terrain ?? null;
    this.pictures = t !== null && viewFits(t.view, projection.kind);
    this.scale = projection.ptPerM / (t?.px_per_m ?? 60);
    this.deck = (t?.rules?.bridge?.deck_top_m ?? 0) * projection.ptPerM * UP_PER_M;
    const flat = {} as Record<TerrainGround, Container>;
    for (const g of GROUND_ORDER) {
      flat[g] = new Container();
      layers.ground.addChild(flat[g]);
    }
    this.flat = flat;
  }

  /** Every frame: the pieces again when the known ground changed, their looks when the fog did. */
  update(): void {
    if (!this.pictures) return;
    let dress = this.view.fogVersion !== this.fogVersion;
    if (this.view.groundVersion !== this.groundVersion) {
      this.groundVersion = this.view.groundVersion;
      this.build();
      dress = true;
    }
    if (!dress) return;
    this.fogVersion = this.view.fogVersion;
    const fog = this.view.fog;
    for (const d of this.drawn.values()) {
      const seen = fog === null || d.cells.some((c) => fog[c] !== Fog.Unexplored);
      const tint = fog === null || d.cells.some((c) => fog[c] === Fog.Visible) ? 0xffffff : OUT_OF_VIEW;
      d.color.visible = seen;
      d.color.tint = tint;
      if (d.shadow !== null) d.shadow.visible = seen;
    }
  }

  /** The pieces the known ground asks for: new ones made, those no longer asked for gone. */
  private build(): void {
    const n = this.view.map.size;
    const g = this.view.ground;
    const pieces = terrainPieces((x, y) => g[y * n + x], n, n);
    const keep = new Set<string>();
    pieces.forEach((p, i) => {
      const key = `${p.frame}|${p.x}|${p.y}`;
      keep.add(key);
      if (!this.drawn.has(key)) this.drawn.set(key, this.make(p, i, n));
    });
    for (const [key, d] of this.drawn) {
      if (keep.has(key)) continue;
      d.color.destroy();
      d.shadow?.destroy();
      this.drawn.delete(key);
    }
  }

  private make(p: TerrainPiece, i: number, n: number): Drawn {
    const at = this.projection.toPlane(p.x * TILE_PX, p.y * TILE_PX);
    const color = this.sprite(this.art?.terrainFrame("color", p.frame) ?? null, at.x, at.y);
    const cells = pieceCells(p)
      .filter(([x, y]) => x >= 0 && y >= 0 && x < n && y < n)
      .map(([x, y]) => y * n + x);
    if (p.ground !== undefined) {
      this.flat[p.ground].addChild(color);
      return { color, shadow: null, cells };
    }
    color.zIndex = depthOf(this.projection.toPlane(0, p.front * TILE_PX).y, Math.floor(p.x), 2_000_000 + i);
    this.upright.addChild(color);
    const frame = this.art?.terrainFrame("shadow", p.frame) ?? null;
    const shadow = frame === null ? null : this.sprite(frame, at.x, at.y);
    if (shadow !== null) this.shadowLayer.addChild(shadow);
    return { color, shadow, cells };
  }

  private sprite(f: ArtFrame | null, x: number, y: number): Sprite {
    const s = new Sprite();
    s.visible = false;
    if (f === null) return s;
    s.texture = f.texture;
    s.anchor.set(f.ax, f.ay);
    s.position.set(x, y);
    s.scale.set(f.half ? this.scale * 2 : this.scale);
    return s;
  }

  /**
   * How far up to draw someone standing at (px, py) world px: on a bridge's deck, its height (ui:
   * else the feet sink into it); 0 elsewhere, and without the pictures.
   */
  liftAt(px: number, py: number): number {
    if (!this.pictures || this.deck === 0) return 0;
    const n = this.view.map.size;
    const x = Math.floor(px / TILE_PX);
    const y = Math.floor(py / TILE_PX);
    if (x < 0 || y < 0 || x >= n || y >= n) return 0;
    const t = this.view.ground[y * n + x];
    return t === Terrain.BridgeNS || t === Terrain.BridgeEW ? this.deck : 0;
  }

  /** How many pieces are drawn, by kind (the test page). */
  get counts(): { pieces: number; flat: number; standing: number } {
    let flat = 0;
    for (const d of this.drawn.values()) if (d.shadow === null && d.color.parent !== this.upright) flat++;
    return { pieces: this.drawn.size, flat, standing: this.drawn.size - flat };
  }

  destroy(): void {
    for (const d of this.drawn.values()) {
      d.color.destroy();
      d.shadow?.destroy();
    }
    this.drawn.clear();
    for (const c of Object.values(this.flat)) c.destroy();
  }
}
