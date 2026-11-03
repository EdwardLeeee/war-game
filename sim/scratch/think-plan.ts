// Scratch (ceo: think time no worse): the same AI games with hard's plan as it is and with --plan JSON over it, in one
// process on one machine, in the order off, on, on, off. Per AI difficulty: each think's microseconds.
//   node scratch/think-plan.ts --seeds 1-5 --map fixed --plan '{"cavalryCounter":20,"cavalryWhen":0}'
import { cpus } from "node:os";
import { HARD } from "../src/ai/ai.ts";
import { Runner } from "../src/runner.ts";
import type { AiDifficulty } from "../src/protocol.ts";

const arg = (n: string, f: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : f;
};
const [a, b] = arg("seeds", "1-5").split("-").map(Number);
const MAP = arg("map", "fixed") as "fixed" | "random";
const PLAN = JSON.parse(arg("plan", "{}")) as Record<string, unknown>;
const saved = { ...HARD } as Record<string, unknown>;
const PAIRS: AiDifficulty[][] = [
  ["hard", "hard"],
  ["hard", "normal"],
];
const q = (x: number[], p: number) => {
  const s = [...x].sort((m, n) => m - n);
  return s.length === 0 ? 0 : Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]);
};
const result: Record<string, Record<string, number[]>> = { off: {}, on: {} };
function pass(which: "off" | "on") {
  Object.assign(HARD, saved, which === "on" ? PLAN : {});
  const t = result[which];
  for (let seed = a; seed <= b; seed++) {
    for (const diff of PAIRS) {
      const r = new Runner({ seed, scenario: "standard", ai: [true, true], maxTicks: 36000, difficulty: diff, map: MAP });
      const ais = (r as unknown as { ais: { think: (v: unknown) => unknown }[] }).ais;
      ais.forEach((ai, p) => {
        const think = ai.think.bind(ai);
        const key = diff[p];
        t[key] ??= [];
        ai.think = (v: unknown) => {
          const t0 = performance.now();
          const out = think(v);
          t[key].push((performance.now() - t0) * 1000);
          return out;
        };
      });
      while (!r.over && r.game.tick < 36000) r.tick();
    }
  }
}
pass("off");
pass("on");
pass("on");
pass("off");
Object.assign(HARD, saved);
console.log(`cpu: ${cpus()[0]?.model}`);
for (const which of ["off", "on"] as const) for (const [k, v] of Object.entries(result[which])) console.log(`${which} think ${k} | ${v.length} | ${q(v, 0.5)} / ${q(v, 0.95)} / ${q(v, 0.99)} / ${q(v, 1)}`);
