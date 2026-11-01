// 駐軍 (the user 2026-10-25: 「我覺得駐軍也可以駐軍再佔領的程式裡面」，「我是指說軍團選項，可以駐軍在都市
// 裡面」; 2026-10-31: 「把兵團整個收縮到選擇的那個城鎮裡面」; ceo's spec): the soldiers selected and the
// rest of their groups (those in no group: only the ones selected) go into a town we hold and stay
// as its 留守, the same list as the one 攻下's − N + sets (D-026, D-084): not in 全軍 or 全軍撤退, but
// still their groups' (the user 2026-10-26: 「我把兵團駐守在這座城池裡面，那我當然可以再把它抽回來」):
// 出城歸隊 brings them back, and an order from the group's button takes them out, the town keeping
// the least it needs. They guard it (`guard`, PROTOCOL.md 3.7; the user 2026-10-31: 「敵軍打過來我們要
// 反擊但不會追出城鎮」): the simulation walks them in and sends the ranged and the mages up on its
// walls. What the tap means. Pure, for the unit tests.

import { WALL_WRONG_TARGET } from "./walls.ts";

export const STATION_PROMPT = "點自己持有的城鎮：選的兵連同整個編隊走進去留守";
export const STATION_PROMPT_MIXED = "點自己持有的城鎮：選的兵連同整個編隊走進去留守（村民不去）";
/** 駐軍 on the town they all stay in already. */
export const STATION_HERE = "他們已經駐守在這座城";
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
