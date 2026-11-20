// D-147 (the hands-off training plan, step 1; ai-tools selftrain-plan.md 4.1): search the scripted player's plays for
// examiners, plans that beat hard with no bonus, and check those found on fresh seeds. What .github/workflows/ai-train.yml
// runs in its exam and examcheck modes. Never imported by the simulation Worker.
//   node src/ai/learn/exam.ts search --out DIR [--seed N] [--hours H] [--map random|fixed|mix] [--pool 48] [--cap 90]
//                                     [--rounds 6,20,60] [--cycles N] [--seed-offset K]
//                                     [--parents-from DIR[,DIR...] --parents ID[,ID...]] [--parent-share 0.33]
//       Each cycle draws a pool of plans (some mutated from the best found so far, by kind), plays every one the first
//       round's games, keeps the best third, plays those up to the next round's games, and so on; those that reach the
//       last round are kept (candidates.json). Every plan of a cycle plays the same seeds, so they are compared on equal
//       games; each job (--seed) has its own seeds. --parents: plans of earlier searches (candidates.json under
//       --parents-from) that parents are drawn from too (a search near them); never kept themselves, so never checked again.
//   node src/ai/learn/exam.ts check --from DIR[,DIR...] --out DIR [--games 200] [--seed-from 6000001] [--top 12]
//                                    [--shard K --shards N] [--cap 90] [--qualify 25] [--least 20] [--skip-checked]
//                                    [--ids ID[,ID...]]
//       The best plan of each kind across the searches (candidates.json under each DIR), the best `top` kinds, each
//       `games` games on fresh seeds; examiners.json lists them, qualified with `qualify` percent wins or more.
//       --skip-checked: examiners.json under the DIRs too (earlier checks): their plans are not checked again, nor
//       plans of a kind already qualified (ceo 2026-11-18: no new seeds for a plan that failed; the qualified stand).
//       --ids: exactly these plans, in this order, whatever their kind or share (ceo 2026-11-20: the examiners checked
//       again on fresh seeds after a rule change, D-154); --top, --least and --skip-checked do not apply. A missing id
//       is an error.
// Every mode writes summary.md (Markdown) and its files under --out; never commits.
// In CI (YIELD_REPO set, D-123; ceo 2026-11-16): every YIELD_EVERY it looks at the repository's other runs; a Pages job
// waiting for a runner, or any other job waiting YIELD_WAIT or longer, and it stops at once (search: the cycle under way is
// dropped, those before it kept; check: the plans done so far written), so its runner goes to them. "A Pages job" is one
// that publishes the site (a push to main); a pull request's Pages run only builds, and waits as any other job (2026-11-18:
// the second search gave way at once to #525's Pages build and kept nothing).

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { MapMode } from "../../protocol.ts";
import { drawPlan, type Drawn, mutate, rng } from "./exam-space.ts";
import { Pool } from "./pool.ts";
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

/** D-123: how often it looks (ms), and how long another job may wait before it gives way (ms). */
const YIELD_EVERY = 6 * 60_000;
const YIELD_WAIT = 10 * 60_000;
const yieldRepo = process.env.YIELD_REPO ?? "";
let lastLook = 0;
let apiErrors = 0;
let gaveWay = "";
const ghJson = (path: string, jq: string): unknown => JSON.parse(execFileSync("gh", ["api", path, "--jq", jq], { encoding: "utf8", timeout: 60_000 }) || "null");
/** Whether to give way now (in CI only, at most once every YIELD_EVERY); why, in gaveWay. */
function giveWay(): boolean {
  if (yieldRepo === "" || gaveWay !== "") return gaveWay !== "";
  const now = Date.now();
  if (now - lastLook < YIELD_EVERY) return false;
  lastLook = now;
  try {
    const old = (t: string) => now - Date.parse(t) >= YIELD_WAIT;
    type Run = { id: number; name: string; created: string; event: string; branch: string };
    const runs = (status: string) => ghJson(`repos/${yieldRepo}/actions/runs?status=${status}&per_page=50`, `[.workflow_runs[] | select(.name != "AI train" and .name != "AI scratch") | {id, name, created: .created_at, event, branch: .head_branch}]`) as Run[];
    // The site's deployment (Pages on a push to main), not a pull request's build of it.
    const deploys = (r: Run) => r.name === "Pages" && r.event === "push" && r.branch === "main";
    for (const r of runs("queued")) if (deploys(r) || old(r.created)) { gaveWay = `${r.name} 在等（run ${r.id}）`; return true; }
    for (const r of runs("in_progress")) {
      const waiting = ghJson(`repos/${yieldRepo}/actions/runs/${r.id}/jobs?filter=latest&per_page=100`, `[.jobs[] | select(.status == "queued") | .created_at]`) as string[];
      if (waiting.some((t) => deploys(r) || old(t))) { gaveWay = `${r.name} 有 job 在等（run ${r.id}）`; return true; }
    }
    apiErrors = 0;
  } catch {
    // Twice in a row: give way rather than hold runners blind.
    if (++apiErrors >= 2) { gaveWay = "GitHub API 連續兩次出錯"; return true; }
  }
  return false;
}
class GaveWay extends Error {}
let workers: Pool | null = null;
const pool = () => (workers ??= new Pool());

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
  // One pool for the whole program (pool.ts Pool); asked before each game whether to give way (D-123).
  const { results, stopped } = await pool().run(jobs, giveWay);
  if (stopped) throw new GaveWay(gaveWay);
  results.forEach((r: JobResult | undefined, k) => {
    if (r !== undefined && r.kind === "scripted") owner[k].games.push(r.outcome);
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
  // --seed-offset: a later dispatch of the same search plays seeds of its own.
  const seed = Number(arg("seed", "1")) + Number(arg("seed-offset", "0"));
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
  // --parents: plans of earlier searches to search near (parents only, never kept).
  const wanted = new Set(arg("parents", "").split(",").filter((x) => x !== ""));
  const seedParents: Cand[] = [];
  for (const f of findFiles(arg("parents-from", "").split(",").filter((x) => x !== ""))) {
    for (const c of JSON.parse(readFileSync(f, "utf8")).kept as Cand[]) if (wanted.has(c.id) && !seedParents.some((x) => x.id === c.id)) seedParents.push(c);
  }
  if (wanted.size > 0) summary(`從這些打法附近搜：${seedParents.map((c) => `${c.id}（${kind(c)}，搜尋時 ${wins(c)}/${c.games.length}）`).join("、") || "（一個都沒找到）"}。\n`);
  const parentShare = Number(arg("parent-share", String(1 / 3)));
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
    const parents = [...seedParents, ...[...best.values()].sort((a, b) => score(b) - score(a)).slice(0, 8)];
    const pool: Cand[] = [];
    for (let i = 0; i < poolN; i++) {
      const parent = parents.length > 0 && r() < parentShare ? parents[Math.floor(r() * parents.length)] : null;
      const map = parent?.map ?? mapFor();
      const drawn = parent !== null ? mutate(r, parent.drawn, map, 1 + Math.floor(r() * 3)) : drawPlan(r, map);
      pool.push({ id: `${seed}-${made++}`, drawn, map, games: [] });
    }
    // Every cycle its own seeds, so a plan is never kept for one set's luck alone.
    const base = seedBase + cycle * 200;
    let alive = pool;
    let cut = false;
    for (let k = 0; k < rounds.length; k++) {
      try {
        games += await playUpTo(alive, rounds[k], base);
      } catch (e) {
        if (!(e instanceof GaveWay)) throw e;
        summary(`- 第 ${cycle + 1} 輪：讓位（${e.message}），這一輪沒打完，不留；${hours().toFixed(2)} 小時`);
        break;
      }
      alive.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
      if (k < rounds.length - 1) {
        alive = alive.slice(0, Math.max(2, Math.ceil(alive.length / 3)));
        // Out of time before the next round (a cycle of long games, ceo's job limit): those alive are kept as they are.
        const per = hours() / Math.max(1, games);
        if (hours() + per * alive.length * (rounds[k + 1] - rounds[k]) > H) {
          cut = true;
          break;
        }
      }
    }
    if (gaveWay !== "") break;
    kept.push(...alive);
    const top = alive[0];
    summary(`- 第 ${cycle + 1} 輪：${pool.length} 個打法，最好的 ${top.id} 贏 ${wins(top)}/${top.games.length}（${kind(top)}；${top.map}）；累計 ${games} 局、${hours().toFixed(2)} 小時${cut ? "（時間到，這輪沒打完）" : ""}`);
    writeFileSync(`${out}/candidates.json`, JSON.stringify({ seed, cap, rounds, games, hours: hours(), kept }, null, 0));
    if (cut) break;
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

/** `name` files under `dirs` (two levels of folders: a run's artifacts, several runs). */
function findFiles(dirs: string[], name = "candidates.json"): string[] {
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === name) files.push(p);
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
  const least = Number(arg("least", "20"));
  // --skip-checked: plans already checked, and kinds already qualified, out.
  const checkedIds = new Set<string>();
  const qualifiedKinds = new Set<string>();
  if (process.argv.includes("--skip-checked")) {
    for (const f of findFiles(dirs, "examiners.json")) {
      for (const e of JSON.parse(readFileSync(f, "utf8")).examiners as { id: string; kind: string; qualified: boolean }[]) {
        checkedIds.add(e.id);
        if (e.qualified) qualifiedKinds.add(e.kind);
      }
    }
  }
  for (const f of findFiles(dirs)) all.push(...(JSON.parse(readFileSync(f, "utf8")).kept as Cand[]).filter((c) => c.games.length >= least && !checkedIds.has(c.id) && !qualifiedKinds.has(kind(c))));
  // The best of each kind, by its search's win share (searches played different seeds: shares, not counts).
  const share = (c: Cand) => wins(c) / Math.max(1, c.games.length);
  const best = new Map<string, Cand>();
  for (const c of all) {
    const k = kind(c);
    const b = best.get(k);
    if (b === undefined || share(c) > share(b) || (share(c) === share(b) && c.id < b.id)) best.set(k, c);
  }
  // --ids: these plans as they were kept, the first found of each id (search ids are unique: SEED-NUMBER).
  const ids = arg("ids", "").split(",").filter((x) => x !== "");
  let picked: Cand[];
  if (ids.length > 0) {
    const byId = new Map<string, Cand>();
    for (const f of findFiles(dirs)) for (const c of JSON.parse(readFileSync(f, "utf8")).kept as Cand[]) if (!byId.has(c.id)) byId.set(c.id, c);
    const missing = ids.filter((id) => !byId.has(id));
    if (missing.length > 0) throw new Error(`--ids: not kept by any search under --from: ${missing.join(", ")}`);
    picked = ids.map((id) => byId.get(id)!);
  } else picked = [...best.values()].sort((a, b) => share(b) - share(a) || a.id.localeCompare(b.id)).slice(0, topN);
  const mine = picked.filter((_, i) => i % shards === shard);
  if (ids.length > 0) summary(`# 驗考官（D-147）：指定的 ${picked.length} 個打法（${ids.join("、")}）；這個 job 是第 ${shard + 1}/${shards} 份，${mine.length} 個\n`);
  else summary(`# 驗考官（D-147）：${all.length} 個留下的打法、${best.size} 種，取前 ${picked.length} 種；這個 job 是第 ${shard + 1}/${shards} 份，${mine.length} 個\n`);
  if (ids.length === 0 && checkedIds.size > 0) summary(`跳過：驗過的 ${checkedIds.size} 個打法；已經合格的種類 ${[...qualifiedKinds].join("、") || "（沒有）"}。\n`);
  summary(`每個打新的種子 ${games} 局（從 ${seedFrom} 起），對困難、不給加成、${cap / MIN} 分算未分；贏 ${qualify}% 以上算合格。\n`);
  const fresh: Cand[] = mine.map((c) => ({ ...c, games: [] }));
  // One plan at a time, so a give-way keeps the plans done.
  const done: Cand[] = [];
  for (const c of fresh) {
    try {
      await playUpTo([c], games, seedFrom);
      done.push(c);
    } catch (e) {
      if (!(e instanceof GaveWay)) throw e;
      summary(`讓位（${e.message}）：${done.length}/${fresh.length} 個打完。\n`);
      break;
    }
  }
  fresh.length = 0;
  fresh.push(...done);
  const searched = new Map(mine.map((c) => [c.id, c]));
  const rows = fresh.map((c) => ({ id: c.id, kind: kind(c), map: c.map, searchWins: `${wins(searched.get(c.id)!)}/${searched.get(c.id)!.games.length}`, wins: wins(c), games: c.games.length, distinct: distinct(c), hits: hits(c), open: c.games.filter((g) => g.result === "open").length, qualified: (100 * wins(c)) / c.games.length >= qualify, base: c.drawn.base, set: c.drawn.set, plan: c.drawn.plan, outcomes: c.games }));
  summary("| 種類 | 打法 | 地圖 | 搜尋時 | 新種子 | 不重複的局 | 未分 | 打到主城 | 合格 |\n|---|---|---|---|---|---|---|---|---|");
  for (const x of rows) summary(`| ${x.kind} | ${x.id} | ${x.map} | ${x.searchWins} | ${x.wins}/${x.games}（${pct(x.wins, x.games)}） | ${x.distinct} | ${x.open} | ${x.hits} | ${x.qualified ? "是" : "否"} |`);
  writeFileSync(`${out}/examiners.json`, JSON.stringify({ games, seedFrom, cap, qualify, examiners: rows }, null, 0));
  summary(`\n${rows.filter((x) => x.qualified).length} 個合格，${hours().toFixed(2)} 小時。`);
}

try {
  if (mode === "search") await search();
  else if (mode === "check") await check();
  else {
    console.error("exam.ts search|check (see the top of the file)");
    process.exitCode = 2;
  }
} finally {
  await (workers as Pool | null)?.close();
}
