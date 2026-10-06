// The battlefield in PixiJS, bottom to top: terrain, town zones, buildings, resource nodes,
// selection rings, units, effects (cannon warnings, calibration arcs, rally lines), bars,
// fog, town markers (the player's knowledge, drawn above the fog) and the placement preview.
// Terrain and fog are one small texture each (one texel per cell, scaled up), so they cost
// one sprite. Units, bars and buildings come from pools that only grow.

import { type Application, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import type { Camera } from "../camera/camera.ts";
import {
  Action,
  BuildingField as B,
  BUILDING_STRIDE,
  BuildingFlag,
  BuildingType,
  Fog,
  HeaderField as H,
  NodeField as N,
  Terrain,
  TOWN_STRIDE,
  TownField as T,
  TownState,
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

const UNIT_SCALE = 1;
const BAR_W = TILE_PX * 0.8;
const BAR_H = 3;
/** How dark the fog is: never explored, explored but out of sight (0-255). */
const FOG_ALPHA = { unexplored: 255, explored: 140 };

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

interface TownMark {
  holder: Container;
  flag: Sprite;
  label: Text;
  barBack: Sprite;
  barFront: Sprite;
  key: string;
}

export class WorldRenderer {
  readonly root = new Container();
  private readonly view: GameView;
  private readonly atlas: Atlas;
  private readonly zones = new Graphics();
  private readonly buildingLayer = new Container();
  private readonly nodeLayer = new Container();
  private readonly ringLayer = new Container();
  private readonly unitLayer = new Container();
  private readonly fx = new Graphics();
  private readonly barLayer = new Container();
  private readonly townLayer = new Container();
  private readonly ghost = new Graphics();
  private readonly terrainTexture: Texture;
  private readonly fogCanvas: HTMLCanvasElement;
  private readonly fogTexture: Texture;
  private readonly fogPixels: ImageData;
  private fogVersion = -1;
  private nodesVersion = -1;
  private readonly nodeSprites = new Map<number, Sprite>();
  private readonly unitPool: UnitSprites[] = [];
  private readonly buildingPool: BuildingSprites[] = [];
  private readonly townMarks = new Map<number, TownMark>();
  private zonesKey = "";
  private markers: Marker[] = [];
  private shots: Shot[] = [];
  /** Arrows drawn since the game started (tests). */
  shotCount = 0;

  constructor(app: Application, view: GameView, atlas: Atlas) {
    this.view = view;
    this.atlas = atlas;
    const size = view.map.size;

    const terrain = document.createElement("canvas");
    terrain.width = size;
    terrain.height = size;
    const tctx = terrain.getContext("2d") as CanvasRenderingContext2D;
    const img = tctx.createImageData(size, size);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4;
        const rock = view.map.terrain[y * size + x] === Terrain.Blocked;
        const shade = (x + y) % 2 === 0;
        const [r, g, b] = rock ? [104, 96, 86] : shade ? [86, 116, 64] : [92, 123, 69];
        img.data.set([r, g, b, 255], i);
      }
    }
    tctx.putImageData(img, 0, 0);
    const terrainTex = Texture.from(terrain);
    this.terrainTexture = terrainTex;
    terrainTex.source.scaleMode = "nearest";
    const ground = new Sprite(terrainTex);
    ground.scale.set(TILE_PX);

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

    this.root.addChild(ground, this.zones, this.buildingLayer, this.nodeLayer, this.ringLayer, this.unitLayer, this.fx, this.barLayer, fog, this.townLayer, this.ghost);
    app.stage.addChild(this.root);
  }

  draw(now: number, camera: Camera, placement: Placement | null): void {
    this.root.scale.set(camera.scale);
    this.root.position.set(-camera.x * camera.scale, -camera.y * camera.scale);
    const curr = this.view.curr;
    if (curr === null) return;
    this.drawFog();
    this.drawNodes();
    this.drawBuildings();
    this.drawTowns();
    this.fx.clear();
    this.drawUnits(now);
    this.drawWarnings(now);
    this.drawSelectionExtras();
    this.drawMarkers(now);
    this.drawShots(now);
    this.drawGhost(placement);
  }

  /** Take this game's drawing off the stage (the shared shapes stay). */
  destroy(): void {
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
      const dx = s.tx - s.fx;
      const dy = s.ty - s.fy;
      const len = Math.hypot(dx, dy) || 1;
      const x = s.fx + dx * k;
      const y = s.fy + dy * k;
      const ux = dx / len;
      const uy = dy / len;
      // A shaft 12 px long with a head: it leaves the building and flies to the target.
      this.fx.moveTo(x - ux * 12, y - uy * 12).lineTo(x, y).stroke({ width: 2.5, color: 0x2a1c10 });
      this.fx.moveTo(x - ux * 12, y - uy * 12).lineTo(x, y).stroke({ width: 1.2, color: 0xf4e2b0 });
      this.fx.poly([x + ux * 4, y + uy * 4, x - ux * 2 - uy * 3, y - uy * 2 + ux * 3, x - ux * 2 + uy * 3, y - uy * 2 - ux * 3]).fill(0xf4e2b0);
    }
  }

  private drawMarkers(now: number): void {
    this.markers = this.markers.filter((m) => now - m.at < MARKER_MS);
    for (const m of this.markers) {
      const k = (now - m.at) / MARKER_MS;
      this.fx.circle(m.x, m.y, TILE_PX * (0.3 + 0.5 * k)).stroke({ width: 3, color: m.color, alpha: 1 - k });
    }
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
  }

  private drawNodes(): void {
    if (this.view.nodesVersion === this.nodesVersion) return;
    this.nodesVersion = this.view.nodesVersion;
    for (const [id, row] of this.view.nodes) {
      let s = this.nodeSprites.get(id);
      if (s === undefined) {
        s = new Sprite(this.atlas.nodes[row[N.kind]]);
        s.position.set(row[N.cellX] * TILE_PX, row[N.cellY] * TILE_PX);
        this.nodeLayer.addChild(s);
        this.nodeSprites.set(id, s);
      }
      s.visible = row[N.amount] > 0;
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
      const hpBack = new Sprite(this.atlas.white);
      hpBack.tint = 0x201a18;
      const hpFront = new Sprite(this.atlas.white);
      this.buildingLayer.addChild(base, glyph, occupied);
      this.barLayer.addChild(hpBack, hpFront);
      this.buildingPool.push({ base, glyph, occupied, hpBack, hpFront });
    }
    for (let i = 0; i < this.buildingPool.length; i++) {
      const p = this.buildingPool[i];
      const shown = i < n;
      p.base.visible = p.glyph.visible = shown;
      p.occupied.visible = false;
      p.hpBack.visible = p.hpFront.visible = false;
      if (!shown) continue;
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
      p.glyph.texture = this.atlas.glyphs[type] ?? Texture.EMPTY;
      p.glyph.position.set(x + size / 2, y + size / 2);
      p.glyph.scale.set(Math.min(size * 0.5, 36) / 36);
      p.glyph.alpha = p.base.alpha;
      // 裡面有人 (round 7): a small shield at the top right corner, ours and the enemy's in view.
      if ((b[o + B.flags] & BuildingFlag.Occupied) !== 0 && !remembered) {
        p.occupied.visible = true;
        p.occupied.position.set(x + size - 2, y + 2);
        p.occupied.scale.set(Math.max(1, size / 48));
      }
      const hp = b[o + B.hp];
      const max = info?.hp ?? hp;
      const selected = this.view.selection.building === b[o + B.id];
      if (building || hp < max || selected) {
        const frac = building ? b[o + B.progress] / 1000 : max > 0 ? hp / max : 1;
        this.bar(p.hpBack, p.hpFront, x + size / 2, y - 4, size * 0.8, frac, building ? 0xe7c35a : ownerTint(b[o + B.owner], this.view.me));
      }
    }
  }

  private drawTowns(): void {
    const t = (this.view.curr as NonNullable<GameView["curr"]>).snap.towns;
    const key = t.join(",");
    if (key === this.zonesKey) return;
    this.zonesKey = key;
    this.zones.clear();
    const seen = new Set<number>();
    for (let o = 0; o < t.length; o += TOWN_STRIDE) {
      const id = t[o + T.id];
      const info = this.view.map.towns.find((v) => v.id === id);
      if (info === undefined) continue;
      seen.add(id);
      const look = townLook(t[o + T.state], t[o + T.owner], this.view.me);
      const cx = (info.cellX + 0.5) * TILE_PX;
      const cy = (info.cellY + 0.5) * TILE_PX;
      this.zones.circle(cx, cy, info.radius * TILE_PX).fill({ color: look.tint, alpha: 0.1 }).stroke({ width: 3, color: look.tint, alpha: 0.75 });
      let mark = this.townMarks.get(id);
      if (mark === undefined) {
        const holder = new Container();
        const flag = new Sprite(this.atlas.flag);
        flag.anchor.set(0.3, 0.9);
        flag.scale.set(1.2);
        const label = new Text({ text: "", style: { fontFamily: "-apple-system, 'Noto Sans TC', sans-serif", fontSize: 13, fontWeight: "700", fill: 0xffffff, stroke: { color: 0x000000, width: 3 } }, resolution: 4 });
        label.anchor.set(0.5, 0);
        label.position.set(0, 4);
        const barBack = new Sprite(this.atlas.white);
        barBack.tint = 0x201a18;
        const barFront = new Sprite(this.atlas.white);
        holder.addChild(flag, label, barBack, barFront);
        this.townLayer.addChild(holder);
        mark = { holder, flag, label, barBack, barFront, key: "" };
        this.townMarks.set(id, mark);
      }
      mark.holder.visible = true;
      mark.holder.position.set(cx, cy);
      mark.flag.tint = look.tint;
      mark.label.text = look.label;
      const total = t[o + T.timerTotal];
      const showBar = total > 0 && t[o + T.timer] > 0;
      mark.barBack.visible = mark.barFront.visible = showBar;
      if (showBar) {
        const done = 1 - t[o + T.timer] / total;
        this.bar(mark.barBack, mark.barFront, 0, 26, 48, done, look.tint);
      }
    }
    for (const [id, mark] of this.townMarks) if (!seen.has(id)) mark.holder.visible = false;
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
      this.ringLayer.addChild(ring);
      this.unitLayer.addChild(body, shield);
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
      if (!shown) continue;
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
      const type = u[o + U.type];
      const owner = u[o + U.owner];
      p.body.texture = this.atlas.units[type] ?? this.atlas.units[UnitType.Farmer];
      p.body.tint = ownerTint(owner, view.me);
      p.body.position.set(px, py);
      p.body.scale.set(UNIT_SCALE);
      p.body.rotation = (u[o + U.facing] * Math.PI) / 8;
      const selected = owner === view.me && binaryHas(sel, id);
      p.ring.visible = selected;
      if (selected) {
        p.ring.position.set(px, py);
        p.ring.scale.set(1.05);
        p.ring.tint = 0xfff3b0;
      }
      const info = view.rules.units[type];
      const hp = u[o + U.hp];
      const max = info?.hp ?? hp;
      const shield = u[o + U.shield];
      const shieldMax = info?.shield ?? 0;
      if (shieldMax > 0 && shield > 0) {
        p.shield.visible = true;
        p.shield.position.set(px, py);
        p.shield.scale.set(1.25);
        p.shield.alpha = 0.35 + 0.65 * (shield / shieldMax);
      }
      if (selected || hp < max || (shieldMax > 0 && shield < shieldMax)) {
        this.bar(p.hpBack, p.hpFront, px, py - TILE_PX * 0.62, BAR_W, max > 0 ? hp / max : 1, ownerTint(owner, view.me));
        if (shieldMax > 0) this.bar(p.shBack, p.shFront, px, py - TILE_PX * 0.62 - BAR_H - 1, BAR_W, shield / shieldMax, SHIELD_TINT);
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
  }

  private drawWarnings(now: number): void {
    const w = (this.view.curr as NonNullable<GameView["curr"]>).snap.warnings;
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

  private drawGhost(placement: Placement | null): void {
    this.ghost.clear();
    if (placement === null) return;
    const r = placement.rect();
    const color = placement.valid ? 0x4fd06a : 0xe0473d;
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

