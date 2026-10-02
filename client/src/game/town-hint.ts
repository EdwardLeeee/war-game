// 開局提示 (D-044): where crystal comes from and which town to go for. The user did not know
// that crystal comes from towns, nor where one was ("我附近都沒有精礦，為啥電腦都有法師？").
// The town is worked out from the map, so a small town core adds near each main city
// becomes the one shown without any change here.

import { TownSize } from "../sim.ts";

export interface TownSpot {
  id: number;
  size: number;
  cellX: number;
  cellY: number;
}

/** The town nearest the cell (its centre to the cell's centre); on a tie the lower id. */
export function nearestTown<T extends TownSpot>(towns: readonly T[], from: { cellX: number; cellY: number }): T | null {
  let best: T | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of towns) {
    const d = (t.cellX - from.cellX) ** 2 + (t.cellY - from.cellY) ** 2;
    if (d < bestD || (d === bestD && best !== null && t.id < best.id)) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/**
 * The town 開局提示 points at (ceo, D-044): the small town nearest the cell, so a new player is
 * not sent at a large town's militia and arrow tower even when it is nearer; the nearest town
 * only on a map without small ones. On a tie the lower id.
 */
export function hintTown<T extends TownSpot>(towns: readonly T[], from: { cellX: number; cellY: number }): T | null {
  return nearestTown(towns.filter((t) => t.size === TownSize.Small), from) ?? nearestTown(towns, from);
}

const DIRECTIONS = ["東", "東北", "北", "西北", "西", "西南", "南", "東南"] as const;

/** One of eight directions on the map as the player sees it (north is up, y grows downwards). */
export function compass(dx: number, dy: number): string {
  const turns = Math.atan2(-dy, dx) / (2 * Math.PI);
  return DIRECTIONS[(Math.round(turns * 8) + 8) % 8];
}

/** The hint's lines: where crystal comes from, what to do there, and where the town (`hintTown`) is. */
export function townHintLines(town: TownSpot, from: { cellX: number; cellY: number }): string[] {
  const dx = town.cellX - from.cellX;
  const dy = town.cellY - from.cellY;
  const where = `在主城的${compass(dx, dy)}方，約 ${Math.round(Math.hypot(dx, dy))} 格`;
  // A large town only on a map without small ones (hintTown).
  const which = town.size === TownSize.Large ? `離你的主城最近的是一座大城，${where}` : `離你的主城最近的小鎮${where}`;
  return [
    "法師要用魔晶。魔晶主要從城鎮來：帶兵打倒城裡的民兵，就能選「搶」或「治理」。",
    "搶：馬上拿到一筆糧、金和魔晶。治理：修好之後，每分鐘都有魔晶。",
    `${which}。小地圖上閃的圓圈就是它。`,
  ];
}
