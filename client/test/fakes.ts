// Test doubles: a recording gesture host and a small hand-made world for the intent rules.

import type { BoxPhase, GestureHost, LongPressResult } from "../src/input/gestures.ts";
import type { IntentWorld, Pick } from "../src/input/intent.ts";
import { BuildingType, NO_OWNER, Stance, UnitType } from "../src/sim.ts";
import { TILE_PX } from "../src/tuning.ts";

export type Call = [string, ...unknown[]];

export class RecordingHost implements GestureHost {
  calls: Call[] = [];
  longPressAnswer: LongPressResult = "box";
  tap(x: number, y: number, count: 1 | 2): void {
    this.calls.push(["tap", x, y, count]);
  }
  longPress(x: number, y: number): LongPressResult {
    this.calls.push(["longPress", x, y]);
    return this.longPressAnswer;
  }
  pressCue(x: number, y: number, on: boolean): void {
    this.calls.push(["pressCue", x, y, on]);
  }
  panStart(x: number, y: number): void {
    this.calls.push(["panStart", x, y]);
  }
  pan(dx: number, dy: number, x: number, y: number): void {
    this.calls.push(["pan", dx, dy, x, y]);
  }
  panEnd(vx: number, vy: number): void {
    this.calls.push(["panEnd", vx, vy]);
  }
  box(x0: number, y0: number, x1: number, y1: number, phase: BoxPhase): void {
    this.calls.push(["box", x0, y0, x1, y1, phase]);
  }
  pinchStart(): void {
    this.calls.push(["pinchStart"]);
  }
  pinch(cx: number, cy: number, factor: number, dx: number, dy: number): void {
    this.calls.push(["pinch", cx, cy, factor, dx, dy]);
  }
  pinchEnd(): void {
    this.calls.push(["pinchEnd"]);
  }
  names(): string[] {
    return this.calls.map((c) => c[0]);
  }
  of(name: string): Call[] {
    return this.calls.filter((c) => c[0] === name);
  }
}

export interface FakeUnit {
  id: number;
  owner: number;
  type: number;
  /** Cell coordinates; the unit stands in the middle of the cell. */
  cx: number;
  cy: number;
  stance?: number;
  autocast?: boolean;
}

export interface FakeThing {
  kind: "building" | "node";
  id: number;
  owner: number;
  type: number;
  cx: number;
  cy: number;
  /** Building: unfinished or damaged (farms always count as work). */
  needsWork?: boolean;
}

export const ME = 0;
export const ENEMY = 1;
export const at = (c: number): number => c * TILE_PX + TILE_PX / 2;

/** A world of units, buildings and nodes on cells; "on screen" is every unit with cx < screenCells. */
export class FakeWorld implements IntentWorld {
  readonly me = ME;
  units: FakeUnit[];
  things: FakeThing[];
  screenCells: number;
  /** The cell in front of the own main city, or null without one. */
  home: { x: number; y: number } | null = null;

  constructor(units: FakeUnit[], things: FakeThing[] = [], screenCells = 1000) {
    this.units = units;
    this.things = things;
    this.screenCells = screenCells;
  }

  pick(wx: number, wy: number, r: number): Pick | null {
    let best: Pick | null = null;
    let bestD = r * r;
    for (const u of this.units) {
      const d = (at(u.cx) - wx) ** 2 + (at(u.cy) - wy) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = { kind: "unit", id: u.id, owner: u.owner, type: u.type };
      }
    }
    if (best !== null) return best;
    for (const t of this.things) {
      if (Math.floor(wx / TILE_PX) === t.cx && Math.floor(wy / TILE_PX) === t.cy) {
        return { kind: t.kind, id: t.id, owner: t.kind === "node" ? NO_OWNER : t.owner, type: t.type };
      }
    }
    return null;
  }

  pickNode(wx: number, wy: number, r: number): Pick | null {
    let best: FakeThing | null = null;
    let bestD = r * r;
    for (const t of this.things) {
      if (t.kind !== "node") continue;
      if (Math.floor(wx / TILE_PX) === t.cx && Math.floor(wy / TILE_PX) === t.cy) return { kind: "node", id: t.id, owner: NO_OWNER, type: t.type };
      const d = (at(t.cx) - wx) ** 2 + (at(t.cy) - wy) ** 2;
      if (d <= bestD) {
        bestD = d;
        best = t;
      }
    }
    return best === null ? null : { kind: "node", id: best.id, owner: NO_OWNER, type: best.type };
  }

  buildingAt(wx: number, wy: number): Pick | null {
    const t = this.things.find((v) => v.kind === "building" && Math.floor(wx / TILE_PX) === v.cx && Math.floor(wy / TILE_PX) === v.cy);
    return t === undefined ? null : { kind: "building", id: t.id, owner: t.owner, type: t.type };
  }

  homeCell(): { x: number; y: number } | null {
    return this.home;
  }

  buildingNeedsFarmers(id: number): boolean {
    const t = this.things.find((v) => v.kind === "building" && v.id === id);
    return t !== undefined && (t.needsWork === true || t.type === BuildingType.Farm);
  }

  ownUnitsIn(x0: number, y0: number, x1: number, y1: number): { id: number; type: number }[] {
    return this.units
      .filter((u) => u.owner === ME && at(u.cx) >= x0 && at(u.cx) <= x1 && at(u.cy) >= y0 && at(u.cy) <= y1)
      .map((u) => ({ id: u.id, type: u.type }));
  }

  ownUnitsOnScreen(type: number): number[] {
    return this.units.filter((u) => u.owner === ME && u.type === type && u.cx < this.screenCells).map((u) => u.id);
  }

  unitType(id: number): number {
    return this.units.find((u) => u.id === id)?.type ?? -1;
  }

  unitStance(id: number): number {
    return this.units.find((u) => u.id === id)?.stance ?? Stance.Aggressive;
  }

  unitAutocast(id: number): boolean {
    return this.units.find((u) => u.id === id)?.autocast ?? false;
  }
}

export { UnitType };
