// Round 7 rules (D-061) that the simulation may switch off: `rules.features`. The screen leaves
// out what is off. The fields are optional in the protocol (mocks written by hand); absent is off.

import { BuildingType, type Features, type Rules } from "../sim.ts";

export const NO_FEATURES: Features = { plunderOnce: false, towers: false, garrison: false, cavalry: false, outpost: false };

export function features(rules: Pick<Rules, "features"> | null | undefined): Features {
  return { ...NO_FEATURES, ...(rules?.features ?? {}) };
}

/** Soldiers this kind of building holds with `garrison` (0: none, or the feature is off). */
export function holdsOf(rules: Pick<Rules, "features" | "buildings"> | null | undefined, type: number): number {
  if (!features(rules).garrison) return 0;
  return rules?.buildings[type]?.holds ?? 0;
}

/** Unit types that may hide in buildings (none while the feature is off). */
export function garrisonTypes(rules: Pick<Rules, "features" | "garrisonTypes"> | null | undefined): number[] {
  if (!features(rules).garrison) return [];
  return [...(rules?.garrisonTypes ?? [])];
}

/** Whether this building is offered in 建造 (箭樓 needs `towers`, 馬廄 `cavalry`). */
export function buildable(rules: Pick<Rules, "features"> | null | undefined, type: number): boolean {
  const on = features(rules);
  if (type === BuildingType.ArrowTower) return on.towers;
  if (type === BuildingType.Stable) return on.cavalry;
  if (type === BuildingType.Outpost) return on.outpost === true;
  return true;
}

/** 哨所 (D-080): spearmen an outpost takes (0 while the feature is off). */
export function outpostSlots(rules: Pick<Rules, "features" | "outpost"> | null | undefined): number {
  return features(rules).outpost === true ? (rules?.outpost?.slots ?? 0) : 0;
}

/**
 * The building types `type` still needs before it can be built (`requires`, round 7: own and
 * finished), in the table's order; empty when it can be built.
 */
export function missingFor(rules: Pick<Rules, "buildings"> | null | undefined, type: number, owned: ReadonlySet<number>): number[] {
  return (rules?.buildings[type]?.requires ?? []).filter((t) => !owned.has(t));
}
