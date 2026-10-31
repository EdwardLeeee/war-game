// Walls (D-096, PROTOCOL.md 3.7; the user 2026-10-21: 城牆「雞肋」): our ranged units and mages stand
// on the walls of a town we hold, one to a wall cell: those of its 留守 go up by themselves
// (station.ts; the user 2026-10-31: 「上城牆那個可以拿掉了」). Pure, for the unit tests.

import { type CommandBody, Order, TownState, UnitType } from "../sim.ts";

export const WALL_WRONG_TARGET = "要點自己持有的城鎮（攻下、搶、修繕或治理中）";

/** Who may go up (the simulation's own rule): ranged units and mages. */
export const goesOnWalls = (type: number): boolean => type === UnitType.Ranged || type === UnitType.Mage;

/** A town we hold: ours, and taken, plundered, being repaired or governed. */
export function heldTown(owner: number, state: number, me: number): boolean {
  return owner === me && (state === TownState.AwaitingChoice || state === TownState.Plundering || state === TownState.Repairing || state === TownState.Governed);
}

/** Those no longer 留守 come down: one order a town for those of ours on (or going up) its wall, in town order. */
export function leaveWalls(units: readonly { id: number; order: number; town: number }[]): CommandBody[] {
  const by = new Map<number, number[]>();
  for (const u of units) if (u.order === Order.Wall) by.set(u.town, [...(by.get(u.town) ?? []), u.id]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([town, u]) => ({ c: "leave_wall", u, town }));
}
