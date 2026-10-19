// Units drawn from war-game-ui's atlases (D-085; docs/sprite-atlas.md sections 3–7, 11) instead
// of the shapes: per unit its shadow on the ground, then its colour and player-colour layers (the
// player's colour as the tint), a mage's shield and its effects layer, in front of what stands
// above it on the screen. The animation follows the snapshot's action on the simulation's clock
// (paused, it stops; faster, it plays faster); a mage's shield follows the snapshot's `shield`
// (on, hit, break, back). The simulation has no death event (and is not changed): a unit gone
// from the snapshot where we still see, and not into a building, has fallen, lies a while where
// it fell, and raises a little dust as it lands. The selection ring, bars and marks stay the
// renderer's.

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
  fx: Sprite;
  shadow: Sprite;
}

interface AnimState {
  action: number;
  anim: string;
  since: number;
  dir: number | null;
  /** The shield's points last seen (mages), and what its picture plays since when (spec section 4). */
  shield: number;
  shieldAnim: "on" | "hit" | "break" | "back" | null;
  shieldSince: number;
  /** The body's `hit` or `shatter`, played once over idling or attacking (spec section 7). */
  struck: { anim: "hit" | "shatter"; since: number } | null;
}

/** A shield back after it broke fades in over this much game time (spec section 4, tentative). */
const SHIELD_BACK_S = 0.3;

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
  /** The landing dust (spec section 11), one a falling unit, from the world effects atlas. */
  private readonly dustSprites: Sprite[] = [];
  private readonly anims = new Map<number, AnimState>();
  private seen = new Map<number, Seen>();
  private corpses: Corpse[] = [];
  private lastTick = -1;

  /** A unit's depth at a point of the plane (among the buildings' footprints when they are pictures too). */
  private readonly depth: (px: number, py: number) => number;

  constructor(art: UnitArt, view: GameView, shadowLayer: Container, unitLayer: Container, cultureOf: (owner: number) => Culture, projection: Projection = TOP, depth: (px: number, py: number) => number = (_x, y) => y) {
    this.depth = depth;
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
      const s: Slot = { box, color: sprite(), team: sprite(), shield: sprite(), fx: sprite(), shadow: sprite() };
      box.addChild(s.color, s.team, s.shield, s.fx);
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
    const shield = u[o + U.shield];
    let anim = animFor(a, action, action === Action.Gather ? this.workOf(u[o + U.orderTarget]) : null);
    let st = this.anims.get(id);
    if (st === undefined) {
      st = { action, anim, since: seconds, dir: null, shield, shieldAnim: shield > 0 ? "on" : null, shieldSince: seconds, struck: null };
      this.anims.set(id, st);
    } else if (st.action !== action || st.anim !== anim) {
      st.action = action;
      st.anim = anim;
      st.since = seconds;
    }
    const unitInfo = this.view.rules.units[type];
    if ((unitInfo?.shield ?? 0) > 0) this.shieldChanged(a, st, shield, seconds);
    const dir = pictureDirection(u[o + U.facing], st.dir, this.projection.kind);
    st.dir = dir;
    let index: number;
    // Struck while standing or fighting, the body plays its hit or shatter once (walking or calibrating, it carries on).
    const struck = st.struck;
    const struckInfo = struck === null ? undefined : a.anims[struck.anim];
    if (struck !== null && struckInfo !== undefined && (action === Action.Idle || action === Action.Attack) && seconds - struck.since < struckInfo.frames / fpsOf(a, struck.anim)) {
      anim = struck.anim;
      index = frameAt(struckInfo, fpsOf(a, anim), seconds - struck.since);
    } else {
      st.struck = null;
      const info = a.anims[anim];
      const elapsed = seconds - st.since;
      if (anim === "attack") index = attackFrame(info, fpsOf(a, anim), elapsed, (unitInfo?.cooldown ?? 20) / TICKS_PER_SECOND);
      else if (anim === "cast") index = Math.min(u[o + U.castProgress], info.frames - 1);
      else if (anim === "walk") index = frameAt(info, walkFps(a, unitInfo?.speed ?? 0), elapsed, id % info.frames);
      else index = frameAt(info, fpsOf(a, anim), elapsed, info.loop ? id % info.frames : 0);
    }
    this.place(s, a, anim, dir, index, owner, px, py, 1);
    this.drawShield(s, a, st, seconds);
    const f = this.art.frame(a.unit, "color", frameName(a, anim, dir, index).name);
    return f === null ? null : py - f.ay * f.texture.height * this.scale;
  }

  /**
   * A mage's shield by the snapshot's points (spec section 4): on while it holds; less, but some
   * left, its `hit` (struck again while it plays, from its brightest frame); none left, its
   * `break`, then nothing; back from none, faded in. The body plays its own `hit` or `shatter`.
   */
  private shieldChanged(a: AtlasJson, st: AnimState, shield: number, seconds: number): void {
    const was = st.shield;
    st.shield = shield;
    if (shield === was) return;
    const sa = a.shield?.anims;
    if (shield > 0 && was <= 0) {
      st.shieldAnim = "back";
      st.shieldSince = seconds;
    } else if (shield <= 0 && was > 0) {
      st.shieldAnim = "break";
      st.shieldSince = seconds;
      st.struck = { anim: "shatter", since: seconds };
    } else if (shield < was) {
      const playing = st.shieldAnim === "hit" && sa?.hit !== undefined && seconds - st.shieldSince < sa.hit.frames / (sa.hit.fps ?? 20);
      // Again while it plays: from frame 1, the brightest.
      st.shieldAnim = "hit";
      st.shieldSince = playing ? seconds - 1 / (sa?.hit?.fps ?? 20) : seconds;
      st.struck = { anim: "hit", since: seconds };
    }
  }

  private drawShield(s: Slot, a: AtlasJson, st: AnimState, seconds: number): void {
    const sa = a.shield?.anims;
    let name: string | null = null;
    let alpha = 1;
    if (sa !== undefined && st.shieldAnim !== null) {
      const elapsed = seconds - st.shieldSince;
      const once = (anim: "hit" | "break"): number | null => {
        const info = sa[anim];
        if (info === undefined) return null;
        const i = Math.floor(elapsed * (info.fps ?? 20));
        return i < info.frames ? i : null;
      };
      if (st.shieldAnim === "hit" || st.shieldAnim === "break") {
        const i = once(st.shieldAnim);
        if (i !== null) name = `${a.unit}_shield_${st.shieldAnim}_${String(i).padStart(2, "0")}`;
        else st.shieldAnim = st.shieldAnim === "hit" ? "on" : null;
      }
      if (st.shieldAnim === "back" && elapsed >= SHIELD_BACK_S) st.shieldAnim = "on";
      if (name === null && (st.shieldAnim === "on" || st.shieldAnim === "back")) {
        const on = sa.on;
        name = `${a.unit}_shield_on_${String(on === undefined ? 0 : frameAt(on, on.fps ?? 8, elapsed)).padStart(2, "0")}`;
        if (st.shieldAnim === "back") alpha = Math.min(1, elapsed / SHIELD_BACK_S);
      }
    }
    // Its own picture: one direction, never mirrored.
    put(s.shield, name === null ? null : this.art.frame(a.unit, "shield", name), 0, 0, this.scale, false);
    s.shield.alpha = alpha;
  }

  private place(s: Slot, a: AtlasJson, anim: string, dir: number, index: number, owner: number, px: number, py: number, alpha: number): void {
    const { name, mirror } = frameName(a, anim, dir, index);
    s.box.visible = true;
    s.box.position.set(px, py);
    s.box.zIndex = this.depth(px, py);
    s.box.alpha = alpha;
    put(s.color, this.art.frame(a.unit, "color", name), 0, 0, this.scale, mirror);
    put(s.team, this.art.frame(a.unit, "team", name), 0, 0, this.scale, mirror);
    s.team.tint = ownerTint(owner, this.view.me);
    // The effects layer (mages: the circle, the flash, the shards), mirrored as the colour; listed only where there is one.
    put(s.fx, this.art.frame(a.unit, "fx", name), 0, 0, this.scale, mirror);
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

  /**
   * The fallen (spec section 7): their fall played once (a mage's `fall`, then `dead`), the last
   * frame held, then faded; the dust raised where the body lands (its `impact` frame, section 11).
   */
  drawCorpses(seconds: number): void {
    this.corpses = this.corpses.filter((c) => {
      const a = this.art.atlases.get(c.atlas);
      return a !== undefined && a.anims[c.anim] !== undefined && seconds - c.since < fallSeconds(a, c.anim) + CORPSE_HOLD_S + CORPSE_FADE_S;
    });
    let dust = 0;
    this.corpses.forEach((c, i) => {
      const a = this.art.atlases.get(c.atlas) as AtlasJson;
      const info = a.anims[c.anim];
      const fps = fpsOf(a, c.anim);
      const elapsed = seconds - c.since;
      const fade = elapsed - fallSeconds(a, c.anim) - CORPSE_HOLD_S;
      // After a mage's fall, its `dead` (spec section 7).
      const then = c.anim === "fall" ? a.anims.dead : undefined;
      const fell = info.frames / fps;
      const [anim, index] = then !== undefined && elapsed >= fell ? ["dead", frameAt(then, fpsOf(a, "dead"), elapsed - fell)] : [c.anim, frameAt(info, fps, elapsed)];
      const at = this.projection.toPlane(c.x, c.y);
      this.place(this.slot(this.corpseSlots, i), a, anim, c.dir, index, c.owner, at.x, at.y, fade > 0 ? Math.max(0, 1 - fade / CORPSE_FADE_S) : 1);
      this.corpseSlots[i].shield.visible = false;
      if (info.impact !== undefined && this.dustAt(dust, elapsed - info.impact / fps, info.impact_scale ?? 1, at.x, at.y)) dust++;
    });
    for (let i = this.corpses.length; i < this.corpseSlots.length; i++) this.hide(this.corpseSlots[i]);
    for (let i = dust; i < this.dustSprites.length; i++) this.dustSprites[i].visible = false;
  }

  /** Dust sprite `i`, `elapsed` seconds into its puff at (x, y) on the plane; false when it is not playing. */
  private dustAt(i: number, elapsed: number, scale: number, x: number, y: number): boolean {
    const fx = this.art.effects;
    const info = fx?.effects.dust;
    if (fx === null || info === undefined || elapsed < 0) return false;
    const index = Math.floor(elapsed * (info.fps ?? 12));
    if (index >= info.frames) return false;
    while (this.dustSprites.length <= i) {
      const d = sprite();
      this.unitLayer.addChild(d);
      this.dustSprites.push(d);
    }
    const d = this.dustSprites[i];
    put(d, this.art.effectFrame(`dust_${String(index).padStart(2, "0")}`), x, y, (this.projection.ptPerM / fx.px_per_m) * scale, false);
    // Over the body it rises from, under who stands in front (spec section 11).
    d.zIndex = this.depth(x, y) + 0.005;
    return d.visible;
  }

  destroy(): void {
    for (const s of [...this.slots, ...this.corpseSlots]) {
      s.box.destroy({ children: true });
      s.shadow.destroy();
    }
    for (const d of this.dustSprites) d.destroy();
    this.slots.length = 0;
    this.corpseSlots.length = 0;
    this.dustSprites.length = 0;
  }
}

/** A fall's length in seconds: its frames, and a mage's `dead` after its `fall`. */
function fallSeconds(a: AtlasJson, anim: string): number {
  const info = a.anims[anim];
  const then = anim === "fall" ? a.anims.dead : undefined;
  return info.frames / fpsOf(a, anim) + (then === undefined ? 0 : then.frames / fpsOf(a, "dead"));
}
