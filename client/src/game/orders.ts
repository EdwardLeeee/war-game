// 進攻／撤退／堅守 (D-050), and 待命: which one a soldier is in, for the buttons that light up,
// the 「目前：」 line and 取消即堅守 (D-054: a second tap on 進攻 or 撤退 while they do it stops
// them and holds). Read from the snapshot: the order and the stance.

import { Order, Stance } from "../sim.ts";
import { isSoldier } from "./army.ts";

/** `garrison`: going to hide in a building or hiding there (round 7, D-061). */
export type OrderState = "advance" | "retreat" | "hold" | "idle" | "garrison";

export interface OrderWorld {
  unitType(id: number): number;
  unitStance(id: number): number;
  /** Order, -1 for a unit not in the snapshot. */
  unitOrder(id: number): number;
}

/**
 * 躲在建築裡 while it goes to hide or hides (round 7); 撤退中 while it carries a retreat order;
 * 堅守 when it holds; 進攻中 while it advances, attacks or casts; else 待命 (standing, 積極: it
 * goes for enemies near it, and its squad with it).
 */
export function orderState(w: OrderWorld, id: number): OrderState {
  const order = w.unitOrder(id);
  if (order === Order.Garrison) return "garrison";
  if (order === Order.Retreat) return "retreat";
  if (w.unitStance(id) === Stance.Hold) return "hold";
  return order === Order.Move || order === Order.Attack || order === Order.Cast ? "advance" : "idle";
}

/** How many of the soldiers among these units are in each state; null when there is no soldier. */
export function orderCounts(w: OrderWorld, ids: number[]): Record<OrderState, number> | null {
  const soldiers = ids.filter((id) => isSoldier(w.unitType(id)));
  if (soldiers.length === 0) return null;
  const counts: Record<OrderState, number> = { advance: 0, retreat: 0, hold: 0, idle: 0, garrison: 0 };
  for (const id of soldiers) counts[orderState(w, id)]++;
  return counts;
}

/**
 * Every soldier among these units is in this state (and there is one). Those hiding in a
 * building are left out: orders to many skip them (ceo 2026-10-07), so a group advancing with
 * some of it hiding still reads 取消進攻.
 */
export function allIn(w: OrderWorld, ids: number[], state: OrderState): boolean {
  const counts = orderCounts(w, ids);
  if (counts === null || counts[state] === 0) return false;
  return counts[state] === Object.values(counts).reduce((a, b) => a + b, 0) - (state === "garrison" ? 0 : counts.garrison);
}
