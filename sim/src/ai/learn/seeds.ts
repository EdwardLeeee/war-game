// D-147 PR B (ceo 2026-11-23): the seeds kept for the automatic exam, and the check every other program that takes seeds
// makes. The exam's guarantee (sprt.ts) needs seeds nobody has seen a result on when a candidate or its champion was made,
// so no search, training or measurement may play one: pool.ts refuses them unless the exam opened it, and the programs
// that take seeds without the pool refuse them where they read their options. No imports: any program can use it.
//
//   9,000,000- 9,999,999  the first trials' (trial-1, trial-2: results seen; never played again)
//  10,000,000-10,009,999  for a whole training, never changed: the canary, a champion against the baseline (both only
//                         ever pause, neither promotes)
//  10,010,000-19,999,999  blocks 1-999 of 10,000: a champion's exam plays in one block and a new champion gets a new
//                         one (exam-blocks.json says which training has which)
//  20,000,000 on          the training's own games (PR C)
// Elsewhere: CI's (1-100, 2,000,001-, 3,000,001-), evolution's (1-1,000,000), the examiner search's and its checks'
// (5,000,001-8,999,999).

export const EXAM_SEEDS = { first: 9_000_000, last: 19_999_999, fixed: 10_000_000, blockSize: 10_000, blocks: 999, training: 20_000_000 } as const;

export function isExamSeed(seed: number): boolean {
  return seed >= EXAM_SEEDS.first && seed <= EXAM_SEEDS.last;
}

/** Throws if any of `seeds` is kept for the exam; `who` names the program in the error. */
export function refuseExamSeeds(seeds: Iterable<number>, who: string): void {
  for (const seed of seeds) {
    if (isExamSeed(seed)) throw new Error(`${who}: seed ${seed} is kept for the automatic exam (${EXAM_SEEDS.first}-${EXAM_SEEDS.last}, ai/learn/seeds.ts); take another`);
  }
}

/** The first seed of block `n`. */
export function blockBase(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > EXAM_SEEDS.blocks) throw new Error(`exam block ${n}: 1-${EXAM_SEEDS.blocks}`);
  return EXAM_SEEDS.fixed + n * EXAM_SEEDS.blockSize;
}
