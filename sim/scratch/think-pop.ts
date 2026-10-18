// Scratch (D-083): how long each AI's think takes with the population rules off and then on, in the same
// process on the same machine (runner speeds differ by machine), hard against normal both ways round.
//   node scratch/think-pop.ts --seeds 1-3 --map fixed --ticks 48000
import { cpus } from "node:os";
import { createAi } from "../src/ai/ai.ts";
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
const q = (x: number[], p: number) => {
  const s = [...x].sort((m, n) => m - n);
  return Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]);
};
console.log(`cpu ${cpus()[0]?.model ?? "?"}; map ${MAP}; seeds ${a}-${b ?? a}; up to ${TICKS} ticks`);
console.log("rules | difficulty | thinks | think µs median / p95 / p99 / max | most population");
for (const on of [false, true]) {
  POPULATION_200.on = on;
  const times: Record<string, number[]> = {};
  let most = 0;
  for (let seed = a; seed <= (b ?? a); seed++) {
    for (const diffs of [["hard", "normal"], ["normal", "hard"]] as AiDifficulty[][]) {
      const g = new Game({ seed, scenario: "standard", maxTicks: TICKS, map: MAP });
      const ais = [0, 1].map((p) => createAi(p, seed, aiKnowledge(g.w.map, p, TICKS, diffs[p]), p));
      let seq = 0;
      while (!g.w.over && g.tick < TICKS) {
        if (g.tick % 10 === 0) {
          for (let p = 0; p < 2; p++) {
            const v = buildView(g, p);
            const t0 = performance.now();
            const cmds = ais[p].think(v);
            (times[diffs[p]] ??= []).push((performance.now() - t0) * 1000);
            for (const c of cmds) g.push({ ...c, t: g.tick, p, seq: seq++ } as Command);
          }
        }
        if (g.tick % 1200 === 0) most = Math.max(most, g.w.population(0), g.w.population(1));
        g.step();
      }
    }
  }
  for (const [k, t] of Object.entries(times)) console.log(`${on ? "on" : "off"} | ${k} | ${t.length} | ${q(t, 0.5)} / ${q(t, 0.95)} / ${q(t, 0.99)} / ${q(t, 1)} | ${most}`);
}
POPULATION_200.on = false;
