// D-147 step 4 (PR B): the automatic exam (sim/src/ai/learn/auto.ts) on made-up results: no games are played. A fake
// player gives each plan a strength; the state is moved on look by look as the merge job would.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTO, checkCanary, type Examiner, FINAL, type HP, init, type Item, MAX_LOOKS, needed, type Pause, planHash, type Res, resume, SEEDS, type State, step } from "../src/ai/learn/auto.ts";
import { rng } from "../src/ai/learn/exam-space.ts";
import { SPRT } from "../src/ai/learn/sprt.ts";

const EXAMINERS: Examiner[] = ["6-132", "2-89", "10-79"].map((id) => ({ id, plan: {} as Examiner["plan"], map: "random" }));

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
    } else if (kind === "vs" || kind === "aa" || kind === "bl") {
      const d = kind === "aa" ? 0 : f(me).edge - f(opp).edge;
      const u = r();
      res = { w: u < 0.02 ? -1 : u < 0.02 + 0.98 * (0.5 + d) ? 1 : 0, h: `${x.key}` };
    } else {
      const m = f(me);
      res = { w: r() < (m.normal ?? 0.9) ? 1 : 0, h: x.key, reached: r() < (m.reached ?? 0.6), thinks: 100, ms: 100 * (m.think ?? 1) };
    }
    void swap;
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

test("auto: the seed ranges do not overlap, nor touch the search's and CI's", () => {
  const ranges: [string, number, number][] = [
    ["ex", SEEDS.ex, SEEDS.ex + SEEDS.exCount - 1],
    ["vs", SEEDS.vs, SEEDS.vs + SEEDS.vsCount - 1],
    ["aa", SEEDS.aa, SEEDS.aa + SEEDS.aaCount - 1],
    ["normalFixed", SEEDS.normalFixed, SEEDS.normalFixed + SEEDS.normalCount - 1],
    ["normalRandom", SEEDS.normalRandom, SEEDS.normalRandom + SEEDS.normalCount - 1],
    ["base", SEEDS.base, SEEDS.base + SEEDS.baseCount - 1],
    ["canary", SEEDS.canary, SEEDS.canary + SEEDS.canaryCount - 1],
  ];
  for (const [a, lo, hi] of ranges) {
    assert.ok(lo >= 9_000_000 && hi < SEEDS.training, a);
    for (const [b, lo2, hi2] of ranges) if (a !== b) assert.ok(hi < lo2 || hi2 < lo, `${a} and ${b}`);
  }
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
  ]);
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
  const s = init(EXAMINERS, [{ id: "twin", plan: twin, round: 0 }]);
  run(s, { [planHash(twin)]: { exWins: 0.3, edge: 0, as: planHash({}) } });
  assert.equal(s.decided[0].verdict, "reject");
  assert.equal(s.decided[0].looks, 1);
  assert.match(s.decided[0].why, /一模一樣/);
});

test("auto: the finalist's checks can stop a promotion", () => {
  const slow: HP = { pushArmy: 98 };
  const s = init(EXAMINERS, [{ id: "slow", plan: slow, round: 0 }]);
  run(s, { [planHash(slow)]: { exWins: 0.3, edge: 0.1, think: FINAL.thinkRatio + 0.5 } });
  assert.equal(s.decided[0].verdict, "reject");
  assert.match(s.decided[0].why, /思考時間/);
  assert.equal(s.champion, s.baseline);
  const weakNormal: HP = { pushArmy: 97 };
  const t = init(EXAMINERS, [{ id: "weak-normal", plan: weakNormal, round: 0 }]);
  run(t, { [planHash(weakNormal)]: { exWins: 0.3, edge: 0.1, normal: 0.6 } });
  assert.match(t.decided[0].why, /對普通/);
});

test("auto: needed lists the canary always, nothing twice, nothing once paused", () => {
  const s = init(EXAMINERS, [{ id: "c", plan: { farmers: 30 }, round: 0 }]);
  step(s, "P-1", "t");
  const items = needed(s);
  assert.equal(items.filter((x) => x.key.startsWith("canary|")).length, SEEDS.canaryCount);
  assert.equal(new Set(items.map((x) => x.key)).size, items.length);
  // The champion's A/A and the candidate's first AUTO.lookAhead looks.
  assert.equal(items.filter((x) => x.key.startsWith("aa|")).length, SEEDS.aaCount * 2);
  assert.equal(items.filter((x) => x.key.startsWith("vs|")).length, AUTO.lookAhead * SPRT.vsChunk);
  s.paused = { id: "P-1", kind: "max", reason: "", numbers: [], at: "" };
  assert.deepEqual(needed(s), []);
});

test("auto: the A/A control pauses when it leans", () => {
  const s = init(EXAMINERS, [{ id: "c", plan: { farmers: 30 }, round: 0 }]);
  step(s, "P-1", "t");
  for (const x of needed(s)) if (x.key.startsWith("aa|")) s.results[x.key] = { w: x.key.endsWith("|0") ? 1 : Number(x.key.split("|")[3]) % 3 === 0 ? 0 : 1, h: x.key };
  step(s, "P-7", "t");
  assert.equal(pausedOf(s)?.id, "P-7");
  assert.match(pausedOf(s)!.reason, /自己打自己/);
});

test("auto: the canary's hashes changing pauses; only the code changing is noted", () => {
  const s = init(EXAMINERS, [{ id: "c", plan: { farmers: 30 }, round: 0 }]);
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
  const t = init(EXAMINERS, [{ id: "x", plan: { farmers: 99 }, round: 0 }]);
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
  const s = init(EXAMINERS, plans.map((plan, i) => ({ id: `c${i}`, plan, round: i })));
  run(s, Object.fromEntries(plans.map((p) => [planHash(p), { exWins: 0.3, edge: -0.2 } as Fake])));
  assert.match(s.paused?.reason ?? "", new RegExp(`連續 ${AUTO.roundsWithout} 輪`));
  assert.equal(s.tested, AUTO.roundsWithout);
  // The candidate that would start the eleventh round waits in the queue.
  assert.equal(s.queue[0].id, `c${AUTO.roundsWithout}`);
  const t = init(EXAMINERS, []);
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
  ]);
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
