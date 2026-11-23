// D-147 step 4 (PR B): the automatic exam's commands, as .github/workflows/ai-train.yml's auto mode runs them; auto.ts
// decides, this plays and keeps. Never imported by the simulation Worker; never commits.
//   node src/ai/learn/exam-auto.ts init  --config FILE --out STATE
//       A state from a config: { "name": "...", "baseline": {...}, "candidates": [{ "id", "plan", "round" }],
//       "lookAhead"?: 1-12, "generator"?: [files under sim/ of the program that makes the candidates] } (plans:
//       Partial<HardPlan>), the examiners of examiners.json (next to this file). The training's name must be in
//       exam-blocks.json with blocks of its own and the hash of what makes its candidates (the config without its note,
//       and the generator's files): a state that was lost is never started again on seeds already seen with other
//       candidates.
//   node src/ai/learn/exam-auto.ts source --config FILE      that hash
//   node src/ai/learn/exam-auto.ts work  --state STATE --config FILE --island K --islands N --hours H --out DIR [--resume ID]
//       Plays this job's share of the games the state still needs (every N-th from the K-th; the canary on job 0 only),
//       until H hours or it gives way (D-123, yield.ts); writes DIR/results.json as it goes. --resume (AI_TRAIN_RESUME)
//       lifts that pause first, as the merge will (else the first segment after a resume would play nothing).
//   node src/ai/learn/exam-auto.ts merge --state STATE --config FILE --results DIR[,DIR] --out STATE --pause-id P-<run id>
//                                        [--tree T --commit C] [--resume ID]
//       The only writer of the state: adds the jobs' results, checks the canary, lifts the pause named by --resume
//       (AI_TRAIN_RESUME), moves the state on (auto.ts step) and writes it. Paused, it sets the step output paused=true.
//       Both work and merge: the config's hash changed, the next candidate starts a new block of seeds.
//   node src/ai/learn/exam-auto.ts status --state STATE      one line: running, paused (id and why) or done
//   node src/ai/learn/exam-auto.ts report --state STATE      the weekly report (Markdown)
// Every mode but status writes summary.md under --out's folder (merge: next to the new state).

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { checkCanary, checkState, type Examiner, init, listedSum, needed, prune, type Res, resOf, resume, setSource, type State, step, type Training } from "./auto.ts";
import { Pool, threads } from "./pool.ts";
import { SPRT } from "./sprt.ts";
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

interface Config {
  name: string;
  note?: string;
  baseline?: State["plans"][string];
  candidates: State["queue"];
  lookAhead?: number;
  generator?: string[];
}
function readConfig(): { config: Config; source: string } {
  const file = arg("config", "");
  if (file === "") throw new Error("--config FILE: the training's settings (what makes its candidates is hashed from it)");
  const config = readJson<Config>(file);
  // What makes the candidates: the settings, less the note, and the program's files.
  const { note: _note, ...settings } = config;
  const h = createHash("sha256").update(JSON.stringify(settings));
  for (const f of config.generator ?? []) h.update(`\0${f}\0`).update(readFileSync(f));
  return { config, source: h.digest("hex").slice(0, 12) };
}
function readState(): State {
  const s = readJson<State>(arg("state", "state.json"));
  checkState(s);
  return s;
}

function cmdInit(): void {
  const { config, source } = readConfig();
  const registry = readJson<{ trainings: Record<string, Omit<Training, "name">> }>(new URL("./exam-blocks.json", import.meta.url).pathname).trainings;
  if (!Object.hasOwn(registry, config.name)) throw new Error(`${config.name} is not in exam-blocks.json: give it a name and blocks no training had`);
  const { first, last, source: registered } = registry[config.name];
  if (registered !== source) throw new Error(`${config.name}: its settings (${source}) are not those registered (${registered}): other candidates take a new name and new blocks (exam-blocks.json)`);
  const s = init(examiners(), config.candidates, { name: config.name, first, last, source, lookAhead: config.lookAhead }, config.baseline ?? {}, now());
  const out = arg("out", "state.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(s));
  console.log(`state ${out}: ${s.queue.length} candidates, baseline ${s.baseline}`);
}

async function cmdWork(): Promise<void> {
  const s = readState();
  const resumeId = arg("resume", "").trim();
  if (resumeId !== "") resume(s, resumeId, now());
  setSource(s, readConfig().source, now());
  // Moved on as the merge will (not saved): a state just started from its config has no candidate taken yet, and its
  // first segment would play none of the candidate's games (PR B trial, run 44872573528).
  step(s, "P-work", now());
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
  // The only opener of the exam's seeds (seeds.ts).
  const pool = new Pool(threads(), { exam: true });
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
  const s = readState();
  const { source } = readConfig();
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
  let yielded = 0;
  for (const f of findResults(arg("results", "").split(",").filter((x) => x !== ""))) {
    const r = readJson<Results>(f);
    for (const [k, v] of Object.entries(r.results)) {
      if (s.results[k] === undefined) {
        s.results[k] = v;
        games++;
      }
    }
    if (r.canary.length > 0) canary = r.canary;
    if (r.stopped.startsWith("讓位")) yielded++;
    summary(`- job ${r.island + 1}：${r.games} 局、${r.hours.toFixed(2)} 小時，${r.stopped}`);
  }
  summary(`- 新的結果 ${games} 局`);
  // The weekly report counts the segments that gave way (ceo 2026-11-21).
  if (yielded > 0) s.log.push({ at, what: `讓位：這一段 ${yielded} 個 job 讓位（D-123）` });
  if (s.paused === null) summary(`- 固定的三局：${checkCanary(s, canary, arg("tree", ""), arg("commit", ""), pauseId, at)}`);
  setSource(s, source, at);
  const blocks = s.blocks.length;
  for (const line of step(s, pauseId, at)) summary(`- ${line}`);
  for (const b of s.blocks.slice(blocks)) summary(`- 換考試種子：第 ${b.n} 批（${b.why}）`);
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
    // A block's candidates share seeds: they add up (a union bound), by the candidates listed when it opened (sprt.ts).
    `- 誤升級機率的上限（到目前開的各批）：各批開批時的名單共 ${listedSum(s)} 個 × 1e-4（兩條路合起來），至少誤升級一次最多 ${(Math.min(1, listedSum(s) * 2 * SPRT.alpha) * 100).toFixed(2)}%；上次恢復以後 ${listedSum(s) - s.listedAtResume} 個，滿 ${SPRT.candidatesMax} 個就暫停`,
    "- 這個上限要成立：候選、最強版和產生候選的程式都沒看過那一批種子的結果；各考官各用種子、兩個出生點算一個單位；λ 只看之前各次；種子當作隨機抽的；同一場考試規則沒變（sprt.ts 的 1–7）",
    `- 考試種子：第 ${s.blocks.at(-1)!.n} 批（這次訓練有第 ${s.training.first}-${s.training.last} 批）；開過的：${s.blocks.map((b) => `${b.n}（${b.why}，名單 ${b.listed}）`).join("、")}`,
  ];
  const base = Object.entries(s.base);
  if (base.length > 0) lines.push(`- 對基準：${base.map(([h, b]) => `${h} ${pct(b.score * b.games, b.games)}（±${Math.round(b.se * 100)}%）`).join("、")}`);
  lines.push("", "## 每個候選", "", "| 候選 | 批 | 結果 | 原因 | Q（考官的局不同的比例） | Qb | 看了幾次 | 局數（候選的） | 考官 +/- | 對最強版 +/- | 平手 |", "|---|---|---|---|---|---|---|---|---|---|---|");
  for (const d of s.decided) lines.push(`| ${d.id} | ${d.block} | ${d.verdict === "promote" ? "升級" : "不升級"} | ${d.why} | ${(d.q * 100).toFixed(1)}% | ${(d.qb * 100).toFixed(1)}% | ${d.looks} | ${d.ex.games + d.vs.games} | +${d.ex.plus}/-${d.ex.minus}（${d.ex.games} 局） | +${d.vs.plus}/-${d.vs.minus}（${d.vs.games} 局） | ${(d.draws * 100).toFixed(1)}% |`);
  const qs = s.decided.filter((d) => d.ex.games > 0);
  const vsGames = s.decided.reduce((a, d) => a + d.vs.games, 0);
  const vsDraws = s.decided.reduce((a, d) => a + d.draws * d.vs.games, 0);
  lines.push(
    "",
    "## 假設和實測",
    "",
    "| 假設 | 設定 | 實測 |",
    "|---|---|---|",
    `| 考官的局，候選和最強版結果不同的比例（Q；只有第一次看用假設值） | ${SPRT.discordant * 100}% | ${qs.length === 0 ? "-" : pct(qs.reduce((a, d) => a + d.q * d.ex.games, 0), qs.reduce((a, d) => a + d.ex.games, 0))} |`,
    `| 對最強版一個種子兩局同向的程度（Qb；只有第一次看用假設值；50% 是獨立） | ${SPRT.pairDiscordant * 100}% | ${pct(s.decided.reduce((a, d) => a + d.qb * d.vs.games, 0), vsGames)} |`,
    `| 困難對困難的平手 | 2% | ${pct(vsDraws, vsGames)} |`,
    "",
    "## 暫停和恢復",
    "",
  );
  const yields = s.log.filter((l) => l.what.startsWith("讓位"));
  lines.splice(4, 0, `- 讓位的段：${yields.length} 段${yields.length > 0 ? `（最近一次 ${yields.at(-1)!.at}）` : ""}`);
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
else if (mode === "source") console.log(readConfig().source);
else if (mode === "work") await cmdWork();
else if (mode === "merge") cmdMerge();
else if (mode === "status") console.log(statusLine(readState()));
else if (mode === "report") {
  const lines = report(readState());
  const out = arg("out", "");
  if (out !== "") writeFileSync(out, `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
} else {
  console.error("exam-auto.ts init|source|work|merge|status|report (see the top of the file)");
  process.exitCode = 2;
}
