// Top-right game controls (GDD §10 草稿: 右上 暫停、速度、選單): speed cycles 正常 → 快 → 慢,
// 暫停 / 繼續, and a banner while paused (GDD §11: while paused you can still select and
// give orders). Temporary prototype interface; the menu comes with the HUD shell.

import { SPEED_TPS } from "../params.ts";

export type SpeedName = keyof typeof SPEED_TPS;

const ORDER: SpeedName[] = ["normal", "fast", "slow"];
// No multipliers on the button: "正常 1.5×" would read as a sped-up normal (D-024).
export const SPEED_LABEL: Record<SpeedName, string> = { slow: "慢", normal: "正常", fast: "快" };

/** The tick rate for the lab's result and log, e.g. 每秒 30 tick（正常）. */
export function tickRateText(tps: number): string {
  const name = (Object.keys(SPEED_TPS) as SpeedName[]).find((k) => SPEED_TPS[k] === tps);
  return `每秒 ${tps} tick${name === undefined ? "" : `（${SPEED_LABEL[name]}）`}`;
}

export function nextSpeed(s: SpeedName): SpeedName {
  return ORDER[(ORDER.indexOf(s) + 1) % ORDER.length];
}

export interface ControlHandlers {
  togglePause(): void;
  cycleSpeed(): void;
}

export class Controls {
  /** The top-right button row; the lab adds its button here too. */
  readonly bar: HTMLElement;
  private readonly speedBtn: HTMLButtonElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly banner: HTMLElement;

  constructor(hud: HTMLElement, h: ControlHandlers) {
    this.bar = document.createElement("div");
    this.bar.className = "top-right";
    hud.appendChild(this.bar);
    this.speedBtn = document.createElement("button");
    this.speedBtn.type = "button";
    this.speedBtn.className = "secondary";
    this.speedBtn.addEventListener("click", () => h.cycleSpeed());
    this.pauseBtn = document.createElement("button");
    this.pauseBtn.type = "button";
    this.pauseBtn.addEventListener("click", () => h.togglePause());
    this.bar.append(this.speedBtn, this.pauseBtn);
    this.banner = document.createElement("div");
    this.banner.className = "paused-banner";
    this.banner.setAttribute("role", "status");
    this.banner.textContent = "暫停中：仍可下指令";
    hud.appendChild(this.banner);
    this.setSpeed("normal");
    this.setPaused(false);
  }

  setSpeed(s: SpeedName): void {
    this.speedBtn.textContent = `速度 ${SPEED_LABEL[s]}`;
  }

  setPaused(paused: boolean): void {
    this.pauseBtn.textContent = paused ? "繼續" : "暫停";
    this.banner.hidden = !paused;
  }
}
