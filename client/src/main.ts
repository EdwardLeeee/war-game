// Prototype page. The start screen offers the one mode (1 v 1 against the simple AI);
// 開始 brings up the battlefield.

import "./style.css";
import { type Application, UPDATE_PRIORITY } from "pixi.js";
import { parseParams } from "./params.ts";
import { createStage } from "./stage.ts";

declare const __COMMIT__: string;

/** Read-only view for the Playwright tests, present only with `?test=1`. */
export interface ProtoHook {
  commit: string;
  screen: "start" | "battle";
  /** The battlefield has been drawn at least once. */
  ready: boolean;
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

$("commit").textContent = `commit ${__COMMIT__}`;
$("start-game").addEventListener("click", () => {
  void startGame().catch(showError);
});

async function startGame(): Promise<void> {
  $("start").hidden = true;
  hook.screen = "battle";
  if (app === null) {
    app = await createStage($("stage"));
    // UTILITY runs after the render callback, so the first frame is on screen by then.
    app.ticker.addOnce(
      () => {
        hook.ready = true;
      },
      undefined,
      UPDATE_PRIORITY.UTILITY,
    );
  }
}

function showError(err: unknown): void {
  const box = $("error");
  box.hidden = false;
  box.textContent = `出錯了：${err instanceof Error ? err.message : String(err)}`;
  console.error(err);
}
