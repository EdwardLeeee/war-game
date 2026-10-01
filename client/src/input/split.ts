// 分出 N 名 (D-024, GDD §10): which N of the selected units become the new selection.
// Pure, so the rule is unit tested and the same on every device. It only picks a selection
// (screen side, never simulation state), so floating point is fine here.
//
// The rule, in order:
// 1. Each unit type gets floor(N × its count ÷ total) places.
// 2. The places left over go to the types with the largest remainder of N × count ÷ total;
//    equal remainders go to the lower UnitType first.
// 3. Within a type, the units nearest the centre of the whole selection are taken; equal
//    distances go to the lower id.

export interface SplitUnit {
  id: number;
  type: number;
  x: number;
  y: number;
}

/** The smallest and largest N that leave both parts non-empty, and the default (half, rounded down). */
export function splitRange(total: number): { min: number; max: number; initial: number } {
  if (total < 2) return { min: 0, max: 0, initial: 0 };
  return { min: 1, max: total - 1, initial: Math.floor(total / 2) };
}

/** Ids of the n units to split off, ascending. n is clamped to splitRange. */
export function splitPick(units: SplitUnit[], n: number): number[] {
  const total = units.length;
  const range = splitRange(total);
  if (range.max === 0) return [];
  const want = Math.min(Math.max(Math.round(n), range.min), range.max);

  let cx = 0;
  let cy = 0;
  for (const u of units) {
    cx += u.x;
    cy += u.y;
  }
  cx /= total;
  cy /= total;

  const byType = new Map<number, SplitUnit[]>();
  for (const u of units) byType.set(u.type, [...(byType.get(u.type) ?? []), u]);
  const types = [...byType.keys()].sort((a, b) => a - b);

  // Integer arithmetic for the quotas: want × count = quota × total + remainder.
  const quota = new Map<number, number>();
  let given = 0;
  for (const t of types) {
    const q = Math.floor((want * (byType.get(t)?.length ?? 0)) / total);
    quota.set(t, q);
    given += q;
  }
  const byRemainder = [...types].sort((a, b) => {
    const ra = (want * (byType.get(a)?.length ?? 0)) % total;
    const rb = (want * (byType.get(b)?.length ?? 0)) % total;
    return rb - ra || a - b;
  });
  for (let i = 0; i < want - given; i++) {
    const t = byRemainder[i];
    quota.set(t, (quota.get(t) ?? 0) + 1);
  }

  const picked: number[] = [];
  for (const t of types) {
    const list = (byType.get(t) ?? [])
      .map((u) => ({ id: u.id, d: (u.x - cx) * (u.x - cx) + (u.y - cy) * (u.y - cy) }))
      .sort((a, b) => a.d - b.d || a.id - b.id);
    for (const u of list.slice(0, quota.get(t) ?? 0)) picked.push(u.id);
  }
  return picked.sort((a, b) => a - b);
}
