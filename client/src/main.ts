// Prototype page. The start screen offers the one mode (1 v 1 against the simple AI);
// 開始 brings up the battlefield, run by core's simulation Worker. `?test=1&mock=1` runs the
// fake world in mock/ instead (same messages), for the gesture tests.

import "./style.css";
import { type Application, VERSION } from "pixi.js";
import { Game } from "./game/game.ts";
import type { HudLifecycle } from "./ui/hud/hud.ts";
import { type GameHook, gameHook } from "./game/test-hook.ts";
import { MockPort } from "./mock/mock-port.ts";
import { createSimPort } from "./game/port.ts";
import { parseParams, SPEED_TPS } from "./params.ts";
import { DIFFICULTY_LABEL, loadDifficulty, saveDifficulty } from "./difficulty.ts";
import { loadMapMode, MAP_LABEL, MAP_NOTE, saveMapMode } from "./map-mode.ts";
import { loadTownHintOff } from "./hint-pref.ts";
import { recordCode } from "./logs/code.ts";
import { LogCollector, logsUrlFor, MIN_ABANDONED_TICKS, makeRecord, reasonName, resultFor } from "./logs/collect.ts";
import { openIndexedDb, type StoredLog } from "./logs/store.ts";
import { fetchPoster } from "./logs/upload.ts";
import { ART_LABEL, artBase, loadArtChoice } from "./art/pref.ts";
import { loadUnitArt, type UnitArt } from "./render/unit-art.ts";
import { measureCutShort } from "./lab/panel.ts";
import type { AstcSample } from "./lab/astc.ts";
import { canGoOn, continueLabel, failureText, openSaveDb, progressText, type SavedGame, SaveStore, SCREEN_LOST_TEXT, SCREEN_VERSION, screenUsable, UPDATED_TEXT } from "./save/save.ts";
import { AI_DIFFICULTIES, type AiDifficulty, MAP_MODES, type MapMode, MAX_TICKS, PROTOCOL_VERSION, type ScenarioName, TICKS_PER_SECOND } from "./sim.ts";
import { createStage, gpuLimits } from "./stage.ts";
import { tickRateText } from "./ui/controls.ts";
import { deployedCommit, isNewer, updateHref } from "./version.ts";

declare const __COMMIT__: string;
/** Which simulation this page runs (scripts/sim-build.ts, D-083). */
declare const __SIM_BUILD__: string;
/** The units' atlases' Release tag (art.lock.json; D-085), or null: none in this build. */
declare const __ART_TAG__: string | null;

/** Read-only view for the Playwright tests, present only with `?test=1`. */
export interface ProtoHook {
  commit: string;
  screen: "start" | "battle";
  /** The battlefield has been drawn at least once. */
  ready: boolean;
  game?: GameHook;
  /** 紀錄代號 and the game records kept on this phone (D-056). */
  recordCode: string;
  logs: () => Promise<StoredLog[]>;
  /** 繼續上一局 (D-083): the simulation's build, the game kept on this phone, and what the last save cost. */
  simBuild: string;
  saved: () => Promise<SavedGame | null>;
  lastSave: SaveCost | null;
}

/** What the last save for 繼續上一局 cost (ms): export_log's round trip (the Worker's work), and on the page's main thread building it and IndexedDB's put. */
export interface SaveCost {
  tick: number;
  logBytes: number;
  hashes: number;
  exportMs: number;
  buildMs: number;
  putMs: number;
}

declare global {
  interface Window {
    __proto?: ProtoHook;
  }
}

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const params = parseParams(location.search);
/**
 * 對局紀錄 (D-056): each game's command log is kept on this phone and uploaded to the user's
 * Worker; the player sees only 紀錄代號 on the start screen. Waiting uploads go when the page opens.
 */
const code = recordCode();
const logs = new LogCollector(openIndexedDb(), logsUrlFor(params.test, params.logsUrl), fetchPoster());
void logs.flush();

/** 繼續上一局 (D-083): the game being played, kept on this phone (one, the last). */
const saveStore = new SaveStore(openSaveDb());

const hook: ProtoHook = { commit: __COMMIT__, screen: "start", ready: false, recordCode: code, logs: () => logs.list(), simBuild: __SIM_BUILD__, saved: () => saveStore.load(), lastSave: null };
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

/** 地圖 on the start screen (D-074): 固定地圖 the first time, then the last choice on this device. */
let mapMode: MapMode = loadMapMode();
const mapButtons = [...document.querySelectorAll<HTMLButtonElement>("#start [data-map]")];
function showMapMode(): void {
  for (const b of mapButtons) {
    const on = b.dataset.map === mapMode;
    b.setAttribute("aria-checked", on ? "true" : "false");
    b.classList.toggle("secondary", !on);
  }
  $("map-note").textContent = MAP_NOTE[mapMode];
}
for (const b of mapButtons) {
  b.addEventListener("click", () => {
    const m = MAP_MODES.find((v) => v === b.dataset.map);
    if (m === undefined) return;
    mapMode = m;
    saveMapMode(m);
    showMapMode();
  });
}
showMapMode();

/** This game's opponent and time limit, in words, for the lab's result and log. */
function gameText(level: AiDifficulty, maxTicks: number, enemyAi: boolean, map: MapMode, watch: boolean): string {
  const who = watch ? `電腦${DIFFICULTY_LABEL[level]}對電腦（觀戰）` : enemyAi ? `電腦${DIFFICULTY_LABEL[level]}` : "對手不動（測試）";
  const limit = maxTicks === 0 ? "沒有時間上限" : `時間上限 ${maxTicks / TICKS_PER_SECOND / 60} 分鐘`;
  return `這局：${who}、${MAP_LABEL[map]}、${limit}`;
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
  art: artText(),
});

$("commit").textContent = `commit ${__COMMIT__}`;
// 量測 cut short by a reload (D-085: Safari out of memory with the atlases): say so on the start screen.
{
  const cut = measureCutShort();
  if (cut !== null) {
    $("measure-note").hidden = false;
    $("measure-note").textContent = `上次量測到一半，頁面重新載入了（${cut}）`;
  }
}
$("record-code").textContent = `紀錄代號 ${code}`;

/**
 * What the page keeps of a game, from one export of its log each time:
 * - Its record (D-056), uploaded: when it ends, when 重來 leaves it, and (D-083) whenever the
 *   page goes to the background, so that a game Safari drops while the phone is put away is not
 *   lost with it. Only when the game has gone further than the last upload (the Worker's free
 *   plan writes 1,000 records a day). Each upload goes under a new 局編號; on the phone it takes
 *   the place of the game's earlier one, so the game keeps one entry, and of a game's uploads
 *   the one with the most ticks is the newest. In the background it is still being played
 *   (result abandoned, reason "hidden").
 * - 繼續上一局's save (D-083), on this phone only: in the background and every minute of game
 *   time while the game goes on (ceo 2026-10-17: the minute's is not uploaded).
 * From a minute of game time on. Resolves when the simulation has given the log (before its
 * Worker may be stopped) and the save is written; uploading goes on by itself, off the game's
 * frames. The fake world, 量測 and watching are not kept.
 */
type KeepWhy = "hidden" | "minute" | "end" | "restart";
interface Kept {
  /** The game's key among the phone's records. */
  game: string;
  /** The ticks of the last record uploaded, and of the last save for 繼續上一局. */
  uploaded: number;
  saved: number;
  ended: boolean;
  job: Promise<void>;
}
const kept = new WeakMap<Game, Kept>();
function keptOf(g: Game): Kept {
  let k = kept.get(g);
  if (k === undefined) {
    k = { game: crypto.randomUUID(), uploaded: -1, saved: -1, ended: false, job: Promise.resolve() };
    kept.set(g, k);
  }
  return k;
}
function keepGame(g: Game, why: KeepWhy): Promise<void> {
  const init = g.initSent;
  // Not kept: the fake world, 量測 (perf, perf200, perf360), and watching the computer play itself (test pages).
  if (params.mock || params.watch || init === null || init.scenario.startsWith("perf")) return Promise.resolve();
  const over = g.over;
  const ticks = over === null ? g.currentTick() : over.ticks;
  if (over === null && ticks < MIN_ABANDONED_TICKS) return Promise.resolve();
  const k = keptOf(g);
  const upload = why !== "minute" && (over !== null ? !k.ended : ticks > k.uploaded);
  const save = over === null && (why === "hidden" || why === "minute") && ticks > k.saved;
  // Nothing new since the last time: no export, no write, no upload.
  if (!upload && !save) return k.job;
  if (upload) {
    k.uploaded = ticks;
    k.ended = over !== null;
  }
  if (save) k.saved = ticks;
  const screen = save ? g.screenState() : null;
  const asked = performance.now();
  k.job = k.job.then(() =>
    g.exportLog().then((log) => {
      if (log === null || log.jsonl === "") return;
      const got = performance.now();
      if (upload) {
        const end = over !== null ? { result: resultFor(over.winner, init.human ?? 0), reason: reasonName(over.reason), ticks } : { result: "abandoned" as const, reason: why === "hidden" ? "hidden" : "", ticks };
        const record = makeRecord({ id: crypto.randomUUID(), code, commit: __COMMIT__, protocol: PROTOCOL_VERSION, scenario: init.scenario, difficulty: init.difficulty?.[1] ?? "normal", end, lastHash: g.lastHash, log: log.jsonl });
        void logs.keep(record, k.game);
      }
      if (screen === null || g.over !== null) return;
      const saved: SavedGame = {
        savedAt: Date.now(),
        commit: __COMMIT__,
        protocol: PROTOCOL_VERSION,
        build: __SIM_BUILD__,
        game: k.game,
        init: { seed: init.seed, scenario: init.scenario, difficulty: init.difficulty?.[1] ?? "normal", map: init.map ?? "fixed", maxTicks: init.maxTicks ?? 0, enemyAi: init.ai[1] ?? true },
        log: log.jsonl,
        hashes: log.hashes,
        tick: log.tick,
        screenVersion: SCREEN_VERSION,
        screen,
      };
      const built = performance.now();
      return saveStore.save(saved).then(() => {
        hook.lastSave = { tick: log.tick, logBytes: log.jsonl.length, hashes: log.hashes.length, exportMs: got - asked, buildMs: built - got, putMs: saveStore.lastPutMs };
      });
    }),
  );
  return k.job;
}

/** The game is over, or another takes its place: its record as above, then no 繼續上一局 for it. */
function forgetGame(g: Game, why: "end" | "restart"): Promise<void> {
  const k = keptOf(g);
  return keepGame(g, why).then(() => {
    k.job = k.job.then(() => saveStore.clear());
    return k.job;
  });
}

// To the background (D-083): iPhone Safari may drop the page while it is away, with the game.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && game !== null) void keepGame(game, "hidden");
});
window.addEventListener("pagehide", () => {
  if (game !== null) void keepGame(game, "hidden");
});

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
  // 重來 leaves the game on screen: keep its record first (D-056). A new game takes the place
  // of the one kept for 繼續上一局 (D-083).
  if (game !== null) await forgetGame(game, "restart");
  else await saveStore.clear();
  hideSaved();
  game?.destroy();
  const port = params.mock ? new MockPort(params.round7, params.map ?? mapMode, params.outpost) : createSimPort(showError);
  // Players get the chosen 難度 and no time limit (D-024); 量測 always plays 普通 with the
  // 30-minute limit, like the determinism check and CI, so the numbers compare between runs.
  const level: AiDifficulty = measure ? "normal" : difficulty;
  const maxTicks = measure ? MAX_TICKS : 0;
  const enemyAi = measure || params.enemyAi;
  // 地圖 (D-074): the start screen's choice (a test page may ask for one); 量測 always the fixed map, so the numbers compare between runs.
  const map: MapMode = measure ? "fixed" : (params.map ?? mapMode);
  const art = await artForGame();
  const g = new Game(app, port, $("hud"), {
    seed: params.seed ?? newSeed(),
    scenario,
    tps: measure ? SPEED_TPS.normal : (params.tps ?? SPEED_TPS.normal),
    fake: params.mock,
    // 量測 always has the computer playing (all systems on).
    enemyAi,
    difficulty: level,
    maxTicks,
    map,
    watch: params.watch && !measure,
    env: env(scenario, gameText(level, maxTicks, enemyAi, map, params.watch && !measure)),
    checkPort: params.mock ? null : () => createSimPort(showError),
    art,
    artAvailable,
    artChanged,
    astcSample,
    life,
    ended: () => void forgetGame(g, "end"),
    build: __SIM_BUILD__,
    minute: () => void keepGame(g, "minute"),
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

/**
 * 美術 (D-085): the units drawn from war-game-ui's atlases, as chosen in the 量測 panel (a test
 * page may ask with ?art=), loaded when a game starts and kept while the choice holds. Off, or
 * when they will not load: the shapes. Only the picture: the game itself is the same.
 */
const artAvailable = __ART_TAG__ !== null || params.art === "test";
/** ASTC 樣本 (D-085): the Release's spearman at 2× (or the test page's stand-ins). */
const astcSample: AstcSample | undefined =
  params.art === "test"
    ? { unit: "spear_e", png: "./art/test/x3/units/spear_e/", astc: "./art/test/astc-sample/units/spear_e/" }
    : __ART_TAG__ === null
      ? undefined
      : { unit: "spear_e", png: `./art/${__ART_TAG__}/x2/units/spear_e/`, astc: `./art/${__ART_TAG__}/astc-sample/units/spear_e/` };
let loadedArt: { base: string; art: UnitArt } | null = null;
/** The choice the game on screen was started with. */
let artChoiceUsed: string | null = null;
const artChanged = (): boolean => (params.art ?? loadArtChoice()) !== artChoiceUsed;
let artFailed: string | null = null;
async function artForGame(): Promise<UnitArt | null> {
  const choice = params.art ?? loadArtChoice();
  artChoiceUsed = choice;
  const base = params.mock ? null : artBase(choice, __ART_TAG__);
  if (loadedArt !== null && loadedArt.base === base) return loadedArt.art;
  loadedArt?.art.destroy();
  loadedArt = null;
  artFailed = null;
  if (base === null) return null;
  try {
    loadedArt = { base, art: await loadUnitArt(base, choice === "test" ? "測試圖" : ART_LABEL[choice]) };
    return loadedArt.art;
  } catch (err) {
    artFailed = err instanceof Error ? err.message : String(err);
    console.warn(`art: ${artFailed}`);
    return null;
  }
}
/** For the lab's result: which atlases and how many pages, or why none. */
function artText(): string {
  if (artFailed !== null) return `載入失敗（${artFailed}）`;
  return loadedArt === null ? "關" : `${loadedArt.art.label}，${loadedArt.art.pages} 頁圖`;
}

/** 重來, 回開局畫面 and 量測, from the game's menu. */
const life: HudLifecycle = {
  restart: () => void newGame().catch(showError),
  toStart: showStart,
  perf: (s) => void newGame(s, true).catch(showError),
};

/**
 * 繼續上一局 (D-083) on the start screen of a page just opened: the game this phone kept, if
 * any. Played on another simulation (the site was updated), it cannot go on: the button is
 * grey and says why.
 */
let savedGame: SavedGame | null = null;
function continueNote(text: string | null): void {
  const note = $("continue-note");
  note.hidden = text === null;
  note.textContent = text ?? "";
  $("about-note").hidden = text !== null;
}
async function showSaved(): Promise<void> {
  const button = $("continue-last") as HTMLButtonElement;
  const s = params.mock || params.watch ? null : await saveStore.load();
  // A game started meanwhile.
  if (game !== null) return;
  savedGame = s;
  button.hidden = s === null;
  if (s === null) return;
  button.textContent = continueLabel(s);
  const ok = canGoOn(s, PROTOCOL_VERSION, __SIM_BUILD__);
  button.disabled = !ok;
  // The likelier wish, and 開始 clears the game kept: 繼續上一局 is the main button then.
  button.classList.toggle("secondary", !ok);
  $("start-game").classList.toggle("secondary", ok);
  continueNote(ok ? null : UPDATED_TEXT);
}
void showSaved();
/** A game is on: the start screen offers 繼續這局 and 重來 from now on. */
function hideSaved(): void {
  savedGame = null;
  $("continue-last").hidden = true;
  $("start-game").classList.remove("secondary");
  continueNote(null);
}
$("continue-last").addEventListener("click", () => {
  if (savedGame !== null && game === null) void resumeGame(savedGame).catch(showError);
});

/** While the simulation runs the saved game again: how far, and 取消. */
function continueProgress(tick: number | null, toTick = 0): void {
  const busy = tick !== null;
  $("start").classList.toggle("continuing", busy);
  // The game's buttons wait behind, out of sight, until it is where it was.
  $("hud").style.visibility = busy ? "hidden" : "";
  $("start-buttons").hidden = busy;
  $("continue-progress").hidden = !busy;
  if (!busy) return;
  $("continue-progress-text").textContent = progressText(tick, toTick);
  ($("continue-bar") as HTMLProgressElement).value = toTick > 0 ? tick / toTick : 0;
}
/** Ends the wait for the game being run again (取消, or it cannot go on). */
let stopResume: (() => void) | null = null;
$("continue-cancel").addEventListener("click", () => {
  // The Worker stops where it is (PROTOCOL.md 9.1: no cancelling message); the save stays.
  game?.destroy();
  game = null;
  hook.game = undefined;
  continueProgress(null);
  stopResume?.();
  void showSaved();
});

/**
 * 繼續上一局: the saved game, run again by the simulation up to where it was (the progress on
 * the start screen), then its screen as it was, paused until 繼續. When it cannot go on, the
 * start screen says why in one of two kinds (ceo 2026-10-17) and the save is cleared; the
 * game's record went up in the background already.
 */
async function resumeGame(saved: SavedGame): Promise<void> {
  continueNote(null);
  continueProgress(0, saved.tick);
  hook.ready = false;
  if (app === null) app = await createStage($("stage"));
  const { init } = saved;
  const speed = screenUsable(saved) ? saved.screen.speed : "normal";
  const art = await artForGame();
  const stopped = new Promise<void>((resolve) => {
    stopResume = resolve;
  });
  const g: Game = new Game(app, createSimPort(showError), $("hud"), {
    seed: init.seed,
    scenario: init.scenario,
    tps: params.tps ?? SPEED_TPS[speed],
    fake: false,
    enemyAi: init.enemyAi,
    difficulty: init.difficulty,
    maxTicks: init.maxTicks,
    map: init.map,
    watch: false,
    env: env(init.scenario, gameText(init.difficulty, init.maxTicks, init.enemyAi, init.map, false)),
    checkPort: () => createSimPort(showError),
    art,
    artAvailable,
    artChanged,
    astcSample,
    life,
    ended: () => void forgetGame(g, "end"),
    build: __SIM_BUILD__,
    minute: () => void keepGame(g, "minute"),
    resume: saved,
    progress: (tick, toTick) => {
      if (game === g) continueProgress(tick, toTick);
    },
    continueFailed: (reason, tick) => {
      if (game !== g) return;
      g.destroy();
      game = null;
      hook.game = undefined;
      void saveStore.clear();
      continueProgress(null);
      hideSaved();
      continueNote(failureText(reason, tick));
      stopResume?.();
    },
  });
  game = g;
  // The same game: its record keeps its entry on the phone, uploaded again only once further.
  kept.set(g, { game: saved.game, uploaded: saved.tick, saved: saved.tick, ended: false, job: Promise.resolve() });
  if (params.test) hook.game = gameHook(g);
  g.start();
  const ready = await Promise.race([g.whenReady().then(() => true), stopped.then(() => false)]);
  stopResume = null;
  if (!ready || game !== g) return;
  continueProgress(null);
  hideSaved();
  $("start").hidden = true;
  hook.screen = "battle";
  hook.ready = true;
  // Said now that the battlefield shows (the strip waited hidden while the game was run again).
  if (g.screenLost) g.toast(SCREEN_LOST_TEXT);
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
  // A game is in progress: a new 難度 or 地圖 applies from the next game. That line takes the
  // place of the note on the stand-in shapes, so the card still fits the phone held sideways.
  $("difficulty-note").hidden = false;
  $("about-note").hidden = true;
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
