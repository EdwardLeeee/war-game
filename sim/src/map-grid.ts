// The map as the simulation makes it, one character a cell (Node; no build step), for
// war-game-ui's art to use the same cells as the game (R6-51). The fixed map by default.
//   node src/map-grid.ts [--map fixed|random] [--seed N] > grid.json
// Writes JSON: size, legend, rows (one string a row, y from 0), and the Terrain values.

import { generateMap, type GameMap } from "./core/map.ts";
import { generateRandomMap } from "./core/random-map.ts";
import { NodeKind, Terrain } from "./protocol.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const mode = arg("map", "fixed");
const map: GameMap = mode === "random" ? generateRandomMap(Number(arg("seed", "1")), 129) : generateMap();
const n = map.size;
const GROUND: Record<number, string> = {
  [Terrain.Open]: ".",
  [Terrain.Blocked]: "R",
  [Terrain.Wall]: "W",
  [Terrain.Water]: "~",
  [Terrain.Ford]: "f",
  [Terrain.BridgeNS]: "|",
  [Terrain.BridgeEW]: "=",
  [Terrain.Cliff]: "K",
};
const NODE: Record<number, string> = { [NodeKind.Tree]: "T", [NodeKind.GoldMine]: "G", [NodeKind.Berries]: "B", [NodeKind.CrystalVein]: "C" };
const cells = [...map.terrain].map((t) => GROUND[t] ?? "?");
for (const s of map.nodes) cells[s.cellY * n + s.cellX] = NODE[s.kind] ?? "?";
for (const s of map.spawns) for (let y = s.cellY - 2; y < s.cellY + 2; y++) for (let x = s.cellX - 2; x < s.cellX + 2; x++) cells[y * n + x] = "M";
const ts = map.towerSize ?? 2;
for (let y = map.tower.cellY; y < map.tower.cellY + ts; y++) for (let x = map.tower.cellX; x < map.tower.cellX + ts; x++) cells[y * n + x] = "O";
const rows: string[] = [];
for (let y = 0; y < n; y++) rows.push(cells.slice(y * n, (y + 1) * n).join(""));
const legend = {
  ".": "open ground",
  R: "rock: heaps, ridges (Terrain.Blocked)",
  W: "castle wall or corner tower (Terrain.Wall)",
  "~": "water (Terrain.Water)",
  f: "ford (Terrain.Ford)",
  "|": "bridge, crossed going north-south (Terrain.BridgeNS)",
  "=": "bridge, crossed going east-west (Terrain.BridgeEW)",
  K: "cliff (Terrain.Cliff)",
  T: "tree",
  G: "gold",
  B: "berries",
  C: "crystal",
  M: "main city",
  O: "big city tower",
};
process.stdout.write(JSON.stringify({ map: mode === "random" ? `random ${arg("seed", "1")}` : "fixed", size: n, legend, rows, terrain: [...map.terrain] }) + "\n");
