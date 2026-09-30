// Words the interface shows for the simulation's numbers. Prototype role names (GDD §6
// 定位); the country-specific names come with the final interface.

import { Action, BuildingType, GameOverReason, NodeKind, TownState, UnitType } from "../../sim.ts";

export const UNIT_NAME: Record<number, string> = {
  [UnitType.Farmer]: "農民",
  [UnitType.Spearman]: "槍兵",
  [UnitType.Ranged]: "遠程兵",
  [UnitType.Mage]: "法師",
  [UnitType.Militia]: "民兵",
};

export const BUILDING_NAME: Record<number, string> = {
  [BuildingType.MainCity]: "主城",
  [BuildingType.House]: "民居",
  [BuildingType.LumberCamp]: "伐木場",
  [BuildingType.Mine]: "礦場",
  [BuildingType.Granary]: "糧倉",
  [BuildingType.Farm]: "農田",
  [BuildingType.Barracks]: "兵營",
  [BuildingType.Range]: "射場",
  [BuildingType.MageHall]: "法術營",
  [BuildingType.TownTower]: "箭樓",
};

/** What a player may build, in the order the build menu lists it (GDD §17 prototype buildings). */
export const BUILDABLE: BuildingType[] = [
  BuildingType.House,
  BuildingType.Farm,
  BuildingType.LumberCamp,
  BuildingType.Mine,
  BuildingType.Granary,
  BuildingType.Barracks,
  BuildingType.Range,
  BuildingType.MageHall,
];

export const NODE_NAME: Record<number, string> = {
  [NodeKind.Tree]: "樹林",
  [NodeKind.GoldMine]: "金礦",
  [NodeKind.Berries]: "野果",
  [NodeKind.CrystalVein]: "晶脈",
};

export const ACTION_NAME: Record<number, string> = {
  [Action.Idle]: "待命",
  [Action.Move]: "移動中",
  [Action.Attack]: "攻擊中",
  [Action.Gather]: "採集中",
  [Action.Build]: "建造中",
  [Action.Repair]: "修理中",
  [Action.Calibrate]: "晶砲校準中",
  [Action.Garrisoned]: "躲在建築裡",
};

export const TOWN_STATE_NAME: Record<number, string> = {
  [TownState.Neutral]: "中立",
  [TownState.AwaitingChoice]: "攻下，等待選擇",
  [TownState.Plundering]: "搶奪中",
  [TownState.Repairing]: "修繕中",
  [TownState.Governed]: "治理中",
  [TownState.Ruins]: "廢墟",
};

export const GAME_OVER_REASON: Record<number, string> = {
  [GameOverReason.MainCityDestroyed]: "主城被摧毀",
  [GameOverReason.Surrender]: "投降",
  [GameOverReason.TimeLimit]: "時間到（30 分鐘）",
};

/** "糧 40 木 20" from a cost, skipping zeros. */
export function costText(c: { food: number; wood: number; gold: number; crystal: number }): string {
  const parts: string[] = [];
  if (c.food > 0) parts.push(`糧${c.food}`);
  if (c.wood > 0) parts.push(`木${c.wood}`);
  if (c.gold > 0) parts.push(`金${c.gold}`);
  if (c.crystal > 0) parts.push(`晶${c.crystal}`);
  return parts.length > 0 ? parts.join(" ") : "免費";
}

/** Game time from ticks, as m:ss. */
export function clock(ticks: number, tps = 20): string {
  const s = Math.floor(ticks / tps);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
