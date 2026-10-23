// Scratch (D-089, ceo 2026-10-21: think and per-tick time no worse): the same games played with D-089's AI changes
// off (no gathering point, normal's SIEGE.failed 0, hard's cityAgain 0) and on, in one process on one machine,
// in the order off, on, on, off. Per AI difficulty: each think's microseconds; per game the step (sim) microseconds.
//   node scratch/think-d089.ts --seeds 1-5 --map fixed
import { cpus } from "node:os";
import { HARD_POP, SIEGE, STAGING } from "../src/ai/ai.ts";
import { Runner } from "../src/runner.ts";
import type { AiDifficulty } from "../src/protocol.ts";

const arg = (n: string, f: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : f;
};
const [a, b] = arg("seeds", "1-5").split("-").map(Number);
const MAP = arg("map", "fixed") as "fixed" | "random";
const PAIRS: AiDifficulty[][] = [
  ["normal", "normal"],
  ["hard", "hard"],
  ["hard", "normal"],
];
const q = (x: number[], p: number) => {
  const s = [...x].sort((m, n) => m - n);
  return s.length === 0 ? 0 : Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]);
};
const hardPop = HARD_POP as Record<string, unknown>;
const cityAgain = hardPop.cityAgain;
function set(on: boolean) {
  STAGING.on = on;
  SIEGE.failed = on ? 120 : 0;
  hardPop.cityAgain = on ? cityAgain : 0;
}
type Times = { think: Record<string, number[]>; step: number[] };
const result: Record<string, Times> = { off: { think: {}, step: [] }, on: { think: {}, step: [] } };
function pass(which: "off" | "on") {
  set(which === "on");
  const t = result[which];
  for (let seed = a; seed <= b; seed++) {
    for (const diff of PAIRS) {
      const r = new Runner({ seed, scenario: "standard", ai: [true, true], maxTicks: 36000, difficulty: diff, map: MAP });
      const ais = (r as unknown as { ais: { think: (v: unknown) => unknown }[] }).ais;
      ais.forEach((ai, p) => {
        const think = ai.think.bind(ai);
        const key = diff[p];
        (t.think[key] ??= []);
        ai.think = (v: unknown) => {
          const t0 = performance.now();
          const out = think(v);
          t.think[key].push((performance.now() - t0) * 1000);
          return out;
        };
      });
      while (!r.over && r.game.tick < 36000) t.step.push(r.tick(() => performance.now()));
    }
  }
}
pass("off");
pass("on");
pass("on");
pass("off");
console.log(`cpu: ${cpus()[0]?.model}`);
for (const which of ["off", "on"] as const) {
  const t = result[which];
  for (const [k, v] of Object.entries(t.think)) console.log(`${which} think ${k} | ${v.length} | ${q(v, 0.5)} / ${q(v, 0.95)} / ${q(v, 0.99)} / ${q(v, 1)}`);
  console.log(`${which} step | ${t.step.length} | ${q(t.step, 0.5)} / ${q(t.step, 0.95)} / ${q(t.step, 0.99)} / ${q(t.step, 1)}`);
}
