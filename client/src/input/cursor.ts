// 游標 (R26 05, design/r26/spec.md 05; ceo 2026-11-21): with a mouse, the battlefield's cursor is what the right button
// would do there now, read off the very orders it would give (Game.rightPlan, which Game.order carries out):
//   攻擊 (an enemy's or a neutral's unit or building, a gate, a town not ours) — a sword;
//   進駐 (someone would go into a place of ours) — a gate;
//   蓋、修 (farmers to a building of ours being built or hurt) — a hammer;
//   採集 (farmers to a tree, a mine, berries; or to farm a finished field of ours) — an axe;
//   anything else (walking there, nothing selected) — the arrow.
// Where two hold, sword > gate > hammer > axe (ceo 2026-11-21). Picking a place or placing a building: the arrow
// (Game.cursorAt). On the battlefield only; over the interface, the browser's own (style.css).

import type { Intent } from "./intent.ts";

export type CursorKind = "sword" | "gate" | "hammer" | "axe";
export const CURSOR_KINDS: readonly CursorKind[] = ["sword", "gate", "hammer", "axe"];

/**
 * The cursor for the right button's orders (`orders`; `enters`: someone goes into a place of ours); null: the arrow.
 * `farmed`: a building farmers sent to farm, not build or repair (a finished field: the sim's `repair` there is farming).
 */
export function cursorFor(orders: readonly Intent[], enters: boolean, farmed: (building: number) => boolean = () => false): CursorKind | null {
  const has = (c: string) => orders.some((i) => i.kind === "command" && i.cmd.c === c);
  if (has("attack") || orders.some((i) => i.kind === "townAttack")) return "sword";
  if (enters) return "gate";
  const repairs = orders.flatMap((i) => (i.kind === "command" && i.cmd.c === "repair" ? [i.cmd.building] : []));
  if (repairs.some((b) => !farmed(b))) return "hammer";
  if (has("gather") || repairs.length > 0) return "axe";
  return null;
}
