// Can a building go here? One function for both sides of the contract: the screen calls it
// on the placement grid from its snapshots to colour the preview green or red, and the
// simulation calls it on its own full-knowledge grid to accept or reject a `build` command.

import { type BuildingInfo, BuildingType, PlaceBit, Reject } from "./protocol.ts";

export interface PlacementGrid {
  /** Side in cells. */
  size: number;
  /** size * size PlaceBit values, row by row. */
  cells: Uint8Array;
}

/**
 * 0 if a building of this kind fits with its top-left cell at (cellX, cellY), otherwise
 * Reject.BadPlacement. Every footprint cell must be on the map, explored and not blocked;
 * a farm's cells must also all be farm land (near your own main city or granary).
 * Units standing there do not block: they are pushed aside.
 */
export function checkPlacement(
  grid: PlacementGrid,
  building: Pick<BuildingInfo, "type" | "size">,
  cellX: number,
  cellY: number,
): 0 | typeof Reject.BadPlacement {
  const n = grid.size;
  const s = building.size;
  if (!Number.isInteger(cellX) || !Number.isInteger(cellY)) return Reject.BadPlacement;
  if (cellX < 0 || cellY < 0 || cellX + s > n || cellY + s > n) return Reject.BadPlacement;
  const farm = building.type === BuildingType.Farm;
  for (let y = cellY; y < cellY + s; y++) {
    for (let x = cellX; x < cellX + s; x++) {
      const c = grid.cells[y * n + x];
      if ((c & (PlaceBit.Blocked | PlaceBit.Unexplored)) !== 0) return Reject.BadPlacement;
      if (farm && (c & PlaceBit.FarmLand) === 0) return Reject.BadPlacement;
    }
  }
  return 0;
}
