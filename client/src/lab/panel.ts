// The measurement panel: live fps and tick times, 開始量測 (5 s warm-up, 30 s window, the
// engine-spike thresholds), 確定性檢查, the result box and the log. Opened from a corner
// button for now; the HUD's menu takes it over.

import { HeaderField as H, STEP_BATCH } from "../sim.ts";
import type { CheckResult } from "./determinism.ts";
import { type FrameContext, Lab, type MeasureResult, PASS, STALL_MS, WINDOW_MS } from "./lab.ts";
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
   * 開始量測 asks this instead of measuring the game on screen when given (it starts the
   * `perf` scenario, which measures itself once it is running).
   */
  requestMeasure?: () => void;
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
  private readonly measureBtn: HTMLButtonElement;
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
    const row = make("div", this.panel, "lab-buttons");
    this.measureBtn = make("button", row, "", "開始量測");
    this.measureBtn.type = "button";
    this.checkBtn = make("button", row, "secondary", "確定性檢查");
    this.checkBtn.type = "button";
    const copy = make("button", row, "secondary", "複製 log");
    copy.type = "button";
    make("p", this.panel, "lab-note", "開始量測：開一局 perf 場景（所有系統都開著），暖機 5 秒後量 30 秒，量測時不要操作。");
    this.status = make("p", this.panel, "lab-status");
    this.resultBox = make("div", this.panel, "lab-result");
    this.resultBox.hidden = true;
    const logWrap = make("div", this.panel, "lab-log-wrap");
    const logBox = make("div", logWrap, "lab-log");
    logBox.setAttribute("role", "log");
    const more = make("button", logWrap, "lab-more", "有新訊息 ↓");
    more.type = "button";
    this.log = new LogBox(logBox, more);

    this.measureBtn.addEventListener("click", () => {
      if (this.hooks.requestMeasure !== undefined) this.hooks.requestMeasure();
      else this.startMeasure(performance.now());
    });
    this.checkBtn.addEventListener("click", () => void this.startCheck());
    copy.addEventListener("click", () => {
      void navigator.clipboard?.writeText(this.log.text()).then(
        () => this.log.add("log 已複製"),
        () => this.log.add("無法複製（瀏覽器不允許）"),
      );
    });
    this.refreshButtons();
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
    this.measureBtn.disabled = m !== null;
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

  private showResult(r: MeasureResult): void {
    const env = this.hooks.env();
    this.log.add(`measure ${JSON.stringify({ ...r, ...env })}`);
    const box = this.resultBox;
    box.hidden = false;
    box.replaceChildren();
    make("h3", box, "", r.valid ? (r.pass ? "通過" : "未通過") : "無效");
    make("p", box, "", `場景：${String(env.scenario ?? "?")}${env.scenario === "perf" ? "（所有系統都開著）" : ""}`);
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
    ];
    for (const [k, v, ok] of rows) make("p", box, "", `${ok === null ? "・" : ok ? "✓" : "✗"} ${k}：${v}`);
    make("p", box, "small", `樣本：${r.frames} 幀、${r.ticks} tick；${Object.values(env).join("；")}`);
    this.refreshButtons();
  }
}
