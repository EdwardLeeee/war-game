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

export type CastleLayoutName = "small" | "large" | "large3";

/** One picture of the walls: its piece, its cells, its anchor (cells, the footprint's middle) and front edge, from the town's centre cell. */
export interface CastlePiece {
  piece: string;
  anchor: [number, number];
  front: number;
  cells: [number, number][];
}

export interface CastleLayout {
  walls: CastlePiece[];
  /** A tile a cell inside the walls, and two street cells before each gate. */
  floor: { cell: [number, number]; tile: string }[];
}

/**
 * A piece's pictures and, from art-v5.2 (D-096, atlas-buildings.md section 11), where someone stands on
 * it: a plain stretch's `walk_m` (its walk above the ground) and `stand_in_m` (from the cell's
 * middle towards the town, negative outwards); a gate's `shoot_at_m` (the arrows' two starting
 * points, from its anchor: x east, y south, z up). `intact_front`: the part in front of those on the
 * wall (colour only); a gate's `closed`, `damaged`, `broken` (`intact` is open).
 */
export interface CastlePieceInfo {
  footprint: [number, number];
  frames: { intact: string; ruin: string; intact_front?: string; closed?: string; damaged?: string; broken?: string };
  walk_m?: number;
  stand_in_m?: number;
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
  tiles: Record<string, string>;
  layouts: Partial<Record<CastleLayoutName, CastleLayout>>;
  frames: Record<string, FrameRect>;
  team: Record<string, FrameRect>;
  shadows: Record<string, FrameRect>;
}

export function parseCastle(v: unknown): CastleJson {
  const c = v as CastleJson;
  if (typeof c !== "object" || c === null || c.format !== CASTLE_FORMAT) throw new Error(`not a ${CASTLE_FORMAT} description`);
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
