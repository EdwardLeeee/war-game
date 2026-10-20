// 開一局要等多久 (D-091; the user 2026-10-20: 「我現在開一局新的都會等蠻久的ㄟ」, the first game
// after opening the page 10–20 s): where starting a game spends its time, from the tap to the
// first frame with the battlefield on it. The atlases' files one by one (asked for, all there,
// decoded; from the network or the phone's cache, by the browser's own record), the simulation
// starting, the first frame (its pictures go to the GPU then). On the screen with
// ?test=1&loadtimes=1, in the 量測 panel and the console; the e2e reads them too.
// The lines are pure, for the unit tests; LoadTimesBox is the screen's.

/**
 * Where a file came from: 手機裡 (the service worker's copy, public/sw.js); else by the browser's
 * record (Resource Timing): 網路 (downloaded), 瀏覽器快取 (its own copy, nothing sent), 問過伺服器
 * (the server said the copy is still good: a round trip, no download), 不明 (the browser does not tell).
 */
export type FileSource = "手機裡" | "網路" | "瀏覽器快取" | "問過伺服器" | "不明";

export interface FileTime {
  /** Its path under the atlases' folder (units/spear_e/spear_e_color_0.png). */
  name: string;
  bytes: number;
  source: FileSource;
  /** Milliseconds since the tap: asked for, all of it here, decoded (null: not a picture). */
  start: number;
  downloaded: number;
  decoded: number | null;
}

/** How the atlases came: loaded now, the ones this page already has, none (美術 關), or failed. */
export type ArtLoad = "載入" | "沿用" | "關" | "失敗";

/** Milliseconds since the tap. */
export interface LoadMarks {
  /** The atlases asked for (after the save and, the first time, the canvas). */
  art?: number;
  artDone?: number;
  /** The simulation asked to start, and its answer (the map and rules). */
  init?: number;
  ready?: number;
  /** The first frame with a snapshot: its render begins and ends. */
  drawn?: number;
  frame?: number;
}

export interface LoadReport {
  /** 開始, 重來, 繼續上一局, 量測. */
  trigger: string;
  /** This page's how-manyth game (1: the first since it opened). */
  game: number;
  /** How the page was opened (the navigation's type): navigate, reload, back_forward. */
  page: string;
  art: ArtLoad | null;
  marks: LoadMarks;
  files: FileTime[];
}

const PAGE_TEXT: Record<string, string> = { navigate: "剛打開", reload: "重新整理後", back_forward: "上一頁回來" };

const sec = (ms: number) => `${(ms / 1000).toFixed(2)} 秒`;
const mb = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`;

/** What the screen and the 量測 panel show, a line a step; the steps not reached yet are left out. */
export function loadLines(r: LoadReport): string[] {
  const m = r.marks;
  const out = [`載入計時：${r.trigger}（這頁第 ${r.game} 局，${PAGE_TEXT[r.page] ?? r.page}）`];
  if (m.art === undefined) return out;
  out.push(`準備（存檔、畫布） ${sec(m.art)}`);
  const pictures = r.files.filter((f) => f.decoded !== null);
  const bytes = r.files.reduce((s, f) => s + f.bytes, 0);
  const count = (src: FileSource) => r.files.filter((f) => f.source === src).length;
  const sources = (["手機裡", "網路", "瀏覽器快取", "問過伺服器", "不明"] as const)
    .map((s) => [s, count(s)] as const)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${s} ${n}`)
    .join("、");
  if (m.artDone === undefined) {
    out.push(`美術載入中…已載入 ${r.files.length} 檔 ${mb(bytes)}`);
    return out;
  }
  const art = m.artDone - m.art;
  if (r.art !== "載入") out.push(`美術 ${sec(art)}（${r.art === "沿用" ? "沿用這頁已載入的圖" : r.art === "關" ? "美術關" : "載入失敗，畫圖形"}）`);
  else out.push(`美術 ${sec(art)}：${r.files.length} 檔 ${mb(bytes)}（${sources}）`);
  if (pictures.length > 0) {
    const lastDown = Math.max(...r.files.map((f) => f.downloaded)) - m.art;
    const lastDecoded = Math.max(...pictures.map((f) => f.decoded ?? 0)) - m.art;
    const each = pictures.map((f) => (f.decoded ?? 0) - f.downloaded);
    const avg = each.reduce((s, v) => s + v, 0) / each.length;
    const slowest = pictures[each.indexOf(Math.max(...each))];
    out.push(`　全部下載完 +${sec(lastDown)}，全部解碼完 +${sec(lastDecoded)}`);
    out.push(`　解碼每張平均 ${Math.round(avg)} ms，最慢 ${Math.round(Math.max(...each))} ms（${slowest.name}）`);
  }
  if (m.init !== undefined) out.push(`建立遊戲 ${sec(m.init - m.artDone)}`);
  if (m.init !== undefined && m.ready !== undefined) out.push(`模擬啟動 ${sec(m.ready - m.init)}`);
  if (m.ready !== undefined && m.drawn !== undefined) out.push(`畫面準備 ${sec(m.drawn - m.ready)}`);
  if (m.drawn !== undefined && m.frame !== undefined) {
    out.push(`第一格繪製 ${Math.round(m.frame - m.drawn)} ms（含上傳顯示卡）`);
    out.push(`合計 ${sec(m.frame)}`);
  }
  return out;
}

/**
 * Where a file came from: the service worker says so (its x-war-game-sw header: hit, or stored as
 * it came from the network); else the browser's record (Resource Timing; Safari has the sizes from 16.4).
 */
export function sourceOf(sw: string | null, e: { transferSize?: number; encodedBodySize?: number } | undefined): FileSource {
  if (sw === "hit") return "手機裡";
  if (sw === "stored") return "網路";
  if (e === undefined || typeof e.transferSize !== "number" || typeof e.encodedBodySize !== "number") return "不明";
  if (e.transferSize === 0) return "瀏覽器快取";
  return e.transferSize < e.encodedBodySize ? "問過伺服器" : "網路";
}

/** The atlases' loader tells it each file (render/unit-art.ts): times are performance.now()'s; `sw` the service worker's header. */
export interface LoadRecorder {
  file(url: string, start: number, downloaded: number, bytes: number, decoded: number | null, sw: string | null): void;
}

/** The game being started: one at a time; a new start replaces the measurement. */
export class LoadTimes implements LoadRecorder {
  private t0 = 0;
  private games = 0;
  private urls: string[] = [];
  private sw: (string | null)[] = [];
  private base = "";
  report: LoadReport | null = null;
  /** Called on each step, for the screen while it loads. */
  onChange: (() => void) | null = null;

  begin(trigger: string, now = performance.now()): void {
    this.t0 = now;
    this.games += 1;
    this.urls = [];
    this.sw = [];
    const nav = typeof performance.getEntriesByType === "function" ? (performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined) : undefined;
    this.report = { trigger, game: this.games, page: nav?.type ?? "?", art: null, marks: {}, files: [] };
    // Room for every file's record, a game after another (the default keeps 250).
    performance.setResourceTimingBufferSize?.(2000);
    this.onChange?.();
  }

  /** Measuring, and not done yet. */
  get measuring(): boolean {
    return this.report !== null && this.report.marks.frame === undefined;
  }

  mark(name: keyof LoadMarks, now = performance.now()): void {
    if (!this.measuring || this.report === null || this.report.marks[name] !== undefined) return;
    this.report.marks[name] = now - this.t0;
    this.onChange?.();
  }

  /** The atlases from `base` begin (file names are shown under it). */
  artFrom(base: string): void {
    this.base = new URL(base, location.href).href;
  }

  artDone(how: ArtLoad, now = performance.now()): void {
    if (this.report === null || !this.measuring) return;
    this.report.art = how;
    // Where each file came from: the browser has its record once the file is all there.
    const entries = new Map<string, PerformanceResourceTiming>();
    for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) entries.set(e.name, e);
    this.report.files.forEach((f, i) => {
      f.source = sourceOf(this.sw[i], entries.get(this.urls[i]));
    });
    this.mark("artDone", now);
  }

  file(url: string, start: number, downloaded: number, bytes: number, decoded: number | null, sw: string | null): void {
    if (this.report === null || !this.measuring) return;
    const abs = new URL(url, location.href).href;
    this.urls.push(abs);
    this.sw.push(sw);
    const name = abs.startsWith(this.base) ? abs.slice(this.base.length) : abs;
    this.report.files.push({ name, bytes, source: "不明", start: start - this.t0, downloaded: downloaded - this.t0, decoded: decoded === null ? null : decoded - this.t0 });
    this.onChange?.();
  }

  /**
   * A render of the stage: the first one with the battlefield of the game started since the tap
   * ends the measurement (重來 leaves the old one drawn meanwhile).
   */
  render(start: number, end: number, battlefield: boolean, started: { init: number; ready: number }): boolean {
    if (!battlefield || !this.measuring || !(started.init >= this.t0)) return false;
    if (Number.isFinite(started.init)) this.mark("init", started.init);
    if (Number.isFinite(started.ready)) this.mark("ready", started.ready);
    this.mark("drawn", start);
    this.mark("frame", end);
    return true;
  }
}

/** ?test=1&loadtimes=1: the lines over everything, live while the game loads; a tap folds them to the total. */
export class LoadTimesBox {
  private readonly times: LoadTimes;
  private readonly box: HTMLElement;
  private folded = false;
  private queued = false;

  constructor(times: LoadTimes) {
    this.times = times;
    this.box = document.createElement("pre");
    this.box.className = "load-times";
    this.box.hidden = true;
    this.box.addEventListener("click", () => {
      this.folded = !this.folded;
      this.show();
    });
    document.body.appendChild(this.box);
    times.onChange = () => {
      // At most once a frame, however many files come in.
      if (this.queued) return;
      this.queued = true;
      requestAnimationFrame(() => {
        this.queued = false;
        this.show();
      });
    };
  }

  private show(): void {
    const r = this.times.report;
    this.box.hidden = r === null;
    if (r === null) return;
    const lines = loadLines(r);
    this.box.textContent = this.folded ? (lines.find((l) => l.startsWith("合計")) ?? lines[lines.length - 1]) : lines.join("\n");
  }
}
