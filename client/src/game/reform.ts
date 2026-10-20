// 整理隊形 (D-095; the user 2026-10-21: 「常常跑一跑法師就跑到前排，我們可以有一個整理隊形按鈕嗎？」,
// 「有時候我沒看到敵人也會整理隊形，這個也要考慮」): which way the soldiers face as they re-form,
// in the order ceo and the user chose:
//   1. the nearest enemy in sight;
//   2. else where an enemy was last seen, in the last 60 s of game time;
//   3. else the way these soldiers were last sent (移動 or 攻擊);
//   4. else the enemy's main city, if this side has seen it (ceo: no peeking into the fog);
//   5. else the way they face now (null: the simulation's own re-forming in place keeps it).
// The game then walks them one cell that way (game.ts reform()): the simulation lays a formation
// out facing the way it walks, spearmen in front, ranged next, mages last. Cells; pure, for the
// unit tests.

export interface Spot {
  x: number;
  y: number;
}

/** Where an enemy was seen, and when (ticks). */
export interface Sighting extends Spot {
  tick: number;
}

/** How long a sighting counts (game time: 60 s at 20 ticks a second). */
export const SIGHTING_TICKS = 60 * 20;

export type FacingFrom = "enemy" | "seen" | "last" | "city" | "keep";

const nearest = (from: Spot, spots: readonly Spot[]): Spot | null => {
  let best: Spot | null = null;
  let bestD = Infinity;
  for (const s of spots) {
    const d = (s.x - from.x) ** 2 + (s.y - from.y) ** 2;
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
};

const unit = (dx: number, dy: number): Spot | null => {
  const l = Math.hypot(dx, dy);
  return l < 1e-6 ? null : { x: dx / l, y: dy / l };
};

/**
 * The way to face from `centre`, and what it came from. `inSight`: enemies seen now;
 * `sightings`: those seen before; `last`: the way these soldiers were last sent; `city`: the
 * enemy's main city as this side knows it, or null.
 */
export function reformFacing(
  centre: Spot,
  inSight: readonly Spot[],
  sightings: readonly Sighting[],
  tick: number,
  last: Spot | null,
  city: Spot | null,
): { dir: Spot | null; from: FacingFrom } {
  const near = nearest(centre, inSight);
  const toNear = near === null ? null : unit(near.x - centre.x, near.y - centre.y);
  if (toNear !== null) return { dir: toNear, from: "enemy" };
  const seen = nearest(
    centre,
    sightings.filter((s) => tick - s.tick <= SIGHTING_TICKS),
  );
  const toSeen = seen === null ? null : unit(seen.x - centre.x, seen.y - centre.y);
  if (toSeen !== null) return { dir: toSeen, from: "seen" };
  const lastDir = last === null ? null : unit(last.x, last.y);
  if (lastDir !== null) return { dir: lastDir, from: "last" };
  const toCity = city === null ? null : unit(city.x - centre.x, city.y - centre.y);
  if (toCity !== null) return { dir: toCity, from: "city" };
  return { dir: null, from: "keep" };
}

/** The cell a cell ahead of the centre that way: where the formation's front row forms up. */
export function reformCell(centre: Spot, dir: Spot): Spot {
  return { x: Math.floor(centre.x + dir.x), y: Math.floor(centre.y + dir.y) };
}
