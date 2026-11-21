// D-147 step 4 (PR B): the automatic exam's commands, as .github/workflows/ai-train.yml's auto mode runs them; auto.ts
// decides, this plays and keeps. Never imported by the simulation Worker; never commits.
//   node src/ai/learn/exam-auto.ts init  --config FILE --out STATE
//       A state from a config: { "name": "...", "baseline": {...}, "candidates": [{ "id", "plan", "round" }] } (plans:
//       Partial<HardPlan>), the examiners of examiners.json (next to this file).
//   node src/ai/learn/exam-auto.ts work  --state STATE --island K --islands N --hours H --out DIR
//       Plays this job's share of the games the state still needs (every N-th from the K-th; the canary on job 0 only),
//       until H hours or it gives way (D-123, yield.ts); writes DIR/results.json as it goes.
//   node src/ai/learn/exam-auto.ts merge --state STATE --results DIR[,DIR] --out STATE --pause-id P-<run id>
//                                        [--tree T --commit C] [--resume ID]
//       The only writer of the state: adds the jobs' results, checks the canary, lifts the pause named by --resume
//       (AI_TRAIN_RESUME), moves the state on (auto.ts step) and writes it. Paused, it sets the step output paused=true.
//   node src/ai/learn/exam-auto.ts status --state STATE      one line: running, paused (id and why) or done
//   node src/ai/learn/exam-auto.ts report --state STATE      the weekly report (Markdown)
// Every mode but status writes summary.md under --out's folder (merge: next to the new state).

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkCanary, type Examiner, init, needed, prune, type Res, resOf, resume, type State, step } from "./auto.ts";
import { Pool, threads } from "./pool.ts";
import { GiveWay } from "./yield.ts";

const [mode] = process.argv.slice(2);
const arg = (n: string, f: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : f;
};
const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const readJson = <T>(f: string): T => JSON.parse(readFileSync(f, "utf8")) as T;
const output = (k: string, v: string) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`);
};
let summaryFile = "";
const summary = (line: string) => {
  console.log(line);
  if (summaryFile !== "") appendFileSync(summaryFile, `${line}\n`);
};
const pct = (a: number, b: number) => (b === 0 ? "-" : `${Math.round((100 * a) / b)}%`);

/** What a job leaves for the merge. */
interface Results {
  island: number;
  results: Record<string, Res>;
  canary: string[];
  games: number;
  hours: number;
  stopped: string;
}

function examiners(): Examiner[] {
  const f = new URL("./examiners.json", import.meta.url);
  return (readJson<{ examiners: Examiner[] }>(f.pathname).examiners).map((e) => ({ id: e.id, plan: e.plan, map: e.map }));
}

function cmdInit(): void {
  const config = readJson<{ name: string; baseline?: State["plans"][string]; candidates: State["queue"] }>(arg("config", ""));
  const s = init(examiners(), config.candidates, config.baseline ?? {}, now());
  s.log[0].what += `（設定 ${config.name}）`;
  const out = arg("out", "state.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(s));
  console.log(`state ${out}: ${s.queue.length} candidates, baseline ${s.baseline}`);
}

async function cmdWork(): Promise<void> {
  const s = readJson<State>(arg("state", "state.json"));
  const island = Number(arg("island", "0"));
  const islands = Number(arg("islands", "1"));
  const hours = Number(arg("hours", "1"));
  const out = arg("out", "out");
  mkdirSync(out, { recursive: true });
  summaryFile = join(out, "summary.md");
  const all = needed(s);
  const canary = all.filter((x) => x.key.startsWith("canary|"));
  const rest = all.filter((x) => !x.key.startsWith("canary|"));
  const mine = [...(island === 0 ? canary : []), ...rest.filter((_, i) => i % islands === island)];
  const started = performance.now();
  const spent = () => (performance.now() - started) / 3_600_000;
  const done: Results = { island, results: {}, canary: [], games: 0, hours: 0, stopped: "" };
  const giveWay = new GiveWay();
  const save = () => {
    done.hours = spent();
    writeFileSync(join(out, "results.json"), JSON.stringify(done));
  };
  // A game takes about a minute (D-147 trial); it stops handing out games a few minutes before the hours are up.
  const stop = () => {
    if (spent() > hours - 0.05) done.stopped ||= "時間到";
    else if (giveWay.now()) done.stopped ||= `讓位：${giveWay.why}`;
    return done.stopped !== "";
  };
  const pool = new Pool();
  try {
    const batch = threads() * 4;
    for (let i = 0; i < mine.length && done.stopped === ""; i += batch) {
      const part = mine.slice(i, i + batch);
      const { results } = await pool.run(part.map((x) => x.job), stop);
      results.forEach((r, k) => {
        if (r === undefined) return;
        const res = resOf(r);
        if (part[k].key.startsWith("canary|")) done.canary[Number(part[k].key.split("|")[1])] = res.h;
        else done.results[part[k].key] = res;
        done.games++;
      });
      save();
    }
  } finally {
    await pool.close();
  }
  if (done.stopped === "") done.stopped = mine.length === 0 ? "沒有要下的局" : "下完了";
  save();
  if (done.stopped.startsWith("讓位")) output("yielded", "true");
  summary(`## 自動考試：第 ${island + 1}/${islands} 個 job\n`);
  summary(`- 這個 job 分到 ${mine.length} 局，下了 ${done.games} 局，${done.hours.toFixed(2)} 小時；結束：${done.stopped}`);
  if (s.current !== null) summary(`- 正在考 ${s.current.id}（${s.current.hash}），${s.current.stage === "exam" ? `已看 ${s.current.looks} 次` : "上線前檢查"}`);
}

/** results.json files under `dirs` (two levels: a run's artifacts). */
function findResults(dirs: string[]): string[] {
  const files: string[] = [];
  const walk = (d: string, depth: number) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (f === "results.json") files.push(p);
      else if (depth < 2 && statSync(p).isDirectory()) walk(p, depth + 1);
    }
  };
  for (const d of dirs) walk(d, 0);
  return files.sort();
}

function cmdMerge(): void {
  const s = readJson<State>(arg("state", "state.json"));
  const out = arg("out", "state.json");
  mkdirSync(dirname(out), { recursive: true });
  summaryFile = join(dirname(out), "summary.md");
  const at = now();
  const pauseId = arg("pause-id", "P-local");
  summary("## 自動考試：合併（D-147）\n");
  const resumeId = arg("resume", "").trim();
  if (resumeId !== "" && s.paused !== null) {
    if (resume(s, resumeId, at)) summary(`- 照 AI_TRAIN_RESUME 恢復 ${resumeId}`);
    else summary(`- AI_TRAIN_RESUME 是 ${resumeId}，不是現在的暫停 ${s.paused.id}，沒有作用`);
  }
  let games = 0;
  let canary: string[] = [];
  for (const f of findResults(arg("results", "").split(",").filter((x) => x !== ""))) {
    const r = readJson<Results>(f);
    for (const [k, v] of Object.entries(r.results)) {
      if (s.results[k] === undefined) {
        s.results[k] = v;
        games++;
      }
    }
    if (r.canary.length > 0) canary = r.canary;
    summary(`- job ${r.island + 1}：${r.games} 局、${r.hours.toFixed(2)} 小時，${r.stopped}`);
  }
  summary(`- 新的結果 ${games} 局`);
  if (s.paused === null) summary(`- 固定的三局：${checkCanary(s, canary, arg("tree", ""), arg("commit", ""), pauseId, at)}`);
  for (const line of step(s, pauseId, at)) summary(`- ${line}`);
  prune(s);
  writeFileSync(out, JSON.stringify(s));
  summary("");
  summary(statusLine(s));
  if (s.paused !== null) {
    output("paused", "true");
    output("pause_id", s.paused.id);
    summary(`\n### 暫停中：${s.paused.id}\n\n- 原因：${s.paused.reason}\n- 數字：${s.paused.numbers.join("；") || "-"}`);
    summary(`- 要再跑：使用者同意、ceo 告訴 war-game-ai 之後，把 repository variable AI_TRAIN_RESUME 設成 ${s.paused.id}（只對這一次暫停有效）。`);
  }
  if (s.done) output("done", "true");
}

function statusLine(s: State): string {
  if (s.paused !== null) return `暫停中 ${s.paused.id}：${s.paused.reason}`;
  if (s.done) return `考完了：考了 ${s.tested} 個候選，升級 ${s.decided.filter((d) => d.verdict === "promote").length} 次`;
  const c = s.current;
  return `進行中：考了 ${s.tested} 個，還有 ${s.queue.length} 個；${c === null ? "下一個還沒開始" : `正在考 ${c.id}（${c.stage === "exam" ? `已看 ${c.looks} 次` : "上線前檢查"}）`}`;
}

/** The weekly report (D-147; ceo 2026-11-21: from the Monday after AI_TRAIN is first on). */
function report(s: State): string[] {
  const promoted = s.decided.filter((d) => d.verdict === "promote");
  const lines = [
    "# 自動訓練週報（D-147）",
    "",
    `- ${statusLine(s)}`,
    `- 目前最強版：${s.champion}${s.champion === s.baseline ? "（還是基準）" : ""}；考了 ${s.tested} 個候選，升級 ${promoted.length} 次`,
  ];
  const base = Object.entries(s.base);
  if (base.length > 0) lines.push(`- 對基準：${base.map(([h, b]) => `${h} ${pct(b.score * b.games, b.games)}（±${Math.round(b.se * 100)}%）`).join("、")}`);
  lines.push("", "## 每個候選", "", "| 候選 | 結果 | 原因 | 看了幾次 | 考官 +/- | 對最強版 +/- | Q（考官的局不同的比例） | 平手 |", "|---|---|---|---|---|---|---|---|");
  for (const d of s.decided) lines.push(`| ${d.id} | ${d.verdict === "promote" ? "升級" : "不升級"} | ${d.why} | ${d.looks} | +${d.ex.plus}/-${d.ex.minus}（${d.ex.games} 局） | +${d.vs.plus}/-${d.vs.minus}（${d.vs.games} 局） | ${pct(d.q * 1000, 1000)} | ${pct(d.draws * 1000, 1000)} |`);
  const qs = s.decided.filter((d) => d.ex.games > 0);
  const vsGames = s.decided.reduce((a, d) => a + d.vs.games, 0);
  const vsDraws = s.decided.reduce((a, d) => a + d.draws * d.vs.games, 0);
  lines.push(
    "",
    "## 假設和實測",
    "",
    "| 假設 | 設定 | 實測 |",
    "|---|---|---|",
    `| 考官的局，候選和最強版結果不同的比例（Q） | 30% | ${qs.length === 0 ? "-" : pct(qs.reduce((a, d) => a + d.q * d.ex.games, 0), qs.reduce((a, d) => a + d.ex.games, 0))} |`,
    `| 困難對困難的平手 | 2% | ${pct(vsDraws, vsGames)} |`,
    "",
    "## 暫停和恢復",
    "",
  );
  const pauses = s.log.filter((l) => l.what.startsWith("暫停") || l.what.startsWith("恢復"));
  lines.push(...(pauses.length === 0 ? ["- 沒有"] : pauses.map((l) => `- ${l.at}：${l.what}`)));
  lines.push(
    "",
    "自動暫停時：我用白話回報 ceo（為什麼停、停之前的數字、建議再跑還是先看）；使用者決定；ceo 告訴我之後我才把 AI_TRAIN_RESUME 設成暫停的編號。鏈停了而定時排程沒接回時：Actions 頁對 AI train 按 Run workflow、mode 選 dispatch。",
    "",
    "## 帳（最近 30 筆）",
    "",
    ...s.log.slice(-30).map((l) => `- ${l.at}：${l.what}`),
  );
  return lines;
}

if (mode === "init") cmdInit();
else if (mode === "work") await cmdWork();
else if (mode === "merge") cmdMerge();
else if (mode === "status") console.log(statusLine(readJson<State>(arg("state", "state.json"))));
else if (mode === "report") {
  const lines = report(readJson<State>(arg("state", "state.json")));
  const out = arg("out", "");
  if (out !== "") writeFileSync(out, `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
} else {
  console.error("exam-auto.ts init|work|merge|status|report (see the top of the file)");
  process.exitCode = 2;
}
