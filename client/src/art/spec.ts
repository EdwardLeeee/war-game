// 兵種精靈圖集 (D-085, docs/sprite-atlas.md version 2): the description files war-game-ui's
// atlases come with, and what the screen works out from them before drawing: which atlas a unit
// wears, which of the pictures' 8 directions a sim facing shows, which animation and which of
// its frames. Pure, for the unit tests; render/unit-art.ts loads the pages and draws.

import { Action, CELL, NEUTRAL, NO_OWNER, NodeKind, TICKS_PER_SECOND, UnitType } from "../sim.ts";

export const ATLAS_FORMAT = "war-game atlas 2";
export const EFFECTS_FORMAT = "war-game effects 1";

/** 1 cell = 2 metres (spec section 1, ceo 2026-09-30; tentative). */
export const M_PER_CELL = 2;

/** One frame's box on its page and its anchor in it (image points). */
export interface FrameRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** Shadows: drawn at twice the size. */
  half_res?: boolean;
}

export interface AnimInfo {
  frames: number;
  fps?: number;
  loop: boolean;
  placeholder?: boolean;
  /** The frame that strikes (attack) or that the tool lands (work). */
  hit?: number;
  /** The frame the body lands (death, fall): the dust is played there. */
  impact?: number;
  /** The dust that many times as large (big units: spec section 11). */
  impact_scale?: number;
  /** Effects seen from above (the cannon's warning): the radius in metres of the circle drawn. */
  top_down?: boolean;
  radius_m?: number;
  /** Metres one walk cycle covers. */
  stride_m?: number;
  /**
   * The militia's `sling` (D-096, art-v5.2): where the stone leaves the hand at its `hit` frame,
   * metres from the feet: right, forward, up as the picture faces (a mirrored picture's right is its left).
   */
  stone_from_m?: [number, number, number];
  /**
   * 真的箭 (R8-35 B, art-v6 effects `arrow` and `sling_stone`): metres a second it flies, the most
   * seconds it may take, its arc's top above the straight line per metre between (arc_k), its
   * length (the arrow, drawn pointing right), and where a bowman's leaves (by atlas: right,
   * forward, up from the feet as the picture faces; a mirrored picture's right is its left).
   */
  speed_mps?: number;
  max_s?: number;
  arc_k?: number;
  len_m?: number;
  from_m?: Record<string, [number, number, number]>;
  /** art-v6 `siege_stone`: its arc's top over the line, arc_m + arc_k × metres; how far out one from an unseen engine starts. */
  arc_m?: number;
  from_far_m?: number;
  /** art-v6 `siege_crater`: seconds it lies on the ground, fading. */
  crater_s?: number;
}

export interface AtlasJson {
  format: string;
  unit: string;
  scale: number;
  px_per_m: number;
  facings: { rendered: number[]; mirrored: Record<string, number> };
  anims: Record<string, AnimInfo>;
  pages: { color: string[]; team: string[]; shadow: string[]; fx: string[]; shield: string[] };
  frames: Record<string, FrameRect>;
  team: Record<string, FrameRect>;
  shadows: Record<string, FrameRect>;
  fx: Record<string, FrameRect>;
  shield?: { anims: Record<string, AnimInfo>; frames: Record<string, FrameRect> };
}

export interface EffectsJson {
  format: string;
  px_per_m: number;
  pages: string[];
  effects: Record<string, AnimInfo>;
  frames: Record<string, FrameRect>;
}

/** A unit's description file, checked; only `war-game atlas 2` (version 1 draws the shield twice). */
export function parseAtlas(v: unknown): AtlasJson {
  const a = v as AtlasJson;
  if (typeof a !== "object" || a === null || a.format !== ATLAS_FORMAT) throw new Error(`not a ${ATLAS_FORMAT} description (${String((a as { format?: unknown } | null)?.format)})`);
  if (typeof a.unit !== "string" || !(a.px_per_m > 0) || typeof a.frames !== "object" || typeof a.anims !== "object") throw new Error(`${String(a.unit)}: incomplete description`);
  return a;
}

export function parseEffects(v: unknown): EffectsJson {
  const e = v as EffectsJson;
  if (typeof e !== "object" || e === null || e.format !== EFFECTS_FORMAT) throw new Error(`not a ${EFFECTS_FORMAT} description`);
  return e;
}

/** 東陸 or 西陸 (D-021). Which side wears which is the user's to choose (A, B, C). */
export type Culture = "e" | "w";

/**
 * Who wears which (the user 2026-10-19 chooses 你的陸 on the start screen; the computer wears
 * the other). The neutral militia wear the player's (B1: the spearman of the same culture, in
 * neutral grey).
 */
export function cultureOf(mine: Culture, owner: number, me: number): Culture {
  return owner === me || owner === NEUTRAL || owner === NO_OWNER ? mine : mine === "e" ? "w" : "e";
}

/**
 * The atlas each unit type wears, by culture. The militia: the spearman, in neutral grey (B1). Siege
 * engines (D-099): East's 霹靂車, West's 投石機. East's ranged: the bowman (art-v6, R8: 「弓手（新，拿弓）」;
 * the crossbowman `xbow_e` before).
 */
export const UNIT_ATLAS: Record<number, Record<Culture, string>> = {
  [UnitType.Farmer]: { e: "farmer_e", w: "farmer_w" },
  [UnitType.Spearman]: { e: "spear_e", w: "pike_w" },
  [UnitType.Ranged]: { e: "bow_e", w: "bow_w" },
  [UnitType.Mage]: { e: "mage_e", w: "mage_w" },
  [UnitType.Militia]: { e: "spear_e", w: "pike_w" },
  [UnitType.Cavalry]: { e: "hcav_e", w: "knight_w" },
  [UnitType.Siege]: { e: "siege_e", w: "siege_w" },
};

/**
 * Every atlas loaded when a game starts, both cultures; not the siege engines' (D-099), loaded once
 * a game has them (features.siege: SIEGE_ATLASES), so that a game without them costs no more memory.
 */
export const ATLAS_NAMES = [...new Set(Object.entries(UNIT_ATLAS).flatMap(([t, c]) => (Number(t) === UnitType.Siege ? [] : [c.e, c.w])))].sort();
export const SIEGE_ATLASES = [UNIT_ATLAS[UnitType.Siege].e, UNIT_ATLAS[UnitType.Siege].w];

/** How the ground is drawn: seen from straight above (the prototype so far) or as a diamond (spec section 1). */
export type Projection = "top" | "diamond" | "oblique";

/**
 * The pictures' direction (0 right, then counter-clockwise on screen, 6 facing the camera) for a
 * sim facing (0–15, 22.5° each, 0 = +x, clockwise with y down), spec section 3. Seen from
 * above or square on (方形斜看, D-088), +x is right (direction 0); as a diamond, +x is
 * down-right (direction 7). An odd facing
 * falls between two directions: the unit keeps the one it showed if it is one of them, else
 * the one nearer to facing the camera (6).
 */
export function pictureDirection(facing: number, prev: number | null, projection: Projection): number {
  const k = ((facing % 16) + 16) % 16;
  const base = projection === "diamond" ? 7 : 8;
  const dir = (half: number) => (((base - half) % 8) + 8) % 8;
  if (k % 2 === 0) return dir(k / 2);
  const a = dir((k - 1) / 2);
  const b = dir((k + 1) / 2);
  if (prev === a || prev === b) return prev;
  const toward6 = (d: number) => Math.min((d - 6 + 8) % 8, (6 - d + 8) % 8);
  return toward6(a) <= toward6(b) ? a : b;
}

/** A frame's name in the atlas, and whether it is drawn mirrored (directions 3, 4, 5: spec section 3). Shadows: all 8, never mirrored. */
export function frameName(a: AtlasJson, anim: string, direction: number, index: number, layer: "color" | "shadow" = "color"): { name: string; mirror: boolean } {
  const ii = String(index).padStart(2, "0");
  if (layer === "shadow") return { name: `${a.unit}_${anim}_f${direction}_${ii}`, mirror: false };
  const from = a.facings.mirrored[String(direction)];
  return from === undefined ? { name: `${a.unit}_${anim}_f${direction}_${ii}`, mirror: false } : { name: `${a.unit}_${anim}_f${from}_${ii}`, mirror: true };
}

/** The ground's way a picture direction faces (x east, y south), the inverse of pictureDirection. */
export function directionVector(direction: number, projection: Projection): [number, number] {
  const s = Math.SQRT1_2;
  const WAYS: [number, number][] = [[1, 0], [s, s], [0, 1], [-s, s], [-1, 0], [-s, -s], [0, -1], [s, -s]];
  const base = projection === "diamond" ? 7 : 8;
  return WAYS[(((base - direction) % 8) + 8) % 8];
}

/**
 * Where a sling's stone leaves the hand (D-096; anims.sling.stone_from_m: right, forward, up), from
 * the feet in metres on the ground (x east, y south) and up, for the picture's direction; a mirrored
 * picture's right is the other way.
 */
export function stoneFrom(direction: number, mirror: boolean, m: readonly [number, number, number], projection: Projection): { x: number; y: number; up: number } {
  const [fx, fy] = directionVector(direction, projection);
  const right = mirror ? -m[0] : m[0];
  // Right of the way it faces, y down: (−fy, fx).
  return { x: right * -fy + m[1] * fx, y: right * fx + m[1] * fy, up: m[2] };
}

/** Default frames a second (spec section 7) for actions whose description gives none. */
const DEFAULT_FPS: Record<string, number> = { idle: 8, walk: 12, attack: 20, cast: 20, death: 12, fall: 12, dead: 12, hit: 20, shatter: 16 };
export const fpsOf = (a: AtlasJson, anim: string): number => a.anims[anim]?.fps ?? DEFAULT_FPS[anim] ?? 10;

/** What a node or building a farmer works at is, for its work animation. */
export type WorkKind = "chop" | "mine" | "farm" | null;
export const workOfNode = (kind: number): WorkKind => (kind === NodeKind.Tree ? "chop" : kind === NodeKind.GoldMine || kind === NodeKind.CrystalVein ? "mine" : kind === NodeKind.Berries ? "farm" : null);

/**
 * The animation for a unit's action (spec section 7). `work`: what a gathering farmer works at
 * (a farm counts as farm). Falls back to idle when the atlas has no such animation.
 */
export function animFor(a: AtlasJson, action: number, work: WorkKind, onWall = false): string {
  const pick = (name: string) => (a.anims[name] !== undefined ? name : "idle");
  switch (action) {
    case Action.Move:
      return pick("walk");
    case Action.Attack:
      // On a wall (D-096: only the militia have it), throwing stones.
      return onWall && a.anims.sling !== undefined ? "sling" : pick("attack");
    case Action.Gather:
      return pick(work === null ? "work_chop" : `work_${work}`);
    case Action.Build:
    case Action.Repair:
      return pick("work_build");
    case Action.Calibrate:
      return pick("cast");
    default:
      return "idle";
  }
}

/** Sim time in seconds (the animations' clock, spec section 7): pausing and the speed apply by themselves. */
export const simSeconds = (tick: number): number => tick / TICKS_PER_SECOND;

/** A walk's frames a second for a unit moving `speed` (fixed point a tick): its stride when given, else 12 at 1 cell a second. */
export function walkFps(a: AtlasJson, speed: number): number {
  const cellsPerSecond = (speed / CELL) * TICKS_PER_SECOND;
  const walk = a.anims.walk;
  if (walk?.stride_m !== undefined && walk.stride_m > 0) return (walk.frames * cellsPerSecond * M_PER_CELL) / walk.stride_m;
  return fpsOf(a, "walk") * cellsPerSecond;
}

/**
 * The frame of an animation `elapsed` seconds after it began. Looping: round and round, from
 * `start` (a unit's id staggers a crowd's breathing). Once: up to its last frame, held.
 */
export function frameAt(info: AnimInfo, fps: number, elapsed: number, start = 0): number {
  const n = Math.max(1, info.frames);
  const i = Math.floor(Math.max(0, elapsed) * fps);
  return info.loop ? (start + i) % n : Math.min(i, n - 1);
}

/**
 * An attack swing (spec section 7, without the simulation's cooldown left): from the moment the
 * unit attacks, a swing every `cooldown` ticks; between swings, the first frame.
 */
export function attackFrame(info: AnimInfo, fps: number, elapsed: number, cooldownSeconds: number): number {
  if (cooldownSeconds <= 0) return frameAt(info, fps, elapsed);
  const into = elapsed % cooldownSeconds;
  return Math.min(Math.floor(into * fps), Math.max(1, info.frames) - 1);
}

/** Seconds a fallen unit lies (its last frame held), then fades (spec section 7). */
export const CORPSE_HOLD_S = 3;
export const CORPSE_FADE_S = 0.5;
