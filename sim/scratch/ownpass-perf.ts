// SCRATCH ONLY (war-game-ai, D-154): time per tick with OWN_PASS on and off on the same machine, alternating.
//   node scratch/ownpass-perf.ts perf            perf, perf200, perf360 (6000 ticks each, 3 rounds, both arms)
//   node scratch/ownpass-perf.ts late 1,2 60     hard against hard on random maps to minute 60, both arms
// Prints Markdown.
import { OWN_PASS } from "../src/core/rules.ts";
import { Runner } from "../src/runner.ts";

type Row = { what: string; arm: string; micros: number[]; builds: number; hits: number; buildings: number; ticks: number };

function stats(m: number[]) {
  const s = [...m].sort((a, b) => a - b);
  const pick = (p: number) => (s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]);
  return { median: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: s.at(-1) ?? 0, mean: s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : 0 };
}

function play(opts: ConstructorParameters<typeof Runner>[0], on: boolean, from = 100): Omit<Row, "what" | "arm"> {
  OWN_PASS.on = on;
  const r = new Runner(opts);
  const g = r.game;
  const micros: number[] = [];
  while (!r.over && (opts.maxTicks === 0 || g.tick < opts.maxTicks)) {
    const t = r.tick(() => performance.now());
    if (g.tick > from) micros.push(t);
  }
  let buildings = 0;
  for (let s = 0; s < g.w.buildings.count; s++) if (g.w.buildings.col.owner[s] < 2) buildings++;
  return { micros, builds: g.fields.builds, hits: g.fields.hits, buildings, ticks: g.tick };
}

const mode = process.argv[2] ?? "perf";
const rows: Row[] = [];
if (mode === "perf") {
  // Warm the JIT on both paths first.
  for (const on of [false, true]) play({ seed: 1, scenario: "perf", ai: [false, false], maxTicks: 1500 } as never, on);
  for (const scenario of ["perf", "perf200", "perf360"]) {
    for (let round = 0; round < 3; round++) {
      for (const on of round % 2 === 0 ? [false, true] : [true, false]) {
        rows.push({ what: scenario, arm: on ? "on" : "off", ...play({ seed: 1, scenario, ai: [false, false], maxTicks: Number(process.env.OWNPERF_TICKS ?? 6000) } as never, on) });
      }
    }
  }
} else {
  const seeds = (process.argv[3] ?? "1,2").split(",").map(Number);
  const minutes = Number(process.argv[4] ?? 60);
  for (const seed of seeds) {
    for (const on of seed % 2 === 1 ? [false, true] : [true, false]) {
      const opts = { seed, scenario: "standard", ai: [true, true], difficulty: ["hard", "hard"], map: "random", maxTicks: minutes * 1200 } as never;
      const all = play(opts, on, 0);
      rows.push({ what: `hard-hard random s${seed} (whole game)`, arm: on ? "on" : "off", ...all });
      // From minute 30 on: the late game, most buildings.
      rows.push({ what: `hard-hard random s${seed} (minute 30 on)`, arm: on ? "on" : "off", ...all, micros: all.micros.slice(30 * 1200) });
    }
  }
}

console.log(`node ${process.versions.node}, ${process.platform} ${process.arch}\n`);
console.log("| what | arm | ticks | median µs | p95 | p99 | max | mean | field builds | field hits | buildings at end |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const s = stats(r.micros);
  console.log(`| ${r.what} | ${r.arm} | ${r.ticks} | ${s.median} | ${s.p95} | ${s.p99} | ${s.max} | ${s.mean} | ${r.builds} | ${r.hits} | ${r.buildings} |`);
}
// Each scenario's arms pooled over the rounds.
const keys = [...new Set(rows.map((r) => r.what))];
console.log("\n| what | off median | on median | ratio | off p95 | on p95 | ratio | off max | on max |");
console.log("|---|---|---|---|---|---|---|---|---|");
for (const k of keys) {
  const arm = (a: string) => stats(rows.filter((r) => r.what === k && r.arm === a).flatMap((r) => r.micros));
  const off = arm("off");
  const on = arm("on");
  const q = (a: number, b: number) => (a === 0 ? "-" : (b / a).toFixed(2));
  console.log(`| ${k} | ${off.median} | ${on.median} | ${q(off.median, on.median)} | ${off.p95} | ${on.p95} | ${q(off.p95, on.p95)} | ${off.max} | ${on.max} |`);
}
