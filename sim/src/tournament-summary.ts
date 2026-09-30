// Summarises tournament shards (src/tournament.ts): win rate of each spawn (draws left out
// of the denominator), draws, game lengths, plunder and govern counts, mages, tick times.
//   node src/tournament-summary.ts DIR [DIR ...] [--json FILE]
// Prints Markdown (for the CI step summary). Gates (D5): each spawn's win rate within
// 35–65%, draws at most 10% (for now 25%, see GATES), every replay matching; when the two
// AIs play different difficulties (normal against easy, round 2), the stronger one wins at
// least 80% of the decided games. Exits 1 when a gate fails.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { GameResult } from "./tournament.ts";

/**
 * drawsMax is relaxed to 25% for now (ceo 2026-09-30): win rate by spawn, replays and
 * browser determinism pass. Most draws of rounds 7 and 8 were armies parked at ruins (an AI
 * bug, fixed); what is left (21% in round 9) is mostly a late attack that reaches the enemy
 * main city but cannot finish it. ceo decides the next step toward 10% (D5).
 */
export const GATES = { winRateMin: 0.35, winRateMax: 0.65, drawsMax: 0.25, strongerWinMin: 0.8 };
const LEVEL = { easy: 0, normal: 1 } as Record<string, number>;

const args = process.argv.slice(2);
const jsonAt = args.indexOf("--json");
const jsonFile = jsonAt >= 0 ? args[jsonAt + 1] : "";
const dirs = args.filter((a, k) => !a.startsWith("--") && (jsonAt < 0 || k !== jsonAt + 1));
const games: GameResult[] = [];
for (const d of dirs) {
  for (const f of readdirSync(d)) if (/^game-\d+\.json$/.test(f)) games.push(JSON.parse(readFileSync(join(d, f), "utf8")) as GameResult);
}
games.sort((a, b) => a.game - b.game);

const wins = [0, 0];
let draws = 0;
for (const g of games) {
  if (g.winner === 0 || g.winner === 1) wins[g.winner]++;
  else draws++;
}
const decided = wins[0] + wins[1];
const rate = decided === 0 ? 0.5 : wins[0] / decided;
const drawShare = games.length === 0 ? 0 : draws / games.length;
const replayFail = games.filter((g) => !g.replayMatches).length;
const minutes = games.map((g) => g.ticks / 1200).sort((a, b) => a - b);
const q = (arr: number[], p: number) => (arr.length === 0 ? 0 : arr[Math.max(0, Math.min(arr.length - 1, Math.ceil(p * arr.length) - 1))]);
const sum = (f: (g: GameResult) => number) => games.reduce((a, g) => a + f(g), 0);
const plunder = sum((g) => g.perPlayer[0].plundered + g.perPlayer[1].plundered);
const govern = sum((g) => g.perPlayer[0].governed + g.perPlayer[1].governed);
const mages = [0, 1].map((p) => ({
  trained: sum((g) => g.perPlayer[p].magesTrained),
  lost: sum((g) => g.perPlayer[p].magesLost),
  shots: sum((g) => g.perPlayer[p].cannonShots),
  hits: sum((g) => g.perPlayer[p].cannonHits),
}));
// Towns: what a plunder brings, what governing costs and pays, when towns first fall.
const both = (f: (p: GameResult["perPlayer"][number]) => number) => sum((g) => f(g.perPlayer[0]) + f(g.perPlayer[1]));
const plunderGain = plunder === 0 ? 0 : both((p) => p.plunderIncome) / plunder;
const governChosen = both((p) => p.governChosen);
const governCostAvg = governChosen === 0 ? 0 : both((p) => p.governCost) / governChosen;
const governedMinutes = both((p) => p.governedTicks) / 1200;
const incomePerMinute = governedMinutes === 0 ? 0 : both((p) => p.townIncome) / governedMinutes;
const spellsEnded = both((p) => p.governEnded);
const spellsPaid = both((p) => p.governPaidBack);
const spellsOpen = both((p) => p.governOpen);
const spellsOpenPaid = both((p) => p.governOpenPaidBack);
const firstCaptures = games.map((g) => g.firstCapture).filter((t) => t >= 0).map((t) => t / 1200).sort((a, b) => a - b);
const towns = {
  plunderGain,
  governChosen,
  governCostAvg,
  governedMinutes,
  incomePerMinute,
  /** Minutes of governed production to earn back the cost (repair time not included). */
  paybackMinutes: incomePerMinute === 0 ? 0 : governCostAvg / incomePerMinute,
  spellsEnded,
  spellsPaid,
  spellsOpen,
  spellsOpenPaid,
  firstCaptureMinute: { median: q(firstCaptures, 0.5), mean: firstCaptures.length ? firstCaptures.reduce((a, b) => a + b, 0) / firstCaptures.length : 0, games: firstCaptures.length },
};
/** 95% Wilson interval for k successes out of n. */
function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - r) / d, (c + r) / d];
}

// Per AI style (GDD section 13): every spawn a style played counts as one appearance.
const styles: Record<string, { played: number; wins: number; decided: number; plunder: number; govern: number }> = {};
for (const g of games) {
  for (let p = 0; p < 2; p++) {
    const st = (styles[g.styles[p]] ??= { played: 0, wins: 0, decided: 0, plunder: 0, govern: 0 });
    st.played++;
    if (g.winner === 0 || g.winner === 1) st.decided++;
    if (g.winner === p) st.wins++;
    st.plunder += g.perPlayer[p].plundered;
    st.govern += g.perPlayer[p].governed;
  }
}
// Different difficulties (round 2): how often the stronger AI wins, draws left out.
const mixed = games.filter((g) => (g.difficulty ?? ["normal", "normal"])[0] !== (g.difficulty ?? ["normal", "normal"])[1]);
const stronger = { games: mixed.length, decided: 0, wins: 0, name: "" };
for (const g of mixed) {
  const s = LEVEL[g.difficulty[0]] > LEVEL[g.difficulty[1]] ? 0 : 1;
  stronger.name = g.difficulty[s];
  if (g.winner === 0 || g.winner === 1) stronger.decided++;
  if (g.winner === s) stronger.wins++;
}
const strongerRate = stronger.decided === 0 ? 0 : stronger.wins / stronger.decided;
const medians = games.map((g) => g.tickMicros.median).sort((a, b) => a - b);
const p95s = games.map((g) => g.tickMicros.p95).sort((a, b) => a - b);
const maxes = games.map((g) => g.tickMicros.max).sort((a, b) => a - b);
const wallMs = sum((g) => g.wallMs);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const perShot = (m: { shots: number; hits: number }) => (m.shots === 0 ? "—" : (m.hits / m.shots).toFixed(2));
const STYLE_NAMES: Record<string, string> = { plunder: "掠奪型", govern: "治理型", balanced: "均衡型" };

const failures: string[] = [];
if (games.length === 0) failures.push("沒有任何對局");
if (rate < GATES.winRateMin || rate > GATES.winRateMax) failures.push(`玩家 0 出生點勝率 ${pct(rate)} 不在 ${pct(GATES.winRateMin)}–${pct(GATES.winRateMax)} 之間`);
if (drawShare > GATES.drawsMax) failures.push(`平手 ${pct(drawShare)} 超過 ${pct(GATES.drawsMax)}`);
if (replayFail > 0) failures.push(`${replayFail} 場重播的雜湊不同`);
if (mixed.length > 0 && strongerRate < GATES.strongerWinMin) failures.push(`${stronger.name} 的勝率 ${pct(strongerRate)} 低於 ${pct(GATES.strongerWinMin)}`);

const summary = {
  games: games.length,
  wins,
  draws,
  winRate: [rate, 1 - rate],
  drawShare,
  replayFail,
  minutes: { min: q(minutes, 0), median: q(minutes, 0.5), p90: q(minutes, 0.9), max: q(minutes, 1) },
  plunder,
  govern,
  plunderShare: plunder + govern === 0 ? 0 : plunder / (plunder + govern),
  mages,
  styles,
  stronger: { ...stronger, winRate: strongerRate },
  towns,
  tickMicros: { medianOfMedians: q(medians, 0.5), p95OfP95: q(p95s, 0.95), max: q(maxes, 1) },
  wallMs,
  gates: GATES,
  failures,
};
if (jsonFile !== "") writeFileSync(jsonFile, JSON.stringify(summary, null, 2) + "\n");

const lines = [
  `### AI 對 AI：${games.length} 場`,
  "",
  `| 項目 | 結果 |`,
  `|---|---|`,
  `| 玩家 0 出生點勝 | ${wins[0]}（勝率 ${pct(rate)}，平手不算進分母） |`,
  `| 玩家 1 出生點勝 | ${wins[1]}（勝率 ${pct(1 - rate)}） |`,
  `| 平手（30 分鐘到） | ${draws}（${pct(drawShare)}） |`,
  `| 重播雜湊不同 | ${replayFail} 場 |`,
  ...(mixed.length === 0 ? [] : [`| 難度不同的 ${mixed.length} 場 | ${stronger.name} 勝 ${stronger.wins}／分出勝負 ${stronger.decided}（${pct(strongerRate)}，門檻 ${pct(GATES.strongerWinMin)}） |`]),
  `| 每局長度（分鐘） | 最短 ${summary.minutes.min.toFixed(1)}、中位數 ${summary.minutes.median.toFixed(1)}、90% ${summary.minutes.p90.toFixed(1)}、最長 ${summary.minutes.max.toFixed(1)} |`,
  `| 搶／治理 | ${plunder}／${govern}（搶 ${pct(summary.plunderShare)}） |`,
  `| 法師產量／陣亡 | 玩家 0：${mages[0].trained}／${mages[0].lost}；玩家 1：${mages[1].trained}／${mages[1].lost} |`,
  `| 晶砲發射／命中人次（每發平均） | 玩家 0：${mages[0].shots}／${mages[0].hits}（${perShot(mages[0])}）；玩家 1：${mages[1].shots}／${mages[1].hits}（${perShot(mages[1])}） |`,
  `| 每 tick（µs） | 各局中位數的中位數 ${summary.tickMicros.medianOfMedians}、各局 p95 的 95% ${summary.tickMicros.p95OfP95}、最大 ${summary.tickMicros.max} |`,
  `| 總時間（含重播） | ${(wallMs / 1000).toFixed(1)} 秒 |`,
  "",
  "**各性格**（每個出生點算一次出場；勝率對所有對手，平手不算進分母）",
  "",
  "| 性格 | 出場 | 分出勝負 | 勝 | 勝率（95% 信賴區間） | 搶 | 治理 |",
  "|---|---|---|---|---|---|---|",
  ...Object.entries(styles).map(([name, st]) => {
    const [lo, hi] = wilson(st.wins, st.decided);
    return `| ${STYLE_NAMES[name] ?? name} | ${st.played} | ${st.decided} | ${st.wins} | ${st.decided === 0 ? "—" : `${pct(st.wins / st.decided)}（${pct(lo)}–${pct(hi)}）`} | ${st.plunder} | ${st.govern} |`;
  }),
  "",
  "**城鎮**（資源一律算糧＋木＋金＋魔晶）",
  "",
  `- 搶一次平均拿到 ${plunderGain.toFixed(0)}。`,
  `- 選治理 ${governChosen} 次，平均花 ${governCostAvg.toFixed(0)}；治理中的城鎮共 ${governedMinutes.toFixed(0)} 城鎮·分鐘，每分鐘實際產出 ${incomePerMinute.toFixed(1)}（含駐軍不足、不產出的時間）；照這個速度 ${towns.paybackMinutes.toFixed(1)} 分鐘回本（不含修繕時間）。`,
  `- 治理結束（叛離或被攻下）${spellsEnded} 次，其中 ${spellsPaid} 次已經回本；一局結束時還在治理 ${spellsOpen} 座，其中 ${spellsOpenPaid} 座已經回本。`,
  `- 第一次攻下城鎮：中位數第 ${towns.firstCaptureMinute.median.toFixed(1)} 分鐘，平均第 ${towns.firstCaptureMinute.mean.toFixed(1)} 分鐘（${towns.firstCaptureMinute.games} 局有攻下）。`,
  "",
  failures.length === 0 ? "門檻全部通過。" : `**沒通過：** ${failures.join("；")}`,
];
console.log(lines.join("\n"));
if (failures.length > 0) process.exit(1);
