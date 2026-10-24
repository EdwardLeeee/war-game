// 自動訓練照軍團缺的補 (D-098; the user 2026-10-21: 「我覺得主堡也要有自動造農民，然後生產兵力應該
// 按照我軍隊的數量去按比例生產，如果我的軍隊沒有缺的話就不用生產了」). The screen decides and sends
// ordinary `train` orders (in the log, so a game plays back the same); the simulation's own 自動訓練
// is turned off for the player (game.ts). The main city trains villagers up to a target (40 by
// default); barracks, ranges, mage halls and stables train only what the groups (軍團) with 自動補兵
// on are missing, the type with the largest share missing first. No group set: nothing. As the
// simulation's did: only from what is above the reserve (預留, D-054), with room in the population,
// mages up to their cap, one in a building's queue at a time. Pure, for the unit tests.

import type { Cost } from "../sim.ts";
import { UnitType } from "../sim.ts";

/** A group (編隊) as 自動補兵 sees it: on or off, the soldiers it wants and has (those walking to it included), by type. */
export interface GroupNeed {
  refill: boolean;
  want: Record<number, number>;
  have: Record<number, number>;
}

/**
 * Why the buildings train or not: `none` no group set, `off` every group's 自動補兵 off, `full`
 * nothing missing, `short` something missing (`missing`, by type, less those queued).
 */
export type ArmyReason = "none" | "off" | "full" | "short";

export interface ArmyNeed {
  reason: ArmyReason;
  missing: Record<number, number>;
  /** All the groups with 自動補兵 on want, by type (the share missing is out of it). */
  want: Record<number, number>;
}

const add = (r: Record<number, number>, t: number, n: number) => {
  r[t] = (r[t] ?? 0) + n;
};

/** Per type: over the groups with 自動補兵 on, want − have (none below 0), less those queued (none below 0). */
export function armyNeed(groups: readonly GroupNeed[], queued: Readonly<Record<number, number>>): ArmyNeed {
  const set = groups.filter((g) => Object.values(g.want).some((n) => n > 0));
  if (set.length === 0) return { reason: "none", missing: {}, want: {} };
  const on = set.filter((g) => g.refill);
  if (on.length === 0) return { reason: "off", missing: {}, want: {} };
  const missing: Record<number, number> = {};
  const want: Record<number, number> = {};
  for (const g of on) {
    for (const [k, n] of Object.entries(g.want)) {
      const t = Number(k);
      if (n <= 0) continue;
      add(want, t, n);
      add(missing, t, Math.max(0, n - (g.have[t] ?? 0)));
    }
  }
  for (const k of Object.keys(missing)) {
    const t = Number(k);
    missing[t] = Math.max(0, missing[t] - (queued[t] ?? 0));
  }
  return { reason: Object.values(missing).some((n) => n > 0) ? "short" : "full", missing, want };
}

/** A building that trains `trains`; `free`: finished, nothing in its queue or on the way to it, not paused. */
export interface Site {
  id: number;
  trains: number;
  free: boolean;
}

/** What may be spent now: what we have and the reserve in effect, room in the population, mages before their cap. */
export interface Budget {
  have: Cost;
  reserve: Cost;
  room: number;
  mageRoom: number;
}

const KEYS = ["food", "wood", "gold", "crystal"] as const;

/** Paid from what is above the reserve: only the resources the unit costs (a reserve of gold does not stop a spearman). */
export const affordsAbove = (cost: Cost, have: Cost, reserve: Cost): boolean => KEYS.every((k) => cost[k] <= 0 || have[k] - reserve[k] >= cost[k]);

/** Why a type missing cannot be trained now: no room in the population, the mage cap, or not enough above the reserve. */
export type Block = "population" | "mages" | "money";

/**
 * What to train now, one to a free building: again and again the type with the largest share
 * missing (missing ÷ wanted; the lower type on a tie) that has a free building, paid from the
 * budget. A type that cannot be paid for or placed now is skipped for the others (`blocked` says why).
 */
export function pickTrains(need: ArmyNeed, sites: readonly Site[], cost: (type: number) => Cost, budget: Budget): { trains: { building: number; type: number }[]; blocked: Map<number, Block> } {
  const trains: { building: number; type: number }[] = [];
  const blocked = new Map<number, Block>();
  if (need.reason !== "short") return { trains, blocked };
  const missing = { ...need.missing };
  const used = new Set<number>();
  const have = { ...budget.have };
  let room = budget.room;
  let mageRoom = budget.mageRoom;
  const siteFor = (t: number) => sites.find((s) => s.free && s.trains === t && !used.has(s.id));
  for (;;) {
    const types = Object.keys(missing)
      .map(Number)
      .filter((t) => missing[t] > 0 && !blocked.has(t) && siteFor(t) !== undefined);
    if (types.length === 0) break;
    types.sort((a, b) => missing[b] / need.want[b] - missing[a] / need.want[a] || a - b);
    const t = types[0];
    const c = cost(t);
    if (room <= 0) {
      for (const u of types) blocked.set(u, "population");
      break;
    }
    if (t === UnitType.Mage && mageRoom <= 0) {
      blocked.set(t, "mages");
      continue;
    }
    if (!affordsAbove(c, have, budget.reserve)) {
      blocked.set(t, "money");
      continue;
    }
    const site = siteFor(t) as Site;
    trains.push({ building: site.id, type: t });
    used.add(site.id);
    missing[t]--;
    room--;
    if (t === UnitType.Mage) mageRoom--;
    for (const k of KEYS) have[k] -= c[k];
  }
  return { trains, blocked };
}

/** 「槍 3、遠 2」: what is missing, short names, in the order of the types. */
export function missingText(missing: Readonly<Record<number, number>>): string {
  const SHORT: Record<number, string> = { [UnitType.Spearman]: "槍", [UnitType.Ranged]: "遠", [UnitType.Mage]: "法", [UnitType.Cavalry]: "騎" };
  return Object.keys(missing)
    .map(Number)
    .sort((a, b) => a - b)
    .filter((t) => missing[t] > 0)
    .map((t) => `${SHORT[t] ?? "兵"} ${missing[t]}`)
    .join("、");
}

/** The main city's villagers (D-098): the default target, and its bounds (−／+ by 5). */
export const VILLAGER_TARGET = 40;
export const VILLAGER_STEP = 5;
export const VILLAGER_MAX = 200;

/** How many more villagers to train for the target: those living (hiding ones too) and those queued count. */
export const villagersMissing = (target: number, living: number, queued: number): number => Math.max(0, target - living - queued);

/** What a save keeps (ScreenState.autoArmy). */
export interface AutoArmyState {
  paused: number[];
  villagerTarget: number;
  villagersPaused: boolean;
  /** 自動蓋民居 (2026-10-25); a save from before has none: on. */
  autoHouse?: boolean;
}

/** The screen's own part of 自動訓練: which buildings are paused, the villagers' target. */
export class AutoArmyBook {
  readonly paused = new Set<number>();
  villagerTarget = VILLAGER_TARGET;
  villagersPaused = false;
  /** 自動蓋民居 (auto-house.ts): on by default. */
  autoHouse = true;

  togglePaused(building: number): boolean {
    if (this.paused.has(building)) this.paused.delete(building);
    else this.paused.add(building);
    return this.paused.has(building);
  }

  /** −／+ on the main city: by VILLAGER_STEP, from 0 to VILLAGER_MAX. */
  stepTarget(by: number): number {
    this.villagerTarget = Math.min(VILLAGER_MAX, Math.max(0, this.villagerTarget + by * VILLAGER_STEP));
    return this.villagerTarget;
  }

  save(): AutoArmyState {
    return { paused: [...this.paused].sort((a, b) => a - b), villagerTarget: this.villagerTarget, villagersPaused: this.villagersPaused, autoHouse: this.autoHouse };
  }

  restore(s: AutoArmyState | undefined): void {
    this.paused.clear();
    this.villagerTarget = VILLAGER_TARGET;
    this.villagersPaused = false;
    this.autoHouse = true;
    if (s === undefined) return;
    for (const b of s.paused) this.paused.add(b);
    this.villagerTarget = s.villagerTarget;
    this.villagersPaused = s.villagersPaused;
    this.autoHouse = s.autoHouse ?? true;
  }
}
