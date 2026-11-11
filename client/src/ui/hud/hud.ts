// The prototype's interface shell (GDD §10 草稿; temporary, not an approved design): resource
// bar, minimap, selection info, command area, control groups 1–4 and 全軍 on the right,
// 閒置村民 and 全體回城 on the left, attack alerts, 經濟分配, 搶／治理, the menu and the result
// screen. Text updates at most 10 times a second and only when it changed.

import { POPULATION_CEILING_TEXT } from "../../game/auto-army.ts";
import { HOME_CELLS, HOUSE_WOOD_TEXT, nearFootprint } from "../../game/auto-house.ts";
import { enemiesNearHome, HomeNearAlert, type SeenUnit } from "../../game/home-alert.ts";
import { counterLines } from "../../game/counters.ts";
import type { Game } from "../../game/game.ts";
import { tradedText } from "../../game/market.ts";
import { pressable } from "../../input/pressable.ts";
import type { PerfScenario } from "../../lab/lab.ts";
import {
  AUTO_TRAIN,
  BUILDING_STRIDE,
  BuildingField,
  BuildingType,
  CELL,
  GameOverReason,
  type GameStats,
  HeaderField as H,
  NEUTRAL,
  NO_OWNER,
  type Resource,
  TICKS_PER_SECOND,
  type SimEvent,
  TownChoice,
  TownSize,
  UNIT_STRIDE,
  UnitField,
  UnitType,
} from "../../sim.ts";
import { TILE_PX } from "../../tuning.ts";
import { FIXED_TO_PX } from "../../view/view.ts";
import { applyTheme, loadTheme, saveTheme, THEME_LABEL, THEMES } from "../../theme.ts";
import { formalUi } from "../formal.ts";
import { dress, icon } from "../icons.ts";
import { ORDER_TONE } from "../overlays.ts";
import { adjustRatio, type Ratio } from "./economy-ratio.ts";
import { loadTownHintOff, saveTownHintOff } from "../../hint-pref.ts";
import { hasCrystal } from "../../game/features.ts";
import { TOWN_HINT_MENU, townHintTitle } from "../../game/town-hint.ts";
import { costText } from "../../game/govern-wait.ts";
import { Minimap } from "./minimap.ts";
import { armyText, buildingName, clock, GAME_OVER_REASON, UNIT_NAME } from "./names.ts";
import { CommandArea, PLUNDERED_TEXT, ResourceBar, SelectionInfo } from "./panels.ts";
import { statsModel } from "../stats/model.ts";
import { StatsPage } from "../stats/page.ts";

const UPDATE_MS = 100;
/** px between the resource bar and the top-right buttons. */
const RES_GAP = 8;
const ALERT_MS = 6000;
/** Attacks closer than this (cells) to a live alert refresh it instead of adding another. */
const ALERT_MERGE_CELLS = 8;
const MAX_ARROWS = 3;
/** Half an alert arrow's side (style.css .alert-arrow, 52), and a little room round it. */
const ARROW_HALF = 28;
/** 開局提示: the minimap keeps flashing the town this long after the hint is closed (ms). */
const TOWN_FLASH_AFTER_MS = 10_000;
/** 不再提示 in 正式介面 without crystal (the user 2026-11-08): where to turn it back on. */
export const TOWN_HINT_OFF_FORMAL_TEXT = "之後開局不會再提示，可以在設定裡打開";
/**
 * 全體回城 跳出來 (R6-13, D-087): an enemy player's soldiers hurting our buildings or farmers
 * HOME_CELLS close to our main city (auto-house.ts: 自動蓋民居 waits for the same), and for this
 * long after the last such hit (ms). Suggested values, to be tried in play.
 */
const HOME_HIT_MS = 15_000;
const HOME_HIT_TEXT = "家裡被攻擊：主城附近有敵兵";

/** 地圖 flashes red, this long each way (R6-25-05). */
const MAP_ALARM_BLINK_MS = 400;

export interface HudLifecycle {
  restart(): void;
  toStart(): void;
  /** Start a game of this perf scenario that measures itself (量測, D-083). */
  perf(scenario: PerfScenario): void;
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
  /** What the open dialog redraws as the game goes on (搶還是治理's 還差), with the panels. */
  private dialogTick: (() => void) | null = null;
  /** 收起 (D-054): the selection info shows its title line only, for this game. */
  private collapsed = false;
  /** 進駐 (R13-01 B): how the selection info was before it folded for the pick. */
  private foldBefore: { plain: boolean; group: boolean } | null = null;
  /** 軍團畫面's own 收起 (the user 2026-10-31): set by each tap on a group button, and the other's left alone. */
  private groupCollapsed = false;
  /** 自動訓練 stopped by a full population somewhere (D-054), as last seen: told once when it starts. */
  private populationFull = false;
  private readonly info: SelectionInfo;
  private readonly cmds: CommandArea;
  /** 正式介面 (R6) on: the buttons built in R6's look (ui/formal.ts). */
  private readonly formal: boolean;
  private readonly recallBtn: HTMLButtonElement;
  /** 敵軍接近主城 (D-141): when it was said, and how many. */
  private readonly homeNear = new HomeNearAlert();
  private readonly idleBtn: HTMLButtonElement;
  /** 正式介面 (R6-13): 地圖 and how many places are under attack on it; 閒置's count. */
  private readonly mapBtn: HTMLButtonElement | null;
  private readonly mapBadge: HTMLElement | null;
  private readonly idleBadge: HTMLElement | null;
  /** 正式介面: the minimap shows (behind 地圖), and whether it opened on its own. */
  private minimapOpen = false;
  private minimapAuto = false;
  /** 家裡被攻擊 (R6-13): 全體回城 shows until then (performance.now ms). */
  private homeHitUntil = 0;
  /** What 全體回城 shows now: "home" (家裡被攻擊), "work" (回去工作), or "" (put away). */
  private recallLook = "";
  private readonly groupBtns: HTMLButtonElement[] = [];
  /** 「退1」–「退4」 (D-081): beside each group button while that group advances. */
  private readonly retreatBtns: HTMLButtonElement[] = [];
  private idleIndex = 0;
  private lastUpdate = 0;
  private toastAbove = -1;
  private alerts: Alert[] = [];
  private readonly arrowLayer: HTMLElement;
  /** The buttons and the minimap the arrows keep off, and when they were looked up. */
  private keepOff: { left: number; right: number; top: number; bottom: number }[] = [];
  private keepOffAt = Number.NEGATIVE_INFINITY;
  private readonly dialog: HTMLElement;
  private econ: (Ratio & { on: boolean }) | null = null;
  private readonly cleanups: (() => void)[] = [];

  constructor(root: HTMLElement, game: Game, controlsBar: HTMLElement, life: HudLifecycle) {
    this.root = root;
    this.game = game;
    this.life = life;
    this.res = new ResourceBar(root);
    this.controlsBar = controlsBar;

    // 正式介面 (R6, ui/formal.ts): the buttons below in R6's look; off, the prototype's as they were.
    this.formal = formalUi();
    const menu = btn(controlsBar, "選單", () => this.openMenu(), this.formal ? "b sec" : "secondary");
    if (this.formal) dress(menu, { ic: "menu", label: "選單" });
    menu.setAttribute("aria-haspopup", "dialog");

    const left = el("div", root, "side-left");
    if (!this.formal) {
      // 重設 (D-024): one tap back to nothing selected; kept apart from 全體回城 below it.
      btn(left, "重設", () => game.reset(), "reset-btn");
      this.recallBtn = btn(left, "全體回城", () => this.toggleRecall(), "secondary");
      this.idleBtn = el("button", left, "idle-btn", "閒置 0");
      this.mapBtn = this.mapBadge = this.idleBadge = null;
    } else {
      // R6-13 (D-087 C, 需要時才出現): no 重設 (× and 取消 do what it did, R6-30); 全體回城 only while
      // home is hit or the farmers hide (it is in the menu too); 閒置 only while someone idles; the
      // minimap behind 地圖.
      this.recallBtn = btn(left, "", () => this.tapRecall(), "recall-btn b alarm");
      this.idleBtn = el("button", left, "idle-btn b pri");
      dress(this.idleBtn, { ic: "idle", label: "閒置" });
      this.idleBadge = el("span", this.idleBtn, "badge");
      this.idleBtn.hidden = true;
      this.mapBtn = btn(left, "", () => this.toggleMinimap(), "map-btn b sec");
      dress(this.mapBtn, { ic: "map", label: "地圖" });
      this.mapBadge = el("span", this.mapBtn, "badge");
      this.mapBadge.hidden = true;
    }
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
      // R6-12: the number large, what it has under it; empty, the number only.
      const b = el("button", grid, this.formal ? "group-btn b grp empty" : "group-btn secondary", this.formal ? "" : `${i + 1}`);
      if (this.formal) el("span", b, "n", `${i + 1}`);
      b.type = "button";
      b.setAttribute("aria-label", `編隊 ${i + 1}：點一下選取並打開軍團畫面，點兩下跳過去`);
      // 軍團畫面 (D-054): the tap opens it; the long press that saved the selection is gone
      // (改成剛才選的 N 名 in the panel does that). Folded each time, with soldiers to order (the user
      // 2026-10-31: 「我希望選編隊彈出的那個選單默認是是收起的，因為大部分時候我只是要點地板而已」);
      // with none (nobody in it, or all stationed) the panel is what the tap is for.
      this.cleanups.push(
        pressable(b, {
          tap: (count) => {
            game.showGroup(i, count === 2);
            this.groupCollapsed = game.groupOnCall(i).length > 0;
          },
        }),
      );
      this.groupBtns.push(b);
    }
    // 「退」 (D-081, 3b-A): left of the buttons, 退1 and 退3 right beside them, 退2 and 退4 one further
    // out, each with its number so that two side by side read at a glance.
    for (let i = 0; i < 4; i++) {
      const r = btn(grid, `退${i + 1}`, () => game.retreatGroup(i), `group-retreat ${this.formal ? "b blue " : ""}${ORDER_TONE.retreat} ${i % 2 === 0 ? "near" : "far"}`);
      // D-138 A: back to the town it last held (or our nearest), else the main city.
      r.setAttribute("aria-label", `編隊 ${i + 1} 撤退`);
      r.hidden = true;
      this.retreatBtns.push(r);
    }
    this.armyBtn = btn(right, armyText(0), () => this.selectArmy(), this.formal ? "army-btn b army" : "army-btn secondary");
    if (this.formal) dress(this.armyBtn, { ic: "army", label: "全軍", count: 0, name: armyText(0) });
    // 全軍撤退 (user 2026-10-01): nothing to select first. Top left, far from 全軍.
    const retreatAll = btn(root, "全軍撤退", () => game.retreatAll(), `retreat-all-btn ${this.formal ? "b blue " : ""}${ORDER_TONE.retreat}`);
    if (this.formal) dress(retreatAll, { ic: "retreat", label: "全軍撤退" });

    const host = {
      view: () => game.view,
      pending: () => game.pending,
      paused: () => game.paused,
      mode: () => game.mode,
      command: (cmd: Parameters<Game["command"]>[0]) => game.command(cmd),
      setMode: (m: Parameters<Game["setMode"]>[0]) => game.setMode(m),
      startPlacement: (t: Parameters<Game["startPlacement"]>[0]) => game.startPlacement(t),
      openEconomy: () => this.openEconomy(),
      chooseTown: (town: number, choice: TownChoice) => this.chooseTown(town, choice, this.defaultKeep(town)),
      wallCount: (town: number) => game.wallCount(town),
      governCost: (town: number) => game.governCost(town),
      governShortfall: (town: number) => game.governShortfall(town),
      governWaiting: (town: number) => game.governWaits.has(town),
      cancelGovernWait: (town: number) => game.cancelGovernWait(town),
      reserveRaised: () => game.governWaits.size > 0,
      autoPaused: (building: number) => game.autoPaused(building),
      toggleAutoPaused: (building: number) => game.toggleAutoPaused(building),
      trainingLine: (building: number) => game.trainingLine(building),
      villagerLine: () => game.villagerLine(),
      villagerTarget: () => game.autoArmy.villagerTarget,
      stepVillagers: (by: number) => game.stepVillagerTarget(by),
      villagersPaused: () => game.autoArmy.villagersPaused,
      toggleVillagers: () => game.toggleVillagers(),
      autoHouseOn: () => game.autoHouseOn(),
      holdsTown: () => game.holdsTown(),
      toggleAutoHouse: () => game.toggleAutoHouse(),
      garrison: (town: number) => game.army.garrisonOf(town).length,
      garrisonGroups: (town: number) => game.garrisonGroups(town),
      townOut: (town: number, group: number | null | "all") => game.townOut(town, group),
      outpostGroups: (building: number) => game.outpostGroups(building),
      outpostOut: (building: number, group: number) => game.outpostOut(building, group),
      buildingSeats: (building: number) => game.buildingSeats(building),
      buildingRecall: (building: number, ids: readonly number[]) => game.buildingRecall(building, ids),
      townSeats: (town: number) => game.townSeats(town),
      wallShiftLines: (town: number) => game.wallShiftLines(town),
      groupPlaces: (i: number) => game.groupPlaces(i),
      groupOut: (i: number, all: boolean) => game.groupOut(i, all),
      groupRecall: (i: number) => game.groupRecall(i),
      garrisonMore: (town: number) => game.garrisonMore(town),
      garrisonLess: (town: number) => game.garrisonLess(town),
      notify: (text: string) => game.toast(text),
      retreat: () => game.retreatSelection(),
      reform: () => game.reform(),
      dispatchPool: (node: number) => game.dispatchPool(node),
      dispatch: (node: number, share: number) => game.dispatch(node, share),
      depotResources: (building: number) => game.depotResources(building),
      depotWorkers: (building: number, resource: Resource) => game.depotWorkers(building, resource),
      depotSend: (building: number, resource: Resource) => game.depotSend(building, resource),
      depotTake: (building: number, resource: Resource) => game.depotTake(building, resource),
      hidingComing: (building: number) => game.hidingComing(building),
      callToHide: (building: number, type: number) => game.callToHide(building, type),
      callWaiting: (building: number) => game.callWaiting(building),
      outpostState: (building: number) => game.outpostState(building),
      cancelToHold: () => game.cancelToHold(),
      groupRefill: (i: number) => game.army.groups[i].refill,
      toggleRefill: (i: number) => this.toggleRefill(i),
      groupGrow: (i: number) => game.army.groups[i].grow,
      toggleGrow: (i: number) => this.toggleGrow(i),
      selectOnly: (units: number[]) => game.apply([{ kind: "select", units }]),
      // 正式介面 (R6-30): × is what 重設 was, back to nothing selected (選位置, the preview, the build menu too).
      clearSelection: () => (this.formal ? game.reset() : game.apply([{ kind: "clear" }])),
      groupView: () => game.groupView,
      groupWant: (i: number, type: number) => game.army.groups[i].want[type] ?? 0,
      groupHas: (i: number, type: number) => game.groupHas(i, type),
      setGroupWant: (i: number, type: number, n: number) => game.setGroupWant(i, type, Math.min(n, game.groupWantMax())),
      clearGroup: (i: number) => game.clearGroup(i),
      beforeGroupCount: () => game.beforeGroupCount(),
      saveBeforeIntoGroup: (i: number) => {
        const n = game.saveBeforeIntoGroup(i);
        if (n > 0) game.toast(`已存成編隊 ${i + 1}（${n} 個）`);
      },
      collapsed: () => (game.groupView !== null ? this.groupCollapsed : this.collapsed),
      toggleCollapsed: () => {
        if (game.groupView !== null) this.groupCollapsed = !this.groupCollapsed;
        else this.collapsed = !this.collapsed;
      },
      openReserve: () => this.openReserve(),
    };
    this.minimap = new Minimap(root, {
      view: () => game.view,
      visible: () => game.camera?.corners() ?? null,
      tap: (x, y) => game.minimapTap(x, y),
      longPress: (x, y) => game.minimapLongPress(x, y),
      alerts: () => this.alerts.map((a) => ({ cx: Math.floor(a.wx / TILE_PX), cy: Math.floor(a.wy / TILE_PX) })),
      highlight: () => (this.flash !== null && performance.now() < this.flash.until ? this.flash : null),
    });
    if (this.formal) this.minimap.canvas.classList.add("closed");
    this.info = new SelectionInfo(root, host);
    this.cmds = new CommandArea(root, host);
    this.arrowLayer = el("div", root, "alert-arrows");
    this.dialog = el("div", root, "dialog");
    this.dialog.setAttribute("role", "dialog");
    this.dialog.hidden = true;
    // 正式介面 (R6-20, R6-21): every button a dialog puts up (at once or later) the interface's, in its tone.
    if (this.formal) {
      const dress = () => {
        // [data-plain]: a button with a look of its own (局後統計's ⌄).
        for (const b of this.dialog.querySelectorAll<HTMLButtonElement>("button:not(.b):not([data-plain])")) {
          b.classList.add("b");
          if (b.classList.contains("danger")) b.classList.add("red");
          else if (b.classList.contains("choice-plunder")) b.classList.add("plunder");
          else if (b.classList.contains("choice-govern")) b.classList.add("govern");
          else if (!b.classList.contains("secondary")) b.classList.add("pri");
        }
      };
      // Buttons only (class changes are not watched: dressing them sets none of this off again).
      new MutationObserver(dress).observe(this.dialog, { childList: true, subtree: true });
    }
  }

  destroy(): void {
    for (const c of this.cleanups) c();
  }

  /** Every frame: text at most 10 times a second; alert arrows follow the camera. */
  /** 進駐 (R13-01 B): the selection info folds while picking where to go in, and is as it was after. */
  foldForEnter(on: boolean): void {
    if (on && this.foldBefore === null) {
      this.foldBefore = { plain: this.collapsed, group: this.groupCollapsed };
      this.collapsed = this.groupCollapsed = true;
    } else if (!on && this.foldBefore !== null) {
      this.collapsed = this.foldBefore.plain;
      this.groupCollapsed = this.foldBefore.group;
      this.foldBefore = null;
    }
  }

  frame(now: number): void {
    this.minimap.update(now);
    this.drawArrows(now);
    if (this.formal) this.updateLeft(now);
    if (now - this.lastUpdate < UPDATE_MS) return;
    this.lastUpdate = now;
    this.dialogTick?.();
    const view = this.game.view;
    const h = view?.header;
    // The resource bar keeps a gap before the top-right buttons.
    this.res.update(view, Math.floor(this.controlsBar.getBoundingClientRect().left - this.res.el.getBoundingClientRect().left - RES_GAP));
    if (h !== null && h !== undefined && !this.formal) {
      const recall = h[H.recall] === 1;
      const label = recall ? "回去工作" : "全體回城";
      if (this.recallBtn.textContent !== label) this.recallBtn.textContent = label;
      this.recallBtn.classList.toggle("active", recall);
    }
    const idle = view?.curr?.snap.idleFarmers.length ?? 0;
    if (this.idleBadge !== null) {
      // R6-13: there while someone idles, how many on its corner.
      this.idleBtn.hidden = idle === 0;
      if (this.idleBadge.textContent !== `${idle}`) {
        this.idleBadge.textContent = `${idle}`;
        this.idleBtn.setAttribute("aria-label", `閒置 ${idle}：點一下跳到下一名，長按全選`);
      }
    } else {
      const idleText = `閒置 ${idle}`;
      if (this.idleBtn.textContent !== idleText) this.idleBtn.textContent = idleText;
      this.idleBtn.classList.toggle("has-idle", idle > 0);
    }
    // 全軍 N (ceo 2026-10-03): the soldiers it selects, those stationed in towns left out.
    const soldiers = this.game.armyIds().length;
    if (!this.formal) {
      if (this.armyBtn.textContent !== armyText(soldiers)) this.armyBtn.textContent = armyText(soldiers);
    } else if (this.armyBtn.getAttribute("aria-label") !== armyText(soldiers)) dress(this.armyBtn, { ic: "army", label: "全軍", count: soldiers, name: armyText(soldiers) });
    for (let i = 0; i < 4; i++) {
      // 現有／原本 (D-026): what the group has now against what it was saved with. 閃紅提醒 (D-081):
      // down to fewer than half of what it started its attack with, it flashes red and reads 剩 a/b.
      const g = this.game.army.groups[i];
      const a = this.game.groupAlarm(i);
      const r = this.retreatBtns[i];
      r.hidden = !a.advancing;
      if (a.advancing) r.style.top = `${this.groupBtns[i].offsetTop}px`;
      const b = this.groupBtns[i];
      b.classList.toggle("alarm", a.alarm);
      // R6-12: lit while what is selected is this group (what its button selects: not those stationed in towns).
      if (this.formal) b.classList.toggle("is-active", g.saved > 0 && this.isSelected(this.game.groupOnCall(i)));
      // 現有 counts those stationed in towns or at outposts and those hiding, still the group's (ceo
      // 2026-10-26: 5/5); 駐N and 躲N on its top edge say how many (the user: 「分開顯示」).
      const count = a.alarm && a.base !== null ? `剩 ${a.present}/${a.base}` : `${this.alive(g.ids).length}/${g.saved}`;
      const away = this.game.groupStationedCount(i);
      const hid = this.game.groupHiding(i).length;
      const text = `${g.saved > 0 || a.alarm ? `${i + 1}·${count}` : `${i + 1}`}${away > 0 ? `駐${away}` : ""}${hid > 0 ? `躲${hid}` : ""}`;
      if (b.textContent === text) continue;
      const empty = g.saved === 0 && !a.alarm;
      if (this.formal) b.classList.toggle("empty", empty);
      else if (empty) {
        b.textContent = text;
        continue;
      }
      // Two lines (16/16 does not fit a 48 pt button on one); the dot is there for the text only.
      b.replaceChildren();
      el("span", b, this.formal ? "n group-no" : "group-no", `${i + 1}`);
      if (empty) continue;
      el("span", b, "group-dot", "·");
      el("span", b, this.formal ? "sub group-count" : "group-count", count);
      if (away > 0) el("span", b, "group-away", `駐${away}`);
      if (hid > 0) el("span", b, "group-away group-hide", `躲${hid}`);
    }
    this.info.update();
    this.cmds.update();
    this.warnPopulationFull();
    // The message strip sits above the selection info, which grows with what is selected
    // (the stance lines, the group panel; D-026, D-054), so that neither covers the other.
    const panel = this.info.frame.hidden ? null : this.info.frame.getBoundingClientRect();
    const above = panel === null ? 0 : Math.ceil(this.root.getBoundingClientRect().bottom - panel.top + 8);
    if (above !== this.toastAbove) {
      this.toastAbove = above;
      this.root.style.setProperty("--toast-above", `${above}px`);
    }
  }

  /** The selection is these units (those alive), no more, no fewer. */
  private isSelected(ids: number[]): boolean {
    const sel = this.game.view?.selection.units ?? [];
    const alive = this.alive(ids);
    return alive.length > 0 && alive.length === sel.length && alive.every((id) => sel.includes(id));
  }

  onEvent(ev: SimEvent): void {
    const me = this.game.view?.me ?? 0;
    switch (ev.k) {
      case "attacked":
        this.addAlert(ev.x * FIXED_TO_PX, ev.y * FIXED_TO_PX);
        if (this.homeHit(ev)) {
          const now = performance.now();
          // The prototype says it too (D-141: it said nothing), once a spell as 正式介面 does with 全體回城.
          if (!this.formal && now >= this.homeHitUntil) this.game.toast(HOME_HIT_TEXT);
          this.homeHitUntil = now + HOME_HIT_MS;
        }
        break;
      case "town_captured":
        // Ours: 搶還是治理, but not while measuring (ceo 2026-11-06: it covered the 量測 panel and its
        // result): the town waits for a choice as the player's would (tapping it still opens this);
        // nothing is sent, nothing said. The enemy's: said.
        if (ev.by !== me) this.game.toast("敵方攻下了一座城鎮");
        else if (!this.game.measuring) this.openTownChoice(ev.town);
        break;
      case "town_plundered":
        this.game.toast(ev.by === me ? `搶完了：糧 ${ev.food}、金 ${ev.gold}${this.crystal ? `、魔晶 ${ev.crystal}` : ""}` : "敵方搶完了一座城鎮");
        break;
      case "town_repaired":
        this.game.toast(ev.by === me ? "城鎮修繕完成，開始產出" : "敵方的城鎮修繕完成");
        break;
      case "town_revolted":
        this.game.toast(ev.from === me ? "駐軍不足，城鎮叛離了" : "敵方的城鎮叛離了");
        break;
      case "building_done":
        this.game.toast(`${buildingName(ev.type, this.game.view?.rules) ?? "建築"}蓋好了`);
        break;
      case "mage_killed":
        this.game.toast(ev.owner === me ? "我方法師陣亡" : this.crystal ? `擊殺敵方法師，得到魔晶 ${ev.crystal}` : "擊殺敵方法師");
        break;
      // 市場 (D-101): only ours come.
      case "traded":
        this.game.toast(tradedText(ev));
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

  /** 全體回城 or 回去工作 from the left (R6-13): what the player says goes; it is put away until home is hit again. */
  private tapRecall(): void {
    this.homeHitUntil = 0;
    this.toggleRecall();
  }

  /**
   * 家裡被攻擊 (R6-13): an enemy player's soldiers, not a town's militia or the big city's tower,
   * hurt our building or farmer (a soldier near home is no reason to hide the farmers) within
   * HOME_CELLS of our main city. Only a reminder: the farmers go in only when the player says.
   */
  private homeHit(ev: { x: number; y: number; target: number; by: number }): boolean {
    const view = this.game.view;
    const snap = view?.curr?.snap;
    if (view === null || snap === undefined || ev.by === view.me || ev.by === NEUTRAL || ev.by === NO_OWNER) return false;
    const u = view.unitRow(ev.target);
    if (u >= 0 && (snap.units[u + UnitField.owner] !== view.me || snap.units[u + UnitField.type] !== UnitType.Farmer)) return false;
    const b = view.buildingRow(ev.target);
    if (u < 0 && b >= 0 && snap.buildings[b + BuildingField.owner] !== view.me) return false;
    const x = ev.x / CELL;
    const y = ev.y / CELL;
    const bs = snap.buildings;
    for (let o = 0; o < bs.length; o += BUILDING_STRIDE) {
      if (bs[o + BuildingField.owner] !== view.me || bs[o + BuildingField.type] !== BuildingType.MainCity) continue;
      const size = view.rules.buildings[BuildingType.MainCity]?.size ?? 4;
      const x0 = bs[o + BuildingField.cellX];
      const y0 = bs[o + BuildingField.cellY];
      if (nearFootprint({ x: x0, y: y0, w: size, h: size }, x, y, HOME_CELLS)) return true;
    }
    return false;
  }

  private toggleMinimap(): void {
    this.setMinimap(!this.minimapOpen);
    this.minimapAuto = false;
  }

  private setMinimap(open: boolean): void {
    this.minimapOpen = open;
    this.minimap.canvas.classList.toggle("closed", !open);
    this.mapBtn?.classList.toggle("active", open);
  }

  /** 正式介面's left (tests): the minimap open (and on its own), what 全體回城 shows, how many places 地圖 counts. */
  get leftForTest(): { minimap: boolean; auto: boolean; recall: string; places: number } {
    return { minimap: this.minimapOpen, auto: this.minimapAuto, recall: this.recallLook, places: this.minimapOpen ? 0 : this.alerts.length };
  }

  /** 正式介面, every frame: the minimap opening and closing on its own, 地圖's alarm, 全體回城 (R6-13, R6-22). */
  private updateLeft(now: number): void {
    // Open on its own while 進攻 or 撤退 picks a spot (NEW-03) and while 開局提示 flashes a town on it
    // (INV-43); closed again after, if it opened on its own.
    const mode = this.game.mode;
    const want = mode === "advance" || mode === "retreat" || (this.flash !== null && now < this.flash.until);
    if (want && !this.minimapOpen) {
      this.setMinimap(true);
      this.minimapAuto = true;
    } else if (!want && this.minimapAuto) {
      this.setMinimap(false);
      this.minimapAuto = false;
    }
    // 地圖 while the minimap is put away and something is hit: red, flashing, how many places (R6-22;
    // 減少動態效果: red, not flashing). Open, the minimap's red rings flash instead.
    const places = this.minimapOpen ? 0 : this.alerts.length;
    const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.mapBtn?.classList.toggle("alarm", places > 0 && (still || Math.floor(now / MAP_ALARM_BLINK_MS) % 2 === 0));
    if (this.mapBadge !== null && this.mapBtn !== null) {
      this.mapBadge.hidden = places === 0;
      if (this.mapBadge.textContent !== `${places}`) this.mapBadge.textContent = `${places}`;
      const name = places > 0 ? `地圖：${places} 處被攻擊` : "地圖";
      if (this.mapBtn.getAttribute("aria-label") !== name) this.mapBtn.setAttribute("aria-label", name);
    }
    // 全體回城: while the farmers hide it reads 回去工作; while home is hit, 全體回城 in red.
    const recall = this.game.view?.header?.[H.recall] === 1;
    const look = recall ? "work" : now < this.homeHitUntil ? "home" : "";
    if (look === this.recallLook) return;
    if (look === "home" && this.recallLook === "") this.game.toast(HOME_HIT_TEXT);
    this.recallLook = look;
    const b = this.recallBtn;
    // Put away, it slides out with what it said (R6-25-06).
    if (look === "work") dress(b, { ic: "work", label: "回去工作", sub: "村民躲著" });
    else if (look === "home") dress(b, { ic: "home", label: "全體回城", sub: "家裡被攻擊" });
    if (look !== "") {
      b.classList.toggle("pri", look === "work");
      b.classList.toggle("alarm", look === "home");
    }
    b.classList.toggle("shown", look !== "");
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
   * 人口滿了 (D-054: the brief asks for a word in the message strip): 自動訓練 (the screen's, D-098)
   * has stopped for want of room; said once each time it starts. The cap at its ceiling (ceo
   * 2026-10-25): no house helps, so 人口已到上限; 自動蓋民居 (2026-10-25) waiting for wood: that.
   */
  private warnPopulationFull(): void {
    const full = this.game.autoPopulationFull;
    if (full && !this.populationFull) {
      this.game.toast(this.game.populationAtCeiling ? POPULATION_CEILING_TEXT : this.game.autoHouseBlock === "wood" ? HOUSE_WOOD_TEXT : "人口滿了，自動訓練停下來：蓋民居");
    }
    this.populationFull = full;
  }

  /**
   * 預留 (D-054): what 自動訓練 leaves untouched, so that the player can still build (a mage
   * hall's wood and gold by default) and cast (three cannon shots of crystal).
   */
  openReserve(): void {
    const h = this.game.view?.header;
    if (h === null || h === undefined) return;
    // While towns wait for 治理, the player's own reserve (the raise is shown under it).
    this.reserve = this.game.ownReserve();
    this.drawReserve();
  }

  private reserve: { food: number; wood: number; gold: number; crystal: number } | null = null;

  /** Whether this game has crystal (D-135: without it, the screen shows it nowhere). */
  private get crystal(): boolean {
    return hasCrystal(this.game.view?.rules);
  }

  private drawReserve(): void {
    const r = this.reserve;
    if (r === null) return;
    const card = this.openDialog("預留", "economy reserve");
    // One line, so that four rows fit a phone held sideways without scrolling.
    // D-135 (ceo 2026-11-08): the mage hall now costs more gold than the default keeps, so how to save for one, its cost read from the rules.
    const hall = this.game.view?.rules.buildings[BuildingType.MageHall]?.cost;
    el("p", card, "small", this.crystal ? "自動訓練只用超過這些的資源；預設留的夠蓋法術營、放 3 發晶砲。" : hall === undefined ? "自動訓練只用超過這些的資源。" : `自動訓練只用超過這些的資源；要存錢蓋法術營（木 ${hall.wood}、金 ${hall.gold}），把金調到 ${hall.gold}。`);
    // 等錢治理 (ceo 2026-10-21): the reserve in effect is raised to the waiting 治理's cost.
    const raised = this.game.raisedReserveText();
    if (raised !== "") el("p", card, "small reserve-raised", `預留暫時提高到 ${raised}（等治理）`);
    const rows: [keyof typeof r, string, number][] = [
      ["food", "糧", 10],
      ["wood", "木", 10],
      ["gold", "金", 10],
      // 正式介面 (R6-20 INV-121): 魔晶 written out.
      ["crystal", this.formal ? "魔晶" : "晶", 5],
    ];
    // D-135: no crystal, no row (its reserve stays 0).
    if (!this.crystal) rows.pop();
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
      this.game.setReserve(r);
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

  /**
   * 自動擴編 (D-141, off by default): on, the group full and the resources much more than the reserve, the buildings go on
   * training in its mix and it wants more; on turns 自動補兵 on too (it trains what the group wants). Off keeps the
   * numbers it grew to.
   */
  private toggleGrow(i: number): void {
    const g = this.game.army.groups[i];
    g.grow = !g.grow;
    g.growBase = null;
    if (g.grow) g.refill = true;
    this.game.toast(g.grow ? `編隊 ${i + 1} 自動擴編：開，資源多時照比例多練` : `編隊 ${i + 1} 自動擴編：關，加的人數留著`);
  }

  /** Our main city's footprint (the first standing), or null. */
  private homeBox(): { x: number; y: number; w: number; h: number } | null {
    const view = this.game.view;
    const bs = view?.curr?.snap.buildings;
    if (view === null || bs === undefined) return null;
    for (let o = 0; o < bs.length; o += BUILDING_STRIDE) {
      if (bs[o + BuildingField.owner] !== view.me || bs[o + BuildingField.type] !== BuildingType.MainCity) continue;
      const size = view.rules.buildings[BuildingType.MainCity]?.size ?? 4;
      return { x: bs[o + BuildingField.cellX], y: bs[o + BuildingField.cellY], w: size, h: size };
    }
    return null;
  }

  /** 敵軍接近主城 (D-141): the enemy's soldiers the screen sees within HOME_CELLS of our main city, said on the strip (game.ts, each snapshot). */
  homeNearCheck(now: number): void {
    const view = this.game.view;
    const u = view?.curr?.snap.units;
    const home = this.homeBox();
    if (view === null || u === undefined || home === null) return;
    const seen: SeenUnit[] = [];
    for (let o = 0; o < u.length; o += UNIT_STRIDE) seen.push({ owner: u[o + UnitField.owner], type: u[o + UnitField.type], x: u[o + UnitField.x] / CELL, y: u[o + UnitField.y] / CELL });
    const say = this.homeNear.seen(enemiesNearHome(seen, view.me, home, HOME_CELLS), now);
    if (say !== null) this.game.toast(say);
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

  /** What an alert arrow keeps off: the buttons and the minimap on screen (looked up at most every 250 ms). */
  private arrowKeepOff(now: number): { left: number; right: number; top: number; bottom: number }[] {
    if (now - this.keepOffAt < 250) return this.keepOff;
    this.keepOffAt = now;
    const out: { left: number; right: number; top: number; bottom: number }[] = [];
    for (const e of this.root.querySelectorAll<HTMLElement>("button, canvas")) {
      if (e.closest(".alert-arrows") !== null || e.closest(".sel-info") !== null) continue;
      const r = e.getBoundingClientRect();
      // Not the battlefield's own canvas (the whole screen).
      if (r.width > 0 && r.height > 0 && r.width < innerWidth * 0.8) out.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
    this.keepOff = out;
    return out;
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
      // Where the line from the screen centre to the attack leaves the screen, kept inside a margin; off the buttons and the
      // minimap, along that line towards the centre (D-141: 正式介面's 地圖 at 932 × 336 was under the arrow).
      const cx = w / 2;
      const cy = h / 2;
      const dx = s.x - cx;
      const dy = s.y - cy;
      const m = 56;
      const k = Math.min((cx - m) / Math.max(Math.abs(dx), 1e-6), (cy - m) / Math.max(Math.abs(dy), 1e-6));
      const boxes = this.arrowKeepOff(now);
      let x = cx + dx * k;
      let y = cy + dy * k;
      for (let f = k, i = 0; i < 24 && boxes.some((b) => x + ARROW_HALF > b.left && x - ARROW_HALF < b.right && y + ARROW_HALF > b.top && y - ARROW_HALF < b.bottom); i++) {
        f *= 0.93;
        x = cx + dx * f;
        y = cy + dy * f;
      }
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
    const card = el("div", this.dialog, this.formal ? "dialog-card panel" : "dialog-card");
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
    this.dialogTick = null;
    const gone = this.dialogGone;
    this.dialogGone = null;
    gone?.();
  }

  /**
   * 開局提示 (D-044): where crystal comes from and the nearest town, over the paused game.
   * The minimap flashes that town while this is open and for a while after; 看那座城鎮 also
   * moves the camera there. `done` runs however the dialog goes away.
   */
  /**
   * `town` null: no town known yet (a random map at its start, D-074): no ring on the minimap
   * and no 看那座城鎮.
   */
  openTownHint(lines: string[], town: { id: number; cx: number; cy: number; radius: number } | null, look: () => void, done: () => void): void {
    const card = this.openDialog(townHintTitle(this.crystal), "town-hint");
    for (const line of lines) el("p", card, "", line);
    this.flash = town === null ? null : { ...town, until: Number.POSITIVE_INFINITY };
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
        // Without crystal 選單 has no line for the hint (R15-06): 正式介面's 設定 turns it back on (the user 2026-11-08), the prototype has no 設定.
        this.game.toast(off ? "之後每一局開局都會提示" : this.crystal ? `之後開局不會再提示；選單裡的「${TOWN_HINT_MENU}」可以再看` : this.formal ? TOWN_HINT_OFF_FORMAL_TEXT : "之後開局不會再提示");
      },
      "secondary",
    );
    if (town !== null) {
      btn(
        row,
        "看那座城鎮",
        () => {
          this.closeDialog();
          look();
        },
        "secondary",
      );
    }
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
    // Not without crystal (R15-06, D-135): the hint opens at the start of a game only.
    if (this.crystal)
      btn(list, TOWN_HINT_MENU, () => {
        this.closeDialog();
        this.game.showTownHint();
      }, "secondary");
    btn(list, "兵種相剋", () => this.openCounters(), "secondary");
    // 全體回城 (D-087): always here; while the farmers hide, 回去工作.
    if (this.formal) {
      const recall = this.game.view?.header?.[H.recall] === 1;
      const home = btn(list, recall ? "回去工作" : "全體回城", () => {
        this.closeDialog();
        this.tapRecall();
      }, recall && this.formal ? "" : "secondary");
      // 正式介面 (R6-20 INV-116, NEW-06): the home; 回去工作 gold (the farmers hiding), with the work icon.
      if (this.formal) home.prepend(icon(recall ? "work" : "home"));
    }
    // 寫實地面 開／關 (ceo 2026-10-25): the player's, at once, remembered on this device; with the ground loaded only.
    const ground = this.game.groundSwitch();
    if (ground !== null) {
      const b = btn(list, `寫實地面：${ground ? "開" : "關"}`, () => {
        this.game.toggleGround();
        this.openMenu();
      }, "secondary");
      b.setAttribute("aria-pressed", ground ? "true" : "false");
    }
    // 電影色調 開／關 (the user 2026-11-02, R9-05 B): the player's, at once, remembered on this device; off by default.
    const grade = this.game.gradeSwitch();
    const gb = btn(list, `電影色調：${grade ? "開" : "關"}`, () => {
      this.game.toggleGrade();
      this.openMenu();
    }, "secondary");
    gb.setAttribute("aria-pressed", grade ? "true" : "false");
    // 介面風格 comes with 正式介面 (ceo 2026-10-19).
    if (this.formal) btn(list, "設定", () => this.openSettings(), "secondary").prepend(icon("gear"));
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

  /** 設定 (R6-20): 介面風格, A 銅木 or B 墨漆金線, at once and remembered on this device (theme.ts). */
  private openSettings(): void {
    const card = this.openDialog("設定", "menu");
    const row = el("div", card, "difficulty theme-choice");
    row.setAttribute("role", "radiogroup");
    row.setAttribute("aria-label", "介面風格");
    el("span", row, "", "介面風格");
    // 正式介面 (R6-20 NEW-07): what a tap does, at the right of the heading.
    if (this.formal) el("span", row, "theme-note", "換了馬上生效，下次打開也照這個");
    const buttons = THEMES.map((t) => {
      const b = btn(row, THEME_LABEL[t], () => {
        saveTheme(t);
        applyTheme(t);
        show();
      });
      b.setAttribute("role", "radio");
      // 正式介面 (R6-20 NEW-07): what each looks like, under its name.
      if (this.formal) {
        b.classList.add("theme-card");
        b.textContent = "";
        // A small picture of the look: a bar, a panel and three buttons in its colours (ui/r6.css).
        const thumb = el("span", b, `theme-thumb look-${t}`);
        thumb.setAttribute("aria-hidden", "true");
        el("i", thumb, "tt-bar");
        el("i", thumb, "tt-panel");
        for (const k of ["red", "blue", "gold"]) el("i", thumb, `tt-btn ${k}`);
        el("span", b, "lb", THEME_LABEL[t] + (t === "a" ? "（預設）" : ""));
        el("span", b, "sub", t === "a" ? "深色木頭、銅邊" : "深黑漆面、金色細線");
      }
      return b;
    });
    const show = () => {
      const now = loadTheme();
      THEMES.forEach((t, i) => {
        buttons[i].setAttribute("aria-checked", t === now ? "true" : "false");
        buttons[i].classList.toggle("secondary", t !== now);
        // 正式介面: the one on lit, both wood (the main button's gold is for 關閉).
        if (this.formal) {
          buttons[i].classList.add("secondary");
          buttons[i].classList.remove("pri");
          buttons[i].classList.toggle("is-active", t === now);
        }
      });
    };
    show();
    const end = el("div", card, "dialog-buttons");
    // 開局提示 開／關 (the user 2026-11-08, chose 設定裡加開關): the same as 不再提示, remembered on this device; at once.
    // At the left of the last row, so that the card still fits 932 × 336 without scrolling.
    const hintOff = loadTownHintOff();
    const hb = btn(end, `開局提示：${hintOff ? "關" : "開"}`, () => {
      saveTownHintOff(!hintOff);
      this.openSettings();
    }, "secondary town-hint-pref");
    hb.setAttribute("aria-pressed", hintOff ? "false" : "true");
    btn(end, "回選單", () => this.openMenu(), "secondary");
    btn(end, "關閉", () => this.closeDialog());
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
    // As last sent, while the simulation has not taken it yet (paused, R6-31).
    this.econ = this.game.pending.eco() ?? { food: h[H.ratioFood], wood: h[H.ratioWood], gold: h[H.ratioGold], on: h[H.ratioOn] === 1 };
    this.drawEconomy();
  }

  private drawEconomy(): void {
    const e = this.econ;
    if (e === null) return;
    const card = this.openDialog("經濟分配", "economy");
    // D-050 (core #105): the ratio now moves the farmers already gathering too, but not those sent by hand.
    el("p", card, "small", `自動分配開著時，改比例後，正在採糧、木、金的村民會照新比例重新分配；你親手派去採的不會動。${this.crystal ? "晶脈要自己派。" : ""}`);
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
    // 正式介面 (R6-20 INV-120): 自動分配 at the start of the buttons' line, the dialog no taller.
    if (this.formal) {
      toggle.classList.add("eco-toggle");
      row.appendChild(toggle);
    }
    btn(row, "套用", () => {
      this.game.command({ c: "eco_ratio", food: e.food, wood: e.wood, gold: e.gold, on: e.on });
      this.closeDialog();
    });
    btn(row, "取消", () => this.closeDialog(), "secondary");
  }

  /**
   * 搶還是治理 (also reopened by tapping the town while it waits, GDD §10). The times and 治理's
   * cost come from the rules; without the cost, 治理 says what is missing in red and still works:
   * the soldiers stay and 治理 starts by itself once it is there (等錢治理, ceo 2026-10-21).
   */
  openTownChoice(town: number): void {
    const size = this.game.view?.knownTowns.get(town)?.size;
    const big = size === TownSize.Large;
    const rule = size === undefined ? undefined : this.game.view?.rules.towns?.[size];
    const sec = (ticks: number | undefined, fallback: number) => (ticks === undefined ? fallback : Math.round(ticks / TICKS_PER_SECOND));
    // 城鎮只能搶一次 (round 7, D-061): a town plundered this game offers 治理 only.
    const once = this.game.view?.townPlunderedOnce(town) === true;
    const card = this.openDialog(`攻下${big ? "大城" : "小鎮"}！${once ? "只能治理" : "搶還是治理？"}`, "town-choice");
    // 留守 (D-026): how many soldiers stay behind with each choice.
    const keep = { plunder: this.defaultKeep(town), govern: this.defaultKeep(town) };
    // 正式介面: one 留守 for either (below), the same number from the start (ceo 2026-11-06).
    if (this.formal) keep.plunder = keep.govern;
    const row = el("div", card, "choice-row");
    if (!once) {
      const plunder = btn(row, "", () => this.chooseTown(town, TownChoice.Plunder, keep.plunder), "choice-plunder");
      el("b", plunder, "", "搶");
      el("span", plunder, "", `部隊留下搶 ${sec(rule?.plunderTicks, big ? 25 : 15)} 秒，拿一大筆${this.crystal ? "糧、金、魔晶" : "糧和金"}；城鎮變成廢墟 ${Math.round(sec(rule?.ruinsTicks, 240) / 60)} 分鐘`);
    }
    const govern = btn(row, "", () => this.chooseTown(town, TownChoice.Govern, keep.govern), "choice-govern");
    el("b", govern, "", "治理");
    const cost = this.game.governCost(town);
    el("span", govern, "", `${cost === null ? "投入金和木" : `投入 ${costText(cost)}，`}修繕 ${sec(rule?.repairTicks, big ? 60 : 45)} 秒，之後每分鐘產出、加人口；要留兵駐守`);
    const short = el("span", govern, "choice-short");
    const showShort = () => {
      const missing = this.game.governShortfall(town);
      const text = missing === null ? "" : costText(missing);
      const line = text === "" ? "" : `還差 ${text}`;
      if (short.textContent !== line) short.textContent = line;
      short.hidden = line === "";
    };
    showShort();
    this.dialogTick = showShort;
    if (once) el("p", card, "small plundered-note", PLUNDERED_TEXT);
    const keeps = el("div", card, "keep-row");
    // 正式介面 (R6-20, the user 2026-10-19: 「留守只需要一個統一的就好，反正也只能選一種」): one 留守 for either.
    if (this.formal) {
      this.keepStepper(keeps, null, town, keep.govern, (n) => {
        keep.plunder = n;
        keep.govern = n;
      });
    } else {
      if (!once) this.keepStepper(keeps, "搶", town, keep.plunder, (n) => (keep.plunder = n));
      this.keepStepper(keeps, "治理", town, keep.govern, (n) => (keep.govern = n));
    }
    // Still their groups' (the user 2026-10-26): 出城歸隊 brings them back.
    el("p", card, "small", "留守的兵守在城裡，敵人來了會反擊、不追出城，不跟「全軍」走；還算原本的編隊，軍團畫面按「出城歸隊」就回來。");
    btn(card, "稍後再決定（點城鎮也能選）", () => this.closeDialog(), "secondary later");
  }

  /**
   * How many soldiers either choice leaves behind unless the player changes it: for 搶 as for 治理
   * (D-084), the least a governed town needs (小鎮 1、大城 3), less those stationed already. Fewer
   * soldiers in the town: as many as there are (ArmyBook.station).
   */
  private defaultKeep(town: number): number {
    return Math.max(0, this.game.garrisonNeeded(town) - this.game.army.garrisonOf(town).length);
  }

  /**
   * 留守 − N + 名 under one of the two choices, or (name null: 正式介面) one for both. The most is the
   * soldiers inside the town when the button is pressed.
   */
  private keepStepper(parent: HTMLElement, name: string | null, town: number, initial: number, set: (n: number) => void): void {
    let n = initial;
    const of = name === null ? "" : `（${name}）`;
    const box = el("div", parent, "keep");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", `留守${of}`);
    el("span", box, "", name === null ? "留守" : `${name}：留守`);
    const minus = btn(box, "−", null, "secondary step");
    minus.setAttribute("aria-label", `少留守 1 名${of}`);
    const out = el("output", box, "", `${n}`);
    out.setAttribute("aria-label", `留守幾名${of}`);
    const plus = btn(box, "+", null, "secondary step");
    plus.setAttribute("aria-label", `多留守 1 名${of}`);
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

  /**
   * The result screen (GDD §14): 局後統計 (R13-02 A, R14-09, ui/stats/) when the game sent its timeline (D-124), both
   * interfaces (D-127); the table as before without one (an older simulation, the fake world unless a test gives one).
   */
  showResult(winner: number, reason: number, stats: GameStats): void {
    const world = stats.timeline === undefined ? null : this.game.statsWorld();
    if (stats.timeline !== undefined && world !== null) {
      const m = statsModel(winner, reason, stats.ticks, stats.timeline, world);
      this.dialogClosed();
      this.dialog.replaceChildren();
      this.dialog.className = `dialog result stats-page ${m.head.result}`;
      this.dialog.hidden = false;
      this.dialog.setAttribute("aria-label", m.head.title);
      const page = new StatsPage(this.dialog, m, this.formal, {
        restart: () => {
          this.closeDialog();
          this.life.restart();
        },
        home: () => {
          this.closeDialog();
          this.life.toStart();
        },
      });
      this.dialogGone = () => page.destroy();
      return;
    }
    const me = this.game.view?.me ?? 0;
    const title = winner === -1 ? "平手" : winner === me ? "勝利" : "失敗";
    const card = this.openDialog(title, `result ${winner === me ? "won" : winner === -1 ? "draw" : "lost"}`);
    // 正式介面 (R6-21, INV-130): a win by the enemy's main city 「敵方主城被摧毀」, as the board; a loss as before.
    const why = this.formal && winner === me && reason === GameOverReason.MainCityDestroyed ? "敵方主城被摧毀" : (GAME_OVER_REASON[reason] ?? "");
    el("p", card, "", `${why}　遊戲時間 ${clock(stats.ticks)}`);
    const table = el("table", card, "stats");
    const head = el("tr", table);
    for (const t of ["", "我方", "敵方"]) el("th", head, "", t);
    const p = stats.perPlayer;
    const other = me === 0 ? 1 : 0;
    const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
    const rows: [string, (i: number) => string][] = [
      ["採集", (i) => `糧 ${p[i].gathered.food}、木 ${p[i].gathered.wood}、金 ${p[i].gathered.gold}${this.crystal ? `、魔晶 ${p[i].gathered.crystal}` : ""}`],
      ["訓練", (i) => `${sum(p[i].unitsTrained)}`],
      ["損失", (i) => `${sum(p[i].unitsLost)}`],
      ["法師（訓練／陣亡）", (i) => `${p[i].magesTrained}／${p[i].magesLost}`],
      ["城鎮（搶／治理）", (i) => `${p[i].townsPlundered}／${p[i].townsGoverned}`],
    ];
    // D-099: siege engines, only while their feature is on (the simulation sends them then).
    if (p.some((x) => x.siegeTrained !== undefined)) rows.splice(4, 0, ["攻城砲（訓練／損失）", (i) => `${p[i].siegeTrained ?? 0}／${p[i].siegeLost ?? 0}`]);
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
