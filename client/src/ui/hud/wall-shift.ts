// 牆上換邊 (R14-07; D-119 A, sim/PROTOCOL.md 4.7 `wallShifts`): the line under a town's 牆上／城內 in
// 正式介面's town panel. From the snapshot: 換邊 (on their way to fight) and 走回原位 (the enemy gone);
// 到了 the screen's own (ceo 2026-11-06): for a few seconds after a walk is over, how many of ours
// stand on that stretch now. 敵人太多 and 城門破了 wait for core's field (the simulation's own
// judgement: worked out here, it could say 不換邊 just as one set off).
//
// Words (ceo asks the user, 2026-11-06): the map's compass (北 is smaller y, as the minimap is drawn),
// or the screen's directions under the camera (the diamond: 北牆 is the upper right edge).

import { WALL_SHIFT_STRIDE, WallPart, WallSide, WallShiftField as WS } from "../../sim.ts";

export type WallWords = "compass" | "screen";

/** Where each side of the map is on screen, by view (the camera never turns). */
const SCREEN_SIDE: Record<"diamond" | "square", readonly [string, string, string, string]> = {
  // projection.ts DIAMOND: +x right and down, +y left and down.
  diamond: ["右上", "右下", "左下", "左上"],
  square: ["上", "右", "下", "左"],
};
/**
 * Each side's two halves on screen (WallPart.First: smaller x on 北／南, smaller y on 東／西): the
 * corner each half is nearer.
 */
const SCREEN_HALF: Record<"diamond" | "square", readonly [readonly [string, string], readonly [string, string], readonly [string, string], readonly [string, string]]> = {
  diamond: [
    ["靠上", "靠右"],
    ["靠右", "靠下"],
    ["靠左", "靠下"],
    ["靠上", "靠左"],
  ],
  square: [
    ["靠左", "靠右"],
    ["靠上", "靠下"],
    ["靠左", "靠右"],
    ["靠上", "靠下"],
  ],
};
const COMPASS_SIDE = ["北", "東", "南", "西"] as const;
const COMPASS_HALF = [
  ["西", "東"],
  ["北", "南"],
  ["西", "東"],
  ["北", "南"],
] as const;

export interface WallNames {
  words: WallWords;
  /** The camera's: anything but the diamond reads as north up. */
  view: "diamond" | "square";
}

/** A gate's top: 東門頂, or 右下門頂. */
export function gateName(side: number, names: WallNames): string {
  return `${names.words === "compass" ? COMPASS_SIDE[side] : SCREEN_SIDE[names.view][side]}門頂`;
}

/** A stretch (`side * 3 + part`): 東門頂, 東牆南段; or 右下門頂, 右下牆靠下那段. */
export function stretchName(stretch: number, names: WallNames): string {
  const side = Math.trunc(stretch / 3);
  const part = stretch % 3;
  if (side < 0 || side > 3) return "城牆";
  if (part === WallPart.Gate) return gateName(side, names);
  const half = part === WallPart.First ? 0 : 1;
  return names.words === "compass" ? `${COMPASS_SIDE[side]}牆${COMPASS_HALF[side][half]}段` : `${SCREEN_SIDE[names.view][side]}牆${SCREEN_HALF[names.view][side][half]}那段`;
}

/** The gates a walk crosses (`via`: 1 north, 2 east, 4 south, 8 west), in that order. */
export function viaGates(via: number, names: WallNames): string[] {
  return [WallSide.North, WallSide.East, WallSide.South, WallSide.West].filter((s) => (via & (1 << s)) !== 0).map((s) => gateName(s, names));
}

export interface ShiftRow {
  town: number;
  owner: number;
  n: number;
  from: number;
  to: number;
  via: number;
  foes: number;
  home: boolean;
}

/**
 * The snapshot's rows (WALL_SHIFT_STRIDE each) for one town and owner, as the lines say them: walks
 * to fight to the same stretch the same way as one (their `from` is not written), every walk back
 * as one; the most soldiers first.
 */
export function shiftRows(rows: Int32Array | undefined, town: number, owner: number): ShiftRow[] {
  if (rows === undefined) return [];
  const byLine = new Map<string, ShiftRow>();
  for (let o = 0; o + WS.home < rows.length; o += WALL_SHIFT_STRIDE) {
    if (rows[o + WS.town] !== town || rows[o + WS.owner] !== owner) continue;
    const home = rows[o + WS.home] === 1;
    const key = home ? "home" : `${rows[o + WS.to]}:${rows[o + WS.via]}`;
    const had = byLine.get(key);
    const n = rows[o + WS.n];
    if (had !== undefined) had.n += n;
    else byLine.set(key, { town, owner, n, from: rows[o + WS.from], to: rows[o + WS.to], via: rows[o + WS.via], foes: rows[o + WS.foes], home });
  }
  return [...byLine.values()].sort((a, b) => b.n - a.n || a.to - b.to);
}

/**
 * A row's line: 「換邊：4 名走過東門頂，去打東牆南段（敵人 7 名，沒超過牆上的 2 倍）」, or
 * 「敵人走了 10 秒：走回原位」 (R14-07 1 and 4). `odds`, `backSeconds`: rules.wallShift's. No enemy
 * seen there now (they set off while one was, and it walked out of sight; core 2026-11-06): 「敵人已
 * 離開視野」 (ceo), not 「敵人 0 名」.
 */
export function shiftLine(row: ShiftRow, odds: number, backSeconds: number, names: WallNames): string {
  if (row.home) return `敵人走了 ${backSeconds} 秒：走回原位`;
  const gates = viaGates(row.via, names);
  const way = gates.length === 0 ? "" : `走過${gates.join("、")}，`;
  const foes = row.foes === 0 ? "敵人已離開視野" : `敵人 ${row.foes} 名，沒超過牆上的 ${odds} 倍`;
  return `換邊：${row.n} 名${way}去打${stretchName(row.to, names)}（${foes}）`;
}

/** R14-07 2: a walk over, those of ours on that stretch now: 「東牆南段：6 名一起打」. */
export function arrivedLine(stretch: number, n: number, names: WallNames): string {
  return `${stretchName(stretch, names)}：${n} 名一起打`;
}

/**
 * A wall cell's stretch as the simulation has it (sim/src/core/wall-walk.ts wallStretch): its side
 * by the larger of its offsets from the town's centre cell (北／南 on a tie), its half by the sign of
 * the other; a gate's top is the gate.
 */
export function cellStretch(x: number, y: number, townX: number, townY: number, gate: boolean): number {
  const dx = x - townX;
  const dy = y - townY;
  const ns = Math.abs(dy) >= Math.abs(dx);
  const side = ns ? (dy < 0 ? WallSide.North : WallSide.South) : dx > 0 ? WallSide.East : WallSide.West;
  const part = gate ? WallPart.Gate : (ns ? dx : dy) < 0 ? WallPart.First : WallPart.Second;
  return side * 3 + part;
}
