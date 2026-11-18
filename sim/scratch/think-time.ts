// Scratch: how long each AI's think takes (Runner.tick times only the step), hard against normal.
//   node scratch/think-time.ts --seeds 1-3 --out FILE
import { writeFileSync } from "node:fs";
import { createAi } from "../src/ai/ai.ts";
import { aiKnowledge } from "../src/runner.ts";
import { Game } from "../src/core/game.ts";
import { rules } from "../src/core/rules.ts";
import type { AiDifficulty, Command } from "../src/protocol.ts";
import { buildView } from "../src/view/view.ts";
const arg = (n: string, f: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : f; };
const [a, b] = arg("seeds", "1-3").split("-").map(Number);
const MAP = arg("map", "fixed") as "fixed" | "random";
const times: Record<string, { think: number[]; view: number[] }> = {};
const steps: number[] = [];
for (let seed = a; seed <= (b ?? a); seed++) {
  for (const diffs of [["hard", "normal"], ["normal", "hard"]] as AiDifficulty[][]) {
    const g = new Game({ seed, scenario: "standard", maxTicks: 36000, map: MAP });
    const ais = [0, 1].map((p) => createAi(p, seed, aiKnowledge(g.w.map, p, 36000, diffs[p]), p));
    let seq = 0;
    while (!g.w.over && g.tick < 36000) {
      if (g.tick % 10 === 0) {
        for (let p = 0; p < 2; p++) {
          const t0 = performance.now();
          const v = buildView(g, p);
          const t1 = performance.now();
          const cmds = ais[p].think(v);
          const t2 = performance.now();
          const k = diffs[p];
          (times[k] ??= { think: [], view: [] }).think.push((t2 - t1) * 1000);
          times[k].view.push((t1 - t0) * 1000);
          for (const c of cmds) g.push({ ...c, t: g.tick, p, seq: seq++ } as Command);
        }
      }
      const t0 = performance.now();
      g.step();
      steps.push((performance.now() - t0) * 1000);
    }
  }
}
const q = (x: number[], p: number) => { const s = [...x].sort((m, n) => m - n); return Math.round(s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]); };
const lines = ["difficulty | thinks | think µs median / p95 / p99 / max | buildView µs median / p95"];
for (const [k, t] of Object.entries(times)) lines.push(`${k} | ${t.think.length} | ${q(t.think, 0.5)} / ${q(t.think, 0.95)} / ${q(t.think, 0.99)} / ${q(t.think, 1)} | ${q(t.view, 0.5)} / ${q(t.view, 0.95)}`);
lines.push(`step (for scale) | ${steps.length} | ${q(steps, 0.5)} / ${q(steps, 0.95)} / ${q(steps, 0.99)} / ${q(steps, 1)} |`);
console.log(lines.join("\n"));
writeFileSync(arg("out", "think.json"), lines.join("\n") + "\n");
