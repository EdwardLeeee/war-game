// Prototype page. The start screen offers the one mode (1 v 1 against the simple AI);
// 開始 brings up the battlefield, run by core's simulation Worker. `?test=1&mock=1` runs the
// fake world in mock/ instead (same messages), for the gesture tests.

import "./style.css";
import { type Application, VERSION } from "pixi.js";
import { Game } from "./game/game.ts";
import { type GameHook, gameHook } from "./game/test-hook.ts";
import { MockPort } from "./mock/mock-port.ts";
import { createSimPort } from "./game/port.ts";
import { parseParams, SPEED_TPS } from "./params.ts";
import { DIFFICULTY_LABEL, loadDifficulty, saveDifficulty } from "./difficulty.ts";
import { loadTownHintOff } from "./hint-pref.ts";
import { AI_DIFFICULTIES, type AiDifficulty, MAX_TICKS, type ScenarioName, TICKS_PER_SECOND } from "./sim.ts";
import { createStage, gpuLimits } from "./stage.ts";
import { tickRateText } from "./ui/controls.ts";
import { deployedCommit, isNewer, updateHref } from "./version.ts";

declare const __COMMIT__: string;

/** Read-only view for the Playwright tests, present only with `?test=1`. */
export interface ProtoHook {
  commit: string;
  screen: "start" | "battle";
  /** The battlefield has been drawn at least once. */
  ready: boolean;
  game?: GameHook;
}

declare global {
  interface Window {
    __proto?: ProtoHook;
  }
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const params = parseParams(location.search);
const hook: ProtoHook = { commit: __COMMIT__, screen: "start", ready: false };
if (params.test) window.__proto = hook;

let app: Application | null = null;
let game: Game | null = null;

/** 難度 on the start screen: 簡單 the first time, then the last choice on this device (D-024). */
let difficulty: AiDifficulty = loadDifficulty();
const difficultyButtons = [...document.querySelectorAll<HTMLButtonElement>("#start [data-difficulty]")];
function showDifficulty(): void {
  for (const b of difficultyButtons) {
    const on = b.dataset.difficulty === difficulty;
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.classList.toggle("secondary", !on);
  }
}
for (const b of difficultyButtons) {
  b.addEventListener("click", () => {
    const d = AI_DIFFICULTIES.find((v) => v === b.dataset.difficulty);
    if (d === undefined) return;
    difficulty = d;
    saveDifficulty(d);
    showDifficulty();
  });
}
showDifficulty();

/** This game's opponent and time limit, in words, for the lab's result and log. */
function gameText(level: AiDifficulty, maxTicks: number, enemyAi: boolean): string {
  const who = enemyAi ? `電腦${DIFFICULTY_LABEL[level]}` : "對手不動（測試）";
  const limit = maxTicks === 0 ? "沒有時間上限" : `時間上限 ${maxTicks / TICKS_PER_SECOND / 60} 分鐘`;
  return `這局：${who}、${limit}`;
}

const env = (scenario: ScenarioName, about: string) => () => ({
  commit: __COMMIT__,
  engine: `PixiJS ${VERSION}`,
  scenario: params.mock ? "mock" : scenario,
  data: params.mock ? "假資料（mock）" : `模擬 ${scenario}`,
  userAgent: navigator.userAgent,
  dpr: window.devicePixelRatio,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
  gpu: app === null ? "" : gpuLimits(app),
  tickRate: game === null ? "" : tickRateText(game.tps),
  game: about,
});

$("commit").textContent = `commit ${__COMMIT__}`;

/**
 * 有新版本 (D-042): checked when the page opens and whenever it comes back from the
 * background. The start screen offers 更新 (a reload); during a game the player is only told
 * once, and nothing reloads under him.
 */
let newerTold = false;
let newer: string | null = null;
async function checkVersion(): Promise<void> {
  const deployed = await deployedCommit();
  if (deployed === null || !isNewer(__COMMIT__, deployed)) return;
  newer = deployed;
  $("update").hidden = false;
  if (hook.screen === "battle" && game !== null && !newerTold) {
    newerTold = true;
    game.toast("有新版本：回到開局畫面（選單 → 回開局畫面）就能更新");
  }
}
$("update-now").addEventListener("click", () => {
  if (newer !== null) location.assign(updateHref(location.href, newer));
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void checkVersion();
});
void checkVersion();
$("start-game").addEventListener("click", () => {
  void (game === null ? newGame(params.scenario ?? "standard") : continueGame()).catch(showError);
});
$("restart-game").addEventListener("click", () => {
  void newGame().catch(showError);
});

/**
 * Start a game, ending the one on screen if there is one (開始, 重來). `measure`: the perf
 * scenario for 量測, which opens the lab and starts measuring once the game runs.
 */
async function newGame(scenario: ScenarioName = "standard", measure = false): Promise<void> {
  $("start").hidden = true;
  hook.screen = "battle";
  hook.ready = false;
  if (app === null) app = await createStage($("stage"));
  game?.destroy();
  const port = params.mock ? new MockPort() : createSimPort(showError);
  // Players get the chosen 難度 and no time limit (D-024); 量測 always plays 普通 with the
  // 30-minute limit, like the determinism check and CI, so the numbers compare between runs.
  const level: AiDifficulty = measure ? "normal" : difficulty;
  const maxTicks = measure ? MAX_TICKS : 0;
  const enemyAi = measure || params.enemyAi;
  const g = new Game(app, port, $("hud"), {
    seed: newSeed(),
    scenario,
    tps: measure ? SPEED_TPS.normal : (params.tps ?? SPEED_TPS.normal),
    fake: params.mock,
    // 量測 always has the computer playing (all systems on).
    enemyAi,
    difficulty: level,
    maxTicks,
    env: env(scenario, gameText(level, maxTicks, enemyAi)),
    checkPort: params.mock ? null : () => createSimPort(showError),
    life: {
      restart: () => void newGame().catch(showError),
      toStart: showStart,
      perf: () => void newGame("perf", true).catch(showError),
    },
  });
  game = g;
  if (params.test) hook.game = gameHook(g);
  g.start();
  await g.whenReady();
  if (game !== g) return;
  hook.ready = true;
  // 開局提示 (D-044): once per game, here at its start (重來 is a new game; 繼續這局 is not),
  // unless the player chose 不再提示; 選單 → 魔晶怎麼拿 still opens it.
  if (!measure && params.hint && !loadTownHintOff()) g.showTownHint();
  if (measure) {
    g.focusBattle();
    g.lab.show();
    g.lab.startMeasure(performance.now());
  }
}

/** Back from the start screen to the game in progress; it stays paused until 繼續. */
async function continueGame(): Promise<void> {
  $("start").hidden = true;
  hook.screen = "battle";
}

/** 回開局畫面: pause the game and offer 繼續這局 or 重來. */
function showStart(): void {
  game?.pause();
  hook.screen = "start";
  // A game is in progress: a new 難度 applies from the next game.
  $("difficulty-note").hidden = false;
  $("start-game").textContent = "繼續這局";
  $("restart-game").hidden = false;
  $("start").hidden = false;
}

/** A new game's seed. It is an input to the simulation (recorded in the command log), not simulation state. */
function newSeed(): number {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] >>> 1 || 1;
}

function showError(err: unknown): void {
  const box = $("error");
  box.hidden = false;
  box.textContent = `出錯了：${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
}
