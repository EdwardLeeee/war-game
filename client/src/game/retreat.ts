// 退 and 全軍撤退 back to a town (D-138 A; the user 2026-11-10: 「軍團按退守應該要會退到上一座它駐守的城市」, and chose):
// a group goes back to the town it last left soldiers in while that is ours (governed or being repaired); else to the
// nearest town of ours from where the group is; with none, to the main city as before. Pure, for the unit tests;
// game.ts sends them and stations them there once they are in (as 進駐 does).

/** A town of ours a group may fall back to (cells). */
export interface OwnTown {
  id: number;
  cellX: number;
  cellY: number;
}

/**
 * Where a group falls back: its last town when that is one of `own`; else the nearest of `own` from `from` (cells; on a
 * tie the lower id); null: none (the main city). `from` null (nobody to measure from): the lowest id of `own`.
 */
export function retreatTown(last: number | null, own: readonly OwnTown[], from: { x: number; y: number } | null): number | null {
  if (last !== null && own.some((t) => t.id === last)) return last;
  let best: OwnTown | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const t of own) {
    const d = from === null ? 0 : (t.cellX + 0.5 - from.x) ** 2 + (t.cellY + 0.5 - from.y) ** 2;
    if (d < bestD || (d === bestD && best !== null && t.id < best.id)) {
      best = t;
      bestD = d;
    }
  }
  return best?.id ?? null;
}
