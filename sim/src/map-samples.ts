// Sample maps for D-074 step 2: the fixed map and the first three diagonal and three adjacent
// random maps (seeds 1, 2, ...), as JSON for the renderer, after checking that each map looks
// the same from both sides.
//
//   node src/map-samples.ts <out.json> [size]

import { writeFileSync } from "node:fs";
import { type Frame, IDENTITY, MIRROR_XY, fromCanon, toCanon } from "./frame.ts";
import { generateMap, type GameMap } from "./core/map.ts";
import { generateRandomMap, type RandomMap } from "./core/random-map.ts";
import { NodeKind, Terrain } from "./protocol.ts";

const out = process.argv[2];
const size = Number(process.argv[3] ?? 129);
if (!out) throw new Error("usage: node src/map-samples.ts <out.json> [size]");

const CHAR: Record<number, string> = {
  [NodeKind.Tree]: "T",
  [NodeKind.GoldMine]: "G",
  [NodeKind.Berries]: "B",
  [NodeKind.CrystalVein]: "C",
};

function grid(map: GameMap): string[] {
  const n = map.size;
  const cells: string[] = [];
  for (let i = 0; i < n * n; i++) cells.push(map.terrain[i] === Terrain.Blocked ? "#" : ".");
  for (const node of map.nodes) cells[node.cellY * n + node.cellX] = CHAR[node.kind];
  const rows: string[] = [];
  for (let y = 0; y < n; y++) rows.push(cells.slice(y * n, (y + 1) * n).join(""));
  return rows;
}

function rectCanon(f: Frame, x: number, y: number, s: number): string {
  const p = toCanon(f, x, y);
  const q = toCanon(f, x + s - 1, y + s - 1);
  return `${Math.min(p.u, q.u)},${Math.min(p.v, q.v)}`;
}

/** Every check that both sides see the same map; returns the tower's canonical offset (0 or 1 cell). */
function check(map: GameMap, mirror: Frame): { towerLean: number } {
  const n = map.size;
  const rows = grid(map);
  const at = (x: number, y: number) => rows[y][x];
  const [f0, f1] = map.frames;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const m = toCanon(mirror, x, y);
      if (at(x, y) !== at(m.u, m.v)) throw new Error(`seed ${map.seed}: (${x},${y}) is not its mirror (${m.u},${m.v})`);
      const r0 = fromCanon(f0, x, y);
      const r1 = fromCanon(f1, x, y);
      if (at(r0.x, r0.y) !== at(r1.x, r1.y)) throw new Error(`seed ${map.seed}: canonical (${x},${y}) differs between the frames`);
    }
  }
  const s0 = map.spawns[0];
  const s1 = map.spawns[1];
  if (rectCanon(f0, s0.cellX - 2, s0.cellY - 2, 4) !== rectCanon(f1, s1.cellX - 2, s1.cellY - 2, 4)) {
    throw new Error(`seed ${map.seed}: main cities differ in canonical coordinates`);
  }
  const towns = (f: Frame) =>
    map.towns.map((t) => {
      const c = toCanon(f, t.cellX, t.cellY);
      return `${t.size}:${c.u},${c.v}`;
    }).sort().join(" ");
  if (towns(f0) !== towns(f1)) throw new Error(`seed ${map.seed}: towns differ in canonical coordinates`);
  const t0 = rectCanon(f0, map.tower.cellX, map.tower.cellY, 2).split(",").map(Number);
  const t1 = rectCanon(f1, map.tower.cellX, map.tower.cellY, 2).split(",").map(Number);
  return { towerLean: Math.abs(t0[0] - t1[0]) + Math.abs(t0[1] - t1[1]) };
}

function entry(map: GameMap, extra: Record<string, unknown>, mirror: Frame) {
  const { towerLean } = check(map, mirror);
  return {
    seed: map.seed,
    size: map.size,
    grid: grid(map),
    spawns: map.spawns,
    towns: map.towns,
    tower: map.tower,
    frames: map.frames,
    mirror,
    towerLean,
    ...extra,
  };
}

const maps: unknown[] = [];
const picked = { diagonal: 0, adjacent: 0 };
const random: RandomMap[] = [];
for (let seed = 1; picked.diagonal < 3 || picked.adjacent < 3; seed++) {
  const m = generateRandomMap(seed, size);
  if (picked[m.layout] >= 3) continue;
  picked[m.layout]++;
  random.push(m);
}
random.sort((a, b) => (a.layout === b.layout ? a.seed - b.seed : a.layout === "diagonal" ? -1 : 1));
for (const m of random) maps.push(entry(m, { kind: "random", layout: m.layout, orientation: m.orientation }, m.mirror));
const fixed = generateMap();
if (fixed.frames[0] !== IDENTITY) throw new Error("fixed map: frames changed");
maps.push(entry(fixed, { kind: "fixed", layout: "diagonal", orientation: 0 }, MIRROR_XY));
writeFileSync(out, JSON.stringify(maps));
for (const m of maps as { seed: number; kind: string; layout: string; orientation: number; towerLean: number }[]) {
  console.log(`${m.kind} seed ${m.seed} ${m.layout} orientation ${m.orientation} tower lean ${m.towerLean}`);
}
