// Scratch (D-081 / A4, ceo 2026-10-21: think time no worse): the scripted fortress games as src/scripted-games.ts plays
// them (same arguments), with fortStage and fortAgain off and on (normal's NORMAL_FORT and hard's HARD alike), in one
// process on one machine, in the order off, on, on, off; each AI think's microseconds (median / p95 / p99 / most).
//   node scratch/think-fort.ts --seeds 1-5 --strategy push --speed h1 --formation close --fortress --difficulty normal
import { cpus } from "node:os";
const simDir = new URL("../", import.meta.url).pathname;
const { Runner } = await import(`${simDir}src/runner.ts`);
const { HARD, NORMAL_FORT } = await import(`${simDir}src/ai/ai.ts`);
const times: Record<string, number[]> = { off: [], on: [] };
let which: "off" | "on" = "off";
const seen = new WeakSet<object>();
const orig = Runner.prototype.tick;
Runner.prototype.tick = function (this: { ais: ({ think: (v: unknown) => unknown } | null)[] }, ...a: unknown[]) {
  if (!seen.has(this)) {
    seen.add(this);
    const bucket = times[which];
    for (const ai of this.ais) {
      if (ai === null) continue;
      const think = ai.think.bind(ai);
      ai.think = (v: unknown) => {
        const t0 = performance.now();
        const out = think(v);
        bucket.push((performance.now() - t0) * 1000);
        return out;
      };
    }
  }
  return orig.apply(this, a);
};
const set = (on: boolean) => {
  NORMAL_FORT.stage = on;
  NORMAL_FORT.again = on;
  HARD.fortStage = on;
  HARD.fortAgain = on;
};
const q = (x: number[], p: number) => {
  const s = [...x].sort((m, n) => m - n);
  return s.length === 0 ? 0 : Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]);
};
const rest = process.argv.slice(2);
const log = console.log;
const passes = ["off", "on", "on", "off"] as const;
for (let k = 0; k < passes.length; k++) {
  which = passes[k];
  set(which === "on");
  process.argv = [process.argv[0], `${simDir}src/scripted-games.ts`, ...rest];
  console.log = () => {};
  await import(`${simDir}src/scripted-games.ts?pass=${k}`);
  console.log = log;
}
set(false);
console.log(`cpu: ${cpus()[0]?.model}`);
for (const w of ["off", "on"] as const) console.log(`${w} think | ${times[w].length} | ${q(times[w], 0.5)} / ${q(times[w], 0.95)} / ${q(times[w], 0.99)} / ${q(times[w], 1)}`);
