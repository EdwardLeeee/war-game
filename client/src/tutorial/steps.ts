// 新手教學 (R25, D-151): the nine steps of ui's approved boards (war-game-worktrees/ui/design/r25/build/boards/, the
// words from design/r25/common/r25.mjs), each a few phases: what the card says, what is framed, what lets the next
// phase come. Done is read from the game, never from a tap: a step already done when it comes (a barracks built
// early) is done at once. The `tutorial` commands (sim PROTOCOL 3.12) put a step's result in the game when it is
// skipped, and step 7's squad and step 9's siege works when those steps begin.

import type { Game } from "../game/game.ts";
import { usesMouse } from "../input/last-pointer.ts";
import { BuildingType, type CommandBody, TownState, type TutorialEvent, UnitType } from "../sim.ts";
import type { TutorWorld, UnitAt } from "./world.ts";

export const STEPS = 9;

/** Where the card is: under the resource bar; its title line only (軍團畫面 open); at the left (a dialog in the middle); away (the game's own prompt). */
export type Place = "top" | "slim" | "side" | "hidden";

export type TargetSpec =
  | { el: HTMLElement | null }
  | { cell: { x: number; y: number; r: number }; label?: string }
  | { units: UnitAt[] }
  | null;

export interface StepCtx {
  w: TutorWorld;
  game: Game;
  /** Step 1: dragged, pinched (or zoomed), the minimap tapped. */
  flags: { panned: boolean; pinched: boolean; minimap: boolean };
  /** The player's own commands since the phase began (not the screen's 自動 ones). */
  sentSince(): CommandBody[];
  /** A button or panel on the screen, in sight: by selector, and its words if given. */
  el(selector: string, words?: RegExp): HTMLElement | null;
  /** This screen point is on the battlefield, clear of the interface (a target there can be tapped). */
  clear(sx: number, sy: number): boolean;
  /** A `tutorial` command, once a game for all but near_home and near_home_clear. */
  send(event: TutorialEvent): void;
  /** What a phase keeps between its checks (a squad seen, a tick). */
  memo: Record<string, number>;
}

export interface Phase {
  id: string;
  step: number;
  title: string;
  body(c: StepCtx): string;
  list?(c: StepCtx): [string, boolean][];
  /** A wait's progress, 0 to 1 (the card's bar). */
  wait?(c: StepCtx): number;
  /** 帶我去看: the camera to the target when it is off the screen. */
  go?: boolean;
  /** The camera to the target as the phase begins, if it is not where a tap reaches it. */
  focus?: boolean;
  /** A building selected here is a tap gone astray (its panel would cover the target): let go of it. */
  noBuilding?: boolean;
  place?(c: StepCtx): Place | null;
  target(c: StepCtx): TargetSpec;
  /** Also let through when the frame keeps taps off (to pick the soldiers again). */
  extras?: readonly string[];
  /** Taps outside the frame do nothing (ceo 2026-11-15); 1a and 5a and waits let every tap through. */
  block: boolean;
  gesture?: "drag-pinch" | "press-box";
  /** Kept bright under the dim: the game's own prompt and 進駐's tags. */
  keep?: readonly string[];
  enter?(c: StepCtx): void;
  /** The phase to go to now, "done" when the step is done, or null to stay. */
  next(c: StepCtx): string | null;
}

export interface Step {
  n: number;
  name: string;
  first: string;
  doneTitle: string;
  /** A function where a mouse says it otherwise (R26 06 B). */
  doneBody: string | (() => string);
  /** 跳過這步: what the game needs for the steps after it (sim PROTOCOL 3.12). */
  skip?(c: StepCtx): void;
}

const SOLDIER_HELPERS = [".groups", ".army-btn", ".sel-bar", ".cmds"] as const;
const SPEARMEN = 5;
const ENGINES = 2;

const own = (c: StepCtx, type: number) => c.w.own(type);
const count = (c: StepCtx, type: number) => c.w.ownUnits([type]).length;
const selectedBuilding = (c: StepCtx) => c.game.view?.selection.building ?? null;
const town = (c: StepCtx) => c.w.towns()[0] ?? null;
const townOurs = (c: StepCtx) => {
  const t = town(c);
  return t !== null && t.owner === c.w.me;
};
/** The soldiers on the screen at hand: those selected, else all of ours (for a frame round them). */
const soldiersToBox = (c: StepCtx): UnitAt[] => c.w.ownSoldiers();

/**
 * Nobody to send (no soldier selected; step 9: no siege engine among them): 全軍 framed first, the target after
 * (a tap on the town or the city with a building selected would only look at it).
 */
const armyFirst = (c: StepCtx, siege = false): TargetSpec => {
  const sel = c.w.selectedSoldiers();
  if (sel.length > 0 && (!siege || sel.some((u) => u.type === UnitType.Siege))) return null;
  return { el: c.el(".army-btn") };
};

export const STEP_LIST: readonly Step[] = [
  { n: 1, name: "看地圖", first: "1", doneTitle: "做得好！", doneBody: "拖動看四周、縮放看清楚；小地圖點哪裡，畫面就跳到哪裡。" },
  { n: 2, name: "採集", first: "2a", doneTitle: "做得好！", doneBody: "村民會一直砍樹、搬回來。之後主城練出的新村民，會照主城的「<b>經濟分配</b>」自己去做事。" },
  { n: 3, name: "蓋兵營", first: "3a", doneTitle: "做得好！", doneBody: "兵營蓋好了。民居不用自己蓋：人口快滿時，主城會自動蓋。", skip: (c) => c.send("houses") },
  { n: 4, name: "練兵", first: "4a", doneTitle: "做得好！", doneBody: "5 名槍兵練好了，站在兵營前面。", skip: (c) => c.send("spears") },
  { n: 5, name: "選兵和移動", first: "5a", doneTitle: "做得好！", doneBody: () => (usesMouse() ? "左鍵拉框選兵，右鍵點地面就走過去。" : "長按拉框選兵，點地面就走過去。") },
  { n: 6, name: "編軍團", first: "6a", doneTitle: "編好了！", doneBody: "之後按 <b>1</b> 就選到這個軍團。兵營也會<b>自動補兵</b>：軍團少了兵，就自己練、自己走過來。" },
  {
    n: 7,
    name: "守家",
    first: "7a",
    doneTitle: "守住了！",
    doneBody: () => (usesMouse() ? "敵人來打主城時：按<b>全軍撤退</b>回家，再用右鍵點敵人反擊。" : "敵人來打主城時：按<b>全軍撤退</b>回家，再點敵人反擊。"),
    // The squad gone too (core's near_home_clear): it would hit the main city for good. Sent after near_home, so the
    // simulation takes them in that order even when the squad is not in a snapshot yet (none alive: NotAvailable).
    skip: (c) => c.send("near_home_clear"),
  },
  { n: 8, name: "打城鎮", first: "8a", doneTitle: "做得好！", doneBody: "小鎮是你的了：每分鐘有糧和金，留守的兵會守城。", skip: (c) => c.send("town") },
  { n: 9, name: "打下對手主城", first: "9a", doneTitle: "教學完成！", doneBody: "九步都會了：看地圖、採集、蓋房、練兵、選兵、編軍團、守家、打城鎮、打主城。" },
];

export const PHASES: readonly Phase[] = [
  // 1 看地圖: drag, pinch, then 地圖 and a tap on the minimap.
  {
    id: "1",
    step: 1,
    title: "看地圖",
    // With a mouse (R26 06 B): the view moved by the wheel held, the arrow keys or the window's edge, any of them; the
    // wheel zooms. 「地圖」 only while the minimap is behind it: open from the start with a mouse on a large window (R26
    // 04, docked at the bottom left), not said (ceo 2026-11-21); a phone's words as they were.
    body: (c) => {
      if (c.flags.panned && c.flags.pinched) return "點<b>小地圖</b>上任何地方，畫面就跳過去。";
      // R26 06's table (ceo 2026-11-21: 「左下的」 was missing).
      const then = c.el(".mm-docked .minimap") !== null ? "再點左下的小地圖<b>跳過去</b>" : "再按左下的「地圖」、點小地圖<b>跳過去</b>";
      return usesMouse() ? `按住滾輪<b>拖動</b>畫面（或用方向鍵），轉滾輪<b>縮放</b>，${then}。` : `用一根手指<b>拖動</b>畫面、兩根手指<b>縮放</b>，${then}。`;
    },
    list: (c) => [
      [usesMouse() ? "移動畫面" : "拖動畫面", c.flags.panned],
      [usesMouse() ? "滾輪縮放" : "兩指縮放", c.flags.pinched],
      ["點小地圖", c.flags.minimap],
    ],
    target: (c) => {
      if (!(c.flags.panned && c.flags.pinched)) return null;
      return { el: c.el(".minimap:not(.closed)") ?? c.el(".map-btn") };
    },
    // 1a: the whole battlefield is the lesson; 1b: 地圖 and the minimap.
    block: false,
    gesture: "drag-pinch",
    next: (c) => (c.flags.panned && c.flags.pinched && c.flags.minimap ? "done" : null),
  },
  // 2 採集: a villager, then a tree.
  {
    id: "2a",
    noBuilding: true,
    step: 2,
    title: "採集",
    body: () => "點一名<b>村民</b>。",
    target: (c) => {
      const home = c.w.mainCity();
      const farmers = c.w.ownUnits([UnitType.Farmer]);
      if (farmers.length === 0) return null;
      const at = home === null ? { x: 0, y: 0 } : c.w.middle(home);
      // The same one while it can be tapped (on the screen, off the buttons and the card), else the nearest to the
      // main city that can; else the same, or the nearest.
      const free = (u: UnitAt) => {
        const s = c.w.spot(u.x, u.y, 0.5);
        return s !== null && c.clear(s.cx, s.cy);
      };
      // Off the main city (its picture is tall: a tap there takes the city) when one is: 5.5 cells from its middle.
      const off = (u: UnitAt) => Math.hypot(u.x - at.x, u.y - at.y) >= 5.5;
      const near = [...farmers].sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y));
      const same = farmers.find((u) => u.id === c.memo.farmer);
      const f = (same !== undefined && free(same) && off(same) ? same : undefined) ?? near.find((u) => free(u) && off(u)) ?? near.find(free) ?? same ?? near[0];
      c.memo.farmer = f.id;
      return { cell: { x: f.x, y: f.y, r: 0.9 } };
    },
    block: true,
    next: (c) => (c.w.selectedFarmers().length > 0 ? "2b" : null),
  },
  {
    id: "2b",
    noBuilding: true,
    step: 2,
    title: "採集",
    body: () => (usesMouse() ? "再用<b>右鍵</b>點一棵<b>樹</b>：村民就去砍，把木頭搬回主城。" : "再點一棵<b>樹</b>：村民就去砍，把木頭搬回主城。"),
    focus: true,
    target: (c) => {
      const f = c.w.selectedFarmers()[0];
      if (f === undefined) return null;
      const t = c.w.treeNear(f.x, f.y, (sx, sy) => c.clear(sx, sy));
      return t === null ? null : { cell: { x: t.x, y: t.y, r: 1 } };
    },
    block: true,
    next: (c) => {
      if (c.sentSince().some((cmd) => cmd.c === "gather" && c.w.isTree(cmd.node))) return "done";
      return c.w.selectedFarmers().length === 0 ? "2a" : null;
    },
  },
  // 3 蓋兵營: 建造, 兵營, ✓, then the villagers build it.
  {
    id: "3a",
    step: 3,
    title: "蓋兵營",
    body: () => "選著村民，按右下的<b>建造</b>。",
    target: (c) => ({ el: c.el(".cmds button", /^建造/) }),
    block: true,
    next: (c) => {
      if (own(c, BuildingType.Barracks) !== null) return "3d";
      if (c.game.placement !== null) return "3c";
      return c.el(".cmds.build-page") !== null ? "3b" : null;
    },
  },
  {
    id: "3b",
    step: 3,
    title: "蓋兵營",
    body: () => "按<b>兵營</b>。<small>民居不用自己蓋：人口快滿時，主城會自動蓋（主城的「自動蓋民居」）。</small>",
    target: (c) => ({ el: c.el(".cmds button", /^兵營/) }),
    block: true,
    next: (c) => {
      if (c.game.placement !== null) return "3c";
      return c.el(".cmds.build-page") === null ? "3a" : null;
    },
  },
  {
    id: "3c",
    step: 3,
    title: "蓋兵營",
    body: () => "拖到想蓋的地方，按 <b>✓</b>。",
    // The game's own prompt says it (R25 共用元件): the card away, ✓ framed, the prompt bright.
    place: () => "hidden",
    target: (c) => ({ el: c.el(".place-confirm .place-ok") }),
    keep: [".prompt"],
    block: false,
    next: (c) => {
      if (own(c, BuildingType.Barracks) !== null) return "3d";
      return c.game.placement === null ? "3a" : null;
    },
  },
  {
    id: "3d",
    step: 3,
    title: "蓋兵營",
    body: () => "村民在蓋兵營，蓋好就往下。",
    wait: (c) => (own(c, BuildingType.Barracks)?.progress ?? 0) / 1000,
    target: (c) => {
      const b = own(c, BuildingType.Barracks);
      if (b === null) return null;
      const m = c.w.middle(b);
      return { cell: { x: m.x, y: m.y, r: b.size * 0.6 } };
    },
    block: false,
    next: (c) => {
      const b = own(c, BuildingType.Barracks);
      if (b === null) return "3a";
      return b.progress >= 1000 ? "done" : null;
    },
  },
  // 4 練兵: 5 spearmen queued, then trained.
  {
    id: "4a",
    step: 4,
    title: "練兵",
    body: () => "選著兵營，按 <b>5 下「訓練槍兵」</b>。",
    list: (c) => [[`已排 ${Math.min(SPEARMEN, count(c, UnitType.Spearman) + (own(c, BuildingType.Barracks)?.queue ?? 0))}／${SPEARMEN}`, false]],
    target: (c) => {
      const b = own(c, BuildingType.Barracks);
      if (b === null) return null;
      if (selectedBuilding(c) === b.id) return { el: c.el(".cmds button", /^訓練槍兵/) };
      const m = c.w.middle(b);
      return { cell: { x: m.x, y: m.y, r: b.size * 0.6 } };
    },
    block: true,
    next: (c) => {
      if (count(c, UnitType.Spearman) >= SPEARMEN) return "done";
      return count(c, UnitType.Spearman) + (own(c, BuildingType.Barracks)?.queue ?? 0) >= SPEARMEN ? "4b" : null;
    },
  },
  {
    id: "4b",
    step: 4,
    title: "練兵",
    body: (c) => `練好 <b>${Math.min(SPEARMEN, count(c, UnitType.Spearman))}／${SPEARMEN}</b> 名。槍兵練好會站在兵營前面。`,
    wait: (c) => Math.min(1, count(c, UnitType.Spearman) / SPEARMEN),
    target: (c) => {
      const b = own(c, BuildingType.Barracks);
      if (b === null) return null;
      const m = c.w.middle(b);
      return { cell: { x: m.x, y: m.y, r: b.size * 0.6 } };
    },
    block: false,
    next: (c) => {
      if (count(c, UnitType.Spearman) >= SPEARMEN) return "done";
      return count(c, UnitType.Spearman) + (own(c, BuildingType.Barracks)?.queue ?? 0) < SPEARMEN ? "4a" : null;
    },
  },
  // 5 選兵和移動: a box round the soldiers, then the glowing spot.
  {
    id: "5a",
    step: 5,
    title: "選兵和移動",
    // With a mouse, its left button dragged (R26 06 B).
    body: () => (usesMouse() ? "按住滑鼠<b>左鍵</b>拖出框，把兵框起來。" : "在空地上<b>長按</b>一下，拖出框把兵框起來。"),
    // From nothing selected: the barracks' panel (step 4) would cover them.
    enter: (c) => c.game.apply([{ kind: "clear" }]),
    target: (c) => ({ units: soldiersToBox(c) }),
    block: false,
    gesture: "press-box",
    next: (c) => {
      const all = c.w.ownSoldiers().length;
      return all > 0 && c.w.selectedSoldiers().length >= Math.min(SPEARMEN, all) ? "5b" : null;
    },
  },
  {
    id: "5b",
    noBuilding: true,
    step: 5,
    title: "選兵和移動",
    body: () => (usesMouse() ? "用<b>右鍵</b>點<b>發亮的地方</b>：兵就走過去。" : "點<b>發亮的地方</b>：兵就走過去。"),
    focus: true,
    target: (c) => {
      const r = c.w.rally();
      return r === null ? null : { cell: { x: r.x, y: r.y, r: 1.4 } };
    },
    block: true,
    next: (c) => {
      const r = c.w.rally();
      const sel = c.w.selectedSoldiers();
      const moved = c.memo.moved === 1 || c.sentSince().some((cmd) => (cmd.c === "move" || cmd.c === "retreat" || cmd.c === "attack") && "x" in cmd && r !== null && Math.hypot(cmd.x + 0.5 - r.x, cmd.y + 0.5 - r.y) < 3);
      if (moved) c.memo.moved = 1;
      if (!moved && sel.length === 0) return "5a";
      if (r === null || !moved) return null;
      const near = c.w.ownSoldiers().filter((u) => Math.hypot(u.x - r.x, u.y - r.y) < 3.5).length;
      return near >= Math.min(SPEARMEN, c.w.ownSoldiers().length) ? "done" : null;
    },
  },
  // 6 編軍團: 1, then 改成剛才選的.
  {
    id: "6a",
    step: 6,
    title: "編軍團",
    body: () => "選著兵，按右邊的 <b>1</b>。",
    // Nobody selected: a box round them first (the frame would keep the taps off them).
    target: (c) => (c.w.selectedSoldiers().length > 0 ? { el: c.el(".groups > button:nth-child(1)") } : { units: soldiersToBox(c) }),
    block: true,
    extras: [".groups > button:nth-child(1)"],
    next: (c) => {
      if ((c.game.army.groups[0]?.ids.length ?? 0) > 0) return "done";
      return c.game.groupView === 0 ? "6b" : null;
    },
  },
  {
    id: "6b",
    step: 6,
    title: "按「改成剛才選的」",
    body: () => "",
    place: () => "slim",
    target: (c) => ({ el: c.el(".sel-info button", /^改成剛才選的/) }),
    block: true,
    next: (c) => {
      if ((c.game.army.groups[0]?.ids.length ?? 0) > 0) return "done";
      return c.game.groupView !== 0 ? "6a" : null;
    },
  },
  // 7 守家: the computer's squad comes (near_home); 全軍撤退, then at them.
  {
    id: "7a",
    step: 7,
    title: "守家",
    body: () => "敵人來打主城了！按<b>全軍撤退</b>：軍團退回主城。",
    enter: (c) => c.send("near_home"),
    target: (c) => ({ el: c.el(".retreat-all-btn") }),
    block: true,
    next: (c) => {
      if (c.w.foes().length > 0) c.memo.squad = 1;
      if (c.memo.squad === 1 && c.w.foes().length === 0) return "done";
      return c.sentSince().some((cmd) => cmd.c === "retreat") ? "7b" : null;
    },
  },
  {
    id: "7b",
    noBuilding: true,
    step: 7,
    title: "守家",
    body: () => (usesMouse() ? "軍團回來了。用<b>右鍵</b>點<b>敵人</b>：軍團就去打，打光就過關。" : "軍團回來了。點<b>敵人</b>：軍團就去打，打光就過關。"),
    target: (c) => {
      const first = armyFirst(c);
      if (first !== null) return first;
      const home = c.w.mainCity();
      const at = home === null ? { x: 0, y: 0 } : c.w.middle(home);
      const f = [...c.w.foes()].sort((a, b) => Math.hypot(a.x - at.x, a.y - at.y) - Math.hypot(b.x - at.x, b.y - at.y))[0];
      return f === undefined ? null : { cell: { x: f.x, y: f.y, r: 1.2 }, label: "敵人" };
    },
    go: true,
    block: true,
    extras: SOLDIER_HELPERS,
    next: (c) => {
      if (c.w.foes().length > 0) c.memo.squad = 1;
      return c.memo.squad === 1 && c.w.foes().length === 0 ? "done" : null;
    },
  },
  // 8 打城鎮: take the small town, 治理, wait, 進駐.
  {
    id: "8a",
    noBuilding: true,
    step: 8,
    title: "打城鎮",
    body: () => "中立的小鎮在<b>標籤指的方向</b>：帶軍團去，打倒城裡的民兵。",
    target: (c) => {
      const first = armyFirst(c);
      if (first !== null) return first;
      const t = town(c);
      return t === null ? null : { cell: { x: t.cellX + 0.5, y: t.cellY + 0.5, r: Math.max(2, t.radius * 0.7) }, label: "小鎮" };
    },
    go: true,
    block: true,
    extras: SOLDIER_HELPERS,
    next: (c) => phaseOfTown(c) ?? null,
  },
  {
    id: "8b",
    step: 8,
    title: "選治理",
    body: () => "選<b>治理</b>：修 10 秒，之後每分鐘有糧和金。留守照預設就好。",
    place: () => "side",
    target: (c) => ({ el: c.el(".dialog button.choice-govern") }),
    block: true,
    next: (c) => {
      const p = phaseOfTown(c);
      return p === "8b" ? null : p;
    },
  },
  {
    id: "8c",
    step: 8,
    title: "打城鎮",
    body: (c) => {
      const t = town(c);
      const left = t === null || t.timer < 0 ? 0 : Math.ceil(t.timer / 20);
      return `城在修，再 <b>${left} 秒</b>。`;
    },
    wait: (c) => {
      const t = town(c);
      return t === null || t.timerTotal <= 0 ? 0 : 1 - t.timer / t.timerTotal;
    },
    target: (c) => {
      const t = town(c);
      return t === null ? null : { cell: { x: t.cellX + 0.5, y: t.cellY + 0.5, r: Math.max(2, t.radius * 0.7) }, label: "小鎮" };
    },
    block: false,
    next: (c) => {
      const p = phaseOfTown(c);
      return p === "8c" ? null : p;
    },
  },
  {
    id: "8d",
    step: 8,
    title: "打城鎮",
    body: () => "選軍團，按「<b>進駐</b>」，再點亮起來的小鎮。",
    // Picking: the game's prompt and 進駐's tags say it; the card away, the town framed.
    place: (c) => (c.game.mode === "enter" ? "hidden" : null),
    target: (c) => {
      const t = town(c);
      if (c.game.mode === "enter") {
        // Its tag, as the game's prompt says (點亮起來的建築：標籤寫誰進去); nothing framed until the tag is up (a frame
        // on the town's middle meanwhile asked for a tap that 進駐 does not take, and moved off it as the tag came).
        const tag = t === null ? null : c.el(`.enter-tag[data-place="t${t.id}"]:not(.off), .enter-chip[data-place="t${t.id}"]`);
        return tag === null ? null : { el: tag };
      }
      if (c.w.selectedSoldiers().length > 0) return { el: c.el(".cmds button", /^進駐/) };
      return { el: c.el(".groups > button:nth-child(1)") };
    },
    keep: [".prompt", ".enter-tag", ".enter-chip"],
    block: true,
    extras: SOLDIER_HELPERS,
    // 治理 already keeps its 留守 there: 進駐 is the lesson, so the step waits for one (the town's guard order, D-125).
    next: (c) => {
      const t = town(c);
      if (t === null || !townOurs(c)) return "8a";
      return c.sentSince().some((cmd) => cmd.c === "guard" && cmd.town === t.id) ? "done" : null;
    },
  },
  // 9 打下對手主城: core's siege works (siege), two engines, then the computer's main city.
  {
    id: "9a",
    step: 9,
    title: "打下對手主城",
    body: () => "砲坊蓋好了。選砲坊，按 <b>2 下「訓練攻城砲」</b>。",
    enter: (c) => c.send("siege"),
    list: (c) => [[`已排 ${Math.min(ENGINES, count(c, UnitType.Siege) + (own(c, BuildingType.SiegeWorks)?.queue ?? 0))}／${ENGINES}`, false]],
    target: (c) => {
      const b = own(c, BuildingType.SiegeWorks);
      if (b === null) return null;
      if (selectedBuilding(c) === b.id) return { el: c.el(".cmds button", /^訓練攻城砲/) };
      const m = c.w.middle(b);
      return { cell: { x: m.x, y: m.y, r: b.size * 0.6 } };
    },
    block: true,
    next: (c) => {
      if (count(c, UnitType.Siege) >= ENGINES) return "9c";
      return count(c, UnitType.Siege) + (own(c, BuildingType.SiegeWorks)?.queue ?? 0) >= ENGINES ? "9b" : null;
    },
  },
  {
    id: "9b",
    step: 9,
    title: "打下對手主城",
    body: (c) => `練好 <b>${Math.min(ENGINES, count(c, UnitType.Siege))}／${ENGINES}</b> 門。攻城砲打建築最快，但走得慢、怕近身：要和軍團一起走。`,
    wait: (c) => Math.min(1, count(c, UnitType.Siege) / ENGINES),
    target: (c) => {
      const b = own(c, BuildingType.SiegeWorks);
      if (b === null) return null;
      const m = c.w.middle(b);
      return { cell: { x: m.x, y: m.y, r: b.size * 0.6 } };
    },
    block: false,
    next: (c) => {
      if (count(c, UnitType.Siege) >= ENGINES) return "9c";
      return count(c, UnitType.Siege) + (own(c, BuildingType.SiegeWorks)?.queue ?? 0) < ENGINES ? "9a" : null;
    },
  },
  {
    id: "9c",
    noBuilding: true,
    step: 9,
    title: "打下對手主城",
    // On the screen (9d): at it; else (9c) the tag says where.
    body: (c) => {
      const b = c.w.foeCity();
      const m = b === null ? null : c.w.middle(b);
      const s = m === null ? null : c.w.spot(m.x, m.y, 1);
      const inSight = s !== null && s.cx >= 0 && s.cx <= innerWidth && s.cy >= 0 && s.cy <= innerHeight;
      if (!inSight) return "對手的主城在<b>標籤指的方向</b>：選著攻城砲和軍團，一起帶過去。";
      return usesMouse() ? "攻城砲打建築最快。選著攻城砲和軍團，用<b>右鍵</b>點對手的<b>主城</b>。" : "攻城砲打建築最快。選著攻城砲和軍團，點對手的<b>主城</b>。";
    },
    target: (c) => {
      const first = armyFirst(c, true);
      if (first !== null) return first;
      const b = c.w.foeCity();
      if (b === null) return null;
      const m = c.w.middle(b);
      return { cell: { x: m.x, y: m.y, r: b.size * 0.6 }, label: "對手主城" };
    },
    go: true,
    block: true,
    extras: SOLDIER_HELPERS,
    next: (c) => (c.game.over !== null && c.game.over.winner === c.w.me ? "done" : null),
  },
];

/** Step 8's phase from the town: taken (choose), repairing, governed; null while it is not ours. */
function phaseOfTown(c: StepCtx): string | null {
  const t = town(c);
  if (t === null || !townOurs(c)) return null;
  if (t.state === TownState.AwaitingChoice) return "8b";
  if (t.state === TownState.Repairing) return "8c";
  if (t.state === TownState.Governed) return "8d";
  return null;
}

export const phaseById = (id: string): Phase | undefined => PHASES.find((p) => p.id === id);
export const stepOf = (n: number): Step => STEP_LIST[n - 1];
