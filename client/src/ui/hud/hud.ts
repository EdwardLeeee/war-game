// The prototype's interface shell (GDD §10 草稿; temporary, not an approved design): resource
// bar, minimap, selection info, command area, control groups 1–4 and 全軍 on the right,
// 閒置村民 and 全體回城 on the left, attack alerts, 經濟分配, 搶／治理, the menu and the result
// screen. Text updates at most 10 times a second and only when it changed.

import { counterLines } from "../../game/counters.ts";
import type { Game } from "../../game/game.ts";
import { pressable } from "../../input/pressable.ts";
import { AUTO_TRAIN, BUILDING_STRIDE, BuildingField, BuildingFlag, type GameStats, HeaderField as H, type SimEvent, TownChoice, TownSize } from "../../sim.ts";
import { TILE_PX } from "../../tuning.ts";
import { FIXED_TO_PX } from "../../view/view.ts";
import { adjustRatio, type Ratio } from "./economy-ratio.ts";
import { loadTownHintOff, saveTownHintOff } from "../../hint-pref.ts";
import { Minimap } from "./minimap.ts";
import { armyText, BUILDING_NAME, clock, GAME_OVER_REASON, UNIT_NAME } from "./names.ts";
import { CommandArea, PLUNDERED_TEXT, ResourceBar, SelectionInfo } from "./panels.ts";

const UPDATE_MS = 100;
/** 軍團畫面 asks for at most this many of one type (more than the population cap allows). */
const GROUP_WANT_MAX = 50;
/** px between the resource bar and the top-right buttons. */
const RES_GAP = 8;
const ALERT_MS = 6000;
/** Attacks closer than this (cells) to a live alert refresh it instead of adding another. */
const ALERT_MERGE_CELLS = 8;
const MAX_ARROWS = 3;
/** 開局提示: the minimap keeps flashing the town this long after the hint is closed (ms). */
const TOWN_FLASH_AFTER_MS = 10_000;

export interface HudLifecycle {
  restart(): void;
  toStart(): void;
  /** Start a game of the `perf` scenario that measures itself (量測). */
  perf(): void;
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
  private readonly root: HTMLElement;
  private readonly game: Game;
  private readonly life: HudLifecycle;
  private readonly res: ResourceBar;
  private readonly controlsBar: HTMLElement;
  private readonly armyBtn: HTMLButtonElement;
  private readonly minimap: Minimap;
  /** 開局提示 (D-044): the town the minimap flashes, until when (performance.now ms; Infinity while the hint is open). */
  private flash: { id: number; cx: number; cy: number; radius: number; until: number } | null = null;
  /** Called once when the dialog on screen goes away, however it goes (the hint resumes the game). */
  private dialogGone: (() => void) | null = null;
  /** 收起 (D-054): the selection info shows its title line only, for this game. */
  private collapsed = false;
  /** 自動訓練 stopped by a full population somewhere (D-054), as last seen: told once when it starts. */
  private populationFull = false;
  private readonly info: SelectionInfo;
  private readonly cmds: CommandArea;
  private readonly recallBtn: HTMLButtonElement;
  private readonly idleBtn: HTMLButtonElement;
  private readonly groupBtns: HTMLButtonElement[] = [];
  private idleIndex = 0;
  private lastUpdate = 0;
  private toastAbove = -1;
  private alerts: Alert[] = [];
  private readonly arrowLayer: HTMLElement;
  private readonly dialog: HTMLElement;
  private econ: (Ratio & { on: boolean }) | null = null;
  private readonly cleanups: (() => void)[] = [];

  constructor(root: HTMLElement, game: Game, controlsBar: HTMLElement, life: HudLifecycle) {
    this.root = root;
    this.game = game;
    this.life = life;
    this.res = new ResourceBar(root);
    this.controlsBar = controlsBar;

    const menu = btn(controlsBar, "選單", () => this.openMenu(), "secondary");
    menu.setAttribute("aria-haspopup", "dialog");

    const left = el("div", root, "side-left");
    // 重設 (D-024): one tap back to nothing selected; kept apart from 全體回城 below it.
    btn(left, "重設", () => game.reset(), "reset-btn");
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
      b.setAttribute("aria-label", `編隊 ${i + 1}：點一下選取並打開軍團畫面，點兩下跳過去`);
      // 軍團畫面 (D-054): the tap opens it; the long press that saved the selection is gone
      // (改成剛才選的 N 名 in the panel does that).
      this.cleanups.push(pressable(b, { tap: (count) => game.showGroup(i, count === 2) }));
      this.groupBtns.push(b);
    }
    this.armyBtn = btn(right, armyText(0), () => this.selectArmy(), "army-btn secondary");
    // 全軍撤退 (user 2026-10-01): nothing to select first. Top left, far from 全軍.
    btn(root, "全軍撤退", () => game.retreatAll(), "retreat-all-btn");

    const host = {
      view: () => game.view,
      mode: () => game.mode,
      command: (cmd: Parameters<Game["command"]>[0]) => game.command(cmd),
      setMode: (m: Parameters<Game["setMode"]>[0]) => game.setMode(m),
      startPlacement: (t: Parameters<Game["startPlacement"]>[0]) => game.startPlacement(t),
      openEconomy: () => this.openEconomy(),
      chooseTown: (town: number, choice: TownChoice) => this.chooseTown(town, choice, this.defaultKeep(town, choice)),
      garrison: (town: number) => game.army.garrisonOf(town).length,
      garrisonMore: (town: number) => game.garrisonMore(town),
      garrisonLess: (town: number) => game.garrisonLess(town),
      notify: (text: string) => game.toast(text),
      retreat: () => game.retreatSelection(),
      dispatchPool: (node: number) => game.dispatchPool(node),
      dispatch: (node: number, share: number) => game.dispatch(node, share),
      cancelToHold: () => game.cancelToHold(),
      groupRefill: (i: number) => game.army.groups[i].refill,
      toggleRefill: (i: number) => this.toggleRefill(i),
      selectOnly: (units: number[]) => game.apply([{ kind: "select", units }]),
      clearSelection: () => game.apply([{ kind: "clear" }]),
      groupView: () => game.groupView,
      groupWant: (i: number, type: number) => game.army.groups[i].want[type] ?? 0,
      groupHas: (i: number, type: number) => game.groupHas(i, type),
      setGroupWant: (i: number, type: number, n: number) => game.setGroupWant(i, type, Math.min(n, GROUP_WANT_MAX)),
      clearGroup: (i: number) => game.clearGroup(i),
      beforeGroupCount: () => game.beforeGroupCount(),
      saveBeforeIntoGroup: (i: number) => {
        const n = game.saveBeforeIntoGroup(i);
        if (n > 0) game.toast(`已存成編隊 ${i + 1}（${n} 個）`);
      },
      collapsed: () => this.collapsed,
      toggleCollapsed: () => {
        this.collapsed = !this.collapsed;
      },
      openReserve: () => this.openReserve(),
    };
    this.minimap = new Minimap(root, {
      view: () => game.view,
      visible: () => game.camera?.visible() ?? null,
      tap: (x, y) => game.minimapTap(x, y),
      longPress: (x, y) => game.minimapLongPress(x, y),
      alerts: () => this.alerts.map((a) => ({ cx: Math.floor(a.wx / TILE_PX), cy: Math.floor(a.wy / TILE_PX) })),
      highlight: () => (this.flash !== null && performance.now() < this.flash.until ? this.flash : null),
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
    // The resource bar keeps a gap before the top-right buttons.
    this.res.update(view, Math.floor(this.controlsBar.getBoundingClientRect().left - this.res.el.getBoundingClientRect().left - RES_GAP));
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
    // 全軍 N (ceo 2026-10-03): the soldiers it selects, those stationed in towns left out.
    const armyLabel = armyText(this.game.armyIds().length);
    if (this.armyBtn.textContent !== armyLabel) this.armyBtn.textContent = armyLabel;
    for (let i = 0; i < 4; i++) {
      // 現有／原本 (D-026): what the group has now against what it was saved with.
      const g = this.game.army.groups[i];
      const text = g.saved > 0 ? `${i + 1}·${this.alive(g.ids).length}/${g.saved}` : `${i + 1}`;
      const b = this.groupBtns[i];
      if (b.textContent === text) continue;
      if (g.saved === 0) {
        b.textContent = text;
        continue;
      }
      // Two lines (16/16 does not fit a 48 pt button on one); the dot is there for the text only.
      b.replaceChildren();
      el("span", b, "group-no", `${i + 1}`);
      el("span", b, "group-dot", "·");
      el("span", b, "group-count", `${this.alive(g.ids).length}/${g.saved}`);
    }
    this.info.update();
    this.cmds.update();
    this.warnPopulationFull();
    // The message strip sits above the selection info, which grows with what is selected
    // (the stance lines, the group panel; D-026, D-054), so that neither covers the other.
    const panel = this.info.el.hidden ? null : this.info.el.getBoundingClientRect();
    const above = panel === null ? 0 : Math.ceil(this.root.getBoundingClientRect().bottom - panel.top + 8);
    if (above !== this.toastAbove) {
      this.toastAbove = above;
      this.root.style.setProperty("--toast-above", `${above}px`);
    }
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

  /** 閒置村民, tap: select the next idle farmer and look at it. */
  private nextIdle(): void {
    const view = this.game.view;
    const idle = view?.curr?.snap.idleFarmers;
    if (view === null || idle === undefined || idle.length === 0) {
      this.game.toast("沒有閒置的村民");
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

  /** 閒置村民, long press: select every idle farmer. */
  private allIdle(): void {
    const idle = this.game.view?.curr?.snap.idleFarmers;
    if (idle === undefined || idle.length === 0) {
      this.game.toast("沒有閒置的村民");
      return;
    }
    this.game.apply([{ kind: "select", units: [...idle].sort((a, b) => a - b) }]);
  }

  /**
   * 人口滿了 (D-054: the brief asks for a word in the message strip): one of our barracks,
   * ranges or mage halls has stopped 自動訓練 for want of room; said once each time it starts.
   */
  private warnPopulationFull(): void {
    const view = this.game.view;
    const b = view?.curr?.snap.buildings;
    if (view === null || b === undefined) return;
    let full = false;
    for (let o = 0; o < b.length; o += BUILDING_STRIDE) {
      if (b[o + BuildingField.owner] === view.me && (b[o + BuildingField.flags] & BuildingFlag.AutoPopulationFull) !== 0) full = true;
    }
    if (full && !this.populationFull) this.game.toast("人口滿了，自動訓練停下來：蓋民居");
    this.populationFull = full;
  }

  /**
   * 預留 (D-054): what 自動訓練 leaves untouched, so that the player can still build (a mage
   * hall's wood and gold by default) and cast (three cannon shots of crystal).
   */
  openReserve(): void {
    const h = this.game.view?.header;
    if (h === null || h === undefined) return;
    this.reserve = { food: h[H.reserveFood], wood: h[H.reserveWood], gold: h[H.reserveGold], crystal: h[H.reserveCrystal] };
    this.drawReserve();
  }

  private reserve: { food: number; wood: number; gold: number; crystal: number } | null = null;

  private drawReserve(): void {
    const r = this.reserve;
    if (r === null) return;
    const card = this.openDialog("預留", "economy reserve");
    // One line, so that four rows fit a phone held sideways without scrolling.
    el("p", card, "small", "自動訓練只用超過這些的資源；預設留的夠蓋法術營、放 3 發晶砲。");
    const rows: [keyof typeof r, string, number][] = [
      ["food", "糧", 10],
      ["wood", "木", 10],
      ["gold", "金", 10],
      ["crystal", "晶", 5],
    ];
    for (const [key, name, step] of rows) {
      const row = el("div", card, "ratio-row");
      el("span", row, "ratio-name", name);
      const set = (v: number) => {
        this.reserve = { ...r, [key]: Math.min(Math.max(v, 0), AUTO_TRAIN.reserveMax) };
        this.drawReserve();
      };
      btn(row, "−", () => set(r[key] - step), "secondary").setAttribute("aria-label", `${name}少留 ${step}`);
      const value = el("span", row, "ratio-value", `${r[key]}`);
      value.setAttribute("role", "status");
      value.setAttribute("aria-label", `${name}預留`);
      btn(row, "+", () => set(r[key] + step), "secondary").setAttribute("aria-label", `${name}多留 ${step}`);
    }
    const row = el("div", card, "dialog-buttons");
    btn(row, "套用", () => {
      this.game.command({ c: "reserve", ...r });
      this.closeDialog();
    });
    btn(row, "預設", () => {
      this.reserve = { ...AUTO_TRAIN.reserve };
      this.drawReserve();
    }, "secondary");
    btn(row, "取消", () => this.closeDialog(), "secondary");
  }

  private toggleRefill(i: number): void {
    const g = this.game.army.groups[i];
    g.refill = !g.refill;
    this.game.toast(g.refill ? `編隊 ${i + 1} 自動補兵：開。缺人時，沒編隊和新訓練的兵會自己走去會合` : `編隊 ${i + 1} 自動補兵：關`);
  }

  /** 全軍: every own soldier on the map, except the ones stationed in a town (留守, D-026). */
  private selectArmy(): void {
    const all = this.game.armyIds();
    if (all.length === 0) {
      this.game.toast(this.game.hasSoldiers() ? "所有的兵都在留守：點城鎮可以調整留守的人數" : "還沒有軍隊");
      return;
    }
    this.game.apply([{ kind: "select", units: all }]);
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
    this.dialogClosed();
    this.dialog.replaceChildren();
    this.dialog.className = `dialog ${cls}`;
    this.dialog.hidden = false;
    this.dialog.setAttribute("aria-label", title);
    const card = el("div", this.dialog, "dialog-card");
    el("h2", card, "", title);
    return card;
  }

  /** 重設: close the open dialog unless it is the result screen, and put the command area back on its first page. */
  closePanels(): void {
    if (this.dialogOpen && !this.dialog.classList.contains("result")) this.closeDialog();
    this.cmds.reset();
  }

  closeDialog(): void {
    this.dialog.hidden = true;
    this.dialog.replaceChildren();
    this.dialogClosed();
  }

  private dialogClosed(): void {
    const gone = this.dialogGone;
    this.dialogGone = null;
    gone?.();
  }

  /**
   * 開局提示 (D-044): where crystal comes from and the nearest town, over the paused game.
   * The minimap flashes that town while this is open and for a while after; 看那座城鎮 also
   * moves the camera there. `done` runs however the dialog goes away.
   */
  openTownHint(lines: string[], town: { id: number; cx: number; cy: number; radius: number }, look: () => void, done: () => void): void {
    const card = this.openDialog("魔晶從城鎮來", "town-hint");
    for (const line of lines) el("p", card, "", line);
    this.flash = { ...town, until: Number.POSITIVE_INFINITY };
    this.dialogGone = () => {
      if (this.flash !== null) this.flash.until = performance.now() + TOWN_FLASH_AFTER_MS;
      done();
    };
    const row = el("div", card, "dialog-buttons");
    // 不再提示 (ceo, D-044): the player plays one game after another. Kept on this device;
    // 選單 → 魔晶怎麼拿 opens the hint again, and there it can be turned back on. On the left,
    // away from 知道了 under the right thumb.
    const off = loadTownHintOff();
    btn(
      row,
      off ? "開局時要提示" : "不再提示",
      () => {
        saveTownHintOff(!off);
        this.closeDialog();
        this.game.toast(off ? "之後每一局開局都會提示" : "之後開局不會再提示；選單裡的「魔晶怎麼拿」可以再看");
      },
      "secondary",
    );
    btn(
      row,
      "看那座城鎮",
      () => {
        this.closeDialog();
        look();
      },
      "secondary",
    );
    btn(row, "知道了", () => this.closeDialog());
  }

  /** The town 開局提示 points at, whether its dialog is open, and whether the minimap flashes it (test hook). */
  townHint(): { town: number; open: boolean; flashing: boolean } | null {
    if (this.flash === null) return null;
    return { town: this.flash.id, open: this.flash.until === Number.POSITIVE_INFINITY, flashing: performance.now() < this.flash.until };
  }

  get dialogOpen(): boolean {
    return !this.dialog.hidden;
  }

  private openMenu(): void {
    const card = this.openDialog("選單", "menu");
    const list = el("div", card, "dialog-buttons column");
    // 開局提示 again (D-044), also after 不再提示.
    btn(list, "魔晶怎麼拿", () => {
      this.closeDialog();
      this.game.showTownHint();
    }, "secondary");
    btn(list, "兵種相剋", () => this.openCounters(), "secondary");
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

  /**
   * 兵種相剋 (ceo 2026-10-07): each soldier type, whom it hits harder and who hits it harder,
   * from this game's damage table (counters.ts).
   */
  private openCounters(): void {
    const card = this.openDialog("兵種相剋", "counters");
    el("p", card, "small", "×2 是傷害變成兩倍。數字是這一局的規則。");
    const table = el("div", card, "counter-table");
    for (const line of counterLines(this.game.view?.rules, UNIT_NAME)) {
      const row = el("div", table, "counter-row");
      el("b", row, "counter-name", UNIT_NAME[line.type] ?? "");
      el("span", row, "counter-beats", `剋：${line.beats.length > 0 ? line.beats.join("、") : "沒有"}`);
      el("span", row, "counter-fears", `怕：${line.fears.length > 0 ? line.fears.join("、") : "沒有"}`);
    }
    const row = el("div", card, "dialog-buttons");
    btn(row, "回選單", () => this.openMenu(), "secondary");
    btn(row, "關閉", () => this.closeDialog());
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
    // D-050 (core #105): the ratio now moves the farmers already gathering too, but not those sent by hand.
    el("p", card, "small", "自動分配開著時，改比例後，正在採糧、木、金的村民會照新比例重新分配；你親手派去採的不會動。晶脈要自己派。");
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
  /** 搶還是治理 (also reopened by tapping the town while it waits, GDD §10). */
  openTownChoice(town: number): void {
    const size = this.game.view?.map.towns.find((t) => t.id === town)?.size;
    const big = size === TownSize.Large;
    // 城鎮只能搶一次 (round 7, D-061): a town plundered this game offers 治理 only.
    const once = this.game.view?.townPlunderedOnce(town) === true;
    const card = this.openDialog(`攻下${big ? "大城" : "小鎮"}！${once ? "只能治理" : "搶還是治理？"}`, "town-choice");
    // 留守 (D-026): how many soldiers stay behind with each choice.
    const keep = { plunder: this.defaultKeep(town, TownChoice.Plunder), govern: this.defaultKeep(town, TownChoice.Govern) };
    const row = el("div", card, "choice-row");
    if (!once) {
      const plunder = btn(row, "", () => this.chooseTown(town, TownChoice.Plunder, keep.plunder), "choice-plunder");
      el("b", plunder, "", "搶");
      el("span", plunder, "", `部隊留下搶 ${big ? 25 : 15} 秒，拿一大筆糧、金、魔晶；城鎮變成廢墟 4 分鐘`);
    }
    const govern = btn(row, "", () => this.chooseTown(town, TownChoice.Govern, keep.govern), "choice-govern");
    el("b", govern, "", "治理");
    el("span", govern, "", `投入金和木修繕 ${big ? 60 : 45} 秒，之後每分鐘產出、加人口；要留兵駐守`);
    if (once) el("p", card, "small plundered-note", PLUNDERED_TEXT);
    const keeps = el("div", card, "keep-row");
    if (!once) this.keepStepper(keeps, "搶", town, keep.plunder, (n) => (keep.plunder = n));
    this.keepStepper(keeps, "治理", town, keep.govern, (n) => (keep.govern = n));
    el("p", card, "small", "留守的兵改成堅守，不跟「全軍」走，也會離開原本的編隊。");
    btn(card, "稍後再決定（點城鎮也能選）", () => this.closeDialog(), "secondary later");
  }

  /** How many soldiers a choice leaves behind unless the player changes it: the least a governed town needs, none for a plunder. */
  private defaultKeep(town: number, choice: TownChoice): number {
    if (choice !== TownChoice.Govern) return 0;
    return Math.max(0, this.game.garrisonNeeded(town) - this.game.army.garrisonOf(town).length);
  }

  /** 留守 − N + 名 under one of the two choices. The most is the soldiers inside the town when the button is pressed. */
  private keepStepper(parent: HTMLElement, name: string, town: number, initial: number, set: (n: number) => void): void {
    let n = initial;
    const box = el("div", parent, "keep");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", `留守（${name}）`);
    el("span", box, "", `${name}：留守`);
    const minus = btn(box, "−", null, "secondary step");
    minus.setAttribute("aria-label", `少留守 1 名（${name}）`);
    const out = el("output", box, "", `${n}`);
    out.setAttribute("aria-label", `留守幾名（${name}）`);
    const plus = btn(box, "+", null, "secondary step");
    plus.setAttribute("aria-label", `多留守 1 名（${name}）`);
    el("span", box, "", "名");
    const show = (v: number) => {
      n = v;
      out.textContent = `${n}`;
      set(n);
    };
    minus.addEventListener("click", () => show(Math.max(0, n - 1)));
    plus.addEventListener("click", () => {
      const most = this.game.garrisonCandidates(town);
      if (n >= most) this.game.toast(`城鎮範圍內只有 ${most} 名兵可以留守`);
      else show(n + 1);
    });
  }

  chooseTown(town: number, choice: TownChoice, keep: number): void {
    this.game.chooseTown(town, choice, keep);
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
