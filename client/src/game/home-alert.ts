// 主城被打的警示 (D-141; the user 2026-11-11: 「我覺得沒有必要 有提示可以了」, no 回防 button): the enemy's soldiers the
// screen sees within HOME_CELLS of our main city, before they hit it, said on the strip: 「敵軍 N 名接近主城」, again 30 s
// later while they are still there or when 5 more have come. In the player's games enemies were that near a median 24 s
// before the main city was first hit (3.8–51 s; client's replay, review/r17), and it then fell in about 14 s (about 35 s
// once 2.5 times as strong); the army needs 38–57 s home. Pure, for the unit tests.

import { NEUTRAL, NO_OWNER, UnitType } from "../sim.ts";
import { nearFootprint } from "./auto-house.ts";

/** Said again after this long while some are still near (ms). */
export const HOME_NEAR_AGAIN_MS = 30_000;
/** Said again at once when this many more have come than were said. */
export const HOME_NEAR_MORE = 5;
/** Nobody near this long: the next who come are a new approach, said at once (ms; one stepping in and out is not). */
export const HOME_NEAR_CALM_MS = 10_000;

export const homeNearText = (n: number): string => `敵軍 ${n} 名接近主城`;

/** A unit as the snapshot has it: owner, type, where (cells). */
export interface SeenUnit {
  owner: number;
  type: number;
  x: number;
  y: number;
}

/** The enemy's soldiers (players' only: not militia, not farmers) within `cells` of our main city's footprint. */
export function enemiesNearHome(units: readonly SeenUnit[], me: number, home: { x: number; y: number; w: number; h: number }, cells: number): number {
  let n = 0;
  for (const u of units) {
    if (u.owner === me || u.owner === NEUTRAL || u.owner === NO_OWNER || u.type === UnitType.Farmer) continue;
    if (nearFootprint(home, u.x, u.y, cells)) n++;
  }
  return n;
}

/** When to say 「敵軍 N 名接近主城」: what was said and when, nobody near since when. */
export class HomeNearAlert {
  private saidAt = Number.NEGATIVE_INFINITY;
  private saidN = 0;
  private calmSince: number | null = null;

  /** `n` near now: the words to say, or null. */
  seen(n: number, now: number): string | null {
    if (n === 0) {
      this.calmSince ??= now;
      if (now - this.calmSince >= HOME_NEAR_CALM_MS) {
        this.saidAt = Number.NEGATIVE_INFINITY;
        this.saidN = 0;
      }
      return null;
    }
    this.calmSince = null;
    if (now - this.saidAt < HOME_NEAR_AGAIN_MS && n < this.saidN + HOME_NEAR_MORE) return null;
    this.saidAt = now;
    this.saidN = n;
    return homeNearText(n);
  }
}
