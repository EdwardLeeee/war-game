// 建築與資源點 drawn from war-game-ui's atlases (D-085; docs/sprite-atlas.md section 12,
// design/b1/atlas-buildings.md) instead of the shapes. A building stands at its footprint's
// middle in its state (three construction stages, done, damaged); a destroyed one leaves rubble
// on the ground for a while (the simulation removes it at once and is not changed); a field
// lies on the ground, its crops ripening while farmers work it. Nodes: trees of both cultures in
// clumps, a gold mine half mined, stumps and spent nodes on the ground. Units and buildings are
// ordered by footprints, not by one point (section 6): a unit beside a big building would
// otherwise flicker in front of it and behind it. Only the picture: the game is the same.

import { Container, Sprite } from "pixi.js";
import { type Culture, M_PER_CELL } from "../art/spec.ts";
import { buildingEntry, buildingFrame, buildingState, type BuildingEntry, cropStage, nodeFrame, type NodeEntry, RUBBLE_FADE_S, RUBBLE_HOLD_S, type Side, viewFits } from "../art/structures.ts";
import { buildingFront, depthOf, nodeFront } from "./depth.ts";
import type { Projection } from "../camera/projection.ts";
import { Action, BUILDING_STRIDE, BuildingField as B, BuildingFlag, BuildingType, Fog, HeaderField as H, NodeField as N, TICKS_PER_SECOND, TownField as T, TownState, UNIT_STRIDE, UnitField as U } from "../sim.ts";
import { TILE_PX } from "../tuning.ts";
import type { GameView } from "../view/view.ts";
import { ownerTint } from "./atlas.ts";
import type { ArtFrame, UnitArt } from "./unit-art.ts";

/** Up on the plane per metre up (as castle-draw.ts). */
const UP_PER_M = Math.sqrt(3) / 2;

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
  /**
   * A town's keep's (art-v6, D-100): it lies until the keep stands again on its ground (no fading),
   * and while its town is repaired (TownState.Repairing) it shows `repair`, its scaffolding.
   */
  keep: boolean;
  repair?: string;
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
  /** Buildings ordered and not on the map yet (planned). */
  private readonly planSlots: Slot[] = [];
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

  /**
   * The atlases have buildings (art-v2 on) drawn for this projection's camera (D-088: art-v2's for
   * the diamond; square on, the shapes until art-v3).
   */
  static has(art: UnitArt | null, projection: Projection): boolean {
    if (art === null) return false;
    const b = art.buildings.E ?? art.buildings.W;
    return b !== undefined && viewFits(b.view, projection.kind);
  }

  /** A building's culture: its owner's; the big city's tower 東陸 (ceo 2026-10-18). */
  private side(type: number, owner: number): Side {
    const want: Side = type === BuildingType.TownTower ? "E" : this.cultureOf(owner) === "w" ? "W" : "E";
    return this.art.buildings[want] !== undefined ? want : want === "E" ? "W" : "E";
  }

  private entry(type: number, owner: number): { side: Side; entry: BuildingEntry } | null {
    const side = this.side(type, owner);
    const json = this.art.buildings[side];
    // The rules' size for this map (the big city's tower is 3 × 3 with neighbouring spawns, D-074).
    // Type 9 is the big city's tower (TownTower) until D-100's keeps are on, then the keep (by name, ui).
    const named = type === BuildingType.Keep && this.view.rules.features?.keep === true ? "Keep" : undefined;
    const entry = json === undefined ? undefined : buildingEntry(json, type, this.view.rules.buildings[type]?.size, named);
    return entry === undefined ? null : { side, entry };
  }

  /**
   * 真的箭 (art-v6): where the arrows of the building at row `o` leave its picture (shoot_at_m:
   * metres from its anchor, the footprint's middle; x east, y south, z up), the one nearest
   * (toX, toY) world px, `lift` points up; null without them.
   */
  shootFrom(o: number, toX: number, toY: number): { x: number; y: number; lift: number } | null {
    const b = this.view.curr?.snap.buildings;
    if (b === undefined) return null;
    const found = this.entry(b[o + B.type], b[o + B.owner]);
    const points = found?.entry.shoot_at_m ?? [];
    if (found === null || points.length === 0) return null;
    const size = found.entry.footprint[0];
    const cx = (b[o + B.cellX] + size / 2) * TILE_PX;
    const cy = (b[o + B.cellY] + size / 2) * TILE_PX;
    const perM = TILE_PX / M_PER_CELL;
    let best: { x: number; y: number; lift: number } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const [mx, my, mz] of points) {
      const x = cx + mx * perM;
      const y = cy + my * perM;
      const d = (x - toX) ** 2 + (y - toY) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { x, y, lift: mz * this.projection.ptPerM * UP_PER_M };
      }
    }
    return best;
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
    // A keep's full hit points are its town's (D-100: a small town's 600, buildings[Keep] the big city's 1000).
    const max = this.view.buildingMaxHp(b, o);
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
    // Behind what stands in front of its footprint (the units' depth: unitDepth). Square on
    // (D-088) by its front edge (depth.ts); as a diamond by its middle, the units corrected.
    const z = this.projection.kind === "oblique" ? depthOf(this.projection.toPlane(0, buildingFront(cellY, size) * TILE_PX).y, cellX, b[o + B.id]) : at.y;
    s.color.zIndex = s.team.zIndex = z;
    s.team.zIndex += 0.000001;
    const w = color.texture.width * this.scale;
    const h = color.texture.height * this.scale;
    const top = at.y - color.ay * h;
    this.drawn.push({ id: b[o + B.id], cellX, cellY, size, z, x0: at.x - color.ax * w, y0: top, x1: at.x + (1 - color.ax) * w, y1: at.y + (1 - color.ay) * h });
    const n = this.view.map.size;
    for (let y = cellY; y < cellY + size; y++) for (let x = cellX; x < cellX + size; x++) if (x >= 0 && y >= 0 && x < n && y < n) this.cellOwner[y * n + x] = this.drawn.length;
    return { top };
  }

  /**
   * Buildings ordered and not on the map yet (R6-31: the game paused, they wait for 繼續): each
   * finished, see-through, in the player's colours. Not tapped, and units are not behind them.
   */
  planned(sites: readonly { type: number; x: number; y: number }[], alpha: number): void {
    for (let i = 0; i < Math.max(sites.length, this.planSlots.length); i++) {
      const site = sites[i];
      if (site === undefined) {
        this.hide(this.planSlots[i]);
        continue;
      }
      while (this.planSlots.length <= i) this.planSlots.push({ color: sprite(this.upright), team: sprite(this.upright), shadow: sprite(this.shadows), ground: sprite(this.ground) });
      const s = this.planSlots[i];
      const found = this.entry(site.type, this.view.me);
      if (found === null) {
        this.hide(s);
        continue;
      }
      const { side, entry } = found;
      const size = entry.footprint[0];
      const at = this.projection.toPlane((site.x + size / 2) * TILE_PX, (site.y + size / 2) * TILE_PX);
      if (entry.ground === true) {
        s.color.visible = s.team.visible = s.shadow.visible = false;
        put(s.ground, this.art.buildingFrame(side, "color", (entry.crops ?? [])[0] ?? buildingFrame(entry, "done") ?? ""), at.x, at.y, this.scale);
        s.ground.alpha = alpha;
        continue;
      }
      const name = buildingFrame(entry, "done") ?? "";
      s.ground.visible = false;
      put(s.color, this.art.buildingFrame(side, "color", name), at.x, at.y, this.scale);
      put(s.team, this.art.buildingFrame(side, "team", name), at.x, at.y, this.scale);
      put(s.shadow, this.art.buildingFrame(side, "shadow", name), at.x, at.y, this.scale);
      s.color.tint = 0xffffff;
      s.team.tint = ownerTint(this.view.me, this.view.me);
      s.color.alpha = s.team.alpha = alpha;
      s.shadow.alpha = alpha * 0.6;
      // Ordered as a building there would be (square on by its front edge, depth.ts).
      const z = this.projection.kind === "oblique" ? depthOf(this.projection.toPlane(0, buildingFront(site.y, size) * TILE_PX).y, site.x, 0) : at.y;
      s.color.zIndex = s.team.zIndex = z;
      s.team.zIndex += 0.000001;
    }
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
    // Square on (D-088): its own y is its front edge (depth.ts); nothing to correct.
    if (this.drawn.length === 0 || this.projection.kind === "oblique") return py;
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
      // A keep only with D-100's on (Rules.features.keep): before, type 9 is the big city's tower, its rubble fading as any.
      const keep = was.entry.type === BuildingType.Keep && this.view.rules.features?.keep === true;
      if (name !== undefined && this.visible(was.cellX, was.cellY, was.size)) this.rubble.push({ side: was.side, name, cellX: was.cellX, cellY: was.cellY, size: was.size, since: seconds, keep, repair: keep ? was.entry.states.repair : undefined });
    }
    this.seen = now;
    this.rubble = this.rubble.filter((r) => r.keep || seconds - r.since < RUBBLE_HOLD_S + RUBBLE_FADE_S);
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
      const name = r.keep && r.repair !== undefined && this.repairing(r) ? r.repair : r.name;
      put(s, this.art.buildingFrame(r.side, "color", name), at.x, at.y, this.scale);
      const fade = r.keep ? 0 : seconds - r.since - RUBBLE_HOLD_S;
      s.alpha = fade > 0 ? Math.max(0, 1 - fade / RUBBLE_FADE_S) : 1;
      s.tint = this.visible(r.cellX, r.cellY, r.size) ? 0xffffff : OUT_OF_VIEW;
    });
    for (let i = this.rubble.length; i < this.rubbleSprites.length; i++) this.rubbleSprites[i].visible = false;
  }

  /** A keep's rubble whose town is being repaired now (its keep to stand again when the repair is done). */
  private repairing(r: Rubble): boolean {
    const t = this.view.curr?.snap.towns;
    for (const town of this.view.knownTowns.values()) {
      if (town.cellX < r.cellX || town.cellX >= r.cellX + r.size || town.cellY < r.cellY || town.cellY >= r.cellY + r.size) continue;
      const o = this.view.townRow(town.id);
      return o >= 0 && t !== undefined && t[o + T.state] === TownState.Repairing;
    }
    return false;
  }

  /** The nodes the player knows: standing, or spent on the ground; darker out of view. */
  drawNodes(): void {
    const nodes = this.art.nodes;
    if (nodes === null || !this.drawsNodes) return;
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
      // Square on by its cell's front edge (depth.ts); as a diamond by its middle.
      ns.color.zIndex = this.projection.kind === "oblique" ? depthOf(this.projection.toPlane(0, nodeFront(row[N.cellY]) * TILE_PX).y, row[N.cellX], id) : at.y;
      put(ns.shadow, spent ? null : this.art.nodeFrame("shadow", name ?? ""), at.x, at.y, this.nodeScale);
    }
    this.tintNodes();
  }

  /** The nodes' tints as the fog changes. */
  tintNodes(): void {
    const fog = this.view.fog;
    for (const ns of this.nodeSprites.values()) ns.color.tint = fog === null || fog[ns.cell] === Fog.Visible ? 0xffffff : OUT_OF_VIEW;
  }

  /** Whether nodes are drawn from the atlases, drawn for this camera (the renderer then draws no marks for them). */
  get drawsNodes(): boolean {
    return this.art.nodes !== null && viewFits(this.art.nodes.view, this.projection.kind);
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
