// Summary of an AI scratch run: per game set, slot 0 (plan A) against slot 1; per scripted set, the five groups.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
const root = process.argv[2];
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = walk(root);
const sets = new Map();
for (const f of files) {
  const m = /g-(.+)-\d+\/game-\d+\.json$/.exec(f);
  if (!m) continue;
  const g = JSON.parse(readFileSync(f, "utf8"));
  (sets.get(m[1]) ?? sets.set(m[1], []).get(m[1])).push(g);
}
const q = (a, p) => (a.length === 0 ? 0 : [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))]);
const out = ["## Games", "", "| set | games | A wins | B wins | draws | A share of decided | spawn 0 share | replay fails | minutes (median, p90) | tick µs (median of medians) |", "|---|---|---|---|---|---|---|---|---|---|"];
for (const [name, list] of [...sets].sort()) {
  let a = 0, b = 0, d = 0, s0 = 0, fails = 0;
  for (const g of list) {
    if (!g.replayMatches) fails++;
    if (g.winner < 0) { d++; continue; }
    if (g.winner === 0) s0++;
    const slot = g.swap ? 1 - g.winner : g.winner;
    if (slot === 0) a++; else b++;
  }
  const dec = a + b;
  out.push(`| ${name} | ${list.length} | ${a} | ${b} | ${d} | ${dec ? ((100 * a) / dec).toFixed(1) : "-"}% | ${dec ? ((100 * s0) / dec).toFixed(1) : "-"}% | ${fails} | ${q(list.map((g) => g.ticks / 1200), 0.5).toFixed(1)}, ${q(list.map((g) => g.ticks / 1200), 0.9).toFixed(1)} | ${q(list.map((g) => g.tickMicros.median), 0.5)} |`);
}
// Counterbalanced pairs: "<v>@a" has the variant in slot 0, "<v>@b" in slot 1 (same seeds), so the
// slots' own random draws cancel out.
const pairs = new Map();
for (const [name, list] of sets) {
  const m = /^(.+)@([ab])$/.exec(name);
  if (!m) continue;
  const p = pairs.get(m[1]) ?? pairs.set(m[1], { v: 0, base: 0, d: 0, n: 0 }).get(m[1]);
  for (const g of list) {
    p.n++;
    if (g.winner < 0) { p.d++; continue; }
    const slot = g.swap ? 1 - g.winner : g.winner;
    if ((slot === 0) === (m[2] === "a")) p.v++; else p.base++;
  }
}
if (pairs.size > 0) {
  out.push("", "## Variant against the current plan, both slots", "", "| variant | games | variant wins | current wins | draws | variant share of decided |", "|---|---|---|---|---|---|");
  for (const [name, p] of [...pairs].sort()) out.push(`| ${name} | ${p.n} | ${p.v} | ${p.base} | ${p.d} | ${p.v + p.base ? ((100 * p.v) / (p.v + p.base)).toFixed(1) : "-"}% |`);
}
const sc = new Map();
for (const f of files) {
  const m = /s-(.+)-(push|defend|defend-loose|defend-eco|notown|push-eco|push-loose|push-corners|push-auto|push-auto-corners|push-corners-govern|push-raid|push-race|push-random|push-corners-random|push-auto-random)-[\d-]+\.json$/.exec(f);
  if (!m) continue;
  const j = JSON.parse(readFileSync(f, "utf8"));
  const key = m[1];
  const row = sc.get(key) ?? sc.set(key, {}).get(key);
  const cell = (row[m[2]] ??= { won: 0, n: 0, open: 0 });
  for (const g of j.games) {
    cell.n++;
    if (g.result === "won") cell.won++;
    if (g.result === "open") cell.open++;
  }
}
const G = ["push", "push-corners", "push-auto", "push-auto-corners", "push-corners-govern", "push-race", "push-raid", "push-random", "push-corners-random", "push-auto-random", "push-eco", "push-loose", "defend", "defend-loose", "defend-eco", "notown"];
out.push("", "## Scripted player against the candidate (player wins / games, open in brackets)", "", `| set | ${G.join(" | ")} |`, `|---|${G.map(() => "---").join("|")}|`);
for (const [name, row] of [...sc].sort()) out.push(`| ${name} | ${G.map((g) => (row[g] ? `${row[g].won}/${row[g].n}${row[g].open ? ` (${row[g].open})` : ""}` : "-")).join(" | ")} |`);
for (const f of files) {
  const m7 = /t7-(.+)\.md$/.exec(f);
  if (m7) out.push("", readFileSync(f, "utf8").trim());
}
for (const f of files) {
  const m = /t-(.+)\.json$/.exec(f);
  if (!m) continue;
  out.push("", `## Think time ${m[1]}`, "", "```", readFileSync(f, "utf8").trim(), "```");
}
console.log(out.join("\n"));
