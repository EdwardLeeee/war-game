// Headless runner (Node, no build step: node strips the TypeScript types).
//   node src/headless.ts --mode scripted|ai|measure [--ticks N] [--out DIR] [--replay FILE]
// Writes <out>/<name>.hashes.txt ("tick hash count" per line), .commands.jsonl (the replay
// log), .state.txt (full end state) and .timing.json, and prints SPIKE summary lines.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_TICKS } from "./sim/constants.ts";
import { hex8 } from "./sim/math.ts";
import { createGame, type Mode, MODES, runGame } from "./sim/scenarios.ts";
import type { Command } from "./sim/sim.ts";
import { summarize } from "./stats.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const mode = arg("mode", "scripted") as Mode;
if (!MODES.includes(mode)) throw new Error(`unknown mode ${mode}`);
const ticks = Number(arg("ticks", String(MAX_TICKS)));
const out = arg("out", "out");
const replayFile = arg("replay", "");
const name = arg("name", replayFile === "" ? mode : `${mode}-replay`);

const replay: Command[] | null =
  replayFile === ""
    ? null
    : readFileSync(replayFile, "utf8")
        .split("\n")
        .filter((l) => l.trim() !== "")
        .map((l) => JSON.parse(l) as Command);

const t0 = performance.now();
const game = createGame(mode, replay);
const setupMs = performance.now() - t0;
const tickMs: number[] = [];
const start = performance.now();
const points = runGame(game, ticks, () => performance.now(), (ms) => tickMs.push(ms));
const totalMs = performance.now() - start;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${name}.hashes.txt`), points.map((p) => `${p.tick} ${hex8(p.hash)} ${p.count}`).join("\n") + "\n");
writeFileSync(join(out, `${name}.commands.jsonl`), game.sim.log.map((c) => JSON.stringify(c)).join("\n") + "\n");
writeFileSync(join(out, `${name}.state.txt`), game.sim.dump());
const stats = summarize(tickMs);
const timing = {
  engine: `node ${process.versions.node} (V8 ${process.versions.v8})`,
  platform: `${process.platform} ${process.arch}`,
  mode,
  replay: replayFile !== "",
  ticks: game.sim.tick,
  setupMs: Math.round(setupMs * 10) / 10,
  totalMs: Math.round(totalMs),
  tickMs: stats,
  flowFieldBuilds: game.sim.fields.builds,
  alive: game.sim.aliveByTeam(),
};
writeFileSync(join(out, `${name}.timing.json`), JSON.stringify(timing, null, 2) + "\n");

const last = points[points.length - 1];
console.log(
  `SPIKE ${name}: ${game.sim.tick} ticks in ${(totalMs / 1000).toFixed(2)} s; ` +
    `tick median ${stats.median.toFixed(3)} ms, p95 ${stats.p95.toFixed(3)} ms, max ${stats.max.toFixed(2)} ms; ` +
    `final hash ${hex8(last.hash)}, alive ${timing.alive.join("/")}, flow fields built ${timing.flowFieldBuilds}`,
);
