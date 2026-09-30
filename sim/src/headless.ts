// Headless runner (Node; no build step, types are stripped).
//   node src/headless.ts [--scenario standard|e2e|perf|skirmish] [--seed N] [--ticks N] [--ai 1,1]
//                        [--script demo|eco] [--replay FILE] [--out DIR] [--expected FILE]
// Writes into --out: hashes.txt ("tick hash" per HASH_EVERY), commands.jsonl (LogHeader,
// then one command per line), timing.json. --expected writes ExpectedHashes JSON for the
// phone-side determinism check. Until the AI arrives (PR-5): --script demo drives the
// armies of the internal skirmish scenario; --script eco plays both sides' economy
// (src/scripts/eco.ts) from their own views.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { hex8 } from "./core/fixed.ts";
import type { ScenarioKey } from "./core/scenarios.ts";
import {
  AI_DIFFICULTIES,
  type AiDifficulty,
  type Command,
  type ExpectedHashes,
  type LogHeader,
  MAX_TICKS,
  PROTOCOL_VERSION,
  type ScenarioName,
  UnitType,
} from "./protocol.ts";
import { Runner } from "./runner.ts";
import { ECO_SCRIPT_EVERY, ecoScript } from "./scripts/eco.ts";
import { buildView } from "./view/view.ts";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

const replayFile = arg("replay", "");
let header: LogHeader | null = null;
let replay: Command[] | undefined;
if (replayFile !== "") {
  const lines = readFileSync(replayFile, "utf8").split("\n").filter((l) => l.trim() !== "");
  header = JSON.parse(lines[0]) as LogHeader;
  replay = lines.slice(1).map((l) => JSON.parse(l) as Command);
}
const scenario = (header?.scenario ?? arg("scenario", "standard")) as ScenarioKey;
const seed = header?.seed ?? Number(arg("seed", "1"));
const ai = (header?.ai ?? arg("ai", "1,1").split(",").map((v) => v === "1")) as boolean[];
// The game's time limit: the log's (MAX_TICKS for logs from before round 2), or --ticks (0 = none).
const maxTicks = replay !== undefined ? (header?.maxTicks ?? MAX_TICKS) : Number(arg("ticks", String(MAX_TICKS)));
const difficulty = (header?.difficulty ?? arg("difficulty", "normal,normal").split(",")) as AiDifficulty[];
if (!Number.isInteger(maxTicks) || maxTicks < 0) throw new Error(`bad --ticks ${maxTicks}`);
if (!difficulty.every((d) => (AI_DIFFICULTIES as readonly string[]).includes(d))) throw new Error(`bad --difficulty ${difficulty}`);
const script = replay === undefined ? arg("script", "") : "";
const out = arg("out", "");
const expected = arg("expected", "");

const runner = new Runner({ seed, scenario, ai, replay, maxTicks, difficulty });
const g = runner.game;
let seq = 0;

/** Demo for the skirmish scenario: each army attack-moves to the centre, then to the enemy base. */
function demo(): void {
  const t = g.tick;
  if (t % 400 !== 0) return;
  const u = g.w.units.col;
  for (let p = 0; p < 2; p++) {
    const army: number[] = [];
    for (let s = 0; s < g.w.units.count; s++) {
      if (u.owner[s] === p && (u.type[s] === UnitType.Spearman || u.type[s] === UnitType.Ranged)) army.push(u.id[s]);
    }
    if (army.length === 0) continue;
    const enemy = g.w.map.spawns[1 - p];
    const [x, y] = t < 1200 ? [48, 48] : [enemy.cellX, enemy.cellY];
    g.push({ t, p, seq: seq++, c: "move", u: army, x, y });
  }
}

/** Both players' economy script, each on its own view, staggered by half a period. */
function eco(): void {
  for (let p = 0; p < 2; p++) {
    if (g.tick % ECO_SCRIPT_EVERY !== (p * ECO_SCRIPT_EVERY) / 2) continue;
    for (const body of ecoScript(buildView(g, p), g.w.map.spawns[p])) g.push({ ...body, t: g.tick, p, seq: seq++ } as Command);
  }
}

const micros: number[] = [];
const start = performance.now();
while (!runner.over && (maxTicks === 0 || g.tick < maxTicks)) {
  if (script === "demo") demo();
  if (script === "eco") eco();
  micros.push(runner.tick(() => performance.now()));
}
const totalMs = performance.now() - start;

const sorted = [...micros].sort((a, b) => a - b);
const pick = (p: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
const timing = {
  engine: `node ${process.versions.node}`,
  platform: `${process.platform} ${process.arch}`,
  scenario,
  seed,
  ticks: g.tick,
  winner: g.w.winner,
  totalMs: Math.round(totalMs),
  tickMicros: {
    median: pick(50),
    p95: pick(95),
    max: sorted.at(-1) ?? 0,
    /** The first ticks include the JIT warming up; this is the max from tick 100 on. */
    maxAfter100: micros.slice(100).reduce((a, b) => Math.max(a, b), 0),
    mean: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
  },
  fieldBuilds: g.fields.builds,
  fieldHits: g.fields.hits,
  fieldStaleUses: g.fields.staleUses,
  fieldDeferred: g.fields.deferred,
  /** Share of field requests answered from the cache (fresh or stale) without building. */
  fieldHitRate: (() => {
    const f = g.fields;
    const all = f.builds + f.hits + f.staleUses + f.deferred;
    return all === 0 ? 1 : Math.round(((f.hits + f.staleUses) / all) * 10000) / 10000;
  })(),
  economy: [0, 1].map((p) => ({
    gathered: Array.from(g.w.gathered.subarray(p * 4, p * 4 + 4)),
    trained: Array.from(g.w.trained.subarray(p * 5, p * 5 + 5)),
    lost: Array.from(g.w.lost.subarray(p * 5, p * 5 + 5)),
    buildings: g.w.buildings.col.owner.subarray(0, g.w.buildings.count).filter((o) => o === p).length,
    townsPlundered: g.w.plundered[p],
    townsGoverned: g.w.governed[p],
  })),
};
const final = runner.hashes.at(-1)!;
if (final.tick !== g.tick) runner.hashes.push({ tick: g.tick, hash: g.hash() });

if (out !== "") {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "hashes.txt"), runner.hashes.map((h) => `${h.tick} ${hex8(h.hash)}`).join("\n") + "\n");
  const head: LogHeader = runner.header(ai);
  writeFileSync(join(out, "commands.jsonl"), [JSON.stringify(head), ...g.log.map((c) => JSON.stringify(c))].join("\n") + "\n");
  writeFileSync(join(out, "timing.json"), JSON.stringify(timing, null, 2) + "\n");
}
if (expected !== "") {
  const exp: ExpectedHashes = {
    protocol: PROTOCOL_VERSION,
    seed,
    scenario: scenario as ScenarioName,
    maxTicks,
    hashes: Object.fromEntries(runner.hashes.map((h) => [String(h.tick), hex8(h.hash)])),
    final: { tick: g.tick, hash: hex8(g.hash()), winner: g.w.winner },
  };
  writeFileSync(expected, JSON.stringify(exp) + "\n");
}
console.log(
  `SIM ${scenario} seed ${seed}${replay ? " (replay)" : ""}: ${g.tick} ticks in ${(totalMs / 1000).toFixed(2)} s; ` +
    `tick median ${timing.tickMicros.median} us, p95 ${timing.tickMicros.p95} us, max ${timing.tickMicros.max} us ` +
    `(${timing.tickMicros.maxAfter100} us from tick 100); ` +
    `fields built ${timing.fieldBuilds}, hit rate ${timing.fieldHitRate}; ` +
    `final ${hex8(g.hash())}, winner ${g.w.winner}, commands ${g.log.length}`,
);
