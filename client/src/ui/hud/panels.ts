// Bottom of the screen (GDD §10 草稿): selection info in the middle, the command area on the
// right. Both rebuild their buttons only when what is selected changes (a button must not
// be replaced under a finger); numbers that tick (health, progress) update in place.

import type { Mode } from "../../input/intent.ts";
import { splitRange } from "../../input/split.ts";
import {
  BuildingField as B,
  BuildingFlag,
  BuildingType,
  type CommandBody,
  HeaderField as H,
  NEUTRAL,
  NO_OWNER,
  NodeField as N,
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
import { ACTION_NAME, BUILDABLE, BUILDING_NAME, clock, costText, NODE_NAME, TOWN_STATE_NAME, UNIT_NAME } from "./names.ts";

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
  /** 分出 N 名 (D-024): select n of the selected units. */
  splitSelection(n: number): void;
  /** 改選其餘 M 名: the units the last split left behind. */
  selectRest(): void;
  lastSplit(): { picked: number[]; rest: number[] } | null;
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
      const stance = u[o + U.stance] === Stance.Hold ? "堅守" : "積極";
      const autocast = (u[o + U.flags] & UnitFlag.Autocast) !== 0 ? "　自動施放開" : "";
      status.textContent = `${ACTION_NAME[u[o + U.action]] ?? ""}　${u[o + U.owner] === view.me ? stance + autocast : ""}`;
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
    // Right after 分出 N 名: one tap to the units left behind, to split again or save another group.
    const split = this.host.lastSplit();
    if (split !== null && split.picked.length === ids.length && split.picked.every((id, i) => id === ids[i])) {
      const rest = split.rest.filter((id) => view.unitRow(id) >= 0).length;
      if (rest > 0) button(chips, `改選其餘 ${rest} 名`, "", () => this.host.selectRest(), "chip rest-chip");
    }
    this.splitRow(ids.length);
  }

  /** 分出 N 名 (D-024): − N + and 分出; N can also be typed. */
  private splitRow(total: number): void {
    const range = splitRange(total);
    if (range.max === 0) return;
    let n = range.initial;
    const row = el("div", this.el, "sel-split");
    const minus = button(row, "−", "", () => set(n - 1), "secondary step");
    minus.setAttribute("aria-label", "少分出 1 名");
    const input = el("input", row, "split-n");
    input.type = "number";
    input.inputMode = "numeric";
    input.min = `${range.min}`;
    input.max = `${range.max}`;
    input.setAttribute("aria-label", "分出幾名");
    const plus = button(row, "+", "", () => set(n + 1), "secondary step");
    plus.setAttribute("aria-label", "多分出 1 名");
    const go = button(row, "分出", "", () => this.host.splitSelection(n), "split-go");
    const set = (v: number, writeBack = true) => {
      n = Math.min(Math.max(Math.round(v), range.min), range.max);
      if (writeBack) input.value = `${n}`;
      minus.disabled = n <= range.min;
      plus.disabled = n >= range.max;
      go.setAttribute("aria-label", `分出 ${n} 名`);
    };
    // Typing: follow the digits without rewriting the box mid-edit; tidy it up when done.
    input.addEventListener("input", () => {
      if (input.value !== "" && Number.isFinite(Number(input.value))) set(Number(input.value), false);
    });
    input.addEventListener("change", () => set(input.value === "" ? n : Number(input.value)));
    set(n);
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
    let headBar: ((f: number) => void) | null = null;
    if (queue !== null) {
      for (let i = 0; i < Math.min(queueLength, 7); i++) {
        const unit = (packed >> (i * 4)) & 15;
        const q = button(queue, UNIT_NAME[unit] ?? "?", i === 0 ? "訓練中" : "取消", () => this.host.command({ c: "cancel_train", building: id, index: i }), "queue-item secondary");
        q.setAttribute("aria-label", `取消訓練第 ${i + 1} 個：${UNIT_NAME[unit] ?? ""}`);
        if (i === 0) headBar = bar(q, "queue");
      }
    }
    this.updaters.push(() => {
      const o = view.buildingRow(id);
      const b = view.curr?.snap.buildings;
      if (o < 0 || b === undefined) return;
      const max = info?.hp ?? b[o + B.hp];
      const building = b[o + B.progress] < 1000;
      hpBar(building ? b[o + B.progress] / 1000 : max > 0 ? b[o + B.hp] / max : 0);
      hpText.textContent = building ? `建造中 ${Math.floor(b[o + B.progress] / 10)}%` : `生命 ${b[o + B.hp]}/${max}`;
      const inside = b[o + B.garrisoned] > 0 ? `　躲了 ${b[o + B.garrisoned]} 名農民` : "";
      const remembered = (b[o + B.flags] & BuildingFlag.Remembered) !== 0 ? "（上次看到的樣子）" : "";
      const locked = (b[o + B.flags] & BuildingFlag.RepairLocked) !== 0 ? "剛被攻擊，暫時不能修理" : "";
      status.textContent = `${own ? locked : remembered}${inside}`;
      headBar?.(b[o + B.queueProgress] / 1000);
    });
  }

  private node(view: GameView, id: number): void {
    const row = view.nodes.get(id);
    if (row === undefined) return;
    const head = el("div", this.el, "sel-head");
    el("b", head, "", NODE_NAME[row[N.kind]] ?? "資源");
    const text = el("span", this.el, "sel-num");
    this.updaters.push(() => {
      const r = view.nodes.get(id);
      if (r !== undefined) text.textContent = `剩下 ${r[N.amount]}${r[N.visible] === 1 ? "" : "（上次看到的量）"}`;
    });
  }

  private town(view: GameView, id: number): void {
    const info = view.map.towns.find((t) => t.id === id);
    const head = el("div", this.el, "sel-head");
    el("b", head, "", info?.size === TownSize.Large ? "大城" : "小鎮");
    const status = el("span", head, "sel-status");
    const text = el("span", this.el, "sel-num");
    const o0 = view.townRow(id);
    const t0 = view.curr?.snap.towns;
    if (o0 >= 0 && t0 !== undefined && t0[o0 + T.state] === TownState.AwaitingChoice && t0[o0 + T.owner] === view.me) {
      const row = el("div", this.el, "sel-choice");
      button(row, "搶", "", () => this.host.chooseTown(id, TownChoice.Plunder), "choice-plunder");
      button(row, "治理", "", () => this.host.chooseTown(id, TownChoice.Govern), "choice-govern");
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
      const parts = [`民兵 ${t[o + T.militia]}`, `駐軍 ${t[o + T.garrison]}/${t[o + T.garrisonNeeded]}`];
      if (t[o + T.timer] > 0) parts.push(`剩 ${clock(t[o + T.timer])}`);
      if (t[o + T.revoltTimer] > 0) parts.push(`駐軍不足，${clock(t[o + T.revoltTimer])} 後叛離`);
      text.textContent = parts.join("　");
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
    const key = `${this.keyFor(view)}|${this.page}|${this.host.mode()}`;
    if (key === this.key) return;
    this.key = key;
    this.el.replaceChildren();
    this.build(view);
  }

  private keyFor(view: GameView): string {
    const sel = view.selection;
    const u = view.curr?.snap.units;
    if (sel.units.length > 0 && u !== undefined) {
      const stances = sel.units.map((id) => {
        const o = view.unitRow(id);
        return o < 0 ? "" : `${u[o + U.type]}${u[o + U.stance]}${(u[o + U.flags] & UnitFlag.Autocast) !== 0 ? "a" : ""}`;
      });
      return `u:${[...new Set(stances)].sort().join(",")}`;
    }
    if (sel.building !== null) {
      const o = view.buildingRow(sel.building);
      const b = view.curr?.snap.buildings;
      return o < 0 || b === undefined ? "none" : `b:${b[o + B.type]}:${b[o + B.progress] >= 1000 ? 1 : 0}`;
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
      if (types.has(UnitType.Farmer)) button(this.el, "建造", "", () => this.setPage("build"));
      const retreat = button(this.el, mode === "retreat" ? "取消撤退" : "撤退", "", () => this.host.setMode(mode === "retreat" ? "normal" : "retreat"));
      if (mode === "retreat") retreat.classList.add("active");
      const aggressive = sel.units.some((id) => view.unitStance(id) === Stance.Aggressive);
      button(this.el, aggressive ? "改成堅守" : "改成積極", aggressive ? "目前積極" : "目前堅守", () =>
        this.host.command({ c: "stance", u: sel.units, stance: aggressive ? Stance.Hold : Stance.Aggressive }),
      );
      button(this.el, "停止", "", () => this.host.command({ c: "stop", u: sel.units }), "secondary");
      if (types.has(UnitType.Mage)) {
        const mages = sel.units.filter((id) => view.unitType(id) === UnitType.Mage);
        const cast = button(this.el, mode === "cast" ? "取消晶砲" : "晶砲", "魔晶 5", () => this.host.setMode(mode === "cast" ? "normal" : "cast"));
        if (mode === "cast") cast.classList.add("active");
        const on = mages.every((id) => view.unitAutocast(id));
        button(this.el, on ? "自動施放：開" : "自動施放：關", "", () => this.host.command({ c: "autocast", u: mages, on: !on }), "secondary");
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
          button(this.el, "建造", "", () => this.setPage("build"));
        }
      }
      return;
    }
    // Nothing selected (or only looking at a resource, a town or someone else's building):
    // 建造 still works, and the simulation sends the nearest farmers (D-024).
    button(this.el, "建造", "", () => this.setPage("build"));
  }

  private buildMenu(view: GameView): void {
    for (const type of BUILDABLE) {
      const info = view.rules.buildings[type];
      if (info === undefined) continue;
      button(this.el, BUILDING_NAME[type] ?? "", costText(info.cost), () => {
        this.page = "main";
        this.host.startPlacement(type);
      });
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

  constructor(parent: HTMLElement) {
    this.el = el("div", parent, "res-bar");
    this.el.setAttribute("aria-label", "資源");
  }

  update(view: GameView | null): void {
    const h = view?.header;
    if (h === null || h === undefined) return;
    const text = `糧 ${h[H.food]}　木 ${h[H.wood]}　金 ${h[H.gold]}　晶 ${h[H.crystal]}　人口 ${h[H.population]}/${h[H.populationCap]}`;
    if (text === this.text) return;
    this.text = text;
    this.el.textContent = text;
  }
}

