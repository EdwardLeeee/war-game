// Page options read from the URL. Only `?test=1` (CI and debugging) unlocks the test hook,
// tick rates beyond the three game speeds and the fake world; players never see them.

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
  /** `?test=1&scenario=e2e|perf|standard`: start that scenario (sim/PROTOCOL.md section 8). */
  scenario: "standard" | "e2e" | "perf" | null;
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
  const scenario = test && (sc === "standard" || sc === "e2e" || sc === "perf") ? sc : null;
  return { test, tps, mock: test && q.get("mock") === "1", scenario };
}
