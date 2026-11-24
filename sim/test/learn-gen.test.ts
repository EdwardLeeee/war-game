// D-147 PR C (ceo 2026-11-24): the candidates made in rounds (sim/src/ai/learn/gen.ts, hard-space.ts) and the exam
// that takes them (auto.ts), on made-up results: no games are played. The side that makes candidates must see nothing
// of the exam but who the champion is: each way that could break is a test here, and each was checked to fail when
// broken (the PR lists them).

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { HARD, type HardPlan } from "../src/ai/ai.ts";
import { checkCanary, type Examiner, init, type Item, listedSum, lookItems, needed, planHash, prune, type Res, screenItems, type State, step, type Training } from "../src/ai/learn/auto.ts";
import { checkSettings, type GenSettings, pick, propose, SCREEN, screenBase, screenExaminerSeed, screenVsSeed } from "../src/ai/learn/gen.ts";
import { type Field, fieldsOf, HARD_FIXED, HARD_SPACE, type HP, normalize, validateHard } from "../src/ai/learn/hard-space.ts";
import { blockBase, EXAM_SEEDS, isExamSeed } from "../src/ai/learn/seeds.ts";

const SIM = fileURLToPath(new URL("..", import.meta.url));
const EXAMINERS: Examiner[] = ["6-132", "2-89", "10-79"].map((id) => ({ id, plan: {} as Examiner["plan"], map: "random" }));
const GEN: GenSettings = { seed: 1, propose: 12, changes: [1, 3], screen: { examiner: 2, vs: 2 }, list: 4, minDiffer: 0.05, rounds: 2 };
const TRAINING: Training = { name: "test", first: 5, last: 60, source: "s1", lookAhead: 6, gen: GEN };
const BASELINE: HP = { farmers: 22, production: 2 };

const h32 = (text: string) => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};
const u01 = (text: string) => h32(text) / 4294967296;

/**
 * A made-up player. A field changes a game when hash(field, seed) falls under its reach: two plans play the same game on
 * a seed when they agree on every field that reaches it (dodge reaches none: a plan changing only it plays as the
 * champion; peekFirst 1% of seeds: too few differ). How strong a plan is: farmers, production and pushArmy.
 */
const REACH: Partial<Record<Field, number>> = { dodge: 0, peekFirst: 0.01 };
/** Set: no field reaches any game, so every plan plays as the champion. */
let inert = false;
function full(s: State, h: string): HardPlan {
  return { ...HARD, ...(s.plans[h] ?? {}) } as HardPlan;
}
const strength = (p: HardPlan) => (p.farmers - 32) * 0.006 + (p.production - 4) * 0.03 + (p.pushArmy - 44) * 0.002;
/** Every game played, by key (what a segment would have cost). */
const played = new Set<string>();
function play(s: State, items: Item[]) {
  for (const x of items) {
    played.add(x.key);
    if (x.key.startsWith("canary|")) continue;
    const [kind, me, opp, seedText, swap] = x.key.split("|");
    const seed = Number(seedText);
    let res: Res;
    if (kind === "ex" || kind === "sx") {
      const p = full(s, me);
      const sig = (Object.keys(HARD) as Field[]).filter((f) => !inert && p[f] !== HARD[f] && u01(`${f}|${seed}`) < (REACH[f] ?? 0.3)).map((f) => `${f}=${JSON.stringify(p[f])}`).join(",");
      const sigPlan = { ...HARD } as HardPlan;
      for (const part of sig === "" ? [] : sig.split(",")) {
        const [f, v] = part.split("=");
        (sigPlan as unknown as Record<string, unknown>)[f] = JSON.parse(v);
      }
      const u = u01(`${sig}|${opp}|${seed}`);
      res = { w: u < 0.3 - strength(sigPlan) ? 1 : u > 0.98 ? -1 : 0, h: `${sig}|${opp}|${seed}` };
    } else if (kind === "aa") {
      const u = u01(`${me}|${seed}`);
      const w = u < 0.02 ? -1 : u < 0.51 ? 1 : 0;
      res = { w: w === -1 || swap === "0" ? w : 1 - w, h: `${me}-${seed}` };
    } else if (kind === "vs" || kind === "sv" || kind === "bl") {
      const d = strength(full(s, me)) - strength(full(s, opp));
      const u = u01(x.key);
      res = { w: u < 0.02 ? -1 : u < 0.02 + 0.98 * Math.min(0.95, Math.max(0.05, 0.5 + d)) ? 1 : 0, h: x.key };
    } else res = { w: u01(x.key) < 0.92 ? 1 : 0, h: x.key, reached: u01(`r${x.key}`) < 0.6, thinks: 100, ms: 100 };
    s.results[x.key] = res;
  }
}

/** Segments until done or paused: each plays what is needed (by `jobs` jobs, each a part of its share) and merges. */
function run(s: State, opts: { jobs?: number; seed?: number; most?: number } = {}): void {
  const jobs = opts.jobs ?? 1;
  for (let seg = 0; seg < (opts.most ?? 3000) && s.paused === null && !s.done; seg++) {
    const all = needed(s).filter((x) => !x.key.startsWith("canary|"));
    for (let k = 0; k < jobs; k++) {
      const mine = all.filter((_, i) => i % jobs === k);
      play(s, jobs === 1 ? mine : mine.slice(0, Math.ceil(mine.length * (0.3 + 0.7 * u01(`${opts.seed ?? 0}|${seg}|${k}`)))));
    }
    checkCanary(s, ["a", "b", "c"], "tree", "commit", `P-${seg}`, "t");
    step(s, `P-${seg}`, `t${seg}`);
  }
}
const clone = (s: State): State => JSON.parse(JSON.stringify(s));

test("hard-space: every field of hard's plan is either searched or fixed, with why; hard itself is a valid plan", () => {
  const all = fieldsOf();
  for (const f of all) assert.ok((HARD_SPACE[f] === undefined) !== (HARD_FIXED[f] === undefined), `${f}: searched or fixed, exactly one`);
  for (const f of [...Object.keys(HARD_SPACE), ...Object.keys(HARD_FIXED)]) assert.ok((all as string[]).includes(f) || f === "netLog" || f === "netSeen", `${f} is not a field of HARD`);
  for (const [f, sp] of Object.entries(HARD_SPACE)) {
    assert.ok(sp!.why.length > 10, `${f}: a reason`);
    const v = HARD[f as Field];
    if (sp!.type === "int") {
      assert.equal(typeof v, "number", f);
      assert.ok(sp!.min <= (v as number) && (v as number) <= sp!.max, `${f}: hard's ${v} inside ${sp!.min}-${sp!.max}`);
      assert.ok(sp!.step > 0 && sp!.min < sp!.max, f);
    } else assert.equal(typeof v, "boolean", f);
  }
  for (const [f, why] of Object.entries(HARD_FIXED)) assert.ok(why!.length > 5, `${f}: why it is fixed`);
  assert.equal(validateHard({}), "");
  assert.equal(validateHard(BASELINE), "");
});

test("hard-space: what is out of range, off its steps, fixed, or crossing fields is refused (no march of 0 soldiers)", () => {
  for (const [p, why] of [
    [{ pushArmy: 0 }, /outside/],
    [{ pushArmy: 33 }, /outside/],
    [{ townArmy: 0 }, /outside/],
    [{ farmers: 23 }, /off its steps/],
    [{ farAvoid: false }, /never changed/],
    [{ net: null, netMarch: 3 }, /never changed/],
    [{ dodge: 1 }, /not true or false/],
    [{ farmers: 22.5 }, /whole number/],
    [{ keepTownArmy: 16, keepBigArmy: 14 }, /keepTownArmy 16 over/],
  ] as [HP, RegExp][]) assert.match(validateHard(p), why, JSON.stringify(p));
  assert.equal(validateHard({ pushArmy: 34 }), "");
});

test("gen: proposals are valid, new, 1-3 fields from the champion, only fields that can act, the same each time", () => {
  for (const champion of [{}, BASELINE, { cavalryCounter: 0 }] as HP[]) {
    const before = new Set(propose(champion, 3, GEN, new Set()).plans.slice(0, 3).map(planHash));
    const a = propose(champion, 4, GEN, before);
    assert.deepEqual(propose(champion, 4, GEN, before), a, "the same from the same");
    assert.equal(a.plans.length, GEN.propose);
    const c = { ...HARD, ...champion } as HardPlan;
    for (const p of a.plans) {
      assert.equal(validateHard(p), "");
      assert.ok(!before.has(planHash(p)) && planHash(p) !== planHash(normalize(champion)));
      const changed = (Object.keys(HARD) as Field[]).filter((f) => ({ ...HARD, ...p } as HardPlan)[f] !== c[f]);
      assert.ok(changed.length >= 1 && changed.length <= 3, JSON.stringify(p));
      // With cavalryCounter 0, what needs it does nothing: never changed.
      if (champion.cavalryCounter === 0) assert.ok(!changed.includes("cavalryWhen") && !changed.includes("charge"), JSON.stringify(p));
    }
  }
  // Another round, another training's seed, another champion: other proposals.
  const a = propose({}, 1, GEN, new Set()).plans.map(planHash);
  assert.notDeepEqual(propose({}, 2, GEN, new Set()).plans.map(planHash), a);
  assert.notDeepEqual(propose({}, 1, { ...GEN, seed: 2 }, new Set()).plans.map(planHash), a);
  assert.notDeepEqual(propose(BASELINE, 1, GEN, new Set()).plans.map(planHash), a);
});

test("gen: each round screens on seeds of its own, in the training's range, never an exam seed (ceo 2026-11-24)", () => {
  const seen = new Map<number, string>();
  for (const seed of [0, 1, SCREEN.seeds - 1]) {
    for (let round = 0; round < SCREEN.rounds; round++) {
      const seeds = [...Array.from({ length: 3 * SCREEN.examinerMost }, (_, i) => screenExaminerSeed(seed, round, Math.floor(i / SCREEN.examinerMost), i % SCREEN.examinerMost)), ...Array.from({ length: SCREEN.vsMost }, (_, j) => screenVsSeed(seed, round, j))];
      for (const x of seeds) {
        assert.ok(x >= EXAM_SEEDS.training && !isExamSeed(x) && x < 2 ** 31, `${x}`);
        assert.equal(seen.get(x), undefined, `seed ${x} in two rounds (${seen.get(x)} and ${seed}/${round})`);
        seen.set(x, `${seed}/${round}`);
      }
    }
  }
  assert.throws(() => screenBase(1, SCREEN.rounds));
  assert.throws(() => checkSettings({ ...GEN, rounds: SCREEN.rounds }, 3));
});

test("gen: the list takes only this round's screening games, drops what plays as the champion, ranks the rest", () => {
  const plans = ["a", "b", "c", "d"];
  const g = { ...GEN, list: 2 };
  const games = [];
  for (const [p, differ, d] of [["a", 6, 3], ["b", 6, 1], ["c", 0, 0], ["d", 6, 5]] as const) {
    for (let e = 0; e < 3; e++) for (let i = 0; i < 2; i++) games.push({ plan: p, kind: "ex" as const, seed: screenExaminerSeed(1, 7, e, i), differ: e * 2 + i < differ, d: e * 2 + i < d ? 1 : 0 });
  }
  const r = pick(plans, games, g, 7);
  assert.deepEqual(r.list, ["d", "a"]);
  assert.equal(r.same, 1);
  // An exam seed, another round's seed, a plan not proposed: refused.
  assert.throws(() => pick(plans, [{ plan: "a", kind: "ex", seed: blockBase(5), differ: true, d: 1 }], g, 7), /exam's seed/);
  assert.throws(() => pick(plans, [{ plan: "a", kind: "ex", seed: screenExaminerSeed(1, 8, 0, 0), differ: true, d: 1 }], g, 7), /not one of round 7/);
  assert.throws(() => pick(plans, [{ plan: "z", kind: "ex", seed: screenExaminerSeed(1, 7, 0, 0), differ: true, d: 1 }], g, 7), /not proposed/);
  // Too few differing: dropped.
  assert.equal(pick(["a"], [{ plan: "a", kind: "ex", seed: screenExaminerSeed(1, 7, 0, 0), differ: true, d: 1 }, ...Array.from({ length: 5 }, (_, i) => ({ plan: "a", kind: "ex" as const, seed: screenExaminerSeed(1, 7, 1, i % 2) + (i >= 2 ? 0 : 0), differ: false, d: 0 }))], { ...g, minDiffer: 0.5 }, 7).few, 1);
});

test("auto with gen: the list, then rounds made from the champion, one block each, the A/A only where something is listed", () => {
  played.clear();
  const s = init(EXAMINERS, [{ id: "hard", plan: {}, round: 0 }], TRAINING, BASELINE);
  run(s);
  assert.ok(s.done, s.log.at(-1)?.what ?? "");
  assert.equal(s.genRounds, GEN.rounds);
  // hard beats the baseline (fake strength): promoted, a new block (listed 0), then a block for each round's list.
  assert.equal(s.decided[0].id, "hard");
  assert.equal(s.decided[0].verdict, "promote");
  const rounds = s.blocks.filter((b) => b.why.startsWith("第 "));
  assert.equal(rounds.length, GEN.rounds);
  assert.ok(rounds.every((b) => b.listed >= 1 && b.listed <= GEN.list));
  assert.equal(listedSum(s), s.blocks.reduce((a, b) => a + b.listed, 0));
  assert.equal(listedSum(s), 1 + rounds.reduce((a, b) => a + b.listed, 0));
  // Every listed candidate examined in its round's block; no A/A on a block with no list, not even played.
  for (const d of s.decided.slice(1)) assert.equal(s.blocks.find((b) => b.n === d.block)!.why, `第 ${d.id.slice(1, d.id.indexOf("-"))} 輪`);
  for (const b of s.blocks) assert.equal(s.aa[b.n] !== undefined, b.listed > 0, `block ${b.n}`);
  const empty = s.blocks.filter((b) => b.listed === 0).map((b) => blockBase(b.n));
  assert.ok(empty.length > 0);
  for (const k of played) {
    const seed = Number(k.split("|")[3]);
    if (k.startsWith("aa|")) assert.ok(!empty.some((b) => seed >= b && seed < b + EXAM_SEEDS.blockSize), `A/A played on a block with no list: ${k}`);
  }
  // Proposed once each, the list's candidates among them.
  assert.equal(new Set(s.proposed).size, s.proposed.length);
  assert.ok(s.decided.every((d) => s.proposed.includes(d.hash)));
});

test("auto with gen: screening games are this round's alone, and nothing of them or of the old blocks is kept after", () => {
  const s = init(EXAMINERS, [], TRAINING, BASELINE);
  const byRound = new Map<number, Set<number>>();
  for (let seg = 0; seg < 3000 && !s.done && s.paused === null; seg++) {
    const items = needed(s);
    for (const x of items) {
      const [kind, , , seed] = x.key.split("|");
      if (kind !== "sx" && kind !== "sv") continue;
      assert.notEqual(s.screen, null);
      const set = byRound.get(s.screen!.round) ?? new Set();
      set.add(Number(seed));
      byRound.set(s.screen!.round, set);
      assert.ok(!isExamSeed(Number(seed)));
    }
    play(s, items);
    step(s, `P-${seg}`, "t");
    if (s.screen === null) assert.ok(!Object.keys(s.results).some((k) => k.startsWith("sx|") || k.startsWith("sv|")), "screening results dropped once listed");
    const open = blockBase(s.blocks.at(-1)!.n);
    for (const k of Object.keys(s.results)) {
      const [kind, , , seed] = k.split("|");
      if (kind !== "bl" && kind !== "sx" && kind !== "sv") assert.ok(Number(seed) >= open && Number(seed) < open + EXAM_SEEDS.blockSize, `kept from a closed block: ${k}`);
    }
  }
  assert.ok(s.done);
  const rounds = [...byRound.values()];
  assert.equal(rounds.length, GEN.rounds);
  for (let i = 0; i < rounds.length; i++) for (let j = i + 1; j < rounds.length; j++) for (const x of rounds[i]) assert.ok(!rounds[j].has(x), `seed ${x} screened in two rounds`);
});

/**
 * A finished training of two listed candidates, whose results and decisions are put into a fresh state (exam history).
 * They are the first two the generator would propose in round 1, so leaving any out of "proposed before" shows.
 */
function history(): State {
  const first = propose(BASELINE, 1, GEN, new Set([planHash(normalize(BASELINE))])).plans.slice(0, 2);
  const t = init(EXAMINERS, first.map((plan, i) => ({ id: `h${i}`, plan, round: 0 })), { ...TRAINING, gen: undefined }, BASELINE);
  run(t);
  assert.ok(t.done);
  return t;
}

/** The first round's list of a fresh state with `exam` put in: what the exam showed, nothing of who the champion is. */
function listWith(edit: (s: State) => void): { proposed: string[]; queue: string[] } {
  const hist = history();
  const s = init(EXAMINERS, [], TRAINING, BASELINE);
  // What was proposed before (the same in every case): the two plans the history examined.
  s.proposed.push(...hist.decided.map((d) => d.hash));
  for (const d of hist.decided) s.plans[d.hash] = hist.plans[d.hash];
  s.genRound = 1;
  edit(s);
  for (let seg = 0; seg < 50 && s.queue.length === 0 && !s.done; seg++) {
    play(s, needed(s));
    step(s, `P-${seg}`, "t");
  }
  return { proposed: [...s.proposed], queue: s.queue.map((c) => planHash(c.plan)) };
}

test("auto with gen: what the exam showed changes nothing of the list; who the champion is does", () => {
  const hist = history();
  const none = listWith(() => {});
  assert.ok(none.queue.length > 0);
  // The exam's results, decisions, A/A, base and log put in, as they were, turned the other way round (promoted read as
  // rejected: ceo 2026-11-24), or scrambled: the very same proposals and list.
  const put = (s: State, h: State) => {
    s.decided = h.decided;
    s.tested = h.tested;
    s.aa = h.aa;
    s.base = h.base;
    s.log.push(...h.log);
    for (const [k, v] of Object.entries(h.results)) if (!k.startsWith("sx|") && !k.startsWith("sv|")) s.results[k] = v;
    s.roundsWithout = 0;
  };
  const flipped = clone(hist);
  for (const d of flipped.decided) d.verdict = d.verdict === "promote" ? "reject" : "promote";
  const scrambled = clone(hist);
  for (const r of Object.values(scrambled.results)) r.w = r.w === 1 ? 0 : 1;
  for (const d of scrambled.decided) Object.assign(d, { q: 1 - d.q, qb: 0, looks: d.looks + 7, why: "x" });
  for (const h of [hist, flipped, scrambled]) assert.deepEqual(listWith((s) => put(s, clone(h))), none);
  // Control: another champion, another list (the test can fail).
  assert.notDeepEqual(listWith((s) => {
    s.plans[planHash({})] = {};
    s.champion = planHash({});
    s.blocks[0].champion = s.champion;
  }).queue, none.queue);
});

test("auto with gen: the same state makes the same list (each job steps it as the merge does)", () => {
  const s = init(EXAMINERS, [], TRAINING, BASELINE);
  for (let seg = 0; seg < 50 && s.queue.length === 0; seg++) {
    play(s, needed(s));
    const a = clone(s);
    const b = clone(s);
    step(s, "P-1", "t");
    step(a, "P-1", "t");
    step(b, "P-2", "u");
    assert.deepEqual(a.queue, s.queue);
    assert.deepEqual(b.queue, s.queue);
    assert.deepEqual(b.proposed, s.proposed);
  }
  assert.ok(s.queue.length > 0);
});

test("auto with gen: how many jobs a segment has changes nothing played or decided", () => {
  const go = (jobs: number) => {
    const s = init(EXAMINERS, [{ id: "hard", plan: {}, round: 0 }], TRAINING, BASELINE);
    run(s, { jobs, seed: jobs });
    return { decided: s.decided.map((d) => ({ id: d.id, hash: d.hash, verdict: d.verdict, looks: d.looks, block: d.block, ex: d.ex, vs: d.vs })), proposed: s.proposed, blocks: s.blocks.map((b) => [b.n, b.champion, b.listed]), done: s.done };
  };
  const one = go(1);
  assert.ok(one.done && one.decided.length > 2);
  assert.deepEqual(go(3), one);
  assert.deepEqual(go(16), one);
});

test("auto with gen: the next candidate's first looks are listed with the current one's, and kept", () => {
  const s = init(EXAMINERS, [], TRAINING, BASELINE);
  for (let seg = 0; seg < 50 && s.current === null; seg++) {
    play(s, needed(s));
    step(s, `P-${seg}`, "t");
  }
  assert.ok(s.current !== null && s.queue.length > 0, "a candidate under exam with others waiting");
  const items = needed(s);
  const next = planHash(s.queue[0].plan);
  const of = (h: string) => new Set(items.filter((x) => x.key.split("|")[1] === h && (x.key.startsWith("ex|") || x.key.startsWith("vs|"))).map((x) => x.key));
  const half = Math.ceil(TRAINING.lookAhead! / 2);
  assert.equal(of(s.current!.hash).size, lookItems(s, s.current!.hash, 0).filter((x) => x.key.split("|")[1] === s.current!.hash).length * half);
  assert.ok(of(next).size > 0, "the next one's first looks");
  play(s, items);
  prune(s);
  for (const k of of(next)) assert.ok(s.results[k] !== undefined, `kept: ${k}`);
  // Played, they are not listed again.
  assert.ok(!needed(s).some((x) => of(next).has(x.key)));
});

test("auto with gen: a round with no one listed counts as a round with no promotion; the rounds end it", () => {
  // Every proposal plays as the champion: nothing is listed.
  const s = init(EXAMINERS, [], { ...TRAINING, gen: { ...GEN, rounds: 12 } }, BASELINE);
  inert = true;
  try {
    run(s);
  } finally {
    inert = false;
  }
  assert.equal(s.paused?.kind, "rounds");
  assert.equal(s.queue.length, 0);
  assert.ok(s.genRounds >= 10 && s.blocks.length === 1, `rounds ${s.genRounds}, blocks ${s.blocks.length}`);
  assert.deepEqual(s.aa, {}, "no A/A on a block with nothing listed");
  const t = init(EXAMINERS, [], { ...TRAINING, gen: { ...GEN, rounds: 1 } }, BASELINE);
  run(t);
  assert.ok(t.done);
  assert.equal(t.genRounds, 1);
});

test("gen: the generator's files are its whole import closure in learn/, listed in its config (ceo 2026-11-24)", () => {
  const closure = new Set<string>();
  const walk = (file: string) => {
    const rel = relative(SIM, file);
    if (closure.has(rel)) return;
    closure.add(rel);
    for (const m of readFileSync(file, "utf8").matchAll(/^import [^;]*? from "(\.[^"]+)";/gm)) {
      const to = resolve(dirname(file), m[1]);
      if (to.includes("/src/ai/learn/")) walk(to);
      else closure.add(relative(SIM, to));
    }
  };
  walk(join(SIM, "src/ai/learn/gen.ts"));
  assert.deepEqual([...closure].sort(), ["src/ai/ai.ts", "src/ai/learn/gen.ts", "src/ai/learn/hard-space.ts", "src/ai/learn/seeds.ts"]);
  for (const f of ["gen.ts", "hard-space.ts"]) {
    const text = readFileSync(join(SIM, "src/ai/learn", f), "utf8");
    assert.ok(!/from "\.\/(auto|exam-auto|sprt|pool|worker|exam)\.ts"/.test(text) && !/node:fs/.test(text), `${f} takes nothing of the exam's`);
  }
  const config = JSON.parse(readFileSync(join(SIM, "src/ai/learn/auto-trial-c1.json"), "utf8"));
  assert.deepEqual([...config.generator].sort(), [...closure].sort());
});

test("auto with gen: screening items only while screening, and none of them an exam seed", () => {
  const s = init(EXAMINERS, [], TRAINING, BASELINE);
  assert.deepEqual(screenItems(s), []);
  step(s, "P-0", "t");
  assert.notEqual(s.screen, null);
  const items = screenItems(s);
  // Each proposal 3 x 2 examiner games and 2 seeds from both spawns; the champion's examiner games once.
  assert.equal(items.length, s.screen!.plans.length * (3 * 2 + 2 * 2) + 3 * 2);
  for (const x of items) assert.ok(!isExamSeed(x.job.kind === "scripted" ? x.job.seed : x.job.spec.seed));
});
