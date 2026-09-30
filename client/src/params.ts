// Page options read from the URL. Only `?test=1` (CI and debugging) unlocks the test hook,
// tick rates beyond the three game speeds and the fake world; players never see them.

/** Ticks per second for 慢, 正常, 快 (0.75x, 1x, 1.5x of 20; ceo 2026-09-30). */
export const SPEED_TPS = { slow: 15, normal: 20, fast: 30 } as const;

/** Highest tick rate `?tps=` may ask for, test pages only. */
export const MAX_TEST_TPS = 400;

export interface PageParams {
  /** `?test=1`: expose window.__proto for Playwright. */
  test: boolean;
  /** `?test=1&tps=N`: run the simulation at N ticks per second instead of the chosen speed. */
  tps: number | null;
  /** `?test=1&mock=1`: the fake world (mock/) instead of the simulation, for the gesture tests. */
  mock: boolean;
}

export function parseParams(search: string): PageParams {
  const q = new URLSearchParams(search);
  const test = q.get("test") === "1";
  let tps: number | null = null;
  const raw = q.get("tps");
  if (test && raw !== null && /^[1-9][0-9]*$/.test(raw)) {
    tps = Math.min(Number(raw), MAX_TEST_TPS);
  }
  return { test, tps, mock: test && q.get("mock") === "1" };
}
