// 雙河關 ("twin-rivers"), the third kind of map: one map fixed as data (twin-rivers-data.ts). A player, person or AI,
// starts knowing only its own main city, as on a random map (mode "random"; the user played it so). An odd game seed
// swaps the two starts (ceo 2026-10-31: a person starts at the top in half the games, at the bottom in the others;
// the map is its own mirror image, so it is as fair either way). It needs D-100's castles (KEEP): its walls are in it.

import type { Frame } from "../frame.ts";
import { NodeKind, Terrain, type TownSize } from "../protocol.ts";
import { KEEP } from "./keep.ts";
import type { NodeSpec, TownSpec } from "./map.ts";
import type { RandomMap } from "./random-map.ts";
import { TWIN_RIVERS } from "./twin-rivers-data.ts";

const TERRAIN: Record<string, number> = { R: Terrain.Blocked, "#": Terrain.Wall, "~": Terrain.Water, K: Terrain.Cliff, f: Terrain.Ford, "|": Terrain.BridgeNS, "=": Terrain.BridgeEW };
const NODE: Record<string, NodeKind> = { T: NodeKind.Tree, G: NodeKind.GoldMine, B: NodeKind.Berries, V: NodeKind.CrystalVein };

export function twinRiversMap(seed: number): RandomMap {
  if (!KEEP.on) throw new Error("twin-rivers needs KEEP's castles");
  const d = TWIN_RIVERS;
  const n = d.size;
  const terrain = new Uint8Array(n * n);
  const nodes: NodeSpec[] = [];
  d.rows.forEach((row, y) => {
    for (let x = 0; x < n; x++) {
      const c = row[x];
      const kind = c === "w" ? NodeKind.Tree : NODE[c];
      if (kind !== undefined) nodes.push({ kind, cellX: x, cellY: y, amount: d.amounts[c === "w" ? "T" : (c as keyof typeof d.amounts)] });
      if (c === "w") terrain[y * n + x] = Terrain.Water;
      else if (kind === undefined && c !== ".") terrain[y * n + x] = TERRAIN[c];
    }
  });
  const swap = (seed & 1) === 1 ? 1 : 0;
  const towns: TownSpec[] = d.towns.map(([size, cellX, cellY, radius], id) => ({ id, size: size as TownSize, cellX, cellY, radius }));
  return {
    seed,
    size: n,
    terrain,
    nodes,
    spawns: [0, 1].map((player) => {
      const [cellX, cellY] = d.spawns[player ^ swap];
      return { player, cellX, cellY };
    }),
    towns,
    tower: { cellX: d.tower[0], cellY: d.tower[1] },
    towerSize: d.towerSize,
    frames: [d.frames[swap] as Frame, d.frames[1 - swap] as Frame],
    mode: "random",
    posts: d.posts,
    layout: d.layout,
    orientation: d.orientation,
    mirror: d.mirror as Frame,
    redraws: 0,
  };
}
