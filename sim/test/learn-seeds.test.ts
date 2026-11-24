// D-147 PR B (ceo 2026-11-23): the exam's seeds are refused at every program that takes seeds but the exam itself, and
// a training's blocks are its own. No games are played.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { Pool, runAll, runPlays } from "../src/ai/learn/pool.ts";
import { blockBase, EXAM_SEEDS, isExamSeed, refuseExamSeeds } from "../src/ai/learn/seeds.ts";
import type { Job } from "../src/ai/learn/worker.ts";

const SIM = fileURLToPath(new URL("..", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "exam-seeds-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const node = (...args: string[]) => {
  const r = spawnSync(process.execPath, args, { cwd: SIM, encoding: "utf8", env: { ...process.env, GITHUB_OUTPUT: "", YIELD_REPO: "" }, timeout: 60_000 });
  return { code: r.status, text: `${r.stdout}${r.stderr}` };
};
const job = (seed: number): Job => ({ kind: "play", spec: { seed, map: "random", swap: false, maxTicks: 1, opp: { kind: "normal" } }, net: null });

test("seeds: what is kept for the exam", () => {
  for (const s of [9_000_000, 9_100_001, EXAM_SEEDS.fixed, blockBase(1), blockBase(999) + 9_999]) assert.ok(isExamSeed(s), `${s}`);
  for (const s of [1, 2_000_001, 5_200_000, 8_999_999, EXAM_SEEDS.training]) assert.ok(!isExamSeed(s), `${s}`);
  assert.equal(blockBase(999) + EXAM_SEEDS.blockSize - 1, EXAM_SEEDS.last);
  assert.throws(() => blockBase(0));
  assert.throws(() => blockBase(1000));
  assert.throws(() => refuseExamSeeds([5, 10_010_000], "x"), /kept for the automatic exam/);
});

test("seeds: every way into the pool refuses them, but the exam's", async () => {
  const bad = job(blockBase(1));
  await assert.rejects(runAll([bad], 1), /kept for the automatic exam/);
  await assert.rejects(runPlays([bad], 1), /kept for the automatic exam/);
  const plain = new Pool(1);
  await assert.rejects(plain.run([bad]), /kept for the automatic exam/);
  await plain.close();
  const exam = new Pool(1, { exam: true });
  // Stopped before the first game: let in, none played.
  assert.equal((await exam.run([bad], () => true)).stopped, true);
  await exam.close();
});

test("seeds: only the exam's runner opens them", () => {
  const opens: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && /new Pool\([^;]*exam: *true/.test(readFileSync(p, "utf8"))) opens.push(e.name);
    }
  };
  walk(join(SIM, "src"));
  assert.deepEqual(opens, ["exam-auto.ts"]);
});

const ENTRIES: [string, string[]][] = [
  ["exam.ts check --seed-from", ["src/ai/learn/exam.ts", "check", "--seed-from", "9000001", "--out", join(dir, "check")]],
  ["exam.ts check running into them", ["src/ai/learn/exam.ts", "check", "--seed-from", "8999990", "--games", "20", "--out", join(dir, "check2")]],
  ["exam.ts search --seed-offset", ["src/ai/learn/exam.ts", "search", "--seed", "1", "--seed-offset", "500", "--out", join(dir, "search")]],
  ["train.ts eval --seed", ["src/ai/learn/train.ts", "eval", "--seed", "10010000", "--out", join(dir, "eval")]],
  ["scripted-games --seeds", ["src/scripted-games.ts", "--seeds", "10010000-10010002"]],
  ["ai-timeline --seed", ["src/ai-timeline.ts", "--seed", "10010000"]],
  ["ai-timeline --seeds", ["src/ai-timeline.ts", "--seeds", "8999999-9000001"]],
  ["continue-bench --seed", ["src/continue-bench.ts", "--seed", "10010000"]],
  ["headless --seed", ["src/headless.ts", "--seed", "10010000"]],
  ["map-grid --seed", ["src/map-grid.ts", "--map", "random", "--seed", "10010000"]],
];
for (const [name, args] of ENTRIES) {
  test(`seeds: ${name} refuses them`, () => {
    const r = node(...args);
    assert.notEqual(r.code, 0);
    assert.match(r.text, /kept for the automatic exam/);
  });
}

test("seeds: each training in exam-blocks.json has blocks no other has", () => {
  const { trainings } = JSON.parse(readFileSync(join(SIM, "src/ai/learn/exam-blocks.json"), "utf8")) as { trainings: Record<string, { first: number; last: number; source: string }> };
  const given = new Map<number, string>();
  for (const [name, t] of Object.entries(trainings)) {
    assert.ok(1 <= t.first && t.first <= t.last && t.last <= EXAM_SEEDS.blocks, name);
    assert.match(t.source, /^[0-9a-f]{12}$/);
    for (let n = t.first; n <= t.last; n++) {
      assert.equal(given.get(n), undefined, `block ${n}: ${given.get(n)} and ${name}`);
      given.set(n, name);
    }
  }
});

test("exam-auto: starts only a registered training with its own settings; refuses an older state", () => {
  const file = "src/ai/learn/auto-config.json";
  const out = join(dir, "state.json");
  const ok = node("src/ai/learn/exam-auto.ts", "init", "--config", file, "--out", out);
  assert.equal(ok.code, 0, ok.text);
  assert.ok(existsSync(out));
  const config = JSON.parse(readFileSync(join(SIM, file), "utf8"));
  const write = (name: string, c: object) => {
    writeFileSync(join(dir, name), JSON.stringify(c));
    return join(dir, name);
  };
  // The note is no setting; a candidate more is.
  assert.equal(node("src/ai/learn/exam-auto.ts", "init", "--config", write("note.json", { ...config, note: "other words" }), "--out", join(dir, "n.json")).code, 0);
  const other = write("other.json", { ...config, candidates: [...config.candidates, { id: "x", plan: { farmers: 30 }, round: 0 }] });
  assert.match(node("src/ai/learn/exam-auto.ts", "init", "--config", other, "--out", join(dir, "o.json")).text, /not those registered/);
  assert.match(node("src/ai/learn/exam-auto.ts", "init", "--config", write("new.json", { ...config, name: "nowhere" }), "--out", join(dir, "w.json")).text, /not in exam-blocks\.json/);
  const old = write("old.json", { ...JSON.parse(readFileSync(out, "utf8")), version: 1 });
  for (const mode of ["work", "merge"]) assert.match(node("src/ai/learn/exam-auto.ts", mode, "--state", old, "--config", file, "--out", join(dir, mode, "s.json")).text, /exam state version 1/);
});

test("exam-auto: settings changed under a training reach the state through merge", () => {
  const file = "src/ai/learn/auto-config.json";
  const state = join(dir, "m.json");
  assert.equal(node("src/ai/learn/exam-auto.ts", "init", "--config", file, "--out", state).code, 0);
  const changed = join(dir, "changed.json");
  writeFileSync(changed, JSON.stringify({ ...JSON.parse(readFileSync(join(SIM, file), "utf8")), lookAhead: 5 }));
  const merged = join(dir, "merged", "state.json");
  const r = node("src/ai/learn/exam-auto.ts", "merge", "--state", state, "--config", changed, "--out", merged, "--pause-id", "P-test");
  assert.equal(r.code, 0, r.text);
  const s = JSON.parse(readFileSync(merged, "utf8")) as { blocks: { n: number; why: string }[] };
  assert.equal(s.blocks.length, 2);
  assert.match(s.blocks[1].why, /產生候選的程式或設定改了/);
});
