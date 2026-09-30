// What a tap, long press or box means, given what is under the finger and what is selected
// (GDD §9 and §10). Pure functions over a small query interface, so every row of the gesture
// table is unit-tested without a browser. Coordinates are world px (TILE_PX per cell).

import { CELL, type CommandBody, Stance, UnitType } from "../sim.ts";
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
  /** Own units whose position is inside the world rectangle. */
  ownUnitsIn(x0: number, y0: number, x1: number, y1: number): { id: number; type: number }[];
  /** Own units of this type that are on screen. */
  ownUnitsOnScreen(type: number): number[];
  unitType(id: number): number;
  unitStance(id: number): number;
  unitAutocast(id: number): boolean;
}

export interface Selection {
  /** Own unit ids, ascending. */
  units: number[];
  /** An own building, when that is what is selected. */
  building: number | null;
}

/** Map taps that finish a command started from a button (撤退, 晶砲, 集結點). */
export type Mode = "normal" | "retreat" | "cast" | "rally";

export type Intent =
  | { kind: "select"; units: number[] }
  | { kind: "selectBuilding"; id: number }
  | { kind: "inspect"; pick: Pick }
  | { kind: "clear" }
  | { kind: "command"; cmd: CommandBody }
  | { kind: "endMode" };

export type WheelItem = "cast" | "autocast" | "retreat" | "stance";

export const isMilitary = (type: number): boolean => type === UnitType.Spearman || type === UnitType.Ranged || type === UnitType.Mage;

export const toCell = (w: number): number => Math.floor(w / TILE_PX);
/** World px to simulation fixed point (integers only go to the simulation). */
export const toFixed = (w: number): number => Math.floor((w * CELL) / TILE_PX);

export function tapIntents(world: IntentWorld, sel: Selection, mode: Mode, wx: number, wy: number, count: 1 | 2, r: number): Intent[] {
  const x = toCell(wx);
  const y = toCell(wy);
  switch (mode) {
    case "retreat":
      return sel.units.length > 0 ? [{ kind: "command", cmd: { c: "retreat", u: sel.units, x, y } }, { kind: "endMode" }] : [{ kind: "endMode" }];
    case "cast": {
      const mages = sel.units.filter((id) => world.unitType(id) === UnitType.Mage);
      const casts: Intent[] = mages.map((u) => ({ kind: "command", cmd: { c: "cast", u, fx: toFixed(wx), fy: toFixed(wy) } }));
      return [...casts, { kind: "endMode" }];
    }
    case "rally":
      return sel.building !== null ? [{ kind: "command", cmd: { c: "rally", building: sel.building, x, y } }, { kind: "endMode" }] : [{ kind: "endMode" }];
    case "normal":
      break;
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
      // Farmers tapping their own building: the simulation decides what that means (help
      // build, farm a field, repair; core, relayed 2026-09-30). Without farmers it selects it.
      const farmers = sel.units.filter((id) => world.unitType(id) === UnitType.Farmer);
      if (farmers.length > 0) return [{ kind: "command", cmd: { c: "repair", u: farmers, building: pick.id } }];
      return [{ kind: "selectBuilding", id: pick.id }];
    }
  }

  const u = sel.units;
  if (u.length === 0) return pick !== null ? [{ kind: "inspect", pick }] : [{ kind: "clear" }];

  if (pick !== null && (pick.kind === "unit" || pick.kind === "building")) {
    return [{ kind: "command", cmd: { c: "attack", u, target: pick.id } }];
  }
  if (pick !== null && pick.kind === "node") {
    const farmers = u.filter((id) => world.unitType(id) === UnitType.Farmer);
    const others = u.filter((id) => world.unitType(id) !== UnitType.Farmer);
    const out: Intent[] = [];
    if (farmers.length > 0) out.push({ kind: "command", cmd: { c: "gather", u: farmers, node: pick.id } });
    if (others.length > 0) out.push({ kind: "command", cmd: { c: "move", u: others, x, y } });
    return out;
  }
  return [{ kind: "command", cmd: { c: "move", u, x, y } }];
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

/** Skill wheel for the long-pressed unit (GDD §10): mages cast, autocast, retreat; others retreat, stance. */
export function wheelItems(pressedType: number): WheelItem[] {
  return pressedType === UnitType.Mage ? ["cast", "autocast", "retreat"] : ["retreat", "stance"];
}

/**
 * A wheel choice applied to the selection. cast and retreat need a map tap next, so they
 * return the mode to enter; autocast and stance are commands at once.
 */
export function wheelIntents(world: IntentWorld, sel: Selection, item: WheelItem): { mode: Mode | null; intents: Intent[] } {
  const u = sel.units;
  switch (item) {
    case "cast":
      return { mode: "cast", intents: [] };
    case "retreat":
      return { mode: "retreat", intents: [] };
    case "autocast": {
      const mages = u.filter((id) => world.unitType(id) === UnitType.Mage);
      if (mages.length === 0) return { mode: null, intents: [] };
      const on = mages.some((id) => !world.unitAutocast(id));
      return { mode: null, intents: [{ kind: "command", cmd: { c: "autocast", u: mages, on } }] };
    }
    case "stance": {
      if (u.length === 0) return { mode: null, intents: [] };
      const stance = u.some((id) => world.unitStance(id) === Stance.Aggressive) ? Stance.Hold : Stance.Aggressive;
      return { mode: null, intents: [{ kind: "command", cmd: { c: "stance", u, stance } }] };
    }
  }
}

/** 退回主城: retreat the selection to the cell in front of the main city. */
export function retreatHome(sel: Selection, home: { x: number; y: number } | null): Intent[] {
  if (home === null || sel.units.length === 0) return [{ kind: "endMode" }];
  return [{ kind: "command", cmd: { c: "retreat", u: sel.units, x: home.x, y: home.y } }, { kind: "endMode" }];
}

