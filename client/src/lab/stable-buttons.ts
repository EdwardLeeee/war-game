// 按鈕不動 (the user 2026-11-27 on TestFlight 0.1.0 (4): 「你app需要驗證每個按鈕跟加減法，兵按加號減號還是會框框跳動」;
// ceo 2026-11-27, D-155: the button under the finger never moves, and what comes and goes never pushes it): every
// button of every panel tapped, the ones pressed again and again (− +, 訓練, 買賣…) ten times in a row, and while it
// goes on, every button's place measured; and what each tap should do checked where it is known.
//
// The page drives itself (the test page only, ?test=1&mock=1&stable=1; loaded by main.ts): it says where to tap next on
// one line of text, and whoever runs it taps there for real (Playwright's touchscreen in e2e/app-buttons.spec.ts; the
// app's XCUITest in iOS's simulator, war-game-mobile, mobile/stable-buttons). The line (#stable-buttons, rewritten
// only when it changes: XCUITest may miss text rewritten under it):
//   stable-buttons {"step":3,"total":40,"next":{"seq":7,"id":"…","x":512.5,"y":300,"times":10,"gap":150},"moved":[…5],
//                   "movedCount":0,"pressed":0,"miss":0,"bad":0,"errors":0,"ok":true,"done":false}
//   step, next {x, y, times, gap} (CSS px from the screen's top left: XCUITest's points), done and ok keep their names
//   and meaning (mobile reads only those); ok: nothing moved, no tap landed elsewhere, no reaction wrong, no error.
//   next.seq grows by one each time: a runner taps a next once, then waits for null or another seq (the same place may
//   be asked twice in a row: a building's panel opened again).
// A second line, #stable-detail ("stable-detail {…}"), each step's full record, written as each step ends.
// Everything also on window.__stableButtons (Playwright reads it).
//
// What counts as moved: a button there when the step began, still there, whose place (its layout's, transforms left
// out; and as seen, transforms in) changed by more than 1 px. The button tapped is judged by its layout only: its own
// pressed look (R6-25-01: 3 px down in 主題 A, 95 % in B) is the design's (ceo 2026-11-27). Buttons that come or go
// are not moves. Panels and the legion's texts are measured too and reported, not judged (what moved beside it).

import { adjustRatio, type Ratio } from "../ui/hud/economy-ratio.ts";
import { VILLAGER_MAX, VILLAGER_STEP } from "../game/auto-army.ts";
import { MOCK_RULES } from "../mock/mock-port.ts";

/** What the runner taps next: `times` taps `gap` ms apart at (x, y). */
interface Next {
  /** Grows by one each time a tap is asked for (the same id may come twice: a building tapped again). */
  seq: number;
  id: string;
  x: number;
  y: number;
  times: number;
  gap: number;
}

interface Move {
  step: number;
  /** The button tapped. */
  tapped: string;
  key: string;
  kind: "layout" | "seen" | "size";
  dx: number;
  dy: number;
  /** Judged (a button, its screen the same) or only reported (a panel, a text, or after the tap changed the screen). */
  judged: boolean;
  /** The tap had changed the screen (context()) when it moved. */
  otherScreen?: boolean;
}

interface StepRecord {
  step: number;
  scene: string;
  id: string;
  label: string;
  times: number;
  setup: boolean;
  missed: string[];
  /** Taps after the button was gone (nothing left to cancel…): noted, not misses. */
  gone: string[];
  /** The tap changed the screen (another panel or dialog): what moved then is reported, not judged. */
  otherScreen: boolean;
  moved: Move[];
  /** The tapped button's own largest move as seen (its pressed look). */
  pressed: number;
  /**
   * Why (the first time a button moved in this step): what in its panel was not as at the step's start, each part as
   * "-" then and "+" now (tag.class, top, height, its own words): a line that came, a text that grew…
   */
  why: string[];
  /** exact: checked against what it should come to; changed: only that something one sees changed. */
  reaction: "ok" | "bad" | "unknown";
  reactionKind: "exact" | "changed" | "none";
  reactionNote: string;
}

interface Results {
  line: Record<string, unknown>;
  steps: StepRecord[];
  pressedList: { scene: string; label: string; times: number }[];
  notPressed: { scene: string; label: string; reason: string }[];
  noReaction: { scene: string; label: string; reason: string }[];
  /** Checked only that something one sees changed (not what it should be). */
  changedOnly: { scene: string; label: string }[];
  errors: string[];
  done: boolean;
}

declare global {
  interface Window {
    __stableButtons?: Results;
  }
}

type Hook = NonNullable<NonNullable<Window["__proto"]>["game"]>;

const REPEAT = 10;
const GAP_MS = 150;
/** After the last tap, measured this long more (what a tap sets off comes after it). */
const AFTER_MS = 1000;
const MOVE_PX = 1;
/** A step not tapped in this long is given up (a runner gone, a tap that never came). */
const STEP_TIMEOUT_MS = 60_000;

/** Pressed again and again: − and +, 訓練, 買賣, 叫 1 名, 取消訓練, 村民目標. */
const REPEATED = /^(多要|少要) 1 名|^村民目標(多|少)|^(糧|木|金)(多|少)一點|^訓練|^取消訓練|^買 |^賣 |^叫 1 名/;

/** Not tapped, and why (they end or leave the game, or start another). */
const NOT_TAPPED: [RegExp, string][] = [
  [/^重來/, "會結束這一局、開新局"],
  [/^回開局畫面/, "會離開這一局"],
  [/^新手教學/, "會離開這一局、開新手教學"],
  [/^量測/, "會另開一局量測"],
  [/^確定性檢查/, "會跑很久的檢查，不是玩家的按鈕"],
  [/^更新/, "會重新載入頁面"],
];

const results: Results = { line: {}, steps: [], pressedList: [], notPressed: [], noReaction: [], changedOnly: [], errors: [], done: false };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
const visible = (e: Element) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden";
const labelOf = (e: Element) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim().replace(/\s+/g, " ");
const norm = (s: string) => s.replace(/[0-9]+/g, "#").slice(0, 48);
const hook = (): Hook => {
  const g = window.__proto?.game;
  if (g === undefined) throw new Error("no game");
  return g;
};

/** The two lines, each rewritten only when it changes. */
function writeLines(detail?: StepRecord): void {
  const put = (id: string, text: string) => {
    let el = document.getElementById(id);
    if (el === null) {
      el = document.createElement("div");
      el.id = id;
      el.style.cssText = "position:fixed;left:0;bottom:0;max-width:40vw;font:9px/1.1 monospace;color:#fff;background:rgba(0,0,0,0.5);pointer-events:none;z-index:99999;white-space:nowrap;overflow:hidden";
      if (id === "stable-detail") el.style.bottom = "12px";
      document.body.appendChild(el);
    }
    if (el.textContent !== text) {
      el.textContent = text;
      el.setAttribute("aria-label", text);
    }
  };
  put("stable-buttons", `stable-buttons ${JSON.stringify(results.line)}`);
  if (detail !== undefined) put("stable-detail", `stable-detail ${JSON.stringify(detail)}`);
}

let stepNo = 0;
let seq = 0;
let planned = 0;
const counts = { movedCount: 0, pressedPx: 0, miss: 0, bad: 0 };
function setLine(next: Next | null, done = false): void {
  const moved = results.steps.flatMap((s) => s.moved.filter((m) => m.judged)).slice(0, 5);
  results.line = {
    step: stepNo,
    total: Math.max(planned, stepNo),
    next,
    moved,
    movedCount: counts.movedCount,
    pressed: counts.pressedPx,
    miss: counts.miss,
    bad: counts.bad,
    errors: results.errors.length,
    ok: counts.movedCount === 0 && counts.miss === 0 && counts.bad === 0 && results.errors.length === 0,
    done,
  };
  results.done = done;
  writeLines();
}

// --- measuring ------------------------------------------------------------------------------------------------

const dialogTitle = () => document.querySelector(".dialog:not([hidden])")?.getAttribute("aria-label") ?? "";
/**
 * Where the player is: what is selected, the dialog open, the panel open or folded, the lab. A tap that changes it
 * (another panel, another dialog) lays out another screen: what moves then is not a button moving under a finger, and
 * is reported, not judged.
 */
function context(): string {
  const sel = hook().selection();
  return JSON.stringify([sel.building, sel.units.length > 0, dialogTitle(), document.querySelector(".sel-info")?.className ?? "", document.querySelector("section.lab:not([hidden])") !== null]);
}

/** What is measured: every button, the panels and the legion's texts (only buttons judged). */
const MEASURED = "button, .sel-info, .sel-bar, .dialog-card, .sel-info > *, .sel-info .group-actions, .sel-info .group-places > *, .sel-info .group-row, .sel-info .group-type, .sel-info .group-has, .sel-info .group-want, .sel-info .sel-head, .sel-info .group-places, .sel-info .sel-more, .sel-info .queue";
const PANELS = ".dialog, .sel-info, .sel-bar, .cmds, .groups, .controls, .res-bar, .lab, #hud";

interface Place {
  lx: number;
  ly: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  button: boolean;
}

function keyOf(e: HTMLElement, count: Map<string, number>): string {
  const panel = e.closest(PANELS);
  const where = panel === null ? "?" : panel.matches(".dialog") ? `dialog:${panel.getAttribute("aria-label") ?? ""}` : panel.id !== "" ? `#${panel.id}` : (panel.className.toString().split(" ")[0] ?? "?");
  const what = e.matches("button") ? norm(labelOf(e)) : `${e.tagName.toLowerCase()}.${e.className.toString().split(" ")[0]} ${norm(e.closest(".group-row")?.querySelector(".group-type")?.textContent ?? "")}`;
  const k = `${where}|${what}`;
  const n = count.get(k) ?? 0;
  count.set(k, n + 1);
  return `${k}|${n}`;
}

function placeOf(e: HTMLElement): Place {
  let lx = 0;
  let ly = 0;
  for (let n: HTMLElement | null = e; n !== null; n = n.offsetParent as HTMLElement | null) {
    lx += n.offsetLeft;
    ly += n.offsetTop;
  }
  const r = e.getBoundingClientRect();
  return { lx, ly, vx: r.x, vy: r.y, w: e.offsetWidth, h: e.offsetHeight, button: e.matches("button") };
}

function placesNow(): Map<string, { el: HTMLElement; at: Place }> {
  const out = new Map<string, { el: HTMLElement; at: Place }>();
  const count = new Map<string, number>();
  for (const e of document.querySelectorAll<HTMLElement>(MEASURED)) {
    if (!visible(e) || e.closest("#stable-buttons, #stable-detail") !== null) continue;
    out.set(keyOf(e, count), { el: e, at: placeOf(e) });
  }
  return out;
}

/**
 * Watches from now till stop(): each change to the page (a MutationObserver's callback comes before the next paint, so
 * every state that could be painted is read), each pointer event and each frame (WebKit drawing in software at 3 has a
 * few a second). Those there at the start, compared with where they were.
 */
/** A panel's parts, one line each: path, top, height, width and its own words (numbers kept). */
function outline(root: Element): string[] {
  const out: string[] = [];
  const walk = (e: Element, path: string, depth: number) => {
    if (!visible(e)) return;
    const r = e.getBoundingClientRect();
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent?.trim() ?? "").join("").slice(0, 24);
    const me = `${path}/${e.tagName.toLowerCase()}.${e.className.toString().split(" ").filter((c) => c !== "is-pressed").join(".")}`;
    out.push(`${me} y${Math.round(r.y)} h${Math.round(r.height)} w${Math.round(r.width)} ${own}`);
    if (depth < 7) [...e.children].forEach((c, i) => walk(c, `${me}[${i}]`, depth + 1));
  };
  walk(root, "", 0);
  return out;
}
const panelsNow = () => [...document.querySelectorAll(".sel-info, .sel-bar, .dialog-card")].filter(visible);

/** Two outlines' differences, at most 24 lines ("-" then, "+" now). */
function outlineDiff(a: string[], b: string[]): string[] {
  const sa = new Set(a);
  const sb = new Set(b);
  return [...a.filter((l) => !sb.has(l)).map((l) => `- ${l}`), ...b.filter((l) => !sa.has(l)).map((l) => `+ ${l}`)].slice(0, 24);
}

function watch(step: number, tapped: string, tappedKey: string): { stop: () => { moved: Move[]; pressed: number; otherScreen: boolean; why: string[] } } {
  const base = placesNow();
  const baseOutline = panelsNow().flatMap(outline);
  let why: string[] = [];
  const ctx0 = context();
  let ctxChanged = false;
  const worst = new Map<string, Move>();
  let pressed = 0;
  let on = true;
  const sample = () => {
    if (!on) return;
    const other = context() !== ctx0;
    if (other) ctxChanged = true;
    for (const [k, now] of placesNow()) {
      const b = base.get(k);
      if (b === undefined) continue;
      const a = b.at;
      const n = now.at;
      const mine = k === tappedKey;
      const layout = { dx: n.lx - a.lx, dy: n.ly - a.ly };
      const seen = { dx: +(n.vx - a.vx).toFixed(2), dy: +(n.vy - a.vy).toFixed(2) };
      const size = { dx: n.w - a.w, dy: n.h - a.h };
      if (mine && !other) pressed = Math.max(pressed, Math.abs(seen.dx), Math.abs(seen.dy));
      for (const [kind, d] of [
        ["layout", layout],
        ["seen", seen],
        ["size", size],
      ] as const) {
        if (mine && kind === "seen") continue;
        const v = Math.max(Math.abs(d.dx), Math.abs(d.dy));
        if (v <= MOVE_PX) continue;
        const w = worst.get(`${kind}|${k}`);
        const judged = a.button && kind !== "size" && !other;
        if (judged && why.length === 0) why = outlineDiff(baseOutline, panelsNow().flatMap(outline));
        // A judged move is kept over a bigger one on another screen.
        if (w === undefined || (judged && !w.judged) || (judged === w.judged && v > Math.max(Math.abs(w.dx), Math.abs(w.dy)))) worst.set(`${kind}|${k}`, { step, tapped, key: k, kind, dx: d.dx, dy: d.dy, judged, ...(other ? { otherScreen: true } : {}) });
      }
    }
  };
  const mo = new MutationObserver(sample);
  mo.observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "disabled"] });
  const onEvent = () => queueMicrotask(sample);
  const types = ["pointerdown", "pointerup", "click", "touchstart", "touchend"];
  for (const t of types) document.addEventListener(t, onEvent, true);
  const loop = () => {
    if (!on) return;
    sample();
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return {
    stop: () => {
      sample();
      on = false;
      mo.disconnect();
      for (const t of types) document.removeEventListener(t, onEvent, true);
      return { moved: [...worst.values()], pressed, otherScreen: ctxChanged, why };
    },
  };
}

// --- reactions --------------------------------------------------------------------------------------------------

interface Reaction {
  /** exact: the number or state it should come to; changed: only that something one sees changed (listed apart). */
  kind: "exact" | "changed";
  before: () => unknown;
  /** "" when right, else what was wrong. */
  after: (before: unknown, times: number) => string;
}

/** Buttons visible now (in #hud and dialogs), by label with numbers as #. */
const labelsNow = () => [...document.querySelectorAll<HTMLButtonElement>("button")].filter((b) => visible(b) && b.closest("#stable-buttons, #stable-detail, #start") === null).map((b) => norm(labelOf(b)));
const hasLabel = (re: RegExp) => [...document.querySelectorAll<HTMLButtonElement>("button")].some((b) => visible(b) && re.test(labelOf(b)));
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** What one sees, coarsely: the screen (context()), the buttons, which are on, paused and speed, the groups. */
function seenState(): string {
  const g = hook();
  const h = g.header();
  const on = [...document.querySelectorAll<HTMLButtonElement>("button.active, button[aria-pressed=true], button.is-active")].filter(visible).map((b) => norm(labelOf(b)));
  return JSON.stringify({ ctx: context(), labels: labelsNow(), on, paused: h.paused, speed: h.speed, groups: g.groupInfo().map((x) => [x.ids.length, x.want, x.refill]) });
}

const exact = (before: () => unknown, after: (b: unknown, n: number) => string): Reaction => ({ kind: "exact", before, after });

const numberIn = (sel: string): number | null => {
  const t = document.querySelector(sel)?.textContent ?? "";
  const m = /-?[0-9]+/.exec(t);
  return m === null ? null : Number(m[0]);
};

function ratioNow(): Ratio | null {
  const vals = [...document.querySelectorAll(".dialog .ratio-row .ratio-value")].map((e) => Number(/[0-9]+/.exec(e.textContent ?? "")?.[0] ?? "NaN"));
  return vals.length === 3 && vals.every((v) => Number.isFinite(v)) ? { food: vals[0], wood: vals[1], gold: vals[2] } : null;
}

/** What a tap on this button should do, where it is known. */
function reactionFor(label: string, el: HTMLElement): Reaction | string {
  let m = /^(多要|少要) 1 名(.+)$/.exec(label);
  if (m !== null) {
    const sel = `.sel-info [aria-label="${m[2]}要幾名"]`;
    const by = m[1] === "多要" ? 1 : -1;
    return exact(
      () => numberIn(sel),
      (b, n) => {
        const want = Math.max(0, (b as number) + by * n);
        const got = numberIn(sel);
        return got === want ? "" : `${m?.[2]}要幾名：${String(b)} 按 ${n} 下應該是 ${want}，看到 ${String(got)}`;
      },
    );
  }
  m = /^村民目標(多|少) /.exec(label);
  if (m !== null) {
    const sel = '.sel-info [aria-label="村民目標幾名"]';
    const by = m[1] === "多" ? 1 : -1;
    return exact(
      () => numberIn(sel),
      (b, n) => {
        let want = b as number;
        for (let i = 0; i < n; i++) want = Math.min(VILLAGER_MAX, Math.max(0, want + by * VILLAGER_STEP));
        const got = numberIn(sel);
        return got === want ? "" : `村民目標：${String(b)} 按 ${n} 下應該是 ${want}，看到 ${String(got)}`;
      },
    );
  }
  m = /^(糧|木|金)(多|少)一點$/.exec(label);
  if (m !== null) {
    const key = ({ 糧: "food", 木: "wood", 金: "gold" } as const)[m[1] as "糧" | "木" | "金"];
    const by = m[2] === "多" ? 1 : -1;
    return exact(
      () => ratioNow(),
      (b, n) => {
        if (b === null) return "看不到比例";
        let want = b as Ratio;
        for (let i = 0; i < n; i++) want = adjustRatio(want, key, by);
        const got = ratioNow();
        return got !== null && got.food === want.food && got.wood === want.wood && got.gold === want.gold ? "" : `比例：${JSON.stringify(b)} 按 ${n} 下應該是 ${JSON.stringify(want)}，看到 ${JSON.stringify(got)}`;
      },
    );
  }
  if (/^訓練/.test(label)) {
    // The longest the queue got while tapped: the fake world trains one in 3 s, so the first may be out by the end.
    const queue = () => document.querySelectorAll('.sel-info .queue-item[aria-label^="取消訓練"]').length;
    let most = 0;
    let timer = 0;
    return exact(
      () => {
        most = queue();
        timer = window.setInterval(() => (most = Math.max(most, queue())), 20);
        return most;
      },
      (b, n) => {
        clearInterval(timer);
        const want = Math.min((b as number) + n, MOCK_RULES.queueMax);
        return most === want ? "" : `佇列：${String(b)} 個按 ${n} 下最多應該到 ${want} 個，最多看到 ${most}`;
      },
    );
  }
  if (/^取消訓練/.test(label)) {
    const queue = () => document.querySelectorAll('.sel-info .queue-item[aria-label^="取消訓練"]').length;
    return exact(
      () => queue(),
      (b, n) => {
        const want = Math.max(0, (b as number) - n);
        return queue() === want ? "" : `佇列：${String(b)} 個取消 ${n} 下應該剩 ${want} 個，看到 ${queue()}`;
      },
    );
  }
  m = /^(買|賣) 100 (糧|木|金)/.exec(label);
  if (m !== null) {
    const key = ({ 糧: "food", 木: "wood", 金: "gold" } as const)[m[2] as "糧" | "木" | "金"];
    const buy = m[1] === "買";
    return exact(
      () => hook().resources()[key],
      (b, n) => {
        const got = hook().resources()[key];
        const d = got - (b as number);
        return (buy ? d >= 100 * n : d <= -100 * n) ? "" : `${m?.[2]}：按 ${n} 下應該${buy ? "多" : "少"} ${100 * n}，看到 ${d > 0 ? "+" : ""}${d}`;
      },
    );
  }
  m = /^只選(.+)$/.exec(label);
  if (m !== null) {
    const name = m[1];
    return exact(
      () => null,
      () => {
        const sel = hook().selection().units;
        const names = new Set(sel.map((id) => hook().units().find((u) => u.id === id)?.type));
        return sel.length > 0 && names.size === 1 ? "" : `只選${name}：選到 ${sel.length} 名、${names.size} 種`;
      },
    );
  }
  if (label === "暫停" || label === "繼續") {
    const want = label === "暫停";
    return exact(
      () => null,
      () => (hook().header().paused === want ? "" : `應該${want ? "暫停" : "繼續"}，表頭寫 paused=${String(hook().header().paused)}`),
    );
  }
  if (label === "取消選取") return exact(() => null, () => (hook().selection().units.length === 0 && hook().selection().building === null ? "" : "應該什麼都沒選，還有選著的"));
  if (label === "關閉" && el.closest(".dialog") !== null) return exact(() => dialogTitle(), (b) => (dialogTitle() !== b ? "" : `「${String(b)}」應該關掉，還開著`));
  m = /^編隊 ([0-9]+)：/.exec(label);
  if (m !== null) {
    const n = m[1];
    return exact(() => null, () => (document.querySelector(".sel-info .sel-head")?.textContent?.includes(`編隊 ${n}`) === true ? "" : `應該打開編隊 ${n} 的軍團畫面`));
  }
  if (/^全軍 [0-9]+$/.test(label)) return exact(() => null, () => (hook().selection().units.length > 0 ? "" : "應該選到全軍"));
  if (/^閒置 [0-9]+/.test(label)) return exact(() => null, () => (hook().selection().units.length === 1 ? "" : `應該選到一名閒置的村民，選到 ${hook().selection().units.length} 名`));
  if (label === "清空") return exact(() => null, () => (hook().groupInfo().some((g) => g.ids.length === 0 && Object.values(g.want).every((v) => v === 0)) ? "" : "應該有一個編隊清空"));
  if (/^改成剛才選的/.test(label)) return exact(() => null, () => (hook().groupInfo().some((g) => g.ids.length > 0) ? "" : "編隊應該有兵"));
  // A mode or a setting turned on: its 取消… comes, or its words flip (開 ↔ 關, 暫停, 收起 ↔ 展開…).
  const FLIPS: [RegExp, RegExp][] = [
    [/^攻擊地面或敵人$/, /^取消攻擊/],
    [/^取消攻擊/, /^攻擊地面或敵人$/],
    [/^移動點地面$/, /^取消移動/],
    [/^取消移動/, /^移動點地面$/],
    [/^進駐點建築$/, /^取消進駐$/],
    [/^取消進駐$/, /^進駐點建築$/],
    [/^集結點$/, /^取消集結點$/],
    [/^取消集結點$/, /^集結點$/],
    [/^收起選取資訊$/, /^展開選取資訊$/],
    [/^展開選取資訊$/, /^收起選取資訊$/],
  ];
  const flip = FLIPS.find(([a]) => a.test(label));
  if (flip !== undefined) return exact(() => null, () => (hasLabel(flip[1]) ? "" : `按了應該出現「${flip[1].source.replace(/[\^$]/g, "")}」，沒有`));
  m = /^(.+)：(開|關|暫停)$/.exec(label) ?? /^(.+目前)：(開|暫停)$/.exec(label);
  if (m !== null) {
    const head = m[1];
    const was = m[2];
    return exact(() => null, () => (hasLabel(new RegExp(`^${escape(head)}：(?!${was}$)`)) ? "" : `「${label}」按了應該換成另一種，還是一樣`));
  }
  if (el.getAttribute("aria-haspopup") === "dialog" || /^(選單|兵種相剋|設定|投降|經濟分配|預留)/.test(label)) {
    return exact(
      () => dialogTitle(),
      (b) => (dialogTitle() !== "" && dialogTitle() !== b ? "" : `應該打開對話框，${dialogTitle() === "" ? "沒有" : `還是「${dialogTitle()}」`}`),
    );
  }
  // Else: that something one sees changed (listed as checked only so far).
  return { kind: "changed", before: () => seenState(), after: (b) => (seenState() !== b ? "" : "按了以後看得到的東西都沒變") };
}

// --- the scenes ---------------------------------------------------------------------------------------------------

/** The runner taps (x, y) `times` times: resolves when it has, or with the taps' misses. */
async function tapStep(id: string, x: number, y: number, times: number, gap: number, target: HTMLElement | null): Promise<{ missed: string[]; gone: string[]; timedOut: boolean }> {
  const missed: string[] = [];
  const goneTaps: string[] = [];
  let got = 0;
  const up = (e: Event) => {
    got++;
    if (target !== null) {
      const hit = (e.target instanceof Element ? e.target.closest("button") : null) as HTMLElement | null;
      const same = hit === target || (hit !== null && norm(labelOf(hit)) === norm(labelOf(target)));
      // Gone by then (the queue empty, nothing left to cancel; a panel the taps closed): not a miss, noted.
      const gone = !target.isConnected || !visible(target);
      if (!same) (gone ? goneTaps : missed).push(`第 ${got} 下點到 ${hit === null ? `${(e.target as Element | null)?.tagName ?? "?"}.${String((e.target as Element | null)?.className ?? "")}` : labelOf(hit)}${gone ? "（按鈕已經不在）" : ""}`);
    }
  };
  document.addEventListener("pointerup", up, true);
  // next is null a moment before it comes again, so a runner waiting for null after its taps sees it.
  await sleep(250);
  setLine({ seq: ++seq, id, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, times, gap });
  const t0 = performance.now();
  while (got < times && performance.now() - t0 < STEP_TIMEOUT_MS) await sleep(30);
  document.removeEventListener("pointerup", up, true);
  setLine(null);
  return { missed, gone: goneTaps, timedOut: got < times };
}

/** Closes what is open over the battlefield (a dialog, the lab panel), back to normal speed, unpaused, nothing selected. */
async function calm(): Promise<void> {
  for (let i = 0; i < 4; i++) {
    const d = document.querySelector<HTMLElement>(".dialog:not([hidden])");
    if (d === null) break;
    const close = [...d.querySelectorAll<HTMLButtonElement>("button")].find((b) => /^(關閉|取消|稍後再決定|知道了|✕)$/.test(labelOf(b)) || b.getAttribute("aria-label") === "關閉");
    if (close === undefined) break;
    close.click();
    await frame();
  }
  const lab = document.querySelector<HTMLElement>('section.lab:not([hidden])');
  [...(lab?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find((b) => labelOf(b) === "關閉")?.click();
  const g = hook();
  // A mode left on (攻擊, 移動, 進駐, 集結點, a building being placed): its 取消, or a tap on a building would set a rally
  // point or an order instead of opening it.
  for (let i = 0; i < 4 && g.mode() !== "normal"; i++) {
    const cancel = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => visible(b) && /^取消(攻擊|移動|進駐|集結點|$)|^✕$|^取消放置/.test(labelOf(b)) && b.closest(".dialog") === null);
    if (cancel === undefined) break;
    cancel.click();
    await frame();
  }
  if (g.header().paused) document.querySelector<HTMLButtonElement>('button[aria-label="繼續"], button[aria-label="暫停"]')?.click();
  g.select([]);
  await frame();
  await frame();
}

interface Scene {
  name: string;
  /** Into it (may ask for a tap: a building on the battlefield), false when it cannot be. */
  enter: () => Promise<boolean>;
  /** Still in it. */
  holds: () => boolean;
  /** Where its buttons are, and what in there is another scene's. */
  roots: () => Element[];
  exclude?: string;
}

const click = (sel: string) => document.querySelector<HTMLElement>(sel)?.click();
/** Why the last scene could not be entered (its reason in notPressed). */
let why = "";
const byLabel = (re: RegExp) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => visible(b) && re.test(labelOf(b)));

/** Our building of `type` (made beside home if none), tapped on the battlefield (a setup tap: not judged). */
function buildingScene(type: number, name: string): Scene {
  let id = -1;
  return {
    name,
    enter: async () => {
      await calm();
      const g = hook();
      let b = g.buildings().find((v) => v.type === type && v.owner === g.me());
      if (b === undefined) {
        const home = g.home() ?? { cx: 20, cy: 70 };
        const spot = g.buildSpotNear(type, home.cx + 5, home.cy + 5);
        if (spot === null) {
          why = "找不到地方蓋";
          return false;
        }
        g.addBuilding(type, spot.x, spot.y);
        for (let i = 0; i < 60 && b === undefined; i++) {
          await sleep(100);
          b = g.buildings().find((v) => v.type === type && v.owner === g.me());
        }
        if (b === undefined) {
          why = "蓋了沒出現";
          return false;
        }
      }
      id = b.id;
      const mid = { x: b.cx + b.size / 2 - 0.5, y: b.cy + b.size / 2 - 0.5 };
      g.centerOn(mid.x, mid.y, 1);
      await sleep(300);
      const at = g.cellToScreen(mid.x, mid.y);
      const t = await tapStep(`setup:${name}`, at.x, at.y, 1, GAP_MS, null);
      for (let i = 0; i < 30 && g.selection().building !== id; i++) await sleep(100);
      if (g.selection().building !== id) why = t.timedOut ? `點${name}沒有人點（逾時）` : `點了${name}（${Math.round(at.x)},${Math.round(at.y)}）沒選到它，選到 ${JSON.stringify(g.selection())}，模式 ${g.mode()}`;
      return g.selection().building === id;
    },
    holds: () => hook().selection().building === id && dialogTitle() === "",
    roots: () => [...document.querySelectorAll(".sel-info, .cmds")],
  };
}

function dialogScene(name: string, open: () => Promise<boolean>): Scene {
  return {
    name,
    enter: async () => {
      await calm();
      return open();
    },
    holds: () => dialogTitle().includes(name),
    roots: () => [...document.querySelectorAll(".dialog:not([hidden])")],
  };
}

const MAIN = 0;
const BUILDINGS: [number, string][] = [
  [MAIN, "主城"],
  [6, "兵營"],
  [15, "市場"],
];

function scenes(): Scene[] {
  const list: Scene[] = [
    {
      name: "戰場（沒選東西）",
      enter: async () => {
        await calm();
        return true;
      },
      holds: () => hook().selection().units.length === 0 && hook().selection().building === null && document.querySelector(".dialog:not([hidden])") === null,
      roots: () => [...document.querySelectorAll("#hud")],
      exclude: ".dialog, .sel-info, .sel-bar, .cmds, .lab",
    },
    {
      name: "全軍",
      enter: async () => {
        await calm();
        click(".army-btn");
        await frame();
        return hook().selection().units.length > 0;
      },
      holds: () => hook().selection().units.length > 0 && dialogTitle() === "" && document.querySelector(".sel-info .group-row") === null,
      roots: () => [...document.querySelectorAll(".sel-bar, .sel-info, .cmds")],
    },
    {
      name: "軍團",
      enter: async () => {
        await calm();
        click(".army-btn");
        await frame();
        click(".groups > button");
        await frame();
        byLabel(/^改成剛才選的/)?.click();
        await frame();
        return document.querySelector(".sel-info .group-row") !== null;
      },
      holds: () => document.querySelector(".sel-info .group-row") !== null && dialogTitle() === "",
      roots: () => [...document.querySelectorAll(".sel-info, .cmds")],
    },
    ...BUILDINGS.map(([t, n]) => buildingScene(t, n)),
    dialogScene("選單", async () => {
      byLabel(/^選單$/)?.click();
      for (let i = 0; i < 40 && dialogTitle() === ""; i++) await sleep(50);
      return dialogTitle() !== "";
    }),
    dialogScene("經濟分配", async () => {
      const s = buildingScene(MAIN, "主城");
      if (!(await s.enter())) return false;
      const b = byLabel(/^經濟分配$/);
      if (b === undefined) {
        why = `主城的面板裡找不到「經濟分配」：${labelsNow().join("、")}`;
        return false;
      }
      b.click();
      for (let i = 0; i < 40 && dialogTitle() === ""; i++) await sleep(50);
      if (dialogTitle() === "") why = "按了經濟分配，沒有打開對話框";
      return dialogTitle() !== "";
    }),
  ];
  return list;
}

/** The buttons in a scene's roots now, in order, by key (the same button made again keeps its key). */
function buttonsIn(scene: Scene): Map<string, HTMLButtonElement> {
  const out = new Map<string, HTMLButtonElement>();
  const count = new Map<string, number>();
  for (const root of scene.roots()) {
    for (const b of root.querySelectorAll<HTMLButtonElement>("button")) {
      if (!visible(b) || (scene.exclude !== undefined && b.closest(scene.exclude) !== null)) continue;
      const k = keyOf(b, count);
      if (!out.has(k)) out.set(k, b);
    }
  }
  return out;
}

// --- the run --------------------------------------------------------------------------------------------------------

async function runScene(scene: Scene): Promise<void> {
  why = "";
  if (!(await scene.enter())) {
    results.notPressed.push({ scene: scene.name, label: "（整個畫面）", reason: `進不去${why === "" ? "" : `：${why}`}` });
    return;
  }
  const done = new Set<string>();
  for (let guard = 0; guard < 200; guard++) {
    if (!scene.holds() && !(await scene.enter())) {
      results.notPressed.push({ scene: scene.name, label: "（之後的按鈕）", reason: `回不到這個畫面${why === "" ? "" : `：${why}`}` });
      return;
    }
    await frame();
    const now = buttonsIn(scene);
    const next = [...now].find(([k]) => !done.has(k));
    if (next === undefined) return;
    const [key, el] = next;
    done.add(key);
    const label = labelOf(el);
    const skip = NOT_TAPPED.find(([re]) => re.test(label));
    if (skip !== undefined) {
      results.notPressed.push({ scene: scene.name, label, reason: skip[1] });
      continue;
    }
    if (el.disabled) {
      results.notPressed.push({ scene: scene.name, label, reason: "現在不能按（灰的）" });
      continue;
    }
    const r = el.getBoundingClientRect();
    const x = r.x + r.width / 2;
    const y = r.y + r.height / 2;
    const top = document.elementFromPoint(x, y)?.closest("button");
    if (top !== el) {
      const what = document.elementFromPoint(x, y);
      results.notPressed.push({ scene: scene.name, label, reason: `被蓋住（中間是 ${top !== null && top !== undefined ? labelOf(top) : `${what?.tagName ?? "?"}.${String(what?.className ?? "")}`}）` });
      continue;
    }
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
      results.notPressed.push({ scene: scene.name, label, reason: "在畫面外" });
      continue;
    }
    const times = REPEATED.test(label) ? REPEAT : 1;
    const reaction = reactionFor(label, el);
    const before = typeof reaction === "string" ? null : reaction.before();
    stepNo++;
    planned = Math.max(planned, stepNo + 1);
    const w = watch(stepNo, norm(label), `${key}`);
    const tap = await tapStep(`${scene.name}:${norm(label)}`, x, y, times, GAP_MS, el);
    await sleep(AFTER_MS);
    const { moved, pressed, otherScreen, why: whyMoved } = w.stop();
    const note = tap.timedOut ? "沒點滿（逾時）" : typeof reaction === "string" ? reaction : reaction.after(before, times);
    const rec: StepRecord = {
      step: stepNo,
      scene: scene.name,
      id: key,
      label,
      times,
      setup: false,
      missed: tap.missed,
      gone: tap.gone,
      otherScreen,
      moved,
      pressed,
      why: whyMoved,
      reaction: typeof reaction === "string" ? "unknown" : note === "" ? "ok" : "bad",
      reactionKind: typeof reaction === "string" ? "none" : reaction.kind,
      reactionNote: note,
    };
    results.steps.push(rec);
    results.pressedList.push({ scene: scene.name, label, times });
    if (typeof reaction === "string") results.noReaction.push({ scene: scene.name, label, reason: reaction });
    else if (reaction.kind === "changed" && rec.reaction === "ok") results.changedOnly.push({ scene: scene.name, label });
    else if (reaction.kind === "changed") results.noReaction.push({ scene: scene.name, label, reason: "不知道該有什麼反應，按了也看不到任何變化" });
    counts.movedCount += moved.filter((m) => m.judged).length;
    counts.pressedPx = Math.max(counts.pressedPx, pressed);
    counts.miss += tap.missed.length + (tap.timedOut ? 1 : 0);
    if (rec.reaction === "bad" && rec.reactionKind === "changed") rec.reaction = "unknown";
    if (rec.reaction === "bad") counts.bad++;
    setLine(null);
    writeLines(rec);
  }
}

/** The run, once the page is the test page with ?stable=1 (main.ts). */
export async function runStableButtons(): Promise<void> {
  // The fake world with a market, at 20 ticks a second (the app opens ./?test=1&mock=1&stable=1): once, as the page loads.
  const q = new URLSearchParams(location.search);
  if (q.get("market") !== "1" || q.get("tps") !== "20") {
    q.set("market", "1");
    q.set("tps", "20");
    location.replace(`${location.pathname}?${q.toString()}${location.hash}`);
    return;
  }
  window.__stableButtons = results;
  window.addEventListener("error", (e) => results.errors.push(`error: ${e.message}`));
  window.addEventListener("unhandledrejection", (e) => results.errors.push(`rejection: ${String(e.reason)}`));
  const error = console.error.bind(console);
  console.error = (...a: unknown[]) => {
    results.errors.push(`console: ${a.map(String).join(" ")}`.slice(0, 300));
    error(...a);
  };
  setLine(null);
  // The game from 開始 (not under test).
  for (let i = 0; i < 600 && document.getElementById("start-game") === null; i++) await sleep(50);
  document.getElementById("start-game")?.click();
  for (let i = 0; i < 1200 && window.__proto?.ready !== true; i++) await sleep(50);
  for (let i = 0; i < 200 && (window.__proto?.game?.header().tick ?? 0) < 5; i++) await sleep(50);
  hook().stock({ food: 99999, wood: 99999, gold: 99999, crystal: 999 });
  const list = scenes();
  planned = list.length;
  for (const s of list) await runScene(s);
  await calm();
  setLine(null, true);
  writeLines(results.steps.at(-1));
}
