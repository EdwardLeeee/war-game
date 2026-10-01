// Who stays behind and who marches (D-026, GDD §5): the soldiers left in a town as its
// garrison (留守), and 全軍 and the control groups without them. Bookkeeping on unit ids only,
// with no screen and no clock, so the rules are unit tested and the interface just draws them.
//
// Positions are the simulation's fixed point and "inside the town" is the simulation's own
// test (a circle around the town centre, sim/src/core/towns.ts), so 留守 here and 駐軍 in the
// snapshot count the same soldiers.

import { CELL, UnitType } from "../sim.ts";

export interface ArmyUnit {
  id: number;
  type: number;
  /** Fixed point (CELL per cell), as in the snapshot. */
  x: number;
  y: number;
}

export interface TownArea {
  id: number;
  cellX: number;
  cellY: number;
  /** Cells. */
  radius: number;
}

/** A control group (編隊 1–4). */
export interface Group {
  ids: number[];
}

/** The units 全軍 and the garrison rules are about: farmers are not soldiers. */
export function isSoldier(type: number): boolean {
  return type === UnitType.Spearman || type === UnitType.Ranged || type === UnitType.Mage;
}

/** Squared distance from the unit to the town centre, fixed point (within 2^53 on any map). */
function toCentre2(u: ArmyUnit, town: TownArea): number {
  const dx = u.x - (town.cellX * CELL + CELL / 2);
  const dy = u.y - (town.cellY * CELL + CELL / 2);
  return dx * dx + dy * dy;
}

export function inTown(u: ArmyUnit, town: TownArea): boolean {
  const r = town.radius * CELL;
  return toCentre2(u, town) <= r * r;
}

/** The order soldiers are chosen to stay: mages last, then nearest the town centre, then the lower id. */
function byGarrisonOrder(town: TownArea): (a: ArmyUnit, b: ArmyUnit) => number {
  return (a, b) => {
    const mage = Number(a.type === UnitType.Mage) - Number(b.type === UnitType.Mage);
    return mage || toCentre2(a, town) - toCentre2(b, town) || a.id - b.id;
  };
}

export class ArmyBook {
  /** Town id → the soldiers stationed there. */
  private readonly garrisons = new Map<number, number[]>();
  /** Town id → the soldiers stationed together with a 搶 or 治理 (command `seq`) that the simulation has not answered yet. */
  private readonly pending = new Map<number, { seq: number; ids: number[] }>();
  readonly groups: Group[] = [{ ids: [] }, { ids: [] }, { ids: [] }, { ids: [] }];

  garrisonOf(town: number): number[] {
    return [...(this.garrisons.get(town) ?? [])];
  }

  isGarrisoned(id: number): boolean {
    for (const ids of this.garrisons.values()) if (ids.includes(id)) return true;
    return false;
  }

  /** Soldiers that could be stationed in this town now: inside it and not stationed anywhere, first choice first. */
  candidates(units: ArmyUnit[], town: TownArea): number[] {
    return units
      .filter((u) => isSoldier(u.type) && inTown(u, town) && !this.isGarrisoned(u.id))
      .sort(byGarrisonOrder(town))
      .map((u) => u.id);
  }

  /**
   * Station up to n more soldiers in the town. They leave their control groups, and 全軍 no
   * longer takes them. Returns the ids stationed (the caller sets them to 堅守).
   */
  station(units: ArmyUnit[], town: TownArea, n: number): number[] {
    const chosen = this.candidates(units, town).slice(0, Math.max(0, n));
    if (chosen.length === 0) return [];
    this.garrisons.set(town.id, [...(this.garrisons.get(town.id) ?? []), ...chosen]);
    for (const g of this.groups) g.ids = g.ids.filter((id) => !chosen.includes(id));
    return chosen;
  }

  /**
   * Take one soldier off the town's garrison: the last choice goes first (a mage before the
   * others, then the one farthest from the centre, then the higher id). Returns its id (the
   * caller sets it back to 積極), or null when nobody is stationed there.
   */
  releaseOne(units: ArmyUnit[], town: TownArea): number | null {
    const ids = this.garrisons.get(town.id) ?? [];
    const here = units.filter((u) => ids.includes(u.id)).sort(byGarrisonOrder(town));
    const last = here.at(-1);
    if (last === undefined) return null;
    this.drop([last.id]);
    return last.id;
  }

  /** These units stop being garrison (the player ordered them away). Returns the ones that were stationed. */
  release(ids: number[]): number[] {
    const stationed = ids.filter((id) => this.isGarrisoned(id));
    this.drop(stationed);
    return stationed;
  }

  /**
   * Forget the dead, and end the garrison of every town that is no longer held (plundered
   * to ruins, revolted, taken). Returns the survivors released that way.
   */
  prune(alive: (id: number) => boolean, held: (town: number) => boolean): number[] {
    const released: number[] = [];
    for (const [town, ids] of [...this.garrisons]) {
      const living = ids.filter(alive);
      if (held(town) && living.length > 0) {
        this.garrisons.set(town, living);
      } else {
        this.garrisons.delete(town);
        released.push(...living);
      }
    }
    for (const g of this.groups) if (g.ids.some((id) => !alive(id))) g.ids = g.ids.filter(alive);
    return released;
  }

  /** These soldiers were stationed together with a 搶 or 治理 (command `seq`) that is still to be answered. */
  awaitChoice(town: number, seq: number, ids: number[]): void {
    if (ids.length > 0) this.pending.set(town, { seq, ids: [...ids] });
  }

  /**
   * The simulation refused command `seq`. If it was a 搶 or 治理 with soldiers stationed, they
   * stop being garrison (the town still waits for a choice). Returns them.
   */
  refused(seq: number): number[] {
    for (const [town, p] of [...this.pending]) {
      if (p.seq !== seq) continue;
      this.pending.delete(town);
      return this.release(p.ids);
    }
    return [];
  }

  /** Forget the choices that went through: their towns no longer wait for one. */
  settle(awaiting: (town: number) => boolean): void {
    for (const town of [...this.pending.keys()]) if (!awaiting(town)) this.pending.delete(town);
  }

  /** 全軍: every soldier that is not stationed in a town, in id order. */
  army(units: ArmyUnit[]): number[] {
    return units
      .filter((u) => isSoldier(u.type) && !this.isGarrisoned(u.id))
      .map((u) => u.id)
      .sort((a, b) => a - b);
  }

  private drop(ids: number[]): void {
    for (const [town, list] of [...this.garrisons]) {
      const left = list.filter((id) => !ids.includes(id));
      if (left.length > 0) this.garrisons.set(town, left);
      else this.garrisons.delete(town);
    }
  }
}
