// D-147 step 4 (PR B): the automatic exam (sim/src/ai/learn/auto.ts) on made-up results: no games are played. A fake
// player gives each plan a strength; the state is moved on look by look as the merge job would.

import assert from "node:assert/strict";
import { test } from "node:test";
import { aaItems, AUTO, baseItems, blockOf, canaryItems, checkCanary, type Examiner, FINAL, finalItems, type HP, init, type Item, listedSum, lookItems, MAX_LOOKS, needed, type Pause, planHash, prune, type Res, resume, SEEDS, setSource, type State, step, tally, type Training } from "../src/ai/learn/auto.ts";
import { rng } from "../src/ai/learn/exam-space.ts";
import { blockBase, EXAM_SEEDS, isExamSeed } from "../src/ai/learn/seeds.ts";
import { SPRT } from "../src/ai/learn/sprt.ts";

const EXAMINERS: Examiner[] = ["6-132", "2-89", "10-79"].map((id) => ({ id, plan: {} as Examiner["plan"], map: "random" }));

const TRAINING: Training = { name: "test", first: 1, last: 40, source: "source-1" };

/** A plan's made-up play: how often the examiners beat it, its edge head to head, whether it plays as hard does. */
interface Fake {
  exWins: number;
  edge: number;
  /** Plays exactly as this group (same hashes). */
  as?: string;
  normal?: number;
  reached?: number;
  think?: number;
}
/** The pause, read through a function so the type checker does not keep an earlier narrowing. */
const pausedOf = (s: State): Pause | null => s.paused;
const hashOf = (key: string) => {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** Plays `items` with the fake strengths (by plan hash; the baseline "{}" by default). */
function play(s: State, items: Item[], fakes: Record<string, Fake>) {
  const f = (h: string): Fake => fakes[h] ?? { exWins: 0.3, edge: 0 };
  for (const x of items) {
    if (x.key.startsWith("canary|")) continue;
    const [kind, me, opp, seedText, swap] = x.key.split("|");
    const seed = Number(seedText);
    const r = rng(hashOf(x.key));
    let res: Res;
    if (kind === "ex") {
      const m = f(me);
      // Plans that play alike give the same game; others differ, drawn from the seed and the examiner (so a stronger plan
      // loses on fewer of the same seeds).
      const group = m.as ?? me;
      const u = rng(hashOf(`${opp}|${seed}`))();
      res = { w: u < m.exWins ? 1 : u > 0.98 ? -1 : 0, h: `${group}-${opp}-${seed}` };
      if (m.as === undefined) res.h = `${me}-${opp}-${seed}`;
    } else if (kind === "aa") {
      // A deterministic game: from the other spawn the same game, the result the other way round.
      const u = rng(hashOf(`${me}|${seed}`))();
      const w = u < 0.02 ? -1 : u < 0.51 ? 1 : 0;
      res = { w: w === -1 || swap === "0" ? w : 1 - w, h: `${me}-${seed}` };
    } else if (kind === "vs" || kind === "bl") {
      const d = f(me).edge - f(opp).edge;
      const u = r();
      res = { w: u < 0.02 ? -1 : u < 0.02 + 0.98 * (0.5 + d) ? 1 : 0, h: `${x.key}` };
    } else {
      const m = f(me);
      res = { w: r() < (m.normal ?? 0.9) ? 1 : 0, h: x.key, reached: r() < (m.reached ?? 0.6), thinks: 100, ms: 100 * (m.think ?? 1) };
    }
    s.results[x.key] = res;
  }
}

/** Runs the exam until done or paused: each round plays what is needed (as a segment) and merges (step). */
function run(s: State, fakes: Record<string, Fake>, rounds = 2000): string[] {
  const lines: string[] = [];
  for (let i = 0; i < rounds && s.paused === null && !s.done; i++) {
    play(s, needed(s), fakes);
    checkCanary(s, ["a", "b", "c"], "tree", "commit", `P-${i}`, `t${i}`);
    lines.push(...step(s, `P-${i}`, `t${i}`));
  }
  return lines;
}

/** Every seed a block's champion and candidate play, by what it is for. */
function usesOf(s: State): Map<number, Set<string>> {
  const c = planHash({ farmers: 30 });
  s.plans[c] = { farmers: 30 };
  const items = [...Array.from({ length: MAX_LOOKS }, (_, k) => lookItems(s, c, k)).flat(), ...aaItems(s), ...finalItems(s, c)];
  const uses = new Map<number, Set<string>>();
  for (const x of items) {
    const [kind, , opp, seed] = x.key.split("|");
    const use = kind === "ex" ? `ex ${opp}` : kind;
    uses.set(Number(seed), (uses.get(Number(seed)) ?? new Set()).add(use));
  }
  return uses;
}

test("auto: no seed is used for two things, by two examiners or in two blocks, and all are the exam's", () => {
  const all = new Map<number, string>();
  for (const n of [1, 2, 3, EXAM_SEEDS.blocks]) {
    const s = init(EXAMINERS, [], { ...TRAINING, first: n, last: n });
    for (const [seed, uses] of usesOf(s)) {
      assert.equal(uses.size, 1, `seed ${seed}: ${[...uses].join(", ")}`);
      assert.equal(all.get(seed), undefined, `seed ${seed} in two blocks`);
      assert.ok(seed >= blockBase(n) && seed < blockBase(n) + EXAM_SEEDS.blockSize && isExamSeed(seed));
      all.set(seed, `${n}`);
    }
  }
  // The canary and the games against the baseline: the same for a whole training, and in no block.
  const s = init(EXAMINERS, [], TRAINING);
  const fixed = [...canaryItems(s).map((x) => (x.job.kind === "scripted" ? x.job.seed : x.job.spec.seed)), ...baseItems(s, s.baseline).map((x) => Number(x.key.split("|")[3]))];
  for (const seed of fixed) assert.ok(isExamSeed(seed) && seed < blockBase(1) && !all.has(seed), `fixed ${seed}`);
  const t = init(EXAMINERS, [], { ...TRAINING, first: 7 });
  assert.deepEqual(canaryItems(t), canaryItems(s));
  assert.equal(new Set(fixed).size, SEEDS.canaryCount + SEEDS.baseCount);
  // Both paths run out of games at the same look.
  assert.equal(MAX_LOOKS * SPRT.exChunk * 3, SPRT.exMax);
  assert.equal(MAX_LOOKS * SPRT.vsChunk, SPRT.vsMax);
});

test("auto: a plan's hash does not depend on the order of its keys", () => {
  assert.equal(planHash({ farmers: 14, production: 1 }), planHash({ production: 1, farmers: 14 }));
  assert.notEqual(planHash({}), planHash({ farmers: 14 }));
});

test("auto: the four known answers (identical, equal, weaker; and a stronger one promoted)", () => {
  const equal: HP = { townRest: 2 };
  const weak: HP = { farmers: 14, production: 1 };
  const strong: HP = { pushArmy: 99 };
  const s = init(EXAMINERS, [
    { id: "identical", plan: {}, round: 0 },
    { id: "equal", plan: equal, round: 0 },
    { id: "weak", plan: weak, round: 0 },
    { id: "strong", plan: strong, round: 1 },
  ], TRAINING);
  const fakes: Record<string, Fake> = {
    [planHash(equal)]: { exWins: 0.3, edge: 0 },
    [planHash(weak)]: { exWins: 0.45, edge: -0.15 },
    [planHash(strong)]: { exWins: 0.3, edge: 0.1 },
  };
  run(s, fakes);
  const v = Object.fromEntries(s.decided.map((d) => [d.id, d]));
  assert.equal(v.identical.verdict, "reject");
  assert.match(v.identical.why, /一模一樣/);
  assert.equal(v.equal.verdict, "reject");
  assert.equal(v.weak.verdict, "reject");
  assert.ok(v.weak.looks < 10, `weak decided after ${v.weak.looks} looks`);
  assert.equal(v.strong.verdict, "promote", v.strong.why);
  assert.equal(s.champion, planHash(strong));
  assert.ok(s.base[planHash(strong)].score > 0.55, "the new champion measured against the baseline");
  assert.ok(s.done);
  assert.equal(s.tested, 4);
});

test("auto: a candidate plays exactly as the champion though its plan differs: rejected after the first look", () => {
  const twin: HP = { townRest: 3 };
  const s = init(EXAMINERS, [{ id: "twin", plan: twin, round: 0 }], TRAINING);
  run(s, { [planHash(twin)]: { exWins: 0.3, edge: 0, as: planHash({}) } });
  assert.equal(s.decided[0].verdict, "reject");
  assert.equal(s.decided[0].looks, 1);
  assert.match(s.decided[0].why, /一模一樣/);
});

test("auto: the finalist's checks can stop a promotion", () => {
  const slow: HP = { pushArmy: 98 };
  const s = init(EXAMINERS, [{ id: "slow", plan: slow, round: 0 }], TRAINING);
  run(s, { [planHash(slow)]: { exWins: 0.3, edge: 0.1, think: FINAL.thinkRatio + 0.5 } });
  assert.equal(s.decided[0].verdict, "reject");
  assert.match(s.decided[0].why, /思考時間/);
  assert.equal(s.champion, s.baseline);
  const weakNormal: HP = { pushArmy: 97 };
  const t = init(EXAMINERS, [{ id: "weak-normal", plan: weakNormal, round: 0 }], TRAINING);
  run(t, { [planHash(weakNormal)]: { exWins: 0.3, edge: 0.1, normal: 0.6 } });
  assert.match(t.decided[0].why, /對普通/);
});

test("auto: needed lists the canary always, nothing twice, nothing once paused", () => {
  const s = init(EXAMINERS, [{ id: "c", plan: { farmers: 30 }, round: 0 }], TRAINING);
  step(s, "P-1", "t");
  const items = needed(s);
  assert.equal(items.filter((x) => x.key.startsWith("canary|")).length, SEEDS.canaryCount);
  assert.equal(new Set(items.map((x) => x.key)).size, items.length);
  // The champion's A/A and the candidate's first AUTO.lookAhead looks.
  assert.equal(items.filter((x) => x.key.startsWith("aa|")).length, SEEDS.aaCount + SEEDS.mirrorCount);
  assert.equal(items.filter((x) => x.key.startsWith("vs|")).length, AUTO.lookAhead * SPRT.vsChunk);
  s.paused = { id: "P-1", kind: "max", reason: "", numbers: [], at: "" };
  assert.deepEqual(needed(s), []);
});

test("auto: the champion against itself must be the same game from both spawns, the result the other way round", () => {
  const measured = (mirror: (w: number, seed: number) => Res) => {
    const s = init(EXAMINERS, [{ id: "c", plan: { farmers: 30 }, round: 0 }], TRAINING);
    for (const x of aaItems(s)) {
      const [, , , seedText, swap] = x.key.split("|");
      const seed = Number(seedText);
      // Every fifth seed a game neither side won.
      const w = seed % 5 === 0 ? -1 : seed % 2;
      s.results[x.key] = swap === "0" ? { w, h: `g${seed}` } : mirror(w, seed);
    }
    step(s, "P-7", "t");
    return s;
  };
  const other = (w: number) => (w === -1 ? -1 : 1 - w);
  // Right, the drawn pairs too: no pause, and the draws of the games from one spawn kept for the finalist's check.
  const fine = measured((w, seed) => ({ w: other(w), h: `g${seed}` }));
  assert.equal(fine.paused, null);
  assert.deepEqual(fine.aa[1], { pairs: SEEDS.mirrorCount, differ: 0, draws: 20, games: SEEDS.aaCount });
  const first = blockBase(1) + SEEDS.block.aa;
  // It can fail, three ways: another game, the same side winning, a draw from one spawn only.
  for (const bad of [
    (w: number, seed: number): Res => ({ w: other(w), h: seed === first + 3 ? "another" : `g${seed}` }),
    (w: number, seed: number): Res => ({ w: seed === first + 3 ? w : other(w), h: `g${seed}` }),
    (w: number, seed: number): Res => ({ w: seed === first ? 1 : other(w), h: `g${seed}` }),
  ]) {
    const s = measured(bad);
    assert.equal(pausedOf(s)?.id, "P-7");
    assert.equal(pausedOf(s)?.kind, "aa");
    assert.match(pausedOf(s)!.reason, /自己打自己/);
  }
});

test("auto: the canary's hashes changing pauses; only the code changing is noted", () => {
  const s = init(EXAMINERS, [{ id: "c", plan: { farmers: 30 }, round: 0 }], TRAINING);
  checkCanary(s, ["a", "b", "c"], "tree1", "c1", "P-1", "t");
  assert.match(checkCanary(s, ["a", "b", "c"], "tree2", "c2", "P-2", "t"), /程式改了/);
  assert.equal(s.paused, null);
  assert.match(s.log.at(-1)!.what, /tree1|程式改了/);
  checkCanary(s, ["a", "x", "c"], "tree3", "c3", "P-3", "t");
  assert.equal(pausedOf(s)?.id, "P-3");
  // Resumed (the user said go on): the new hashes are kept from then on.
  assert.equal(resume(s, "P-9", "t"), false);
  assert.equal(resume(s, "P-3", "t"), true);
  assert.equal(s.canary, null);
  checkCanary(s, ["a", "x", "c"], "tree3", "c3", "P-4", "t");
  assert.equal(s.paused, null);
});

test("auto: resuming a pause resets what made it, so it does not pause again at once", () => {
  const t = init(EXAMINERS, [{ id: "x", plan: { farmers: 99 }, round: 0 }], TRAINING);
  t.tested = AUTO.candidatesMax;
  step(t, "P-1", "t");
  assert.equal(pausedOf(t)?.kind, "max");
  assert.ok(resume(t, "P-1", "t"));
  step(t, "P-2", "t");
  assert.equal(t.paused, null);
  assert.equal(t.current?.id, "x");
});

test("auto: rounds with no promotion, and too many candidates, pause", () => {
  const plans = Array.from({ length: 12 }, (_, i): HP => ({ farmers: 30 + i }));
  const s = init(EXAMINERS, plans.map((plan, i) => ({ id: `c${i}`, plan, round: i })), TRAINING);
  run(s, Object.fromEntries(plans.map((p) => [planHash(p), { exWins: 0.3, edge: -0.2 } as Fake])));
  assert.match(s.paused?.reason ?? "", new RegExp(`連續 ${AUTO.roundsWithout} 輪`));
  assert.equal(s.tested, AUTO.roundsWithout);
  // The candidate that would start the eleventh round waits in the queue.
  assert.equal(s.queue[0].id, `c${AUTO.roundsWithout}`);
  const t = init(EXAMINERS, [], TRAINING);
  t.tested = AUTO.candidatesMax;
  t.queue.push({ id: "x", plan: { farmers: 99 }, round: 0 });
  step(t, "P-9", "t");
  assert.match(t.paused?.reason ?? "", /最多/);
});

test("auto: a new champion that drops against the baseline pauses", () => {
  const a: HP = { pushArmy: 99 };
  const b: HP = { pushArmy: 96 };
  const s = init(EXAMINERS, [
    { id: "a", plan: a, round: 0 },
    { id: "b", plan: b, round: 1 },
  ], TRAINING);
  // b beats a head to head (edge over a) but is weaker than a against the baseline: its base games are made up below.
  const fakes: Record<string, Fake> = { [planHash(a)]: { exWins: 0.3, edge: 0.15 }, [planHash(b)]: { exWins: 0.3, edge: 0.3 } };
  for (let i = 0; i < 4000 && s.paused === null && !s.done; i++) {
    const items = needed(s);
    play(s, items, fakes);
    if (s.champion === planHash(b)) for (const x of items) if (x.key.startsWith("bl|")) s.results[x.key] = { w: Number(x.key.split("|")[3]) % 5 < 2 ? 1 : 0, h: x.key };
    step(s, `P-${i}`, `t${i}`);
  }
  assert.equal(s.champion, planHash(b));
  assert.match(s.paused?.reason ?? "", /對基準掉了/);
});

test("auto: how many jobs a segment has does not change what is played or decided (ceo 2026-11-21)", () => {
  const equal: HP = { townRest: 2 };
  const weak: HP = { farmers: 14, production: 1 };
  const strong: HP = { pushArmy: 99 };
  const fakes: Record<string, Fake> = {
    [planHash(equal)]: { exWins: 0.3, edge: 0 },
    [planHash(weak)]: { exWins: 0.45, edge: -0.15 },
    [planHash(strong)]: { exWins: 0.3, edge: 0.1 },
  };
  /** Segments of `jobs` jobs, each job playing every jobs-th game of what is needed (as exam-auto.ts work), and only a
   * part of it before its hour is up (drawn), then a merge. */
  const runWith = (jobs: number) => {
    const s = init(EXAMINERS, [
      { id: "equal", plan: equal, round: 0 },
      { id: "weak", plan: weak, round: 0 },
      { id: "strong", plan: strong, round: 1 },
    ], TRAINING);
    const r = rng(1000 + jobs);
    let played = 0;
    for (let seg = 0; seg < 5000 && s.paused === null && !s.done; seg++) {
      const all = needed(s).filter((x) => !x.key.startsWith("canary|"));
      for (let k = 0; k < jobs; k++) {
        const mine = all.filter((_, i) => i % jobs === k);
        const part = mine.slice(0, Math.ceil(mine.length * (0.2 + 0.8 * r())));
        play(s, part, fakes);
        played += part.length;
      }
      checkCanary(s, ["a", "b", "c"], "tree", "commit", `P-${seg}`, "t");
      step(s, `P-${seg}`, "t");
    }
    return { decided: s.decided.map((d) => ({ id: d.id, verdict: d.verdict, why: d.why, looks: d.looks, ex: d.ex, vs: d.vs })), champion: s.champion, played };
  };
  const three = runWith(3);
  const sixteen = runWith(16);
  const one = runWith(1);
  assert.equal(three.decided.length, 3);
  assert.deepEqual(sixteen.decided, three.decided);
  assert.deepEqual(one.decided, three.decided);
  assert.equal(sixteen.champion, three.champion);
});

/** A state whose first candidate, 'strong', was just promoted, with 'next' waiting. */
function promoted(): { s: State; strong: string; next: HP; fakes: Record<string, Fake> } {
  const strongPlan: HP = { pushArmy: 99 };
  const next: HP = { pushArmy: 95 };
  const strong = planHash(strongPlan);
  const s = init(EXAMINERS, [
    { id: "strong", plan: strongPlan, round: 0 },
    { id: "next", plan: next, round: 0 },
  ], TRAINING);
  const fakes: Record<string, Fake> = { [strong]: { exWins: 0.3, edge: 0.15 }, [planHash(next)]: { exWins: 0.3, edge: 0.15 } };
  for (let i = 0; i < 200 && s.champion === s.baseline; i++) {
    play(s, needed(s), fakes);
    step(s, `P-${i}`, "t");
  }
  assert.equal(s.champion, strong);
  return { s, strong, next, fakes };
}

test("auto: a promotion opens a new block; its champion plays again there and nothing of the old one is used", () => {
  const { s, strong } = promoted();
  assert.deepEqual(s.blocks.map((b) => [b.n, b.champion]), [[1, s.baseline], [2, strong]]);
  assert.equal(s.decided[0].block, 1);
  assert.equal(s.current?.block, 2);
  const seedOf = (key: string) => Number(key.split("|")[3]);
  for (const key of Object.keys(s.results)) if (!key.startsWith("bl|")) assert.ok(seedOf(key) >= blockBase(2), `kept from the old block: ${key}`);
  const items = needed(s).filter((x) => !x.key.startsWith("canary|") && !x.key.startsWith("bl|"));
  for (const x of items) assert.ok(seedOf(x.key) >= blockBase(2) && seedOf(x.key) < blockBase(3), x.key);
  const again = items.filter((x) => x.key.startsWith(`ex|${strong}|`));
  assert.equal(again.length, AUTO.lookAhead * SPRT.exChunk * 3, "the new champion's examiner games, again");
  // The bound: 2 listed at block 1, 1 at block 2.
  assert.deepEqual(s.blocks.map((b) => b.listed), [2, 1]);
  assert.equal(listedSum(s), 3);
});

test("auto: keeping the old block after a promotion fails, whichever way it is tried", () => {
  const all = (s: State, c: string) => {
    for (const f of [() => blockOf(s), () => needed(s), () => step(s, "P-x", "t"), () => lookItems(s, c, 0), () => finalItems(s, c), () => aaItems(s), () => tally(s, c, 1)]) assert.throws(f, /exam: /);
  };
  // The new champion left on the old block.
  const a = promoted();
  a.s.blocks.pop();
  all(a.s, planHash(a.next));
  // The old block opened again under the new champion's name.
  const b = promoted();
  b.s.blocks[1] = { ...b.s.blocks[1], n: 1 };
  b.s.current!.block = 1;
  all(b.s, planHash(b.next));
  // The champion changed with no block opened.
  const c = init(EXAMINERS, [{ id: "c", plan: { farmers: 30 }, round: 0 }], TRAINING);
  c.champion = planHash({ farmers: 30 });
  all(c, planHash({ farmers: 30 }));
  // A candidate begun in another block.
  const d = promoted();
  d.s.current!.block = 1;
  all(d.s, planHash(d.next));
});

test("auto: what makes candidates changed: the one under exam ends in its block, the next has a new one", () => {
  const plans: HP[] = [{ farmers: 31 }, { farmers: 32 }, { farmers: 33 }];
  const s = init(EXAMINERS, plans.map((plan, i) => ({ id: `c${i}`, plan, round: 0 })), TRAINING);
  const fakes = Object.fromEntries(plans.map((p) => [planHash(p), { exWins: 0.5, edge: -0.2 } as Fake]));
  step(s, "P-0", "t");
  assert.equal(s.current?.id, "c0");
  setSource(s, "source-2", "t");
  assert.equal(blockOf(s).n, 1, "the one under exam goes on in its block");
  run(s, fakes);
  assert.deepEqual(s.decided.map((d) => [d.id, d.block]), [["c0", 1], ["c1", 2], ["c2", 2]]);
  assert.deepEqual(s.blocks.map((b) => [b.n, b.source, b.listed]), [[1, "source-1", 3], [2, "source-2", 2]]);
  assert.equal(listedSum(s), 5);
});

test("auto: out of blocks pauses, and is not resumed onto a used one", () => {
  const s = init(EXAMINERS, [{ id: "strong", plan: { pushArmy: 99 }, round: 0 }, { id: "next", plan: { pushArmy: 95 }, round: 0 }], { ...TRAINING, last: 1 });
  run(s, { [planHash({ pushArmy: 99 })]: { exWins: 0.3, edge: 0.15 } });
  assert.equal(pausedOf(s)?.kind, "blocks");
  assert.deepEqual(needed(s), []);
  assert.equal(resume(s, pausedOf(s)!.id, "t"), false);
  assert.notEqual(s.paused, null);
  prune(s);
});

test("auto: the look-ahead is the training's setting; an older state is refused", () => {
  const s = init(EXAMINERS, [{ id: "c", plan: { farmers: 30 }, round: 0 }], { ...TRAINING, lookAhead: 6 });
  step(s, "P-1", "t");
  assert.equal(needed(s).filter((x) => x.key.startsWith("vs|")).length, 6 * SPRT.vsChunk);
  assert.throws(() => init(EXAMINERS, [], { ...TRAINING, lookAhead: 13 }), /lookAhead/);
  const old = { ...s, version: 1 } as unknown as State;
  assert.throws(() => needed(old), /version 1/);
  assert.throws(() => step(old, "P-2", "t"), /version 1/);
});
