// Building placement (GDD §10 放建築): the preview follows the finger, snapped to cells and
// coloured by sim/src/placement.ts on the snapshot's placement grid; when the finger lifts,
// ✓ sends `build`, ✗ cancels. Pure state, drawn by render/ and ui/overlays.ts.

import { type BuildingInfo, checkPlacement, type CommandBody, type PlacementGrid } from "../sim.ts";
import { TILE_PX } from "../tuning.ts";

export type PlacementPhase = "dragging" | "confirm";

export class Placement {
  readonly info: Pick<BuildingInfo, "type" | "size">;
  readonly builders: number[];
  cellX = 0;
  cellY = 0;
  valid = false;
  phase: PlacementPhase = "dragging";

  constructor(info: Pick<BuildingInfo, "type" | "size">, builders: number[]) {
    this.info = info;
    this.builders = builders;
  }

  /** Centre the footprint on the world point (the finger), snapped to cells. */
  moveTo(wx: number, wy: number, grid: PlacementGrid | null): void {
    const s = this.info.size;
    this.cellX = Math.floor(wx / TILE_PX - s / 2 + 0.5);
    this.cellY = Math.floor(wy / TILE_PX - s / 2 + 0.5);
    this.phase = "dragging";
    this.revalidate(grid);
  }

  /** The finger lifted: show ✓ and ✗. */
  release(): void {
    this.phase = "confirm";
  }

  revalidate(grid: PlacementGrid | null): void {
    this.valid = grid !== null && checkPlacement(grid, this.info, this.cellX, this.cellY) === 0;
  }

  /** ✓: the build command, or null while the spot is red or nobody can build. */
  /** The build order; with no farmers chosen the simulation sends the nearest ones (D-024). */
  confirm(): CommandBody | null {
    if (!this.valid) return null;
    return { c: "build", u: this.builders, type: this.info.type, x: this.cellX, y: this.cellY };
  }

  /** Footprint in world px, for drawing and for placing ✓ and ✗ beside it. */
  rect(): { x: number; y: number; w: number; h: number } {
    const s = this.info.size * TILE_PX;
    return { x: this.cellX * TILE_PX, y: this.cellY * TILE_PX, w: s, h: s };
  }
}
