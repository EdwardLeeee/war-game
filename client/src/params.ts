// Page options read from the URL. Only `?test=1` (CI and debugging) unlocks the test hook,
// tick rates beyond the three game speeds and the fake world; players never see them.

import type { Culture } from "./art/spec.ts";
import { CULTURES } from "./culture.ts";
import type { MapMode } from "./sim.ts";

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
  /** `?test=1&scenario=e2e|perf|perf200|perf360|standard`: start that scenario (sim/PROTOCOL.md section 8). */
  scenario: "standard" | "e2e" | "perf" | "perf200" | "perf360" | null;
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
  /** `?test=1&ghost=outline`: units behind a castle's wall drawn as their rims only, instead of whole (D-089, for ceo to compare). */
  ghost: "outline" | null;
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
  const scenario = test && (sc === "standard" || sc === "e2e" || sc === "perf" || sc === "perf200" || sc === "perf360") ? sc : null;
  const logs = q.get("logs");
  const logsUrl = test && logs !== null && /^https?:\/\/[^\s]+$/.test(logs) ? logs : null;
  const m = q.get("map");
  const map = test && (m === "fixed" || m === "random") ? m : null;
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
  return { test, tps, mock: test && q.get("mock") === "1", round7: test && q.get("r7") === "1", scenario, enemyAi: !(test && q.get("ai") === "0"), hint: !test || q.get("hint") === "1", logsUrl, map, watch: test && q.get("watch") === "1", seed, outpost: test && q.get("mock") === "1" && q.get("outpost") === "1", mine: test && q.get("mock") === "1" && q.get("mine") === "1", art, culture, gallery, ui, view, ghost };
}
