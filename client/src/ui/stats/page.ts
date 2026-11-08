// 局後統計 (R13-02 A 分頁, D-125; R6's look R14-09, D-129; b2 2026-11-07): the result screen when the game sends its
// timeline. The header (勝利／失敗／平手, why, the time, the opponent and the map, 回開局畫面 and 重來), six tabs down
// the left (總覽、資源、兵力、戰鬥、城鎮、法師) and one page beside them, a chart a page. Both interfaces have it
// (D-127: in the prototype's colours until the formal one is the default); the lines in R6-24's player colours.
// Where the six tabs do not fit under the header (932 × 336, Safari with its tab bar), measured, not by device, they run
// down the card's whole height with the header beside them (the user 2026-11-07: 「那些頁面標籤都跑到上方了」; D-125's
// tabs are on the left). Only on a screen shorter still (card inner under 6 × 44 + 5 × 2: at the iPhone's safe area 21,
// under 330) they go in a row under the header.

import { butterfly, keyLine, lineChart, townsChart } from "./charts.ts";
import { RESOURCE_NAME, type ResourceKey, type StatsModel } from "./model.ts";
import { clock } from "../hud/names.ts";
import { icon } from "../icons.ts";

export const STATS_TABS = ["總覽", "資源", "兵力", "戰鬥", "城鎮", "法師"] as const;
export type StatsTab = (typeof STATS_TABS)[number];

export interface StatsPageHooks {
  restart(): void;
  home(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== "") e.className = cls;
  if (text !== "") e.textContent = text;
  parent.appendChild(e);
  return e;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export class StatsPage {
  readonly card: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly page: HTMLElement;
  private readonly tabButtons = new Map<StatsTab, HTMLButtonElement>();
  private tab: StatsTab = "總覽";
  private res: ResourceKey = "food";
  private readonly onResize = () => this.fit();
  private readonly m: StatsModel;
  private readonly formal: boolean;

  constructor(host: HTMLElement, m: StatsModel, formal: boolean, hooks: StatsPageHooks) {
    this.m = m;
    this.formal = formal;
    this.card = el("div", host, formal ? "stats-card panel" : "stats-card");
    const head = el("div", this.card, "st-head");
    el("h2", head, `st-word ${m.head.result}`, m.head.title);
    const why = el("div", head, "st-why");
    el("b", why, "", m.head.reason);
    why.append(`　遊戲時間 ${m.head.time}`);
    el("small", why, "", `對手：${m.head.foe}　地圖：${m.head.map}`);
    const go = el("div", head, "st-go");
    this.button(go, "回開局畫面", false, hooks.home);
    this.button(go, "重來", true, hooks.restart);

    this.tabs = el("div", this.card, "st-tabs");
    this.tabs.setAttribute("role", "tablist");
    this.tabs.setAttribute("aria-label", "局後統計");
    for (const t of STATS_TABS) {
      const b = this.button(this.tabs, t, false, () => this.show(t));
      b.classList.add("st-tab");
      b.id = `st-tab-${STATS_TABS.indexOf(t)}`;
      b.setAttribute("role", "tab");
      b.setAttribute("aria-controls", "st-page");
      this.tabButtons.set(t, b);
    }
    this.page = el("div", this.card, "st-page");
    this.page.id = "st-page";
    this.page.setAttribute("role", "tabpanel");
    this.page.addEventListener("scroll", () => this.showMore(), { passive: true });
    window.addEventListener("resize", this.onResize);
    this.show("總覽");
  }

  destroy(): void {
    window.removeEventListener("resize", this.onResize);
  }

  /** A button in the interface's look: 重來 and the chosen tab the main (gold) one, the rest plain. */
  private button(parent: HTMLElement, text: string, main: boolean, onTap: () => void): HTMLButtonElement {
    const b = el("button", parent, "", text);
    b.type = "button";
    this.tone(b, main);
    b.addEventListener("click", onTap);
    return b;
  }

  private tone(b: HTMLButtonElement, main: boolean): void {
    // Set here, not by the dialog's dressing (which makes every button of a dialog the main one but 取消-like ones).
    if (this.formal) {
      b.classList.add("b");
      b.classList.toggle("pri", main);
    } else b.classList.toggle("secondary", !main);
  }

  /** Open a tab. */
  show(t: StatsTab): void {
    this.tab = t;
    for (const [name, b] of this.tabButtons) {
      const on = name === t;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;
      this.tone(b, on);
    }
    this.page.setAttribute("aria-labelledby", this.tabButtons.get(t)?.id ?? "");
    this.fit();
  }

  /** Lay out: the tabs under the header if they fit there, else down the card's whole height, else in a row; then the page, its chart sized to the room left. */
  fit(): void {
    const over = () => this.tabs.scrollHeight > this.tabs.clientHeight + 1;
    this.card.classList.remove("tabs-tall", "tabs-row");
    if (over()) {
      this.card.classList.add("tabs-tall");
      if (over()) this.card.classList.replace("tabs-tall", "tabs-row");
    }
    this.draw();
  }

  private draw(): void {
    // A page that scrolls keeps a strip at its right for the ⌄ (b2 2026-11-07: in the middle it sat on the right
    // column's first word), and is laid out again that much narrower.
    this.page.classList.remove("has-more");
    this.drawPage();
    if (this.page.scrollHeight > this.page.clientHeight + 2) {
      this.page.classList.add("has-more");
      this.drawPage();
    }
    this.addMore();
  }

  /**
   * More below (932 × 336: 總覽, 戰鬥, 城鎮, 法師; ui 2026-11-07, as the 軍團畫面's of PR 5): a fade at the foot of the
   * page, opaque at the bottom over the row it cuts, and a ⌄ in it that scrolls down; gone at the end. The ⌄ in the
   * strip kept free at the page's right (`.has-more`), over no words; no buttons down there either (資源's are at its top).
   */
  private addMore(): void {
    const p = this.page;
    const more = el("div", p, "st-more");
    const down = el("button", more, "st-more-btn");
    down.type = "button";
    down.dataset.plain = "";
    down.setAttribute("aria-label", "往下捲");
    down.appendChild(icon("unfold"));
    down.addEventListener("click", () => p.scrollBy({ top: Math.max(40, Math.round(p.clientHeight * 0.6)), behavior: "smooth" }));
    this.showMore();
  }

  private showMore(): void {
    const p = this.page;
    const more = p.querySelector<HTMLElement>(":scope > .st-more");
    if (more !== null) more.hidden = p.scrollHeight - p.clientHeight - p.scrollTop <= 2;
  }

  private drawPage(): void {
    const m = this.m;
    const p = this.page;
    p.replaceChildren();
    p.scrollTop = 0;
    const moments = m.moments.map((x) => x.tick);
    const legend = (host: HTMLElement) => {
      const lg = el("div", host, "st-legend");
      lg.innerHTML = `<span class="st-lg">${keyLine("me")}我方</span><span class="st-lg">${keyLine("foe")}敵方</span>`;
    };
    const momentKey = () => {
      if (m.moments.length === 0) return;
      const k = el("div", p, "st-mkey");
      m.moments.forEach((x, i) => {
        const s = el("span", k);
        el("i", s, "", String(i + 1));
        s.append(`${x.title} ${clock(x.tick)}`);
      });
    };
    /** The chart's place (it takes the room the page has left, CSS). */
    const chartHost = (card: HTMLElement) => el("div", card, "st-chart");
    /** Its box, once everything else is in: at least `least` high (the page scrolls then). */
    const boxOf = (host: HTMLElement, least = 96): { w: number; h: number } => {
      const r = host.getBoundingClientRect();
      return { w: Math.max(240, Math.floor(r.width)), h: Math.max(least, Math.floor(r.height)) };
    };
    const ctl = (title: string) => {
      const c = el("div", p, "st-ctl");
      el("h3", c, "", title);
      return c;
    };
    const card = () => el("div", p, "st-cardin");

    switch (this.tab) {
      case "總覽": {
        const two = el("div", p, "st-two");
        const a = el("div", two, "st-col");
        el("h3", a, "", "關鍵時刻");
        const ol = el("ol", a, "st-moments");
        if (m.moments.length === 0) el("li", ol, "st-none", "這局沒有關鍵時刻");
        m.moments.forEach((x, i) => {
          const li = el("li", ol);
          const t = el("span", li, "st-mt");
          el("i", t, "", String(i + 1));
          t.append(clock(x.tick));
          const ev = el("span", li, "st-ev");
          el("b", ev, "", x.title);
          ev.append(x.text);
        });
        const end = el("li", ol, "st-end");
        el("span", end, "st-mt end", m.head.time);
        const ev = el("span", end, "st-ev");
        el("b", ev, "", m.head.reason);
        ev.append(m.head.result === "won" ? "我方勝利" : m.head.result === "lost" ? "我方落敗" : "平手");
        const b = el("div", two, "st-col");
        el("h3", b, "", "雙方數字");
        const table = el("table", b, "st-nums");
        const hr = el("tr", table);
        el("th", hr);
        el("th", hr).innerHTML = `${keyLine("me")}我方`;
        el("th", hr).innerHTML = `${keyLine("foe")}敵方`;
        for (const r of m.numbers) {
          const tr = el("tr", table);
          el("th", tr, "", r.name);
          el("td", tr, "", r.me);
          el("td", tr, "", r.foe);
        }
        return;
      }
      case "資源": {
        const c = ctl(`累計採集：${RESOURCE_NAME[this.res]}`);
        const seg = el("div", c, "st-seg");
        seg.setAttribute("role", "group");
        seg.setAttribute("aria-label", "資源");
        for (const k of m.resourceKeys) {
          const b = this.button(seg, RESOURCE_NAME[k], k === this.res, () => {
            this.res = k;
            this.draw();
          });
          b.setAttribute("aria-pressed", String(k === this.res));
        }
        const cd = card();
        legend(cd);
        const host = chartHost(cd);
        momentKey();
        const r = m.resources[this.res];
        const name = RESOURCE_NAME[this.res];
        host.innerHTML = lineChart({
            ...boxOf(host),
            ticks: m.ticks,
            axisMinutes: m.axisMinutes,
            moments,
            series: [
              { who: "me", name: "我方", pts: r.me },
              { who: "foe", name: "敵方", pts: r.foe },
            ],
            label: `累計採集${name}：我方 ${fmt(r.me.at(-1)?.[1] ?? 0)}、敵方 ${fmt(r.foe.at(-1)?.[1] ?? 0)}`,
          });
        return;
      }
      case "兵力": {
        ctl("士兵數（不含村民）");
        const cd = card();
        legend(cd);
        const host = chartHost(cd);
        momentKey();
        const a = m.army;
        host.innerHTML = lineChart({
            ...boxOf(host),
            ticks: m.ticks,
            axisMinutes: m.axisMinutes,
            moments,
            unit: " 名",
            peak: true,
            series: [
              { who: "me", name: "我方", pts: a.me },
              { who: "foe", name: "敵方", pts: a.foe },
            ],
            label: `士兵數：我方最多 ${a.peak.me[1]} 名（${clock(a.peak.me[0])}）、敵方最多 ${a.peak.foe[1]} 名（${clock(a.peak.foe[0])}）；最後我方 ${a.me.at(-1)?.[1] ?? 0} 名、敵方 ${a.foe.at(-1)?.[1] ?? 0} 名`,
          });
        return;
      }
      case "戰鬥": {
        ctl("擊殺與損失（各兵種）");
        const cd = card();
        const h = el("div", cd, "st-bfhead");
        h.innerHTML = `<span>${keyLine("me")}我方損失 <b>${m.fight.lost}</b></span><span class="c">兵種</span><span>我方擊殺 <b>${m.fight.killed}</b>${keyLine("foe")}</span>`;
        const host = chartHost(cd);
        host.innerHTML = butterfly({ ...boxOf(host, 24 * m.fight.rows.length + 8), rows: m.fight.rows, label: m.fight.rows.map((r) => `${r.name}：我方損失 ${r.lost}、我方擊殺 ${r.killed}`).join("；") });
        return;
      }
      case "城鎮": {
        ctl("城鎮易手");
        if (m.towns.length === 0) {
          el("p", p, "st-none", "這局沒有城鎮易手");
          return;
        }
        const cd = card();
        const host = chartHost(cd);
        const lg = el("div", cd, "st-tlg");
        lg.innerHTML =
          '<span class="st-lg"><i class="st-sw me"></i>我方</span><span class="st-lg"><i class="st-sw foe"></i>敵方</span>' +
          '<span class="st-lg"><i class="st-sw neutral"></i>中立</span><span class="st-lg"><i class="st-sw ruin"></i>廢墟</span>' +
          '<span class="st-lg"><i class="st-sw repair"></i>修繕中（淡色）</span>' +
          '<span class="st-lg"><i class="st-evk">治</i>治理</span><span class="st-lg"><i class="st-evk">搶</i>搶</span><span class="st-lg"><i class="st-evk">叛</i>叛離</span>' +
          '<span class="st-lg muted">圓圈的框色＝誰做的</span>';
        momentKey();
        host.innerHTML = townsChart({ ...boxOf(host, (m.towns.some((b) => b.note !== "") ? 36 : 26) * m.towns.length + 48), ticks: m.ticks, axisMinutes: m.axisMinutes, moments, bars: m.towns, label: m.towns.map((b) => `${b.name}：${b.events.map((e) => `${clock(e.tick)} ${e.who === "me" ? "我方" : "敵方"}${e.mark === "治" ? "治理" : e.mark === "搶" ? "搶" : "叛離"}`).join("、") || "沒有變化"}`).join("；") });
        return;
      }
      case "法師": {
        ctl("法師戰績");
        const cd = card();
        const grid = el("div", cd, "st-mages");
        const row = (k: string, a: string, b: string, cls = "") => {
          const r = el("div", grid, `st-mr ${cls}`);
          el("span", r, "st-mk").innerHTML = k;
          el("span", r, "st-mv").innerHTML = a;
          el("span", r, "st-mv").innerHTML = b;
        };
        const g = m.mages;
        row("", `${keyLine("me")}我方`, `${keyLine("foe")}敵方`, "st-mh");
        row("訓練", `${g.me.trained}`, `${g.foe.trained}`);
        row("陣亡", `${g.me.lost}`, `${g.foe.lost}`);
        row("晶砲發數", `${g.me.shots}`, `${g.foe.shots}`);
        row("晶砲擊殺", `${g.me.kills}`, `${g.foe.kills}`);
        const best = (b: typeof g.me.best) => (b === null ? "—" : `${b.kills} 名<small>（${clock(b.tick)}）</small>`);
        row("一發最多", best(g.me.best), best(g.foe.best));
        if (g.bestNote !== "") el("p", p, "st-foot", g.bestNote);
        return;
      }
    }
  }
}
