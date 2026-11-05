// art-v7 量測 (D-128, ceo 2026-11-05): before the game switches to art-v7, the user's iPhone runs a
// 360-unit game for 10 minutes with each of the ways it could draw art-v7 (art-lab.lock.json's
// Release beside the game's own): 3 倍 as ASTC 4×4 (the user's choice), 2 倍 as PNG (where there is
// no ASTC), 3 倍 as PNG (most likely to be too much: last, so that Safari is not lost on the first).
// Each on a page of its own (?measure=), so one's textures are gone before the next; a page reloaded
// in the middle (Safari out of memory) says on opening which one it was.

import type { TexChoice } from "../art/pref.ts";

export type ArtVariantId = "x3-astc" | "x2-png" | "x3-png";

export interface ArtVariant {
  id: ArtVariantId;
  scale: "x3" | "x2";
  tex: TexChoice;
  label: string;
}

/** In the order the buttons have (ceo: the likeliest to fail last). */
export const ART_VARIANTS: readonly ArtVariant[] = [
  { id: "x3-astc", scale: "x3", tex: "astc", label: "x3 ASTC" },
  { id: "x2-png", scale: "x2", tex: "png", label: "x2 PNG" },
  { id: "x3-png", scale: "x3", tex: "png", label: "x3 PNG" },
];

export const artVariant = (id: string | null): ArtVariant | null => ART_VARIANTS.find((v) => v.id === id) ?? null;

/** Each measured this long (after the 5-second warm-up), in the 360-unit game. */
export const ART_MEASURE_MS = 10 * 60_000;
export const ART_MEASURE_SCENARIO = "perf360";

/** Said above the buttons (ceo). */
export const ART_MEASURE_NOTE = "每種要下載 60–160 MB，請用 Wi‑Fi。各量 10 分鐘（雙方 360 人），量測時不要操作。量測中螢幕會保持亮著；如果還是暗了，先到設定把「自動鎖定」改成「永不」。";

/** What the textures of a game take, for the result (bytes). */
export interface ArtCost {
  /** The atlases' pages (units, effects, buildings, nodes, castle, terrain) and the edge's. */
  atlas: number;
  edge: number;
  /** The ground (always PNG: its A is height), apart, as ui's numbers leave it out. */
  ground: number;
  pages: number;
  astcPages: number;
}

const mb = (bytes: number) => (bytes / 2 ** 20).toFixed(1);

/**
 * The result box's rows for one variant: what was asked and what was drawn (a GPU without ASTC
 * draws 2 倍's PNGs instead, D-128), the textures' MB, whether the GPU has ASTC, and the browser.
 */
export function artMeasureRows(v: ArtVariant, drawn: string, cost: ArtCost, gpuAstc: boolean, userAgent: string): [string, string][] {
  return [
    ["art-v7 量測", `${v.label}（實際畫的：${drawn}）`],
    ["貼圖", `${mb(cost.atlas + cost.edge)} MB（${cost.pages} 頁，其中 ASTC ${cost.astcPages} 頁；邊緣 ${mb(cost.edge)} MB）`],
    ["地面", `${mb(cost.ground)} MB（PNG，另計）`],
    ["顯示卡有 ASTC", gpuAstc ? "有" : "沒有"],
    ["瀏覽器", userAgent],
  ];
}
