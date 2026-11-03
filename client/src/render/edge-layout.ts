// 浮空大陸的邊緣 (the user 2026-11-04 chose R11 C, D-118; ui's design/r11/edge-format.md): what goes
// where round the map as a diamond. The map's corners on the screen: left (0, n), bottom (n, n),
// right (n, 0), top (0, 0) in cells. The two lower edges show a cliff: `sw` along y = n (left to
// bottom), `se` along x = n (bottom to right); the two upper ones only fade into the clouds. Pure,
// for the unit tests; render/edge.ts draws it.

import { Fog, Terrain } from "../sim.ts";

/** One of ui's pictures: its file and the point on it that is put on the spot. */
export interface EdgePiece {
  file: string;
  anchor: [number, number];
}

/** ui's edge/edge.json ("war-game edge 1"). */
export interface EdgeJson {
  format: "war-game edge 1";
  view: "diamond";
  scale: number;
  pxPerM: number;
  clouds: Record<"far" | "near", { file: string; alpha: boolean; tile_px: number; parallax: number; drift_px_s: [number, number]; fade_s: number }>;
  islands: (EdgePiece & { size_m: number; bob_px: number; bob_s: number })[];
  cliff: {
    height_m: number;
    stretch_m: number;
    overlap_m: number;
    sw: (EdgePiece & { lip: [[number, number], [number, number]] })[];
    se: (EdgePiece & { lip: [[number, number], [number, number]] })[];
    corner: Record<"left" | "bottom" | "right", EdgePiece>;
  };
  fall: {
    loop: { file: string; width_m: number; period_px: number; scroll_m_s: number; widen_per_m: number };
    spray: EdgePiece;
    mouth: EdgePiece & { foam_m: number };
  };
  puffs: { file: string; drift_px_s: [number, number]; alpha_max: number }[];
  rim: { fade_m: number };
}

/** The edge's description, or null when it is not one this page can draw. */
export function parseEdge(json: unknown): EdgeJson | null {
  const j = json as Partial<EdgeJson> | null;
  if (j === null || typeof j !== "object" || j.format !== "war-game edge 1") return null;
  const ok =
    typeof j.pxPerM === "number" &&
    j.pxPerM > 0 &&
    j.clouds?.far !== undefined &&
    j.clouds.near !== undefined &&
    Array.isArray(j.cliff?.sw) &&
    j.cliff.sw.length > 0 &&
    Array.isArray(j.cliff.se) &&
    j.cliff.se.length > 0 &&
    j.cliff.corner !== undefined &&
    j.fall?.loop !== undefined &&
    Array.isArray(j.islands) &&
    Array.isArray(j.puffs);
  return ok ? (j as EdgeJson) : null;
}

/** Every file the edge needs, once each. */
export function edgeFiles(e: EdgeJson): string[] {
  const files = [
    e.clouds.far.file,
    e.clouds.near.file,
    ...e.islands.map((i) => i.file),
    ...e.cliff.sw.map((p) => p.file),
    ...e.cliff.se.map((p) => p.file),
    e.cliff.corner.left.file,
    e.cliff.corner.bottom.file,
    e.cliff.corner.right.file,
    e.fall.loop.file,
    e.fall.spray.file,
    e.fall.mouth.file,
    ...e.puffs.map((p) => p.file),
  ];
  return [...new Set(files)];
}

export type EdgeSide = "sw" | "se";

/** Metres a cell (the simulation's cells are 2 m). */
export const CELL_M = 2;

/**
 * The cliff's pieces along one lower edge: one every `stretch_m`, their middles on the edge (cells
 * along it, from its left end), which of ui's pieces (they join in any order; picked by place, so
 * the same map looks the same each time), and the edge's cells each covers (for the fog).
 */
export function cliffPieces(size: number, side: EdgeSide, stretchM: number, kinds: number): { mid: number; kind: number; from: number; to: number }[] {
  const step = stretchM / CELL_M;
  const n = Math.max(1, Math.round(size / step));
  const len = size / n;
  const out: { mid: number; kind: number; from: number; to: number }[] = [];
  for (let k = 0; k < n; k++) {
    const from = Math.floor(k * len);
    const to = Math.min(size, Math.ceil((k + 1) * len));
    out.push({ mid: (k + 0.5) * len, kind: ((k * 7 + (side === "se" ? 3 : 0)) % kinds + kinds) % kinds, from, to });
  }
  return out;
}

/** The edge's cell `i` along `side` (from its left end on the screen). */
export function edgeCell(size: number, side: EdgeSide, i: number): number {
  // sw: y = n − 1, x from 0 (the left corner) up; se: x = n − 1, y from n − 1 (the bottom corner) down.
  return side === "sw" ? (size - 1) * size + i : (size - 1 - i) * size + (size - 1);
}

/** Water the river runs off the map with: open water, a ford, a bridge over it. */
const WATERY = new Set<number>([Terrain.Water, Terrain.Ford, Terrain.BridgeNS, Terrain.BridgeEW]);

/** The waterfalls: each run of water on a lower edge, in cells along it from its left end ([from, to)). */
export function edgeFalls(terrain: Uint8Array, size: number): { side: EdgeSide; from: number; to: number }[] {
  const out: { side: EdgeSide; from: number; to: number }[] = [];
  for (const side of ["sw", "se"] as const) {
    let start = -1;
    for (let i = 0; i <= size; i++) {
      const wet = i < size && WATERY.has(terrain[edgeCell(size, side, i)]);
      if (wet && start < 0) start = i;
      if (!wet && start >= 0) {
        out.push({ side, from: start, to: i });
        start = -1;
      }
    }
  }
  return out;
}

/** How light the cliff under these cells of the edge is: as seen 1, explored 0.55, never 0.15 (the mean). */
export function edgeLight(fog: Uint8Array | null, size: number, side: EdgeSide, from: number, to: number): number {
  if (fog === null) return 1;
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, from); i < Math.min(size, to); i++) {
    const f = fog[edgeCell(size, side, i)];
    sum += f === Fog.Visible ? 1 : f === Fog.Explored ? 0.55 : 0.15;
    n++;
  }
  return n === 0 ? 1 : sum / n;
}

/** A point of the edge as world cells: `along` cells from the side's left end. */
export function edgePoint(size: number, side: EdgeSide, along: number): { x: number; y: number } {
  return side === "sw" ? { x: along, y: size } : { x: size, y: size - along };
}
