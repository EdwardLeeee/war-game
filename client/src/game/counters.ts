// 兵種相剋 (選單, D-061; ceo 2026-10-07: 「每種兵一行寫剋誰、怕誰，數字從 rules 讀」): for each
// soldier type, whom it hits harder and who hits it harder, from the simulation's damage table
// (`rules.multipliers`). ×2 is twice the damage. The counters that are no multiplier (GDD §6:
// the cannon's spread, cavalry's speed) are written beside them, so 「怕：沒有」 does not read as
// 「遠程兵不怕騎兵」 (ceo 2026-10-07). 騎兵 only while its feature is on.

import { type Multiplier, type Rules, UnitType } from "../sim.ts";
import { features } from "./features.ts";

export interface CounterLine {
  type: number;
  /** 「槍兵 ×2.5」: whom it hits harder; 「遠程兵（跑得快）」: whom it beats otherwise. */
  beats: string[];
  /** 「槍兵 ×3」: who hits it harder. 「遠程兵打護盾 ×3」: who hits its shield harder (mages). */
  fears: string[];
}

/**
 * Counters that are no damage multiplier (GDD §6 剋制表, ceo 2026-10-07), each listed while the
 * type it names is in play. `first`: before the multipliers of its line, else after.
 */
const NOT_MULTIPLIERS: { type: number; side: "beats" | "fears"; text: string; names: number; first: boolean }[] = [
  { type: UnitType.Spearman, side: "fears", text: "晶砲（擠在一起時）", names: UnitType.Mage, first: false },
  { type: UnitType.Ranged, side: "fears", text: "騎兵（跑得快，很快衝到面前；生命少）", names: UnitType.Cavalry, first: false },
  { type: UnitType.Mage, side: "beats", text: "擠在一起的部隊（晶砲範圍傷害）", names: UnitType.Mage, first: false },
  { type: UnitType.Cavalry, side: "beats", text: "遠程兵（跑得快）", names: UnitType.Ranged, first: true },
];

/** The soldier types listed, in the order of the 軍團畫面. */
export function counterTypes(rules: Pick<Rules, "features"> | null | undefined): number[] {
  return [UnitType.Spearman, UnitType.Ranged, UnitType.Mage, ...(features(rules).cavalry ? [UnitType.Cavalry] : [])];
}

/** num / den as the player reads it: 3, 2.5. */
export function ratioText(m: Pick<Multiplier, "num" | "den">): string {
  return `${Math.round((m.num * 10) / m.den) / 10}`;
}

export function counterLines(rules: Pick<Rules, "features" | "multipliers"> | null | undefined, names: Record<number, string>): CounterLine[] {
  const types = counterTypes(rules);
  // Rows about a type not in play (騎兵 while it is off) are left out.
  const table = (rules?.multipliers ?? []).filter((m) => types.includes(m.attacker) && (m.target === "shield" || types.includes(m.target)));
  const extra = (type: number, side: "beats" | "fears", first: boolean) =>
    NOT_MULTIPLIERS.filter((e) => e.type === type && e.side === side && e.first === first && types.includes(e.names)).map((e) => e.text);
  return types.map((type) => ({
    type,
    beats: [
      ...extra(type, "beats", true),
      ...table.filter((m) => m.attacker === type).map((m) => (m.target === "shield" ? `法師的護盾 ×${ratioText(m)}` : `${names[m.target] ?? "兵"} ×${ratioText(m)}`)),
      ...extra(type, "beats", false),
    ],
    fears: [
      ...extra(type, "fears", true),
      ...table
        .filter((m) => m.target === type || (m.target === "shield" && type === UnitType.Mage))
        .map((m) => (m.target === "shield" ? `${names[m.attacker] ?? "兵"}打護盾 ×${ratioText(m)}` : `${names[m.attacker] ?? "兵"} ×${ratioText(m)}`)),
      ...extra(type, "fears", false),
    ],
  }));
}
