// 離民兵太近 (ceo, D-044 round 4): militia go for anyone who comes near their town, the farmers
// sent to build there included (they leave buildings alone). Placing a building that close
// warns, and ✓ still builds it.

import { TownState } from "../sim.ts";

/**
 * Cells from a building's centre to a town's centre within which its militia reach the farmers
 * building it: the distance core's AI keeps (`TOWN_CLEARANCE` in sim/src/ai/ai.ts, #87); core
 * moves it to rules.ts in round 4 PR B, and then this reads it from there.
 */
export const MILITIA_CLEARANCE = 12;

export const MILITIA_WARNING = "這裡離城鎮的民兵太近，去蓋的村民會被攻擊";

/** A town as we know it now: `state` null when never explored. */
export interface MilitiaTown {
  id: number;
  cellX: number;
  cellY: number;
  state: number | null;
  militia: number;
}

/**
 * Whether militia hold the town: neutral with militia left. A town taken by either side or in
 * ruins does not count; one never explored does, as every town starts that way.
 */
export function militiaHold(t: MilitiaTown): boolean {
  return t.state === null || (t.state === TownState.Neutral && t.militia > 0);
}

/**
 * The nearest town whose militia would reach the farmers building a footprint of `size` at
 * (cellX, cellY), or null. Measured as core's AI does: the footprint's centre to the town
 * cell's centre, `MILITIA_CLEARANCE` itself included.
 */
export function militiaTownNear<T extends MilitiaTown>(towns: readonly T[], cellX: number, cellY: number, size: number): T | null {
  let best: T | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of towns) {
    if (!militiaHold(t)) continue;
    // Doubled coordinates, so both centres are whole numbers.
    const dx = 2 * cellX + size - 2 * t.cellX - 1;
    const dy = 2 * cellY + size - 2 * t.cellY - 1;
    const d = dx * dx + dy * dy;
    if (d <= 4 * MILITIA_CLEARANCE * MILITIA_CLEARANCE && d < bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}
