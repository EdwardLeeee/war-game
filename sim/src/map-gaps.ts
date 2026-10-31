// How much the terrain of random maps funnels an army (the user 2026-10-31: 「有好幾個地形關口」). For maps 1-N, by layout:
// w5, the way between the main cities for a column 5 cells wide (every cell of it 3 or more from rock, cliff, water and
// castle walls; trees do not count, they get cut) over the shortest way on foot. A ford or a bridge is 3 wide, a ridge's
// gap 3: a map whose narrow places can be walked round has a w5 near 1; 雙河關 has 1.76.
//   node src/map-gaps.ts [--maps 300]
// Prints Markdown. Reports only, no threshold.

import { generateRandomMap } from "./core/random-map.ts";
import { twinRiversMap } from "./core/twin-rivers.ts";
import { walkableTerrain } from "./protocol.ts";

/** A column this wide: every cell of its way this many rings or more from the terrain. */
const CLEAR = 3;
/** The 雙河關 share: maps at least this funnelled (ceo 2026-10-31: 70% of each layout's). */
const GOAL = 1.4;

type Map = ReturnType<typeof generateRandomMap>;

/** Rings from each cell to the nearest cell not walked (8 round each). */
function clearance(n: number, open: Uint8Array): Int32Array {
  const clear = new Int32Array(n * n).fill(1 << 30);
  const q: number[] = [];
  for (let i = 0; i < n * n; i++) {
    if (open[i] === 1) continue;
    clear[i] = 0;
    q.push(i);
  }
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const x = c % n;
    const y = (c - x) / n;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
        const j = yy * n + xx;
        if (clear[j] <= clear[c] + 1) continue;
        clear[j] = clear[c] + 1;
        q.push(j);
      }
    }
  }
  return clear;
}

/** Cells of the way from a to b on `open` (10 a step, 14 diagonally, no cut corners), or -1. */
function walk(n: number, open: Uint8Array, a: number, b: number): number {
  const dist = new Int32Array(n * n).fill(1 << 30);
  const buckets: number[][] = [];
  dist[a] = 0;
  buckets[0] = [a];
  for (let d = 0; d < buckets.length; d++) {
    for (const c of buckets[d] ?? []) {
      if (dist[c] !== d) continue;
      const x = c % n;
      const y = (c - x) / n;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= n || yy >= n) continue;
          const j = yy * n + xx;
          if (open[j] === 0 || (dx !== 0 && dy !== 0 && (open[y * n + xx] === 0 || open[yy * n + x] === 0))) continue;
          const nd = d + (dx !== 0 && dy !== 0 ? 14 : 10);
          if (nd >= dist[j]) continue;
          dist[j] = nd;
          (buckets[nd] ??= []).push(j);
        }
      }
    }
  }
  return dist[b] >= 1 << 30 ? -1 : dist[b] / 10;
}

/** w5 of a map: 9 when no way that wide joins the main cities. */
export function funnel(m: Map): number {
  const n = m.size;
  const open = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) open[i] = walkableTerrain(m.terrain[i]) ? 1 : 0;
  const clear = clearance(n, open);
  // By home everything counts as open: what is measured is the way between.
  const home = (w: Uint8Array) => {
    for (const s of m.spawns) {
      for (let y = Math.max(0, s.cellY - 6); y < Math.min(n, s.cellY + 6); y++) {
        for (let x = Math.max(0, s.cellX - 6); x < Math.min(n, s.cellX + 6); x++) if (open[y * n + x] === 1) w[y * n + x] = 1;
      }
    }
  };
  const [a, b] = m.spawns.map((s) => s.cellY * n + s.cellX);
  const foot = open.slice();
  home(foot);
  const wide = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) if (clear[i] >= CLEAR) wide[i] = 1;
  home(wide);
  const base = walk(n, foot, a, b);
  const column = walk(n, wide, a, b);
  return column < 0 ? 9 : Math.round((column / base) * 100) / 100;
}

function main(): void {
  const at = process.argv.indexOf("--maps");
  const maps = at >= 0 ? Number(process.argv[at + 1]) : 300;
  const rows: { layout: string; w5: number }[] = [];
  for (let seed = 1; seed <= maps; seed++) {
    const m = generateRandomMap(seed);
    rows.push({ layout: m.layout, w5: funnel(m) });
  }
  const med = (l: number[]) => [...l].sort((x, y) => x - y)[l.length >> 1] ?? 0;
  const out = ["### 地圖的關口（5 格寬的大軍要繞多遠）", "", `雙河關 ${funnel(twinRiversMap(2)).toFixed(2)} 倍。隨機地圖 1–${maps}：`, "", `| 出生 | 地圖 | 中位數 | ≥ ${GOAL.toFixed(2)} 的地圖 |`, "|---|---|---|---|"];
  for (const [layout, name] of [["diagonal", "對角"], ["adjacent", "相鄰"]]) {
    const v = rows.filter((r) => r.layout === layout).map((r) => r.w5);
    const hit = v.filter((x) => x >= GOAL).length;
    out.push(`| ${name} | ${v.length} | ${med(v).toFixed(2)} | ${hit}（${Math.round((hit * 100) / Math.max(1, v.length))}%） |`);
  }
  console.log(out.join("\n"));
}

if (import.meta.main) main();
