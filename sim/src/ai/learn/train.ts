// D-086 B training: what .github/workflows/ai-train.yml runs (docs/research/2026-10-ai-nn.md).
//   node src/ai/learn/train.ts dryrun --out DIR                      cores, and games an hour (hard against hard)
//   node src/ai/learn/train.ts record --games 400 --out DIR           hard's inputs and what it did (samples.bin, games.json), for looking into
//   node src/ai/learn/train.ts es --out DIR [--start FILE] [--resume DIR] [--seed N] [--hours H] [--generations N] [--config JSON]
//                                                                    from the network that always plays as hard (asHardNet) unless --start;
//                                                                    --config over ES_DEFAULTS, or over the resumed run's settings
//   node src/ai/learn/train.ts pairs --resume DIR --island I --out DIR [--config JSON] [--slot S --slots N --start-at EPOCH]
//                                                                    NN v4s: one generation's pairs of island I from DIR's state: the main
//                                                                    chain's (no --slot), or fill-in slot S of N's, one pair after another
//                                                                    until the main chain's time is up or DIR/stop appears (pairs.json)
//   node src/ai/learn/train.ts step --resume DIR --pairs DIR --island I --out DIR [--config JSON] [--wait S]
//                                                                    NN v4s: the step from every pairs.json of island I under --pairs
//   node src/ai/learn/train.ts eval [--net FILE] --games N --crush M --seed S --out DIR [--rules keep,siege,rich,market] [--name X]
//                                                                    against hard (N on each map, both spawns) and push-crush (M on each
//                                                                    map), seeds from S; no --net: hard itself (the control); eval.json too
//   node src/ai/learn/train.ts report --dir DIR [--control FILE] --out DIR
//                                                                    every eval.json under DIR against the control's (NN v2, ceo 2026-10-29)
// Every mode writes summary.md (Markdown) and its files under --out; checkpoints and records are CI artifacts, never commits.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { gunzipSync, gzipSync } from "node:zlib";
import { asHardNet, HEAD_ARMY, HEAD_CHARGE, HEAD_DEFENSE, HEAD_SQUAD, HEAD_TOWN, NET_HEADS, NET_INPUTS, type NetWeights } from "../net.ts";
import { addStats, ES_DEFAULTS, type EsConfig, type EsState, fromVector, generation, type GenerationReport, newState, type PairResult, playPairs, sameShape, squadText, update, widen, widenNet } from "./es.ts";
import type { HardPlan } from "../ai.ts";
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
  /** NN v2 (ceo 2026-10-30): the sets of choices it made over all its games (1: one set for everything, it does not choose by the game). */
  combos: number;
  /** NN v4 (D-122): the AI counters and kills over all its games (GameOutcome's aiStats, killed). */
  aiStats?: Record<string, number>;
  killed?: { farmers: number; backByCavalry: number };
  /** NN v4: the trained side's soldiers lost, per game, against hard and against push-crush. */
  lostHard?: number;
  lostCrush?: number;
  /** NN v4 (ceo 2026-11-05): each game's raids: set (hard, crush), map, seed, swap, result, raids, seconds by their spots, farmers killed, raids caught, squads' dead, soldiers lost. */
  games?: { set: string; map: string; seed: number; swap: boolean; won: number; raids: number; held: number; kills: number; caught: number; died: number; lost: number; gathered?: number; farmersLost?: number; idle?: number }[];
}
const tally = (res: GameOutcome[]): Tally => {
  const won = res.filter((o) => o.won === 1).length;
  const draws = res.filter((o) => o.won < 0).length;
  return { games: res.length, won, draws, lost: res.length - won - draws };
};
/** The games of one set, `n` on each map; against hard both spawns in turn. */
function setJobs(net: NetWeights | null, opp: Opponent, n: number, seed0: number, maxTicks: number, switches: Switches, plan?: Partial<HardPlan>): Job[] {
  const jobs: Job[] = [];
  for (const map of ["fixed", "random"] as const) {
    for (let k = 0; k < n; k++) jobs.push({ kind: "play", spec: { seed: seed0 + (opp.kind === "hard" ? k >> 1 : k), map, swap: (k & 1) === 1, maxTicks, opp, rules: switches }, net, plan });
  }
  return jobs;
}
/**
 * NN v4 (the user 2026-11-05: 「可以試試看用騎兵或是小部隊偷襲」): eval --variant NAME: a forced choice with a plan over
 * hard's, against the control's seeds. raidcav: always raid (where the mask allows it), with the cavalry alone;
 * raid6: always raid, with 6 (cavalry first), out once the army has 12.
 */
/** A network with choice `force` ("<head>.<choice>") wherever the mask allows it, else as hard. */
function forcedNet(force: string): NetWeights {
  const [h, k] = force.split(".").map(Number);
  const plain = asHardNet();
  const at = NET_HEADS.slice(0, h).reduce((a, x) => a + x, 0) + k;
  return { layers: plain.layers.map((L, l) => (l === plain.layers.length - 1 ? { ...L, b: L.b.map((v, i) => (i === at ? 10 : v)) } : L)) };
}
/** The raidcamp raider (NN v4: always raid, 10 at a time from minute 10, far spots, waiting there), as an opponent's plan. */
const CAMP = { squadSize: 10, raidFrom: 10 * 1200, raidFar: 20, raidQuiet: 3 * 1200, raidTime: 6 * 1200 };
/**
 * NN v4 (the user 2026-11-05) and D-130 (ceo 2026-11-05). force: the trained side with that choice forced; plan: over
 * hard's for the trained side; opp: the hard opponent's plan (with a forced choice, oppForce). c*: hard itself with
 * D-130's switches against the raidcamp raider, the AI that killed 67 of hard's farmers in one game (run 42043303091).
 */
const VARIANTS: Record<string, { force?: string; plan: Partial<HardPlan>; opp?: Partial<HardPlan>; oppForce?: string }> = {
  cbase: { plan: {}, opp: CAMP, oppForce: "5.1" },
  cavoid: { plan: { farAvoid: true }, opp: CAMP, oppForce: "5.1" },
  crescue: { plan: { rescue: true }, opp: CAMP, oppForce: "5.1" },
  cboth: { plan: { farAvoid: true, rescue: true }, opp: CAMP, oppForce: "5.1" },
  cnohide: { plan: { hideFar: false }, opp: CAMP, oppForce: "5.1" },
  raidcav: { force: "5.1", plan: { raidCavalry: true } },
  raid6: { force: "5.1", plan: { squadSize: 6 } },
  // ceo 2026-11-05, the user's 75830947: from minute 10, 10 at a time (cavalry first), farmers 20 cells or more from the enemy's main city.
  raiduser: { force: "5.1", plan: { squadSize: 10, raidFrom: 10 * 1200, raidFar: 20 } },
  // The user's 75830947 replayed (23d43ee): the squad waited by far spots for the farmers hard sent there. raiduser,
  // waiting 3 minutes with no farmer by it (30 s before), at most 6 at the spot (90 s).
  raidcamp: { force: "5.1", plan: { squadSize: 10, raidFrom: 10 * 1200, raidFar: 20, raidQuiet: 3 * 1200, raidTime: 6 * 1200 } },
};
async function evaluate(name: string, net: NetWeights | null, n: number, m: number, seed0: number, switches: Switches, plan?: Partial<HardPlan>, oppPlan?: Partial<HardPlan>): Promise<EvalResult> {
  // NN v3: 120 minutes, as the training (D-115).
  const hardJobs = setJobs(net, { kind: "hard", plan: oppPlan }, n, seed0, 144000, switches, plan);
  const hard = (await runAll(hardJobs)).map((r) => r.outcome);
  // push-crush as CI plays it: 90 minutes.
  const crushJobs = setJobs(net, { kind: "crush" }, m, seed0, 144000, switches, plan);
  const crush = (await runAll(crushJobs)).map((r) => r.outcome);
  const at45 = crush.filter((o) => o.towers45 >= 0);
  const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);
  const choices = NET_HEADS.map((k) => new Array(k).fill(0));
  for (const o of [...hard, ...crush]) o.choices.forEach((h, i) => h.forEach((v, k) => (choices[i][k] += v)));
  const combos = new Set([...hard, ...crush].flatMap((o) => o.combos));
  const aiStats: Record<string, number> = {};
  const killed = { farmers: 0, backByCavalry: 0 };
  for (const o of [...hard, ...crush]) addStats(aiStats, killed, o);
  const each = (set: string, jobs: Job[], os: GameOutcome[]) =>
    os.map((o, k) => {
      const sp = (jobs[k] as Extract<Job, { kind: "play" }>).spec;
      const st = o.aiStats ?? {};
      return { set, map: sp.map, seed: sp.seed, swap: sp.swap, won: o.won, raids: st.squadRaid ?? 0, held: Math.round((st.raidHeld ?? 0) / 20), kills: st.raidFarmers ?? 0, caught: st.raidCaught ?? 0, died: st.squadDied ?? 0, lost: o.soldiersLost ?? 0, gathered: o.gathered ?? 0, farmersLost: o.farmersLost ?? 0, idle: Math.round((st.farmerIdle ?? 0) / 120) / 10 };
    });
  const perGame = (os: GameOutcome[]) => (os.length === 0 ? 0 : os.reduce((a, o) => a + (o.soldiersLost ?? 0), 0) / os.length);
  return {
    aiStats,
    killed,
    lostHard: perGame(hard),
    lostCrush: perGame(crush),
    games: [...each("hard", hardJobs, hard), ...each("crush", crushJobs, crush)],
    name,
    seed: seed0,
    hard: tally(hard),
    crush: { ...tally(crush), at45: at45.length, towers45: mean(at45.map((o) => o.towers45)), governed45: mean(at45.map((o) => o.governed45)) },
    defense: choices[HEAD_DEFENSE],
    choices,
    combos: combos.size,
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

/** A generation's row of the es table (es, step). */
const ES_HEAD =
  `| 代 | 局 | 贏 | 平手 | 輸 | 贏：困難／普通／push／crush／turtle | 打到對方主城 | 軍隊：守家／出兵 | 城鎮：搶／治理 | 防守：蓋塔／不蓋 | 分隊：偷襲／守家／守城／打小城 | 騎兵衝：現在／先跟著 | 隨局面改選擇的候選 | 對數（主鏈＋補位） | 主鏈等 runner（秒） | 加分權重 | 秒 | 分隊做了什麼 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|`;
function esRow(r: GenerationReport, pairs: number): string {
  const by = ["hard", "normal", "push", "crush", "turtle"].map((k) => `${r.byOpp[k]?.won ?? 0}/${r.byOpp[k]?.games ?? 0}`).join("　");
  const p = r.pairs ?? pairs;
  return `| ${r.generation} | ${r.games} | ${r.won} | ${r.draws} | ${r.games - r.won - r.draws} | ${by} | ${r.reached} | ${dev(r.choices[HEAD_ARMY])} | ${dev(r.choices[HEAD_TOWN])} | ${dev(r.choices[HEAD_DEFENSE])} | ${dev(r.choices[HEAD_SQUAD] ?? [0])} | ${dev(r.choices[HEAD_CHARGE] ?? [0])} | ${r.varied}／${2 * p} | ${p - (r.fillPairs ?? 0)}＋${r.fillPairs ?? 0} | ${r.wait === undefined || r.wait < 0 ? "-" : r.wait} | ${r.shaping.toFixed(3)} | ${r.seconds} | ${squadText(r.aiStats ?? {}, r.killed ?? { farmers: 0, backByCavalry: 0 })} |`;
}

/** NN v4s: a checkpoint (DIR/state.json) with this run's settings over its own, the island's learning rate, and v3's shape widened. */
function loadState(dir: string, island: number, config: Partial<EsConfig>): EsState {
  const state: EsState = JSON.parse(readFileSync(`${dir}/state.json`, "utf8"));
  state.config = { ...ES_DEFAULTS, ...state.config, ...config };
  if (island >= 0 && state.config.lrByIsland[island] !== undefined) state.config.lr = state.config.lrByIsland[island];
  const wide = widen(state.theta, state.config);
  if (wide.added > 0) {
    state.theta = wide.theta;
    if (state.best !== undefined) state.best = widen(state.best, state.config).theta;
  }
  return state;
}

/** NN v4s: the weights' fingerprint (FNV-1a over their JSON): a fill-in's pairs count only for the same weights. */
function thetaHash(theta: readonly number[]): string {
  let h = 0x811c9dc5;
  const t = JSON.stringify(theta);
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193) >>> 0;
  return h.toString(16);
}

/** NN v4s: what a fill-in run needs of the state (the weights exact: JSON keeps a double as it is), gzip, base64. */
export function packState(state: EsState): string {
  const last = state.history[state.history.length - 1];
  return gzipSync(JSON.stringify({ theta: state.theta, generation: state.generation, seed: state.seed, config: state.config, history: last === undefined ? [] : [last] })).toString("base64");
}
function unpackState(b64: string): EsState {
  return JSON.parse(gunzipSync(Buffer.from(b64, "base64")).toString("utf8"));
}

const gh = (args: string[]) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * NN v4s (ceo 2026-11-04): one generation of the main chain's job with fill-in jobs. Before its own pairs it starts a
 * fill-in run (mode fill) with this generation's state in its input, its pairs due by when the main chain's are; after
 * them it waits for that run (at most FILL_GRACE), cancels it if it is still going, and takes the complete pairs of
 * the same weights. On any trouble with the fill-in run: its own pairs alone, as es always did.
 */
const FILL_GRACE = 180;
async function generationWithFills(state: EsState, like: NetWeights, island: number): Promise<GenerationReport> {
  const repo = process.env.GITHUB_REPOSITORY ?? "";
  const ref = process.env.GITHUB_REF_NAME ?? "";
  const tag = `${process.env.GITHUB_RUN_ID}-${island}-${state.generation}`;
  const last = state.history[state.history.length - 1];
  const est = last?.baseSeconds ?? last?.seconds ?? 4500;
  const hash = thetaHash(state.theta);
  let dispatched = false;
  try {
    gh(["workflow", "run", "ai-train.yml", "--repo", repo, "--ref", ref, "-f", "mode=fill", "-f", `only=${island}`, "-f", `tag=${tag}`, "-f", `deadline=${Math.round(Date.now() / 1000 + est)}`, "-f", `fill=${process.env.FILL_MAX ?? "auto"}`, "-f", `state=${packState(state)}`]);
    dispatched = true;
  } catch (e) {
    console.error(`fill-in run for ${tag} not started: ${String(e).slice(0, 200)}`);
  }
  const t0 = performance.now();
  const played = await playPairs(state, like, Array.from({ length: state.config.pairs }, (_, p) => p));
  const seconds = Math.round((performance.now() - t0) / 1000);
  let fill: PairResult[] = [];
  if (dispatched) {
    try {
      const find = () => (JSON.parse(gh(["run", "list", "--repo", repo, "--workflow", "ai-train.yml", "--event", "workflow_dispatch", "--limit", "60", "--json", "databaseId,displayTitle,status"])) as { databaseId: number; displayTitle: string; status: string }[]).find((r) => r.displayTitle === `AI train fill ${tag}`);
      const until = Date.now() + FILL_GRACE * 1000;
      let run = find();
      while (run !== undefined && run.status !== "completed" && Date.now() < until) {
        await sleep(30_000);
        run = find();
      }
      if (run !== undefined && run.status !== "completed") {
        gh(["run", "cancel", String(run.databaseId), "--repo", repo]);
        // Its jobs upload what they have as they stop (if: always()).
        for (let k = 0; k < 6 && run !== undefined && run.status !== "completed"; k++) {
          await sleep(20_000);
          run = find();
        }
      }
      if (run !== undefined) {
        const dir = `${out}/fill-${state.generation}`;
        try {
          gh(["run", "download", String(run.databaseId), "--repo", repo, "--pattern", "pairs-*", "--dir", dir]);
        } catch {
          // None came back.
        }
        const files: string[] = [];
        if (existsSync(dir)) for (const d of readdirSync(dir)) if (existsSync(`${dir}/${d}/pairs.json`)) files.push(`${dir}/${d}/pairs.json`);
        for (const f of files) {
          const j = JSON.parse(readFileSync(f, "utf8"));
          if (j.island === island && j.generation === state.generation && j.seed === state.seed && j.hash === hash) fill.push(...(j.results as PairResult[]));
        }
        const seen = new Set<number>();
        fill = fill.filter((r) => r.pair >= state.config.pairs && !seen.has(r.pair) && (seen.add(r.pair), true));
      }
    } catch (e) {
      console.error(`fill-in pairs for ${tag}: ${String(e).slice(0, 200)}`);
      fill = [];
    }
  }
  return update(state, like, [...played, ...fill], { seconds: Math.round((performance.now() - t0) / 1000), baseSeconds: seconds, fillPairs: fill.length });
}

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
  const config = JSON.parse(arg("config", "{}"));
  const start0: NetWeights = startFile === "" ? asHardNet() : JSON.parse(readFileSync(startFile, "utf8"));
  // NN v4 (D-122): a v3 network (5 heads) at the full shape, the new heads as hard (widen).
  const start = sameShape(start0) ? start0 : widenNet(start0, { ...ES_DEFAULTS, ...config });
  if (!sameShape(start)) throw new Error("the start network has another shape");
  let state: EsState = resume !== "" && existsSync(`${resume}/state.json`) ? JSON.parse(readFileSync(`${resume}/state.json`, "utf8")) : newState(start, Number(arg("seed", "1")), config);
  // Going on with other settings (the rules once they ship, ceo 2026-10-25): from the weights it has.
  state.config = { ...ES_DEFAULTS, ...state.config, ...config };
  // NN v3 B: this island's learning rate (lrByIsland, ceo 2026-11-03: one island at 2 x).
  const island = Number(arg("island", "-1"));
  if (island >= 0 && state.config.lrByIsland[island] !== undefined) state.config.lr = state.config.lrByIsland[island];
  // NN v4 (D-122): going on from v3's weights, the new heads' rows added (weights 0, as hard by the learned margin).
  const wide = widen(state.theta, state.config);
  if (wide.added > 0) {
    state.theta = wide.theta;
    if (state.best !== undefined) state.best = widen(state.best, state.config).theta;
    summary(`NN v4：從第 ${state.generation} 代的權重接著練，補上 ${wide.added} 組（分隊、騎兵衝），權重 0，照困難的偏差 ${wide.margin}（舊組學到的平均）。\n`);
  }
  const limitH = Number(arg("hours", "5.5"));
  const maxGen = state.generation + Number(arg("generations", "1000000"));
  const m = state.config.mix;
  summary(
    `## 演化策略（種子 ${state.seed}，從第 ${state.generation} 代起，規則開關 ${switchesText(state.config.rules)}）\n\n` +
      `每代 ${state.config.pairs} 對候選，每個候選 ${m.hard + m.normal + m.push + m.crush + m.turtle} 局：困難 ${m.hard}、普通 ${m.normal}、push ${m.push}、push-crush ${m.crush}、push-turtle ${m.turtle}；` +
      `上限 ${state.config.maxTicks / 1200} 分，沒分出勝負算輸。固定照困難的組：${state.config.fixed.join("、")}（練兵、蓋什麼）。\n\n` +
      `「不照困難」：每組決定，不照困難的選擇在所有思考裡的次數和比例（ceo 2026-10-19）。\n\n` +
      ES_HEAD,
  );
  while (state.generation < maxGen) {
    // NN v4s: on CI with FILL_RUNS, each generation with a fill-in run.
    const r = process.env.FILL_RUNS === "1" && process.env.GITHUB_RUN_ID !== undefined ? await generationWithFills(state, start, island) : await generation(state, start);
    summary(esRow(r, state.config.pairs));
    writeFileSync(`${out}/state.json`, JSON.stringify(state));
    writeFileSync(`${out}/net.json`, JSON.stringify(fromVector(state.theta, start)));
    // NN v3 B: the generation's best candidate, evaluated on new seeds (best.json).
    if (state.best !== undefined) writeFileSync(`${out}/best.json`, JSON.stringify(fromVector(state.best, start)));
    // Stop before the job's limit with time for one more generation and the upload.
    if (hours() + (r.seconds / 3600) * 1.5 > limitH) break;
  }
  state = JSON.parse(readFileSync(`${out}/state.json`, "utf8"));
  summary(`\n到第 ${state.generation} 代，${hours().toFixed(2)} 小時。`);
} else if (mode === "pairs") {
  // NN v4s (ceo 2026-11-04): a generation over several jobs. The main chain's job plays pairs 0..pairs-1 at once; a
  // fill-in job plays its own pairs (pairs + slot, + slots, ...) one after another while the main chain's time lasts
  // (pairs x one pair's time, from the plan's start plus 5 minutes) and stops at once when DIR/stop
  // appears (the workflow's watch: another workflow's jobs waiting): pairs.json holds the complete pairs only.
  const island = Number(arg("island", "0"));
  // NN v4s: a fill-in run's state comes in its input (--packed FILE: packState's text).
  const packed = arg("packed", "");
  if (packed !== "") {
    mkdirSync(arg("resume", ""), { recursive: true });
    writeFileSync(`${arg("resume", "")}/state.json`, JSON.stringify(unpackState(readFileSync(packed, "utf8").trim())));
  }
  const state = loadState(arg("resume", ""), island, JSON.parse(arg("config", "{}")));
  const like = asHardNet();
  const c = state.config;
  const slot = Number(arg("slot", "-1"));
  const hash = thetaHash(state.theta);
  const done: PairResult[] = [];
  const t0 = performance.now();
  const save = () => writeFileSync(`${out}/pairs.json`, JSON.stringify({ island, generation: state.generation, seed: state.seed, hash, kind: slot < 0 ? "base" : "fill", seconds: Math.round((performance.now() - t0) / 1000), results: done }));
  if (slot < 0) {
    done.push(...(await playPairs(state, like, Array.from({ length: c.pairs }, (_, p) => p))));
    save();
    summary(`## 島 ${island} 第 ${state.generation} 代：主鏈 ${c.pairs} 對，${Math.round((performance.now() - t0) / 1000)} 秒`);
  } else {
    const slots = Number(arg("slots", "1"));
    // The main chain plays its pairs at once in about pairs x one pair's time here: the last generation's until this
    // job has timed one of its own.
    const last = state.history[state.history.length - 1];
    const startAt = Number(arg("start-at", String(Math.round(Date.now() / 1000))));
    // A fill-in run: the main chain's job says when (--deadline, epoch seconds).
    const due = Number(arg("deadline", "0"));
    const deadline = (pair: number) => (due > 0 ? due : startAt + 300 + c.pairs * pair);
    const stopFile = `${out}/stop`;
    const timer = setInterval(() => {
      if (!existsSync(stopFile)) return;
      save();
      summary(`## 島 ${island} 第 ${state.generation} 代：補位 ${slot}／${slots}，交 ${done.length} 對，讓位（${readFileSync(stopFile, "utf8").trim()}），做一半的那對丟掉`);
      process.exit(0);
    }, 5000);
    let pairTime = (last?.baseSeconds ?? last?.seconds ?? 4500) / c.pairs;
    for (let m = 0; ; m++) {
      if (Date.now() / 1000 + pairTime > deadline(pairTime)) break;
      const t = performance.now();
      done.push(...(await playPairs(state, like, [c.pairs + slot + slots * m])));
      pairTime = (performance.now() - t) / 1000;
      save();
    }
    clearInterval(timer);
    save();
    summary(`## 島 ${island} 第 ${state.generation} 代：補位 ${slot}／${slots}，交 ${done.length} 對（主鏈的時間到了），${Math.round((performance.now() - t0) / 1000)} 秒`);
  }
} else if (mode === "step") {
  // NN v4s: the step of island I from every pairs.json under --pairs (the main chain's pairs must all be there).
  const island = Number(arg("island", "0"));
  const state = loadState(arg("resume", ""), island, JSON.parse(arg("config", "{}")));
  const like = asHardNet();
  const c = state.config;
  const files: string[] = [];
  const walk = (d: string) => {
    if (!existsSync(d)) return;
    for (const f of readdirSync(d).sort()) {
      const p = `${d}/${f}`;
      if (statSync(p).isDirectory()) walk(p);
      else if (f === "pairs.json") files.push(p);
    }
  };
  walk(arg("pairs", "pairs"));
  const got = new Map<number, PairResult>();
  let baseSeconds = 0;
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, "utf8"));
    if (j.island !== island || j.generation !== state.generation || j.seed !== state.seed) continue;
    for (const r of j.results as PairResult[]) got.set(r.pair, r);
    if (j.kind === "base") baseSeconds = j.seconds;
  }
  const missing = Array.from({ length: c.pairs }, (_, p) => p).filter((p) => !got.has(p));
  if (missing.length > 0) throw new Error(`step: island ${island} generation ${state.generation}: the main chain's pairs ${missing.join(",")} are missing`);
  const fillPairs = [...got.keys()].filter((p) => p >= c.pairs).length;
  const r = update(state, like, [...got.values()], { seconds: baseSeconds, baseSeconds, fillPairs, wait: Number(arg("wait", "-1")) });
  writeFileSync(`${out}/state.json`, JSON.stringify(state));
  writeFileSync(`${out}/net.json`, JSON.stringify(fromVector(state.theta, like)));
  if (state.best !== undefined) writeFileSync(`${out}/best.json`, JSON.stringify(fromVector(state.best, like)));
  summary(`## 島 ${island}（種子 ${state.seed}，規則開關 ${switchesText(c.rules)}）\n\n${ES_HEAD}\n${esRow(r, c.pairs)}`);
} else if (mode === "eval") {
  const file = arg("net", "");
  const net0: NetWeights | null = file === "" ? null : JSON.parse(readFileSync(file, "utf8"));
  // NN v4 (D-122): a v3 network plays as it did, as hard on the new heads.
  let net = net0 === null || sameShape(net0) ? net0 : widenNet(net0, ES_DEFAULTS);
  // NN v4f (2026-11-05): --force <head>.<choice>: hard with that choice on that head wherever the mask allows it: what the choice itself is worth.
  const variant = arg("variant", "");
  if (variant !== "" && VARIANTS[variant] === undefined) throw new Error(`--variant ${variant}: ${Object.keys(VARIANTS).join(", ")}`);
  const force = variant !== "" ? (VARIANTS[variant].force ?? "") : arg("force", "");
  const plan = variant !== "" ? VARIANTS[variant].plan : undefined;
  const v = variant !== "" ? VARIANTS[variant] : undefined;
  const oppPlan = v?.opp === undefined ? undefined : { ...v.opp, ...(v.oppForce === undefined ? {} : { net: forcedNet(v.oppForce) }) };
  if (force !== "") net = forcedNet(force);
  const names = arg("rules", "").split(",").filter((x) => x !== "");
  const bad = names.filter((x) => x !== "keep" && x !== "siege" && x !== "rich" && x !== "market");
  if (bad.length > 0) throw new Error(`--rules ${bad.join(",")}: keep, siege, rich or market`);
  const switches: Switches = Object.fromEntries(names.map((x) => [x, true]));
  const name = arg("name", v?.opp !== undefined ? `對守著等：${variant}` : variant !== "" ? `強制 ${force}（${variant}）` : force !== "" ? `強制 ${force}` : file === "" ? "control" : file);
  const r = await evaluate(name, net, Number(arg("games", "100")), Number(arg("crush", "20")), Number(arg("seed", "2000001")), switches, plan, oppPlan);
  writeFileSync(`${out}/eval.json`, JSON.stringify(r));
  const h = wl(r.hard);
  summary(
    `## 比強弱（${force !== "" ? `強制 ${force}` : file === "" ? "困難本身" : `${name}：${file}`}，規則開關 ${switchesText(switches)}，種子從 ${r.seed} 起）\n\n` +
      `| 對手 | 局 | 贏 | 平手 | 輸 | 贏－輸（標準差） | 第 45 分還在打的局 | 第 45 分箭樓（每局） | 第 45 分治理的城（每局） |\n|---|---|---|---|---|---|---|---|---|\n` +
      `| 困難（120 分） | ${r.hard.games} | ${r.hard.won} | ${r.hard.draws} | ${r.hard.lost} | ${h.d}（${h.sd.toFixed(1)}） | | | |\n` +
      `| push-crush（120 分） | ${r.crush.games} | ${r.crush.won} | ${r.crush.draws} | ${r.crush.lost} | ${wl(r.crush).d} | ${r.crush.at45} | ${r.crush.towers45.toFixed(1)} | ${r.crush.governed45.toFixed(1)} |\n\n` +
      `- 防守組：蓋塔／不蓋 ${dev(r.defense)}\n- 分隊組：偷襲／守家／守城／打小城 ${dev(r.choices[HEAD_SQUAD] ?? [0])}；騎兵衝組：現在／先跟著 ${dev(r.choices[HEAD_CHARGE] ?? [0])}\n- ${squadText(r.aiStats ?? {}, r.killed ?? { farmers: 0, backByCavalry: 0 })}\n- 選擇組合：${r.combos} 種${net !== null && r.combos <= 1 ? "（只有一種：網路沒有看局面）" : ""}`,
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
    return `| ${r.name} | ${r.hard.won}-${r.hard.draws}-${r.hard.lost} | ${x.d} | ${x.d - c.d}${same} | ${c.sd > 0 ? ((x.d - c.d) / c.sd).toFixed(2) : "-"} | ${r.crush.won}-${r.crush.draws}-${r.crush.lost} | ${r.crush.towers45.toFixed(1)} | ${r.crush.governed45.toFixed(1)} | ${dev(r.defense)} | ${r.combos ?? "-"} | ${dev(r.choices?.[HEAD_SQUAD] ?? [0])} | ${dev(r.choices?.[HEAD_CHARGE] ?? [0])} | ${squadText(r.aiStats ?? {}, r.killed ?? { farmers: 0, backByCavalry: 0 })} |`;
  });
  summary(
    `## 各島對照困難本身（種子從 ${control.seed} 起，對困難 ${control.hard.games} 局、push-crush ${control.crush.games} 局）\n\n` +
      `對照：對困難 ${control.hard.won}-${control.hard.draws}-${control.hard.lost}（贏－輸 ${c.d}，標準差 ${c.sd.toFixed(1)}）；push-crush ${control.crush.won}-${control.crush.draws}-${control.crush.lost}，第 45 分箭樓 ${control.crush.towers45.toFixed(1)}、治理的城 ${control.crush.governed45.toFixed(1)}（每局，${control.crush.at45} 局打到第 45 分）；${squadText(control.aiStats ?? {}, control.killed ?? { farmers: 0, backByCavalry: 0 })}。\n\n` +
      `| 島 | 對困難 贏-平-輸 | 贏－輸 | 比對照多 | ÷ 標準差 | push-crush 贏-平-輸 | 第 45 分箭樓 | 第 45 分治理的城 | 防守：蓋塔／不蓋（不照困難） | 選擇組合（1：沒看局面） | 分隊：偷襲／守家／守城／打小城 | 騎兵衝：現在／先跟著 | 分隊做了什麼 |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|\n` +
      rows.join("\n"),
  );
} else {
  throw new Error(`mode ${mode}: dryrun, record, es, pairs, step, eval or report`);
}
