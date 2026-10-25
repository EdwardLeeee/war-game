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
  PlaceBit,
  TOWN_STRIDE,
  TICKS_PER_SECOND,
  TownField as T,
  TownChoice,
  TownSize,
  TownState,
  Terrain,
  UNIT_STRIDE,
  UnitField as U,
  UnitFlag,
  UnitType,
  WARNING_STRIDE,
  WarningField as W,
  CELL,
} from "../sim.ts";
import { TILE_PX } from "../tuning.ts";
import type { Placement } from "../ui/placement.ts";
import { FIXED_TO_PX, type GameView } from "../view/view.ts";
import { type Atlas, ENEMY_TINT, NEUTRAL_TINT, OWN_TINT, ownerTint, SHIELD_TINT, WARNING_TINT } from "./atlas.ts";
import { ruleTower, type TowerCells, wallSpot } from "./town-wall.ts";
import { ArtStructures } from "./structure-art.ts";
import { autoTrainBuildings } from "../game/features.ts";
import { RELEASE_M, type Stone as SiegeStone, stoneAt, type StoneLook } from "../game/siege.ts";
import { CastleDraw } from "./castle-draw.ts";
import { type Footprint, townGround } from "../art/castle.ts";
import { TerrainDraw } from "./terrain-draw.ts";
import { GroundDraw, type GroundQuality, type GroundTextures } from "./ground-draw.ts";
import type { PendingOrders } from "../game/pending.ts";
import { type Culture, M_PER_CELL, stoneFrom } from "../art/spec.ts";
import { ArtUnits, type Release } from "./unit-art-draw.ts";
import { ARROW_FLIGHT, CHEST_M, flightOf, flightSeconds, heightAt, SLING_FLIGHT } from "./missile.ts";
import type { UnitArt } from "./unit-art.ts";

const UNIT_SCALE = 1;
/** The owner's colour under a unit's feet on 寫實地面: its size (the selection ring is 1.05) and how strong. */
const FOOT_SCALE = 0.85;
const FOOT_ALPHA = 0.75;
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
  /** Its owner's colour under its feet on 寫實地面 (atlas.ts `foot`). */
  foot: Sprite;
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
  /** Arrows in it (D-096 `shot.n`). */
  n: number;
  /** How far up it leaves (points on the plane): a town gate's tower (D-096 shoot_at_m), its flash there (`tower_shot`). */
  lift: number;
}

const SHOT_MS = 300;
/** 攻城砲 (D-099): a stone's landing shown this long (dust, the splash's ring), in game seconds. */
const STONE_LANDED_S = 0.6;

/** A militia's stone from the wall (D-096 sling), flying for STONE_MS: from (world px, `lift` points up) to a unit. */
interface Stone {
  fx: number;
  fy: number;
  lift: number;
  tx: number;
  ty: number;
  at: number;
}
const STONE_MS = 450;

/**
 * 真的箭 (R8-35 B, art-v6 effects `arrow`, `sling_stone`): an arrow (or `n` side by side) or a
 * sling's stone in the air, from (world px, `lift0` points up) to the target's chest (world px,
 * `lift1` points up), leaving at `at` (ms) for `ms`; its arc's top `arc` points over the straight line.
 */
interface Missile {
  kind: "arrow" | "stone";
  fx: number;
  fy: number;
  lift0: number;
  tx: number;
  ty: number;
  lift1: number;
  at: number;
  ms: number;
  arc: number;
  n: number;
}
/** Up on the plane per metre up (as castle-draw.ts). */
const UP_PER_M = Math.sqrt(3) / 2;

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
  /** The flashes where a gate's tower shoots (effects `tower_shot`, D-096), over airFx. */
  private readonly airArt = new Container();
  private readonly shotFlashes: Sprite[] = [];
  /** 攻城砲's stones (D-099, `siege_shot`), in the air or just landed; their landing dust. */
  private siegeStones: SiegeStone[] = [];
  private readonly siegeDust: Sprite[] = [];
  /** Stones thrown so far (D-099), for the test page. */
  siegeShotCount = 0;
  /** The simulation's time as drawn (ticks, between the last two snapshots). */
  private drawnTick = 0;
  /** Shots from a gate's tower (D-096 shoot_at_m) so far, for the test page. */
  towerShotCount = 0;
  private stones: Stone[] = [];
  /** Stones thrown from slings so far (D-096), for the test page. */
  stoneCount = 0;
  /** 真的箭 (R8-35 B): arrows and slings' stones in the air, their sprites; bowmen's arrows so far (tests). */
  private missiles: Missile[] = [];
  private readonly missileSprites: Sprite[] = [];
  bowArrowCount = 0;
  /** Buildings' arrows flown so (真的箭) so far (tests). */
  buildingArrowCount = 0;
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
  /** art-v6: siege stones' craters on the ground (world px, under the fog), and the sprites of the stones in the air, their shadows and their hits. */
  private readonly craterLayer = new Container();
  private readonly siegeArt: { stones: Sprite[]; shadows: Sprite[]; hits: Sprite[]; craters: Sprite[] } = { stones: [], shadows: [], hits: [], craters: [] };
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
  /** 城內 B (castle 2): the snapshot and the towns' and buildings' key the towns' ground was last made for. */
  private townSnap: unknown = null;
  private townKey = "";
  private readonly cultureOf: (owner: number) => Culture;
  /** The castles' blocks, on the ground under the fog (castle-draw.ts). */
  private readonly castleBlocks = new Graphics();
  /** Gates broken (D-096): rubble on their openings, on the ground; redrawn when the snapshot changes. */
  private readonly brokenGates = new Graphics();
  private brokenKey = "";
  /**
   * Units behind a castle's wall (D-089, atlas-buildings.md section 11): their pictures again over
   * the walls, one layer a colour (ours, the enemy's, the neutral militia's), at 45 %; the selected
   * ones' rings over the walls too. "outline" (test pages, ?ghost=outline): only their rims.
   */
  private readonly ghostLayers: Record<"own" | "enemy" | "neutral", Container>;
  private readonly ghostRings = new Graphics();
  /**
   * On the plane over the ground's pictures (castle floors, terrain), under what stands: 攻城砲's
   * rings and its stones' shadows and splash (D-099), which the castles' floor would hide in `fx`.
   */
  private readonly overGround = new Graphics();
  ghostStyle: "fill" | "outline" = "fill";
  /** Units drawn behind a wall this frame (test page). */
  ghostCount = 0;
  /** Units with their owner's colour under their feet this frame (寫實地面), for the test page. */
  footCount = 0;
  /** Our units drawn up on a castle's wall this frame (D-096, test page; the militia on theirs not counted). */
  wallLifted = 0;
  private readonly warnPool: Container[] = [];

  /** `art`: the units' atlases (D-085), `cultureOf` which culture each player wears; `projection` how the ground lies. */
  constructor(app: Application, view: GameView, atlas: Atlas, art: UnitArt | null = null, cultureOf: (owner: number) => Culture = (owner) => (owner === 1 ? "w" : "e"), projection: Projection = TOP) {
    this.view = view;
    this.atlas = atlas;
    this.projection = projection;
    this.cultureOf = cultureOf;
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
    this.groundInner.addChild(ground, this.rails, this.castleBlocks, this.brokenGates, this.zones, this.baseLayer, this.ringLayer, this.fx, this.craterLayer, this.warnLayer, this.ghost, fog, this.wallGround);
    this.groundOuter.addChild(this.groundInner);
    this.root.addChild(this.groundOuter, this.terrainGround, this.groundArt, this.wallLayer, this.overGround, this.shadowLayer, this.unitLayer, this.ghostLayers.own, this.ghostLayers.enemy, this.ghostLayers.neutral, this.ghostRings, this.airFx, this.airArt, this.barLayer, this.townLayer);
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
    this.drawBrokenGates();
    this.drawTowns();
    this.castle.update();
    this.terrain.update();
    this.updateGround();
    this.updateTownGround();
    this.groundDraw?.tick(now / 1000);
    this.fx.clear();
    this.airFx.clear();
    this.overGround.clear();
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

  /**
   * 真的箭 (R8-35 B): the effects have the arrow (art-v6), and arrows fly as war-game-ui drew them.
   * Before, a building's arrow is a straight line (`shot`) and bowmen shoot none, as before.
   */
  get realArrows(): boolean {
    return this.artUnits?.art.effects?.effects.arrow !== undefined;
  }

  /**
   * 真的箭: an arrow (or `n` side by side: a town gate's volley, a main city's with villagers
   * inside, D-096) from a building (world px, `lift` points up: where its picture's arrows leave)
   * at a unit's chest.
   */
  arrow(fromX: number, fromY: number, lift: number, toX: number, toY: number, now: number, n = 1): void {
    this.launch("arrow", fromX, fromY, lift, toX, toY, now, n);
    this.shotCount += Math.max(1, n);
    this.buildingArrowCount += Math.max(1, n);
  }

  /** Where a building's arrows leave its picture (art-v6 shoot_at_m) nearest a target, or null. */
  buildingShootFrom(o: number, toX: number, toY: number): { x: number; y: number; lift: number } | null {
    return this.artStructures?.shootFrom(o, toX, toY) ?? null;
  }

  /** An arrow or a stone into the air: its flight from the effects (speed, at most max_s, its arc), to the chest. */
  private launch(kind: Missile["kind"], fx: number, fy: number, lift0: number, tx: number, ty: number, now: number, n: number): void {
    const info = this.artUnits?.art.effects?.effects[kind === "arrow" ? "arrow" : "sling_stone"];
    const f = flightOf(info, kind === "arrow" ? ARROW_FLIGHT : SLING_FLIGHT);
    const metres = Math.hypot(tx - fx, ty - fy) / (TILE_PX / M_PER_CELL);
    const upPt = this.projection.ptPerM * UP_PER_M;
    const lift1 = CHEST_M * upPt + this.terrain.liftAt(tx, ty);
    this.missiles.push({ kind, fx, fy, lift0, tx, ty, lift1, at: now, ms: flightSeconds(metres, f) * 1000, arc: f.arcK * metres * upPt, n: Math.max(1, Math.min(n, 12)) });
    if (this.missiles.length > 80) this.missiles.shift();
  }

  /**
   * What left a sling or a bow this frame (unit-art-draw.ts) from the unit at row `o` standing at
   * (x, y) world px, `lift` points up: a stone or an arrow from the hand at whom it is hitting
   * (UnitField.attackTarget); hitting nothing we see, none. Slings without the effects' stone (before
   * art-v6) throw as before.
   */
  private release(r: Release, o: number, x: number, y: number, lift: number, owner: number, now: number): void {
    if (r.kind === "stone" && this.artUnits?.art.effects?.effects.sling_stone === undefined) return this.throwStone(r, x, y, lift, owner, now);
    const to = this.attackPoint(o);
    if (to === null) return;
    const off = stoneFrom(r.direction, r.mirror, r.from, this.projection.kind);
    const perM = TILE_PX / M_PER_CELL;
    this.launch(r.kind, x + off.x * perM, y + off.y * perM, lift + off.up * this.projection.ptPerM * UP_PER_M, to.x, to.y, now, 1);
    if (r.kind === "stone") this.stoneCount++;
    else this.bowArrowCount++;
  }

  /** Whom the unit at row `o` is hitting (UnitField.attackTarget): a unit's feet or a building's middle (world px), or null. */
  private attackPoint(o: number): { x: number; y: number } | null {
    const snap = this.view.curr?.snap;
    if (snap === undefined) return null;
    const id = snap.units[o + U.attackTarget];
    if (id < 0) return null;
    const t = this.view.unitRow(id);
    if (t >= 0) return { x: snap.units[t + U.x] * FIXED_TO_PX, y: snap.units[t + U.y] * FIXED_TO_PX };
    const b = this.view.buildingRow(id);
    if (b < 0) return null;
    const c = this.view.footprintCentre(snap.buildings, b);
    return { x: c.x * TILE_PX, y: c.y * TILE_PX };
  }

  /** A missile's point on the plane at `k` (0 leaving, 1 landing): along the ground, up its arc. */
  private missileAt(m: Missile, k: number): { x: number; y: number } {
    const g = this.projection.toPlane(m.fx + (m.tx - m.fx) * k, m.fy + (m.ty - m.fy) * k);
    return { x: g.x, y: g.y - heightAt(k, 1, m.lift0, m.lift1, m.arc) };
  }

  /**
   * The arrows and stones in the air: the effects' arrow (drawn pointing right) turned the way it
   * flies, `n` side by side across it, the middle one on the line, the others a little behind; the
   * stone tumbling (its frames). Missing a frame, a line as before.
   */
  private drawMissiles(now: number): void {
    this.missiles = this.missiles.filter((m) => now - m.at < m.ms);
    const fx = this.artUnits?.art.effects ?? null;
    const art = this.artUnits?.art ?? null;
    let i = 0;
    const put = (texture: Texture, ax: number, ay: number, x: number, y: number, rotation: number, scale: number) => {
      while (this.missileSprites.length <= i) {
        const sprite = new Sprite();
        this.airArt.addChild(sprite);
        this.missileSprites.push(sprite);
      }
      const sprite = this.missileSprites[i++];
      sprite.visible = true;
      sprite.texture = texture;
      sprite.anchor.set(ax, ay);
      sprite.position.set(x, y);
      sprite.rotation = rotation;
      sprite.scale.set(scale);
    };
    for (const m of this.missiles) {
      const k = (now - m.at) / m.ms;
      const p = this.missileAt(m, k);
      const q = this.missileAt(m, Math.min(1, k + 0.02));
      const angle = Math.atan2(q.y - p.y, q.x - p.x);
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      const info = fx?.effects[m.kind === "arrow" ? "arrow" : "sling_stone"];
      const name = m.kind === "arrow" ? "arrow_00" : `sling_stone_${String(Math.floor(((now - m.at) / 1000) * (info?.fps ?? 12)) % Math.max(1, info?.frames ?? 1)).padStart(2, "0")}`;
      const f = art?.effectFrame(name) ?? null;
      for (let a = 0; a < m.n; a++) {
        const side = (a - (m.n - 1) / 2) * 6;
        const back = Math.abs(side) * 0.8;
        const x = p.x - uy * side - ux * back;
        const y = p.y + ux * side - uy * back;
        if (f !== null && fx !== null) put(f.texture, f.ax, f.ay, x, y, m.kind === "arrow" ? angle : 0, (this.projection.ptPerM / fx.px_per_m) * (f.half ? 2 : 1));
        else this.airFx.moveTo(x - ux * 12, y - uy * 12).lineTo(x, y).stroke({ width: 2, color: 0x2a1c10 });
      }
    }
    for (; i < this.missileSprites.length; i++) this.missileSprites[i].visible = false;
  }

  /**
   * An arrow (or `n` together: a town gate's volley, a main city's with villagers inside, D-096) from
   * a building at a unit (world px), `lift` points up where it leaves (a gate's tower: its flash there).
   */
  shot(fromX: number, fromY: number, toX: number, toY: number, now: number, n = 1, lift = 0): void {
    this.shots.push({ fx: fromX, fy: fromY, tx: toX, ty: toY, at: now, n: Math.max(1, Math.min(n, 12)), lift });
    if (lift > 0) this.towerShotCount++;
    this.shotCount += Math.max(1, n);
    if (this.shots.length > 40) this.shots.shift();
  }

  /**
   * A stone from a militia's sling on a wall (D-096), from its hand (stone_from_m) at the unit at
   * (x, y) world px, `lift` points up, to the nearest unit not its owner's within the sling's reach
   * (rules.walls.sling, as the simulation picks; it sends no event a throw): none, no stone.
   */
  private throwStone(r: Release, x: number, y: number, lift: number, owner: number, now: number): void {
    const snap = this.view.curr?.snap;
    if (snap === undefined) return;
    const reach = ((this.view.rules.walls?.sling ?? 4 * CELL) + CELL) * FIXED_TO_PX;
    const u = snap.units;
    let best: { x: number; y: number } | null = null;
    let bestD = reach * reach;
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      if (u[o + U.owner] === owner || u[o + U.action] === Action.Garrisoned) continue;
      const tx = u[o + U.x] * FIXED_TO_PX;
      const ty = u[o + U.y] * FIXED_TO_PX;
      const d = (tx - x) ** 2 + (ty - y) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = { x: tx, y: ty };
      }
    }
    if (best === null) return;
    const off = stoneFrom(r.direction, r.mirror, r.from, this.projection.kind);
    const perM = TILE_PX / M_PER_CELL;
    this.stones.push({ fx: x + off.x * perM, fy: y + off.y * perM, lift: lift + off.up * this.projection.ptPerM * UP_PER_M, tx: best.x, ty: best.y, at: now });
    this.stoneCount++;
    if (this.stones.length > 40) this.stones.shift();
  }

  /** The stones in the air: a small grey stone on an arc, landing at the unit's chest. */
  private drawStones(now: number): void {
    this.stones = this.stones.filter((s) => now - s.at < STONE_MS);
    const chest = 1 * this.projection.ptPerM * UP_PER_M;
    for (const s of this.stones) {
      const k = (now - s.at) / STONE_MS;
      const from = this.projection.toPlane(s.fx, s.fy);
      const to = this.projection.toPlane(s.tx, s.ty);
      const x = from.x + (to.x - from.x) * k;
      const y = from.y - s.lift + (to.y - chest - (from.y - s.lift)) * k - 4 * 14 * k * (1 - k);
      this.airFx.circle(x, y, 2.4).fill(0x6e655a).stroke({ width: 1, color: 0x2e2a24 });
    }
  }

  /** A circle on the ground (world px) as the plane shows it (an ellipse square on), into `overGround`; `dash` leaves every other stroke out. */
  private groundCircle(x: number, y: number, r: number, stroke: { width: number; color: number; alpha: number }, dash = false): void {
    const g = this.overGround;
    const n = 48;
    for (let i = 0; i < n; i++) {
      if (dash && i % 2 === 1) continue;
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const p0 = this.projection.toPlane(x + Math.cos(a0) * r, y + Math.sin(a0) * r);
      const p1 = this.projection.toPlane(x + Math.cos(a1) * r, y + Math.sin(a1) * r);
      g.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y);
      if (dash) g.stroke(stroke);
    }
    if (!dash) g.stroke(stroke);
  }

  /**
   * art-v6's stone (effects `siege_stone`): where it leaves an engine of this owner (its atlas's
   * from_m; null owner: one unseen), its arc and how far out an unseen one's starts; null without
   * the effect (the stand-in numbers of game/siege.ts).
   */
  stoneLook(owner: number | null): StoneLook | null {
    const info = this.artUnits?.art.effects?.effects.siege_stone;
    if (info === undefined) return null;
    const atlas = owner === null ? null : (this.artUnits?.atlasFor(UnitType.Siege, owner) ?? null);
    const from = (atlas === null ? undefined : info.from_m?.[atlas.unit]) ?? [0, 0, RELEASE_M];
    return { fromM: from, arcM: info.arc_m ?? 2, arcK: info.arc_k ?? 0.25, farM: info.from_far_m ?? 14 };
  }

  /** 攻城砲 (D-099): a stone thrown (game/siege.ts), drawn until it lands and a moment after. */
  siegeShot(stone: SiegeStone): void {
    this.siegeStones.push(stone);
    this.siegeShotCount++;
    if (this.siegeStones.length > 40) this.siegeStones.shift();
  }

  /**
   * The stones in the air (a dark stone, its shadow on the ground) and, once landed, dust and the
   * splash's ring where they fell; only where we see now (the fog hides the rest: a stone from an
   * unseen engine comes in from the edge of what we see).
   */
  private drawSiegeStones(): void {
    if (this.drawSiegeStonesArt()) return;
    const t = this.drawnTick;
    this.siegeStones = this.siegeStones.filter((s) => t < s.lands + STONE_LANDED_S * TICKS_PER_SECOND);
    const n = this.view.map.size;
    const fog = this.view.fog;
    const seen = (x: number, y: number) => {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      return cx >= 0 && cy >= 0 && cx < n && cy < n && (fog === null || fog[cy * n + cx] === Fog.Visible);
    };
    const upPerM = this.projection.ptPerM * UP_PER_M;
    const splash = ((this.view.rules.units[UnitType.Siege]?.splash ?? CELL) * FIXED_TO_PX) as number;
    const fx = this.artUnits?.art.effects ?? null;
    const dust = fx?.effects.dust;
    let d = 0;
    for (const s of this.siegeStones) {
      const at = stoneAt(s, t, M_PER_CELL);
      if (at !== null) {
        if (!seen(at.x, at.y)) continue;
        const ground = this.projection.toPlane(at.x * TILE_PX, at.y * TILE_PX);
        // Its shadow on the ground, fainter as it rises; the stone itself up there.
        this.overGround.ellipse(ground.x, ground.y, 4, 2.4).fill({ color: 0x000000, alpha: Math.max(0.1, 0.4 - at.upM * 0.04) });
        this.airFx.circle(ground.x, ground.y - at.upM * upPerM, 3.6).fill(0x5a5249).stroke({ width: 1.2, color: 0x23201c });
        continue;
      }
      // Landed: the splash's ring fading, dust rising (effects `dust`, twice the size).
      if (t < s.lands || !seen(s.toX, s.toY)) continue;
      const k = (t - s.lands) / (STONE_LANDED_S * TICKS_PER_SECOND);
      this.groundCircle(s.toX * TILE_PX, s.toY * TILE_PX, splash, { width: 2, color: 0xd9c9a8, alpha: 0.7 * (1 - k) });
      if (fx === null || dust === undefined || this.artUnits === null) continue;
      const index = Math.floor(((t - s.lands) / TICKS_PER_SECOND) * (dust.fps ?? 12));
      const f = index < dust.frames ? this.artUnits.art.effectFrame(`dust_${String(index).padStart(2, "0")}`) : null;
      if (f === null) continue;
      while (this.siegeDust.length <= d) {
        const sprite = new Sprite();
        this.airArt.addChild(sprite);
        this.siegeDust.push(sprite);
      }
      const sprite = this.siegeDust[d++];
      const at2 = this.projection.toPlane(s.toX * TILE_PX, s.toY * TILE_PX);
      sprite.visible = true;
      sprite.texture = f.texture;
      sprite.anchor.set(f.ax, f.ay);
      sprite.position.set(at2.x, at2.y);
      sprite.scale.set((this.projection.ptPerM / fx.px_per_m) * 2 * (f.half ? 2 : 1));
    }
    for (; d < this.siegeDust.length; d++) this.siegeDust[d].visible = false;
  }

  /**
   * art-v6's stones (effects siege_*; false without them): the stone tumbling on its arc (game/siege.ts
   * with ui's arc), its shadow under it smaller and fainter the higher it is (ui: max(0.35, 1 − h/14));
   * landed, `siege_hit_building` where a building, a wall or a gate stands on the cell, else
   * `siege_hit_ground`, and a crater on the ground fading over `crater_s`. Only where we see now.
   */
  private drawSiegeStonesArt(): boolean {
    const art = this.artUnits?.art ?? null;
    const fx = art?.effects ?? null;
    const stone = fx?.effects.siege_stone;
    if (art === null || fx === null || stone === undefined) return false;
    const t = this.drawnTick;
    const craterS = fx.effects.siege_crater?.crater_s ?? 8;
    this.siegeStones = this.siegeStones.filter((s) => t < s.lands + craterS * TICKS_PER_SECOND);
    const n = this.view.map.size;
    const fog = this.view.fog;
    const seen = (x: number, y: number) => {
      const cx = Math.floor(x);
      const cy = Math.floor(y);
      return cx >= 0 && cy >= 0 && cx < n && cy < n && (fog === null || fog[cy * n + cx] === Fog.Visible);
    };
    const upPerM = this.projection.ptPerM * UP_PER_M;
    const k = this.projection.ptPerM / fx.px_per_m;
    const used = { stones: 0, shadows: 0, hits: 0, craters: 0 };
    const put = (kind: keyof typeof used, layer: Container, name: string, x: number, y: number, scale: number, alpha = 1) => {
      const f = art.effectFrame(name);
      if (f === null) return;
      const list = this.siegeArt[kind];
      while (list.length <= used[kind]) {
        const sprite = new Sprite();
        layer.addChild(sprite);
        list.push(sprite);
      }
      const sprite = list[used[kind]++];
      sprite.visible = true;
      sprite.texture = f.texture;
      sprite.anchor.set(f.ax, f.ay);
      sprite.position.set(x, y);
      sprite.scale.set(scale * (f.half ? 2 : 1));
      sprite.alpha = alpha;
    };
    const frame = (name: string, since: number, info: { frames: number; fps?: number; loop: boolean } | undefined) => {
      if (info === undefined) return null;
      const i = Math.floor((since / TICKS_PER_SECOND) * (info.fps ?? 12));
      return info.loop ? `${name}_${String(i % info.frames).padStart(2, "0")}` : i < info.frames ? `${name}_${String(i).padStart(2, "0")}` : null;
    };
    const placement = this.view.placement;
    for (const s of this.siegeStones) {
      const at = stoneAt(s, t, M_PER_CELL);
      if (at !== null) {
        if (!seen(at.x, at.y)) continue;
        const ground = this.projection.toPlane(at.x * TILE_PX, at.y * TILE_PX);
        const shade = Math.max(0.35, 1 - at.upM / 14);
        put("shadows", this.airArt, "siege_stone_shadow_00", ground.x, ground.y, k * shade, shade);
        const name = frame("siege_stone", t - s.thrown, stone);
        if (name !== null) put("stones", this.airArt, name, ground.x, ground.y - at.upM * upPerM, k);
        continue;
      }
      if (t < s.lands || !seen(s.toX, s.toY)) continue;
      // Landed: on a building, a wall or a gate, or on the ground.
      const cx = Math.floor(s.toX);
      const cy = Math.floor(s.toY);
      const onBuilding = this.view.buildingAt(s.toX * TILE_PX, s.toY * TILE_PX) !== null || (placement !== null && ((placement.cells[cy * n + cx] ?? 0) & PlaceBit.Wall) !== 0);
      const hitName = onBuilding ? "siege_hit_building" : "siege_hit_ground";
      const hit = frame(hitName, t - s.lands, fx.effects[hitName]);
      const p = this.projection.toPlane(s.toX * TILE_PX, s.toY * TILE_PX);
      if (hit !== null) put("hits", this.airArt, hit, p.x, p.y, k);
      // The crater: seen from above, laid on the ground (world px), its radius_m to the picture's; fading.
      const crater = fx.effects.siege_crater;
      if (crater !== undefined) {
        const fade = 1 - (t - s.lands) / (craterS * TICKS_PER_SECOND);
        put("craters", this.craterLayer, "siege_crater_00", s.toX * TILE_PX, s.toY * TILE_PX, TILE_PX / M_PER_CELL / fx.px_per_m, Math.max(0, fade));
      }
    }
    for (const kind of Object.keys(used) as (keyof typeof used)[]) for (let i = used[kind]; i < this.siegeArt[kind].length; i++) this.siegeArt[kind][i].visible = false;
    for (const sp of this.siegeDust) sp.visible = false;
    return true;
  }

  private drawShots(now: number): void {
    this.shots = this.shots.filter((s) => now - s.at < SHOT_MS);
    this.drawShotFlashes(now);
    this.drawSiegeStones();
    this.drawStones(now);
    this.drawMissiles(now);
    for (const s of this.shots) {
      const k = (now - s.at) / SHOT_MS;
      // In the air: from and to on the plane, the arrow drawn there (not flattened).
      const from = this.projection.toPlane(s.fx, s.fy);
      from.y -= s.lift;
      const to = this.projection.toPlane(s.tx, s.ty);
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const x = from.x + dx * k;
      const y = from.y + dy * k;
      const ux = dx / len;
      const uy = dy / len;
      // n arrows side by side across the way they fly, 6 px apart, the middle one on the line, the
      // others a little behind (a volley, not a wall of arrows).
      for (let a = 0; a < s.n; a++) {
        const side = (a - (s.n - 1) / 2) * 6;
        const back = Math.abs(side) * 0.8;
        const ax = x - uy * side - ux * back;
        const ay = y + ux * side - uy * back;
        // A shaft 12 px long with a head: it leaves the building and flies to the target.
        this.airFx.moveTo(ax - ux * 12, ay - uy * 12).lineTo(ax, ay).stroke({ width: 2.5, color: 0x2a1c10 });
        this.airFx.moveTo(ax - ux * 12, ay - uy * 12).lineTo(ax, ay).stroke({ width: 1.2, color: 0xf4e2b0 });
        this.airFx.poly([ax + ux * 4, ay + uy * 4, ax - ux * 2 - uy * 3, ay - uy * 2 + ux * 3, ax - ux * 2 + uy * 3, ay - uy * 2 - ux * 3]).fill(0xf4e2b0);
      }
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
      // A gate (D-096) lies across its opening, a row or a column of cells (view.footprint).
      const f = this.view.footprint(b, o);
      const width = f.w * TILE_PX;
      const depth = f.h * TILE_PX;
      const size = Math.min(width, depth);
      const x = f.x * TILE_PX;
      const y = f.y * TILE_PX;
      const remembered = (b[o + B.flags] & BuildingFlag.Remembered) !== 0;
      const building = b[o + B.progress] < 1000;
      p.base.texture = type === BuildingType.Farm ? this.atlas.farm : type === BuildingType.ArrowTower ? this.atlas.tower : this.atlas.building;
      p.base.position.set(x, y);
      p.base.width = width;
      p.base.height = depth;
      p.base.tint = type === BuildingType.Farm ? 0xffffff : ownerTint(b[o + B.owner], this.view.me);
      p.base.alpha = remembered ? 0.55 : building ? 0.6 : 1;
      // The footprint lies on the ground; its glyph stands in its middle, the shield at its right corner.
      const mid = this.projection.toPlane(x + width / 2, y + depth / 2);
      const top = this.projection.toPlane(x, y);
      const right = this.projection.toPlane(x + width, y);
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
      if (b[o + B.owner] === this.view.me && !building && autoTrainBuildings(this.view.rules).includes(type) && this.autoPaused(b[o + B.id])) {
        p.paused.visible = true;
        p.paused.position.set(right.x - 2 - (marked ? 18 * markScale : 0), right.y + 2);
        p.paused.zIndex = mid.y + 1;
        p.paused.scale.set(markScale);
      }
      // From its atlas (art-v2 on): its picture instead of the footprint and the glyph; the bar over its top.
      const picture = this.artStructures?.building(i, o) ?? null;
      if (picture !== null) p.base.visible = p.glyph.visible = false;
      // A gate drawn as its castle's picture (closed, open, damaged: D-096): no block over it, its bar above the picture.
      const gateTop = type === BuildingType.Gate ? this.castle.gateTop(f.x, f.y) : null;
      if (gateTop !== null) p.base.visible = p.glyph.visible = false;
      const hp = b[o + B.hp];
      // A gate's full hit points are its town's size's (rules.towns[size].gateHp), not buildings[Gate].hp.
      const max = this.view.buildingMaxHp(b, o);
      // A town's keep (D-100) tapped to look at it shows its bar too: it is what the soldiers must bring down.
      const inspected = this.view.inspected;
      const selected = this.view.selection.building === b[o + B.id] || (type === BuildingType.Keep && inspected?.kind === "building" && inspected.id === b[o + B.id]);
      if (building || hp < max || selected) {
        const frac = building ? b[o + B.progress] / 1000 : max > 0 ? hp / max : 1;
        this.bar(p.hpBack, p.hpFront, mid.x, Math.min(top.y, picture?.top ?? top.y, gateTop ?? top.y) - 4, Math.max(width, depth) * 0.8, frac, building ? 0xe7c35a : ownerTint(b[o + B.owner], this.view.me));
      }
    }
  }

  /** A gate tower's flash where its arrows leave (effects `tower_shot`, D-096: anchor in the middle), played once. */
  private drawShotFlashes(now: number): void {
    const fx = this.artUnits?.art.effects ?? null;
    const info = fx?.effects.tower_shot;
    let i = 0;
    if (fx !== null && info !== undefined && this.artUnits !== null) {
      for (const s of this.shots) {
        const k = Math.floor(((now - s.at) / 1000) * (info.fps ?? 20));
        if (s.lift <= 0 || k >= info.frames) continue;
        const f = this.artUnits.art.effectFrame(`tower_shot_${String(k).padStart(2, "0")}`);
        if (f === null) continue;
        while (this.shotFlashes.length <= i) {
          const sprite = new Sprite();
          this.airArt.addChild(sprite);
          this.shotFlashes.push(sprite);
        }
        const sprite = this.shotFlashes[i++];
        const at = this.projection.toPlane(s.fx, s.fy);
        sprite.visible = true;
        sprite.texture = f.texture;
        sprite.anchor.set(f.ax, f.ay);
        sprite.position.set(at.x, at.y - s.lift);
        sprite.scale.set((this.projection.ptPerM / fx.px_per_m) * (f.half ? 2 : 1));
      }
    }
    for (; i < this.shotFlashes.length; i++) this.shotFlashes[i].visible = false;
  }

  /**
   * Gates broken (D-096): an opening of a known town, in view now, with no gate building on it, while
   * gates are on and the town is not in ruins (ruins draw as such). Grey rubble on its cells, plain
   * until war-game-ui's pictures. Out of view, nothing is said (a gate remembered is a building).
   */
  private drawBrokenGates(): void {
    const snap = (this.view.curr as NonNullable<GameView["curr"]>).snap;
    const fog = this.view.fog;
    const n = this.view.map.size;
    const openings: number[][] = [];
    if (this.view.rules.features?.gates === true) {
      const standing = new Set<number>();
      const b = snap.buildings;
      for (let o = 0; o < b.length; o += BUILDING_STRIDE) if (b[o + B.type] === BuildingType.Gate) standing.add(b[o + B.cellY] * n + b[o + B.cellX]);
      for (const town of this.view.knownTowns.values()) {
        const o = this.view.townRow(town.id);
        if (o >= 0 && snap.towns[o + T.state] === TownState.Ruins) continue;
        for (const opening of this.view.castleOf(town)?.gates ?? []) {
          const cells = opening.map(([x, y]) => (town.cellY + y) * n + town.cellX + x);
          if (cells.length === 0 || !cells.every((c) => fog === null || fog[c] === Fog.Visible)) continue;
          if (standing.has(Math.min(...opening.map(([, y]) => town.cellY + y)) * n + Math.min(...opening.map(([x]) => town.cellX + x)))) continue;
          openings.push(cells);
        }
      }
    }
    const key = openings.map((c) => c.join(".")).join(",");
    if (key === this.brokenKey) return;
    this.brokenKey = key;
    const g = this.brokenGates;
    g.clear();
    for (const cells of openings) {
      // Its picture (art-v5.2) shows the gate broken: no rubble.
      if (this.castle.drawsGate(cells[0] % n, Math.floor(cells[0] / n))) continue;
      for (const c of cells) {
        const x = (c % n) * TILE_PX;
        const y = Math.floor(c / n) * TILE_PX;
        // A few stones across the cell, the same for every gate (no randomness in drawing either).
        for (const [dx, dy, r] of [[0.25, 0.3, 0.14], [0.62, 0.22, 0.11], [0.45, 0.62, 0.16], [0.78, 0.7, 0.1], [0.2, 0.78, 0.09]]) {
          g.circle(x + dx * TILE_PX, y + dy * TILE_PX, r * TILE_PX).fill(0x7a7268).stroke({ width: 1, color: 0x3a332b });
        }
      }
    }
  }

  /** Openings drawn as broken gates (D-096), for the test hook. */
  get brokenGateCount(): number {
    return this.brokenKey === "" ? 0 : this.brokenKey.split(",").length;
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
  /** `sling`: some unit's atlas has the militia's sling (D-096, art-v5.2). */
  get artDrawn(): { label: string; pages: number; units: number; corpses: number; buildings: number; rubble: number; nodes: number; sling: boolean } | null {
    const a = this.artUnits;
    return a === null ? null : { label: a.art.label, pages: a.art.pages, ...a.drawn, ...(this.artStructures?.counts ?? { buildings: 0, rubble: 0, nodes: 0 }), sling: [...a.art.atlases.values()].some((j) => j.anims.sling !== undefined) };
  }

  /**
   * 寫實地面 (D-093): ui's ground blended on the GPU instead of the two greens. Only over ui's terrain
   * pictures (art-v5 on, square on): the water is theirs; without them the flat colours stay. False then.
   */
  useGround(textures: GroundTextures, quality: GroundQuality): boolean {
    if (!this.terrain.pictures) return false;
    // The towns' ground in the player's culture's layers (rules.town; both `yard` in art-v6).
    this.groundDraw = new GroundDraw(textures, this.view.map.size, quality, this.cultureOf(this.view.me) === "w" ? "W" : "E");
    this.groundInner.addChildAt(this.groundDraw.mesh, 0);
    this.flatGround.visible = false;
    // The water in the ground's shader (art-v6): not its tiles too.
    this.terrain.showWater(!this.groundDraw.water);
    this.groundKey = "";
    this.updateGround();
    return true;
  }

  /**
   * 寫實地面 shown or not (選單's 寫實地面 開／關, ground-pref.ts): off, the two greens and the
   * terrain's water tiles again, at once; its textures stay loaded for turning it back on.
   */
  showGround(on: boolean): void {
    const g = this.groundDraw;
    if (g === null) return;
    g.mesh.visible = on;
    this.flatGround.visible = !on;
    this.terrain.showWater(!on || !g.water);
  }

  /** 寫實地面 in use this game (its switch in 選單 then means something). */
  get groundLoaded(): boolean {
    return this.groundDraw !== null;
  }

  /** 寫實地面 drawn now (loaded and not turned off). */
  private get groundShown(): boolean {
    return this.groundDraw !== null && this.groundDraw.mesh.visible;
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
  get groundLook(): { real: boolean; quality: GroundQuality | null; water: boolean; town: boolean } {
    return { real: this.groundShown, quality: this.groundDraw?.currentQuality ?? null, water: this.groundDraw?.water === true, town: this.groundDraw?.town === true };
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

  /**
   * 城內 B (art-v6, castle 2, R8-36 B): the towns' lanes and trampled earth for the ground's shader,
   * from the castles laid out and the buildings in them (art/castle.ts townGround); made again only
   * when those change. Each town's area: its walls' box, its ground's and its decor's cells.
   */
  private updateTownGround(): void {
    const g = this.groundDraw;
    const snap = this.view.curr?.snap;
    if (g === null || !g.town || snap === undefined || snap === this.townSnap) return;
    this.townSnap = snap;
    const b = snap.buildings;
    const footprints: Footprint[] = [];
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) footprints.push(this.view.footprint(b, o));
    const towns = this.castle
      .fitted()
      .filter((t) => t.fit.layout.ground !== undefined)
      .flatMap(({ town, fit }) => {
        const box = this.view.castleBox(town);
        if (box === null) return [];
        const ox = town.cellX + fit.dx;
        const oy = town.cellY + fit.dy;
        const cells = [...(fit.layout.ground ?? []).map((v) => v.cell), ...(fit.layout.decor ?? []).flatMap((v) => v.cells)];
        const xs = [box.x0, box.x1, ...cells.map(([x]) => ox + x)];
        const ys = [box.y0, box.y1, ...cells.map(([, y]) => oy + y)];
        return [{ id: town.id, cx: town.cellX, cy: town.cellY, fit, box, area: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) } }];
      });
    const key = `${towns.map((t) => `${t.id}:${t.fit.name}`).join(",")}|${footprints.map((f) => `${f.x},${f.y},${f.w},${f.h}`).join(";")}`;
    if (key === this.townKey) return;
    this.townKey = key;
    const { lane, trampled } = townGround(this.view.map.size, towns, footprints);
    g.setTown(lane, trampled, towns.map((t) => t.area));
  }

  /** The ground's pictures drawn (art-v5), for the test page. */
  get terrainCounts(): { pictures: boolean; pieces: number; flat: number; standing: number } {
    return { pictures: this.terrain.pictures, ...this.terrain.counts };
  }

  /** How far up someone at (px, py) world px is drawn (a bridge's deck), for the test page. */
  liftAt(px: number, py: number): number {
    return this.terrain.liftAt(px, py);
  }

  /** The castles as drawn (castle-draw.ts), for the test page: with their gates' looks and whether those on a wall stand on its walk (D-096). */
  get castleCounts(): { pieces: number; tiles: number; blockTowns: number; misfit: number; walkable: boolean; gates: Record<string, number>; decor: number; decorLeftOut: number } {
    return { ...this.castle.counts, walkable: this.castle.walkable, gates: this.castle.gateLookCounts };
  }

  /** 城內 B (castle 2): the towns' decor pieces, for the test page. */
  get decorForTest(): ReturnType<CastleDraw["decorForTest"]> {
    return this.castle.decorForTest();
  }

  /** Where a gate's arrows leave (D-096, castle-draw.ts gateShootFrom): world px on the ground and points up; null: its building's middle. */
  gateShootFrom(cellX: number, cellY: number, toX: number, toY: number): { x: number; y: number; lift: number } | null {
    return this.castle.gateShootFrom(cellX, cellY, toX, toY);
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
    this.footCount = 0;
    this.wallLifted = 0;
    // A layer with no one behind a wall this frame is hidden: its filter's pass is skipped.
    const ghosts = { own: 0, enemy: 0, neutral: 0 };
    const walls = this.castle.hasPieces && this.artUnits !== null;
    // The selection ring's size on the plane (the ground's ring: 16 world px at 1.05).
    const ringX = this.projection.toPlane(17, 0).x - this.projection.toPlane(0, 0).x;
    const ringY = this.projection.toPlane(0, 17).y - this.projection.toPlane(0, 0).y;
    // The atlases' clock: the simulation's time, between the last two snapshots (D-085).
    const tick = curr.snap.header[H.tick];
    this.drawnTick = paused || prev === null ? tick : tick - 1 + alpha;
    const seconds = this.drawnTick / TICKS_PER_SECOND;
    this.artUnits?.snapshot(seconds);
    this.artStructures?.snapshot(seconds);
    this.artStructures?.drawRubble(seconds);
    while (this.unitPool.length < n) {
      const ring = new Sprite(this.atlas.ring);
      ring.anchor.set(0.5);
      const foot = new Sprite(this.atlas.foot);
      foot.anchor.set(0.5);
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
      const p: UnitSprites = { body, ring, foot, shield, hpBack: mk(0x201a18), hpFront: mk(0xffffff), shBack: mk(0x201a18), shFront: mk(SHIELD_TINT) };
      // The selection ring and the shape's shield lie on the ground; the shape stands.
      this.ringLayer.addChild(foot, ring, shield);
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
      p.ring.visible = p.shield.visible = p.foot.visible = false;
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
      const type = u[o + U.type];
      const owner = u[o + U.owner];
      // On a castle's wall (D-096): on its walk (stand_in_m towards the town, walk_m up), over the
      // wall and under its front parts, no shadow (the walk is not the ground); on a bridge's deck (art-v5): up there.
      const onWall = (u[o + U.flags] & UnitFlag.OnWall) !== 0 ? this.castle.onWall(Math.floor(px / TILE_PX), Math.floor(py / TILE_PX)) : null;
      if (onWall !== null && owner === view.me) this.wallLifted++;
      const at = this.projection.toPlane(px + (onWall?.dx ?? 0), py + (onWall?.dy ?? 0));
      const lift = onWall?.lift ?? this.terrain.liftAt(px, py);
      // From its atlas when there is one (its picture's top for the bars), else the shape.
      const top = this.artUnits?.unit(i, o, at.x, at.y, seconds, lift, onWall?.z ?? null, onWall === null) ?? null;
      for (const r of this.artUnits?.takeReleases() ?? []) this.release(r, o, px + (onWall?.dx ?? 0), py + (onWall?.dy ?? 0), lift, owner, now);
      p.body.visible = top === null;
      p.body.texture = this.atlas.units[type] ?? this.atlas.units[UnitType.Farmer];
      p.body.tint = ownerTint(owner, view.me);
      p.body.position.set(at.x, at.y);
      p.body.zIndex = onWall?.z ?? this.artStructures?.unitDepth(at.x, at.y) ?? at.y;
      p.body.scale.set(UNIT_SCALE);
      // Its facing as it looks on the plane (as a diamond, the ground's directions are turned and flattened).
      const f = (u[o + U.facing] * Math.PI) / 8;
      const m = this.projection.matrix;
      p.body.rotation = Math.atan2(m.b * Math.cos(f) + m.d * Math.sin(f), m.a * Math.cos(f) + m.c * Math.sin(f));
      const barY = top === null ? at.y - TILE_PX * 0.62 : top - 2;
      const selected = owner === view.me && binaryHas(sel, id);
      // 寫實地面 (ceo 2026-10-25): the owner's colour under the feet of those drawn from the atlases,
      // so they stand out from the earth and grass; not up on a wall (its walk is not the ground).
      if (this.groundShown && top !== null && onWall === null) {
        p.foot.visible = true;
        p.foot.position.set(px, py);
        p.foot.scale.set(FOOT_SCALE);
        p.foot.tint = ownerTint(owner, view.me);
        p.foot.alpha = FOOT_ALPHA;
        this.footCount++;
      }
      p.ring.visible = selected;
      if (selected) {
        p.ring.position.set(px, py);
        p.ring.scale.set(1.05);
        p.ring.tint = 0xfff3b0;
      }
      // Behind a castle's wall (D-089): drawn again over it, its ring too when selected. Not one
      // standing on the wall (D-096): it is drawn in front of it.
      if (walls && top !== null) {
        const box = this.artUnits?.pictureBox(i) ?? null;
        const behind = onWall === null && box !== null && this.castle.covers(box, box.z);
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
    this.drawSiegeRanges();
    const id = this.view.selection.building;
    if (id === null) return;
    const o = this.view.buildingRow(id);
    if (o < 0) return;
    const b = (this.view.curr as NonNullable<GameView["curr"]>).snap.buildings;
    const f = this.view.footprint(b, o);
    const x = f.x * TILE_PX;
    const y = f.y * TILE_PX;
    this.fx.rect(x - 2, y - 2, f.w * TILE_PX + 4, f.h * TILE_PX + 4).stroke({ width: 3, color: 0xfff3b0 });
    if (b[o + B.rallyX] >= 0) {
      const rx = b[o + B.rallyX] * FIXED_TO_PX;
      const ry = b[o + B.rallyY] * FIXED_TO_PX;
      this.fx.moveTo(x + (f.w * TILE_PX) / 2, y + (f.h * TILE_PX) / 2).lineTo(rx, ry).stroke({ width: 2, color: 0xfff3b0, alpha: 0.8 });
      this.fx.circle(rx, ry, 5).fill(0xfff3b0);
    }
  }

  /**
   * 攻城砲 selected (D-099): its reach (rules.units range, faint) and the ground it cannot shoot
   * (minRange, a red dashed ring), round each one selected (the first few).
   */
  private drawSiegeRanges(): void {
    const view = this.view;
    const info = view.rules.units[UnitType.Siege];
    if (info === undefined || view.rules.features?.siege !== true) return;
    const reach = info.range * FIXED_TO_PX;
    const near = (info.minRange ?? 0) * FIXED_TO_PX;
    let drawn = 0;
    for (const id of view.selection.units) {
      if (drawn >= 6) break;
      const o = view.unitRow(id);
      if (o < 0 || view.unitType(id) !== UnitType.Siege) continue;
      drawn++;
      const { x, y } = view.unitPos(o);
      this.groundCircle(x, y, reach, { width: 2, color: 0xfff3b0, alpha: 0.55 });
      if (near > 0) this.groundCircle(x, y, near, { width: 2.5, color: 0xff5a4f, alpha: 0.9 }, true);
    }
    this.siegeRangesDrawn = drawn;
  }

  /** Siege engines whose rings were drawn this frame (D-099), for the test page. */
  siegeRangesDrawn = 0;

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

