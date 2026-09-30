// Prototype page. The start screen offers the one mode (1 v 1 against the simple AI);
// 開始 brings up the battlefield. Until core's worker is connected, the battlefield runs on
// the fake world in mock/ (same messages), so the camera, gestures and lab can be tried.

import "./style.css";
import { type Application, VERSION } from "pixi.js";
import { Game } from "./game/game.ts";
import { type GameHook, gameHook } from "./game/test-hook.ts";
import { MockPort } from "./mock/mock-port.ts";
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

const env = () => ({
  commit: __COMMIT__,
  engine: `PixiJS ${VERSION}`,
  data: "假資料（還沒接上模擬）",
  userAgent: navigator.userAgent,
  dpr: window.devicePixelRatio,
  viewport: `${window.innerWidth}x${window.innerHeight}`,
});

$("commit").textContent = `commit ${__COMMIT__}`;
$("start-game").addEventListener("click", () => {
  void startGame().catch(showError);
});

async function startGame(): Promise<void> {
  $("start").hidden = true;
  hook.screen = "battle";
  if (app !== null) return;
  app = await createStage($("stage"));
  const game = new Game(app, new MockPort(), $("hud"), {
    seed: 1,
    scenario: "standard",
    tps: params.tps ?? SPEED_TPS.normal,
    fake: true,
    env,
  });
  if (params.test) hook.game = gameHook(game);
  game.start();
  await game.whenReady();
  hook.ready = true;
}

function showError(err: unknown): void {
  const box = $("error");
  box.hidden = false;
  box.textContent = `出錯了：${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
}
