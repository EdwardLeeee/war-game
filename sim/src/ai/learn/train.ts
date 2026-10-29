// D-086 B training: what .github/workflows/ai-train.yml runs (docs/research/2026-10-ai-nn.md).
//   node src/ai/learn/train.ts dryrun --out DIR                      cores, and games an hour (hard against hard)
//   node src/ai/learn/train.ts record --games 400 --out DIR           hard's inputs and what it did (samples.bin, games.json), for looking into
//   node src/ai/learn/train.ts es --out DIR [--start FILE] [--resume DIR] [--seed N] [--hours H] [--generations N] [--config JSON]
//                                                                    from the network that always plays as hard (asHardNet) unless --start;
//                                                                    --config over ES_DEFAULTS, or over the resumed run's settings
//   node src/ai/learn/train.ts eval [--net FILE] --games N --crush M --seed S --out DIR [--rules keep,siege,rich,market] [--name X]
//                                                                    against hard (N on each map, both spawns) and push-crush (M on each
//                                                                    map), seeds from S; no --net: hard itself (the control); eval.json too
//   node src/ai/learn/train.ts report --dir DIR [--control FILE] --out DIR
//                                                                    every eval.json under DIR against the control's (NN v2, ceo 2026-10-29)
// Every mode writes summary.md (Markdown) and its files under --out; checkpoints and records are CI artifacts, never commits.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { cpus } from "node:os";
import { asHardNet, HEAD_ARMY, HEAD_DEFENSE, HEAD_TOWN, NET_HEADS, NET_INPUTS, type NetWeights } from "../net.ts";
import { ES_DEFAULTS, type EsState, fromVector, generation, newState, sameShape } from "./es.ts";
import type { GameOutcome, Opponent, Switches } from "./play.ts";
import { runAll, threads } from "./pool.ts";
import type { Job } from "./worker.ts";

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

/** The switches given, for the summaries ("照 main": none, so all on since D-112). */
function switchesText(s: Switches | undefined): string {
  const set = Object.entries(s ?? {}).map(([k, v]) => `${k.toUpperCase()} ${v ? "開" : "關"}`);
  return set.length === 0 ? "照 main" : set.join("、");
}

/** A sample: NET_INPUTS inputs, then what hard did for each head (ai.ts netLog; -1: nothing at that think). */
type Sample = number[];
/** Samples as bytes: NET_INPUTS inputs (0..255), then each label + 1 (0: none). */
const WIDTH = NET_INPUTS + NET_HEADS.length;
function saveSamples(file: string, samples: Sample[]): void {
  const b = new Uint8Array(samples.length * WIDTH);
  samples.forEach((s, k) => s.forEach((v, i) => (b[k * WIDTH + i] = i < NET_INPUTS ? v : v + 1)));
  writeFileSync(file, b);
}

/** Wins, draws and losses of a set of games. */
interface Tally {
  games: number;
  won: number;
  draws: number;
  lost: number;
}
/** What `eval` measures (eval.json), NN v2. */
interface EvalResult {
  name: string;
  seed: number;
  hard: Tally;
  crush: Tally & { at45: number; towers45: number; governed45: number };
  /** The defense head's choices over all its games: as hard, a tower next, no tower now. */
  defense: number[];
  /** Every head's, over all its games. */
  choices: number[][];
}
const tally = (res: GameOutcome[]): Tally => {
  const won = res.filter((o) => o.won === 1).length;
  const draws = res.filter((o) => o.won < 0).length;
  return { games: res.length, won, draws, lost: res.length - won - draws };
};
/** The games of one set, `n` on each map; against hard both spawns in turn. */
function setJobs(net: NetWeights | null, opp: Opponent, n: number, seed0: number, maxTicks: number, switches: Switches): Job[] {
  const jobs: Job[] = [];
  for (const map of ["fixed", "random"] as const) {
    for (let k = 0; k < n; k++) jobs.push({ kind: "play", spec: { seed: seed0 + (opp.kind === "hard" ? k >> 1 : k), map, swap: (k & 1) === 1, maxTicks, opp, rules: switches }, net });
  }
  return jobs;
}
async function evaluate(name: string, net: NetWeights | null, n: number, m: number, seed0: number, switches: Switches): Promise<EvalResult> {
  const hard = (await runAll(setJobs(net, { kind: "hard" }, n, seed0, 72000, switches))).map((r) => r.outcome);
  // push-crush as CI plays it: 90 minutes.
  const crush = (await runAll(setJobs(net, { kind: "crush" }, m, seed0, 108000, switches))).map((r) => r.outcome);
  const at45 = crush.filter((o) => o.towers45 >= 0);
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const choices = NET_HEADS.map((k) => new Array(k).fill(0));
  for (const o of [...hard, ...crush]) o.choices.forEach((h, i) => h.forEach((v, k) => (choices[i][k] += v)));
  return {
    name,
    seed: seed0,
    hard: tally(hard),
    crush: { ...tally(crush), at45: at45.length, towers45: mean(at45.map((o) => o.towers45)), governed45: mean(at45.map((o) => o.governed45)) },
    defense: choices[HEAD_DEFENSE],
    choices,
  };
}
/** A head's choices as "a／b（not as hard %）". */
const dev = (c: number[]) => {
  const all = c.reduce((a, b) => a + b, 0);
  return `${c.slice(1).join("／")}（${all === 0 ? "-" : `${(((all - c[0]) * 100) / all).toFixed(1)}%`}）`;
};
/** (wins - losses) of a tally, and its standard deviation over the games (each game +1, 0 or -1). */
const wl = (t: Tally) => {
  const d = t.won - t.lost;
  if (t.games === 0) return { d, sd: 0 };
  const v = (t.won + t.lost) / t.games - (d / t.games) ** 2;
  return { d, sd: Math.sqrt(t.games * v) };
};

if (mode === "dryrun") {
  // How fast this machine plays: hard against hard on the fixed map, every core busy.
  const n = threads() * 2;
  const jobs: Job[] = Array.from({ length: n }, (_, k) => ({ kind: "play", spec: { seed: 1 + (k >> 1), map: "fixed", swap: (k & 1) === 1, maxTicks: 72000, opp: { kind: "hard" } }, net: null }));
  const t0 = performance.now();
  const res = await runAll(jobs);
  const sec = (performance.now() - t0) / 1000;
  summary(`## 試跑\n\n- 核心：${cpus().length}（${cpus()[0]?.model ?? "?"}）\n- ${n} 局困難對困難（固定地圖，60 分上限）：${sec.toFixed(0)} 秒，每小時大約 ${Math.round((n * 3600) / sec)} 局`);
  summary(`- 平均每局 ${(res.reduce((a, r) => a + r.outcome.ticks, 0) / n / 1200).toFixed(1)} 分（遊戲時間）`);
} else if (mode === "record") {
  const games = Number(arg("games", "400"));
  const jobs: Job[] = Array.from({ length: games }, (_, k) => ({
    kind: "record",
    spec: { seed: 1000 + (k >> 2), map: (k & 2) === 0 ? "fixed" : "random", swap: (k & 1) === 1, maxTicks: Number(arg("ticks", "36000")) },
    opp: (k >> 2) % 3 === 2 ? { kind: "normal" } : { kind: "hard" },
    every: Number(arg("every", "10")),
  }));
  const res = await runAll(jobs);
  const samples = res.flatMap((r) => (r.kind === "record" ? r.samples : []));
  saveSamples(`${out}/samples.bin`, samples);
  // How many samples each game gave, in order: bc holds out whole games (ceo 2026-10-19).
  writeFileSync(`${out}/games.json`, JSON.stringify(res.map((r) => (r.kind === "record" ? r.samples.length : 0))));
  summary(`## 記錄\n\n- ${games} 局，${samples.length} 個決策點（每 ${arg("every", "10")} 次思考取一次）`);
} else if (mode === "es") {
  const resume = arg("resume", "");
  const startFile = arg("start", "");
  const start: NetWeights = startFile === "" ? asHardNet() : JSON.parse(readFileSync(startFile, "utf8"));
  if (!sameShape(start)) throw new Error("the start network has another shape");
  const config = JSON.parse(arg("config", "{}"));
  let state: EsState = resume !== "" && existsSync(`${resume}/state.json`) ? JSON.parse(readFileSync(`${resume}/state.json`, "utf8")) : newState(start, Number(arg("seed", "1")), config);
  // Going on with other settings (the rules once they ship, ceo 2026-10-25): from the weights it has.
  state.config = { ...ES_DEFAULTS, ...state.config, ...config };
  const limitH = Number(arg("hours", "5.5"));
  const maxGen = state.generation + Number(arg("generations", "1000000"));
  const m = state.config.mix;
  summary(
    `## 演化策略（種子 ${state.seed}，從第 ${state.generation} 代起，規則開關 ${switchesText(state.config.rules)}）\n\n` +
      `每代 ${state.config.pairs} 對候選，每個候選 ${m.hard + m.normal + m.push + m.crush + m.turtle} 局：困難 ${m.hard}、普通 ${m.normal}、push ${m.push}、push-crush ${m.crush}、push-turtle ${m.turtle}；` +
      `上限 ${state.config.maxTicks / 1200} 分，沒分出勝負算輸。固定照困難的組：${state.config.fixed.join("、")}（練兵、蓋什麼）。\n\n` +
      `「不照困難」：每組決定，不照困難的選擇在所有思考裡的次數和比例（ceo 2026-10-19）。\n\n` +
      `| 代 | 局 | 贏 | 平手 | 輸 | 贏：困難／普通／push／crush／turtle | 打到對方主城 | 軍隊：守家／出兵 | 城鎮：搶／治理 | 防守：蓋塔／不蓋 | 加分權重 | 秒 |\n|---|---|---|---|---|---|---|---|---|---|---|---|`,
  );
  while (state.generation < maxGen) {
    const r = await generation(state, start);
    const by = ["hard", "normal", "push", "crush", "turtle"].map((k) => `${r.byOpp[k]?.won ?? 0}/${r.byOpp[k]?.games ?? 0}`).join("　");
    summary(`| ${r.generation} | ${r.games} | ${r.won} | ${r.draws} | ${r.games - r.won - r.draws} | ${by} | ${r.reached} | ${dev(r.choices[HEAD_ARMY])} | ${dev(r.choices[HEAD_TOWN])} | ${dev(r.choices[HEAD_DEFENSE])} | ${r.shaping.toFixed(3)} | ${r.seconds} |`);
    writeFileSync(`${out}/state.json`, JSON.stringify(state));
    writeFileSync(`${out}/net.json`, JSON.stringify(fromVector(state.theta, start)));
    // Stop before the job's limit with time for one more generation and the upload.
    if (hours() + (r.seconds / 3600) * 1.5 > limitH) break;
  }
  state = JSON.parse(readFileSync(`${out}/state.json`, "utf8"));
  summary(`\n到第 ${state.generation} 代，${hours().toFixed(2)} 小時。`);
} else if (mode === "eval") {
  const file = arg("net", "");
  const net: NetWeights | null = file === "" ? null : JSON.parse(readFileSync(file, "utf8"));
  const names = arg("rules", "").split(",").filter((x) => x !== "");
  const bad = names.filter((x) => x !== "keep" && x !== "siege" && x !== "rich" && x !== "market");
  if (bad.length > 0) throw new Error(`--rules ${bad.join(",")}: keep, siege, rich or market`);
  const switches: Switches = Object.fromEntries(names.map((x) => [x, true]));
  const name = arg("name", file === "" ? "control" : file);
  const r = await evaluate(name, net, Number(arg("games", "100")), Number(arg("crush", "20")), Number(arg("seed", "2000001")), switches);
  writeFileSync(`${out}/eval.json`, JSON.stringify(r));
  const h = wl(r.hard);
  summary(
    `## 比強弱（${file === "" ? "困難本身" : `${name}：${file}`}，規則開關 ${switchesText(switches)}，種子從 ${r.seed} 起）\n\n` +
      `| 對手 | 局 | 贏 | 平手 | 輸 | 贏－輸（標準差） | 第 45 分還在打的局 | 第 45 分箭樓（每局） | 第 45 分治理的城（每局） |\n|---|---|---|---|---|---|---|---|---|\n` +
      `| 困難（60 分） | ${r.hard.games} | ${r.hard.won} | ${r.hard.draws} | ${r.hard.lost} | ${h.d}（${h.sd.toFixed(1)}） | | | |\n` +
      `| push-crush（90 分） | ${r.crush.games} | ${r.crush.won} | ${r.crush.draws} | ${r.crush.lost} | ${wl(r.crush).d} | ${r.crush.at45} | ${r.crush.towers45.toFixed(1)} | ${r.crush.governed45.toFixed(1)} |\n\n` +
      `- 防守組：蓋塔／不蓋 ${dev(r.defense)}`,
  );
} else if (mode === "report") {
  // Every eval.json under --dir; the control: --control, or the one named "control" there.
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d).sort()) {
      const p = `${d}/${f}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (f === "eval.json") files.push(p);
    }
  };
  walk(arg("dir", "evals"));
  const all: EvalResult[] = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
  const controlFile = arg("control", "");
  const control = controlFile !== "" && existsSync(controlFile) ? (JSON.parse(readFileSync(controlFile, "utf8")) as EvalResult) : all.find((r) => r.name === "control");
  if (control === undefined) throw new Error("no control (hard itself): --control FILE, or an eval named control under --dir");
  const c = wl(control.hard);
  const rows = all.filter((r) => r !== control && r.name !== "control").map((r) => {
    const x = wl(r.hard);
    const same = r.seed === control.seed && r.hard.games === control.hard.games ? "" : "（種子或局數和對照不同）";
    return `| ${r.name} | ${r.hard.won}-${r.hard.draws}-${r.hard.lost} | ${x.d} | ${x.d - c.d}${same} | ${c.sd > 0 ? ((x.d - c.d) / c.sd).toFixed(2) : "-"} | ${r.crush.won}-${r.crush.draws}-${r.crush.lost} | ${r.crush.towers45.toFixed(1)} | ${r.crush.governed45.toFixed(1)} | ${dev(r.defense)} |`;
  });
  summary(
    `## 各島對照困難本身（種子從 ${control.seed} 起，對困難 ${control.hard.games} 局、push-crush ${control.crush.games} 局）\n\n` +
      `對照：對困難 ${control.hard.won}-${control.hard.draws}-${control.hard.lost}（贏－輸 ${c.d}，標準差 ${c.sd.toFixed(1)}）；push-crush ${control.crush.won}-${control.crush.draws}-${control.crush.lost}，第 45 分箭樓 ${control.crush.towers45.toFixed(1)}、治理的城 ${control.crush.governed45.toFixed(1)}（每局，${control.crush.at45} 局打到第 45 分）。\n\n` +
      `| 島 | 對困難 贏-平-輸 | 贏－輸 | 比對照多 | ÷ 標準差 | push-crush 贏-平-輸 | 第 45 分箭樓 | 第 45 分治理的城 | 防守：蓋塔／不蓋（不照困難） |\n|---|---|---|---|---|---|---|---|---|\n` +
      rows.join("\n"),
  );
} else {
  throw new Error(`mode ${mode}: dryrun, record, es, eval or report`);
}
