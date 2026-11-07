// Page options read from the URL. Only `?test=1` (CI and debugging) unlocks the test hook,
// tick rates beyond the three game speeds and the fake world; players never see them.

import type { Culture } from "./art/spec.ts";
import { CULTURES } from "./culture.ts";
import { type ArtVariantId, artVariant } from "./lab/art-measure.ts";
import { MAP_MODES, type MapMode } from "./sim.ts";

/**
 * Ticks per second for 慢, 正常, 快 (D-024: the old 1x, 1.5x and 2x; the user found the old
 * 1.5x the right normal speed). Rules count game time at 20 ticks per second.
 */
export const SPEED_TPS = { slow: 20, normal: 30, fast: 40 } as const;

/** Highest tick rate `?tps=` may ask for, test pages only. */
export const MAX_TEST_TPS = 400;

export interface PageParams {
  /** `?test=1`: expose window.__proto for Playwright. */
  test: boolean;
  /** `?test=1&tps=N`: run the simulation at N ticks per second instead of the chosen speed. */
  tps: number | null;
  /** `?test=1&mock=1`: the fake world (mock/) instead of the simulation, for the gesture tests. */
  mock: boolean;
  /**
   * `?test=1&mock=1&r7=1`: the fake world with round 7's rules switched on (D-061: 城鎮只能搶一次,
   * 箭樓, 躲進建築), which the simulation has behind switches the page cannot reach.
   */
  round7: boolean;
  /** `?test=1&scenario=e2e|perf|perf200|perf360|standard|wallshift`: start that scenario (sim/PROTOCOL.md section 8; wallshift: D-119's recording). */
  scenario: "standard" | "e2e" | "perf" | "perf200" | "perf360" | "wallshift" | null;
  /**
   * The opponent is played by the computer. `?test=1&ai=0` turns it off (its units stand still),
   * so the main-flow e2e does not race it for the small town; the AI is tested by core's games.
   */
  enemyAi: boolean;
  /**
   * 開局提示 (D-044) at the start of each game. Test pages leave it out unless they ask
   * (`?test=1&hint=1`), so the other tests start straight on the battlefield.
   */
  hint: boolean;
  /**
   * `?test=1&logs=<url>`: game records (D-056) go to this URL instead of the Worker's, so the
   * e2e can catch them. Only http(s) URLs.
   */
  logsUrl: string | null;
  /** `?test=1&map=fixed|random`: this map instead of the start screen's choice (D-074). */
  map: MapMode | null;
  /**
   * `?test=1&watch=1`: the computer plays both sides and the page watches, seeing everything
   * (human null; the only way onto a random map until the AI scouts, D-074).
   */
  watch: boolean;
  /**
   * `?test=1&seed=N` (1 to 2^31 - 1): the game's seed instead of a new one, so a test plays the
   * same map each run (a random map comes from the seed, D-074).
   */
  seed: number | null;
  /** `?test=1&mock=1&outpost=1`: the fake world with outposts on (D-080) along with round 7's rules. */
  outpost: boolean;
  /** `?test=1&mock=1&outpost=1&hide=1`: the 3 × 3 outpost its spearmen hide in and poke out of (D-119, features.outpostHide). */
  outpostHide: boolean;
  /** `?test=1&mock=1&walls=1`: the fake world with D-096's gates and walls on (a gate in each opening, 上城牆). */
  walls: boolean;
  /** `?test=1&mock=1&siege=1`: the fake world with D-099's siege engines and works on (features.siege). */
  siege: boolean;
  /** `?test=1&mock=1&keep=1`: the fake world with D-100's bigger towns and their keeps (features.keep). */
  keep: boolean;
  /** `?test=1&mock=1&market=1`: the fake world with D-101's market on (features.market). */
  market: boolean;
  /** `?test=1&mock=1&mine=1`: the fake world with two mines of ours, a crystal vein by one (the mine's 晶 row). */
  mine: boolean;
  /**
   * `?test=1&art=test|x3|x2|off`: the units' atlases (D-085) instead of the 量測 panel's choice;
   * `test` the stand-ins scripts/make-test-atlas.ts makes, for the e2e tests.
   */
  art: "test" | "x3" | "x2" | "off" | null;
  /** `?test=1&culture=e|w`: 你的陸 instead of the start screen's choice (art/spec.ts cultureOf). */
  culture: Culture | null;
  /**
   * The fake world as a gallery of the atlases (D-085). `?test=1&mock=1&gallery=1`: each unit
   * type in each action, ours and the enemy's, the mages' shields, the farmers at work, militia.
   * `gallery=b`: each building in each state (construction, done, damaged, rubble), both
   * cultures, and the nodes, on a map of their own.
   */
  gallery: "units" | "buildings" | null;
  /** `?test=1&view=diamond|oblique|top`: how the ground lies instead of the default (camera/projection.ts; D-088). */
  view: "diamond" | "oblique" | "top" | null;
  /** `?test=1&ui=r6|proto`: 正式介面 (R6) on or off instead of its default (ui/formal.ts). */
  ui: "r6" | "proto" | null;
  /**
   * `?test=1&loadtimes=1`: where starting a game spends its time (D-091: download, decode, the
   * simulation starting, the first frame), on the screen while it loads and after; the user's
   * iPhone screenshot. The 量測 panel and the console have them on any test page.
   */
  loadTimes: boolean;
  /** `?test=1&ghost=outline`: units behind a castle's wall drawn as their rims only, instead of whole (D-089, for ceo to compare). */
  ghost: "outline" | null;
  /**
   * 寫實地面 (D-093), blended on the GPU from the art's ground set instead of the two greens: the
   * players' always (art-v6.1 on, ceo 2026-10-25: realistic buildings on the green grid looked a
   * prototype); a test page's only with `?test=1&ground=real` (its other tests keep the greens).
   * `&groundq=low`: one sample a texture instead of two (the iPhone's cost, ceo 2026-10-21).
   */
  ground: "real" | null;
  groundQuality: "high" | "low";
  /** `?test=1&edge=1`: 浮空大陸's edge (R11, render/edge.ts) with the diamond, before the art says so (art-release.json's view). */
  edge: boolean;
  /** `?tex=png|astc`: 貼圖 (D-128) instead of the 量測 panel's choice; any page (only the picture). */
  tex: "png" | "astc" | null;
  /**
   * `?measure=x3-astc|x2-png|x3-png`: art-v7 量測 (D-128, lab/art-measure.ts): the page opens
   * straight into that measurement, as the 量測 panel's buttons open it; any page (the user's iPhone).
   */
  measure: ArtVariantId | null;
  /** `?test=1&measures=N`: that measurement N seconds long instead of 10 minutes (the e2e tests). */
  measureSeconds: number | null;
  /** `?test=1&artlab=1`: the game drawn from art-lab.lock.json's Release (art-v7.1: R9's ground, the diamond), not art.lock.json's. */
  artLab: boolean;
  /**
   * 戰場像素比 (battlefield-res.ts; the user 2026-11-07): the battlefield at no more than 2, the interface
   * at the device's. `?test=1&res=device`: at the device's, to compare; the 量測 panel's row sets it too.
   */
  res: 2 | "device";
  /**
   * 地面快取 (render/ground-cache.ts; ceo b2 2026-11-07): the land from a picture of the screen while the
   * camera stands still; on unless `?test=1&gcache=0` (the 量測 panel's 地面快取 row sets it too).
   */
  groundCache: boolean;
}

export function parseParams(search: string): PageParams {
  const q = new URLSearchParams(search);
  const test = q.get("test") === "1";
  let tps: number | null = null;
  const raw = q.get("tps");
  if (test && raw !== null && /^[1-9][0-9]*$/.test(raw)) {
    tps = Math.min(Number(raw), MAX_TEST_TPS);
  }
  const sc = q.get("scenario");
  const scenario = test && (sc === "standard" || sc === "e2e" || sc === "perf" || sc === "perf200" || sc === "perf360" || sc === "wallshift") ? sc : null;
  const logs = q.get("logs");
  const logsUrl = test && logs !== null && /^https?:\/\/[^\s]+$/.test(logs) ? logs : null;
  const m = q.get("map");
  const map = test ? (MAP_MODES.find((v) => v === m) ?? null) : null;
  const s = q.get("seed");
  const seed = test && s !== null && /^[1-9][0-9]{0,9}$/.test(s) && Number(s) <= 0x7fffffff ? Number(s) : null;
  const a = q.get("art");
  const art = test && (a === "test" || a === "x3" || a === "x2" || a === "off") ? a : null;
  const c = q.get("culture");
  const culture = test ? (CULTURES.find((v) => v === c) ?? null) : null;
  const g = test && q.get("mock") === "1" ? q.get("gallery") : null;
  const gallery = g === "1" ? "units" : g === "b" ? "buildings" : null;
  const v = q.get("view");
  const view = test && (v === "diamond" || v === "oblique" || v === "top") ? v : null;
  const ghost = test && q.get("ghost") === "outline" ? "outline" : null;
  const u = q.get("ui");
  const ui = test && (u === "r6" || u === "proto") ? u : null;
  const t = q.get("tex");
  const tex = t === "png" || t === "astc" ? t : null;
  const measure = artVariant(q.get("measure"))?.id ?? null;
  const ms = q.get("measures");
  const measureSeconds = test && ms !== null && /^[1-9][0-9]{0,3}$/.test(ms) ? Number(ms) : null;
  return { test, tps, mock: test && q.get("mock") === "1", round7: test && q.get("r7") === "1", scenario, enemyAi: !(test && q.get("ai") === "0"), hint: !test || q.get("hint") === "1", logsUrl, map, watch: test && q.get("watch") === "1", seed, outpost: test && q.get("mock") === "1" && q.get("outpost") === "1", outpostHide: test && q.get("mock") === "1" && q.get("outpost") === "1" && q.get("hide") === "1", walls: test && q.get("mock") === "1" && q.get("walls") === "1", siege: test && q.get("mock") === "1" && q.get("siege") === "1", keep: test && q.get("mock") === "1" && q.get("keep") === "1", market: test && q.get("mock") === "1" && q.get("market") === "1", mine: test && q.get("mock") === "1" && q.get("mine") === "1", art, culture, gallery, ui, view, ghost, loadTimes: test && q.get("loadtimes") === "1", ground: !test || q.get("ground") === "real" ? "real" : null, groundQuality: q.get("groundq") === "low" ? "low" : "high", edge: test && q.get("edge") === "1", tex, measure, measureSeconds, artLab: test && q.get("artlab") === "1", res: test && q.get("res") === "device" ? "device" : 2, groundCache: !(test && q.get("gcache") === "0") };
}
