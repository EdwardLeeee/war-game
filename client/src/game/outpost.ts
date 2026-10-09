// 哨所 (D-080, user 2026-10-09: 「可以建立哨所，就是放在地圖上然後可以駐步兵，有敵人靠近可以選擇
// 攻擊或是堅守，哨所附近可以蓋箭塔」; sim/PROTOCOL.md 3.4): spearmen stand guard around an outpost
// (`post`), which attacks or holds (`outpost_mode`); `unpost` sends them all off. Only while
// `rules.features.outpost` (features.ts). A soldier posted is like one left in a town (留守): no
// group drafts him, he leaves the group he was in, and orders to many (全軍、全軍撤退) leave him be.

import { BuildingType, type CommandBody, Order, type Rules, UnitType } from "../sim.ts";

/** The prompt while picking the outpost; mixed selections are told who goes. */
export const POST_PROMPT = "點自己的哨所：槍兵去駐守";
export const POST_PROMPT_MIXED = "點自己的哨所：只有槍兵會去駐守";
export const POST_WRONG_TARGET = "要點自己蓋好的哨所";

/** A spearman going to his post or standing guard (`order` Post, orderTarget the outpost). */
export const isPosted = (order: number): boolean => order === Order.Post;

/** What the tap needs to know about the building under the finger. */
export interface PostTarget {
  id: number;
  owner: number;
  type: number;
  /** progress >= 1000 */
  done: boolean;
}

/**
 * A tap on the battlefield while picking the outpost (駐守): the `post` command for the
 * spearmen selected, or why not. `isSpear(unit)`: it is a spearman.
 */
export function postTap(units: number[], target: PostTarget | null, me: number, isSpear: (id: number) => boolean): { cmd: CommandBody } | { error: string } {
  const u = units.filter(isSpear);
  if (u.length === 0) return { error: "只有槍兵能駐守" };
  if (target === null || target.owner !== me || !target.done || target.type !== BuildingType.Outpost) return { error: POST_WRONG_TARGET };
  return { cmd: { c: "post", u, building: target.id } };
}

/** The unit type ＋槍兵 calls (the protocol's: spearmen only). */
export const POST_TYPE = UnitType.Spearman;

/** The line under 攻擊／堅守: what the outpost does now, with this game's numbers (rules.outpost). */
export function outpostModeText(rules: Pick<Rules, "outpost">, hold: boolean): string {
  const o = rules.outpost;
  if (hold) return `堅守：站在哨所旁不動，只打走到身邊的；哨所或駐守的兵被打，就一起去打，追到 ${o?.chase ?? 0} 格就回來`;
  return `攻擊：敵兵進到哨所 ${o?.reach ?? 0} 格內就去打，追到 ${o?.chase ?? 0} 格就回來`;
}
