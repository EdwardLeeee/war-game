// 上城牆 (D-096, PROTOCOL.md 3.7; the user 2026-10-21: 城牆「雞肋」): our ranged units and mages stand
// on the walls of a town we hold, one to a wall cell; 下城牆 brings them down. What the tap means,
// and how many stand on a town's wall, for the panels. Pure, for the unit tests.

import { type CommandBody, Order, TownState, UnitType } from "../sim.ts";

export const WALL_PROMPT = "點自己持有的城鎮：遠程兵和法師站上城牆";
export const WALL_PROMPT_MIXED = "點自己持有的城鎮：只有遠程兵和法師會站上城牆";
export const WALL_WRONG_TARGET = "要點自己持有的城鎮（攻下、搶、修繕或治理中）";
export const WALL_NOBODY = "只有遠程兵和法師能站上城牆";
export const WALL_FULL = "城牆上沒有空位了";

/** Who may go up (the simulation's own rule): ranged units and mages. */
export const goesOnWalls = (type: number): boolean => type === UnitType.Ranged || type === UnitType.Mage;

/** A town we hold for 上城牆: ours, and taken, plundered, being repaired or governed. */
export function heldTown(owner: number, state: number, me: number): boolean {
  return owner === me && (state === TownState.AwaitingChoice || state === TownState.Plundering || state === TownState.Repairing || state === TownState.Governed);
}

/**
 * 上城牆's tap on a town (null: no town there): the order, or why not. `onWall`: how many of ours
 * stand there or are on their way; `capacity`: its wall cells.
 */
export function wallTap(
  units: readonly number[],
  town: { id: number; held: boolean; onWall: number; capacity: number } | null,
  canGo: (id: number) => boolean,
): { cmd: CommandBody } | { error: string } {
  if (town === null) return { error: WALL_WRONG_TARGET };
  if (!town.held) return { error: "不是你攻下的城鎮" };
  const u = units.filter(canGo);
  if (u.length === 0) return { error: WALL_NOBODY };
  if (town.onWall >= town.capacity) return { error: WALL_FULL };
  return { cmd: { c: "wall", u, town: town.id } };
}

/** 下城牆: one order a town for those of ours on (or going up) its wall, in town order. */
export function leaveWalls(units: readonly { id: number; order: number; town: number }[]): CommandBody[] {
  const by = new Map<number, number[]>();
  for (const u of units) if (u.order === Order.Wall) by.set(u.town, [...(by.get(u.town) ?? []), u.id]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([town, u]) => ({ c: "leave_wall", u, town }));
}
