// Compares the state hashes that several environments produced for the same games and
// collects each environment's timing, size and cold-start lines into one report.
//   node spikes/tools/report.mjs --games scripted,ai --json report.json <name>=<path> ...
// <path> is either a directory with <game>.hashes.txt files (headless runner: "tick hash
// count" per line, plus <game>.timing.json) or a spike.txt file of "SPIKE ..." lines
// ("SPIKE hash <game> <tick> <hash> <count>"). The first environment is the reference.
// Prints Markdown (also appended to $GITHUB_STEP_SUMMARY) and exits 1 when any
// environment is missing a game or differs from the reference at any checkpoint.

import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
let games = ["scripted", "ai"];
let jsonOut = "";
const envs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--games") games = args[++i].split(",");
  else if (args[i] === "--json") jsonOut = args[++i];
  else {
    const eq = args[i].indexOf("=");
    envs.push({ name: args[i].slice(0, eq), path: args[i].slice(eq + 1) });
  }
}

function load(env) {
  const hashes = {}; // game -> Map(tick -> "hash count")
  const extra = { lines: [], timing: {} };
  if (!existsSync(env.path)) return { hashes, extra, missing: true };
  if (statSync(env.path).isDirectory()) {
    for (const g of games) {
      const f = join(env.path, `${g}.hashes.txt`);
      if (existsSync(f)) {
        hashes[g] = new Map(
          readFileSync(f, "utf8")
            .trim()
            .split("\n")
            .map((l) => l.split(" "))
            .map(([t, h, c]) => [Number(t), `${h} ${c}`]),
        );
      }
      const t = join(env.path, `${g}.timing.json`);
      if (existsSync(t)) extra.timing[g] = JSON.parse(readFileSync(t, "utf8"));
    }
  } else {
    for (const line of readFileSync(env.path, "utf8").split("\n")) {
      const m = line.match(/^SPIKE hash (\S+) (\d+) ([0-9a-f]{8}) (\d+)/);
      if (m) {
        if (!hashes[m[1]]) hashes[m[1]] = new Map();
        hashes[m[1]].set(Number(m[2]), `${m[3]} ${m[4]}`);
      } else if (/^SPIKE (ready|device|size|coldstart|game|measure|timing)/.test(line)) {
        extra.lines.push(line);
      }
    }
  }
  return { hashes, extra, missing: false };
}

const loaded = envs.map((e) => ({ ...e, ...load(e) }));
const ref = loaded[0];
let failed = false;
const md = ["### Determinism", "", `Reference: **${ref.name}**`, ""];
md.push(`| game | ${loaded.map((e) => e.name).join(" | ")} |`);
md.push(`|---|${loaded.map(() => "---").join("|")}|`);
const result = { games: {}, envs: {} };
for (const g of games) {
  const refMap = ref.hashes[g];
  const cells = [];
  result.games[g] = {};
  for (const e of loaded) {
    const map = e.hashes[g];
    if (!map || map.size === 0 || !refMap) {
      cells.push("missing");
      result.games[g][e.name] = { status: "missing" };
      failed = true;
      continue;
    }
    let same = 0;
    let firstDiff = null;
    for (const [tick, v] of refMap) {
      if (map.get(tick) === v) same++;
      else if (firstDiff === null) firstDiff = tick;
    }
    const extraTicks = [...map.keys()].filter((t) => !refMap.has(t)).length;
    const lastTick = Math.max(...map.keys());
    const final = map.get(lastTick);
    const ok = same === refMap.size && extraTicks === 0;
    if (!ok) failed = true;
    cells.push(`${ok ? "✅" : "❌"} ${same}/${refMap.size} same, final tick ${lastTick} ${final.split(" ")[0]}${firstDiff === null ? "" : `, first difference at tick ${firstDiff}`}`);
    result.games[g][e.name] = { status: ok ? "same" : "different", same, checkpoints: refMap.size, lastTick, final, firstDiff };
  }
  md.push(`| ${g} | ${cells.join(" | ")} |`);
}

md.push("", "### Environment lines", "");
for (const e of loaded) {
  result.envs[e.name] = { lines: e.extra.lines, timing: e.extra.timing };
  md.push(`**${e.name}**${e.missing ? " (missing)" : ""}`, "");
  for (const [g, t] of Object.entries(e.extra.timing)) {
    md.push(`- ${g}: ${t.ticks} ticks in ${(t.totalMs / 1000).toFixed(2)} s, tick median ${t.tickMs.median.toFixed(3)} ms, max ${t.tickMs.max.toFixed(2)} ms (${t.engine}, ${t.platform})`);
  }
  for (const l of e.extra.lines) md.push(`- \`${l.slice(0, 400)}\``);
  md.push("");
}

const text = md.join("\n");
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + "\n");
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 2) + "\n");
process.exit(failed ? 1 : 0);
