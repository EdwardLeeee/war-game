// SCRATCH ONLY (war-game-ai, D-154; ceo 2026-11-18): time per tick from one and the same late position, OWN_PASS off
// and on. The game is played with the rule off up to minute T (the same position both times: the simulation and the
// players are deterministic), then the next K minutes once with the rule still off and once switched on.
//   node scratch/samestate-perf.ts ai 1,2,3 20 3        hard against hard, random maps, from minute 20 for 3 minutes
//   node scratch/samestate-perf.ts turtle 1,2,3 35 3    the scripted turtle against hard (many buildings both sides)
// Prints Markdown.
import { OWN_PASS, rules } from "../src/core/rules.ts";
import { Runner } from "../src/runner.ts";
import { createScriptedPlayer, SCRIPTED_THINK_EVERY } from "../src/ai/scripted-player.ts";
import { scriptedArgs } from "../src/scripted-args.ts";
import { buildView } from "../src/view/view.ts";

const [mode = "ai", seedText = "1,2,3", tText = "20", kText = "3"] = process.argv.slice(2);
const T = Number(tText) * 1200;
const K = Number(kText) * 1200;

function stats(m: number[]) {
  const s = [...m].sort((a, b) => a - b);
  const pick = (p: number) => (s.length === 0 ? 0 : s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]);
  return { median: pick(0.5), p95: pick(0.95), p99: pick(0.99), max: s.at(-1) ?? 0, mean: s.length ? Math.round(s.reduce((a, b) => a + b, 0) / s.length) : 0 };
}

/** Plays seed to T with the rule off, then K ticks with the rule `on`; the K ticks' times, or null if the game ended first. */
function play(seed: number, on: boolean) {
  OWN_PASS.on = false;
  const ai = mode === "ai";
  const r = new Runner({ seed, scenario: "standard", ai: ai ? [true, true] : [false, true], difficulty: ["hard", "hard"], map: ai ? "random" : "fixed", maxTicks: 0 } as never);
  const g = r.game;
  const w = g.w;
  const player = ai ? null : createScriptedPlayer(0, { map: w.map, rules: rules(w.map), frame: w.map.frames[0] }, scriptedArgs(["--strategy", "push", "--speed", "h1", "--formation", "close", "--turtle"]).plan);
  let seq = 0;
  const step = (time: boolean) => {
    if (player !== null && w.tick % SCRIPTED_THINK_EVERY === 0) for (const body of player.think(buildView(g, 0))) r.command(0, { ...body, seq: seq++ } as never);
    return r.tick(time ? () => performance.now() : undefined);
  };
  while (!r.over && w.tick < T) step(false);
  if (r.over) return null;
  let buildings = 0;
  for (let s = 0; s < w.buildings.count; s++) if (w.buildings.col.owner[s] < 2) buildings++;
  const units = w.units.count;
  const hash = g.hash();
  OWN_PASS.on = on;
  const micros: number[] = [];
  while (!r.over && w.tick < T + K) micros.push(step(true));
  return { micros, buildings, units, hash, builds: g.fields.builds };
}

console.log(`node ${process.versions.node}, ${process.platform} ${process.arch}; ${mode}, from minute ${T / 1200} for ${K / 1200} minutes\n`);
console.log("| seed | arm | position at T (hash) | buildings | units | ticks timed | median µs | p95 | p99 | max | mean | field builds (whole game) |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
const all: Record<string, number[]> = { off: [], on: [] };
for (const seed of seedText.split(",").map(Number)) {
  for (const on of seed % 2 === 1 ? [false, true] : [true, false]) {
    const x = play(seed, on);
    if (x === null) {
      console.log(`| ${seed} | ${on ? "on" : "off"} | ended before minute ${T / 1200} | | | | | | | | | |`);
      continue;
    }
    all[on ? "on" : "off"].push(...x.micros);
    const s = stats(x.micros);
    console.log(`| ${seed} | ${on ? "on" : "off"} | ${x.hash} | ${x.buildings} | ${x.units} | ${x.micros.length} | ${s.median} | ${s.p95} | ${s.p99} | ${s.max} | ${s.mean} | ${x.builds} |`);
  }
}
const off = stats(all.off);
const on = stats(all.on);
const q = (a: number, b: number) => (a === 0 ? "-" : (b / a).toFixed(2));
console.log(`\n| all seeds | median off | on | ratio | p95 off | on | ratio | p99 off | on | max off | on |`);
console.log(`|---|---|---|---|---|---|---|---|---|---|---|`);
console.log(`| ${mode} | ${off.median} | ${on.median} | ${q(off.median, on.median)} | ${off.p95} | ${on.p95} | ${q(off.p95, on.p95)} | ${off.p99} | ${on.p99} | ${off.max} | ${on.max} |`);
