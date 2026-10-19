// The castles round the towns (D-089, the user 2026-10-19: 「希望像一個城堡」; ceo: walls only stop
// walking, never shooting or sight; they cannot be destroyed; the town is what lies inside them).
// A wall is terrain, like rock (Terrain.Wall): not a building, so nothing attacks it (D-024 looks for
// buildings) and ruins keep it. Gates are open ground, open to everyone, always.
//
// The layouts (castle-layout.ts) are offsets from a town's centre cell. A small town's centre is a
// cell, and its castle is its own image under every turn and flip. The big city's castle is centred
// on its tower: on random maps the map is turned or flipped as a whole (D-074), so the tower does not
// stand at the same offset from the town's centre cell on every map; castleOf shifts the layout to
// where this map's tower stands, and the castle stays its own mirror image.

import { TownSize } from "../protocol.ts";
import { CASTLE_LARGE, CASTLE_LARGE3, CASTLE_SMALL, type CastleLayout } from "./castle-layout.ts";

type Cell = readonly [number, number];

/**
 * Militia posts on the fixed map (from scenarios.ts): a set closed under x <-> y, so towns on the
 * axis stay symmetric (random maps: GameMap.posts). Inside every castle's walls.
 */
export const FIXED_POSTS: readonly Cell[] = [
  [2, 0], [0, 2], [-2, 0], [0, -2], [2, 2], [-2, -2],
  [2, -2], [-2, 2], [3, 0], [0, 3], [-3, 0], [0, -3],
];

/** A town's castle on one map: castle-layout.ts shifted to the tower, and the cell before each gate. */
export interface Castle {
  inside: { x0: number; y0: number; x1: number; y1: number };
  wall: Cell[];
  corner: Cell[];
  gate: Cell[];
  /** For each gate cell (same order), the open cell in front of it, outside the walls. */
  outside: Cell[];
  /** For each gate cell (same order), the first cell behind it, inside the walls. */
  behind: Cell[];
  garrison: Cell[];
}

/** What castleOf needs of a map: the big city's tower (top-left, side) and the towns' centres. */
export interface CastleMap {
  tower: { cellX: number; cellY: number };
  towerSize?: number;
  towns: { size: TownSize; cellX: number; cellY: number }[];
  /** Random maps' militia posts (GameMap.posts). */
  posts?: readonly Cell[];
}

/** The castle of a town of this size on this map (offsets from that town's centre cell). */
export function castleOf(size: TownSize, map?: CastleMap): Castle {
  if (size === TownSize.Small) return place(CASTLE_SMALL, 0, 0);
  const ts = map?.towerSize ?? 2;
  const layout = ts === 3 ? CASTLE_LARGE3 : CASTLE_LARGE;
  // The layouts put the tower's top-left at (-1, -1) from the centre cell.
  const town = map?.towns.find((t) => t.size === TownSize.Large);
  if (map === undefined || town === undefined) return place(layout, 0, 0);
  return place(layout, map.tower.cellX - town.cellX + 1, map.tower.cellY - town.cellY + 1);
}

function place(l: CastleLayout, sx: number, sy: number): Castle {
  const move = (c: Cell): Cell => [c[0] + sx, c[1] + sy];
  const wall = l.wall.map(move);
  const gate = l.gate.map(move);
  const inside = { x0: l.inside.x0 + sx, y0: l.inside.y0 + sy, x1: l.inside.x1 + sx, y1: l.inside.y1 + sy };
  // The ring of walls is one cell outside the inside box; a gate's outward neighbour leaves the
  // ring, its inward one is inside.
  const out = ([x, y]: Cell): Cell => {
    if (x === inside.x0 - 1) return [-1, 0];
    if (x === inside.x1 + 1) return [1, 0];
    if (y === inside.y0 - 1) return [0, -1];
    return [0, 1];
  };
  const outside = gate.map((c): Cell => [c[0] + out(c)[0], c[1] + out(c)[1]]);
  const behind = gate.map((c): Cell => [c[0] - out(c)[0], c[1] - out(c)[1]]);
  return { inside, wall, corner: l.corner.map(move), gate, outside, behind, garrison: l.garrison.map(move) };
}
