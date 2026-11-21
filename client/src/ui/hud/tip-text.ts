// 滑鼠說明's words (R26 03 A): a line for each building of 建造 and each soldier 訓練 makes, ceo's 2026-11-20 (from GDD
// sections 6 and 8, nothing new: checked against the rules that day), and the ？ explanation's line for each order.
// The numbers from this game's rules, so that a rule changed changes its words.

import { BuildingType, type Rules, UnitType } from "../../sim.ts";
import { hasCrystal, holdsOf, outpostHide, outpostSlots } from "../../game/features.ts";

/** What building `type` is for, a line (ceo 2026-11-20). */
export function buildingTip(rules: Rules, type: number): string {
  switch (type) {
    case BuildingType.House:
      return `人口上限 +${rules.buildings[type]?.populationCap ?? 0}。`;
    case BuildingType.LumberCamp:
      return "存放木材。蓋在樹林旁，村民少走路。";
    case BuildingType.Mine:
      return hasCrystal(rules) ? "存放金幣和魔晶。蓋在金礦旁，村民少走路。" : "存放金幣。蓋在金礦旁，村民少走路。";
    case BuildingType.Granary:
      return "存放糧食。周圍可以蓋農田。";
    case BuildingType.Farm:
      return "村民在這裡種田產糧，不用重新播種。";
    case BuildingType.Barracks:
      return "訓練槍兵。";
    case BuildingType.Range:
      return "訓練遠程兵。";
    case BuildingType.MageHall:
      return "訓練法師。";
    case BuildingType.Stable:
      return "訓練騎兵。";
    case BuildingType.SiegeWorks:
      return "訓練攻城砲。";
    case BuildingType.ArrowTower: {
      const n = holdsOf(rules, type);
      return n > 0 ? `會自己射箭。遠程兵和法師可以躲進去（${n} 名）。` : "會自己射箭。";
    }
    case BuildingType.Outpost:
      return `視野遠，任何空地都能蓋。槍兵可以${outpostHide(rules) ? "躲進去" : "駐守"}（${outpostSlots(rules)} 名），附近可以蓋箭樓。`;
    case BuildingType.Market:
      return "用金買賣糧和木。";
    default:
      return "";
  }
}

/** What unit `type` is, a line (ceo 2026-11-20; the mage's after D-135: the cannon costs nothing, it waits). */
export function unitTip(type: number): string {
  switch (type) {
    case UnitType.Farmer:
      return "採集、蓋房子、修理。";
    case UnitType.Spearman:
      return "近戰，便宜耐打。";
    case UnitType.Ranged:
      return "在遠處射箭，血少。";
    case UnitType.Mage:
      return "放晶砲炸一片，射完要等一下才能再射。";
    case UnitType.Cavalry:
      return "跑得最快的近戰兵。";
    case UnitType.Siege:
      return "打建築和城門最快；走得慢，近身打不到。";
    default:
      return "";
  }
}

/** An order's line of ？ (「攻擊：點地面或敵人：…」) without its name in front: what the tip says under the name. */
export function orderTip(line: string): string {
  const i = line.indexOf("：");
  return i < 0 ? line : line.slice(i + 1);
}
