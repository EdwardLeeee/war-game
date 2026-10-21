// 整理隊形 (D-095; the user 2026-10-21: 「常常跑一跑法師就跑到前排，我們可以有一個整理隊形按鈕嗎？」,
// 「有時候我沒看到敵人也會整理隊形，這個也要考慮」): which way the soldiers face as they re-form,
// in the order ceo and the user chose:
//   1. the nearest enemy in sight;
//   2. else where an enemy was last seen, in the last 60 s of game time;
//   3. else the way these soldiers were last sent (移動 or 攻擊);
//   4. else the enemy's main city, if this side has seen it (ceo: no peeking into the fog);
//   5. else the way they face now (null: the simulation's own re-forming in place keeps it).
// The game then has them re-form facing it (game.ts reform()), spearmen in front, ranged next,
// mages last: standing together (oneCluster), the simulation's re-forming in place with that
// `face` (D-095 B); farther apart, a walk of one cell that way, so they gather into one formation
// (ceo: 「整隊沒有排成一個」 is what the user minds). Not with an enemy near (enemyTooClose).
// Cells; pure, for the unit tests.

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

/**
 * No 整理隊形 with an enemy this close (cells) to any of the soldiers. Measured on the simulation
 * (docs/research/2026-10-formation-march.md): four enemy archers holding 4 to 6 cells off, the
 * re-forming group (a retreat: it does not fight back, about 4 s) lost 96 hp in 6 s where standing
 * lost 12 to 17; 7 cells off and more, nothing. An attack-move instead is no better: 6 cells off it
 * lost 96 too, and nearer it fights rather than forms. The line is a cell further than measured:
 * enemy mages' cannon reaches 7 cells, and enemies move.
 */
export const REFORM_CLEAR_CELLS = 8;

/** Whether an enemy in sight is within REFORM_CLEAR_CELLS of any of the soldiers. */
export function enemyTooClose(soldiers: readonly Spot[], inSight: readonly Spot[]): boolean {
  const r2 = REFORM_CLEAR_CELLS * REFORM_CLEAR_CELLS;
  return soldiers.some((s) => inSight.some((e) => (e.x - s.x) ** 2 + (e.y - s.y) ** 2 < r2));
}

/**
 * Units standing this close (cells), or linked through others, are re-formed in place as one
 * formation by the simulation when the formation command has a `face` (sim/src/core/commands.ts;
 * ceo 2026-10-21: 8 cells, enough for spearmen who went 6 cells after the enemy). Farther apart, the
 * game walks them together instead.
 */
export const REFORM_LINK_CELLS = 8;

/** Whether the soldiers stand as one lot: each linked to the others within REFORM_LINK_CELLS, through others if need be. */
export function oneCluster(spots: readonly Spot[]): boolean {
  if (spots.length === 0) return false;
  const r2 = REFORM_LINK_CELLS * REFORM_LINK_CELLS;
  const reached = new Set<number>([0]);
  const todo = [0];
  while (todo.length > 0) {
    const a = spots[todo.pop() as number];
    spots.forEach((b, j) => {
      if (!reached.has(j) && (a.x - b.x) ** 2 + (a.y - b.y) ** 2 <= r2) {
        reached.add(j);
        todo.push(j);
      }
    });
  }
  return reached.size === spots.length;
}

/** The cell a cell ahead of the centre that way: where the formation's front row forms up. */
export function reformCell(centre: Spot, dir: Spot): Spot {
  return { x: Math.floor(centre.x + dir.x), y: Math.floor(centre.y + dir.y) };
}
