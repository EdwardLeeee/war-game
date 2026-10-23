// D-100 map measurement as for R6-51: the fixed map's walks and random maps 1-N (KEEP on or off):
// main city to main city (median, max), main city to any town (max), redraws, obstacle share.
import { generateMap, type GameMap } from "../src/core/map.ts";
import { ATTEMPTS, generateRandomMap, THROWN_AWAY } from "../src/core/random-map.ts";
import { KEEP } from "../src/core/rules.ts";
import { Terrain, walkableTerrain } from "../src/protocol.ts";
KEEP.on = process.argv[2] === "on";
const N = Number(process.argv[3] ?? 300);

function walks(map: GameMap, from: number[], open: Set<number>): Int32Array {
  const n = map.size;
  const blocked = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) if (!walkableTerrain(map.terrain[i])) blocked[i] = 1;
  for (const s of map.nodes) blocked[s.cellY * n + s.cellX] = 1;
  for (const s of map.spawns) for (let y = s.cellY - 2; y < s.cellY + 2; y++) for (let x = s.cellX - 2; x < s.cellX + 2; x++) blocked[y * n + x] = 1;
  const ts = map.towerSize ?? 2;
  for (let y = map.tower.cellY; y < map.tower.cellY + ts; y++) for (let x = map.tower.cellX; x < map.tower.cellX + ts; x++) blocked[y * n + x] = 1;
  for (const k of open) blocked[k] = 0;
  const dist = new Int32Array(n * n).fill(1 << 30);
  const buckets: number[][] = [];
  for (const k of from) dist[k] = 0;
  buckets[0] = [...from];
  for (let d = 0; d < buckets.length; d++) {
    for (const k of buckets[d] ?? []) {
      if (dist[k] !== d) continue;
      const x = k % n;
      const y = (k - x) / n;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n || blocked[ny * n + nx]) continue;
        if (dx !== 0 && dy !== 0 && (blocked[y * n + nx] || blocked[ny * n + x])) continue;
        const nk = ny * n + nx;
        const nd = d + (dx !== 0 && dy !== 0 ? 14 : 10);
        if (nd < dist[nk]) {
          dist[nk] = nd;
          (buckets[nd] ??= []).push(nk);
        }
      }
    }
  }
  return dist;
}
function measure(map: GameMap) {
  const n = map.size;
  const [s0, s1] = [0, 1].map((p) => map.spawns.find((s) => s.player === p)!);
  const fp = (s: { cellX: number; cellY: number }) => {
    const o: number[] = [];
    for (let y = s.cellY - 2; y < s.cellY + 2; y++) for (let x = s.cellX - 2; x < s.cellX + 2; x++) o.push(y * n + x);
    return o;
  };
  const ts = map.towerSize ?? 2;
  const tower: number[] = [];
  for (let y = map.tower.cellY; y < map.tower.cellY + ts; y++) for (let x = map.tower.cellX; x < map.tower.cellX + ts; x++) tower.push(y * n + x);
  // Every town's keep is open as the big city's tower is (the walk's goal is the centre cell).
  if (KEEP.on) for (const t of map.towns) for (let y = t.cellY - 1; y <= t.cellY + 1; y++) for (let x = t.cellX - 1; x <= t.cellX + 1; x++) tower.push(y * n + x);
  const open = new Set([...fp(s0), ...fp(s1), ...tower]);
  const d = walks(map, [s0.cellY * n + s0.cellX], open);
  const ratio = (x: number, y: number) => {
    const ax = Math.abs(x - s0.cellX);
    const ay = Math.abs(y - s0.cellY);
    return d[y * n + x] / (Math.max(ax, ay) * 10 + Math.min(ax, ay) * 4);
  };
  let obst = 0;
  for (let i = 0; i < n * n; i++) if (map.terrain[i] !== Terrain.Open && map.terrain[i] !== Terrain.Wall) obst++;
  return { mainMain: ratio(s1.cellX, s1.cellY), town: Math.max(...map.towns.map((t) => ratio(t.cellX, t.cellY))), obst: obst / (n * n) };
}
const f = measure(generateMap());
console.log(`KEEP ${KEEP.on ? "on" : "off"} fixed: main-main ${f.mainMain.toFixed(3)} town max ${f.town.toFixed(3)} obstacles ${(100 * f.obst).toFixed(1)}%`);
const mm: number[] = [];
const tw: number[] = [];
const ob: number[] = [];
let fallback = 0;
for (let s = 1; s <= N; s++) {
  const m = generateRandomMap(s, 129) as GameMap & { redraws?: number };
  if ((m.redraws ?? 0) >= ATTEMPTS - 1) fallback++;
  const r = measure(m);
  mm.push(r.mainMain);
  tw.push(r.town);
  ob.push(r.obst);
}
const med = (l: number[]) => [...l].sort((a, b) => a - b)[l.length >> 1];
console.log(`random 1-${N}: main-main median ${med(mm).toFixed(3)} max ${Math.max(...mm).toFixed(3)}; town max ${Math.max(...tw).toFixed(3)}; obstacles median ${(100 * med(ob)).toFixed(1)}%; no-obstacle fallbacks ${fallback}; thrown away ${JSON.stringify(THROWN_AWAY)}`);
