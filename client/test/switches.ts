// The simulation's switches the client's tests depend on: D-100's keeps (KEEP), D-099's siege
// engines (SIEGE), D-101's richer map (RICH) and market (MARKET). Core turns them on by default
// (the user 2026-10-29: 「整批照現在的進度直接上」); a test that needs them one way sets them
// itself, so that it passes with core's defaults either way, and puts them back after.

import { after, before } from "node:test";
import { KEEP, MARKET, RICH, SIEGE } from "../../sim/src/core/rules.ts";

export type Switches = Partial<Record<"keep" | "siege" | "rich" | "market", boolean>>;

const ALL = { keep: KEEP, siege: SIEGE, rich: RICH, market: MARKET } as const;

function apply(set: Switches): Switches {
  const was: Switches = {};
  for (const k of Object.keys(set) as (keyof Switches)[]) {
    was[k] = ALL[k].on;
    ALL[k].on = set[k] as boolean;
  }
  return was;
}

/** Runs `fn` with these switches set, then puts them back (after the promise, for an async `fn`). */
export function withSwitches<T>(set: Switches, fn: () => T): T {
  const was = apply(set);
  let async = false;
  try {
    const out = fn();
    if (out instanceof Promise) {
      async = true;
      return out.finally(() => apply(was)) as T;
    }
    return out;
  } finally {
    if (!async) apply(was);
  }
}

/** Every test of this file with these switches set (node:test's before and after). */
export function pinSwitches(set: Switches): void {
  let was: Switches = {};
  before(() => {
    was = apply(set);
  });
  after(() => {
    apply(was);
  });
}
