// Units drawn from war-game-ui's atlases (D-085; docs/sprite-atlas.md sections 3–7) instead of
// the shapes: per unit its shadow on the ground, then its colour and player-colour layers (the
// player's colour as the tint) and a mage's shield, in front of what stands above it on the
// screen. The animation follows the snapshot's action on the simulation's clock (paused, it
// stops; faster, it plays faster). The simulation has no death event (and is not changed):
// a unit gone from the snapshot where we still see, and not into a building, has fallen, and
// lies a while where it fell. The selection ring, bars and marks stay the renderer's.

import { Container, Sprite } from "pixi.js";
import { animFor, attackFrame, type AtlasJson, CORPSE_FADE_S, CORPSE_HOLD_S, type Culture, fpsOf, frameAt, frameName, pictureDirection, UNIT_ATLAS, walkFps, workOfNode, type WorkKind } from "../art/spec.ts";
import { type Projection, TOP } from "../camera/projection.ts";
import { Action, BuildingType, BuildingField as B, Fog, HeaderField as H, NodeField as N, Order, TICKS_PER_SECOND, UnitField as U, UNIT_STRIDE } from "../sim.ts";
import { TILE_PX } from "../tuning.ts";
import { FIXED_TO_PX, type GameView } from "../view/view.ts";
import { ownerTint } from "./atlas.ts";
import type { ArtFrame, UnitArt } from "./unit-art.ts";

interface Slot {
  box: Container;
  color: Sprite;
  team: Sprite;
  shield: Sprite;
  shadow: Sprite;
}

interface AnimState {
  action: number;
  anim: string;
  since: number;
  dir: number | null;
}

interface Seen {
  atlas: string;
  owner: number;
  x: number;
  y: number;
  dir: number;
  hiding: boolean;
}

interface Corpse extends Seen {
  anim: string;
  since: number;
}

function sprite(): Sprite {
  const s = new Sprite();
  s.visible = false;
  return s;
}

function put(s: Sprite, f: ArtFrame | null, x: number, y: number, scale: number, mirror: boolean): void {
  if (f === null) {
    s.visible = false;
    return;
  }
  s.visible = true;
  s.texture = f.texture;
  s.anchor.set(f.ax, f.ay);
  s.position.set(x, y);
  const k = f.half ? scale * 2 : scale;
  s.scale.set(mirror ? -k : k, k);
}

export class ArtUnits {
  readonly art: UnitArt;
  private readonly view: GameView;
  private readonly shadowLayer: Container;
  private readonly unitLayer: Container;
  private readonly cultureOf: (owner: number) => Culture;
  private readonly projection: Projection;
  /** Plane points an image point: the plane's points a metre over the atlases' px_per_m (docs/sprite-atlas.md section 6). */
  private readonly scale: number;
  private readonly slots: Slot[] = [];
  private readonly corpseSlots: Slot[] = [];
  private readonly anims = new Map<number, AnimState>();
  private seen = new Map<number, Seen>();
  private corpses: Corpse[] = [];
  private lastTick = -1;

  constructor(art: UnitArt, view: GameView, shadowLayer: Container, unitLayer: Container, cultureOf: (owner: number) => Culture, projection: Projection = TOP) {
    this.art = art;
    this.view = view;
    this.shadowLayer = shadowLayer;
    this.unitLayer = unitLayer;
    this.unitLayer.sortableChildren = true;
    this.cultureOf = cultureOf;
    this.projection = projection;
    this.scale = projection.ptPerM / art.pxPerM;
  }

  private slot(list: Slot[], i: number): Slot {
    while (list.length <= i) {
      const box = new Container();
      const s: Slot = { box, color: sprite(), team: sprite(), shield: sprite(), shadow: sprite() };
      box.addChild(s.color, s.team, s.shield);
      this.unitLayer.addChild(box);
      this.shadowLayer.addChild(s.shadow);
      list.push(s);
    }
    return list[i];
  }

  /** The atlas a unit wears, or null (the renderer draws its shape). */
  atlasFor(type: number, owner: number): AtlasJson | null {
    const name = UNIT_ATLAS[type]?.[this.cultureOf(owner)];
    return name === undefined ? null : (this.art.atlases.get(name) ?? null);
  }

  /** What a gathering farmer works at: its order's node, or a farm. */
  private workOf(target: number): WorkKind {
    const node = this.view.nodes.get(target);
    if (node !== undefined) return workOfNode(node[N.kind]);
    const o = this.view.buildingRow(target);
    const b = this.view.curr?.snap.buildings;
    return o >= 0 && b !== undefined && b[o + B.type] === BuildingType.Farm ? "farm" : null;
  }

  /**
   * Draws snapshot row `o` into slot `i` at (px, py), `seconds` on the simulation's clock.
   * Returns the top of its picture (world px), for the bars above it, or null when it has no atlas.
   */
  unit(i: number, o: number, px: number, py: number, seconds: number): number | null {
    const u = (this.view.curr as NonNullable<GameView["curr"]>).snap.units;
    const id = u[o + U.id];
    const type = u[o + U.type];
    const owner = u[o + U.owner];
    const action = u[o + U.action];
    const a = this.atlasFor(type, owner);
    const s = this.slot(this.slots, i);
    if (a === null) {
      this.hide(s);
      return null;
    }
    const anim = animFor(a, action, action === Action.Gather ? this.workOf(u[o + U.orderTarget]) : null);
    let st = this.anims.get(id);
    if (st === undefined || st.action !== action || st.anim !== anim) {
      st = { action, anim, since: seconds, dir: st?.dir ?? null };
      this.anims.set(id, st);
    }
    const dir = pictureDirection(u[o + U.facing], st.dir, this.projection.kind);
    st.dir = dir;
    const info = a.anims[anim];
    const elapsed = seconds - st.since;
    const unitInfo = this.view.rules.units[type];
    let index: number;
    if (anim === "attack") index = attackFrame(info, fpsOf(a, anim), elapsed, (unitInfo?.cooldown ?? 20) / TICKS_PER_SECOND);
    else if (anim === "cast") index = Math.min(u[o + U.castProgress], info.frames - 1);
    else if (anim === "walk") index = frameAt(info, walkFps(a, unitInfo?.speed ?? 0), elapsed, id % info.frames);
    else index = frameAt(info, fpsOf(a, anim), elapsed, info.loop ? id % info.frames : 0);
    this.place(s, a, anim, dir, index, owner, px, py, 1);
    // A mage's shield while it holds (its own picture: one direction, never mirrored).
    const shieldMax = unitInfo?.shield ?? 0;
    if (shieldMax > 0 && u[o + U.shield] > 0) put(s.shield, this.art.frame(a.unit, "shield", `${a.unit}_shield_on_00`), 0, 0, this.scale, false);
    else s.shield.visible = false;
    const f = this.art.frame(a.unit, "color", frameName(a, anim, dir, index).name);
    return f === null ? null : py - f.ay * f.texture.height * this.scale;
  }

  private place(s: Slot, a: AtlasJson, anim: string, dir: number, index: number, owner: number, px: number, py: number, alpha: number): void {
    const { name, mirror } = frameName(a, anim, dir, index);
    s.box.visible = true;
    s.box.position.set(px, py);
    s.box.zIndex = py;
    s.box.alpha = alpha;
    put(s.color, this.art.frame(a.unit, "color", name), 0, 0, this.scale, mirror);
    put(s.team, this.art.frame(a.unit, "team", name), 0, 0, this.scale, mirror);
    s.team.tint = ownerTint(owner, this.view.me);
    put(s.shadow, this.art.frame(a.unit, "shadow", frameName(a, anim, dir, index, "shadow").name), px, py, this.scale, false);
    s.shadow.alpha = alpha;
  }

  private hide(s: Slot): void {
    s.box.visible = false;
    s.shadow.visible = false;
  }

  /** Units drawn from the atlases this frame, and the fallen lying there (for the test page). */
  get drawn(): { units: number; corpses: number } {
    return { units: this.slots.filter((s) => s.box.visible && s.color.visible).length, corpses: this.corpses.length };
  }

  /** Slot `i` shows nobody this frame (a unit hidden in a building, or no unit). */
  hideSlot(i: number): void {
    const s = this.slots[i];
    if (s !== undefined) this.hide(s);
  }

  /**
   * Once per snapshot: units gone from it while we still see where they stood, and not into a
   * building, have fallen (spec section 7); the rest of what we knew of them is forgotten.
   */
  snapshot(seconds: number): void {
    const view = this.view;
    const snap = view.curr?.snap;
    const tick = snap?.header[H.tick] ?? -1;
    if (snap === undefined || tick === this.lastTick) return;
    this.lastTick = tick;
    const u = snap.units;
    const now = new Map<number, Seen>();
    for (let o = 0; o < u.length; o += UNIT_STRIDE) {
      const id = u[o + U.id];
      const a = this.atlasFor(u[o + U.type], u[o + U.owner]);
      if (a === null) continue;
      const order = u[o + U.order];
      now.set(id, {
        atlas: a.unit,
        owner: u[o + U.owner],
        x: u[o + U.x] * FIXED_TO_PX,
        y: u[o + U.y] * FIXED_TO_PX,
        dir: this.anims.get(id)?.dir ?? 6,
        hiding: u[o + U.action] === Action.Garrisoned || order === Order.Garrison || order === Order.Post,
      });
    }
    const size = view.map.size;
    for (const [id, was] of this.seen) {
      if (now.has(id)) continue;
      this.anims.delete(id);
      if (was.hiding) continue;
      const cx = Math.floor(was.x / TILE_PX);
      const cy = Math.floor(was.y / TILE_PX);
      const visible = view.fog === null || view.fog[cy * size + cx] === Fog.Visible;
      if (!visible) continue;
      const a = this.art.atlases.get(was.atlas);
      if (a === undefined) continue;
      this.corpses.push({ ...was, anim: a.anims.fall !== undefined ? "fall" : "death", since: seconds });
    }
    this.seen = now;
  }

  /** The fallen: their fall played once, the last frame held, then faded (spec section 7). */
  drawCorpses(seconds: number): void {
    this.corpses = this.corpses.filter((c) => {
      const a = this.art.atlases.get(c.atlas);
      const info = a?.anims[c.anim];
      if (a === undefined || info === undefined) return false;
      const fps = fpsOf(a, c.anim);
      const played = info.frames / fps;
      return seconds - c.since < played + CORPSE_HOLD_S + CORPSE_FADE_S;
    });
    this.corpses.forEach((c, i) => {
      const a = this.art.atlases.get(c.atlas) as AtlasJson;
      const info = a.anims[c.anim];
      const fps = fpsOf(a, c.anim);
      const elapsed = seconds - c.since;
      const fade = elapsed - info.frames / fps - CORPSE_HOLD_S;
      const at = this.projection.toPlane(c.x, c.y);
      this.place(this.slot(this.corpseSlots, i), a, c.anim, c.dir, frameAt(info, fps, elapsed), c.owner, at.x, at.y, fade > 0 ? Math.max(0, 1 - fade / CORPSE_FADE_S) : 1);
      this.corpseSlots[i].shield.visible = false;
    });
    for (let i = this.corpses.length; i < this.corpseSlots.length; i++) this.hide(this.corpseSlots[i]);
  }

  destroy(): void {
    for (const s of [...this.slots, ...this.corpseSlots]) {
      s.box.destroy({ children: true });
      s.shadow.destroy();
    }
    this.slots.length = 0;
    this.corpseSlots.length = 0;
  }
}
