// D-147 (the hands-off training plan, step 1; ai-tools selftrain-plan.md 4.1): search the scripted player's plays for
// examiners, plans that beat hard with no bonus, and check those found on fresh seeds. What .github/workflows/ai-train.yml
// runs in its exam and examcheck modes. Never imported by the simulation Worker.
//   node src/ai/learn/exam.ts search --out DIR [--seed N] [--hours H] [--map random|fixed|mix] [--pool 48] [--cap 90]
//                                     [--rounds 6,20,60] [--cycles N]
//       Each cycle draws a pool of plans (some mutated from the best found so far, by kind), plays every one the first
//       round's games, keeps the best third, plays those up to the next round's games, and so on; those that reach the
//       last round are kept (candidates.json). Every plan of a cycle plays the same seeds, so they are compared on equal
//       games; each job (--seed) has its own seeds.
//   node src/ai/learn/exam.ts check --from DIR[,DIR...] --out DIR [--games 200] [--seed-from 6000001] [--top 12]
//                                    [--shard K --shards N] [--cap 90] [--qualify 25]
//       The best plan of each kind across the searches (candidates.json under each DIR), the best `top` kinds, each
//       `games` games on fresh seeds; examiners.json lists them, qualified with `qualify` percent wins or more.
// Every mode writes summary.md (Markdown) and its files under --out; never commits.

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MapMode } from "../../protocol.ts";
import { drawPlan, type Drawn, mutate, rng } from "./exam-space.ts";
import { runAll } from "./pool.ts";
import type { Job, JobResult, ScriptedOutcome } from "./worker.ts";

const [mode] = process.argv.slice(2);
const arg = (n: string, f: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : f;
};
const out = arg("out", "out");
mkdirSync(out, { recursive: true });
const summary = (line: string) => {
  console.log(line);
  appendFileSync(`${out}/summary.md`, `${line}\n`);
};
const started = performance.now();
const hours = () => (performance.now() - started) / 3_600_000;
const MIN = 1200;
const cap = Number(arg("cap", "90")) * MIN;

/** A plan under test, the games it has played (in seed order), on its map. */
export interface Cand {
  id: string;
  drawn: Drawn;
  map: MapMode;
  games: ScriptedOutcome[];
}
const wins = (c: Cand) => c.games.filter((g) => g.result === "won").length;
const hits = (c: Cand) => c.games.filter((g) => g.hitAi >= 0).length;
/** Wins first; then games where it hit hard's main city; then hard's city hp at the end (lower is better). */
const score = (c: Cand) => wins(c) * 1_000_000 + hits(c) * 1000 - Math.min(999, Math.round(c.games.reduce((a, g) => a + g.aiCityHp, 0) / Math.max(1, c.games.length) / 10));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? -1 : s[s.length >> 1];
};

/**
 * How it plays, from its games and plan: when it first marches on hard's city (minutes: never, before 12, 12-20, after),
 * how many forts it finishes (none, 1-4, 5 or more), cavalry raids or harassers, the turtle, the race.
 */
export function kind(c: Cand): string {
  const fm = median(c.games.map((g) => (g.firstMarch < 0 ? 1e9 : g.firstMarch)));
  const march = fm >= 1e9 ? "never" : fm < 12 * MIN ? "early" : fm < 20 * MIN ? "mid" : "late";
  const f = median(c.games.map((g) => g.outposts + g.towers));
  const forts = f <= 0 ? "0" : f < 5 ? "1-4" : "5+";
  const p = c.drawn.plan;
  const side = [p.raid > 0 ? "raid" : "", p.harass > 0 ? "harass" : "", p.turtle ? "turtle" : "", p.race !== "" ? "race" : ""].filter((x) => x !== "").join("+");
  return `march ${march}, forts ${forts}${side === "" ? "" : `, ${side}`}`;
}

/** Plays `c` up to `n` games: seed `seedBase + i` for its i-th game. */
function jobsFor(c: Cand, n: number, seedBase: number): Job[] {
  const jobs: Job[] = [];
  for (let i = c.games.length; i < n; i++) jobs.push({ kind: "scripted", seed: seedBase + i, plan: c.drawn.plan, map: c.map, cap });
  return jobs;
}
async function playUpTo(cands: Cand[], n: number, seedBase: number): Promise<number> {
  const jobs: Job[] = [];
  const owner: Cand[] = [];
  for (const c of cands) for (const j of jobsFor(c, n, seedBase)) {
    jobs.push(j);
    owner.push(c);
  }
  const results = await runAll(jobs);
  results.forEach((r: JobResult, k) => {
    if (r.kind === "scripted") owner[k].games.push(r.outcome);
  });
  for (const c of cands) c.games.sort((a, b) => a.seed - b.seed);
  return jobs.length;
}
const pct = (a: number, b: number) => (b === 0 ? "-" : `${Math.round((100 * a) / b)}%`);
const distinct = (c: Cand) => new Set(c.games.map((g) => g.finalHash)).size;
/** The plan's fields set over its base, short. */
const setText = (d: Drawn) =>
  Object.entries(d.set)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(" ");

async function search(): Promise<void> {
  const seed = Number(arg("seed", "1"));
  const H = Number(arg("hours", "5.5"));
  const poolN = Number(arg("pool", "48"));
  const cycles = Number(arg("cycles", "1000"));
  const rounds = arg("rounds", "6,20,60").split(",").map(Number);
  const mapArg = arg("map", "random");
  const r = rng(seed);
  // Seeds of this job's games: away from CI's (1-100, 2000001-, 3000001-) and from the checks' (6000001-).
  const seedBase = 5_000_000 + seed * 10_000;
  const mapFor = (): MapMode => (mapArg === "mix" ? (r() < 2 / 3 ? "random" : "fixed") : (mapArg as MapMode));
  const kept: Cand[] = [];
  let games = 0;
  let made = 0;
  summary(`# 找考官（D-147），第 ${seed} 組\n\n每個打法對困難（不給加成，${cap / MIN} 分算未分），每輪 ${rounds.join("、")} 局，每輪留前三分之一。\n`);
  for (let cycle = 0; cycle < cycles; cycle++) {
    // A cycle's worth of games, guessed from the last one; stop when it would run past the hours.
    const perGame = games > 0 ? hours() / games : 0;
    const guess = poolN * rounds[0] + Math.ceil(poolN / 3) * (rounds[1] ?? 0) + Math.ceil(poolN / 9) * (rounds[2] ?? 0);
    if (cycle > 0 && hours() + perGame * guess > H) break;
    // The best of each kind so far, the parents of a third of the pool.
    const best = new Map<string, Cand>();
    for (const c of kept) {
      const k = kind(c);
      const b = best.get(k);
      if (b === undefined || score(c) > score(b)) best.set(k, c);
    }
    const parents = [...best.values()].sort((a, b) => score(b) - score(a)).slice(0, 8);
    const pool: Cand[] = [];
    for (let i = 0; i < poolN; i++) {
      const parent = parents.length > 0 && r() < 1 / 3 ? parents[Math.floor(r() * parents.length)] : null;
      const map = parent?.map ?? mapFor();
      const drawn = parent !== null ? mutate(r, parent.drawn, map, 1 + Math.floor(r() * 3)) : drawPlan(r, map);
      pool.push({ id: `${seed}-${made++}`, drawn, map, games: [] });
    }
    // Every cycle its own seeds, so a plan is never kept for one set's luck alone.
    const base = seedBase + cycle * 200;
    let alive = pool;
    for (let k = 0; k < rounds.length; k++) {
      games += await playUpTo(alive, rounds[k], base);
      alive.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
      if (k < rounds.length - 1) alive = alive.slice(0, Math.max(2, Math.ceil(alive.length / 3)));
    }
    kept.push(...alive);
    const top = alive[0];
    summary(`- 第 ${cycle + 1} 輪：${pool.length} 個打法，最好的 ${top.id} 贏 ${wins(top)}/${top.games.length}（${kind(top)}；${top.map}）；累計 ${games} 局、${hours().toFixed(2)} 小時`);
    writeFileSync(`${out}/candidates.json`, JSON.stringify({ seed, cap, rounds, games, hours: hours(), kept }, null, 0));
  }
  kept.sort((a, b) => score(b) - score(a));
  summary(`\n## 留下的打法（最後一輪 ${rounds[rounds.length - 1]} 局），依種類的第一名\n`);
  summary("| 種類 | 打法 | 地圖 | 贏 | 打到主城 | 不重複的局 | 底 | 設定 |\n|---|---|---|---|---|---|---|---|");
  const shown = new Set<string>();
  for (const c of kept) {
    const k = kind(c);
    if (shown.has(k)) continue;
    shown.add(k);
    summary(`| ${k} | ${c.id} | ${c.map} | ${wins(c)}/${c.games.length}（${pct(wins(c), c.games.length)}） | ${hits(c)} | ${distinct(c)} | ${c.drawn.base} | ${setText(c.drawn)} |`);
  }
  summary(`\n共 ${games} 局，${hours().toFixed(2)} 小時。`);
}

/** candidates.json files under `dirs` (one level of artifact folders, as download-artifact unpacks them). */
function findCandidates(dirs: string[]): string[] {
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === "candidates.json") files.push(p);
      else if (depth < 2 && statSync(p).isDirectory()) walk(p, depth + 1);
    }
  };
  for (const d of dirs) walk(d, 0);
  return files.sort();
}

async function check(): Promise<void> {
  const dirs = arg("from", "").split(",").filter((x) => x !== "");
  const games = Number(arg("games", "200"));
  const seedFrom = Number(arg("seed-from", "6000001"));
  const topN = Number(arg("top", "12"));
  const shard = Number(arg("shard", "0"));
  const shards = Number(arg("shards", "1"));
  const qualify = Number(arg("qualify", "25"));
  const all: Cand[] = [];
  for (const f of findCandidates(dirs)) all.push(...(JSON.parse(readFileSync(f, "utf8")).kept as Cand[]));
  // The best of each kind, by its search's win share (searches played different seeds: shares, not counts).
  const share = (c: Cand) => wins(c) / Math.max(1, c.games.length);
  const best = new Map<string, Cand>();
  for (const c of all) {
    const k = kind(c);
    const b = best.get(k);
    if (b === undefined || share(c) > share(b) || (share(c) === share(b) && c.id < b.id)) best.set(k, c);
  }
  const picked = [...best.values()].sort((a, b) => share(b) - share(a) || a.id.localeCompare(b.id)).slice(0, topN);
  const mine = picked.filter((_, i) => i % shards === shard);
  summary(`# 驗考官（D-147）：${all.length} 個留下的打法、${best.size} 種，取前 ${picked.length} 種；這個 job 是第 ${shard + 1}/${shards} 份，${mine.length} 個\n`);
  summary(`每個打新的種子 ${games} 局（從 ${seedFrom} 起），對困難、不給加成、${cap / MIN} 分算未分；贏 ${qualify}% 以上算合格。\n`);
  const fresh: Cand[] = mine.map((c) => ({ ...c, games: [] }));
  await playUpTo(fresh, games, seedFrom);
  const rows = fresh.map((c, i) => ({ id: c.id, kind: kind(c), map: c.map, searchWins: `${wins(mine[i])}/${mine[i].games.length}`, wins: wins(c), games: c.games.length, distinct: distinct(c), hits: hits(c), open: c.games.filter((g) => g.result === "open").length, qualified: (100 * wins(c)) / c.games.length >= qualify, base: c.drawn.base, set: c.drawn.set, plan: c.drawn.plan, outcomes: c.games }));
  summary("| 種類 | 打法 | 地圖 | 搜尋時 | 新種子 | 不重複的局 | 未分 | 打到主城 | 合格 |\n|---|---|---|---|---|---|---|---|---|");
  for (const x of rows) summary(`| ${x.kind} | ${x.id} | ${x.map} | ${x.searchWins} | ${x.wins}/${x.games}（${pct(x.wins, x.games)}） | ${x.distinct} | ${x.open} | ${x.hits} | ${x.qualified ? "是" : "否"} |`);
  writeFileSync(`${out}/examiners.json`, JSON.stringify({ games, seedFrom, cap, qualify, examiners: rows }, null, 0));
  summary(`\n${rows.filter((x) => x.qualified).length} 個合格，${hours().toFixed(2)} 小時。`);
}

if (mode === "search") await search();
else if (mode === "check") await check();
else {
  console.error("exam.ts search|check (see the top of the file)");
  process.exit(2);
}
