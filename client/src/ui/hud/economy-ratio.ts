// 經濟分配 (GDD §4): 糧／木／金 percentages that always add up to 100, changed in steps of 5.

export interface Ratio {
  food: number;
  wood: number;
  gold: number;
}

export const RATIO_STEP = 5;
const KEYS: (keyof Ratio)[] = ["food", "wood", "gold"];

/**
 * Change one share by ±RATIO_STEP and take (or give) the difference from the other two:
 * a raise comes out of the largest other share, a cut goes to the smallest, so the total
 * stays 100 and nothing goes below 0 or above 100.
 */
export function adjustRatio(r: Ratio, key: keyof Ratio, delta: number): Ratio {
  const out = { ...r };
  const others = KEYS.filter((k) => k !== key);
  if (delta > 0) {
    if (out[key] + RATIO_STEP > 100) return out;
    const from = others.reduce((a, b) => (out[b] > out[a] ? b : a));
    if (out[from] < RATIO_STEP) return out;
    out[from] -= RATIO_STEP;
    out[key] += RATIO_STEP;
  } else if (delta < 0) {
    if (out[key] < RATIO_STEP) return out;
    const to = others.reduce((a, b) => (out[b] < out[a] ? b : a));
    out[to] += RATIO_STEP;
    out[key] -= RATIO_STEP;
  }
  return out;
}
