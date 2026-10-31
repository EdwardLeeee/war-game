// How much the terrain of random maps funnels an army (the user 2026-10-31: 「有好幾個地形關口」). For maps 1-N, by layout:
// w5, the way between the main cities for a column 5 cells wide over the shortest way on foot (trees do not count, they
// get cut; random-map.ts columnWalks), and whether a column 3 wide gets through at all. 雙河關 has 1.76; the generator
// keeps to WAY's band while it can (ceo 2026-10-31: 60% of each layout in it, at most 20% with no way 5 wide, none with
// no way 3 wide).
//   node src/map-gaps.ts [--maps 300]
// Prints Markdown. Reports only, no threshold.

import { columnWalks, generateRandomMap, WAY } from "./core/random-map.ts";
import { twinRiversMap } from "./core/twin-rivers.ts";
import { walkableTerrain } from "./protocol.ts";

type Map = ReturnType<typeof generateRandomMap>;

/** w5 of a map (9: no way that wide), and whether a way 3 wide joins the main cities. */
export function funnel(m: Map): { w5: number; three: boolean } {
  const n = m.size;
  const blocked = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) blocked[i] = walkableTerrain(m.terrain[i]) ? 0 : 1;
  const way = columnWalks(n, blocked, m.spawns.map((s) => ({ x: s.cellX, y: s.cellY })));
  return { w5: way.five < 0 ? 9 : Math.round((way.five / way.foot) * 100) / 100, three: way.three >= 0 };
}

function main(): void {
  const at = process.argv.indexOf("--maps");
  const maps = at >= 0 ? Number(process.argv[at + 1]) : 300;
  const rows: { layout: string; w5: number; three: boolean }[] = [];
  for (let seed = 1; seed <= maps; seed++) {
    const m = generateRandomMap(seed);
    rows.push({ layout: m.layout, ...funnel(m) });
  }
  const med = (l: number[]) => [...l].sort((x, y) => x - y)[l.length >> 1] ?? 0;
  const lo = WAY.min / 100;
  const hi = WAY.max / 100;
  const out = ["### 地圖的關口（5 格寬的大軍要繞多遠）", "", `雙河關 ${funnel(twinRiversMap(2)).w5.toFixed(2)} 倍。隨機地圖 1–${maps}：`, "", `| 出生 | 地圖 | 中位數 | 低於 ${lo.toFixed(2)} | ${lo.toFixed(2)}–${hi.toFixed(2)} | 高於 ${hi.toFixed(2)}，還過得去 | 5 格寬過不去 | 3 格寬過不去 |`, "|---|---|---|---|---|---|---|---|"];
  for (const [layout, name] of [["diagonal", "對角"], ["adjacent", "相鄰"]]) {
    const r = rows.filter((x) => x.layout === layout);
    const v = r.map((x) => x.w5);
    const pct = (k: number) => `${k}（${Math.round((k * 100) / Math.max(1, v.length))}%）`;
    out.push(`| ${name} | ${v.length} | ${med(v).toFixed(2)} | ${pct(v.filter((x) => x < lo).length)} | ${pct(v.filter((x) => x >= lo && x <= hi).length)} | ${pct(v.filter((x) => x > hi && x < 9).length)} | ${pct(v.filter((x) => x === 9).length)} | ${pct(r.filter((x) => !x.three).length)} |`);
  }
  console.log(out.join("\n"));
}

if (import.meta.main) main();
