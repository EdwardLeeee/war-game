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

// --- ＋遠程／＋法師 (D-080, user 2026-10-09: 「箭塔應該是可以點擊然後把弓箭手或是法師放進去」) ----
// From our own arrow tower or main city: each tap calls one soldier of that type in with the
// same `garrison` command. Selecting soldiers, 躲進去 and tapping the building stays as it was.

/** Soldiers farther than this from the building (cells, to its footprint) are not called: those at the front stay there (ceo 2026-10-09). */
export const CALL_REACH = 30;

/** One own soldier as ＋遠程／＋法師 needs it (cells). */
export interface Callable {
  id: number;
  type: number;
  x: number;
  y: number;
  /** Standing with no order. */
  idle: boolean;
  /** Going to hide or hiding in a building already (isHiding). */
  hiding: boolean;
  /** Left in a town as its garrison (留守). */
  stationed: boolean;
}

/** Distance from a point to a building's footprint (cells; 0 inside it). */
function toFootprint(p: { x: number; y: number }, b: { cx: number; cy: number; size: number }): number {
  const dx = Math.max(b.cx - p.x, 0, p.x - (b.cx + b.size));
  const dy = Math.max(b.cy - p.y, 0, p.y - (b.cy + b.size));
  return Math.hypot(dx, dy);
}

/**
 * Whom ＋遠程 or ＋法師 calls in: of that type, not hiding anywhere, not stationed in a town,
 * within CALL_REACH; those standing with no order first, then the nearest (ties: lower id).
 * Null when nobody may come.
 */
export function pickToHide(units: readonly Callable[], type: number, building: { cx: number; cy: number; size: number }): number | null {
  const near = units
    .filter((u) => u.type === type && !u.hiding && !u.stationed)
    .map((u) => ({ u, d: toFootprint(u, building) }))
    .filter((e) => e.d <= CALL_REACH)
    .sort((a, b) => Number(b.u.idle) - Number(a.u.idle) || a.d - b.d || a.u.id - b.u.id);
  return near[0]?.u.id ?? null;
}

/** Why ＋遠程／＋法師 called nobody. */
export const callFullText = (building: string, holds: number): string => `${building}滿了（最多 ${holds} 名）`;
export const callNoneText = (unit: string): string => `${CALL_REACH} 格內沒有可以叫來的${unit}`;
