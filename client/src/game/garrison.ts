// 躲進建築 (round 7, D-061; sim/PROTOCOL.md 3.3): ranged units and mages hide in an own
// finished main city or arrow tower and shoot from inside; 全部出來 lets them out. With the
// feature off nothing here shows (features.ts).

import { BuildingType, type CommandBody, Order } from "../sim.ts";

/** The prompt while picking the building; mixed selections are told who goes. */
export const GARRISON_PROMPT = "點自己的主城或箭樓：遠程兵和法師躲進去";
export const GARRISON_PROMPT_MIXED = "點自己的主城或箭樓：只有遠程兵和法師會躲進去";
export const GARRISON_WRONG_TARGET = "要點自己蓋好的主城或箭樓";

/** What the tap needs to know about the building under the finger. */
export interface GarrisonTarget {
  id: number;
  owner: number;
  type: number;
  /** progress >= 1000 */
  done: boolean;
}

/**
 * A tap on the battlefield while picking where to hide: the `garrison` command for the
 * selected units that can hide, or why not. `hides(unit)`: its type may hide; `holds(type)`:
 * soldiers that kind of building holds (0: none).
 */
export function garrisonTap(
  units: number[],
  target: GarrisonTarget | null,
  me: number,
  hides: (id: number) => boolean,
  holds: (type: number) => number,
): { cmd: CommandBody } | { error: string } {
  const u = units.filter(hides);
  if (u.length === 0) return { error: "只有遠程兵和法師能躲進去" };
  if (target === null || target.owner !== me || !target.done || holds(target.type) <= 0) return { error: GARRISON_WRONG_TARGET };
  return { cmd: { c: "garrison", u, building: target.id } };
}

/** Buildings a player can hide soldiers in (the simulation's `holds` says how many). */
export const GARRISON_BUILDINGS: readonly number[] = [BuildingType.MainCity, BuildingType.ArrowTower];

/**
 * A soldier going to hide or hiding (`order` Garrison): orders given to many at once (編隊、
 * 全軍) leave it where it is; only the building's 全部出來 lets it out (ceo 2026-10-07).
 */
export const isHiding = (order: number): boolean => order === Order.Garrison;
