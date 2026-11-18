// Scratch (D-083 (c)): how long hard's think takes with the population rules on, without and with a HARD_POP
// candidate (JSON in --cand), in the same process on the same machine; warm-up first, then without, with, with,
// without, hard against normal both ways round.
//   node scratch/think-c.ts --seeds 1-5 --map fixed --ticks 48000 --cand '{"productionFirst":true,"pushArmy":48}'
import { cpus } from "node:os";
import { createAi, HARD_POP } from "../src/ai/ai.ts";
import { aiKnowledge } from "../src/runner.ts";
import { Game } from "../src/core/game.ts";
import { POPULATION_200 } from "../src/core/rules.ts";
import type { AiDifficulty, Command } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
const arg = (n: string, f: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : f;
};
const [a, b] = arg("seeds", "1-3").split("-").map(Number);
const MAP = arg("map", "fixed") as "fixed" | "random";
const TICKS = Number(arg("ticks", "48000"));
const CAND = JSON.parse(arg("cand", "{}")) as Record<string, unknown>;
const q = (x: number[], p: number) => {
  const s = [...x].sort((m, n) => m - n);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]);
};
POPULATION_200.on = true;
const base = { ...HARD_POP };
function pass(withCand: boolean, into: number[], seeds: number[], ticks: number): void {
  for (const k of Object.keys(HARD_POP)) delete (HARD_POP as Record<string, unknown>)[k];
  Object.assign(HARD_POP, base, withCand ? CAND : {});
  for (const seed of seeds) {
    for (const diffs of [["hard", "normal"], ["normal", "hard"]] as AiDifficulty[][]) {
      const g = new Game({ seed, scenario: "standard", maxTicks: ticks, map: MAP });
      const ais = [0, 1].map((p) => createAi(p, seed, aiKnowledge(g.w.map, p, ticks, diffs[p]), p));
      let seq = 0;
      while (!g.w.over && g.tick < ticks) {
        if (g.tick % 10 === 0) {
          for (let p = 0; p < 2; p++) {
            const v = buildView(g, p);
            const t0 = performance.now();
            const cmds = ais[p].think(v);
            if (diffs[p] === "hard") into.push((performance.now() - t0) * 1000);
            for (const c of cmds) g.push({ ...c, t: g.tick, p, seq: seq++ } as Command);
          }
        }
        g.step();
      }
    }
  }
}
const seeds: number[] = [];
for (let seed = a; seed <= (b ?? a); seed++) seeds.push(seed);
console.log(`cpu ${cpus()[0]?.model ?? "?"}; map ${MAP}; seeds ${a}-${b ?? a}; up to ${TICKS} ticks; candidate ${JSON.stringify(CAND)}`);
pass(false, [], [seeds[0]], 6000);
const times: Record<string, number[]> = { without: [], with: [] };
for (const w of [false, true, true, false]) pass(w, times[w ? "with" : "without"], w ? seeds : [...seeds].reverse(), TICKS);
console.log("hard | thinks | think µs median / p95 / p99 / max");
for (const k of ["without", "with"]) console.log(`${k} | ${times[k].length} | ${q(times[k], 0.5)} / ${q(times[k], 0.95)} / ${q(times[k], 0.99)} / ${q(times[k], 1)}`);
