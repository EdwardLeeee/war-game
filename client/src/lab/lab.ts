// The measurement and the determinism check, as one state machine so they can never
// overlap (engine spike finding: on the phone the Godot measurement ran during the
// determinism check, which made it meaningless). While either runs, the other cannot
// start. As a second guard, a measurement records anything that would distort it — the
// check running anyway, the page hidden, the game paused or not at normal speed, no ticks —
// and its result then says 無效 with the reasons.

import { round2, summarize } from "./stats.ts";

export const WARMUP_MS = 5000;
export const WINDOW_MS = 30000;
export const PASS = { fpsMedian: 55, fpsLow: 30, tickMedianMs: 5 };
/**
 * A frame that took longer than this is a stall (停頓): the picture stops for about three
 * frames at 60 fps or more, which the player sees. The median and the slowest 5 % do not
 * show how many there were (D-030: 30 s at a median of 59.88 fps had only 1557 frames).
 */
export const STALL_MS = 50;

export type LabPhase = "idle" | "warmup" | "measuring" | "checking";

/** What the page is doing at a frame, as far as the measurement cares. */
export interface FrameContext {
  hidden: boolean;
  paused: boolean;
  normalSpeed: boolean;
}

export interface MeasureResult {
  valid: boolean;
  reasons: string[];
  pass: boolean;
  frames: number;
  ticks: number;
  fpsMedian: number;
  fpsLow5: number;
  /** Frames per second over the whole window: frames ÷ their total time (D-030). */
  fpsMean: number;
  /** Frames longer than STALL_MS, their total time and the longest frame. */
  stalls: number;
  stallMs: number;
  longestFrameMs: number;
  tickMedianMs: number;
  tickMeanMs: number;
  tickMaxMs: number;
}

export class Lab {
  phase: LabPhase = "idle";
  private start = 0;
  private frames: number[] = [];
  private ticks: number[] = [];
  private batchMeans: number[] = [];
  private reasons = new Set<string>();

  /** Why a button is unavailable right now, or null if it can be pressed. */
  blockedMeasure(): string | null {
    if (this.phase === "checking") return "確定性檢查進行中，完成後才能量測";
    if (this.phase !== "idle") return "量測進行中";
    return null;
  }

  blockedCheck(): string | null {
    if (this.phase === "warmup" || this.phase === "measuring") return "量測進行中，完成後才能做確定性檢查";
    if (this.phase === "checking") return "確定性檢查進行中";
    return null;
  }

  startMeasure(now: number): boolean {
    if (this.blockedMeasure() !== null) return false;
    this.phase = "warmup";
    this.start = now;
    this.frames = [];
    this.ticks = [];
    this.batchMeans = [];
    this.reasons.clear();
    return true;
  }

  startCheck(): boolean {
    if (this.blockedCheck() !== null) return false;
    this.phase = "checking";
    return true;
  }

  endCheck(): void {
    if (this.phase === "checking") this.phase = "idle";
  }

  /** Something that makes the running measurement meaningless. */
  spoil(reason: string): void {
    if (this.phase === "warmup" || this.phase === "measuring") this.reasons.add(reason);
  }

  /** One simulation tick's time (µs) and, every STEP_BATCH ticks, the batch sum (µs). */
  tick(stepMicros: number, batchMicros: number | null, batchTicks: number): void {
    if (this.phase !== "measuring") return;
    this.ticks.push(stepMicros / 1000);
    if (batchMicros !== null) this.batchMeans.push(batchMicros / batchTicks / 1000);
  }

  /** Call every rendered frame; returns the result when the window closes. */
  frame(now: number, dtMs: number, ctx: FrameContext): MeasureResult | null {
    if (this.phase === "warmup") {
      if (now - this.start >= WARMUP_MS) {
        this.phase = "measuring";
        this.start = now;
      }
      return null;
    }
    if (this.phase !== "measuring") return null;
    if (ctx.hidden) this.spoil("量測期間頁面切到背景");
    if (ctx.paused) this.spoil("量測期間遊戲暫停");
    if (!ctx.normalSpeed) this.spoil("量測期間速度不是「正常」");
    this.frames.push(dtMs);
    if (now - this.start < WINDOW_MS) return null;
    this.phase = "idle";
    return this.result();
  }

  private result(): MeasureResult {
    if (this.ticks.length === 0) this.reasons.add("量測期間模擬沒有跑（0 個 tick）");
    const f = summarize(this.frames);
    const t = summarize(this.ticks);
    const mean = this.batchMeans.length > 0 ? summarize(this.batchMeans).mean : t.mean;
    const r = {
      frames: f.samples,
      ticks: t.samples,
      fpsMedian: f.median > 0 ? round2(1000 / f.median) : 0,
      fpsLow5: f.p95 > 0 ? round2(1000 / f.p95) : 0,
      fpsMean: f.mean > 0 ? round2(1000 / f.mean) : 0,
      stalls: this.frames.filter((ms) => ms > STALL_MS).length,
      stallMs: round2(this.frames.filter((ms) => ms > STALL_MS).reduce((sum, ms) => sum + ms, 0)),
      longestFrameMs: round2(f.max),
      tickMedianMs: round2(t.median),
      tickMeanMs: round2(mean),
      tickMaxMs: round2(t.max),
    };
    const reasons = [...this.reasons];
    const valid = reasons.length === 0;
    const pass = valid && r.fpsMedian >= PASS.fpsMedian && r.fpsLow5 >= PASS.fpsLow && r.tickMedianMs <= PASS.tickMedianMs;
    return { ...r, valid, reasons, pass };
  }
}
