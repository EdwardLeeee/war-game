// D-086 B training: what .github/workflows/ai-train.yml runs (docs/research/2026-10-ai-nn.md).
//   node src/ai/learn/train.ts dryrun --out DIR                      cores, and games an hour (hard against hard)
//   node src/ai/learn/train.ts record --games 400 --out DIR           hard's choices from its own view (samples.bin)
//   node src/ai/learn/train.ts bc --data DIR --out DIR                imitation, then the integer network (bc.json)
//   node src/ai/learn/train.ts es --start FILE --out DIR [--resume DIR] [--seed N] [--hours H] [--generations N]
//   node src/ai/learn/train.ts eval --net FILE --games N --out DIR    against hard (both spawns), normal, the late group
// Every mode writes summary.md (Markdown) and its files under --out; checkpoints and records are CI artifacts, never commits.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { cpus } from "node:os";
import { NET_HEADS, NET_INPUTS, type NetWeights } from "../net.ts";
import { agreement, quantize, type Sample, trainFloat } from "./bc.ts";
import { type EsState, fromVector, generation, newState, sameShape } from "./es.ts";
import type { Opponent } from "./play.ts";
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

/** Samples as bytes: NET_INPUTS inputs (0..255), then each head's label + 1 (0: none). */
const WIDTH = NET_INPUTS + NET_HEADS.length;
function saveSamples(file: string, samples: Sample[]): void {
  const b = new Uint8Array(samples.length * WIDTH);
  samples.forEach((s, k) => s.forEach((v, i) => (b[k * WIDTH + i] = i < NET_INPUTS ? v : v + 1)));
  writeFileSync(file, b);
}
function loadSamples(file: string): Sample[] {
  const b = readFileSync(file);
  const out: Sample[] = [];
  for (let k = 0; k + WIDTH <= b.length; k += WIDTH) out.push(Array.from(b.subarray(k, k + WIDTH), (v, i) => (i < NET_INPUTS ? v : v - 1)));
  return out;
}

/** Against hard, both spawns, `n` games on each map; against normal and the late group, `n / 2` on each. */
async function evaluate(net: NetWeights | null, n: number, seed0: number) {
  const sets: [string, Opponent, number][] = [
    ["hard", { kind: "hard" }, n],
    ["normal", { kind: "normal" }, n >> 1],
    ["late", { kind: "late" }, n >> 1],
  ];
  const rows: string[] = [];
  for (const [name, opp, games] of sets) {
    for (const map of ["fixed", "random"] as const) {
      const jobs: Job[] = Array.from({ length: games }, (_, k) => ({ kind: "play", spec: { seed: seed0 + (k >> 1), map, swap: (k & 1) === 1, maxTicks: 36000, opp }, net }));
      const res = await runAll(jobs);
      const won = res.filter((r) => r.outcome.won === 1).length;
      const draws = res.filter((r) => r.outcome.won < 0).length;
      const reached = res.filter((r) => r.outcome.reached).length;
      rows.push(`| ${name} | ${map} | ${games} | ${won} | ${draws} | ${games - won - draws} | ${reached} |`);
    }
  }
  return ["| 對手 | 地圖 | 局 | 贏 | 平手 | 輸 | 打到對方主城的局 |", "|---|---|---|---|---|---|---|", ...rows];
}

if (mode === "dryrun") {
  // How fast this machine plays: hard against hard on the fixed map, every core busy.
  const n = threads() * 2;
  const jobs: Job[] = Array.from({ length: n }, (_, k) => ({ kind: "play", spec: { seed: 1 + (k >> 1), map: "fixed", swap: (k & 1) === 1, maxTicks: 36000, opp: { kind: "hard" } }, net: null }));
  const t0 = performance.now();
  const res = await runAll(jobs);
  const sec = (performance.now() - t0) / 1000;
  summary(`## 試跑\n\n- 核心：${cpus().length}（${cpus()[0]?.model ?? "?"}）\n- ${n} 局困難對困難（固定地圖，30 分上限）：${sec.toFixed(0)} 秒，每小時大約 ${Math.round((n * 3600) / sec)} 局`);
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
  summary(`## 記錄\n\n- ${games} 局，${samples.length} 個決策點（每 ${arg("every", "10")} 次思考取一次）`);
} else if (mode === "bc") {
  const data = loadSamples(`${arg("data", out)}/samples.bin`);
  // Hold out every 10th game's worth: the last 10% of the samples (games are in order).
  const cut = Math.floor(data.length * 0.9);
  const train = data.slice(0, cut);
  const test = data.slice(cut);
  const f = trainFloat(train, { epochs: Number(arg("epochs", "8")), lr: Number(arg("lr", "0.003")), batch: 64, seed: Number(arg("seed", "1")), cap: Number(arg("cap", "50")) }, (s) => console.log(s));
  const net = quantize(f, train);
  writeFileSync(`${out}/bc.json`, JSON.stringify(net));
  const a = agreement(net, test);
  const heads = ["軍隊", "練兵比例", "下一個蓋的", "城鎮"];
  const choices = [["守家", "拿城鎮", "打主城"], ["槍兵多", "平均", "遠程多"], ["村民先", "照困難", "兵營射場先"], ["搶", "治理"]];
  const pct = (x: number, n: number) => (n === 0 ? "-" : `${((x * 100) / n).toFixed(1)}%`);
  summary(`## 行為複製\n\n- 訓練 ${train.length} 個決策點，檢驗 ${test.length} 個（沒拿來訓練的局）。少見的選擇加重計分（classWeights）。`);
  summary("- 整數網路和困難選得一樣的比例（檢驗的決策點）：\n\n| 決定 | 全部 | 一直選最常見的那個 | 困難每個選擇各自的一致比例 |\n|---|---|---|---|");
  heads.forEach((h, i) => {
    const of = a.of[i].reduce((x, y) => x + y, 0);
    const same = a.same[i].reduce((x, y) => x + y, 0);
    summary(`| ${h} | ${pct(same, of)}（${of} 個） | ${pct(Math.max(...a.of[i]), of)} | ${choices[i].map((c, k) => `${c} ${pct(a.same[i][k], a.of[i][k])}（${a.of[i][k]}）`).join("、")} |`);
  });
} else if (mode === "es") {
  const resume = arg("resume", "");
  const start: NetWeights = JSON.parse(readFileSync(arg("start", `${out}/bc.json`), "utf8"));
  if (!sameShape(start)) throw new Error("the start network has another shape");
  let state: EsState = resume !== "" && existsSync(`${resume}/state.json`) ? JSON.parse(readFileSync(`${resume}/state.json`, "utf8")) : newState(start, Number(arg("seed", "1")), JSON.parse(arg("config", "{}")));
  const limitH = Number(arg("hours", "5.5"));
  const maxGen = state.generation + Number(arg("generations", "1000000"));
  summary(`## 演化策略（種子 ${state.seed}，從第 ${state.generation} 代起）\n\n| 代 | 對手 | 局 | 贏 | 平手 | 打到對方主城 | 加分權重 | 秒 |\n|---|---|---|---|---|---|---|---|`);
  const stageName = ["普通", "困難", "混合"];
  while (state.generation < maxGen) {
    const r = await generation(state, start);
    summary(`| ${r.generation} | ${stageName[r.stage]} | ${r.games} | ${r.won} | ${r.draws} | ${r.reached} | ${r.shaping.toFixed(3)} | ${r.seconds} |`);
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
  const rows = await evaluate(net, Number(arg("games", "100")), Number(arg("seed", "1")));
  summary(`## 比強弱（${file === "" ? "困難本身" : file}）\n\n${rows.join("\n")}`);
} else {
  throw new Error(`mode ${mode}: dryrun, record, bc, es or eval`);
}
