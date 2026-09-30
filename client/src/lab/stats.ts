// Summary statistics for frame and tick times. Measurement only, never simulation state.
// Same nearest-rank percentile as the engine spike, so the numbers compare.

export interface Summary {
  samples: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
}

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

export function summarize(values: number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  return {
    samples: sorted.length,
    median: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
    mean: sorted.length === 0 ? 0 : sum / sorted.length,
  };
}

export const round2 = (v: number): number => Math.round(v * 100) / 100;
