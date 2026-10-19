// 建築與資源點 drawn from war-game-ui's atlases (D-085; docs/sprite-atlas.md section 12,
// design/b1/atlas-buildings.md) instead of the shapes. A building stands at its footprint's
// middle in its state (three construction stages, done, damaged); a destroyed one leaves rubble
// on the ground for a while (the simulation removes it at once and is not changed); a field
// lies on the ground, its crops ripening while farmers work it. Nodes: trees of both cultures in
// clumps, a gold mine half mined, stumps and spent nodes on the ground. Units and buildings are
// ordered by footprints, not by one point (section 6): a unit beside a big building would
// otherwise flicker in front of it and behind it. Only the picture: the game is the same.

import { Container, Sprite } from "pixi.js";
import { type Culture } from "../art/spec.ts";
import { buildingEntry, buildingFrame, buildingState, type BuildingEntry, cropStage, nodeFrame, type NodeEntry, RUBBLE_FADE_S, RUBBLE_HOLD_S, type Side } from "../art/structures.ts";
import type { Projection } from "../camera/projection.ts";
import { Action, BUILDING_STRIDE, BuildingField as B, BuildingFlag, BuildingType, Fog, HeaderField as H, NodeField as N, TICKS_PER_SECOND, UNIT_STRIDE, UnitField as U } from "../sim.ts";
import { TILE_PX } from "../tuning.ts";
import type { GameView } from "../view/view.ts";
import { ownerTint } from "./atlas.ts";
import type { ArtFrame, UnitArt } from "./unit-art.ts";

/** What is not in view now (remembered, or under the fog), drawn darker. */
const OUT_OF_VIEW = 0x8a8a8a;

interface Slot {
  color: Sprite;
  team: Sprite;
  shadow: Sprite;
  /** A field's picture, on the ground. */
  ground: Sprite;
}

/** A building drawn this frame standing up: its footprint (cells), depth, and picture (plane). */
interface Drawn {
  id: number;
  cellX: number;
  cellY: number;
  size: number;
  z: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface Seen {
  side: Side;
  entry: BuildingEntry;
  cellX: number;
  cellY: number;
  size: number;
  remembered: boolean;
}

interface Rubble {
  side: Side;
  name: string;
  cellX: number;
  cellY: number;
  size: number;
  since: number;
}

interface NodeSprites {
  color: Sprite;
  shadow: Sprite;
  cell: number;
}

function sprite(parent: Container): Sprite {
  const s = new Sprite();
  s.visible = false;
  parent.addChild(s);
  return s;
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

export class ArtStructures {
  private readonly art: UnitArt;
  private readonly view: GameView;
  private readonly ground: Container;
  private readonly shadows: Container;
  private readonly upright: Container;
  private readonly cultureOf: (owner: number) => Culture;
  private readonly projection: Projection;
  private readonly scale: number;
  private readonly nodeScale: number;
  private readonly slots: Slot[] = [];
  private readonly drawn: Drawn[] = [];
  /** Cell → index + 1 in `drawn` (0: none), for the units' depth. */
  private readonly cellOwner: Int32Array;
  private seen = new Map<number, Seen>();
  private rubble: Rubble[] = [];
  private readonly rubbleSprites: Sprite[] = [];
  /** Seconds farmers have worked each field (its crops, section 3). */
  private readonly worked = new Map<number, number>();
  private readonly nodeSprites = new Map<number, NodeSprites>();
  /** A gold mine's amount when first seen: mined at half of it. */
  private readonly firstAmount = new Map<number, number>();
  private lastTick = -1;

  constructor(art: UnitArt, view: GameView, layers: { ground: Container; shadows: Container; upright: Container }, cultureOf: (owner: number) => Culture, projection: Projection) {
    this.art = art;
    this.view = view;
    this.ground = layers.ground;
    this.shadows = layers.shadows;
    this.upright = layers.upright;
    this.cultureOf = cultureOf;
    this.projection = projection;
    const b = art.buildings.E ?? art.buildings.W;
    this.scale = projection.ptPerM / (b?.px_per_m ?? 60);
    this.nodeScale = projection.ptPerM / (art.nodes?.px_per_m ?? 60);
    this.cellOwner = new Int32Array(view.map.size * view.map.size);
  }

  /** The atlases have buildings (art-v2 on). */
  static has(art: UnitArt | null): boolean {
    return art !== null && (art.buildings.E !== undefined || art.buildings.W !== undefined);
  }

  /** A building's culture: its owner's; the big city's tower 東陸 (ceo 2026-10-18). */
  private side(type: number, owner: number): Side {
    const want: Side = type === BuildingType.TownTower ? "E" : this.cultureOf(owner) === "w" ? "W" : "E";
    return this.art.buildings[want] !== undefined ? want : want === "E" ? "W" : "E";
  }

  private entry(type: number, owner: number): { side: Side; entry: BuildingEntry } | null {
    const side = this.side(type, owner);
    const json = this.art.buildings[side];
    const entry = json === undefined ? undefined : buildingEntry(json, type);
    return entry === undefined ? null : { side, entry };
  }

  private visible(cellX: number, cellY: number, size: number): boolean {
    const fog = this.view.fog;
    if (fog === null) return true;
    const n = this.view.map.size;
    for (let y = cellY; y < cellY + size; y++) for (let x = cellX; x < cellX + size; x++) if (x >= 0 && y >= 0 && x < n && y < n && fog[y * n + x] === Fog.Visible) return true;
    return false;
  }

  private slot(i: number): Slot {
    while (this.slots.length <= i) this.slots.push({ color: sprite(this.upright), team: sprite(this.upright), shadow: sprite(this.shadows), ground: sprite(this.ground) });
    return this.slots[i];
  }

  /** Before the buildings of a frame. */
  begin(): void {
    this.drawn.length = 0;
    this.cellOwner.fill(0);
  }

  /**
   * Draws snapshot building row `o` into slot `i`: true when drawn from the atlases (the
   * renderer then hides its shape), with its picture's top on the plane in `top`.
   */
  building(i: number, o: number): { top: number } | null {
    const b = (this.view.curr as NonNullable<GameView["curr"]>).snap.buildings;
    const type = b[o + B.type];
    const owner = b[o + B.owner];
    const found = this.entry(type, owner);
    const s = this.slot(i);
    if (found === null) {
      this.hide(s);
      return null;
    }
    const { side, entry } = found;
    const size = entry.footprint[0];
    const cellX = b[o + B.cellX];
    const cellY = b[o + B.cellY];
    const progress = b[o + B.progress];
    const remembered = (b[o + B.flags] & BuildingFlag.Remembered) !== 0;
    const at = this.projection.toPlane((cellX + size / 2) * TILE_PX, (cellY + size / 2) * TILE_PX);
    const tint = remembered || !this.visible(cellX, cellY, size) ? OUT_OF_VIEW : 0xffffff;
    let name: string | null;
    if (entry.ground === true) {
      // A field: its construction, then its crops (they ripen while farmers work it).
      const crops = entry.crops ?? [];
      name = progress < 1000 ? buildingFrame(entry, buildingState(progress, 1, 1)) : (crops[cropStage(this.worked.get(b[o + B.id]) ?? 0, crops.length)] ?? null);
      s.color.visible = s.team.visible = s.shadow.visible = false;
      put(s.ground, this.art.buildingFrame(side, "color", name ?? ""), at.x, at.y, this.scale);
      s.ground.tint = tint;
      return s.ground.visible ? { top: at.y } : null;
    }
    const max = this.view.rules.buildings[type]?.hp ?? 0;
    name = buildingFrame(entry, buildingState(progress, b[o + B.hp], max));
    s.ground.visible = false;
    const color = this.art.buildingFrame(side, "color", name ?? "");
    if (color === null) {
      this.hide(s);
      return null;
    }
    put(s.color, color, at.x, at.y, this.scale);
    put(s.team, this.art.buildingFrame(side, "team", name ?? ""), at.x, at.y, this.scale);
    put(s.shadow, this.art.buildingFrame(side, "shadow", name ?? ""), at.x, at.y, this.scale);
    s.color.tint = tint;
    s.team.tint = remembered ? OUT_OF_VIEW : ownerTint(owner, this.view.me);
    // Behind what stands in front of its footprint (the units' depth: unitDepth).
    s.color.zIndex = s.team.zIndex = at.y;
    s.team.zIndex += 0.001;
    const w = color.texture.width * this.scale;
    const h = color.texture.height * this.scale;
    const top = at.y - color.ay * h;
    this.drawn.push({ id: b[o + B.id], cellX, cellY, size, z: at.y, x0: at.x - color.ax * w, y0: top, x1: at.x + (1 - color.ax) * w, y1: at.y + (1 - color.ay) * h });
    const n = this.view.map.size;
    for (let y = cellY; y < cellY + size; y++) for (let x = cellX; x < cellX + size; x++) if (x >= 0 && y >= 0 && x < n && y < n) this.cellOwner[y * n + x] = this.drawn.length;
    return { top };
  }

  hideSlot(i: number): void {
    const s = this.slots[i];
    if (s !== undefined) this.hide(s);
  }

  private hide(s: Slot): void {
    s.color.visible = s.team.visible = s.shadow.visible = s.ground.visible = false;
  }

  /**
   * A unit's depth at (px, py) on the plane (section 6): in front of a building whose footprint
   * lies wholly at smaller x or smaller y than it, behind one wholly at larger; else by its place
   * on the screen. Buildings within a few cells only.
   */
  unitDepth(px: number, py: number): number {
    if (this.drawn.length === 0) return py;
    const w = this.projection.toWorld(px, py);
    const ux = w.x / TILE_PX;
    const uy = w.y / TILE_PX;
    const n = this.view.map.size;
    const cx = Math.floor(ux);
    const cy = Math.floor(uy);
    let depth = py;
    let last = 0;
    for (let y = Math.max(0, cy - 4); y <= Math.min(n - 1, cy + 4); y++) {
      for (let x = Math.max(0, cx - 4); x <= Math.min(n - 1, cx + 4); x++) {
        const k = this.cellOwner[y * n + x];
        if (k === 0 || k === last) continue;
        last = k;
        const d = this.drawn[k - 1];
        if (ux >= d.cellX + d.size || uy >= d.cellY + d.size) depth = Math.max(depth, d.z + 0.01);
        else if (ux <= d.cellX || uy <= d.cellY) depth = Math.min(depth, d.z - 0.01);
      }
    }
    return depth;
  }

  /** The building whose picture is under (px, py) on the plane, the nearest in front. */
  pictureAt(px: number, py: number): number | null {
    let best: Drawn | null = null;
    for (const d of this.drawn) if (px >= d.x0 && px <= d.x1 && py >= d.y0 && py <= d.y1 && (best === null || d.z > best.z)) best = d;
    return best?.id ?? null;
  }

  /** The building whose picture is under (px, py) and drawn in front of a unit standing at (ux, uy): it hides the unit there. */
  coverAt(px: number, py: number, ux: number, uy: number): number | null {
    const depth = this.unitDepth(ux, uy);
    let best: Drawn | null = null;
    for (const d of this.drawn) if (d.z > depth && px >= d.x0 && px <= d.x1 && py >= d.y0 && py <= d.y1 && (best === null || d.z > best.z)) best = d;
    return best?.id ?? null;
  }

  /**
   * Once a tick: a building gone while we still see its ground was destroyed (its rubble lies a
   * while; a new building on that ground clears it at once), and the fields' farmers' work.
   */
  snapshot(seconds: number): void {
    const snap = this.view.curr?.snap;
    const tick = snap?.header[H.tick] ?? -1;
    if (snap === undefined || tick === this.lastTick) return;
    const dt = this.lastTick < 0 ? 0 : (tick - this.lastTick) / TICKS_PER_SECOND;
    this.lastTick = tick;
    const b = snap.buildings;
    const now = new Map<number, Seen>();
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      const found = this.entry(b[o + B.type], b[o + B.owner]);
      if (found === null) continue;
      const id = b[o + B.id];
      const seen: Seen = { ...found, cellX: b[o + B.cellX], cellY: b[o + B.cellY], size: found.entry.footprint[0], remembered: (b[o + B.flags] & BuildingFlag.Remembered) !== 0 };
      now.set(id, seen);
      // Ground broken for a new building: the rubble there goes.
      if (!this.seen.has(id)) this.rubble = this.rubble.filter((r) => r.cellX >= seen.cellX + seen.size || seen.cellX >= r.cellX + r.size || r.cellY >= seen.cellY + seen.size || seen.cellY >= r.cellY + r.size);
    }
    for (const [id, was] of this.seen) {
      if (now.has(id) || was.remembered) continue;
      this.worked.delete(id);
      const name = was.entry.states.rubble;
      if (name !== undefined && this.visible(was.cellX, was.cellY, was.size)) this.rubble.push({ side: was.side, name, cellX: was.cellX, cellY: was.cellY, size: was.size, since: seconds });
    }
    this.seen = now;
    this.rubble = this.rubble.filter((r) => seconds - r.since < RUBBLE_HOLD_S + RUBBLE_FADE_S);
    // The fields with a farmer at work in them this tick.
    if (dt > 0) {
      const u = snap.units;
      const fields = new Set<number>();
      for (let o = 0; o < u.length; o += UNIT_STRIDE) if (u[o + U.action] === Action.Gather) fields.add(u[o + U.orderTarget]);
      for (const [id, s] of now) if (s.entry.ground === true && fields.has(id)) this.worked.set(id, (this.worked.get(id) ?? 0) + dt);
    }
  }

  /** The rubble, on the ground, faded over its last seconds. */
  drawRubble(seconds: number): void {
    this.rubble.forEach((r, i) => {
      while (this.rubbleSprites.length <= i) this.rubbleSprites.push(sprite(this.ground));
      const s = this.rubbleSprites[i];
      const at = this.projection.toPlane((r.cellX + r.size / 2) * TILE_PX, (r.cellY + r.size / 2) * TILE_PX);
      put(s, this.art.buildingFrame(r.side, "color", r.name), at.x, at.y, this.scale);
      const fade = seconds - r.since - RUBBLE_HOLD_S;
      s.alpha = fade > 0 ? Math.max(0, 1 - fade / RUBBLE_FADE_S) : 1;
      s.tint = this.visible(r.cellX, r.cellY, r.size) ? 0xffffff : OUT_OF_VIEW;
    });
    for (let i = this.rubble.length; i < this.rubbleSprites.length; i++) this.rubbleSprites[i].visible = false;
  }

  /** The nodes the player knows: standing, or spent on the ground; darker out of view. */
  drawNodes(): void {
    const nodes = this.art.nodes;
    if (nodes === null) return;
    const byKind = new Map<number, NodeEntry>(Object.values(nodes.nodes).map((e) => [e.kind, e]));
    const size = this.view.map.size;
    for (const [id, row] of this.view.nodes) {
      const e = byKind.get(row[N.kind]);
      if (e === undefined) continue;
      let ns = this.nodeSprites.get(id);
      if (ns === undefined) {
        ns = { color: sprite(this.upright), shadow: sprite(this.shadows), cell: row[N.cellY] * size + row[N.cellX] };
        this.nodeSprites.set(id, ns);
      }
      const amount = row[N.amount];
      if (!this.firstAmount.has(id) && amount > 0) this.firstAmount.set(id, amount);
      const name = nodeFrame(e, row[N.cellX], row[N.cellY], amount, this.firstAmount.get(id) ?? amount);
      const spent = amount <= 0;
      // Spent: on the ground (under everyone), no shadow.
      const parent = spent ? this.ground : this.upright;
      if (ns.color.parent !== parent) parent.addChild(ns.color);
      const at = this.projection.toPlane((row[N.cellX] + 0.5) * TILE_PX, (row[N.cellY] + 0.5) * TILE_PX);
      put(ns.color, this.art.nodeFrame("color", name ?? ""), at.x, at.y, this.nodeScale);
      ns.color.zIndex = at.y;
      put(ns.shadow, spent ? null : this.art.nodeFrame("shadow", name ?? ""), at.x, at.y, this.nodeScale);
    }
    this.tintNodes();
  }

  /** The nodes' tints as the fog changes. */
  tintNodes(): void {
    const fog = this.view.fog;
    for (const ns of this.nodeSprites.values()) ns.color.tint = fog === null || fog[ns.cell] === Fog.Visible ? 0xffffff : OUT_OF_VIEW;
  }

  /** Whether nodes are drawn from the atlases (the renderer then draws no marks for them). */
  get drawsNodes(): boolean {
    return this.art.nodes !== null;
  }

  /** For the test page: buildings drawn from the atlases this frame, rubble lying, nodes. */
  get counts(): { buildings: number; rubble: number; nodes: number } {
    return { buildings: this.slots.filter((s) => s.color.visible || s.ground.visible).length, rubble: this.rubble.length, nodes: [...this.nodeSprites.values()].filter((n) => n.color.visible).length };
  }

  destroy(): void {
    for (const s of this.slots) for (const sp of [s.color, s.team, s.shadow, s.ground]) sp.destroy();
    for (const s of this.rubbleSprites) s.destroy();
    for (const n of this.nodeSprites.values()) {
      n.color.destroy();
      n.shadow.destroy();
    }
    this.slots.length = 0;
    this.rubbleSprites.length = 0;
    this.nodeSprites.clear();
  }
}
