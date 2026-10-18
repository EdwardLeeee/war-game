// The measurement panel: live fps and tick times, 量測 120／200／360 人 (5 s warm-up, 30 s
// window, the engine-spike thresholds; D-083), 確定性檢查, the result box and the log. Opened from a corner
// button for now; the HUD's menu takes it over.

import { ART_CHOICES, ART_LABEL, type ArtChoice, loadArtChoice, saveArtChoice } from "../art/pref.ts";
import { HeaderField as H, STEP_BATCH } from "../sim.ts";
import type { CheckResult } from "./determinism.ts";
import { type FrameContext, Lab, type MeasureResult, PASS, PERF_SCENARIOS, type PerfScenario, STALL_MS, WINDOW_MS } from "./lab.ts";
import { LogBox } from "./log.ts";
import { round2, summarize } from "./stats.ts";

export interface LabHooks {
  /** Build, device and data facts written next to every result. */
  env(): Record<string, unknown>;
  /** Runs the determinism check, or null while there is no simulation to check. */
  check: (() => Promise<void>) | null;
  /** The numbers come from the fake world, not the game. */
  fake(): boolean;
  /**
   * 量測 N 人 asks this instead of measuring the game on screen when given (it starts that
   * perf scenario, which measures itself once it is running).
   */
  requestMeasure?: (scenario: PerfScenario) => void;
  /** This build has the units' atlases (D-085): 美術 can be chosen. */
  artAvailable?: boolean;
}

/**
 * A measurement under way, kept in the tab's session (D-085): when Safari reloads the page for
 * want of memory in the middle of one, the page finds it on opening and says so.
 */
export const MEASURING_KEY = "war-game.proto.measuring";

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** A measurement the page was reloaded in the middle of (its 美術 and scenario), and forgets it. */
export function measureCutShort(): string | null {
  try {
    const s = session();
    const v = s?.getItem(MEASURING_KEY) ?? null;
    s?.removeItem(MEASURING_KEY);
    return v;
  } catch {
    return null;
  }
}

function make<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== "") e.className = cls;
  if (text !== "") e.textContent = text;
  parent.appendChild(e);
  return e;
}

export class LabPanel {
  readonly lab = new Lab();
  readonly log: LogBox;
  private readonly hooks: LabHooks;
  private readonly panel: HTMLElement;
  private readonly live: HTMLElement;
  private readonly measureBtns: HTMLButtonElement[];
  private readonly artBtns: HTMLButtonElement[];
  private readonly checkBtn: HTMLButtonElement;
  private readonly status: HTMLElement;
  private readonly resultBox: HTMLElement;
  private readonly frameMs: number[] = [];
  private readonly frameAt: number[] = [];
  private readonly tickMs: number[] = [];
  private readonly tickAt: number[] = [];
  private lastLive = 0;
  private lastTick = -1;

  /** A 量測 toggle goes into `toggleHost` when given; otherwise the page opens it with show(). */
  constructor(root: HTMLElement, hooks: LabHooks, toggleHost: HTMLElement | null = root) {
    this.hooks = hooks;
    this.panel = make("section", root, "lab");
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", "量測與確定性檢查");
    if (toggleHost !== null) {
      const toggle = make("button", toggleHost, "lab-toggle secondary", "量測");
      toggle.type = "button";
      toggle.addEventListener("click", () => {
        this.panel.hidden = !this.panel.hidden;
      });
    }
    const head = make("div", this.panel, "lab-head");
    make("b", head, "", "量測與確定性檢查");
    const close = make("button", head, "secondary", "關閉");
    close.type = "button";
    close.addEventListener("click", () => {
      this.panel.hidden = true;
    });
    this.live = make("p", this.panel, "lab-live", "…");
    // 美術 (D-085): the units from the atlases, at a scale, from the next game on (量測 starts one).
    const arts = make("div", this.panel, "lab-buttons lab-art");
    arts.setAttribute("role", "radiogroup");
    arts.setAttribute("aria-label", "美術");
    make("span", arts, "lab-art-label", "美術");
    this.artBtns = ART_CHOICES.map((c) => {
      const b = make("button", arts, "", ART_LABEL[c]);
      b.type = "button";
      b.setAttribute("role", "radio");
      b.disabled = hooks.artAvailable !== true && c !== "off";
      b.addEventListener("click", () => {
        saveArtChoice(c);
        this.showArt();
        this.log.add(`美術：${ART_LABEL[c]}（下一局起，量測會開新的一局）`);
      });
      return b;
    });
    if (hooks.artAvailable !== true) make("span", arts, "lab-art-note", "這個版本沒有圖集");
    const measures = make("div", this.panel, "lab-buttons");
    this.measureBtns = PERF_SCENARIOS.map((p) => {
      const b = make("button", measures, "", `量測 ${p.population} 人`);
      b.type = "button";
      b.addEventListener("click", () => {
        if (this.hooks.requestMeasure !== undefined) this.hooks.requestMeasure(p.scenario);
        else this.startMeasure(performance.now());
      });
      return b;
    });
    const row = make("div", this.panel, "lab-buttons");
    this.checkBtn = make("button", row, "secondary", "確定性檢查");
    this.checkBtn.type = "button";
    const copy = make("button", row, "secondary", "複製 log");
    copy.type = "button";
    make("p", this.panel, "lab-note", "量測：開一局 perf 場景（所有系統都開著，雙方人口 120、200 或 360），暖機 5 秒後量 30 秒，量測時不要操作。");
    this.status = make("p", this.panel, "lab-status");
    this.resultBox = make("div", this.panel, "lab-result");
    this.resultBox.hidden = true;
    const logWrap = make("div", this.panel, "lab-log-wrap");
    const logBox = make("div", logWrap, "lab-log");
    logBox.setAttribute("role", "log");
    const more = make("button", logWrap, "lab-more", "有新訊息 ↓");
    more.type = "button";
    this.log = new LogBox(logBox, more);

    this.checkBtn.addEventListener("click", () => void this.startCheck());
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(this.log.text()).then(
        () => this.log.add("log 已複製"),
        () => this.log.add("無法複製（瀏覽器不允許）"),
      );
    });
    this.showArt();
    this.refreshButtons();
  }

  /** Which 美術 is chosen. */
  private showArt(): void {
    const chosen: ArtChoice = loadArtChoice();
    ART_CHOICES.forEach((c, i) => {
      const on = c === chosen;
      this.artBtns[i].setAttribute("aria-checked", on ? "true" : "false");
      this.artBtns[i].classList.toggle("secondary", !on);
    });
  }

  show(): void {
    this.panel.hidden = false;
  }

  hide(): void {
    this.panel.hidden = true;
  }

  /** Measuring or checking (重設 leaves the panel open then). */
  get busy(): boolean {
    return this.lab.phase !== "idle";
  }

  get open(): boolean {
    return !this.panel.hidden;
  }

  startMeasure(now: number): boolean {
    if (!this.lab.startMeasure(now)) return false;
    try {
      const env = this.hooks.env();
      session()?.setItem(MEASURING_KEY, `美術 ${String(env.art ?? "關")}、場景 ${String(env.scenario ?? "?")}`);
    } catch {
      // Not kept: a reload would go unnoticed.
    }
    this.resultBox.hidden = true;
    this.log.add("暖機 5 秒，接著量 30 秒");
    this.refreshButtons();
    return true;
  }

  async startCheck(): Promise<void> {
    const run = this.hooks.check;
    if (run === null || !this.lab.startCheck()) return;
    this.refreshButtons();
    this.log.add("確定性檢查開始");
    try {
      await run();
    } catch (err) {
      this.log.add(`確定性檢查失敗：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.lab.endCheck();
      this.refreshButtons();
    }
  }

  /** Every snapshot: one tick's time for the measurement and the live line. */
  snapshot(header: Int32Array, now: number): void {
    const tick = header[H.tick];
    if (tick === this.lastTick) return;
    this.lastTick = tick;
    const ms = header[H.stepMicros] / 1000;
    this.tickMs.push(ms);
    this.tickAt.push(now);
    const batch = tick > 0 && tick % STEP_BATCH === 0 ? header[H.stepBatchMicros] : null;
    this.lab.tick(header[H.stepMicros], batch, STEP_BATCH);
  }

  /** Every rendered frame. */
  frame(now: number, dt: number, ctx: FrameContext): void {
    const wasWarmup = this.lab.phase === "warmup";
    const result = this.lab.frame(now, dt, ctx);
    if (wasWarmup && this.lab.phase === "measuring") this.log.add("量測開始（30 秒）");
    if (result !== null) this.showResult(result);
    this.frameMs.push(dt);
    this.frameAt.push(now);
    while (this.frameAt.length > 0 && now - this.frameAt[0] > WINDOW_MS) {
      this.frameAt.shift();
      this.frameMs.shift();
    }
    while (this.tickAt.length > 0 && now - this.tickAt[0] > WINDOW_MS) {
      this.tickAt.shift();
      this.tickMs.shift();
    }
    if (now - this.lastLive > 500 && this.open) {
      this.lastLive = now;
      const f = summarize(this.frameMs);
      const t = summarize(this.tickMs);
      const secs = this.frameAt.length > 1 ? Math.round((this.frameAt[this.frameAt.length - 1] - this.frameAt[0]) / 1000) : 0;
      this.live.textContent =
        `最近 ${secs} 秒：fps 中位數 ${f.median > 0 ? round2(1000 / f.median) : 0}，最慢 5% ${f.p95 > 0 ? round2(1000 / f.p95) : 0}；` +
        `模擬每 tick 中位數 ${round2(t.median)} ms、最大 ${round2(t.max)} ms` +
        (this.hooks.fake() ? "（假資料）" : "");
    }
  }

  private refreshButtons(): void {
    const m = this.lab.blockedMeasure();
    const c = this.hooks.check === null ? "接上真的模擬後才能做確定性檢查" : this.lab.blockedCheck();
    for (const b of this.measureBtns) b.disabled = m !== null;
    this.checkBtn.disabled = c !== null;
    this.status.textContent = [m, c].filter((v) => v !== null).join("；");
  }

  /** The determinism check's verdict, in the result box. */
  showCheck(r: CheckResult): void {
    const box = this.resultBox;
    box.hidden = false;
    box.replaceChildren();
    make("h3", box, "", r.same === null ? "確定性：沒有 CI 對照檔" : r.same ? "確定性：與 CI 相同 ✓" : "確定性：與 CI 不同 ✗");
    if (r.same === false) make("p", box, "bad", `${r.mismatches} 處不同，第一處在 tick ${r.firstMismatchTick}`);
    make("p", box, "", `比對 ${r.compared} 個雜湊；${r.ticks} tick，最終 ${r.finalHash}`);
    make("p", box, "", `花了 ${Math.round(r.totalMs)} ms；每 tick 中位數 ${r.tickMedianMs} ms、最大 ${r.tickMaxMs} ms`);
    make("p", box, "small", Object.values(this.hooks.env()).join("；"));
  }

  /** The measurement ends without a result (its game is over): nothing to report after a reload. */
  stopMeasuring(): void {
    try {
      session()?.removeItem(MEASURING_KEY);
    } catch {
      // Nothing kept.
    }
  }

  private showResult(r: MeasureResult): void {
    this.stopMeasuring();
    const env = this.hooks.env();
    this.log.add(`measure ${JSON.stringify({ ...r, ...env })}`);
    const box = this.resultBox;
    box.hidden = false;
    box.replaceChildren();
    make("h3", box, "", r.valid ? (r.pass ? "通過" : "未通過") : "無效");
    const perf = PERF_SCENARIOS.find((p) => p.scenario === env.scenario);
    make("p", box, "", `場景：${String(env.scenario ?? "?")}${perf !== undefined ? `（所有系統都開著，雙方人口 ${perf.population}）` : ""}`);
    make("p", box, "", `tick 速度：${String(env.tickRate ?? "?")}`);
    if (!r.valid) make("p", box, "bad", `原因：${r.reasons.join("、")}。請重新量測。`);
    // ✓／✗ against a standard; ・ for the numbers that have none (yet).
    const rows: [string, string, boolean | null][] = [
      ["fps 中位數", `${r.fpsMedian}（標準 ≥ ${PASS.fpsMedian}）`, r.fpsMedian >= PASS.fpsMedian],
      ["最慢 5% 的 fps", `${r.fpsLow5}（標準 ≥ ${PASS.fpsLow}）`, r.fpsLow5 >= PASS.fpsLow],
      // D-030: they show the stalls the median hides.
      ["平均 fps", `${r.fpsMean}`, null],
      [`停頓（一張畫面超過 ${STALL_MS} ms）`, `${r.stalls} 次，共 ${round2(r.stallMs / 1000)} 秒；最長的一張 ${r.longestFrameMs} ms`, null],
      ["每 tick 模擬中位數", `${r.tickMedianMs} ms（標準 ≤ ${PASS.tickMedianMs}）`, r.tickMedianMs <= PASS.tickMedianMs],
      ["每 tick 模擬平均", `${r.tickMeanMs} ms`, null],
      ["每 tick 模擬最大值", `${r.tickMaxMs} ms`, null],
      // D-085: what the atlases cost the GPU.
      ["每張畫面的繪製次數", `中位數 ${r.drawsMedian}、最多 ${r.drawsMax}`, null],
      ["美術", `${String(env.art ?? "關")}`, null],
    ];
    for (const [k, v, ok] of rows) make("p", box, "", `${ok === null ? "・" : ok ? "✓" : "✗"} ${k}：${v}`);
    make("p", box, "small", `樣本：${r.frames} 幀、${r.ticks} tick；${Object.values(env).join("；")}`);
    this.refreshButtons();
  }
}
