// ＋遠程／＋法師 with nobody near (D-138 B; the user 2026-11-10: 「我的主堡按駐守還是會跳周圍沒有兵可以叫進來，如果附近沒有那就等
// 兵營造出來自己走進去」, and chose 「每按一次多練一名」): the building keeps a place, 自動訓練 trains one more of that type
// (by its own rules: above 預留, room in the population, mages under their cap), and the first one trained walks in
// instead of joining a group. Pure, for the unit tests; game.ts keeps one and sends the orders.

import type { ArmyNeed } from "./auto-army.ts";

export class CallSlots {
  /** The places kept, oldest first: a building and the type it waits for. */
  private slots: { building: number; type: number }[] = [];

  /** One more place in this building for this type. */
  add(building: number, type: number): void {
    this.slots.push({ building, type });
  }

  /** Places this building keeps (of this type, or all). */
  count(building: number, type?: number): number {
    return this.slots.filter((s) => s.building === building && (type === undefined || s.type === type)).length;
  }

  /** Places kept by type, over every building. */
  wanted(): Record<number, number> {
    const out: Record<number, number> = {};
    for (const s of this.slots) out[s.type] = (out[s.type] ?? 0) + 1;
    return out;
  }

  /** A new soldier of this type: the building whose place it fills (the oldest kept), or null: none waits for one. */
  take(type: number): number | null {
    const i = this.slots.findIndex((s) => s.type === type);
    if (i < 0) return null;
    const [s] = this.slots.splice(i, 1);
    return s.building;
  }

  /** The building's places given up (全部出來); how many. */
  drop(building: number): number {
    const n = this.count(building);
    this.slots = this.slots.filter((s) => s.building !== building);
    return n;
  }

  /** What 繼續上一局 keeps (D-083): the places, oldest first. */
  save(): { building: number; type: number }[] {
    return this.slots.map((s) => ({ ...s }));
  }

  /** As saved; none in saves from before (D-138 B). */
  restore(saved: readonly { building: number; type: number }[] | undefined): void {
    this.slots = (saved ?? []).map((s) => ({ building: s.building, type: s.type }));
  }

  /** The places of buildings no longer ours or standing, given up; the buildings. */
  prune(stands: (building: number) => boolean): number[] {
    const gone = [...new Set(this.slots.filter((s) => !stands(s.building)).map((s) => s.building))];
    this.slots = this.slots.filter((s) => stands(s.building));
    return gone;
  }
}

/**
 * 自動訓練's need with the places kept: per type, the groups' shortfall before what is queued (`groups`) plus the places,
 * less what is queued; what is queued serves the groups first, as they had it before. Short whenever a place waits.
 */
export function withCalls(need: ArmyNeed, groups: Readonly<Record<number, number>>, places: Readonly<Record<number, number>>, queued: Readonly<Record<number, number>>): ArmyNeed {
  const types = Object.keys(places).map(Number).filter((t) => (places[t] ?? 0) > 0);
  if (types.length === 0) return need;
  const missing = { ...need.missing };
  const want = { ...need.want };
  for (const t of types) {
    missing[t] = Math.max(0, (groups[t] ?? 0) + places[t] - (queued[t] ?? 0));
    want[t] = Math.max(want[t] ?? 0, (groups[t] ?? 0) + places[t]);
  }
  return { reason: Object.values(missing).some((n) => n > 0) ? "short" : need.reason, missing, want };
}
