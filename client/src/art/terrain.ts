// 地形 (R6-51; design/b1/atlas-buildings.md section 12, art-v5): war-game-ui's description of the
// terrain's pictures (terrain/terrain.json) and which goes where. Worked out from each cell's
// Terrain value and its neighbours only, as ui's reference does (design/b1/common/terrain_rules.py
// pieces(), which this follows line by line: the same pieces for the same ground). Pure, for the
// unit tests; render/terrain-draw.ts draws.

import type { FrameRect } from "./spec.ts";
import type { AtlasView } from "./structures.ts";

export const TERRAIN_FORMAT = "war-game terrain 1";

export interface TerrainJson {
  format: string;
  view?: AtlasView;
  px_per_m: number;
  pages: { color: string[]; shadow: string[] };
  rules?: { bridge?: { deck_top_m?: number } };
  frames: Record<string, FrameRect>;
  shadows: Record<string, FrameRect>;
}

export function parseTerrain(v: unknown): TerrainJson {
  const t = v as TerrainJson;
  if (typeof t !== "object" || t === null || t.format !== TERRAIN_FORMAT) throw new Error(`not a ${TERRAIN_FORMAT} description`);
  if (!(t.px_per_m > 0) || typeof t.frames !== "object" || typeof t.pages !== "object") throw new Error("incomplete terrain description");
  return t;
}

/** The ground layer's three, drawn in this order under everything that stands (no shadows). */
export type TerrainGround = "water" | "ford" | "deck";
export const GROUND_ORDER: readonly TerrainGround[] = ["water", "ford", "deck"];

/** A picture: its frame, its anchor in cells (a cell spans x .. x + 1), its front edge (cells, the draw order), and its ground layer if it lies flat. */
export interface TerrainPiece {
  frame: string;
  x: number;
  y: number;
  front: number;
  ground?: TerrainGround;
}

const ROCK = 1;
const FORD = 4;
const BRIDGE_NS = 5;
const BRIDGE_EW = 6;
const CLIFF = 7;
/** Water for the banks: fords and bridges stand in the river. */
const wet = (t: number) => t >= 3 && t <= 6;
const ROCK_VARIANTS = 6;
const CLIFF_POSTS = 2;
/** Looks of each arm, so a long straight face does not repeat every cell. */
const CLIFF_ARMS = 3;
const FORDS = 2;

/** A cell's look among n, the same on every device: small integers only. */
export function variant(x: number, y: number, n: number): number {
  return (x * 31 + y * 17 + ((x ^ y) & 7)) % n;
}

/** The directions a cliff cell joins its neighbours in: the four sides, and a corner only where neither side cell between is cliff. */
function cliffLinks(at: (x: number, y: number) => number, x: number, y: number): [number, number][] {
  const out: [number, number][] = [];
  for (const dx of [-1, 0, 1]) {
    for (const dy of [-1, 0, 1]) {
      if ((dx === 0 && dy === 0) || at(x + dx, y + dy) !== CLIFF) continue;
      if (dx !== 0 && dy !== 0 && (at(x + dx, y) === CLIFF || at(x, y + dy) === CLIFF)) continue;
      out.push([dx, dy]);
    }
  }
  return out;
}

/** Every picture the ground of a w × h map asks for; `t(x, y)` a cell's Terrain value. */
export function terrainPieces(t: (x: number, y: number) => number, w: number, h: number): TerrainPiece[] {
  const out: TerrainPiece[] = [];
  // Off the map: the nearest cell's.
  const at = (x: number, y: number) => t(Math.min(w - 1, Math.max(0, x)), Math.min(h - 1, Math.max(0, y)));
  // Water: one tile on every cell corner (X, Y) whose four cells are not all dry, picked by which are wet.
  for (let Y = 0; Y <= h; Y++) {
    for (let X = 0; X <= w; X++) {
      const m = (wet(at(X - 1, Y - 1)) ? 1 : 0) | (wet(at(X, Y - 1)) ? 2 : 0) | (wet(at(X - 1, Y)) ? 4 : 0) | (wet(at(X, Y)) ? 8 : 0);
      if (m !== 0) out.push({ frame: `terrain_water_m${m}`, x: X, y: Y, front: Y, ground: "water" });
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = t(x, y);
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (v === ROCK) out.push({ frame: `terrain_rock_v${variant(x, y, ROCK_VARIANTS)}`, x: cx, y: cy, front: y + 1 });
      else if (v === FORD) out.push({ frame: `terrain_ford_v${variant(x, y, FORDS)}`, x: cx, y: cy, front: y + 1, ground: "ford" });
      else if (v === BRIDGE_NS || v === BRIDGE_EW) {
        const ns = v === BRIDGE_NS;
        out.push({ frame: `terrain_bridge_deck_${ns ? "ns" : "ew"}`, x: cx, y: cy, front: y + 1, ground: "deck" });
        // The rails on the bridge's two long sides: where the next cell across the way is not this bridge.
        if (ns) {
          if (at(x - 1, y) !== BRIDGE_NS) out.push({ frame: "terrain_bridge_rail_y", x, y: cy, front: y + 1 });
          if (at(x + 1, y) !== BRIDGE_NS) out.push({ frame: "terrain_bridge_rail_y", x: x + 1, y: cy, front: y + 1 });
        } else {
          if (at(x, y - 1) !== BRIDGE_EW) out.push({ frame: "terrain_bridge_rail_x", x: cx, y, front: y + 0.01 });
          if (at(x, y + 1) !== BRIDGE_EW) out.push({ frame: "terrain_bridge_rail_x", x: cx, y: y + 1, front: y + 1 });
        }
      } else if (v === CLIFF) {
        // The rock face: an arm to each cliff neighbour E, S, and SE / SW only where the two cells between are not
        // cliff (a staircase line joins through them instead); a post where the line turns, ends or branches (arms
        // in a straight run overlap into one face); the arms just before the posts of their southern row, so the
        // posts cover the joins.
        const links = cliffLinks(at, x, y);
        const straight = links.length === 2 && links[0][0] === -links[1][0] && links[0][1] === -links[1][1];
        if (!straight) out.push({ frame: `terrain_cliff_post_v${variant(x, y, CLIFF_POSTS)}`, x: cx, y: cy, front: y + 1 });
        const arm = variant(x, y, CLIFF_ARMS);
        if (at(x + 1, y) === CLIFF && x + 1 < w) out.push({ frame: `terrain_cliff_arm_E_v${arm}`, x: x + 1, y: cy, front: y + 0.99 });
        if (at(x, y + 1) === CLIFF && y + 1 < h) out.push({ frame: `terrain_cliff_arm_S_v${arm}`, x: cx, y: y + 1, front: y + 1.99 });
        if (at(x + 1, y + 1) === CLIFF && at(x + 1, y) !== CLIFF && at(x, y + 1) !== CLIFF && x + 1 < w && y + 1 < h) {
          out.push({ frame: `terrain_cliff_arm_SE_v${arm}`, x: x + 1, y: y + 1, front: y + 1.99 });
        }
        if (at(x - 1, y + 1) === CLIFF && at(x - 1, y) !== CLIFF && at(x, y + 1) !== CLIFF && x > 0 && y + 1 < h) {
          out.push({ frame: `terrain_cliff_arm_SW_v${arm}`, x, y: y + 1, front: y + 1.99 });
        }
      }
    }
  }
  return out;
}

/** The map cells a piece's picture covers, for the fog: a corner's four, an arm's or a rail's two, else its own. */
export function pieceCells(p: TerrainPiece): [number, number][] {
  const fx = Math.floor(p.x);
  const fy = Math.floor(p.y);
  const onX = p.x === fx;
  const onY = p.y === fy;
  if (onX && onY) return [[fx - 1, fy - 1], [fx, fy - 1], [fx - 1, fy], [fx, fy]];
  if (onX) return [[fx - 1, fy], [fx, fy]];
  if (onY) return [[fx, fy - 1], [fx, fy]];
  return [[fx, fy]];
}
