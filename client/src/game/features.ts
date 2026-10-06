// Round 7 rules (D-061) that the simulation may switch off: `rules.features`. The screen leaves
// out what is off. The fields are optional in the protocol (mocks written by hand); absent is off.

import type { Features, Rules } from "../sim.ts";

export const NO_FEATURES: Features = { plunderOnce: false, towers: false, garrison: false, cavalry: false };

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
