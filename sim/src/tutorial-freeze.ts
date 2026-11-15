// R25 (D-150, D-151): the tutorial's map, made once with the random generator and written out as data
// (core/tutorial-data.ts), as 雙河關's was; kept here with its seed so it can be made again. Not in the Worker.
//   node src/tutorial-freeze.ts > src/core/tutorial-data.ts
//
// generateRandomMap(TUTORIAL_SEED, 65, 3, "diagonal"): the main cities about 44 cells apart with nothing in the way;
// of its three towns only the small town by player 0's home is kept (the big city and the other small town are taken
// away, their castle walls open ground), so the march on player 1's main city passes no town; no gold by the town.

import { castleOf } from "./core/castle.ts";
import { generateRandomMap } from "./core/random-map.ts";
import { NodeKind, Terrain, TownSize } from "./protocol.ts";

/** The draw; changing it changes the tutorial's map (and the distances given to client and ui). */
export const TUTORIAL_SEED = Number(process.env.TUTORIAL_SEED ?? 102);

const m = generateRandomMap(TUTORIAL_SEED, 65, 3, "diagonal");
const n = m.size;
const home = m.spawns.find((s) => s.player === 0)!;
const near = (t: { cellX: number; cellY: number }) => Math.hypot(t.cellX - home.cellX, t.cellY - home.cellY);
const kept = m.towns.filter((t) => t.size === TownSize.Small).sort((a, b) => near(a) - near(b))[0];
const terrain = m.terrain.slice();
for (const t of m.towns) {
  if (t === kept) continue;
  for (const [dx, dy] of castleOf(t.size).wall) {
    const i = (t.cellY + dy) * n + t.cellX + dx;
    if (terrain[i] !== Terrain.Wall) throw new Error(`tutorial map: no wall at ${t.cellX + dx},${t.cellY + dy}`);
    terrain[i] = Terrain.Open;
  }
}
let walls = 0;
for (let i = 0; i < n * n; i++) if (terrain[i] === Terrain.Wall) walls++;
if (walls !== castleOf(TownSize.Small).wall.length) throw new Error(`tutorial map: ${walls} wall cells left`);

const CHAR: Record<number, string> = { [Terrain.Blocked]: "R", [Terrain.Wall]: "#", [Terrain.Water]: "~", [Terrain.Cliff]: "K", [Terrain.Ford]: "f", [Terrain.BridgeNS]: "|", [Terrain.BridgeEW]: "=" };
const NODE: Record<number, string> = { [NodeKind.Tree]: "T", [NodeKind.GoldMine]: "G", [NodeKind.Berries]: "B", [NodeKind.CrystalVein]: "V" };
const rows: string[][] = [];
for (let y = 0; y < n; y++) {
  const row: string[] = [];
  for (let x = 0; x < n; x++) {
    const t = terrain[y * n + x];
    row.push(t === Terrain.Open ? "." : (CHAR[t] ?? "?"));
  }
  rows.push(row);
}
// No gold by the town (the generator puts a mine about 12 cells from each home town): the economy would send a
// beginner's farmers to dig beside the militia's walls. Home keeps its other mine.
const GOLD_OFF_TOWN = 14;
const nodes = m.nodes.filter((nd) => nd.kind !== NodeKind.GoldMine || Math.hypot(nd.cellX - kept.cellX, nd.cellY - kept.cellY) >= GOLD_OFF_TOWN);
const homeGold = nodes.filter((nd) => nd.kind === NodeKind.GoldMine && Math.hypot(nd.cellX - home.cellX, nd.cellY - home.cellY) <= 15).length;
if (homeGold === 0) throw new Error("tutorial map: no gold by home");
const amounts: Record<string, number> = {};
for (const nd of nodes) {
  const c = NODE[nd.kind];
  if (rows[nd.cellY][nd.cellX] !== ".") throw new Error(`tutorial map: a node on ${rows[nd.cellY][nd.cellX]} at ${nd.cellX},${nd.cellY}`);
  rows[nd.cellY][nd.cellX] = c;
  if (amounts[c] !== undefined && amounts[c] !== nd.amount) throw new Error(`tutorial map: ${c} holds ${nd.amount} and ${amounts[c]}`);
  amounts[c] = nd.amount;
}
if (rows.flat().includes("?")) throw new Error("tutorial map: a terrain it cannot write");

// Step 5's rally point (ui's boards: away from home toward the town, so that the army is out when step 7's enemies come):
// RALLY.from cells from player 0's main city, turned off the way to the town by the least angle (either side, the
// positive first) that leaves it RALLY.town cells or more from the town's centre and RALLY.path cells or more off the
// straight line between the main cities (step 7's enemies come that way, and must find the army gone), on a cell
// with open ground all round.
const RALLY = { from: 10, town: 13, path: 7 };
const enemy = m.spawns.find((s) => s.player === 1)!;
const offPath = (x: number, y: number) => {
  const dx = enemy.cellX - home.cellX;
  const dy = enemy.cellY - home.cellY;
  return Math.abs((x - home.cellX) * dy - (y - home.cellY) * dx) / Math.hypot(dx, dy);
};
const open = (x: number, y: number) => {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (rows[y + dy]?.[x + dx] !== ".") return false;
  return true;
};
const toTown = Math.atan2(kept.cellY - home.cellY, kept.cellX - home.cellX);
let rally: { x: number; y: number } | null = null;
for (let deg = 0; deg <= 90 && rally === null; deg += 5) {
  for (const sign of [1, -1]) {
    const a = toTown + (sign * deg * Math.PI) / 180;
    const x = Math.round(home.cellX + RALLY.from * Math.cos(a));
    const y = Math.round(home.cellY + RALLY.from * Math.sin(a));
    if (Math.hypot(x - kept.cellX, y - kept.cellY) >= RALLY.town && offPath(x, y) >= RALLY.path && open(x, y)) {
      rally = { x, y };
      break;
    }
  }
}
if (rally === null) throw new Error("tutorial map: no rally point");

// Where the `tutorial` events put things (outward from these cells, core/tutorial.ts): player 0's ANCHOR.own cells from
// its main city toward the map's middle; player 1's squad ("near_home") ANCHOR.squad cells from its main city toward
// player 0's. Worked out here: core/ uses no Math.hypot (test/boundaries.test.ts).
const ANCHOR = { own: 7, squad: 8 };
const toward = (from: { cellX: number; cellY: number }, tx: number, ty: number, cells: number) => {
  const len = Math.max(1, Math.hypot(tx - from.cellX, ty - from.cellY));
  return { x: Math.round(from.cellX + ((tx - from.cellX) * cells) / len), y: Math.round(from.cellY + ((ty - from.cellY) * cells) / len) };
};
const mid = n >> 1;
const anchors = { own: toward(home, mid, mid, ANCHOR.own), squad: toward(enemy, home.cellX, home.cellY, ANCHOR.squad) };

const out = [
  "// The tutorial's map (R25, D-150): src/tutorial-freeze.ts made it; not edited by hand. One row per y, one character per",
  "// cell (as twin-rivers-data.ts): .  open   R  rock   K  cliff   ~  water   f  ford   |  bridge, north-south",
  "//   =  bridge, east-west   #  castle wall   T  tree   G  gold   B  berries   V  crystal vein (TUTORIAL.amounts each).",
  "// Player 0 starts at spawns[0], the one small town (towns[0]) by its home; player 1 across the map.",
  "",
  "export const TUTORIAL = {",
  `  seed: ${TUTORIAL_SEED},`,
  `  size: ${n},`,
  `  amounts: ${JSON.stringify(amounts)},`,
  `  spawns: ${JSON.stringify([0, 1].map((p) => { const s = m.spawns.find((x) => x.player === p)!; return [s.cellX, s.cellY]; }))},`,
  "  /** [size, x, y, radius]. */",
  `  towns: ${JSON.stringify([[kept.size, kept.cellX, kept.cellY, kept.radius]])},`,
  `  frames: ${JSON.stringify(m.frames)},`,
  `  posts: ${JSON.stringify(m.posts)},`,
  "  /** Step 5's rally point (tutorial-freeze.ts RALLY). */",
  `  rally: ${JSON.stringify(rally)},`,
  "  /** Where the events put things (tutorial-freeze.ts ANCHOR). */",
  `  anchors: ${JSON.stringify(anchors)},`,
  "  rows: [",
  ...rows.map((r) => `    ${JSON.stringify(r.join(""))},`),
  "  ],",
  "};",
  "",
];
process.stdout.write(out.join("\n"));
