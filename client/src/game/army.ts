// Who stays behind and who marches (D-026, GDD §5 and §10): the soldiers left in a town as
// its garrison (留守), 全軍 and the control groups without them, and the control groups that
// fill themselves up with newly trained soldiers (編隊自動補兵) and with the soldiers in no group
// (軍團, D-050: the player sets how many of each type a group wants). Bookkeeping on unit ids
// only, with no screen and no clock (the caller passes the simulation's tick), so the rules
// are unit tested and the interface just draws them.
//
// Positions are the simulation's fixed point and "inside the town" is the simulation's own
// test (a circle around the town centre, sim/src/core/towns.ts), so 留守 here and 駐軍 in the
// snapshot count the same soldiers.

import { CELL, type CommandBody, UnitType } from "../sim.ts";

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

/** How often recruits are checked against where their group is now: 2 s of game time. */
export const RECRUIT_RECHECK_TICKS = 40;
/** A recruit this close to its group has joined it (cells). */
export const RECRUIT_JOINED_CELLS = 6;
/** The group has moved this far from where its recruits were sent: they are sent again (cells). */
export const RECRUIT_RETARGET_CELLS = 3;
/**
 * At most one message about recruits per minute of game time: with 自動訓練 (D-054) every
 * barracks, range and mage hall sends one every 12 to 35 s, and a message each would bury
 * the battlefield. The group buttons count them all the same.
 */
export const RECRUIT_MESSAGE_TICKS = 1200;

/**
 * A soldier added by 自動補兵 (or drafted, D-050) that has not joined up with its group yet.
 * It sets off for the group at once (D-054: 「新造出來的兵也不會自動去和大部隊匯合」).
 */
export interface Recruit {
  id: number;
  /** The player gave it an order himself: it is no longer led, but until it reaches the group it does not count as where the group is. */
  byHand: boolean;
}

/** A control group (編隊 1–4). */
export interface Group {
  ids: number[];
  /** Soldiers of each type the group wants (UnitType → count): what 自動補兵 fills it up to; set by 軍團設定 or by saving a selection. */
  want: Record<number, number>;
  /** Units the group wants in all (目標): its soldiers wanted, and the farmers saved with it. */
  saved: number;
  /** 自動補兵 is on. */
  refill: boolean;
  recruits: Recruit[];
  /** Where marching recruits were last sent (fixed point). */
  goal: { x: number; y: number } | null;
  /** The tick the recruits were last checked. */
  checked: number;
}

/** A 前進 order for recruits, to a cell. */
export interface MarchOrder {
  ids: number[];
  cellX: number;
  cellY: number;
}

const emptyGroup = (): Group => ({ ids: [], want: {}, saved: 0, refill: true, recruits: [], goal: null, checked: Number.NEGATIVE_INFINITY });

/** The soldier types 軍團設定 sets, in the order of its rows (騎兵 only while `features.cavalry`, round 7). */
export const GROUP_TYPES = [UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry] as const;

/** The units 全軍 and the garrison rules are about: farmers are not soldiers. */
export function isSoldier(type: number): boolean {
  return type === UnitType.Spearman || type === UnitType.Ranged || type === UnitType.Mage || type === UnitType.Cavalry;
}

/** The orders that send units somewhere or set them to a task: 前進、攻擊、撤退、停止、晶砲, and a farmer's work. */
const REDIRECTS: ReadonlySet<CommandBody["c"]> = new Set(["move", "attack", "retreat", "stop", "cast", "gather", "build", "repair"]);

/** Whether this order changes where its units go or what they do (not 姿態、自動施放、隊形). */
export function redirects(cmd: CommandBody): cmd is Extract<CommandBody, { u: number | number[] }> {
  return REDIRECTS.has(cmd.c) && "u" in cmd;
}

/**
 * 散開 (D-027): more than half of these units are loose, the rule the simulation uses for
 * troops told to move together. A recruit joining such a group is made loose too.
 */
export function mostlyLoose(ids: number[], isLoose: (id: number) => boolean): boolean {
  return ids.filter(isLoose).length * 2 > ids.length;
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
  readonly groups: Group[] = [emptyGroup(), emptyGroup(), emptyGroup(), emptyGroup()];

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

  /**
   * 哨所 (D-080): these soldiers stand guard at an outpost. Like those stationed in a town they
   * leave their control groups, which fill up again (自動補兵).
   */
  leaveGroups(ids: readonly number[]): void {
    for (const g of this.groups) {
      if (!g.ids.some((id) => ids.includes(id))) continue;
      g.ids = g.ids.filter((id) => !ids.includes(id));
      g.recruits = g.recruits.filter((r) => !ids.includes(r.id));
    }
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

  // --- control groups and 自動補兵 (GDD §10) --------------------------------------------

  /**
   * 長按編隊按鈕: these units become group i, which remembers how many soldiers of each type
   * it has. A unit belongs to one group only: it leaves the others, and their 原本 shrinks
   * with it (the player is regrouping, which must not read as losses to fill).
   */
  saveGroup(i: number, units: { id: number; type: number }[]): void {
    this.groups.forEach((g, k) => {
      if (k === i) return;
      for (const u of units) {
        if (!g.ids.includes(u.id)) continue;
        g.ids = g.ids.filter((id) => id !== u.id);
        g.saved = Math.max(0, g.saved - 1);
        if (g.want[u.type] !== undefined) g.want[u.type] = Math.max(0, g.want[u.type] - 1);
      }
    });
    const g = this.groups[i];
    const ids = units.map((u) => u.id);
    const want: Record<number, number> = {};
    for (const u of units) if (isSoldier(u.type)) want[u.type] = (want[u.type] ?? 0) + 1;
    g.ids = ids;
    g.want = want;
    g.saved = ids.length;
    g.recruits = g.recruits.filter((r) => ids.includes(r.id));
  }

  /**
   * A soldier of ours was just trained. It joins the group that is shortest of its type
   * among those with 自動補兵 on (the lower number on a tie), and sets off for it at the next
   * muster. Returns the group's index, or null when no group is short of this type.
   * `typeOf`: the type of a living unit, null for a dead one.
   */
  enlist(id: number, type: number, typeOf: (id: number) => number | null): number | null {
    const best = this.shortest(id, type, typeOf);
    if (best === null) return null;
    this.join(best, id);
    return best;
  }

  /**
   * D-054: a new soldier no group is short of joins the group with the most soldiers now (the
   * main army, the lower number on a tie, 自動補兵 on), which wants one more of its type, so it
   * is a member and is selected with it. Returns the group, or null with no group to join (it
   * stays where the simulation put it: the rally point, or by its building).
   */
  joinLargest(id: number, type: number, typeOf: (id: number) => number | null): number | null {
    if (!isSoldier(type)) return null;
    let best: number | null = null;
    let most = 0;
    this.groups.forEach((g, i) => {
      if (!g.refill || g.ids.includes(id)) return;
      const n = g.ids.filter((m) => typeOf(m) !== null).length;
      if (n > most) {
        most = n;
        best = i;
      }
    });
    if (best === null) return null;
    const g = this.groups[best];
    g.want = { ...g.want, [type]: (g.want[type] ?? 0) + 1 };
    g.saved += 1;
    this.join(best, id);
    return best;
  }

  /** The unit becomes a recruit of group i, and everyone marching is sent again at the next muster. */
  private join(i: number, id: number): void {
    const g = this.groups[i];
    g.ids = [...g.ids, id];
    g.recruits.push({ id, byHand: false });
    g.goal = null;
    g.checked = Number.NEGATIVE_INFINITY;
  }

  /** The group most short of this type among those with 自動補兵 on (the lower number on a tie), or null. */
  private shortest(id: number, type: number, typeOf: (id: number) => number | null): number | null {
    if (!isSoldier(type)) return null;
    let best: number | null = null;
    let most = 0;
    this.groups.forEach((g, i) => {
      if (!g.refill || g.ids.includes(id)) return;
      const short = (g.want[type] ?? 0) - g.ids.filter((m) => typeOf(m) === type).length;
      if (short > most) {
        most = short;
        best = i;
      }
    });
    return best;
  }

  /**
   * 軍團 (D-050): the soldiers in no group and not stationed in a town join the groups that
   * are short of their type, by the rule of 自動補兵 (the one most short, the lower number on a
   * tie), in id order. They are spread over the map, so they do not wait for company: each
   * sets off for its group at the next muster. Returns who joined which group.
   * `idle`: whether a soldier may be taken now. The game passes those standing with no order
   * and not holding (堅守), so that no order of the player's is undone; the others are taken
   * once they stand idle.
   */
  draft(units: ArmyUnit[], idle: (id: number) => boolean = () => true): { group: number; ids: number[] }[] {
    const inGroup = new Set(this.groups.flatMap((g) => g.ids));
    const typeOf = new Map(units.map((u) => [u.id, u.type]));
    const free = units.filter((u) => isSoldier(u.type) && !inGroup.has(u.id) && !this.isGarrisoned(u.id) && idle(u.id)).sort((a, b) => a.id - b.id);
    const out: { group: number; ids: number[] }[] = [];
    for (const u of free) {
      const best = this.shortest(u.id, u.type, (m) => typeOf.get(m) ?? null);
      if (best === null) continue;
      this.join(best, u.id);
      const entry = out.find((e) => e.group === best);
      if (entry === undefined) out.push({ group: best, ids: [u.id] });
      else entry.ids.push(u.id);
    }
    return out;
  }

  /**
   * 軍團設定: group i wants n soldiers of this type. With more of them than that, the last to
   * join leave the group (they are free again, for the groups still short). Returns those.
   * `typeOf`: the type of a living unit, null for a dead one.
   */
  setWant(i: number, type: number, n: number, typeOf: (id: number) => number | null): number[] {
    const g = this.groups[i];
    const want = Math.max(0, Math.floor(n));
    g.want = { ...g.want, [type]: want };
    const leave = g.ids.filter((id) => typeOf(id) === type).slice(want);
    if (leave.length > 0) {
      g.ids = g.ids.filter((id) => !leave.includes(id));
      g.recruits = g.recruits.filter((r) => !leave.includes(r.id));
    }
    const farmers = g.ids.filter((id) => {
      const t = typeOf(id);
      return t !== null && !isSoldier(t);
    }).length;
    g.saved = GROUP_TYPES.reduce((sum, t) => sum + (g.want[t] ?? 0), 0) + farmers;
    return leave;
  }

  /** 軍團設定 清空: group i has nobody and wants nobody. Returns who was in it. */
  clearGroup(i: number): number[] {
    const g = this.groups[i];
    const was = g.ids;
    g.ids = [];
    g.want = {};
    g.saved = 0;
    g.recruits = [];
    g.goal = null;
    return was;
  }

  /**
   * Called with every snapshot. Recruits walk to their group as soon as they join it (D-054:
   * no waiting for company any more); they are sent again when the group moves on, and left
   * alone once they are within 6 cells of it. A group with nobody to join (軍團 just set up,
   * or everyone fell): its recruits are the group where they stand (D-080: 「部隊剛編兵的時候
   * 預測就是站在原地，不要往主城集合」). Returns the 前進 orders to give.
   * `where`: a living unit's position (fixed point), null for a dead one.
   */
  muster(tick: number, where: (id: number) => { x: number; y: number } | null): MarchOrder[] {
    const orders: MarchOrder[] = [];
    for (const g of this.groups) {
      if (g.recruits.length === 0) continue;
      g.recruits = g.recruits.filter((r) => g.ids.includes(r.id) && where(r.id) !== null);
      const recruit = new Set(g.recruits.map((r) => r.id));
      let n = 0;
      let cx = 0;
      let cy = 0;
      for (const id of g.ids) {
        const p = recruit.has(id) ? null : where(id);
        if (p === null) continue;
        n++;
        cx += p.x;
        cy += p.y;
      }
      if (n === 0) {
        // Nobody to join: the recruits are the group now, where they stand.
        g.recruits = [];
        g.goal = null;
        continue;
      }
      cx /= n;
      cy /= n;
      const far = (p: { x: number; y: number }, cells: number): boolean => (p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy) > cells * CELL * (cells * CELL);

      if (tick - g.checked < RECRUIT_RECHECK_TICKS) continue;
      g.checked = tick;
      // Those already with the group have joined it.
      g.recruits = g.recruits.filter((r) => far(where(r.id) as { x: number; y: number }, RECRUIT_JOINED_CELLS));
      const marching = g.recruits.filter((r) => !r.byHand);
      if (marching.length === 0) {
        if (g.recruits.length === 0) g.goal = null;
        continue;
      }
      if (g.goal === null || far(g.goal, RECRUIT_RETARGET_CELLS)) {
        g.goal = { x: cx, y: cy };
        orders.push({ ids: marching.map((r) => r.id), cellX: Math.floor(cx / CELL), cellY: Math.floor(cy / CELL) });
      }
    }
    return orders;
  }

  /**
   * An order the player gave himself. One that changes where they go or what they do
   * (`redirects`) ends 自動補兵's lead for the recruits among them; 姿態、自動施放、隊形 do not,
   * or a recruit given a stance would stay behind when its group moves on.
   */
  playerCommand(cmd: CommandBody): void {
    if (!redirects(cmd)) return;
    this.playerOrdered(Array.isArray(cmd.u) ? cmd.u : [cmd.u]);
  }

  /** The player ordered these units himself: recruits among them are no longer led to their group (they stay in it). */
  playerOrdered(ids: number[]): void {
    for (const g of this.groups) for (const r of g.recruits) if (ids.includes(r.id)) r.byHand = true;
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
