// The battlefield in PixiJS, bottom to top: terrain, town zones, buildings, resource nodes,
// selection rings, units, effects (cannon warnings, calibration arcs, rally lines), bars,
// fog, town markers (the player's knowledge, drawn above the fog) and the placement preview.
// Terrain and fog are one small texture each (one texel per cell, scaled up), so they cost
// one sprite. Units, bars and buildings come from pools that only grow.

import { type Application, ColorMatrixFilter, Container, Graphics, type Renderer, Sprite, Text, Texture } from "pixi.js";
import type { Camera } from "../camera/camera.ts";
import { PT_PER_CELL, type Projection, tilted, TOP } from "../camera/projection.ts";
import {
  Action,
  AUTO_TRAIN,
  BuildingField as B,
  BUILDING_STRIDE,
  BuildingFlag,
  BuildingType,
  Fog,
  NEUTRAL,
  NO_OWNER,
  HeaderField as H,
  NodeField as N,
  NodeKind,
  TOWN_STRIDE,
  TICKS_PER_SECOND,
  TownField as T,
  TownChoice,
  TownSize,
  TownState,
  Terrain,
  UNIT_STRIDE,
  UnitField as U,
  UnitType,
  WARNING_STRIDE,
  WarningField as W,
} from "../sim.ts";
import { TILE_PX } from "../tuning.ts";
import type { Placement } from "../ui/placement.ts";
import { FIXED_TO_PX, type GameView } from "../view/view.ts";
import { type Atlas, ENEMY_TINT, NEUTRAL_TINT, OWN_TINT, ownerTint, SHIELD_TINT, WARNING_TINT } from "./atlas.ts";
import { ruleTower, type TowerCells, wallSpot } from "./town-wall.ts";
import { ArtStructures } from "./structure-art.ts";
import { CastleDraw } from "./castle-draw.ts";
import { TerrainDraw } from "./terrain-draw.ts";
import { GroundDraw, type GroundQuality, type GroundTextures } from "./ground-draw.ts";
import type { PendingOrders } from "../game/pending.ts";
import type { Culture } from "../art/spec.ts";
import { ArtUnits } from "./unit-art-draw.ts";
import type { UnitArt } from "./unit-art.ts";

const UNIT_SCALE = 1;
const BAR_W = TILE_PX * 0.8;
const BAR_H = 3;
/** How dark the fog is: never explored, explored but out of sight (0-255). */
const FOG_ALPHA = { unexplored: 255, explored: 140 };
// Ground colours, shared rather than made anew for each cell: on a random map the terrain is
// painted again whenever more of it is explored (D-074), 16 641 cells each time.
const GROUND_RGB = [86, 116, 64] as const;
const GROUND_LIGHT_RGB = [92, 123, 69] as const;
type Rgb = readonly [number, number, number];
/**
 * The ground a Terrain value, flat colours until war-game-ui's tiles (R6-51: art-v5); open ground
 * and a castle's cells (drawn by castle-draw.ts) are grass. The minimap takes the same.
 */
export const TERRAIN_RGB: Readonly<Record<number, Rgb>> = {
  [Terrain.Blocked]: [104, 96, 86],
  [Terrain.Water]: [46, 88, 124],
  [Terrain.Ford]: [88, 128, 140],
  [Terrain.BridgeNS]: [128, 94, 58],
  [Terrain.BridgeEW]: [128, 94, 58],
  [Terrain.Cliff]: [66, 58, 50],
};
/** A bridge's rails, along the way it is crossed (R6-51: its value says which). */
const RAIL_COLOR = 0x3e2a18;
const RAIL_W = TILE_PX * 0.14;

export interface TownLook {
  label: string;
  tint: number;
}

/** GDD §5: neutral, ruins, own and enemy governed must be told apart at a glance (colour and word). */
export function townLook(state: number, owner: number, me: number): TownLook {
  switch (state) {
    case TownState.Neutral:
      return { label: "中立", tint: NEUTRAL_TINT };
    case TownState.Ruins:
      return { label: "廢墟", tint: 0x6d6258 };
    case TownState.AwaitingChoice:
      return { label: owner === me ? "攻下：選搶或治理" : "被攻下", tint: owner === me ? OWN_TINT : ENEMY_TINT };
    case TownState.Plundering:
      return { label: owner === me ? "我方搶奪中" : "敵方搶奪中", tint: owner === me ? OWN_TINT : ENEMY_TINT };
    case TownState.Repairing:
      return { label: owner === me ? "我方修繕中" : "敵方修繕中", tint: owner === me ? OWN_TINT : ENEMY_TINT };
    default:
      return { label: owner === me ? "我方治理" : "敵方治理", tint: owner === me ? OWN_TINT : ENEMY_TINT };
  }
}

/** Where an order went, as a ring that grows and fades (feedback that it was sent). */
interface Marker {
  x: number;
  y: number;
  color: number;
  at: number;
}

const MARKER_MS = 600;

interface UnitSprites {
  body: Sprite;
  ring: Sprite;
  shield: Sprite;
  hpBack: Sprite;
  hpFront: Sprite;
  shBack: Sprite;
  shFront: Sprite;
}

interface BuildingSprites {
  base: Sprite;
  glyph: Sprite;
  /** 裡面有人 (BuildingFlag.Occupied, round 7). */
  occupied: Sprite;
  /** 自動訓練 paused (R6-31): left of 裡面有人. */
  paused: Sprite;
  hpBack: Sprite;
  hpFront: Sprite;
}

/** An arrow a building or a soldier hiding in it shot (`shot` event, round 7), flying for SHOT_MS. */
interface Shot {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  at: number;
}

const SHOT_MS = 300;

/** 晶砲預警圈 B's pictures, bottom to top (design/b1/README.md). */
const WARN_LAYERS = ["warn_fill", "warn_sigil_glow", "warn_rim", "warn_sigil", "warn_sigil_gold", "warn_core"] as const;

interface TownMark {
  /** Where the wall stands on the ground (world px; render/town-wall.ts). */
  spot: { x: number; y: number; side: number };
  /** The wall and its 鎮 or 城 (D-084), standing behind buildings and units. */
  wall: Sprite;
  glyph: Sprite;
  /** The state's words and the bar, under the wall, above the fog. */
  holder: Container;
  label: Text;
  barBack: Sprite;
  barFront: Sprite;
  key: string;
}

// Two kinds of layers (D-085, docs/sprite-atlas.md section 1). What lies on the ground (terrain,
// fog, town circles, footprints, rings, marks on the ground, the placement preview) is drawn in
// world px inside `ground`, which the projection lays out (as a diamond: turned 45° and flattened
// 2:1). What stands up (units, buildings' and nodes' marks, towns' 鎮 and 城, bars, words, arrows in the air)
// is drawn on the plane at the projected point, never flattened, the nearer in front.

export class WorldRenderer {
  readonly root = new Container();
  private readonly view: GameView;
  private readonly atlas: Atlas;
  private readonly projection: Projection;
  /** The ground: `groundInner` turns (and scales), `groundOuter` flattens. World px inside. */
  private readonly groundOuter = new Container();
  private readonly groundInner = new Container();
  private readonly zones = new Graphics();
  /** Buildings' footprints (the shapes), on the ground. */
  private readonly baseLayer = new Container();
  private readonly wallLayer = new Container();
  /** As a diamond, the towns' walls lie on the ground (a stand-in until the buildings' atlas), above the fog: the player's knowledge. */
  private readonly wallGround = new Container();
  /** Units' shadows from their atlases (D-085): pictures, standing like the units, under them. */
  private readonly shadowLayer = new Container();
  private readonly ringLayer = new Container();
  /** What stands up: units, buildings' and nodes' marks, sorted by their place on the plane. */
  private readonly unitLayer = new Container();
  /** Marks on the ground (orders, warnings, the cannon's calibration, a selected building). */
  private readonly fx = new Graphics();
  /** Arrows in the air, on the plane. */
  private readonly airFx = new Graphics();
  private readonly barLayer = new Container();
  private readonly townLayer = new Container();
  private readonly ghost = new Graphics();
  private readonly terrainTexture: Texture;
  private readonly fogCanvas: HTMLCanvasElement;
  private readonly fogTexture: Texture;
  private readonly fogPixels: ImageData;
  private fogVersion = -1;
  private readonly terrainCanvas: HTMLCanvasElement;
  private readonly terrainPixels: ImageData;
  /** The ground drawn (D-074: a random map's grows as it is explored). */
  private groundVersion = 0;
  /** Terrain repaints after more ground was explored (random map) and their CPU time in ms, for the test page. */
  readonly terrainRepaints = { count: 0, totalMs: 0, maxMs: 0 };
  /** Bridges' rails over the ground's colours. */
  private readonly rails = new Graphics();
  private nodesVersion = -1;
  private readonly nodeSprites = new Map<number, { sprite: Sprite; cell: number }>();
  private readonly unitPool: UnitSprites[] = [];
  private readonly buildingPool: BuildingSprites[] = [];

  /** Pause marks shown on buildings (自動訓練 paused), for the test hook. */
  get pauseMarks(): number {
    return this.buildingPool.filter((p) => p.paused.visible).length;
  }
  private readonly townMarks = new Map<number, TownMark>();
  /** The big cities' towers, kept once seen: the wall stays under where the tower stood (D-084). */
  private readonly towers = new Map<number, TowerCells>();
  private zonesKey = "";
  private markers: Marker[] = [];
  private shots: Shot[] = [];
  /** Arrows drawn since the game started (tests). */
  shotCount = 0;

  /** The game's orders sent and not in the snapshot yet (pending.ts): sites to come, 搶 or 治理. */
  pending: PendingOrders | null = null;
  /** 自動訓練 paused for this building by the player (D-098: the screen's own; the simulation's flag is off for him). */
  autoPaused: (building: number) => boolean = () => false;
  /** The game is paused: orders wait for 繼續, and what they will do is drawn so (R6-31). */
  paused = false;
  /** A building preview put away with ✗: it shrinks and fades (R6-25-11). */
  private dropped: { x: number; y: number; w: number; h: number; color: number; at: number } | null = null;
  /** 繼續後開工 under each building ordered while paused. */
  private readonly siteLabels: Text[] = [];

  /** Units drawn from war-game-ui's atlases (D-085), or null: the shapes. */
  private readonly artUnits: ArtUnits | null;
  /** Buildings and nodes from the atlases (art-v2 on), or null: the shapes. */
  private readonly artStructures: ArtStructures | null;
  /** What lies on the ground drawn as pictures (fields, rubble, stumps): under every unit and building, on the plane. */
  private readonly groundArt = new Container();
  /** The cannon's warnings drawn from the effects atlas (晶砲預警圈 B, art-v2 on): a container each, lying on the ground. */
  private readonly warnLayer = new Container();
  /** The towns' castles (D-089): pictures (art-v4, square on), or blocks on the ground. */
  private readonly castle: CastleDraw;
  /** The ground's pictures (art-v5, R6-51): the water, fords and decks lying in `terrainGround`, under the farms and castles' floors. */
  private readonly terrain: TerrainDraw;
  private readonly terrainGround = new Container();
  /** The two greens (and, without ui's pictures, the terrain's flat colours): under 寫實地面 when it is on. */
  private readonly flatGround: Sprite;
  /** 寫實地面 (D-093, ?test=1&ground=real): null while the flat ground is drawn. */
  private groundDraw: GroundDraw | null = null;
  /** The ground and resource points its weights were made from. */
  private groundKey = "";
  /** The castles' blocks, on the ground under the fog (castle-draw.ts). */
  private readonly castleBlocks = new Graphics();
  /**
   * Units behind a castle's wall (D-089, atlas-buildings.md section 11): their pictures again over
   * the walls, one layer a colour (ours, the enemy's, the neutral militia's), at 45 %; the selected
   * ones' rings over the walls too. "outline" (test pages, ?ghost=outline): only their rims.
   */
  private readonly ghostLayers: Record<"own" | "enemy" | "neutral", Container>;
  private readonly ghostRings = new Graphics();
  ghostStyle: "fill" | "outline" = "fill";
  /** Units drawn behind a wall this frame (test page). */
  ghostCount = 0;
  private readonly warnPool: Container[] = [];

  /** `art`: the units' atlases (D-085), `cultureOf` which culture each player wears; `projection` how the ground lies. */
  constructor(app: Application, view: GameView, atlas: Atlas, art: UnitArt | null = null, cultureOf: (owner: number) => Culture = (owner) => (owner === 1 ? "w" : "e"), projection: Projection = TOP) {
    this.view = view;
    this.atlas = atlas;
    this.projection = projection;
    this.unitLayer.sortableChildren = true;
    this.artStructures = art !== null && ArtStructures.has(art, projection) ? new ArtStructures(art, view, { ground: this.groundArt, shadows: this.shadowLayer, upright: this.unitLayer }, cultureOf, projection) : null;
    // A unit's depth among the buildings' footprints (structure-art.ts), else its place on the screen.
    const depth = (px: number, py: number): number => this.artStructures?.unitDepth(px, py) ?? py;
    this.artUnits = art === null ? null : new ArtUnits(art, view, this.shadowLayer, this.unitLayer, cultureOf, projection, depth);
    if (this.artStructures !== null) {
      const structures = this.artStructures;
      view.pictureAt = (px, py) => structures.pictureAt(px, py);
      view.coverAt = (px, py, ux, uy) => structures.coverAt(px, py, ux, uy);
    }
    this.castle = new CastleDraw(art, view, projection, { floor: this.groundArt, shadows: this.shadowLayer, upright: this.unitLayer, blocks: this.castleBlocks });
    this.terrain = new TerrainDraw(art, view, projection, { ground: this.terrainGround, shadows: this.shadowLayer, upright: this.unitLayer });
    const ghostLayer = (color: number): Container => {
      const c = new Container();
      const f = new ColorMatrixFilter();
      // Every pixel the colour, its alpha kept.
      f.matrix = [0, 0, 0, 0, ((color >> 16) & 255) / 255, 0, 0, 0, 0, ((color >> 8) & 255) / 255, 0, 0, 0, 0, (color & 255) / 255, 0, 0, 0, 1, 0];
      c.filters = [f];
      c.alpha = GHOST_ALPHA;
      return c;
    };
    this.ghostLayers = { own: ghostLayer(OWN_TINT), enemy: ghostLayer(ENEMY_TINT), neutral: ghostLayer(NEUTRAL_TINT) };
    const castle = this.castle;
    view.wallPictureAt = (px, py) => castle.wallPictureAt(px, py);
    const size = view.map.size;

    const terrain = document.createElement("canvas");
    terrain.width = size;
    terrain.height = size;
    this.terrainCanvas = terrain;
    this.terrainPixels = (terrain.getContext("2d") as CanvasRenderingContext2D).createImageData(size, size);
    this.paintTerrain();
    const terrainTex = Texture.from(terrain);
    this.terrainTexture = terrainTex;
    terrainTex.source.scaleMode = "nearest";
    const ground = new Sprite(terrainTex);
    ground.scale.set(TILE_PX);
    this.flatGround = ground;

    this.fogCanvas = document.createElement("canvas");
    this.fogCanvas.width = size;
    this.fogCanvas.height = size;
    const fctx = this.fogCanvas.getContext("2d") as CanvasRenderingContext2D;
    this.fogPixels = fctx.createImageData(size, size);
    for (let i = 0; i < size * size; i++) this.fogPixels.data[i * 4 + 3] = FOG_ALPHA.unexplored;
    fctx.putImageData(this.fogPixels, 0, 0);
    this.fogTexture = Texture.from(this.fogCanvas);
    this.fogTexture.source.scaleMode = "linear";
    const fog = new Sprite(this.fogTexture);
    fog.scale.set(TILE_PX);

    // The projection's matrix as two containers (a container scales, then turns): as a diamond
    // turned 45° at 1.25 (40 points a cell's side), square on (D-088) not turned; then flattened
    // to half its height.
    if (tilted(projection)) {
      if (projection.kind === "diamond") this.groundInner.rotation = Math.PI / 4;
      this.groundInner.scale.set(PT_PER_CELL / TILE_PX);
      this.groundOuter.scale.set(1, 0.5);
    }
    this.groundInner.addChild(ground, this.rails, this.castleBlocks, this.zones, this.baseLayer, this.ringLayer, this.fx, this.warnLayer, this.ghost, fog, this.wallGround);
    this.groundOuter.addChild(this.groundInner);
    this.root.addChild(this.groundOuter, this.terrainGround, this.groundArt, this.wallLayer, this.shadowLayer, this.unitLayer, this.ghostLayers.own, this.ghostLayers.enemy, this.ghostLayers.neutral, this.ghostRings, this.airFx, this.barLayer, this.townLayer);
    app.stage.addChild(this.root);
  }

  draw(now: number, camera: Camera, placement: Placement | null): void {
    this.root.scale.set(camera.scale);
    this.root.position.set(-camera.x * camera.scale, -camera.y * camera.scale);
    const curr = this.view.curr;
    if (curr === null) return;
    this.drawTerrain();
    this.drawFog();
    this.drawNodes();
    this.drawBuildings();
    this.drawTowns();
    this.castle.update();
    this.terrain.update();
    this.updateGround();
    this.fx.clear();
    this.airFx.clear();
    this.drawUnits(now);
    this.drawWarnings(now);
    this.drawSelectionExtras();
    this.drawMarkers(now);
    this.drawShots(now);
    this.drawGhost(placement, now);
  }

  /** The building preview was put away with ✗ (world px): shrink it and fade it out (R6-25-11). */
  dropGhost(rect: { x: number; y: number; w: number; h: number }, valid: boolean, now: number): void {
    this.dropped = { ...rect, color: valid ? PLACE_OK : PLACE_BAD, at: now };
  }

  /** Take this game's drawing off the stage (the shared shapes stay). */
  destroy(): void {
    this.artUnits?.destroy();
    this.castle.destroy();
    this.terrain.destroy();
    this.groundDraw?.destroy();
    this.root.parent?.removeChild(this.root);
    this.root.destroy({ children: true });
    this.terrainTexture.destroy(true);
    this.fogTexture.destroy(true);
  }

  /** Flash a ring at a world point (px). */
  mark(x: number, y: number, color: number, now: number): void {
    this.markers.push({ x, y, color, at: now });
    if (this.markers.length > 8) this.markers.shift();
  }

  /** An arrow from a building (world px) to a unit, drawn flying for a moment (round 7). */
  shot(fromX: number, fromY: number, toX: number, toY: number, now: number): void {
    this.shots.push({ fx: fromX, fy: fromY, tx: toX, ty: toY, at: now });
    this.shotCount++;
    if (this.shots.length > 40) this.shots.shift();
  }

  private drawShots(now: number): void {
    this.shots = this.shots.filter((s) => now - s.at < SHOT_MS);
    for (const s of this.shots) {
      const k = (now - s.at) / SHOT_MS;
      // In the air: from and to on the plane, the arrow drawn there (not flattened).
      const from = this.projection.toPlane(s.fx, s.fy);
      const to = this.projection.toPlane(s.tx, s.ty);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const x = from.x + dx * k;
      const y = from.y + dy * k;
      const ux = dx / len;
      const uy = dy / len;
      // A shaft 12 px long with a head: it leaves the building and flies to the target.
      this.airFx.moveTo(x - ux * 12, y - uy * 12).lineTo(x, y).stroke({ width: 2.5, color: 0x2a1c10 });
      this.airFx.moveTo(x - ux * 12, y - uy * 12).lineTo(x, y).stroke({ width: 1.2, color: 0xf4e2b0 });
      this.airFx.poly([x + ux * 4, y + uy * 4, x - ux * 2 - uy * 3, y - uy * 2 + ux * 3, x - ux * 2 + uy * 3, y - uy * 2 - ux * 3]).fill(0xf4e2b0);
    }
  }

  private drawMarkers(now: number): void {
    this.markers = this.markers.filter((m) => now - m.at < MARKER_MS);
    for (const m of this.markers) {
      const k = (now - m.at) / MARKER_MS;
      this.fx.circle(m.x, m.y, TILE_PX * (0.3 + 0.5 * k)).stroke({ width: 3, color: m.color, alpha: 1 - k });
    }
  }

  /**
   * The ground the player knows (GameView.ground), one texel per cell, and the bridges' rails: in flat
   * colours, or grass under ui's pictures (art-v5, terrain-draw.ts).
   */
  private paintTerrain(): void {
    const flat = !this.terrain.pictures;
    const size = this.view.map.size;
    const g = this.view.ground;
    const d = this.terrainPixels.data;
    const rails = this.rails.clear();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const t = g[y * size + x];
        const c = (flat ? TERRAIN_RGB[t] : undefined) ?? ((x + y) % 2 === 0 ? GROUND_RGB : GROUND_LIGHT_RGB);
        const o = (y * size + x) * 4;
        d[o] = c[0];
        d[o + 1] = c[1];
        d[o + 2] = c[2];
        d[o + 3] = 255;
        // A rail on each side the bridge ends: west and east of a north-south one, north and south of an east-west one.
        if (!flat || (t !== Terrain.BridgeNS && t !== Terrain.BridgeEW)) continue;
        const bridge = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < size && cy < size && g[cy * size + cx] === t;
        const x0 = x * TILE_PX;
        const y0 = y * TILE_PX;
        if (t === Terrain.BridgeNS) {
          if (!bridge(x - 1, y)) rails.rect(x0, y0, RAIL_W, TILE_PX);
          if (!bridge(x + 1, y)) rails.rect(x0 + TILE_PX - RAIL_W, y0, RAIL_W, TILE_PX);
        } else {
          if (!bridge(x, y - 1)) rails.rect(x0, y0, TILE_PX, RAIL_W);
          if (!bridge(x, y + 1)) rails.rect(x0, y0 + TILE_PX - RAIL_W, TILE_PX, RAIL_W);
        }
      }
    }
    rails.fill(RAIL_COLOR);
    (this.terrainCanvas.getContext("2d") as CanvasRenderingContext2D).putImageData(this.terrainPixels, 0, 0);
    this.groundVersion = this.view.groundVersion;
  }

  /** Ground explored since the last frame (random map): the terrain texture again. */
  private drawTerrain(): void {
    if (this.view.groundVersion === this.groundVersion) return;
    const t0 = performance.now();
    this.paintTerrain();
    this.terrainTexture.source.update();
    const ms = performance.now() - t0;
    this.terrainRepaints.count++;
    this.terrainRepaints.totalMs += ms;
    this.terrainRepaints.maxMs = Math.max(this.terrainRepaints.maxMs, ms);
  }

  private drawFog(): void {
    const fog = this.view.fog;
    if (fog === null || this.view.fogVersion === this.fogVersion) return;
    this.fogVersion = this.view.fogVersion;
    const d = this.fogPixels.data;
    for (let i = 0; i < fog.length; i++) {
      d[i * 4 + 3] = fog[i] === Fog.Visible ? 0 : fog[i] === Fog.Explored ? FOG_ALPHA.explored : FOG_ALPHA.unexplored;
    }
    (this.fogCanvas.getContext("2d") as CanvasRenderingContext2D).putImageData(this.fogPixels, 0, 0);
    this.fogTexture.source.update();
    // The fog lies on the ground; what stands in it (nodes' marks) is dimmed by hand.
    for (const n of this.nodeSprites.values()) n.sprite.tint = this.fogTint(n.cell);
    this.artStructures?.tintNodes();
  }

  /** What stands on a cell, by its fog: as seen, or dimmed (explored, not in sight). */
  private fogTint(cell: number): number {
    const fog = this.view.fog;
    return fog === null || fog[cell] === Fog.Visible ? 0xffffff : 0x6f6f6f;
  }

  private drawNodes(): void {
    if (this.view.nodesVersion === this.nodesVersion) return;
    this.nodesVersion = this.view.nodesVersion;
    // From the atlases (art-v2 on): trees, mines, berries, veins and what is left of them.
    if (this.artStructures?.drawsNodes === true) {
      this.artStructures.drawNodes();
      return;
    }
    for (const [id, row] of this.view.nodes) {
      let n = this.nodeSprites.get(id);
      if (n === undefined) {
        const s = new Sprite(this.atlas.nodes[row[N.kind]]);
        // Standing on its cell's middle (a node's mark is a picture, not ground).
        s.anchor.set(0.5, 0.6);
        const p = this.projection.toPlane((row[N.cellX] + 0.5) * TILE_PX, (row[N.cellY] + 0.5) * TILE_PX);
        s.position.set(p.x, p.y);
        s.zIndex = p.y;
        this.unitLayer.addChild(s);
        n = { sprite: s, cell: row[N.cellY] * this.view.map.size + row[N.cellX] };
        this.nodeSprites.set(id, n);
        s.tint = this.fogTint(n.cell);
      }
      n.sprite.visible = row[N.amount] > 0;
    }
  }

  private drawBuildings(): void {
    const b = (this.view.curr as NonNullable<GameView["curr"]>).snap.buildings;
    const n = b.length / BUILDING_STRIDE;
    while (this.buildingPool.length < n) {
      const base = new Sprite(this.atlas.building);
      const glyph = new Sprite(Texture.EMPTY);
      glyph.anchor.set(0.5);
      const occupied = new Sprite(this.atlas.occupied);
      occupied.anchor.set(1, 0);
      const paused = new Sprite(this.atlas.paused);
      paused.anchor.set(1, 0);
      const hpBack = new Sprite(this.atlas.white);
      hpBack.tint = 0x201a18;
      const hpFront = new Sprite(this.atlas.white);
      this.baseLayer.addChild(base);
      this.unitLayer.addChild(glyph, occupied, paused);
      this.barLayer.addChild(hpBack, hpFront);
      this.buildingPool.push({ base, glyph, occupied, paused, hpBack, hpFront });
    }
    this.artStructures?.begin();
    for (let i = 0; i < this.buildingPool.length; i++) {
      const p = this.buildingPool[i];
      const shown = i < n;
      p.base.visible = p.glyph.visible = shown;
      p.occupied.visible = p.paused.visible = false;
      p.hpBack.visible = p.hpFront.visible = false;
      if (!shown) {
        this.artStructures?.hideSlot(i);
        continue;
      }
      const o = i * BUILDING_STRIDE;
      const type = b[o + B.type];
      const info = this.view.rules.buildings[type];
      const size = (info?.size ?? 1) * TILE_PX;
      const x = b[o + B.cellX] * TILE_PX;
      const y = b[o + B.cellY] * TILE_PX;
      const remembered = (b[o + B.flags] & BuildingFlag.Remembered) !== 0;
      const building = b[o + B.progress] < 1000;
      p.base.texture = type === BuildingType.Farm ? this.atlas.farm : type === BuildingType.ArrowTower ? this.atlas.tower : this.atlas.building;
      p.base.position.set(x, y);
      p.base.width = size;
      p.base.height = size;
      p.base.tint = type === BuildingType.Farm ? 0xffffff : ownerTint(b[o + B.owner], this.view.me);
      p.base.alpha = remembered ? 0.55 : building ? 0.6 : 1;
      // The footprint lies on the ground; its glyph stands in its middle, the shield at its right corner.
      const mid = this.projection.toPlane(x + size / 2, y + size / 2);
      const top = this.projection.toPlane(x, y);
      const right = this.projection.toPlane(x + size, y);
      p.glyph.texture = this.atlas.glyphs[type] ?? Texture.EMPTY;
      p.glyph.position.set(mid.x, mid.y);
      p.glyph.zIndex = mid.y;
      p.glyph.scale.set(Math.min(size * 0.5, 36) / 36);
      p.glyph.alpha = p.base.alpha;
      // 裡面有人 (round 7): a small shield at the top right corner, ours and the enemy's in view.
      // An outpost holding (D-080): a 守 tag there instead.
      const holding = type === BuildingType.Outpost && (b[o + B.flags] & BuildingFlag.Hold) !== 0;
      const marked = ((b[o + B.flags] & BuildingFlag.Occupied) !== 0 || holding) && !remembered;
      const markScale = Math.max(1, size / 48);
      if (marked) {
        p.occupied.texture = holding ? this.atlas.hold : this.atlas.occupied;
        p.occupied.visible = true;
        p.occupied.position.set(right.x - 2, right.y + 2);
        p.occupied.zIndex = mid.y + 1;
        p.occupied.scale.set(markScale);
      }
      // 自動訓練 paused on our finished barracks, range, mage hall or stable (R6-31): a pause mark the
      // size of 裡面有人, in its place or left of it. The player's pause, kept by the screen (D-098).
      if (b[o + B.owner] === this.view.me && !building && AUTO_TRAIN.buildings.includes(type) && this.autoPaused(b[o + B.id])) {
        p.paused.visible = true;
        p.paused.position.set(right.x - 2 - (marked ? 18 * markScale : 0), right.y + 2);
        p.paused.zIndex = mid.y + 1;
        p.paused.scale.set(markScale);
      }
      // From its atlas (art-v2 on): its picture instead of the footprint and the glyph; the bar over its top.
      const picture = this.artStructures?.building(i, o) ?? null;
      if (picture !== null) p.base.visible = p.glyph.visible = false;
      const hp = b[o + B.hp];
      const max = info?.hp ?? hp;
      const selected = this.view.selection.building === b[o + B.id];
      if (building || hp < max || selected) {
        const frac = building ? b[o + B.progress] / 1000 : max > 0 ? hp / max : 1;
        this.bar(p.hpBack, p.hpFront, mid.x, Math.min(top.y, picture?.top ?? top.y) - 4, size * 0.8, frac, building ? 0xe7c35a : ownerTint(b[o + B.owner], this.view.me));
      }
    }
  }

  private drawTowns(): void {
    const snap = (this.view.curr as NonNullable<GameView["curr"]>).snap;
    const t = snap.towns;
    const towerSize = this.view.rules.buildings[BuildingType.TownTower]?.size ?? 2;
    if (this.noteTowers(snap.buildings, towerSize)) this.zonesKey = "";
    // 搶 or 治理 chosen and not taken yet (the game paused): said under the town (pending.ts).
    const chosen = this.paused ? [...this.view.knownTowns.keys()].map((id) => this.pending?.townChoice(id) ?? -1) : [];
    const key = `${t.join(",")}|${chosen.join(",")}`;
    if (key === this.zonesKey) return;
    this.zonesKey = key;
    this.zones.clear();
    const seen = new Set<number>();
    for (let o = 0; o < t.length; o += TOWN_STRIDE) {
      const id = t[o + T.id];
      const info = this.view.knownTowns.get(id);
      if (info === undefined) continue;
      seen.add(id);
      const look = townLook(t[o + T.state], t[o + T.owner], this.view.me);
      const cx = (info.cellX + 0.5) * TILE_PX;
      const cy = (info.cellY + 0.5) * TILE_PX;
      // A castle (D-089) is its own range: its walls (castle-draw.ts). Before them, the circle.
      const box = this.view.castleBox(info);
      if (box === null) this.zones.circle(cx, cy, info.radius * TILE_PX).fill({ color: look.tint, alpha: 0.1 }).stroke({ width: 3, color: look.tint, alpha: 0.75 });
      let mark = this.townMarks.get(id);
      if (mark === undefined) {
        const wall = new Sprite(this.atlas.wall);
        wall.anchor.set(0.5, tilted(this.projection) ? 0.5 : 1);
        const glyph = new Sprite(this.atlas.townGlyphs[info.size] ?? Texture.EMPTY);
        glyph.anchor.set(0.5);
        (tilted(this.projection) ? this.wallGround : this.wallLayer).addChild(wall);
        this.wallLayer.addChild(glyph);
        const holder = new Container();
        const label = new Text({ text: "", style: { fontFamily: "-apple-system, 'Noto Sans TC', sans-serif", fontSize: 13, fontWeight: "700", fill: 0xffffff, stroke: { color: 0x000000, width: 3 } }, resolution: 4 });
        label.anchor.set(0.5, 0);
        label.position.set(0, 4);
        const barBack = new Sprite(this.atlas.white);
        barBack.tint = 0x201a18;
        const barFront = new Sprite(this.atlas.white);
        holder.addChild(label, barBack, barFront);
        this.townLayer.addChild(holder);
        mark = { spot: { x: 0, y: 0, side: 0 }, wall, glyph, holder, label, barBack, barFront, key: "" };
        this.townMarks.set(id, mark);
      }
      // The big city's wall under its tower, as seen or as the rules place it (render/town-wall.ts).
      const spot = wallSpot(info, info.size === TownSize.Large ? (this.towers.get(id) ?? ruleTower(info, towerSize)) : null);
      mark.spot = spot;
      mark.holder.visible = true;
      // With a castle (D-089) no symbol: the walls show the town; 鎮 or 城 in its middle only with no pictures of them.
      mark.wall.visible = box === null;
      mark.glyph.visible = box === null || !this.castle.pictures;
      // On its spot, its words under its nearest corner (as a diamond, the bottom one).
      const mid = this.projection.toPlane(spot.x + spot.side / 2, spot.y + spot.side / 2);
      const foot = this.projection.toPlane(spot.x + spot.side, spot.y + spot.side);
      mark.wall.tint = look.tint;
      if (tilted(this.projection)) {
        // Lying on the ground like the buildings' footprints (standing up, a big city's hid the fighting
        // behind it), its 鎮 or 城 standing in the middle.
        mark.wall.position.set(spot.x + spot.side / 2, spot.y + spot.side / 2);
        mark.wall.width = mark.wall.height = spot.side;
        mark.glyph.position.set(mid.x, mid.y);
        mark.glyph.scale.set((spot.side * (PT_PER_CELL / TILE_PX) * 0.3) / 36);
      } else {
        // Seen from above, the square symbol over the spot.
        mark.wall.position.set(mid.x, foot.y);
        mark.wall.width = mark.wall.height = spot.side;
        mark.glyph.position.set(mid.x, foot.y - spot.side * 0.58);
        mark.glyph.scale.set((spot.side * 0.34) / 36);
      }
      if (box === null) mark.holder.position.set(mid.x, foot.y);
      else {
        // Its words under its south wall (R6-06).
        const at = this.projection.toPlane((box.x0 + box.x1 + 1) * 0.5 * TILE_PX, (box.y1 + 1) * TILE_PX);
        mark.holder.position.set(at.x, at.y);
        if (!this.castle.pictures) mark.glyph.position.set(this.projection.toPlane(cx, cy).x, this.projection.toPlane(cx, cy).y);
      }
      const choice = this.paused ? (this.pending?.townChoice(id) ?? null) : null;
      mark.label.text = choice === null || t[o + T.state] !== TownState.AwaitingChoice ? look.label : `${choice === TownChoice.Plunder ? "搶" : "治理"}（繼續後開始）`;
      const total = t[o + T.timerTotal];
      const showBar = total > 0 && t[o + T.timer] > 0;
      mark.barBack.visible = mark.barFront.visible = showBar;
      if (showBar) {
        const done = 1 - t[o + T.timer] / total;
        this.bar(mark.barBack, mark.barFront, 0, 26, 48, done, look.tint);
      }
    }
    for (const [id, mark] of this.townMarks) if (!seen.has(id)) mark.wall.visible = mark.glyph.visible = mark.holder.visible = false;
  }

  /** The units' atlases (D-085): which, how many pages, and how many units drawn from them; null: the shapes. */
  get artDrawn(): { label: string; pages: number; units: number; corpses: number; buildings: number; rubble: number; nodes: number } | null {
    const a = this.artUnits;
    return a === null ? null : { label: a.art.label, pages: a.art.pages, ...a.drawn, ...(this.artStructures?.counts ?? { buildings: 0, rubble: 0, nodes: 0 }) };
  }

  /**
   * 寫實地面 (D-093): ui's ground blended on the GPU instead of the two greens. Only over ui's terrain
   * pictures (art-v5 on, square on): the water is theirs; without them the flat colours stay. False then.
   */
  useGround(textures: GroundTextures, quality: GroundQuality): boolean {
    if (!this.terrain.pictures) return false;
    this.groundDraw = new GroundDraw(textures, this.view.map.size, quality);
    this.groundInner.addChildAt(this.groundDraw.mesh, 0);
    this.flatGround.visible = false;
    this.groundKey = "";
    this.updateGround();
    return true;
  }

  /** 寫實地面's quality (高: two samples a texture, 低: one), for the 量測 panel. */
  setGroundQuality(q: GroundQuality): void {
    this.groundDraw?.setQuality(q);
  }

  /** 寫實地面's cost over a `w` × `h` pixel screen (GroundDraw.measure) and its textures' MB; null when it is not drawn. */
  measureGround(renderer: Renderer, w: number, h: number): { high: number; low: number; plain: number; mb: number } | null {
    const g = this.groundDraw;
    return g === null ? null : { ...g.measure(renderer, w, h), mb: g.memoryMB };
  }

  /** What draws the ground now (the test page and the 量測 panel). */
  get groundLook(): { real: boolean; quality: GroundQuality | null } {
    return { real: this.groundDraw !== null, quality: this.groundDraw?.currentQuality ?? null };
  }

  /** The ground's weights again when the known ground or the resource points changed. */
  private updateGround(): void {
    const g = this.groundDraw;
    if (g === null) return;
    const key = `${this.view.groundVersion}|${this.view.nodesVersion}`;
    if (key === this.groundKey) return;
    this.groundKey = key;
    const n = this.view.map.size;
    const nodes: number[] = [];
    for (const row of this.view.nodes.values()) if (row[N.kind] !== NodeKind.Tree && row[N.amount] > 0) nodes.push(row[N.cellY] * n + row[N.cellX]);
    g.setGround(this.view.ground, nodes);
  }

  /** The ground's pictures drawn (art-v5), for the test page. */
  get terrainCounts(): { pictures: boolean; pieces: number; flat: number; standing: number } {
    return { pictures: this.terrain.pictures, ...this.terrain.counts };
  }

  /** How far up someone at (px, py) world px is drawn (a bridge's deck), for the test page. */
  liftAt(px: number, py: number): number {
    return this.terrain.liftAt(px, py);
  }

  /** The castles as drawn (castle-draw.ts), for the test page. */
  get castleCounts(): { pieces: number; tiles: number; blockTowns: number; misfit: number } {
    return this.castle.counts;
  }

  /** Each town's wall's spot on the ground (world px), for the test page. */
  get townWalls(): { id: number; x: number; y: number; side: number; visible: boolean }[] {
    return [...this.townMarks].map(([id, m]) => ({ id, x: m.spot.x, y: m.spot.y, side: m.spot.side, visible: m.wall.visible }));
  }

  /** The big cities' towers in this snapshot (remembered ones too), kept; whether one was new. */
  private noteTowers(b: Int32Array, size: number): boolean {
    let found = false;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      if (b[o + B.type] !== BuildingType.TownTower) continue;
      const x = b[o + B.cellX] + size / 2;
      const y = b[o + B.cellY] + size / 2;
      for (const town of this.view.knownTowns.values()) {
        if (town.size !== TownSize.Large || this.towers.has(town.id)) continue;
        if ((x - town.cellX - 0.5) ** 2 + (y - town.cellY - 0.5) ** 2 > town.radius ** 2) continue;
        this.towers.set(town.id, { cellX: b[o + B.cellX], cellY: b[o + B.cellY], size });
        found = true;
      }
    }
    return found;
  }

  private drawUnits(now: number): void {
    const view = this.view;
    const curr = view.curr as NonNullable<GameView["curr"]>;
    const prev = view.prev;
    const u = curr.snap.units;
    const n = u.length / UNIT_STRIDE;
    const alpha = Math.min(Math.max((now - curr.at) / (1000 / view.tps), 0), 1);
    const paused = curr.snap.header[H.paused] === 1;
    const pu = prev?.snap.units;
    const sel = view.selection.units;
    this.ghostRings.clear();
    this.ghostCount = 0;
    // A layer with no one behind a wall this frame is hidden: its filter's pass is skipped.
    const ghosts = { own: 0, enemy: 0, neutral: 0 };
    const walls = this.castle.hasPieces && this.artUnits !== null;
    // The selection ring's size on the plane (the ground's ring: 16 world px at 1.05).
    const ringX = this.projection.toPlane(17, 0).x - this.projection.toPlane(0, 0).x;
    const ringY = this.projection.toPlane(0, 17).y - this.projection.toPlane(0, 0).y;
    // The atlases' clock: the simulation's time, between the last two snapshots (D-085).
    const tick = curr.snap.header[H.tick];
    const seconds = (paused || prev === null ? tick : tick - 1 + alpha) / TICKS_PER_SECOND;
    this.artUnits?.snapshot(seconds);
    this.artStructures?.snapshot(seconds);
    this.artStructures?.drawRubble(seconds);
    while (this.unitPool.length < n) {
      const ring = new Sprite(this.atlas.ring);
      ring.anchor.set(0.5);
      const shield = new Sprite(this.atlas.ring);
      shield.anchor.set(0.5);
      shield.tint = SHIELD_TINT;
      const body = new Sprite(this.atlas.units[0]);
      body.anchor.set(0.5);
      const mk = (tint: number) => {
        const s = new Sprite(this.atlas.white);
        s.tint = tint;
        return s;
      };
      const p: UnitSprites = { body, ring, shield, hpBack: mk(0x201a18), hpFront: mk(0xffffff), shBack: mk(0x201a18), shFront: mk(SHIELD_TINT) };
      // The selection ring and the shape's shield lie on the ground; the shape stands.
      this.ringLayer.addChild(ring, shield);
      this.unitLayer.addChild(body);
      this.barLayer.addChild(p.hpBack, p.hpFront, p.shBack, p.shFront);
      this.unitPool.push(p);
    }
    let pi = 0;
    for (let i = 0; i < this.unitPool.length; i++) {
      const p = this.unitPool[i];
      const o = i * UNIT_STRIDE;
      const shown = i < n && u[o + U.action] !== Action.Garrisoned;
      p.body.visible = shown;
      p.ring.visible = p.shield.visible = false;
      p.hpBack.visible = p.hpFront.visible = p.shBack.visible = p.shFront.visible = false;
      if (!shown) {
        this.artUnits?.hideSlot(i);
        continue;
      }
      const id = u[o + U.id];
      let x = u[o + U.x];
      let y = u[o + U.y];
      if (pu !== undefined && !paused) {
        // Both tables are sorted by id: walk the previous one alongside.
        while (pi < pu.length && pu[pi + U.id] < id) pi += UNIT_STRIDE;
        if (pi < pu.length && pu[pi + U.id] === id) {
          x = pu[pi + U.x] + (x - pu[pi + U.x]) * alpha;
          y = pu[pi + U.y] + (y - pu[pi + U.y]) * alpha;
        }
      }
      const px = x * FIXED_TO_PX;
      const py = y * FIXED_TO_PX;
      // Where it stands on the plane (what stands up is drawn there; the ground's marks at px, py).
      const at = this.projection.toPlane(px, py);
      const type = u[o + U.type];
      const owner = u[o + U.owner];
      // On a bridge's deck (art-v5): drawn up there.
      const lift = this.terrain.liftAt(px, py);
      // From its atlas when there is one (its picture's top for the bars), else the shape.
      const top = this.artUnits?.unit(i, o, at.x, at.y, seconds, lift) ?? null;
      p.body.visible = top === null;
      p.body.texture = this.atlas.units[type] ?? this.atlas.units[UnitType.Farmer];
      p.body.tint = ownerTint(owner, view.me);
      p.body.position.set(at.x, at.y);
      p.body.zIndex = this.artStructures?.unitDepth(at.x, at.y) ?? at.y;
      p.body.scale.set(UNIT_SCALE);
      // Its facing as it looks on the plane (as a diamond, the ground's directions are turned and flattened).
      const f = (u[o + U.facing] * Math.PI) / 8;
      const m = this.projection.matrix;
      p.body.rotation = Math.atan2(m.b * Math.cos(f) + m.d * Math.sin(f), m.a * Math.cos(f) + m.c * Math.sin(f));
      const barY = top === null ? at.y - TILE_PX * 0.62 : top - 2;
      const selected = owner === view.me && binaryHas(sel, id);
      p.ring.visible = selected;
      if (selected) {
        p.ring.position.set(px, py);
        p.ring.scale.set(1.05);
        p.ring.tint = 0xfff3b0;
      }
      // Behind a castle's wall (D-089): drawn again over it, its ring too when selected.
      if (walls && top !== null) {
        const box = this.artUnits?.pictureBox(i) ?? null;
        const behind = box !== null && this.castle.covers(box, box.z);
        const side = owner === view.me ? "own" : owner === NEUTRAL || owner === NO_OWNER ? "neutral" : "enemy";
        this.artUnits?.ghost(i, behind ? this.ghostLayers[side] : null, this.ghostStyle === "outline");
        if (behind) {
          this.ghostCount++;
          ghosts[side]++;
          if (selected) this.ghostRings.ellipse(at.x, at.y, ringX, ringY).stroke({ width: 2, color: 0xfff3b0 });
        }
      }
      const info = view.rules.units[type];
      const hp = u[o + U.hp];
      const max = info?.hp ?? hp;
      const shield = u[o + U.shield];
      const shieldMax = info?.shield ?? 0;
      // The shape's shield on the ground; drawn from its atlas, the shield is its own picture (unit-art-draw.ts).
      if (shieldMax > 0 && shield > 0 && top === null) {
        p.shield.visible = true;
        p.shield.position.set(px, py);
        p.shield.scale.set(1.25);
        p.shield.alpha = 0.35 + 0.65 * (shield / shieldMax);
      }
      if (selected || hp < max || (shieldMax > 0 && shield < shieldMax)) {
        this.bar(p.hpBack, p.hpFront, at.x, barY, BAR_W, max > 0 ? hp / max : 1, ownerTint(owner, view.me));
        if (shieldMax > 0) this.bar(p.shBack, p.shFront, at.x, barY - BAR_H - 1, BAR_W, shield / shieldMax, SHIELD_TINT);
      }
      const cast = u[o + U.castProgress];
      if (cast > 0) {
        const r = TILE_PX * 0.55;
        this.fx
          .moveTo(px, py - r)
          .arc(px, py, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.min(cast, 30)) / 30)
          .stroke({ width: 3, color: WARNING_TINT, alpha: 0.95 });
      }
    }
    this.artUnits?.drawCorpses(seconds);
    this.ghostLayers.own.visible = ghosts.own > 0;
    this.ghostLayers.enemy.visible = ghosts.enemy > 0;
    this.ghostLayers.neutral.visible = ghosts.neutral > 0;
  }

  private drawWarnings(now: number): void {
    const w = (this.view.curr as NonNullable<GameView["curr"]>).snap.warnings;
    if (this.drawWarningsArt(w)) return;
    const pulse = 0.5 + 0.5 * Math.sin(now / 120);
    for (let o = 0; o < w.length; o += WARNING_STRIDE) {
      const x = w[o + W.x] * FIXED_TO_PX;
      const y = w[o + W.y] * FIXED_TO_PX;
      const r = w[o + W.radius] * FIXED_TO_PX;
      this.fx.circle(x, y, r).fill({ color: WARNING_TINT, alpha: 0.12 + 0.1 * pulse }).stroke({ width: 3, color: WARNING_TINT, alpha: 0.9 });
      // Countdown (core: ticksLeft 30 -> 0, then it fires): an inner disc that grows to the rim.
      const left = Math.min(Math.max(w[o + W.ticksLeft], 0), 30);
      this.fx.circle(x, y, r * (1 - left / 30)).fill({ color: WARNING_TINT, alpha: 0.35 });
    }
  }

  /**
   * 晶砲預警圈 B (the user's choice; design/b1/README.md 「給 client：晶砲預警圈 B」): six still
   * pictures, seen from above, laid on the ground (the ground's projection flattens them), the
   * sigil turning 20° a second, brightening as the calibration nears its end, the core growing in
   * its last 5 ticks. False when the effects atlas has none (the circles above).
   */
  private drawWarningsArt(w: Int32Array): boolean {
    const fx = this.artUnits?.art.effects ?? null;
    const art = this.artUnits?.art;
    if (fx === null || art === undefined || fx.effects.warn_sigil === undefined) {
      for (const c of this.warnPool) c.visible = false;
      return false;
    }
    const full = fx.effects.warn_sigil.radius_m ?? 3;
    const seconds = (this.view.curr?.snap.header[H.tick] ?? 0) / TICKS_PER_SECOND;
    let i = 0;
    for (let o = 0; o < w.length; o += WARNING_STRIDE, i++) {
      while (this.warnPool.length <= i) {
        const c = new Container();
        for (const name of WARN_LAYERS) {
          const s = new Sprite(art.effectFrame(`${name}_00`)?.texture ?? Texture.EMPTY);
          s.anchor.set(0.5);
          s.label = name;
          c.addChild(s);
        }
        this.warnLayer.addChild(c);
        this.warnPool.push(c);
      }
      const c = this.warnPool[i];
      c.visible = true;
      c.position.set(w[o + W.x] * FIXED_TO_PX, w[o + W.y] * FIXED_TO_PX);
      // The pictures' circle (radius_m) to the warning's radius, in world px.
      c.scale.set((w[o + W.radius] * FIXED_TO_PX) / (full * fx.px_per_m));
      const left = Math.min(Math.max(w[o + W.ticksLeft], 0), 30);
      const k = 1 - left / 30;
      const t = k * 1.5;
      const pulse = 0.5 + 0.5 * Math.cos(2 * Math.PI * (3 * t + 2 * t * t));
      const sigil = Math.min(1, (0.45 + 0.55 * k) * (0.8 + 0.2 * pulse));
      const alpha: Record<string, number> = {
        warn_fill: (0.12 + 0.35 * k) * (0.75 + 0.25 * pulse),
        warn_sigil_glow: 0.6 * sigil,
        warn_rim: 1,
        warn_sigil: sigil,
        warn_sigil_gold: sigil * 0.7 * k,
      };
      const turn = ((20 * Math.PI) / 180) * seconds;
      for (const s of c.children as Sprite[]) {
        if (s.label === "warn_core") {
          // The last 5 ticks: from a quarter of the radius to three quarters (the picture's 1/3 to 1).
          const g = left <= 5 ? (5 - left) / 5 : -1;
          s.visible = g >= 0;
          s.scale.set(1 / 3 + (2 / 3) * Math.max(0, g));
          s.alpha = 0.5 + 0.4 * Math.max(0, g);
          continue;
        }
        s.alpha = alpha[s.label] ?? 1;
        s.rotation = s.label.startsWith("warn_sigil") ? turn : 0;
      }
    }
    for (; i < this.warnPool.length; i++) this.warnPool[i].visible = false;
    return true;
  }

  private drawSelectionExtras(): void {
    const id = this.view.selection.building;
    if (id === null) return;
    const o = this.view.buildingRow(id);
    if (o < 0) return;
    const b = (this.view.curr as NonNullable<GameView["curr"]>).snap.buildings;
    const size = (this.view.rules.buildings[b[o + B.type]]?.size ?? 1) * TILE_PX;
    const x = b[o + B.cellX] * TILE_PX;
    const y = b[o + B.cellY] * TILE_PX;
    this.fx.rect(x - 2, y - 2, size + 4, size + 4).stroke({ width: 3, color: 0xfff3b0 });
    if (b[o + B.rallyX] >= 0) {
      const rx = b[o + B.rallyX] * FIXED_TO_PX;
      const ry = b[o + B.rallyY] * FIXED_TO_PX;
      this.fx.moveTo(x + size / 2, y + size / 2).lineTo(rx, ry).stroke({ width: 2, color: 0xfff3b0, alpha: 0.8 });
      this.fx.circle(rx, ry, 5).fill(0xfff3b0);
    }
  }

  private drawGhost(placement: Placement | null, now: number): void {
    this.ghost.clear();
    // Buildings placed and not on the map yet (pending.ts): their footprints dashed in the player's
    // colour. Paused, they wait for 繼續 (R6-31): the building see-through on it, 繼續後開工 under it.
    const sites = this.pending?.sites() ?? [];
    let labels = 0;
    for (const site of sites) {
      const cells = this.view.rules.buildings[site.type]?.size ?? 1;
      const size = cells * TILE_PX;
      const x = site.x * TILE_PX;
      const y = site.y * TILE_PX;
      this.ghost.rect(x, y, size, size).fill({ color: OWN_TINT, alpha: 0.14 });
      dashedRect(this.ghost, x, y, size, size, TILE_PX * 0.3, TILE_PX * 0.2);
      this.ghost.stroke({ width: 3, color: OWN_TINT });
      if (!this.paused) continue;
      if (this.siteLabels.length <= labels) {
        const label = new Text({ text: "繼續後開工", style: { fontFamily: "-apple-system, 'Noto Sans TC', sans-serif", fontSize: 12, fontWeight: "700", fill: 0xffffff, stroke: { color: 0x000000, width: 3 } }, resolution: 4 });
        label.anchor.set(0.5, 0);
        this.townLayer.addChild(label);
        this.siteLabels.push(label);
      }
      const label = this.siteLabels[labels++];
      const foot = this.projection.toPlane(x + size, y + size);
      const mid = this.projection.toPlane(x + size / 2, y + size / 2);
      label.position.set(mid.x, foot.y + 4);
      label.visible = true;
    }
    for (let i = labels; i < this.siteLabels.length; i++) this.siteLabels[i].visible = false;
    this.artStructures?.planned(this.paused ? sites : [], 0.5);
    // Put away with ✗: smaller and fainter over DROP_MS; reduced motion, only fainter.
    const d = this.dropped;
    if (d !== null) {
      const k = 1 - Math.min((now - d.at) / DROP_MS, 1);
      if (k <= 0) this.dropped = null;
      else {
        const s = reducedMotion() ? 1 : 0.7 + 0.3 * k;
        const cx = d.x + d.w / 2;
        const cy = d.y + d.h / 2;
        this.ghost.rect(cx - (d.w * s) / 2, cy - (d.h * s) / 2, d.w * s, d.h * s).fill({ color: d.color, alpha: 0.4 * k }).stroke({ width: 3, color: d.color, alpha: k });
      }
    }
    if (placement === null) return;
    const r = placement.rect();
    const color = placement.valid ? PLACE_OK : PLACE_BAD;
    this.ghost.rect(r.x, r.y, r.w, r.h).fill({ color, alpha: 0.4 }).stroke({ width: 3, color });
  }

  private bar(back: Sprite, front: Sprite, cx: number, y: number, w: number, frac: number, tint: number): void {
    const f = Math.min(Math.max(frac, 0), 1);
    back.visible = front.visible = true;
    back.position.set(cx - w / 2, y);
    back.width = w;
    back.height = BAR_H;
    front.position.set(cx - w / 2, y);
    front.width = w * f;
    front.height = BAR_H;
    front.tint = tint;
  }
}

/** Units behind a castle's wall, drawn again over it this see-through (atlas-buildings.md section 11). */
const GHOST_ALPHA = 0.45;

/** The building preview: may go there, may not. */
const PLACE_OK = 0x4fd06a;
const PLACE_BAD = 0xe0473d;
/** A preview put away with ✗ shrinks and fades this long (R6-25-11). */
const DROP_MS = 300;

/** 減少動態效果 (the system's setting). */
function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A rectangle's outline in dashes (Graphics draws no dashes), to be stroked. */
function dashedRect(g: Graphics, x: number, y: number, w: number, h: number, dash: number, gap: number): void {
  const corners = [x, y, x + w, y, x + w, y + h, x, y + h, x, y];
  for (let c = 0; c < 8; c += 2) {
    const [x0, y0, x1, y1] = [corners[c], corners[c + 1], corners[c + 2], corners[c + 3]];
    const len = Math.hypot(x1 - x0, y1 - y0);
    for (let at = 0; at < len; at += dash + gap) {
      const end = Math.min(at + dash, len);
      g.moveTo(x0 + ((x1 - x0) * at) / len, y0 + ((y1 - y0) * at) / len).lineTo(x0 + ((x1 - x0) * end) / len, y0 + ((y1 - y0) * end) / len);
    }
  }
}

function binaryHas(sorted: number[], v: number): boolean {
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] === v) return true;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

