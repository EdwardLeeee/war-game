// 整理隊形 (D-095; the user 2026-10-21: 「常常跑一跑法師就跑到前排，我們可以有一個整理隊形按鈕嗎？」):
// which way the soldiers face as they re-form. The user 2026-10-24 (in place of D-095's order:
// nearest enemy, enemy last seen, …): 「軍隊整理應該改成是面向前進的方向整隊」:
//   1. the group's order (its move, attack or retreat now, else the last one sent): towards where it
//      goes, from the group's middle; already there, the way they last walked;
//   2. never sent anywhere (fresh from training): the enemy's main city, if this side has seen it
//      (no peeking into the fog);
//   3. else the middle of the map;
//   4. else (nothing to go by) the way they face now (null: the simulation's re-forming in place keeps it).
// The game then has them re-form facing it (game.ts reform()), spearmen in front, ranged next,
// mages last: standing together (oneCluster), the simulation's re-forming in place with that
// `face` (D-095 B); farther apart, a walk of one cell that way, so they gather into one formation
// (ceo: 「整隊沒有排成一個」 is what the user minds). Not with an enemy near (enemyTooClose).
// Cells; pure, for the unit tests.

export interface Spot {
  x: number;
  y: number;
}

/** A group's order: where it goes (cells), and the way it was sent from where it stood (null: not known). */
export interface GroupOrder {
  to: Spot;
  went: Spot | null;
}

/** Within this many cells of where it was sent, a group has got there: it faces the way it walked. */
export const ARRIVED_CELLS = 2;

export type FacingFrom = "order" | "went" | "city" | "centre" | "keep";

const unit = (dx: number, dy: number): Spot | null => {
  const l = Math.hypot(dx, dy);
  return l < 1e-6 ? null : { x: dx / l, y: dy / l };
};

/**
 * The way to face from `centre`, and what it came from. `order`: the group's (game.ts: its order
 * now, else the last sent), null when it was never sent; `city`: the enemy's main city as this side
 * knows it, or null; `mapCentre`: the middle of the map.
 */
export function reformFacing(centre: Spot, order: GroupOrder | null, city: Spot | null, mapCentre: Spot): { dir: Spot | null; from: FacingFrom } {
  if (order !== null) {
    const dx = order.to.x - centre.x;
    const dy = order.to.y - centre.y;
    const ahead = Math.hypot(dx, dy) > ARRIVED_CELLS ? unit(dx, dy) : null;
    if (ahead !== null) return { dir: ahead, from: "order" };
    const went = order.went === null ? null : unit(order.went.x, order.went.y);
    return went === null ? { dir: null, from: "keep" } : { dir: went, from: "went" };
  }
  const toCity = city === null ? null : unit(city.x - centre.x, city.y - centre.y);
  if (toCity !== null) return { dir: toCity, from: "city" };
  const toMiddle = unit(mapCentre.x - centre.x, mapCentre.y - centre.y);
  if (toMiddle !== null) return { dir: toMiddle, from: "centre" };
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
