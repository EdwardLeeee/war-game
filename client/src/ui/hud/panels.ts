// Bottom of the screen (GDD §10 草稿): selection info in the middle, the command area on the
// right. Both rebuild their buttons only when what is selected changes (a button must not
// be replaced under a finger); numbers that tick (health, progress) update in place.

import { GROUP_TYPES, isSoldier } from "../../game/army.ts";
import { DISPATCH_SHARES, type DispatchPool, dispatchCount, NODE_RESOURCE, RESOURCE_WORD } from "../../game/dispatch.ts";
import { buildable, features, garrisonTypes, holdsOf, missingFor } from "../../game/features.ts";
import { allIn, orderCounts, orderState, type OrderState } from "../../game/orders.ts";
import type { Mode } from "../../input/intent.ts";
import {
  AUTO_TRAIN,
  BuildingField as B,
  BuildingFlag,
  BuildingType,
  type CommandBody,
  NEUTRAL,
  NO_OWNER,
  NodeField as N,
  type Resource,
  Stance,
  TownChoice,
  TownField as T,
  TownSize,
  TownState,
  UnitField as U,
  UnitFlag,
  UnitType,
} from "../../sim.ts";
import type { GameView } from "../../view/view.ts";
import { ACTION_NAME, BUILDABLE, BUILDING_NAME, clock, costText, NODE_NAME, resourceLine, TOWN_STATE_NAME, UNIT_NAME } from "./names.ts";

/** ＋遠程／＋法師 (D-080): the short word on a panel's call-in button. */
const CALL_WORD: Record<number, string> = { [UnitType.Ranged]: "遠程", [UnitType.Mage]: "法師" };

/** What the bottom panels ask of the game. */
export interface PanelHost {
  view(): GameView | null;
  mode(): Mode;
  command(cmd: CommandBody): void;
  setMode(mode: Mode): void;
  startPlacement(type: BuildingType): void;
  openEconomy(): void;
  chooseTown(town: number, choice: TownChoice): void;
  selectOnly(units: number[]): void;
  /** Nothing selected (tapping the ground would order the selected units to go there). */
  clearSelection(): void;
  /** 留守 (D-026): how many soldiers are stationed in the town, and one more or one fewer. */
  garrison(town: number): number;
  garrisonMore(town: number): void;
  garrisonLess(town: number): void;
  /** A line in the message strip. */
  notify(text: string): void;
  /** 撤退 with units selected: pick where to (D-059). */
  retreat(): void;
  /** 派村民 (D-061): whom a tap on this node can send, and sending a share of them. */
  dispatchPool(node: number): DispatchPool | null;
  dispatch(node: number, share: number): void;
  /** 點存放建築派村民 (D-066): the resources this building of ours takes, how many gather each for it, and one more. */
  depotResources(building: number): Resource[];
  depotWorkers(building: number, resource: Resource): number;
  depotSend(building: number, resource: Resource): void;
  depotTake(building: number, resource: Resource): void;
  /** ＋遠程／＋法師 (D-080): our soldiers on their way to hide in this building, and calling one more of a type in. */
  hidingComing(building: number): number;
  callToHide(building: number, type: number): void;
  /** 取消即堅守 (D-054): out of 進攻／撤退, the soldiers selected stop and hold. */
  cancelToHold(): void;
  /** 編隊自動補兵 (D-026): its switch, and flipping it. */
  groupRefill(i: number): boolean;
  toggleRefill(i: number): void;
  /** 軍團畫面 (D-054): the group shown in place of the selection info, or null. */
  groupView(): number | null;
  /** Soldiers of this type group i wants (目標) and has alive (現有). */
  groupWant(i: number, type: number): number;
  groupHas(i: number, type: number): number;
  setGroupWant(i: number, type: number, n: number): void;
  clearGroup(i: number): void;
  /** 改成剛才選的 N 名: how many, and doing it. */
  beforeGroupCount(): number;
  saveBeforeIntoGroup(i: number): void;
  /** 收起 (D-054): the panel shows its title line only; kept for this game. */
  collapsed(): boolean;
  toggleCollapsed(): void;
  /** 預留 (D-054): the reserve 自動訓練 leaves untouched, set in a dialog. */
  openReserve(): void;
}

/**
 * 自動訓練 (D-054): what an own barracks, range or mage hall is doing about it, from its flags;
 * null for other buildings.
 */
export function autoTrainText(type: number, flags: number): string | null {
  if (!AUTO_TRAIN.buildings.includes(type)) return null;
  if ((flags & BuildingFlag.AutoPopulationFull) !== 0) return "人口滿了，蓋民居";
  return (flags & BuildingFlag.AutoTrain) !== 0 ? "自動訓練中" : "自動訓練暫停";
}

/**
 * 進攻／撤退／堅守, the three orders for soldiers (D-050: 「指揮軍團進攻與撤退還有堅守的指令仍然
 * 不明確」), a line each in the player's words, under the selection.
 */
export const ORDER_TEXT = {
  advance: "進攻：點地面或小地圖，整隊前進，遇到敵人一起打",
  retreat: "撤退：點地面或小地圖撤到那裡，點主城回家",
  hold: "堅守：停在原地，敵人進到射程就打，不追出去",
} as const;
/**
 * While every soldier selected is retreating, the 撤退 line says what a tap does now (D-061):
 * it moves the retreat, it is no 進攻. In place of the line, so the panel does not grow.
 */
export const RETREAT_NOW_TEXT = "撤退中：點地面或小地圖改撤退位置，到了原地堅守";
/** Under a town plundered this game (round 7, D-061): only 治理 is offered. */
export const PLUNDERED_TEXT = "這座城這局已經被搶過，只能治理";

/**
 * 治理 income of our town (round 7, D-061), from the town's `incomePermille`: a plundered town
 * pays less at first and climbs back while governed. Null while it is not governed or repaired.
 */
export function incomeText(permille: number, state: number): string | null {
  const pct = `${Math.round(permille / 10)}%`;
  if (state === TownState.Governed) return permille < 1000 ? `收入 ${pct}，慢慢回升` : "收入 100%";
  if (state === TownState.Repairing) return permille < 1000 ? `修好後收入 ${pct}，慢慢回升` : null;
  return null;
}

/** The 「目前：」 line's words, in its order (D-054 adds 待命: standing, not 進攻中). */
export const ORDER_NAME: Record<OrderState, string> = { advance: "進攻中", retreat: "撤退中", hold: "堅守", idle: "待命", garrison: "躲在建築裡" };

/**
 * 隊形 in the player's words (GDD §9, D-027, D-028), a line each. 散開 has a second line for
 * what it costs, since its effect is limited and the player is told so (D-028).
 */
export const FORMATION_TEXT = {
  close: ["密集：站位間隔 1 格，火力集中"],
  // D-054 (core round 6 PR C): a squad that is loose keeps its spacing while it marches, chases and fights too.
  loose: ["散開：站位間隔 2 格，站好時一發晶砲只炸得到 1 名", "行軍、追擊、交戰時也盡量保持 2 格；隊伍較寬，過窄路較慢"],
} as const;
export const FORMATION_MIXED_TEXT = "隊形：有的密集、有的散開";

/** The formation of the soldiers among these units: loose (true), close (false), "mixed", or null when there is no soldier. */
export function formationOf(view: GameView, ids: number[]): boolean | "mixed" | null {
  const soldiers = ids.filter((id) => isSoldier(view.unitType(id)));
  if (soldiers.length === 0) return null;
  const loose = soldiers.filter((id) => view.unitLoose(id)).length;
  return loose === 0 ? false : loose === soldiers.length ? true : "mixed";
}

/** The line above the three: 「目前：進攻中 4、堅守 2」. */
export function orderNowText(counts: Record<OrderState, number>): string {
  const parts = (Object.keys(ORDER_NAME) as OrderState[]).filter((s) => counts[s] > 0).map((s) => `${ORDER_NAME[s]} ${counts[s]}`);
  return `目前：${parts.join("、")}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, parent: HTMLElement, cls = "", text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== "") e.className = cls;
  if (text !== "") e.textContent = text;
  parent.appendChild(e);
  return e;
}

function button(parent: HTMLElement, label: string, sub: string, onTap: () => void, cls = ""): HTMLButtonElement {
  const b = el("button", parent, cls);
  b.type = "button";
  el("span", b, "label", label);
  if (sub !== "") el("span", b, "sub", sub);
  b.addEventListener("click", onTap);
  return b;
}

function bar(parent: HTMLElement, cls: string): (frac: number) => void {
  const back = el("div", parent, `bar ${cls}`);
  const fill = el("div", back, "fill");
  return (frac) => {
    fill.style.width = `${Math.round(Math.min(Math.max(frac, 0), 1) * 100)}%`;
  };
}

type Updater = () => void;

// --- selection info ---------------------------------------------------------------------

export class SelectionInfo {
  readonly el: HTMLElement;
  private readonly host: PanelHost;
  private key = "";
  private updaters: Updater[] = [];

  constructor(parent: HTMLElement, host: PanelHost) {
    this.host = host;
    this.el = el("section", parent, "sel-info");
    this.el.setAttribute("aria-label", "選取資訊");
    this.el.hidden = true;
  }

  update(): void {
    const view = this.host.view();
    const snap = view?.curr?.snap;
    if (view === null || snap === undefined) return;
    const key = this.keyFor(view);
    if (key !== this.key) {
      this.key = key;
      this.updaters = [];
      this.el.replaceChildren();
      this.el.hidden = key === "none";
      if (key !== "none") this.build(view);
    }
    for (const u of this.updaters) u();
  }

  private keyFor(view: GameView): string {
    const sel = view.selection;
    const group = this.host.groupView();
    if (group !== null) return `g:${group}`;
    if (sel.units.length > 0) return `u:${sel.units.join(",")}`;
    if (sel.building !== null) {
      const o = view.buildingRow(sel.building);
      const b = view.curr?.snap.buildings;
      return o < 0 || b === undefined ? "none" : `b:${sel.building}:${b[o + B.queueLength]}:${b[o + B.progress] >= 1000 ? 1 : 0}`;
    }
    const p = view.inspected;
    if (p !== null) {
      if (p.kind === "town") {
        const o = view.townRow(p.id);
        return `t:${p.id}:${o < 0 ? -1 : view.curr?.snap.towns[o + T.state]}:${o < 0 ? -1 : view.curr?.snap.towns[o + T.owner]}`;
      }
      return `i:${p.kind}:${p.id}`;
    }
    return "none";
  }

  private build(view: GameView): void {
    const close = button(this.el, "✕", "", () => this.host.clearSelection(), "sel-close secondary");
    close.setAttribute("aria-label", "取消選取");
    this.content(view);
    // 收起 (D-054: 「要有一個把資訊欄位收起來的鍵，不然進攻的時候擋掉太多視野」): at the end of the title line.
    const head = this.el.querySelector<HTMLElement>(".sel-head");
    if (head === null) return;
    const fold = button(head, "", "", () => {
      this.host.toggleCollapsed();
      this.fold(fold);
    }, "sel-fold secondary");
    this.fold(fold);
  }

  /** Show the panel folded or not, as the game keeps it; the button says what a tap does. */
  private fold(b: HTMLButtonElement): void {
    const collapsed = this.host.collapsed();
    this.el.classList.toggle("collapsed", collapsed);
    const label = b.querySelector(".label") as HTMLElement;
    label.textContent = collapsed ? "展開" : "收起";
    b.setAttribute("aria-label", collapsed ? "展開選取資訊" : "收起選取資訊");
  }

  private content(view: GameView): void {
    const group = this.host.groupView();
    if (group !== null) return this.groupPanel(view, group);
    const sel = view.selection;
    if (sel.units.length === 1) return this.oneUnit(view, sel.units[0]);
    if (sel.units.length > 1) return this.manyUnits(view, sel.units);
    if (sel.building !== null) return this.building(view, sel.building);
    const p = view.inspected;
    if (p === null) return;
    if (p.kind === "unit") return this.oneUnit(view, p.id);
    if (p.kind === "building") return this.building(view, p.id);
    if (p.kind === "node") return this.node(view, p.id);
    if (p.kind === "town") return this.town(view, p.id);
  }

  /**
   * 軍團畫面 (D-054, the user's choice: a tap on a group button selects it and shows this): how
   * many of each soldier type it has and wants, − and + for each, 改成剛才選的 N 名 (what was
   * selected before the tap), 清空 and 自動補兵. 進攻／撤退／堅守 are the command area's, beside it.
   */
  private groupPanel(view: GameView, i: number): void {
    const head = el("div", this.el, "sel-head");
    el("b", head, "", `編隊 ${i + 1}`);
    // 現有／目標 in the title line; no 「目前：」 line (the command area's buttons light up), so
    // that the panel stays clear of 全軍撤退 on a phone held sideways.
    const total = el("span", head, "sel-status");
    const types = GROUP_TYPES.filter((type) => type !== UnitType.Cavalry || features(view.rules).cavalry);
    // Four kinds with 騎兵 (round 7): two to a line, the name over its − N +, or the panel
    // would reach 全軍撤退 on a phone held sideways. Three kinds keep a line each.
    const grid = types.length > 3 ? el("div", this.el, "group-grid") : null;
    const rows = types.map((type) => {
      const name = UNIT_NAME[type] ?? "兵";
      const row = el("div", grid ?? this.el, "group-row");
      const label = grid !== null ? el("div", row, "group-label") : row;
      el("span", label, "group-type", name);
      const has = el("span", label, "group-has");
      const minus = button(row, "−", "", () => this.host.setGroupWant(i, type, this.host.groupWant(i, type) - 1), "secondary step");
      minus.setAttribute("aria-label", `少要 1 名${name}`);
      const want = el("b", row, "group-want");
      want.setAttribute("role", "status");
      want.setAttribute("aria-label", `${name}要幾名`);
      const plus = button(row, "+", "", () => this.host.setGroupWant(i, type, this.host.groupWant(i, type) + 1), "secondary step");
      plus.setAttribute("aria-label", `多要 1 名${name}`);
      return { type, has, want };
    });
    const actions = el("div", this.el, "sel-chips group-actions");
    const fromBefore = button(actions, "", "", () => this.host.saveBeforeIntoGroup(i), "chip secondary");
    button(actions, "清空", "", () => this.host.clearGroup(i), "chip secondary");
    const refill = button(actions, "", "", () => this.host.toggleRefill(i), "chip refill-chip secondary");
    const set = (e: HTMLElement, text: string) => {
      if (e.textContent !== text) e.textContent = text;
    };
    this.updaters.push(() => {
      let has = 0;
      let want = 0;
      for (const r of rows) {
        const h = this.host.groupHas(i, r.type);
        const w = this.host.groupWant(i, r.type);
        has += h;
        want += w;
        set(r.has, `現有 ${h}`);
        set(r.want, `${w}`);
      }
      set(total, has > 0 || want > 0 ? `${has}/${want}` : "還沒有兵");
      const n = this.host.beforeGroupCount();
      fromBefore.hidden = n === 0;
      set(fromBefore.querySelector(".label") as HTMLElement, `改成剛才選的 ${n} 名`);
      set(refill.querySelector(".label") as HTMLElement, `自動補兵：${this.host.groupRefill(i) ? "開" : "關"}`);
    });
  }

  private oneUnit(view: GameView, id: number): void {
    const type = view.unitType(id);
    const info = view.rules.units[type];
    const head = el("div", this.el, "sel-head");
    el("b", head, "", UNIT_NAME[type] ?? "單位");
    const status = el("span", head, "sel-status");
    const hpBar = bar(this.el, "hp");
    const hpText = el("span", this.el, "sel-num");
    const shieldBar = info !== undefined && info.shield > 0 ? bar(this.el, "shield") : null;
    this.updaters.push(() => {
      const o = view.unitRow(id);
      const u = view.curr?.snap.units;
      if (o < 0 || u === undefined) return;
      const max = info?.hp ?? u[o + U.hp];
      hpBar(max > 0 ? u[o + U.hp] / max : 0);
      let text = `生命 ${u[o + U.hp]}/${max}`;
      if (shieldBar !== null && info !== undefined) {
        shieldBar(u[o + U.shield] / info.shield);
        text += `　防護罩 ${u[o + U.shield]}/${info.shield}`;
      }
      if (u[o + U.carryAmount] > 0) text += `　搬運 ${u[o + U.carryAmount]}`;
      hpText.textContent = text;
      const mine = u[o + U.owner] === view.me;
      // 進攻／撤退／堅守 is in the note below (D-050); farmers have none.
      const autocast = mine && (u[o + U.flags] & UnitFlag.Autocast) !== 0 ? "　自動施放開" : "";
      status.textContent = `${ACTION_NAME[u[o + U.action]] ?? ""}${autocast}`;
    });
    this.orderNote(view, [id]);
  }

  /**
   * Small lines under an own selection with soldiers: which of 進攻／撤退／堅守 they are in,
   * what each of the three does (D-050), then what their formation means (D-027).
   */
  private orderNote(view: GameView, ids: number[]): void {
    const u = view.curr?.snap.units;
    const mine = (id: number): boolean => {
      const o = view.unitRow(id);
      return o >= 0 && u !== undefined && u[o + U.owner] === view.me;
    };
    if (!ids.every(mine) || orderCounts(view, ids) === null) return;
    const note = el("p", this.el, "sel-note");
    const now = el("span", note, "order-now");
    el("span", note, "order-meaning", ORDER_TEXT.advance);
    const retreat = el("span", note, "order-meaning", ORDER_TEXT.retreat);
    el("span", note, "order-meaning", ORDER_TEXT.hold);
    const formation = el("span", note, "formation-meaning");
    const formationMore = el("span", note, "formation-more");
    this.updaters.push(() => {
      const counts = orderCounts(view, ids);
      const text = counts === null ? "" : orderNowText(counts);
      if (now.textContent !== text) now.textContent = text;
      const retreating = allIn(view, ids, "retreat");
      const retreatLine = retreating ? RETREAT_NOW_TEXT : ORDER_TEXT.retreat;
      if (retreat.textContent !== retreatLine) retreat.textContent = retreatLine;
      retreat.classList.toggle("order-hint", retreating);
      const f = formationOf(view, ids);
      const lines: readonly string[] = f === null ? [] : f === "mixed" ? [FORMATION_MIXED_TEXT] : FORMATION_TEXT[f ? "loose" : "close"];
      if (formation.textContent !== (lines[0] ?? "")) formation.textContent = lines[0] ?? "";
      // An empty line takes no height (the spans are blocks).
      if (formationMore.textContent !== (lines[1] ?? "")) formationMore.textContent = lines[1] ?? "";
    });
  }

  private manyUnits(view: GameView, ids: number[]): void {
    const counts = new Map<number, number[]>();
    for (const id of ids) {
      const t = view.unitType(id);
      counts.set(t, [...(counts.get(t) ?? []), id]);
    }
    el("b", el("div", this.el, "sel-head"), "", `已選 ${ids.length} 個單位`);
    const chips = el("div", this.el, "sel-chips");
    for (const [type, list] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
      // Tapping a type keeps only that type selected.
      button(chips, `${UNIT_NAME[type] ?? "單位"} ×${list.length}`, "", () => this.host.selectOnly(list), "chip secondary");
    }
    this.orderNote(view, ids);
  }

  private building(view: GameView, id: number): void {
    const o0 = view.buildingRow(id);
    const b0 = view.curr?.snap.buildings;
    if (o0 < 0 || b0 === undefined) return;
    const type = b0[o0 + B.type];
    const info = view.rules.buildings[type];
    const own = b0[o0 + B.owner] === view.me;
    const head = el("div", this.el, "sel-head");
    el("b", head, "", BUILDING_NAME[type] ?? "建築");
    const status = el("span", head, "sel-status");
    const hpBar = bar(this.el, "hp");
    const hpText = el("span", this.el, "sel-num");
    const queue = own ? el("div", this.el, "sel-queue") : null;
    const queueLength = b0[o0 + B.queueLength];
    const packed = b0[o0 + B.queuePacked];
    // 躲進建築 (round 7, D-061): how many soldiers hide in our main city or arrow tower, and 全部出來;
    // ＋遠程／＋法師 call one more in from here (D-080).
    const holds = own ? holdsOf(view.rules, type) : 0;
    let hidden: HTMLElement | null = null;
    let out: HTMLButtonElement | null = null;
    const calls: HTMLButtonElement[] = [];
    if (holds > 0) {
      const row = el("div", this.el, "sel-garrison");
      hidden = el("span", row, "garrison-count");
      for (const t of garrisonTypes(view.rules)) {
        const call = button(row, `＋${CALL_WORD[t] ?? UNIT_NAME[t] ?? ""}`, "", () => this.host.callToHide(id, t), "chip secondary");
        call.setAttribute("aria-label", `叫 1 名${UNIT_NAME[t] ?? ""}躲進來`);
        calls.push(call);
      }
      out = button(row, "全部出來", "", () => this.host.command({ c: "leave", building: id }), "chip secondary");
    }
    let headBar: ((f: number) => void) | null = null;
    if (queue !== null) {
      for (let i = 0; i < Math.min(queueLength, 7); i++) {
        const unit = (packed >> (i * 4)) & 15;
        const q = button(queue, UNIT_NAME[unit] ?? "?", i === 0 ? "訓練中" : "取消", () => this.host.command({ c: "cancel_train", building: id, index: i }), "queue-item secondary");
        q.setAttribute("aria-label", `取消訓練第 ${i + 1} 個：${UNIT_NAME[unit] ?? ""}`);
        if (i === 0) headBar = bar(q, "queue");
      }
    }
    const depot = own ? this.depot(id) : null;
    this.updaters.push(() => {
      const o = view.buildingRow(id);
      const b = view.curr?.snap.buildings;
      if (o < 0 || b === undefined) return;
      depot?.();
      const max = info?.hp ?? b[o + B.hp];
      const building = b[o + B.progress] < 1000;
      hpBar(building ? b[o + B.progress] / 1000 : max > 0 ? b[o + B.hp] / max : 0);
      hpText.textContent = building ? `建造中 ${Math.floor(b[o + B.progress] / 10)}%` : `生命 ${b[o + B.hp]}/${max}`;
      const inside = b[o + B.garrisoned] > 0 ? `　躲了 ${b[o + B.garrisoned]} 名村民` : !own && (b[o + B.flags] & BuildingFlag.Occupied) !== 0 ? "　裡面有人" : "";
      if (hidden !== null && out !== null) {
        const n = b[o + B.soldiers];
        const coming = this.host.hidingComing(id);
        const line = `躲了 ${n} 名士兵（最多 ${holds} 名）${coming > 0 ? `，${coming} 名正過來` : ""}`;
        if (hidden.textContent !== line) hidden.textContent = line;
        out.disabled = n === 0;
        for (const call of calls) call.disabled = n + coming >= holds;
      }
      const remembered = (b[o + B.flags] & BuildingFlag.Remembered) !== 0 ? "（上次看到的樣子）" : "";
      const locked = (b[o + B.flags] & BuildingFlag.RepairLocked) !== 0 ? "剛被攻擊，暫時不能修理" : "";
      const auto = own ? (autoTrainText(type, b[o + B.flags]) ?? "") : "";
      status.textContent = `${own ? [locked, auto].filter((t) => t !== "").join("　") : remembered}${inside}`;
      headBar?.(b[o + B.queueProgress] / 1000);
    });
  }

  /**
   * 點存放建築派村民 (D-066): how many villagers gather here, − and ＋ for one less or more; a
   * line per resource (granary, lumber camp and mine take one each; the main city shows none,
   * D-070). Returns the update.
   */
  private depot(id: number): (() => void) | null {
    const resources = this.host.depotResources(id);
    if (resources.length === 0) return null;
    const box = el("div", this.el, "depot");
    const cells = resources.map((r) => {
      const word = RESOURCE_WORD[r] ?? "";
      const cell = el("div", box, "depot-cell");
      const count = el("span", cell, "depot-count");
      const steps = el("div", cell, "depot-steps");
      const minus = button(steps, "−", "", () => this.host.depotTake(id, r), "secondary step");
      minus.setAttribute("aria-label", `少派 1 名村民採${word}`);
      const plus = button(steps, "+", "", () => this.host.depotSend(id, r), "secondary step");
      plus.setAttribute("aria-label", `多派 1 名村民採${word}`);
      return { r, word, count, minus };
    });
    return () => {
      for (const c of cells) {
        const n = this.host.depotWorkers(id, c.r);
        const text = `附近有 ${n} 名村民在採${c.word}`;
        if (c.count.textContent !== text) c.count.textContent = text;
        c.minus.disabled = n === 0;
      }
    };
  }

  private node(view: GameView, id: number): void {
    const row = view.nodes.get(id);
    if (row === undefined) return;
    const head = el("div", this.el, "sel-head");
    el("b", head, "", NODE_NAME[row[N.kind]] ?? "資源");
    const text = el("span", this.el, "sel-num");
    // 派村民 (D-061): a share of those gathering the same resource elsewhere, nearest first.
    const word = RESOURCE_WORD[NODE_RESOURCE[row[N.kind]]] ?? "";
    const whom = el("span", this.el, "dispatch-whom");
    const shares = el("div", this.el, "sel-chips dispatch-shares");
    shares.setAttribute("role", "group");
    shares.setAttribute("aria-label", "派村民");
    const buttons = DISPATCH_SHARES.map((s) => ({ s, b: button(shares, "", "", () => this.host.dispatch(id, s.share), "chip secondary") }));
    this.updaters.push(() => {
      const r = view.nodes.get(id);
      if (r !== undefined) text.textContent = `剩下 ${r[N.amount]}${r[N.visible] === 1 ? "" : "（上次看到的量）"}`;
      const pool = this.host.dispatchPool(id);
      const n = pool?.ids.length ?? 0;
      const line = n === 0 ? `沒有可以派的村民（沒人在採別處的${word}，也沒有閒置的）` : pool?.from === "same" ? `派採${word}的村民過來（別處有 ${n} 名）` : `沒人在採別處的${word}：派閒置的村民過來（${n} 名）`;
      if (whom.textContent !== line) whom.textContent = line;
      for (const { s, b } of buttons) {
        const k = dispatchCount(n, s.share);
        const label = `${s.label}（${k} 名）`;
        const span = b.querySelector(".label") as HTMLElement;
        if (span.textContent !== label) span.textContent = label;
        b.setAttribute("aria-label", `派${s.label === "全部" ? "全部" : ` ${s.label} `}村民過來：${k} 名`);
        b.disabled = k === 0;
      }
    });
  }

  private town(view: GameView, id: number): void {
    const info = view.knownTowns.get(id);
    const head = el("div", this.el, "sel-head");
    el("b", head, "", info?.size === TownSize.Large ? "大城" : "小鎮");
    const status = el("span", head, "sel-status");
    const text = el("span", this.el, "sel-num");
    const o0 = view.townRow(id);
    const t0 = view.curr?.snap.towns;
    if (o0 >= 0 && t0 !== undefined && t0[o0 + T.state] === TownState.AwaitingChoice && t0[o0 + T.owner] === view.me) {
      const row = el("div", this.el, "sel-choice");
      // 城鎮只能搶一次 (round 7): a town plundered this game can only be governed.
      if (!view.townPlunderedOnce(id)) button(row, "搶", "", () => this.host.chooseTown(id, TownChoice.Plunder), "choice-plunder");
      button(row, "治理", "", () => this.host.chooseTown(id, TownChoice.Govern), "choice-govern");
      if (view.townPlunderedOnce(id)) el("p", this.el, "sel-note", PLUNDERED_TEXT);
    }
    // 留守 − N + 名 (D-026), for a town we hold.
    if (o0 >= 0 && t0 !== undefined && t0[o0 + T.owner] === view.me && t0[o0 + T.state] !== TownState.Neutral && t0[o0 + T.state] !== TownState.Ruins) {
      const row = el("div", this.el, "sel-keep");
      row.setAttribute("role", "group");
      row.setAttribute("aria-label", "留守");
      el("span", row, "", "留守");
      const minus = button(row, "−", "", () => this.host.garrisonLess(id), "secondary step");
      minus.setAttribute("aria-label", "少留守 1 名");
      const count = el("output", row);
      count.setAttribute("aria-label", "留守幾名");
      const plus = button(row, "+", "", () => this.host.garrisonMore(id), "secondary step");
      plus.setAttribute("aria-label", "多留守 1 名");
      el("span", row, "", "名");
      el("p", this.el, "sel-note", "留守的兵改成堅守，不跟全軍走");
      this.updaters.push(() => {
        const n = `${this.host.garrison(id)}`;
        if (count.textContent !== n) count.textContent = n;
      });
    }
    this.updaters.push(() => {
      const o = view.townRow(id);
      const t = view.curr?.snap.towns;
      if (o < 0 || t === undefined) {
        status.textContent = "還沒探索";
        return;
      }
      const owner = t[o + T.owner];
      const who = owner === view.me ? "我方" : owner === NO_OWNER || owner === NEUTRAL ? "" : "敵方";
      status.textContent = `${who}${TOWN_STATE_NAME[t[o + T.state]] ?? ""}`;
      // Two different counts for our own town: every soldier of ours inside it now, and the
      // ones told to stay (留守, below), who do not leave with 全軍.
      const inside = owner === view.me ? `城裡有 ${t[o + T.garrison]} 名兵（至少要 ${t[o + T.garrisonNeeded]} 名）` : `駐軍 ${t[o + T.garrison]}/${t[o + T.garrisonNeeded]}`;
      const parts = [`民兵 ${t[o + T.militia]}`, inside];
      if (t[o + T.timer] > 0) parts.push(`剩 ${clock(t[o + T.timer])}`);
      if (t[o + T.revoltTimer] > 0) parts.push(`駐軍不足，${clock(t[o + T.revoltTimer])} 後叛離`);
      // 治理 income (round 7, D-061), while the rule is on.
      const income = owner === view.me && features(view.rules).plunderOnce ? incomeText(t[o + T.incomePermille], t[o + T.state]) : null;
      if (income !== null) parts.push(income);
      // Lines break between the parts, not inside one (「收入 25%，慢\n慢回升」).
      const line = parts.join("　");
      if (text.dataset.line !== line) {
        text.dataset.line = line;
        text.replaceChildren(...parts.flatMap((p, i) => [...(i > 0 ? ["　"] : []), el("span", text, "nowrap", p)]));
      }
    });
  }
}

// --- command area -----------------------------------------------------------------------

export class CommandArea {
  readonly el: HTMLElement;
  private readonly host: PanelHost;
  private key = "";
  private page: "main" | "build" = "main";
  /** What is selected; a new selection goes back to the first page. */
  private ident = "";

  constructor(parent: HTMLElement, host: PanelHost) {
    this.host = host;
    this.el = el("section", parent, "cmds");
    this.el.setAttribute("aria-label", "指令區");
  }

  update(): void {
    const view = this.host.view();
    if (view === null || view.curr === null) return;
    const ident = `${view.selection.units.join(",")}|${view.selection.building}`;
    if (ident !== this.ident) {
      this.ident = ident;
      this.page = "main";
    }
    // The selection itself too: the buttons act on the units it held when they were built, so
    // another soldier of the same kind needs buttons of his own.
    // On the 建造 page, what each building still needs (round 7's `requires`).
    const needs = this.page === "build" ? BUILDABLE.map((t) => missingFor(view.rules, t, view.ownFinishedTypes()).join(".")).join("/") : "";
    const key = `${ident}|${this.keyFor(view)}|${this.page}|${this.host.mode()}|${needs}`;
    if (key === this.key) return;
    this.key = key;
    this.el.replaceChildren();
    this.build(view);
    // Which selection these buttons act on (tests wait for it after selecting by hand).
    this.el.dataset.selection = view.selection.units.join(",");
  }

  private keyFor(view: GameView): string {
    const sel = view.selection;
    const u = view.curr?.snap.units;
    if (sel.units.length > 0 && u !== undefined) {
      const stances = sel.units.map((id) => {
        const o = view.unitRow(id);
        const flags = o < 0 ? 0 : u[o + U.flags];
        return o < 0 ? "" : `${u[o + U.type]}${orderState(view, id)}${(flags & UnitFlag.Autocast) !== 0 ? "a" : ""}${(flags & UnitFlag.Loose) !== 0 ? "l" : ""}`;
      });
      return `u:${[...new Set(stances)].sort().join(",")}`;
    }
    if (sel.building !== null) {
      const o = view.buildingRow(sel.building);
      const b = view.curr?.snap.buildings;
      const auto = o < 0 || b === undefined ? 0 : b[o + B.flags] & (BuildingFlag.AutoTrain | BuildingFlag.AutoPopulationFull);
      return o < 0 || b === undefined ? "none" : `b:${b[o + B.type]}:${b[o + B.progress] >= 1000 ? 1 : 0}:${auto}`;
    }
    return "none";
  }

  private build(view: GameView): void {
    const sel = view.selection;
    const mode = this.host.mode();
    // The 建造 page opens from farmers, from nothing selected or from the main city (D-024).
    if (this.page === "build") return this.buildMenu(view);
    if (sel.units.length > 0) {
      const types = new Set(sel.units.map((id) => view.unitType(id)));
      const soldiers = sel.units.filter((id) => isSoldier(view.unitType(id)));
      // 進攻／撤退／堅守 (D-050), then 停止, in the first row; the one all the soldiers are in is
      // lit. 進攻 and 撤退 both ask where to (D-059: 撤退 「跟攻擊一樣」). 取消即堅守 (D-054):
      // while they advance or retreat, or while the spot is being picked, the same button
      // reads 取消 and stops them where they are, holding.
      const counts = orderCounts(view, sel.units);
      const advancing = mode === "advance" || (mode === "normal" && allIn(view, sel.units, "advance"));
      const retreating = mode === "retreat" || (mode === "normal" && allIn(view, sel.units, "retreat"));
      if (counts !== null) {
        const advance = advancing
          ? button(this.el, "取消進攻", "停下堅守", () => this.host.cancelToHold())
          : button(this.el, "進攻", "點地面", () => this.host.setMode("advance"));
        if (advancing) advance.classList.add("active");
      }
      const retreat = retreating
        ? button(this.el, "取消撤退", "停下堅守", () => this.host.cancelToHold())
        : button(this.el, "撤退", "點地面", () => this.host.retreat());
      if (retreating) retreat.classList.add("active");
      if (counts !== null) {
        const hold = button(this.el, "堅守", "原地不動", () => {
          this.host.command({ c: "stop", u: soldiers });
          this.host.command({ c: "stance", u: soldiers, stance: Stance.Hold });
          this.host.notify(ORDER_TEXT.hold);
        });
        if (mode === "normal" && allIn(view, sel.units, "hold")) hold.classList.add("active");
      }
      button(this.el, "停止", "", () => this.host.command({ c: "stop", u: sel.units }), "secondary");
      // A tap re-forms the troops where they stand (D-028): no march order needed.
      const formation = formationOf(view, sel.units);
      if (formation !== null) {
        const loose = formation !== true;
        const now = formation === "mixed" ? "混合" : formation ? "散開" : "密集";
        const to = `${formation === "mixed" ? "全部" : ""}改成${loose ? "散開" : "密集"}`;
        button(this.el, `隊形：${now}`, `按一下${to}`, () => {
          this.host.command({ c: "formation", u: soldiers, loose });
          this.host.notify(`已${to}。${FORMATION_TEXT[loose ? "loose" : "close"][0]}`);
        }, "wide");
      }
      if (types.has(UnitType.Farmer)) button(this.el, "建造", "", () => this.setPage("build"));
      if (types.has(UnitType.Mage)) {
        const mages = sel.units.filter((id) => view.unitType(id) === UnitType.Mage);
        const cast = button(this.el, mode === "cast" ? "取消晶砲" : "晶砲", "魔晶 5", () => this.host.setMode(mode === "cast" ? "normal" : "cast"));
        if (mode === "cast") cast.classList.add("active");
        const on = mages.every((id) => view.unitAutocast(id));
        // 「自動施放：關」 broke into two lines in one column: the state goes under the name.
        button(this.el, "自動施放", on ? "目前：開" : "目前：關", () => this.host.command({ c: "autocast", u: mages, on: !on }), "secondary");
      }
      // 躲進去 (round 7, D-061): ranged units and mages hide in our main city or an arrow tower.
      const hiders = garrisonTypes(view.rules);
      if (sel.units.some((id) => hiders.includes(view.unitType(id)))) {
        const picking = mode === "garrison";
        // 「取消躲進去」 broke into two lines in one column: 取消 over 躲進去.
        const hide = picking
          ? button(this.el, "取消", "躲進去", () => this.host.setMode("normal"), "secondary")
          : button(this.el, "躲進去", "主城或箭樓", () => this.host.setMode("garrison"), "secondary");
        if (picking) hide.classList.add("active");
      }
      return;
    }
    if (sel.building !== null) {
      const o = view.buildingRow(sel.building);
      const b = view.curr?.snap.buildings;
      if (o < 0 || b === undefined || b[o + B.owner] !== view.me) return;
      const type = b[o + B.type];
      const info = view.rules.buildings[type];
      const done = b[o + B.progress] >= 1000;
      const id = sel.building;
      if (done && info !== undefined) {
        for (const unit of info.trains) {
          const u = view.rules.units[unit];
          button(this.el, `訓練${UNIT_NAME[unit] ?? ""}`, u === undefined ? "" : costText(u.cost), () => this.host.command({ c: "train", building: id, type: unit, n: 1 }));
        }
        if (info.trains.length > 0) {
          const rally = button(this.el, mode === "rally" ? "取消集結點" : "集結點", "", () => this.host.setMode(mode === "rally" ? "normal" : "rally"), "secondary");
          if (mode === "rally") rally.classList.add("active");
        }
        if (type === BuildingType.MainCity) {
          button(this.el, "經濟分配", "", () => this.host.openEconomy(), "secondary");
          // 預留 (D-054): what 自動訓練 leaves for building.
          button(this.el, "預留", "自動訓練", () => this.host.openReserve(), "secondary");
          button(this.el, "建造", "", () => this.setPage("build"));
        }
      }
      // 自動訓練 (D-054): on by default for the player; a tap pauses or resumes this building
      // (it can be set before the building is finished, too).
      if (AUTO_TRAIN.buildings.includes(type)) {
        const on = (b[o + B.flags] & BuildingFlag.AutoTrain) !== 0;
        const auto = button(this.el, "自動訓練", on ? "目前：開" : "目前：暫停", () => this.host.command({ c: "auto_train", building: id, on: !on }), "secondary");
        if (on) auto.classList.add("active");
      }
      return;
    }
    // Nothing selected (or only looking at a resource, a town or someone else's building):
    // 建造 still works, and the simulation sends the nearest farmers (D-024).
    button(this.el, "建造", "", () => this.setPage("build"));
  }

  private buildMenu(view: GameView): void {
    const owned = view.ownFinishedTypes();
    for (const type of BUILDABLE) {
      const info = view.rules.buildings[type];
      if (info === undefined || !buildable(view.rules, type)) continue;
      // Round 7's `requires`: greyed out, saying what to build first.
      const missing = missingFor(view.rules, type, owned);
      const b = button(this.el, BUILDING_NAME[type] ?? "", missing.length > 0 ? `要先蓋${missing.map((t) => BUILDING_NAME[t] ?? "").join("、")}` : costText(info.cost), () => {
        this.page = "main";
        this.host.startPlacement(type);
      });
      b.disabled = missing.length > 0;
    }
    button(this.el, "返回", "", () => this.setPage("main"), "secondary");
  }

  /** 重設: back to the first page (leaves the 建造 list). */
  reset(): void {
    this.setPage("main");
  }

  private setPage(page: "main" | "build"): void {
    this.page = page;
    this.key = "";
    this.update();
  }
}

// --- resource bar -----------------------------------------------------------------------

export class ResourceBar {
  readonly el: HTMLElement;
  private text = "";
  private room = 0;

  constructor(parent: HTMLElement) {
    this.el = el("div", parent, "res-bar");
    this.el.setAttribute("aria-label", "資源");
  }

  /** `room`: px the bar may take before the top-right buttons; one line, shortened as it must (resourceLine). */
  update(view: GameView | null, room: number): void {
    const h = view?.header;
    if (view === null || h === null || h === undefined) return;
    const lines = resourceLine(h, view.trainingCount());
    if (lines[0] === this.text && room === this.room) return;
    this.text = lines[0];
    this.room = room;
    for (const line of lines) {
      this.el.textContent = line;
      if (this.el.offsetWidth <= room) break;
    }
  }
}

