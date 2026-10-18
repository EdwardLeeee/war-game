// 野城的城牆 (D-084, the user's choice B): where a town's wall stands, in world pixels. A small
// town has no tower: its wall is in the middle, 3 x 3 cells. A big city's tower stands in its
// middle, so its 4 x 4 wall stands right under the tower, its top along the tower's foot and
// centred on it (ceo 2026-10-18: the wall does not cover the tower). The tower is read from the
// snapshot and kept, so the wall stays put when the tower falls. It always covers the town's
// centre cell (2 x 2 on one of its corners, or 3 x 3 around it), and a town shows once its centre
// is explored, so the tower is seen with the town: the wall never moves. Only a city whose tower
// fell before anyone of ours saw it goes by the rules (its size, one up and one left of the
// centre, as the fixed map has it; a random map may have it on another corner, but it is gone).

import { TILE_PX } from "../tuning.ts";
import { TownSize } from "../sim.ts";

/** Sides in cells, near the main city's 4 (the user's choice: 小鎮約 3×3、大城約 4×4). */
export const WALL_CELLS: Record<number, number> = { [TownSize.Small]: 3, [TownSize.Large]: 4 };

export interface TowerCells {
  cellX: number;
  cellY: number;
  size: number;
}

/** The wall's top-left corner and side, world px. */
export interface WallSpot {
  x: number;
  y: number;
  side: number;
}

/** Where the big city's tower is by the rules, for one never seen (it fell before). */
export function ruleTower(town: { cellX: number; cellY: number }, size: number): TowerCells {
  return { cellX: town.cellX - 1, cellY: town.cellY - 1, size };
}

export function wallSpot(town: { cellX: number; cellY: number; size: number }, tower: TowerCells | null): WallSpot {
  const side = (WALL_CELLS[town.size] ?? 3) * TILE_PX;
  if (town.size !== TownSize.Large || tower === null) {
    return { x: (town.cellX + 0.5) * TILE_PX - side / 2, y: (town.cellY + 0.5) * TILE_PX - side / 2, side };
  }
  return { x: (tower.cellX + tower.size / 2) * TILE_PX - side / 2, y: (tower.cellY + tower.size) * TILE_PX, side };
}
