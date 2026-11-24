// 量測's breakdown of a frame (the user 2026-11-24 「我用網頁到200兵時畫面會卡卡的」; ceo 2026-11-24: the iPhone measures
// where the time goes, one screenshot): while a measurement's window runs (Lab), the game adds each part's time here;
// off, a part costs one check. Sections are top-level parts of a frame (and of a snapshot's arrival) or parts of the
// drawing ("d." in front); counters count (fog redrawn, units drawn and left off the screen).

let on = false;
let since = 0;
let frames = 0;
let frameMs = 0;
const totals = new Map<string, number>();
const counts = new Map<string, number>();

export interface Profile {
  /** The window, its frames and their mean interval (ms). */
  seconds: number;
  frames: number;
  frameMs: number;
  /** Each section: ms in a second of the window, and ms in a frame on average. */
  sections: { name: string; perSecond: number; perFrame: number }[];
  /** Each counter: in a second, and in a frame. */
  counters: { name: string; perSecond: number; perFrame: number }[];
  /** A frame's interval on average less what this page's own code took in it: the browser's and the GPU's part. */
  outsideMs: number;
}

/** Top-level sections: their sum is this page's own time in a frame. */
export const TOP_SECTIONS = ["snapshot", "draw", "pixi", "hud", "other"] as const;

export const prof = {
  get on(): boolean {
    return on;
  },
  /** The window opens: from nothing. */
  begin(now: number): void {
    on = true;
    since = now;
    frames = 0;
    frameMs = 0;
    totals.clear();
    counts.clear();
  },
  /** The time now when measuring (to pass to add), else 0. */
  t0(): number {
    return on ? performance.now() : 0;
  },
  /** Section `name` took from `t0` till now. */
  add(name: string, t0: number): void {
    // 0: begun while this part ran (its start not taken).
    if (!on || t0 === 0) return;
    totals.set(name, (totals.get(name) ?? 0) + performance.now() - t0);
  },
  count(name: string, n = 1): void {
    if (!on) return;
    counts.set(name, (counts.get(name) ?? 0) + n);
  },
  /**
   * Pixi's render timed: stamps either side of it on `ticker` (Application's render runs at UPDATE_PRIORITY.LOW, -25;
   * these at -24 and -26). Returns the detach.
   */
  aroundRender(ticker: { add(f: () => void, ctx?: unknown, priority?: number): unknown; remove(f: () => void, ctx?: unknown): unknown }): () => void {
    let t = 0;
    const before = () => {
      t = prof.t0();
    };
    const after = () => prof.add("pixi", t);
    ticker.add(before, undefined, -24);
    ticker.add(after, undefined, -26);
    return () => {
      ticker.remove(before);
      ticker.remove(after);
    };
  },
  /** A frame drawn, `dtMs` after the one before. */
  frame(dtMs: number): void {
    if (!on) return;
    frames++;
    frameMs += dtMs;
  },
  /** The window closes: what it saw. */
  end(now: number): Profile {
    on = false;
    const seconds = Math.max(0.001, (now - since) / 1000);
    const f = Math.max(1, frames);
    const per = (m: Map<string, number>) => [...m].map(([name, v]) => ({ name, perSecond: v / seconds, perFrame: v / f })).sort((a, b) => b.perSecond - a.perSecond);
    const own = TOP_SECTIONS.reduce((s, k) => s + (totals.get(k) ?? 0), 0) / f;
    return { seconds, frames, frameMs: frameMs / f, sections: per(totals), counters: per(counts), outsideMs: Math.max(0, frameMs / f - own) };
  },
};
