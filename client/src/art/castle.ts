// 城牆 (D-089, the user 2026-10-19: 「希望像一個城堡」; design/b1/atlas-buildings.md section 11):
// war-game-ui's description of the walls' pictures (castle_<c>.json, art-v4) and where a town's
// pieces go. The walls a player's soldiers walk round are the simulation's (rules.towns[size].castle,
// PROTOCOL.md 3.5); the pictures are laid on exactly those cells: each of ui's layouts is matched
// to the town's castle and shifted onto it (the big city's castle is centred on its tower, which a
// random map may turn or flip). A layout that matches none is not drawn from the pictures: the
// renderer then draws the castle's own cells as plain blocks, so no wall is ever invisible.
// Pure, for the unit tests; render/castle-draw.ts draws.

import type { FrameRect } from "./spec.ts";
import type { AtlasView, Side } from "./structures.ts";

export const CASTLE_FORMAT = "war-game castle 1";
/**
 * art-v6 (D-100; atlas-buildings.md section 13): the castles of D-100 only (`small`, `large`), no
 * floor tiles (the ground's shader draws the ground inside), and what lives in a town: `decor`
 * (R8-36 B, the user 2026-10-23) and each layout's `ground` and `decor`.
 */
export const CASTLE_FORMAT_2 = "war-game castle 2";

export type CastleLayoutName = "small" | "large" | "large3";

/** One picture of the walls: its piece, its cells, its anchor (cells, the footprint's middle) and front edge, from the town's centre cell. */
export interface CastlePiece {
  piece: string;
  anchor: [number, number];
  front: number;
  cells: [number, number][];
}

/** A town's ground (castle 2): the lane from each gate to the keep (fading out past the gate), or trampled earth; `w` its strength 0–1. */
export interface CastleGround {
  cell: [number, number];
  kind: "lane" | "trampled";
  w: number;
}

/**
 * A piece of what lives in a town (castle 2: a hut, a shed, a stack, a well, a cart): `at` its
 * anchor (cells from the centre cell's north-west corner, as a wall's `anchor`), `front` its front
 * edge (depth), `cells` it covers. A picture only: not in the simulation, never in the way, never tapped.
 */
export interface CastleDecor {
  piece: string;
  at: [number, number];
  front: number;
  cells: [number, number][];
}

export interface CastleLayout {
  walls: CastlePiece[];
  /** Castle 1: a tile a cell inside the walls, and two street cells before each gate. */
  floor?: { cell: [number, number]; tile: string }[];
  /** Castle 2. */
  ground?: CastleGround[];
  decor?: CastleDecor[];
}

/**
 * A piece's pictures and, from art-v5.2 (D-096, atlas-buildings.md section 11), where someone stands on
 * it: a plain stretch's `walk_m` (its walk above the ground) and `stand_in_m` (from the cell's
 * middle towards the town, negative outwards); a corner's or a gate's `stand_m`, a point a cell
 * ("dx,dy" from its north-west cell: x east, y south, z up, metres from its anchor); a gate's
 * `shoot_at_m` (the arrows' two starting points, the same way). `intact_front`, `ruin_front`: the
 * part in front of those on it (colour only); a gate's `closed`, `damaged`, `broken` (`intact` is open).
 */
export interface CastlePieceInfo {
  footprint: [number, number];
  frames: { intact: string; ruin: string; intact_front?: string; ruin_front?: string; closed?: string; damaged?: string; broken?: string };
  walk_m?: number;
  stand_in_m?: number;
  stand_m?: Record<string, [number, number, number]>;
  shoot_at_m?: [number, number, number][];
}

export interface CastleJson {
  format: string;
  culture: Side;
  view?: AtlasView;
  px_per_m: number;
  pages: { color: string[]; team: string[]; shadow: string[] };
  /** Metres a cell (2). */
  cell_m?: number;
  pieces: Record<string, CastlePieceInfo>;
  /** Castle 1: the floor's tiles. */
  tiles?: Record<string, string>;
  /** Castle 2: each decor piece's frame (its colour, team for a hut's flag, shadow). */
  decor?: Record<string, string>;
  layouts: Partial<Record<CastleLayoutName, CastleLayout>>;
  frames: Record<string, FrameRect>;
  team: Record<string, FrameRect>;
  shadows: Record<string, FrameRect>;
}

export function parseCastle(v: unknown): CastleJson {
  const c = v as CastleJson;
  if (typeof c !== "object" || c === null || (c.format !== CASTLE_FORMAT && c.format !== CASTLE_FORMAT_2)) throw new Error(`not a ${CASTLE_FORMAT} or ${CASTLE_FORMAT_2} description`);
  if (!(c.px_per_m > 0) || typeof c.pieces !== "object" || typeof c.layouts !== "object" || typeof c.frames !== "object") throw new Error("incomplete castle description");
  return c;
}

/** What a castle needs of the simulation's (TownCastle): its walls and gates, offsets from the centre cell. */
export interface CastleCells {
  wall: readonly (readonly [number, number])[];
  gate: readonly (readonly [number, number])[];
}

/** A layout laid on a town: which, and how far its offsets move (cells). */
export interface CastleFit {
  name: CastleLayoutName;
  layout: CastleLayout;
  dx: number;
  dy: number;
}

const key = (x: number, y: number) => `${x},${y}`;

/**
 * The layout whose pieces cover exactly this castle's walls and gates (a gate's picture holds
 * its piers, which are wall), and how far it moves onto them; null when none does. Small towns
 * try `small`, big cities `large` then `large3` (the 3 × 3 tower of neighbouring spawns).
 */
export function fitLayout(c: Pick<CastleJson, "layouts">, castle: CastleCells, large: boolean): CastleFit | null {
  const want = new Set([...castle.wall, ...castle.gate].map(([x, y]) => key(x, y)));
  if (want.size === 0) return null;
  const minX = Math.min(...[...castle.wall, ...castle.gate].map(([x]) => x));
  const minY = Math.min(...[...castle.wall, ...castle.gate].map(([, y]) => y));
  for (const name of large ? (["large", "large3"] as const) : (["small"] as const)) {
    const layout = c.layouts[name];
    if (layout === undefined) continue;
    const cells = layout.walls.flatMap((p) => p.cells);
    const lx = Math.min(...cells.map(([x]) => x));
    const ly = Math.min(...cells.map(([, y]) => y));
    const dx = minX - lx;
    const dy = minY - ly;
    const got = new Set(cells.map(([x, y]) => key(x + dx, y + dy)));
    if (got.size === want.size && cells.length === got.size && [...got].every((k) => want.has(k))) return { name, layout, dx, dy };
  }
  return null;
}

/** A town's look (D-089, atlas-buildings.md section 11): standing, or burnt (ruins: no player colour). */
export type CastleState = "intact" | "ruin";

/** A gate's look (D-096): open (intact), closed, damaged, broken (gone), or its town's ruins. */
export type GateLook = "intact" | "closed" | "damaged" | "broken" | "ruin";

/**
 * Which look a gate takes (D-096; war-game-ui's suggestion, 2026-10-22): its town in ruins, ruin;
 * the gate gone, broken; at half its hit points or less, damaged; its holder's soldiers by it, open;
 * else closed. Gates off (the rules have none): open, as before D-096.
 */
export function gateLook(o: { gates: boolean; ruins: boolean; standing: boolean; hp: number; max: number; holderNear: boolean }): GateLook {
  if (o.ruins) return "ruin";
  if (!o.gates) return "intact";
  if (!o.standing) return "broken";
  if (o.max > 0 && o.hp * 2 <= o.max) return "damaged";
  return o.holderNear ? "intact" : "closed";
}

/** Within this many cells of a gate's opening (Chebyshev), its holder's soldiers have it open. */
export const GATE_OPEN_CELLS = 2;

/** The way into the town from a plain stretch of wall (its name's side: `pal_n` the north wall, the town to its south), in cells; null for others. */
export function inward(piece: string): [number, number] | null {
  const side = /_([nswe])$/.exec(piece)?.[1];
  return side === "n" ? [0, 1] : side === "s" ? [0, -1] : side === "w" ? [1, 0] : side === "e" ? [-1, 0] : null;
}

/** A building's cells on the map (its footprint). */
export interface Footprint {
  x: number;
  y: number;
  w: number;
  h: number;
}

const touches = (cells: readonly (readonly [number, number])[], ox: number, oy: number, f: readonly Footprint[]): boolean =>
  cells.some(([x, y]) => f.some((b) => ox + x >= b.x && ox + x < b.x + b.w && oy + y >= b.y && oy + y < b.y + b.h));

/**
 * Whether a town's decor piece is left out (R8-36 B): the town in ruins (the plan ceo approved), or
 * a building (finished or not) on any of its cells, offset `ox`, `oy` (the town's centre cell and
 * the layout's shift); the ground there is trampled earth then (`townGround`).
 */
export function decorHidden(d: Pick<CastleDecor, "cells">, ox: number, oy: number, buildings: readonly Footprint[], ruins: boolean): boolean {
  return ruins || touches(d.cells, ox, oy, buildings);
}

/**
 * The towns' ground for the shader (castle 2, R8-36 B), `n` × `n` cells, a strength 0–1 a cell: the
 * lanes, and the trampled earth: each layout's `ground`, and every cell of a building inside a
 * castle (the box of its walls) and of a decor piece left out for one, at 1 (ui: 「建築占地要加進
 * trampled w1」). `towns`: each town's centre cell, its layout's shift and its box (map cells).
 */
export function townGround(n: number, towns: readonly { cx: number; cy: number; fit: CastleFit; box: { x0: number; y0: number; x1: number; y1: number } }[], buildings: readonly Footprint[]): { lane: Float32Array; trampled: Float32Array } {
  const lane = new Float32Array(n * n);
  const trampled = new Float32Array(n * n);
  const put = (a: Float32Array, x: number, y: number, w: number) => {
    if (x >= 0 && y >= 0 && x < n && y < n) a[y * n + x] = Math.max(a[y * n + x], w);
  };
  for (const t of towns) {
    const ox = t.cx + t.fit.dx;
    const oy = t.cy + t.fit.dy;
    for (const g of t.fit.layout.ground ?? []) put(g.kind === "lane" ? lane : trampled, ox + g.cell[0], oy + g.cell[1], g.w);
    for (const d of t.fit.layout.decor ?? []) if (touches(d.cells, ox, oy, buildings)) for (const [x, y] of d.cells) put(trampled, ox + x, oy + y, 1);
    for (const b of buildings) {
      for (let y = Math.max(b.y, t.box.y0); y < Math.min(b.y + b.h, t.box.y1 + 1); y++) {
        for (let x = Math.max(b.x, t.box.x0); x < Math.min(b.x + b.w, t.box.x1 + 1); x++) put(trampled, x, y, 1);
      }
    }
  }
  return { lane, trampled };
}
