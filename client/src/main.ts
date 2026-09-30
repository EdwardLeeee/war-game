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
import { createStage } from "./stage.ts";

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

const env = () => ({
  commit: __COMMIT__,
  engine: `PixiJS ${VERSION}`,
  data: params.mock ? "假資料（mock）" : "模擬 standard",
  userAgent: navigator.userAgent,
  dpr: window.devicePixelRatio,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
});

$("commit").textContent = `commit ${__COMMIT__}`;
$("start-game").addEventListener("click", () => {
  void (game === null ? newGame() : continueGame()).catch(showError);
});
$("restart-game").addEventListener("click", () => {
  void newGame().catch(showError);
});

/** Start a game, ending the one on screen if there is one (開始, 重來). */
async function newGame(): Promise<void> {
  $("start").hidden = true;
  hook.screen = "battle";
  hook.ready = false;
  if (app === null) app = await createStage($("stage"));
  game?.destroy();
  const port = params.mock ? new MockPort() : createSimPort(showError);
  const g = new Game(app, port, $("hud"), {
    seed: newSeed(),
    scenario: "standard",
    tps: params.tps ?? SPEED_TPS.normal,
    fake: params.mock,
    env,
    checkPort: params.mock ? null : () => createSimPort(showError),
    life: {
      restart: () => void newGame().catch(showError),
      toStart: showStart,
    },
  });
  game = g;
  if (params.test) hook.game = gameHook(g);
  g.start();
  await g.whenReady();
  if (game === g) hook.ready = true;
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
