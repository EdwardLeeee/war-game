// 兵種相剋 (選單, D-061; ceo 2026-10-07: 「每種兵一行寫剋誰、怕誰，數字從 rules 讀」): for each
// soldier type, whom it hits harder and who hits it harder, from the simulation's damage table
// (`rules.multipliers`). ×2 is twice the damage. 騎兵 only while its feature is on.

import { type Multiplier, type Rules, UnitType } from "../sim.ts";
import { features } from "./features.ts";

export interface CounterLine {
  type: number;
  /** 「打槍兵 ×2.5」: whom it hits harder. */
  beats: string[];
  /** 「槍兵 ×3」: who hits it harder. 「遠程兵打護盾 ×3」: who hits its shield harder (mages). */
  fears: string[];
}

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
  return types.map((type) => ({
    type,
    beats: table.filter((m) => m.attacker === type).map((m) => (m.target === "shield" ? `打法師的護盾 ×${ratioText(m)}` : `打${names[m.target] ?? "兵"} ×${ratioText(m)}`)),
    fears: table
      .filter((m) => m.target === type || (m.target === "shield" && type === UnitType.Mage))
      .map((m) => (m.target === "shield" ? `${names[m.attacker] ?? "兵"}打護盾 ×${ratioText(m)}` : `${names[m.attacker] ?? "兵"} ×${ratioText(m)}`)),
  }));
}
