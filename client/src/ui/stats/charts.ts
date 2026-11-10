// 局後統計's charts (R13-02 A, R14-09; design/r14/common/r14-stats.js): SVG strings, 1 unit = 1 pt, sized to the room
// the page gives them. Colours come from the page's CSS (classes, so each interface and look sets its own): ours a solid
// line with round markers, theirs dashed with square ones, labelled at the line's end, so colour is never alone.

import { TICKS_PER_SECOND } from "../../sim.ts";
import type { WarEvent, WarKind } from "./events.ts";
import type { FightRow, Pt, TownBar } from "./model.ts";

const MIN = 60 * TICKS_PER_SECOND;
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const svg = (w: number, h: number, label: string, body: string) =>
  `<svg class="st-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${body}</svg>`;

/** A side's marker: ours a circle, theirs a square. */
export function marker(who: "me" | "foe", x: number, y: number, r = 4.5): string {
  return who === "me"
    ? `<circle class="st-dot me" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}"/>`
    : `<rect class="st-dot foe" x="${(x - r).toFixed(1)}" y="${(y - r).toFixed(1)}" width="${r * 2}" height="${r * 2}"/>`;
}

/** The legend's line and marker for a side (also before 我方／敵方 in tables). */
export function keyLine(who: "me" | "foe"): string {
  return `<svg class="st-key" width="30" height="12" viewBox="0 0 30 12" aria-hidden="true"><line class="st-line ${who}" x1="1" y1="6" x2="29" y2="6"/>${marker(who, 15, 6, 4)}</svg>`;
}

/** A round step for an axis up to `max` in about `n` steps (1, 2, 2.5, 5 × 10ⁿ). */
export function niceStep(max: number, n = 4): number {
  if (max <= 0) return 1;
  const raw = max / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

/**
 * The value axis: its top just over the data, in steps of 1, 2, 2.5 or 5 × 10ⁿ (about 4 of them); on a short chart
 * (932 × 336) every other line, so the numbers keep apart and the top stays where it was (ui 2026-11-07: 6,465 →
 * 0／4,000／8,000, not 0／5,000／10,000 with a third of the chart empty; 82 → 0／50／100).
 */
export function valueAxis(top: number, height: number): { step: number; ymax: number } {
  let step = niceStep(top);
  const ymax = Math.max(step, Math.ceil(top / step) * step);
  const most = Math.max(2, Math.min(4, Math.floor(height / 24)));
  let lines = Math.round(ymax / step);
  while (lines > most && lines % 2 === 0) {
    step *= 2;
    lines /= 2;
  }
  return { step, ymax };
}

const WAR_CLASS: Record<WarKind, string> = { 進攻: "raid", 防守: "defend", 團戰: "battle" };

/** 戰事標記 (R17-03): a mark at (x, y), 進攻 ▲, 防守 a shield, 團戰 ●; `on`: the one picked (gold). */
export function warMark(kind: WarKind, x: number, y: number, on = false): string {
  const c = `st-wm ${WAR_CLASS[kind]}${on ? " on" : ""}`;
  const f = (n: number) => n.toFixed(1);
  if (kind === "進攻") return `<path class="${c}" d="M${f(x)} ${f(y - 5)}L${f(x + 5)} ${f(y + 4)}L${f(x - 5)} ${f(y + 4)}Z"/>`;
  if (kind === "防守") return `<path class="${c}" d="M${f(x - 4.5)} ${f(y - 4.5)}H${f(x + 4.5)}V${f(y)}Q${f(x + 4.5)} ${f(y + 3.5)} ${f(x)} ${f(y + 5.5)}Q${f(x - 4.5)} ${f(y + 3.5)} ${f(x - 4.5)} ${f(y)}Z"/>`;
  return `<circle class="${c}" cx="${f(x)}" cy="${f(y)}" r="4.2"/>`;
}

/** The marks in a row at `y`, where each began; crowded they lie over each other, the picked one on top. */
function warMarks(X: (t: number) => number, y: number, events: readonly WarEvent[], picked: number | null): string {
  const g = events.map((e, i) => (i === picked ? "" : warMark(e.kind, X(e.from), y)));
  if (picked !== null && events[picked] !== undefined) g.push(warMark(events[picked].kind, X(events[picked].from), y, true));
  return `<g class="st-wmarks">${g.join("")}</g>`;
}

/** The small legend at the end of a chart's legend row (R17-03): 進攻 ▲, 防守, 團戰 ●. */
export function warKey(): string {
  return (["進攻", "防守", "團戰"] as const).map((k) => `<span class="st-lg"><svg class="st-wk" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">${warMark(k, 6, 6)}</svg>${k}</span>`).join("");
}

/** Where a chart's time axis runs: from `left` to its width less `right` (a tap's time, page.ts). */
export const LINE_SPAN = { left: 46, right: 96 } as const;
export const TOWNS_SPAN = { left: 84, right: 12 } as const;
/** Room under the time axis for the marks' row. */
const WAR_ROW = 14;

/** The numbered rings over a chart where the moments were (1, 2, …), and their thin lines down. */
function momentMarks(X: (t: number) => number, top: number, bottom: number, moments: readonly number[]): string {
  return moments
    .map(
      (t, i) =>
        `<line class="st-mline" x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${top - 2}" y2="${bottom}"/>` +
        `<circle class="st-mring" cx="${X(t).toFixed(1)}" cy="${top - 11}" r="9"/><text class="st-t st-bold" x="${X(t).toFixed(1)}" y="${top - 7}" text-anchor="middle" font-size="12">${i + 1}</text>`,
    )
    .join("");
}

/** The time axis' labels (0:00, 5:00, …) every `step` minutes. */
function timeLabels(X: (t: number) => number, y: number, ticks: number, step: number, grid?: [number, number]): string {
  const out: string[] = [];
  for (let m = 0; m * MIN <= ticks; m += step) {
    if (grid !== undefined) out.push(`<line class="st-grid" x1="${X(m * MIN).toFixed(1)}" x2="${X(m * MIN).toFixed(1)}" y1="${grid[0]}" y2="${grid[1]}"/>`);
    out.push(`<text class="st-tm st-num" x="${X(m * MIN).toFixed(1)}" y="${y}" text-anchor="middle" font-size="12">${m}:00</text>`);
  }
  return out.join("");
}

export interface Series {
  who: "me" | "foe";
  name: string;
  pts: readonly Pt[];
}

/**
 * Two lines over the game's time (累計採集, 士兵數): the value axis on the left, the time under, the moments' rings on
 * top, each line's last value written at its end (pushed apart when close); `peak`: each side's most, marked.
 */
export function lineChart(o: { w: number; h: number; ticks: number; axisMinutes: number; series: readonly Series[]; moments: readonly number[]; unit?: string; peak?: boolean; label: string; events?: readonly WarEvent[]; picked?: number | null }): string {
  const { w, h, ticks } = o;
  const war = (o.events?.length ?? 0) > 0;
  const L = LINE_SPAN.left;
  const R = LINE_SPAN.right;
  const T = 24;
  const B = 24 + (war ? WAR_ROW : 0);
  const pw = Math.max(40, w - L - R);
  const ph = Math.max(30, h - T - B);
  const top = Math.max(0, ...o.series.flatMap((s) => s.pts.map((p) => p[1])));
  const { step, ymax } = valueAxis(top, ph);
  const X = (t: number) => L + (ticks > 0 ? t / ticks : 0) * pw;
  const Y = (v: number) => T + ph - (v / ymax) * ph;
  const g: string[] = [];
  for (let v = 0; v <= ymax + 1e-9; v += step) {
    g.push(`<line class="st-grid" x1="${L}" x2="${L + pw}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/>`);
    g.push(`<text class="st-tm st-num" x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" font-size="12">${fmt(v)}</text>`);
  }
  g.push(timeLabels(X, h - 6, ticks, o.axisMinutes));
  g.push(`<line class="st-axis" x1="${L}" x2="${L + pw}" y1="${Y(0)}" y2="${Y(0)}"/>`);
  g.push(momentMarks(X, T, Y(0), o.moments));
  if (war) g.push(warMarks(X, Y(0) + 9, o.events ?? [], o.picked ?? null));
  const ends: { y: number; y0: number; text: string }[] = [];
  for (const s of o.series) {
    if (s.pts.length === 0) continue;
    const d = s.pts.map((p, i) => `${i === 0 ? "M" : "L"}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join("");
    g.push(`<path class="st-line ${s.who}" d="${d}"/>`);
    const [lt, lv] = s.pts[s.pts.length - 1];
    g.push(marker(s.who, X(lt), Y(lv)));
    ends.push({ y: Y(lv), y0: Y(lv), text: `${s.name} ${fmt(lv)}${o.unit ?? ""}` });
    if (o.peak === true) {
      const [pt, pv] = s.pts.reduce<Pt>((a, p) => (p[1] > a[1] ? p : a), s.pts[0]);
      // Only where the most was not the end (the end says it already).
      if (pv > 0 && pt < lt - 30 * TICKS_PER_SECOND) {
        const dx = s.who === "me" ? -8 : 8;
        g.push(marker(s.who, X(pt), Y(pv), 3.5));
        g.push(`<text class="st-t st-bold" x="${(X(pt) + dx).toFixed(1)}" y="${(Y(pv) - 8).toFixed(1)}" text-anchor="${s.who === "me" ? "end" : "start"}" font-size="12">最多 ${fmt(pv)}</text>`);
      }
    }
  }
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].y - ends[i - 1].y < 17) {
      const mid = (ends[i].y + ends[i - 1].y) / 2;
      ends[i - 1].y = mid - 8.5;
      ends[i].y = mid + 8.5;
    }
  }
  for (const e of ends) {
    if (Math.abs(e.y - e.y0) > 2) g.push(`<path class="st-lead" d="M${L + pw + 6} ${e.y0.toFixed(1)} L${L + pw + 10} ${e.y.toFixed(1)}"/>`);
    g.push(`<text class="st-t st-bold st-num" x="${L + pw + 12}" y="${(e.y + 4.5).toFixed(1)}" font-size="13">${esc(e.text)}</text>`);
  }
  return svg(w, h, o.label, g.join(""));
}

/** 擊殺與損失: a row a kind, ours lost to the left of its name, theirs we killed to the right, each with its number. */
export function butterfly(o: { w: number; h: number; rows: readonly FightRow[]; label: string }): string {
  const { w, h, rows } = o;
  const mid = w / 2;
  const lab = 34;
  const gap = 8;
  const rowH = Math.min(34, (h - 8) / Math.max(1, rows.length));
  const bar = Math.min(16, rowH - 6);
  const max = Math.max(1, ...rows.flatMap((r) => [r.lost, r.killed]));
  const half = mid - lab - gap - 34;
  const x0 = mid - lab - gap;
  const x1 = mid + lab + gap;
  const g: string[] = [];
  rows.forEach((r, i) => {
    const y = 4 + i * rowH + rowH / 2;
    const la = (r.lost / max) * half;
    const lb = (r.killed / max) * half;
    g.push(`<text class="st-t st-bold" x="${mid}" y="${(y + 4.5).toFixed(1)}" text-anchor="middle" font-size="13">${esc(r.name)}</text>`);
    if (r.lost > 0) g.push(`<rect class="st-bar me" x="${(x0 - la).toFixed(1)}" y="${(y - bar / 2).toFixed(1)}" width="${la.toFixed(1)}" height="${bar}" rx="3"/>`);
    if (r.killed > 0) g.push(`<rect class="st-bar foe" x="${x1}" y="${(y - bar / 2).toFixed(1)}" width="${lb.toFixed(1)}" height="${bar}" rx="3"/>`);
    g.push(`<text class="st-t st-num" x="${(x0 - la - 6).toFixed(1)}" y="${(y + 4.5).toFixed(1)}" text-anchor="end" font-size="13">${r.lost}</text>`);
    g.push(`<text class="st-t st-num" x="${(x1 + lb + 6).toFixed(1)}" y="${(y + 4.5).toFixed(1)}" font-size="13">${r.killed}</text>`);
  });
  const bottom = 4 + rows.length * rowH;
  g.push(`<line class="st-axis" x1="${x0}" x2="${x0}" y1="2" y2="${bottom}"/><line class="st-axis" x1="${x1}" x2="${x1}" y1="2" y2="${bottom}"/>`);
  return svg(w, h, o.label, g.join(""));
}

/** 城鎮易手: a bar a town over the game's time, its segments (whose, plundered, ruins, neutral) and 治／搶／叛 rings. */
export function townsChart(o: { w: number; h: number; ticks: number; axisMinutes: number; bars: readonly TownBar[]; moments: readonly number[]; label: string; events?: readonly WarEvent[]; picked?: number | null }): string {
  const { w, h, ticks, bars } = o;
  const war = (o.events?.length ?? 0) > 0;
  const L = TOWNS_SPAN.left;
  const R = TOWNS_SPAN.right;
  const T = 26;
  const B = 22 + (war ? WAR_ROW : 0);
  const pw = Math.max(40, w - L - R);
  const rowH = (h - T - B) / Math.max(1, bars.length);
  const bh = Math.max(10, Math.min(22, rowH - 14));
  const X = (t: number) => L + (ticks > 0 ? t / ticks : 0) * pw;
  const g: string[] = [
    `<defs><pattern id="st-ruin" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect class="st-ruin-a" width="6" height="6"/><line class="st-ruin-b" x1="0" y1="0" x2="0" y2="6"/></pattern></defs>`,
  ];
  g.push(timeLabels(X, h - 6, ticks, o.axisMinutes, [T - 4, h - B]));
  g.push(momentMarks(X, T, h - B, o.moments));
  bars.forEach((b, i) => {
    const y = T + i * rowH + (rowH - bh) / 2 + 4;
    g.push(`<text class="st-t st-bold" x="0" y="${(y + bh / 2 + (b.note === "" ? 4.5 : 0)).toFixed(1)}" font-size="13">${esc(b.name)}</text>`);
    if (b.note !== "") g.push(`<text class="st-tm" x="0" y="${(y + bh / 2 + 15).toFixed(1)}" font-size="12">${esc(b.note)}</text>`);
    for (const s of b.segments) {
      const x = X(s.from) + 1;
      const ww = Math.max(0, X(Math.min(s.to, ticks)) - X(s.from) - 2);
      const cls = s.kind === "ruin" ? "st-seg ruin" : `st-seg ${s.kind}${s.who === null ? "" : ` ${s.who}`}`;
      g.push(`<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${ww.toFixed(1)}" height="${bh}" rx="3"${s.kind === "ruin" ? ' fill="url(#st-ruin)"' : ""}/>`);
      if (s.label !== "" && ww > s.label.length * 13 + 10) g.push(`<text class="${s.kind === "neutral" ? "st-t2" : "st-on"} st-bold" x="${(x + 6).toFixed(1)}" y="${(y + bh / 2 + 4.5).toFixed(1)}" font-size="12">${esc(s.label)}</text>`);
    }
    for (const e of b.events) {
      g.push(`<g transform="translate(${X(e.tick).toFixed(1)} ${(y - 1).toFixed(1)})"><circle class="st-evr ${e.who}" r="10"/><text class="st-t st-bold" y="4.5" text-anchor="middle" font-size="12">${e.mark}</text></g>`);
    }
  });
  if (war) g.push(warMarks(X, h - B + 8, o.events ?? [], o.picked ?? null));
  return svg(w, h, o.label, g.join(""));
}
