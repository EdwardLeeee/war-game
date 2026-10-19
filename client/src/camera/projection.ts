// How the ground is laid on the screen (docs/sprite-atlas.md section 1, ceo 2026-09-30; D-085:
// with the atlases, the map turns to the diamond now). World coordinates stay what the
// simulation's are, TILE_PX a cell; the plane is the screen's at zoom 1, in points. Seen from
// above it is the world itself. As a diamond the grid is turned 45° and flattened 2:1 (the
// camera 30° above the ground): a cell 40 points along its sides (20 a metre, 2 metres a
// cell), so a cell's step is 28.28 across and 14.14 down; the map's (0, 0) at the top corner,
// +x down-right and +y down-left, the two spawns left and right. Seen square on (方形斜看,
// D-088, the user's choice): the same camera, not turned, so the grid stays square to the screen
// and only flattened 2:1: a cell 40 across and 20 down, +x right and +y down (nearer the
// camera), the spawns bottom left and top right. Pure arithmetic, no PixiJS.

import { TILE_PX } from "../tuning.ts";
import type { Point } from "./camera.ts";

/** Points a cell along its sides on the plane, as a diamond: 20 a metre (PT_PER_M), 2 metres a cell. */
export const PT_PER_CELL = 40;
/** Points a metre on the plane (the atlases are drawn at PT_PER_M / px_per_m). */
export const PT_PER_M = 20;

export interface Projection {
  readonly kind: "top" | "diamond" | "oblique";
  /** World (px) → the plane (pt at zoom 1). */
  toPlane(wx: number, wy: number): Point;
  /** The plane → world. */
  toWorld(px: number, py: number): Point;
  /** The same as a matrix, for the ground's layers: x' = a·x + c·y, y' = b·x + d·y. */
  readonly matrix: { a: number; b: number; c: number; d: number };
  /** Plane points a metre on the ground (the units' pictures' scale). */
  readonly ptPerM: number;
}

export const TOP: Projection = {
  kind: "top",
  toPlane: (wx, wy) => ({ x: wx, y: wy }),
  toWorld: (px, py) => ({ x: px, y: py }),
  matrix: { a: 1, b: 0, c: 0, d: 1 },
  ptPerM: TILE_PX / 2,
};

const A = PT_PER_CELL / TILE_PX / Math.SQRT2;

export const DIAMOND: Projection = {
  kind: "diamond",
  toPlane: (wx, wy) => ({ x: (wx - wy) * A, y: ((wx + wy) * A) / 2 }),
  toWorld: (px, py) => ({ x: (px / A + (2 * py) / A) / 2, y: ((2 * py) / A - px / A) / 2 }),
  matrix: { a: A, b: A / 2, c: -A, d: A / 2 },
  ptPerM: PT_PER_M,
};

const S = PT_PER_CELL / TILE_PX;

/** 方形斜看 (D-088; docs/sprite-atlas.md section 1): x' = 1.25 x, y' = 0.625 y (a cell 40 × 20 points). */
export const OBLIQUE: Projection = {
  kind: "oblique",
  toPlane: (wx, wy) => ({ x: wx * S, y: (wy * S) / 2 }),
  toWorld: (px, py) => ({ x: px / S, y: (2 * py) / S }),
  matrix: { a: S, b: 0, c: 0, d: S / 2 },
  ptPerM: PT_PER_M,
};

/** Seen from 30° above (diamond or square on): pictures stand up, the ground lies flattened. */
export const tilted = (p: Projection): boolean => p.kind !== "top";

/** The projection by name, for the test page's ?view= (D-088). */
export const PROJECTIONS: Record<Projection["kind"], Projection> = { top: TOP, diamond: DIAMOND, oblique: OBLIQUE };
