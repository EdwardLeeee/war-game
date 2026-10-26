// 駐軍 (the user 2026-10-25: 「我覺得駐軍也可以駐軍再佔領的程式裡面」，「我是指說軍團選項，可以駐軍在都市
// 裡面」; ceo's spec): the soldiers selected, a whole group too, go into a town we hold and stay as
// its 留守, the same list as the one 攻下's − N + sets (D-026, D-084): 堅守, not in 全軍, 全軍撤退 or
// their groups' buttons, but still their groups' (the user 2026-10-26: 「我把兵團駐守在這座城池裡面，
// 那我當然可以再把它抽回來」): 出城歸隊 brings them back. They walk in (移動); with walls on, the ranged
// and the mages go up on its walls once there. What the tap means. Pure, for the unit tests.

import { WALL_WRONG_TARGET } from "./walls.ts";

export const STATION_PROMPT = "點自己持有的城鎮：選的兵走進去留守";
export const STATION_PROMPT_MIXED = "點自己持有的城鎮：選的兵走進去留守（村民不去）";
export const STATION_WRONG_TARGET = WALL_WRONG_TARGET;
export const STATION_NOBODY = "選的裡面沒有兵：村民不能駐軍";
/** Fewer 留守 than a town repaired or governed needs (small 1, large 3): it counts down to revolt (sim/src/core/towns.ts). */
export const SHORT_GARRISON_TEXT = "駐軍不足，這座城會叛離";
/** Nobody left in a town being plundered: the plunder stops. */
export const SHORT_PLUNDER_TEXT = "城裡沒有兵，搶會停下來";

/** 駐軍's tap on a town (null: no town there): the soldiers who go, or why not. */
export function stationTap(units: readonly number[], town: { id: number; held: boolean } | null, soldier: (id: number) => boolean): { town: number; ids: number[] } | { error: string } {
  if (town === null) return { error: STATION_WRONG_TARGET };
  if (!town.held) return { error: "不是你攻下的城鎮" };
  const ids = units.filter(soldier);
  if (ids.length === 0) return { error: STATION_NOBODY };
  return { town: town.id, ids };
}

/**
 * Those of the walk who stand in the town now (inside its walls, no order left): the ones to send
 * up its walls (ranged and mages, walls on), at most as many places as are free.
 */
export function upOnArrival(arrived: readonly { id: number; climbs: boolean }[], free: number): number[] {
  return arrived
    .filter((a) => a.climbs)
    .map((a) => a.id)
    .slice(0, Math.max(0, free));
}
