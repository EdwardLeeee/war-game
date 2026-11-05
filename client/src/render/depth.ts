// 前後 (方形斜看, D-088; war-game-ui's order for art-v3, design/b1/atlas-buildings.md section 6):
// what stands up is drawn by its front edge's y, the nearer the later; a building's front edge is
// cellY + its size, a node's cellY + 1, a unit's its own y; level, the smaller x first, then the id.
// As a diamond (art-v7, D-117) the nearer is the larger x + y: buildings and units by their own
// points, the cliffs' and the castles' pieces by their anchors (pieceDepth).
// A tap takes, from the last drawn back, the first whose picture (or footprint) holds the finger:
// the same order, so what hides something is what the tap reaches. Pure, for the unit tests.

import type { Projection } from "../camera/projection.ts";
import { TILE_PX } from "../tuning.ts";

/** Something standing up, in cells: where its front edge is, its x, its id, and its picture's box on the plane. */
export interface Standing {
  id: number;
  front: number;
  x: number;
  box: { x0: number; y0: number; x1: number; y1: number };
}

/** A building's front edge (cells): its far side towards the camera. */
export const buildingFront = (cellY: number, size: number): number => cellY + size;
/** A node's: the edge of its cell. */
export const nodeFront = (cellY: number): number => cellY + 1;

/** Drawing order: by the front edge, then x, then id (negative: a before b). */
export function drawOrder(a: Standing, b: Standing): number {
  return a.front - b.front || a.x - b.x || a.id - b.id;
}

/**
 * A depth for PixiJS's zIndex on the plane (`py` the plane's y of the front edge, `x` in cells):
 * the order above, as one number (x and the id only break ties).
 */
export function depthOf(py: number, x: number, id: number): number {
  return py + x * 1e-4 + (id % 1000) * 1e-8;
}

/** What a tap at (px, py) on the plane reaches: from the last drawn back, the first holding it. */
export function tapped(items: readonly Standing[], px: number, py: number): Standing | null {
  const sorted = [...items].sort(drawOrder);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const b = sorted[i].box;
    if (px >= b.x0 && px <= b.x1 && py >= b.y0 && py <= b.y1) return sorted[i];
  }
  return null;
}

/** Cells a cliff's post is taken nearer as a diamond (along x and y each): over the ends of the arms it joins (ui, art-v7 cliffs). */
export const POST_LIFT = 0.3;

/**
 * A piece standing up (a cliff's, a castle's wall or decor) as PixiJS's zIndex. Square on (D-088,
 * and seen from above) by its `front` edge (cells), then `x`, then the id (depthOf). As a diamond,
 * as the buildings and the units are: its anchor's (cells) y on the plane, x + y (by its front
 * edge only, the further east a cliff or a wall the earlier it was drawn: those behind it in front
 * of it); `lift` cells nearer along x and y each (a cliff's post, POST_LIFT).
 */
export function pieceDepth(projection: Projection, anchorX: number, anchorY: number, front: number, x: number, id: number, lift = 0): number {
  if (projection.kind !== "diamond") return depthOf(projection.toPlane(0, front * TILE_PX).y, x, id);
  return projection.toPlane((anchorX + lift) * TILE_PX, (anchorY + lift) * TILE_PX).y + (id % 1000) * 1e-8;
}
