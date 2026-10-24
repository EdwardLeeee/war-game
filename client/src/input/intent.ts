// What a tap, long press or box means, given what is under the finger and what is selected
// (GDD §9 and §10). Pure functions over a small query interface, so every row of the gesture
// table is unit-tested without a browser. Coordinates are world px (TILE_PX per cell).

import { BuildingType, CELL, type CommandBody, Stance, UnitType } from "../sim.ts";
import { TILE_PX } from "../tuning.ts";

export type PickKind = "unit" | "building" | "node" | "town";

export interface Pick {
  kind: PickKind;
  id: number;
  /** Player, NEUTRAL, or NO_OWNER for resource nodes and empty towns. */
  owner: number;
  /** UnitType, BuildingType, NodeKind or TownSize, depending on kind. */
  type: number;
}

export interface IntentWorld {
  readonly me: number;
  /** Nearest thing within r world px: units first, then buildings, then resource nodes, then towns. */
  pick(wx: number, wy: number, r: number): Pick | null;
  /** The resource node under the point, else the nearest one within r world px. */
  pickNode(wx: number, wy: number, r: number): Pick | null;
  /** The building whose footprint contains the point. */
  buildingAt(wx: number, wy: number): Pick | null;
  /** Farmers have something to do there: not finished, damaged, or a farm (sim/PROTOCOL.md 3.1 repair). */
  buildingNeedsFarmers(id: number): boolean;
  /** Own units whose position is inside the world rectangle. */
  ownUnitsIn(x0: number, y0: number, x1: number, y1: number): { id: number; type: number }[];
  /** Own units of this type that are on screen. */
  ownUnitsOnScreen(type: number): number[];
  unitType(id: number): number;
  unitStance(id: number): number;
  unitAutocast(id: number): boolean;
  /** The cell in front of the own main city, where 退回主城 goes; null without a main city. */
  homeCell(): { x: number; y: number } | null;
  /** 點城鎮就是進攻 (D-100): towns have keeps (`features.keep`). */
  attacksTowns(): boolean;
  /** A town's keep's centre cell while it stands (D-100), else null. */
  keepCell(town: number): { x: number; y: number } | null;
}

export interface Selection {
  /** Own unit ids, ascending. */
  units: number[];
  /** An own building, when that is what is selected. */
  building: number | null;
}

/**
 * Map taps that finish a command started from a button: `advance` 攻擊, `retreat` 移動 (D-094: the
 * buttons' old names stay in the code), 集結點; `garrison`, picking the building to hide in (round
 * 7), and `post`, the outpost (D-080): the game handles those taps itself.
 */
export type Mode = "normal" | "advance" | "retreat" | "rally" | "garrison" | "post" | "wall";

export type Intent =
  | { kind: "select"; units: number[] }
  | { kind: "selectBuilding"; id: number }
  | { kind: "inspect"; pick: Pick }
  | { kind: "clear" }
  | { kind: "command"; cmd: CommandBody }
  /** The soldiers were sent at a town by a tap on its ground (D-100): the first time, a hint says so. */
  | { kind: "townAttack"; town: number }
  | { kind: "endMode" };

export type WheelItem = "advance" | "retreat" | "hold";

export const isMilitary = (type: number): boolean => type === UnitType.Spearman || type === UnitType.Ranged || type === UnitType.Mage || type === UnitType.Cavalry;

export const toCell = (w: number): number => Math.floor(w / TILE_PX);
/** World px to simulation fixed point (integers only go to the simulation). */
export const toFixed = (w: number): number => Math.floor((w * CELL) / TILE_PX);

/**
 * 移動 (D-094, the user 2026-10-21: 「我們的撤退也改成移動」): units go there and do not fight on
 * the way; there, they stand 積極 (game.ts sends the stance). The simulation's `retreat` is that
 * walk. Farmers, who fight nobody, get a plain `move` as before.
 */
export function moveIntents(world: IntentWorld, units: number[], x: number, y: number): Intent[] {
  const farmers = units.filter((id) => world.unitType(id) === UnitType.Farmer);
  const others = units.filter((id) => world.unitType(id) !== UnitType.Farmer);
  const out: Intent[] = [];
  if (others.length > 0) out.push({ kind: "command", cmd: { c: "retreat", u: others, x, y } });
  if (farmers.length > 0) out.push({ kind: "command", cmd: { c: "move", u: farmers, x, y } });
  return out;
}

/**
 * @param r the pick radius in world px (HIT_RADIUS_PT on screen)
 * @param core the "right on the unit" radius in world px (UNIT_CORE_HIT_PT on screen)
 */
export function tapIntents(world: IntentWorld, sel: Selection, mode: Mode, wx: number, wy: number, count: 1 | 2, r: number, core = r): Intent[] {
  const x = toCell(wx);
  const y = toCell(wy);
  switch (mode) {
    case "retreat": {
      // 移動 (D-094; D-059: 點到哪就到哪): to the cell tapped; on the own main city, home to the
      // cell in front of it.
      if (sel.units.length === 0) return [{ kind: "endMode" }];
      const b = world.buildingAt(wx, wy);
      const home = b !== null && b.owner === world.me && b.type === BuildingType.MainCity ? world.homeCell() : null;
      return [{ kind: "command", cmd: { c: "retreat", u: sel.units, x: home?.x ?? x, y: home?.y ?? y } }, { kind: "endMode" }];
    }
    case "rally":
      return sel.building !== null ? [{ kind: "command", cmd: { c: "rally", building: sel.building, x, y } }, { kind: "endMode" }] : [{ kind: "endMode" }];
    case "garrison":
    case "post":
    case "wall":
      // Game.tap picks the building or the town itself (garrison.ts, outpost.ts, walls.ts); nothing from here.
      return [];
    case "advance": {
      // 攻擊 (D-094; D-050's 進攻): an enemy there is attacked; anywhere else, the troops advance
      // to it fighting on the way (攻擊移動); on a town not ours, to its keep while it stands (D-100).
      if (sel.units.length === 0) return [{ kind: "endMode" }];
      const target = world.pick(wx, wy, r);
      const keep = target !== null && target.kind === "town" && target.owner !== world.me && world.attacksTowns() ? world.keepCell(target.id) : null;
      const cmd: CommandBody =
        target !== null && target.owner !== world.me && (target.kind === "unit" || target.kind === "building")
          ? { c: "attack", u: sel.units, target: target.id }
          : { c: "move", u: sel.units, x: keep?.x ?? x, y: keep?.y ?? y };
      return [{ kind: "command", cmd }, { kind: "endMode" }];
    }
    case "normal":
      break;
  }

  // Farmers selected: a resource or own building at the finger is the order's target, even
  // with a unit standing beside it (farmers crowd resources while they work), unless the
  // finger is right on that unit. User report 2026-09-30: 「點果樹跟金礦沒反應」.
  const farmersSelected = sel.units.filter((id) => world.unitType(id) === UnitType.Farmer);
  if (farmersSelected.length > 0 && world.pick(wx, wy, core)?.kind !== "unit") {
    const others = sel.units.filter((id) => world.unitType(id) !== UnitType.Farmer);
    const node = world.pickNode(wx, wy, r);
    if (node !== null) {
      const out: Intent[] = [{ kind: "command", cmd: { c: "gather", u: farmersSelected, node: node.id } }];
      if (others.length > 0) out.push(...moveIntents(world, others, x, y));
      return out;
    }
    // Only where there is work (build, farm, repair); a healthy barracks is selected instead,
    // or the player could not pick a building while farmers are selected.
    const b = world.buildingAt(wx, wy);
    if (b !== null && b.owner === world.me && world.buildingNeedsFarmers(b.id)) {
      return [{ kind: "command", cmd: { c: "repair", u: farmersSelected, building: b.id } }];
    }
  }

  const pick = world.pick(wx, wy, r);
  if (pick !== null && pick.owner === world.me) {
    if (pick.kind === "unit") {
      if (count === 2) {
        const same = world.ownUnitsOnScreen(pick.type);
        return [{ kind: "select", units: same.includes(pick.id) ? same : [...same, pick.id].sort((a, b) => a - b) }];
      }
      return [{ kind: "select", units: [pick.id] }];
    }
    if (pick.kind === "building") {
      // Farmers tapping their own building where there is work: the simulation decides what
      // it is (help build, farm a field, repair; core, relayed 2026-09-30). Otherwise select it.
      const farmers = sel.units.filter((id) => world.unitType(id) === UnitType.Farmer);
      if (farmers.length > 0 && world.buildingNeedsFarmers(pick.id)) return [{ kind: "command", cmd: { c: "repair", u: farmers, building: pick.id } }];
      return [{ kind: "selectBuilding", id: pick.id }];
    }
  }

  const u = sel.units;
  if (u.length === 0) return pick !== null ? [{ kind: "inspect", pick }] : [{ kind: "clear" }];

  if (pick !== null && (pick.kind === "unit" || pick.kind === "building")) {
    return [{ kind: "command", cmd: { c: "attack", u, target: pick.id } }];
  }
  // 點城鎮就是進攻 (D-100, the user 2026-10-23: 「攻擊城市的操作手感不太好，常常點不到」): with
  // soldiers selected, the ground of a town not ours is an attack on it: 攻擊移動 to its keep while
  // it stands (a big city's corner is about 10 cells from it, and soldiers sent there would stand
  // and wait), else to the cell tapped. Farmers walk there as before; our own town is 移動 as before.
  if (pick !== null && pick.kind === "town" && pick.owner !== world.me && world.attacksTowns()) {
    const soldiers = u.filter((id) => world.unitType(id) !== UnitType.Farmer);
    if (soldiers.length > 0) {
      const to = world.keepCell(pick.id) ?? { x, y };
      const farmers = u.filter((id) => world.unitType(id) === UnitType.Farmer);
      return [{ kind: "command", cmd: { c: "move", u: soldiers, x: to.x, y: to.y } }, ...moveIntents(world, farmers, x, y), { kind: "townAttack", town: pick.id }];
    }
  }
  if (pick !== null && pick.kind === "node") {
    const farmers = u.filter((id) => world.unitType(id) === UnitType.Farmer);
    const others = u.filter((id) => world.unitType(id) !== UnitType.Farmer);
    const out: Intent[] = [];
    if (farmers.length > 0) out.push({ kind: "command", cmd: { c: "gather", u: farmers, node: pick.id } });
    if (others.length > 0) out.push(...moveIntents(world, others, x, y));
    return out;
  }
  // The ground: 移動 (D-094). 攻擊移動 needs 攻擊 first.
  return moveIntents(world, u, x, y);
}

/** Long press: own unit -> skill wheel; empty ground (or a town's open ground) -> box; else nothing. */
export function longPressKind(world: IntentWorld, wx: number, wy: number, r: number): "box" | "wheel" | "none" {
  const pick = world.pick(wx, wy, r);
  if (pick === null || pick.kind === "town") return "box";
  if (pick.kind === "unit" && pick.owner === world.me) return "wheel";
  return "none";
}

/** Box select: military units if the box holds any, otherwise the farmers in it. */
export function boxSelect(world: IntentWorld, x0: number, y0: number, x1: number, y1: number): number[] {
  const inside = world.ownUnitsIn(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1));
  const army = inside.filter((v) => isMilitary(v.type));
  const chosen = army.length > 0 ? army : inside.filter((v) => v.type === UnitType.Farmer);
  return chosen.map((v) => v.id).sort((a, b) => a - b);
}

/**
 * Skill wheel for the long-pressed unit (GDD §10): soldiers 攻擊, 移動, 堅守 (D-094's names for
 * D-050's 進攻, 撤退; D-095: mages too, their cannon only automatic); farmers only 移動.
 */
export function wheelItems(pressedType: number): WheelItem[] {
  return isMilitary(pressedType) ? ["advance", "retreat", "hold"] : ["retreat"];
}

/**
 * 堅守 (D-050): the soldiers among these units stop where they are and hold (they fight what
 * comes into range and do not chase).
 */
export function holdIntents(world: IntentWorld, units: number[]): Intent[] {
  const soldiers = units.filter((id) => isMilitary(world.unitType(id)));
  if (soldiers.length === 0) return [];
  return [
    { kind: "command", cmd: { c: "stop", u: soldiers } },
    { kind: "command", cmd: { c: "stance", u: soldiers, stance: Stance.Hold } },
  ];
}

/**
 * A wheel choice applied to the selection. 攻擊 and 移動 need a map tap next, so they return the
 * mode to enter; 堅守 is a command at once.
 */
export function wheelIntents(world: IntentWorld, sel: Selection, item: WheelItem): { mode: Mode | null; intents: Intent[] } {
  const u = sel.units;
  switch (item) {
    case "retreat":
      return { mode: u.length > 0 ? "retreat" : null, intents: [] };
    case "advance":
      return { mode: u.length > 0 ? "advance" : null, intents: [] };
    case "hold":
      return { mode: null, intents: holdIntents(world, u) };
  }
}

/** 回主城 (the prompt while picking where to move to, D-094): the selection to the cell in front of the main city. */
export function retreatHome(sel: Selection, home: { x: number; y: number } | null): Intent[] {
  if (home === null || sel.units.length === 0) return [{ kind: "endMode" }];
  return [{ kind: "command", cmd: { c: "retreat", u: sel.units, x: home.x, y: home.y } }, { kind: "endMode" }];
}

