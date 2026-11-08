// 開局提示 (D-044): where crystal comes from and which town to go for. The user did not know
// that crystal comes from towns, nor where one was ("我附近都沒有精礦，為啥電腦都有法師？"). Without
// crystal (D-135, ceo 2026-11-08) the same card says what towns give: 「城鎮給什麼」 (ui's R15-06, the user's approval).
// The town is worked out from the map, so a small town core adds near each main city
// becomes the one shown without any change here.

import { type Projection, PROJECTIONS, VIEW_DEFAULT } from "../camera/projection.ts";
import { TownSize, TownState } from "../sim.ts";

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

/** A town as we know it now: `state` null when never explored. */
export interface TownNow extends TownSpot {
  state: number | null;
  owner: number;
}

/**
 * The town 開局提示 points at (ceo, D-044): the nearest small town we can take, so a new player is
 * not sent at a large town's militia and arrow tower even when it is nearer. Can take: neutral,
 * the enemy's, or never seen; not ours, and not a ruin (nothing to take until it turns neutral
 * again). With none, the nearest small town; with no small town at all, the nearest town. On a
 * tie the lower id. At the start every town is neutral, so it is the nearest small town.
 * `passed`: a nearer small town was passed over, and the hint says "the nearest we can take".
 */
export function hintTown<T extends TownNow>(towns: readonly T[], from: { cellX: number; cellY: number }, me: number): { town: T; passed: boolean } | null {
  const small = towns.filter((t) => t.size === TownSize.Small);
  const nearestSmall = nearestTown(small, from);
  const open = nearestTown(small.filter((t) => t.owner !== me && t.state !== TownState.Ruins), from);
  const town = open ?? nearestSmall ?? nearestTown(towns, from);
  return town === null ? null : { town, passed: open !== null && open !== nearestSmall };
}

const DIRECTIONS = ["右邊", "右上方", "上方", "左上方", "左邊", "左下方", "下方", "右下方"] as const;

/**
 * One of eight directions as the player sees it on the battlefield (D-132, the user 2026-11-07: 照畫面寫,
 * not the map's 東南西北): the map's offset (cells, y growing south) laid on the screen by the camera's
 * projection. 方形 has 北 up (上方); the diamond turns the map, 北 up and to the right.
 */
export function screenDirection(dx: number, dy: number, projection: Projection): string {
  const a = projection.toPlane(0, 0);
  const b = projection.toPlane(dx, dy);
  const turns = Math.atan2(-(b.y - a.y), b.x - a.x) / (2 * Math.PI);
  return DIRECTIONS[(Math.round(turns * 8) + 8) % 8];
}

/** The last line on a random map before any town is explored (D-074). */
export const RANDOM_MAP_TOWN_TEXT = "這是隨機地圖：城鎮要派兵去探，探到才會出現在地圖上。";

/** The hint's title (D-135: without crystal, what towns give: ui's R15-06, the user's approval 2026-11-08). */
export const townHintTitle = (crystal: boolean): string => (crystal ? "魔晶從城鎮來" : "城鎮給什麼");
/** Its line in 選單: with crystal only (R15-06 has none). */
export const TOWN_HINT_MENU = "魔晶怎麼拿";

/** What a town gives as the rules say (`rules.towns`, small then large; D-135: read, not written in, core 2026-11-08). */
export interface TownGives {
  plunder: { food: number; gold: number };
  perMinute: { food: number; gold: number };
  populationCap: number;
}

/** 「各 300」 when food and gold are the same, else 「糧 300、金 200」. */
const each = (c: { food: number; gold: number }): string => (c.food === c.gold ? `各 ${c.food}` : `糧 ${c.food}、金 ${c.gold}`);

/** Without crystal (R15-06): what to do in a town, and what 搶 and 治理 give, small and large, from the rules. */
export function townGivesLines(towns: readonly TownGives[] | undefined): string[] {
  const [small, big] = towns ?? [];
  const take = "帶兵打倒城裡的民兵，就能選「搶」或「治理」。";
  if (small === undefined || big === undefined) return [take, "搶：馬上拿到一大筆糧和金。治理：修好之後，每分鐘都有糧和金，人口上限也會加。"];
  return [
    take,
    `搶：馬上拿到一大筆糧和金（小鎮${each(small.plunder)}、大城${each(big.plunder)}）。治理：修好之後，每分鐘都有糧和金（小鎮${each(small.perMinute)}、大城${each(big.perMinute)}），人口上限也會加（小鎮 ${small.populationCap}、大城 ${big.populationCap}）。`,
  ];
}

/**
 * The hint's lines: where crystal comes from, what to do there, and where the town (`hintTown`)
 * is, in the screen's directions under `projection` (the camera's, D-132). `plunderOnce`: 城鎮只能搶一次
 * is on (round 7, D-061). `gives` (D-135, no crystal): what towns give instead (townGivesLines), then where the town is.
 */
export function townHintLines(town: TownSpot | null, from: { cellX: number; cellY: number }, passed = false, plunderOnce = false, projection: Projection = PROJECTIONS[VIEW_DEFAULT], gives: string[] | null = null): string[] {
  let which = RANDOM_MAP_TOWN_TEXT;
  if (town !== null) {
    const dx = town.cellX - from.cellX;
    const dy = town.cellY - from.cellY;
    const where = `在主城的${screenDirection(dx, dy, projection)}，約 ${Math.round(Math.hypot(dx, dy))} 格`;
    // A large town only on a map without small ones (hintTown).
    which =
      town.size === TownSize.Large ? `離你的主城最近的是一座大城，${where}。小地圖上閃的圓圈就是它。` : passed ? `離你的主城最近、可以攻下的小鎮${where}。小地圖上閃的圓圈就是它。` : `離你的主城最近的小鎮${where}。小地圖上閃的圓圈就是它。`;
  }
  if (gives !== null) return [...gives, which];
  return [
    "法師要用魔晶。魔晶主要從城鎮來：帶兵打倒城裡的民兵，就能選「搶」或「治理」。",
    plunderOnce
      ? "搶：馬上拿到一筆糧、金和魔晶，每座城一局只能搶一次。治理：修好之後，每分鐘都有魔晶。"
      : "搶：馬上拿到一筆糧、金和魔晶。治理：修好之後，每分鐘都有魔晶。",
    which,
  ];
}
