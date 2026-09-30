// The prototype's interface shell (GDD §10 草稿; temporary, not an approved design): resource
// bar, minimap, selection info, command area, control groups 1–4 and 全軍 on the right,
// 閒置農民 and 全體回城 on the left, attack alerts, 經濟分配, 搶／治理, the menu and the result
// screen. Text updates at most 10 times a second and only when it changed.

import type { Game } from "../../game/game.ts";
import { pressable } from "../../input/pressable.ts";
import { type GameStats, HeaderField as H, type SimEvent, TownChoice, TownSize, UnitType } from "../../sim.ts";
import { TILE_PX } from "../../tuning.ts";
import { FIXED_TO_PX } from "../../view/view.ts";
import { adjustRatio, type Ratio } from "./economy-ratio.ts";
import { Minimap } from "./minimap.ts";
import { BUILDING_NAME, clock, GAME_OVER_REASON } from "./names.ts";
import { CommandArea, ResourceBar, SelectionInfo } from "./panels.ts";

const UPDATE_MS = 100;
const ALERT_MS = 6000;
/** Attacks closer than this (cells) to a live alert refresh it instead of adding another. */
const ALERT_MERGE_CELLS = 8;
const MAX_ARROWS = 3;

export interface HudLifecycle {
  restart(): void;
  toStart(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== "") e.className = cls;
  if (text !== "") e.textContent = text;
  parent.appendChild(e);
  return e;
}

function btn(parent: HTMLElement, text: string, onTap: (() => void) | null, cls = ""): HTMLButtonElement {
  const b = el("button", parent, cls, text);
  b.type = "button";
  if (onTap !== null) b.addEventListener("click", onTap);
  return b;
}

interface Alert {
  wx: number;
  wy: number;
  until: number;
  arrow: HTMLButtonElement | null;
}

export class Hud {
  private readonly game: Game;
  private readonly life: HudLifecycle;
  private readonly res: ResourceBar;
  private readonly minimap: Minimap;
  private readonly info: SelectionInfo;
  private readonly cmds: CommandArea;
  private readonly recallBtn: HTMLButtonElement;
  private readonly idleBtn: HTMLButtonElement;
  private readonly groupBtns: HTMLButtonElement[] = [];
  readonly groups: number[][] = [[], [], [], []];
  private idleIndex = 0;
  private lastUpdate = 0;
  private alerts: Alert[] = [];
  private readonly arrowLayer: HTMLElement;
  private readonly dialog: HTMLElement;
  private econ: (Ratio & { on: boolean }) | null = null;
  private readonly cleanups: (() => void)[] = [];

  constructor(root: HTMLElement, game: Game, controlsBar: HTMLElement, life: HudLifecycle) {
    this.game = game;
    this.life = life;
    this.res = new ResourceBar(root);

    const menu = btn(controlsBar, "選單", () => this.openMenu(), "secondary");
    menu.setAttribute("aria-haspopup", "dialog");

    const left = el("div", root, "side-left");
    this.recallBtn = btn(left, "全體回城", () => this.toggleRecall(), "secondary");
    this.idleBtn = el("button", left, "idle-btn", "閒置 0");
    this.idleBtn.type = "button";
    this.cleanups.push(
      pressable(this.idleBtn, {
        tap: () => this.nextIdle(),
        longPress: () => this.allIdle(),
      }),
    );

    const right = el("div", root, "side-right");
    const grid = el("div", right, "groups");
    for (let i = 0; i < 4; i++) {
      const b = el("button", grid, "group-btn secondary", `${i + 1}`);
      b.type = "button";
      b.setAttribute("aria-label", `編隊 ${i + 1}：點一下選取，點兩下跳過去，長按存成編隊`);
      this.cleanups.push(
        pressable(b, {
          tap: (count) => this.recallGroup(i, count === 2),
          longPress: () => this.saveGroup(i),
        }),
      );
      this.groupBtns.push(b);
    }
    btn(right, "全軍", () => this.selectArmy(), "army-btn secondary");

    const host = {
      view: () => game.view,
      mode: () => game.mode,
      command: (cmd: Parameters<Game["command"]>[0]) => game.command(cmd),
      setMode: (m: Parameters<Game["setMode"]>[0]) => game.setMode(m),
      startPlacement: (t: Parameters<Game["startPlacement"]>[0]) => game.startPlacement(t),
      openEconomy: () => this.openEconomy(),
      chooseTown: (town: number, choice: TownChoice) => this.chooseTown(town, choice),
      selectOnly: (units: number[]) => game.apply([{ kind: "select", units }]),
    };
    this.minimap = new Minimap(root, {
      view: () => game.view,
      visible: () => game.camera?.visible() ?? null,
      tap: (x, y) => game.minimapTap(x, y),
      longPress: (x, y) => game.minimapLongPress(x, y),
      alerts: () => this.alerts.map((a) => ({ cx: Math.floor(a.wx / TILE_PX), cy: Math.floor(a.wy / TILE_PX) })),
    });
    this.info = new SelectionInfo(root, host);
    this.cmds = new CommandArea(root, host);
    this.arrowLayer = el("div", root, "alert-arrows");
    this.dialog = el("div", root, "dialog");
    this.dialog.setAttribute("role", "dialog");
    this.dialog.hidden = true;
  }

  destroy(): void {
    for (const c of this.cleanups) c();
  }

  /** Every frame: text at most 10 times a second; alert arrows follow the camera. */
  frame(now: number): void {
    this.minimap.update(now);
    this.drawArrows(now);
    if (now - this.lastUpdate < UPDATE_MS) return;
    this.lastUpdate = now;
    const view = this.game.view;
    const h = view?.header;
    this.res.update(view);
    if (h !== null && h !== undefined) {
      const recall = h[H.recall] === 1;
      const label = recall ? "回去工作" : "全體回城";
      if (this.recallBtn.textContent !== label) this.recallBtn.textContent = label;
      this.recallBtn.classList.toggle("active", recall);
    }
    const idle = view?.curr?.snap.idleFarmers.length ?? 0;
    const idleText = `閒置 ${idle}`;
    if (this.idleBtn.textContent !== idleText) this.idleBtn.textContent = idleText;
    this.idleBtn.classList.toggle("has-idle", idle > 0);
    for (let i = 0; i < 4; i++) {
      const alive = this.alive(this.groups[i]).length;
      const text = alive > 0 ? `${i + 1}·${alive}` : `${i + 1}`;
      if (this.groupBtns[i].textContent !== text) this.groupBtns[i].textContent = text;
    }
    this.info.update();
    this.cmds.update();
  }

  onEvent(ev: SimEvent): void {
    const me = this.game.view?.me ?? 0;
    switch (ev.k) {
      case "attacked":
        this.addAlert(ev.x * FIXED_TO_PX, ev.y * FIXED_TO_PX);
        break;
      case "town_captured":
        if (ev.by === me) this.openTownChoice(ev.town);
        else this.game.toast("敵方攻下了一座城鎮");
        break;
      case "town_plundered":
        this.game.toast(ev.by === me ? `搶完了：糧 ${ev.food}、金 ${ev.gold}、魔晶 ${ev.crystal}` : "敵方搶完了一座城鎮");
        break;
      case "town_repaired":
        this.game.toast(ev.by === me ? "城鎮修繕完成，開始產出" : "敵方的城鎮修繕完成");
        break;
      case "town_revolted":
        this.game.toast(ev.from === me ? "駐軍不足，城鎮叛離了" : "敵方的城鎮叛離了");
        break;
      case "building_done":
        this.game.toast(`${BUILDING_NAME[ev.type] ?? "建築"}蓋好了`);
        break;
      case "mage_killed":
        this.game.toast(ev.owner === me ? "我方法師陣亡" : `擊殺敵方法師，得到魔晶 ${ev.crystal}`);
        break;
      default:
        break;
    }
  }

  // --- side buttons -----------------------------------------------------------------

  private alive(ids: number[]): number[] {
    const view = this.game.view;
    return view === null ? [] : ids.filter((id) => view.unitRow(id) >= 0);
  }

  private toggleRecall(): void {
    const on = this.game.view?.header?.[H.recall] === 1;
    this.game.command({ c: "recall", on: !on });
  }

  /** 閒置農民, tap: select the next idle farmer and look at it. */
  private nextIdle(): void {
    const view = this.game.view;
    const idle = view?.curr?.snap.idleFarmers;
    if (view === null || idle === undefined || idle.length === 0) {
      this.game.toast("沒有閒置的農民");
      return;
    }
    this.idleIndex = (this.idleIndex + 1) % idle.length;
    const id = idle[this.idleIndex];
    this.game.apply([{ kind: "select", units: [id] }]);
    const o = view.unitRow(id);
    if (o >= 0) {
      const p = view.unitPos(o);
      this.game.camera?.centerOn(p.x, p.y);
    }
  }

  /** 閒置農民, long press: select every idle farmer. */
  private allIdle(): void {
    const idle = this.game.view?.curr?.snap.idleFarmers;
    if (idle === undefined || idle.length === 0) {
      this.game.toast("沒有閒置的農民");
      return;
    }
    this.game.apply([{ kind: "select", units: [...idle].sort((a, b) => a - b) }]);
  }

  /** 編隊, tap: select it; double tap: also look at it. */
  private recallGroup(i: number, jump: boolean): void {
    const alive = this.alive(this.groups[i]);
    if (alive.length === 0) {
      this.game.toast(`編隊 ${i + 1} 是空的：選好部隊後長按這顆按鈕存起來`);
      return;
    }
    this.game.apply([{ kind: "select", units: alive }]);
    const view = this.game.view;
    if (!jump || view === null) return;
    let x = 0;
    let y = 0;
    for (const id of alive) {
      const p = view.unitPos(view.unitRow(id));
      x += p.x;
      y += p.y;
    }
    this.game.camera?.centerOn(x / alive.length, y / alive.length);
  }

  /** 編隊, long press: store the selected units. */
  private saveGroup(i: number): void {
    const units = this.game.view?.selection.units ?? [];
    if (units.length === 0) {
      this.game.toast("先選部隊，再長按編隊按鈕");
      return;
    }
    this.groups[i] = [...units];
    this.game.toast(`已存成編隊 ${i + 1}（${units.length} 個）`);
  }

  /** 全軍: every own military unit on the map. */
  private selectArmy(): void {
    const view = this.game.view;
    if (view === null) return;
    const all = view.ownUnitsIn(-Infinity, -Infinity, Infinity, Infinity).filter((u) => u.type === UnitType.Spearman || u.type === UnitType.Ranged || u.type === UnitType.Mage);
    if (all.length === 0) {
      this.game.toast("還沒有軍隊");
      return;
    }
    this.game.apply([{ kind: "select", units: all.map((u) => u.id).sort((a, b) => a - b) }]);
  }

  // --- attack alerts (GDD §10: 小地圖閃爍，畫面邊緣出現箭頭，點箭頭就跳過去) -------------

  private addAlert(wx: number, wy: number): void {
    const now = performance.now();
    const near = this.alerts.find((a) => Math.hypot(a.wx - wx, a.wy - wy) < ALERT_MERGE_CELLS * TILE_PX);
    if (near !== undefined) {
      near.until = now + ALERT_MS;
      return;
    }
    this.alerts.push({ wx, wy, until: now + ALERT_MS, arrow: null });
  }

  private drawArrows(now: number): void {
    const cam = this.game.camera;
    for (const a of this.alerts) {
      if (a.until <= now) {
        a.arrow?.remove();
        a.arrow = null;
      }
    }
    this.alerts = this.alerts.filter((a) => a.until > now);
    if (cam === null) return;
    let shown = 0;
    for (const a of this.alerts) {
      const s = cam.worldToScreen(a.wx, a.wy);
      const w = cam.width;
      const h = cam.height;
      const inside = s.x >= 0 && s.y >= 0 && s.x <= w && s.y <= h;
      if (inside || shown >= MAX_ARROWS) {
        a.arrow?.remove();
        a.arrow = null;
        continue;
      }
      shown++;
      if (a.arrow === null) {
        const b = btn(this.arrowLayer, "", () => {
          this.game.camera?.centerOn(a.wx, a.wy);
          a.until = 0;
        }, "alert-arrow");
        b.setAttribute("aria-label", "有東西被攻擊：點一下跳過去");
        el("span", b, "", "➤");
        a.arrow = b;
      }
      // Where the line from the screen centre to the attack leaves the screen, kept inside a margin.
      const cx = w / 2;
      const cy = h / 2;
      const dx = s.x - cx;
      const dy = s.y - cy;
      const m = 56;
      const k = Math.min((cx - m) / Math.max(Math.abs(dx), 1e-6), (cy - m) / Math.max(Math.abs(dy), 1e-6));
      const x = cx + dx * k;
      const y = cy + dy * k;
      a.arrow.style.transform = `translate(${x - 26}px, ${y - 26}px)`;
      (a.arrow.firstElementChild as HTMLElement).style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    }
  }

  // --- dialogs ----------------------------------------------------------------------

  private openDialog(title: string, cls: string): HTMLElement {
    this.dialog.replaceChildren();
    this.dialog.className = `dialog ${cls}`;
    this.dialog.hidden = false;
    this.dialog.setAttribute("aria-label", title);
    const card = el("div", this.dialog, "dialog-card");
    el("h2", card, "", title);
    return card;
  }

  closeDialog(): void {
    this.dialog.hidden = true;
    this.dialog.replaceChildren();
  }

  get dialogOpen(): boolean {
    return !this.dialog.hidden;
  }

  private openMenu(): void {
    const card = this.openDialog("選單", "menu");
    const list = el("div", card, "dialog-buttons column");
    btn(list, "量測與確定性檢查", () => {
      this.closeDialog();
      this.game.lab.show();
    }, "secondary");
    btn(list, "重來（開新的一局）", () => {
      this.closeDialog();
      this.life.restart();
    }, "secondary");
    btn(list, "投降", () => this.confirmSurrender(), "secondary");
    btn(list, "回開局畫面", () => {
      this.closeDialog();
      this.life.toStart();
    }, "secondary");
    btn(list, "關閉", () => this.closeDialog());
  }

  private confirmSurrender(): void {
    const card = this.openDialog("確定投降？", "menu");
    el("p", card, "", "投降就輸了這一局。");
    const row = el("div", card, "dialog-buttons");
    btn(row, "投降", () => {
      this.closeDialog();
      this.game.command({ c: "surrender" });
    }, "danger");
    btn(row, "取消", () => this.closeDialog(), "secondary");
  }

  openEconomy(): void {
    const h = this.game.view?.header;
    if (h === null || h === undefined) return;
    this.econ = { food: h[H.ratioFood], wood: h[H.ratioWood], gold: h[H.ratioGold], on: h[H.ratioOn] === 1 };
    this.drawEconomy();
  }

  private drawEconomy(): void {
    const e = this.econ;
    if (e === null) return;
    const card = this.openDialog("經濟分配", "economy");
    el("p", card, "small", "新生和閒下來的農民，會自動去目前人數最不夠的資源。晶脈不會自動派，要自己派。");
    const rows: [keyof Ratio, string][] = [
      ["food", "糧"],
      ["wood", "木"],
      ["gold", "金"],
    ];
    for (const [key, name] of rows) {
      const row = el("div", card, "ratio-row");
      el("span", row, "ratio-name", name);
      btn(row, "−", () => {
        this.econ = { ...adjustRatio(e, key, -1), on: e.on };
        this.drawEconomy();
      }, "secondary").setAttribute("aria-label", `${name}少一點`);
      el("span", row, "ratio-value", `${e[key]}%`);
      btn(row, "+", () => {
        this.econ = { ...adjustRatio(e, key, 1), on: e.on };
        this.drawEconomy();
      }, "secondary").setAttribute("aria-label", `${name}多一點`);
    }
    const toggle = btn(card, e.on ? "自動分配：開" : "自動分配：關", () => {
      this.econ = { ...e, on: !e.on };
      this.drawEconomy();
    }, "secondary");
    toggle.classList.toggle("active", e.on);
    const row = el("div", card, "dialog-buttons");
    btn(row, "套用", () => {
      this.game.command({ c: "eco_ratio", food: e.food, wood: e.wood, gold: e.gold, on: e.on });
      this.closeDialog();
    });
    btn(row, "取消", () => this.closeDialog(), "secondary");
  }

  /** GDD §5: 城鎮被攻下時，畫面會跳出兩個大按鈕：搶或治理. */
  private openTownChoice(town: number): void {
    const size = this.game.view?.map.towns.find((t) => t.id === town)?.size;
    const big = size === TownSize.Large;
    const card = this.openDialog(`攻下${big ? "大城" : "小鎮"}！搶還是治理？`, "town-choice");
    const row = el("div", card, "choice-row");
    const plunder = btn(row, "", () => this.chooseTown(town, TownChoice.Plunder), "choice-plunder");
    el("b", plunder, "", "搶");
    el("span", plunder, "", `部隊留下搶 ${big ? 25 : 15} 秒，拿一大筆糧、金、魔晶；城鎮變成廢墟 4 分鐘`);
    const govern = btn(row, "", () => this.chooseTown(town, TownChoice.Govern), "choice-govern");
    el("b", govern, "", "治理");
    el("span", govern, "", `投入金和木修繕 ${big ? 60 : 45} 秒，之後每分鐘產出、加人口；要留兵駐守`);
    btn(card, "稍後再決定（點城鎮也能選）", () => this.closeDialog(), "secondary later");
  }

  chooseTown(town: number, choice: TownChoice): void {
    this.game.command({ c: "town_choice", town, choice });
    this.closeDialog();
  }

  /** The result screen (GDD §14). */
  showResult(winner: number, reason: number, stats: GameStats): void {
    const me = this.game.view?.me ?? 0;
    const title = winner === -1 ? "平手" : winner === me ? "勝利" : "失敗";
    const card = this.openDialog(title, `result ${winner === me ? "won" : winner === -1 ? "draw" : "lost"}`);
    el("p", card, "", `${GAME_OVER_REASON[reason] ?? ""}　遊戲時間 ${clock(stats.ticks)}`);
    const table = el("table", card, "stats");
    const head = el("tr", table);
    for (const t of ["", "我方", "敵方"]) el("th", head, "", t);
    const p = stats.perPlayer;
    const other = me === 0 ? 1 : 0;
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const rows: [string, (i: number) => string][] = [
      ["採集", (i) => `糧 ${p[i].gathered.food}、木 ${p[i].gathered.wood}、金 ${p[i].gathered.gold}、魔晶 ${p[i].gathered.crystal}`],
      ["訓練", (i) => `${sum(p[i].unitsTrained)}`],
      ["損失", (i) => `${sum(p[i].unitsLost)}`],
      ["法師（訓練／陣亡）", (i) => `${p[i].magesTrained}／${p[i].magesLost}`],
      ["城鎮（搶／治理）", (i) => `${p[i].townsPlundered}／${p[i].townsGoverned}`],
    ];
    if (p.length >= 2) {
      for (const [name, f] of rows) {
        const tr = el("tr", table);
        el("th", tr, "", name);
        el("td", tr, "", f(me));
        el("td", tr, "", f(other));
      }
    }
    const row = el("div", card, "dialog-buttons");
    btn(row, "重來", () => {
      this.closeDialog();
      this.life.restart();
    });
    btn(row, "回開局畫面", () => {
      this.closeDialog();
      this.life.toStart();
    }, "secondary");
  }
}
