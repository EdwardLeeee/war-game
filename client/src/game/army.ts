// Who stays behind and who marches (D-026, GDD §5 and §10): the soldiers left in a town as
// its garrison (留守), 全軍 and the control groups without them (the user 2026-10-26: those
// stationed are still their group's, 「我把兵團駐守在這座城池裡面，那我當然可以再把它抽回來」;
// they come out again with 出城歸隊 and walk back to it), and the control groups that
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
  /** On its town's wall or going up (Order.Wall, D-096): the first to stay in a town. */
  wall?: boolean;
}

export interface TownArea {
  id: number;
  cellX: number;
  cellY: number;
  /** Cells. */
  radius: number;
  /** The cells inside its walls (D-089, map cells, inclusive): the town is what lies inside them; without, the radius. */
  inside?: { x0: number; y0: number; x1: number; y1: number } | null;
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

/**
 * What 繼續上一局 keeps of the book (D-083): the groups and the towns' garrisons. Plain data, for
 * IndexedDB; a group's `checked` −∞ (never checked) is null.
 */
export interface ArmyState {
  groups: (Omit<Group, "checked"> & { checked: number | null })[];
  garrisons: [number, number[]][];
  /**
   * Those once kept out of 自動補兵 after hiding (D083-1-A, overturned by the user 2026-10-26):
   * always empty now, ignored when read; kept so that the saved format stays the same.
   */
  keptOut: number[];
}

/** A 前進 order for recruits, to a cell. */
export interface MarchOrder {
  ids: number[];
  cellX: number;
  cellY: number;
}

const emptyGroup = (): Group => ({ ids: [], want: {}, saved: 0, refill: true, recruits: [], goal: null, checked: Number.NEGATIVE_INFINITY });

/** The soldier types 軍團設定 sets, in the order of its rows (騎兵 only while `features.cavalry`, round 7). */
export const GROUP_TYPES = [UnitType.Spearman, UnitType.Ranged, UnitType.Mage, UnitType.Cavalry, UnitType.Siege] as const;

/**
 * 軍團設定 (D-083: 「一隻部隊單一兵種上限只能50隻」): one type of soldier a group may want up to
 * the population's ceiling, so a whole army of one type fits in one group. `rules.maxPopulation`
 * (120) until the simulation gives the ceiling of the game (core's D-083: 200 and more with towns).
 */
export function groupWantMax(rules: { maxPopulation: number }, ceiling: number | null = null): number {
  return Math.max(1, ceiling ?? rules.maxPopulation);
}

/** The units 全軍 and the garrison rules are about: farmers are not soldiers. */
export function isSoldier(type: number): boolean {
  return type === UnitType.Spearman || type === UnitType.Ranged || type === UnitType.Mage || type === UnitType.Cavalry || type === UnitType.Siege;
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

/**
 * Soldiers put out of a group and taken by another at once (the user 2026-10-31: 「兵如果從一個編隊
 * 被踢出，假如有別的編隊缺兵應該要加入」), for the message strip: 「3 名槍兵改編入編隊 2」, 「3 名兵…」
 * with more than one type. `types`: theirs; `group`: its index.
 */
export function movedText(types: readonly number[], group: number, names: Record<number, string>): string {
  const one = types.every((t) => t === types[0]);
  return `${types.length} 名${one ? (names[types[0]] ?? "兵") : "兵"}改編入編隊 ${group + 1}`;
}

/** Squared distance from the unit to the town centre, fixed point (within 2^53 on any map). */
function toCentre2(u: ArmyUnit, town: TownArea): number {
  const dx = u.x - (town.cellX * CELL + CELL / 2);
  const dy = u.y - (town.cellY * CELL + CELL / 2);
  return dx * dx + dy * dy;
}

export function inTown(u: ArmyUnit, town: TownArea): boolean {
  const box = town.inside;
  if (box !== undefined && box !== null) {
    // Inside the walls, as the simulation counts (PROTOCOL.md 3.5; on a gate is not in).
    const cx = Math.floor(u.x / CELL);
    const cy = Math.floor(u.y / CELL);
    return cx >= box.x0 && cx <= box.x1 && cy >= box.y0 && cy <= box.y1;
  }
  const r = town.radius * CELL;
  return toCentre2(u, town) <= r * r;
}

/** Who stays in a town first, by type (ceo 2026-10-26: 遠程 on the wall first): ranged, spearmen, cavalry, siege, mages last (the army wants them). */
const STAY_RANK: Record<number, number> = { [UnitType.Ranged]: 0, [UnitType.Spearman]: 1, [UnitType.Cavalry]: 2, [UnitType.Siege]: 3, [UnitType.Mage]: 4 };

/**
 * The order soldiers are chosen to stay: those on its wall first, then by type (STAY_RANK), then
 * nearest the town centre, then the lower id. They come out the other way round.
 */
function byGarrisonOrder(town: TownArea): (a: ArmyUnit, b: ArmyUnit) => number {
  return (a, b) => {
    const wall = Number(b.wall === true) - Number(a.wall === true);
    const rank = (STAY_RANK[a.type] ?? 5) - (STAY_RANK[b.type] ?? 5);
    return wall || rank || toCentre2(a, town) - toCentre2(b, town) || a.id - b.id;
  };
}

export class ArmyBook {
  /** Town id → the soldiers stationed there. */
  private readonly garrisons = new Map<number, number[]>();
  /** Town id → the soldiers stationed together with a 搶 or 治理 (command `seq`) that the simulation has not answered yet. */
  private readonly pending = new Map<number, { seq: number; ids: number[] }>();
  readonly groups: Group[] = [emptyGroup(), emptyGroup(), emptyGroup(), emptyGroup()];
  /**
   * The groups' members away from them as of the last snapshot: spearmen posted at an outpost
   * (哨所, D-080) and soldiers hiding in a building (躲進建築, D-083), on their way too. Still
   * their groups' (counted in what each wants), out of their buttons, as those stationed in a
   * town (the user 2026-10-26, overturning D083-1-A: 「都照駐軍的新做法」).
   */
  private readonly away = new Set<number>();
  /** A snapshot has been seen (updateAway): after 繼續上一局 the first one finds those away already. */
  private awaySeen = false;

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

  /** The town each of these soldiers is stationed in, those stationed only, in town order. */
  townsOf(ids: readonly number[]): number[] {
    return [...this.garrisons].filter(([, list]) => list.some((id) => ids.includes(id))).map(([town]) => town).sort((a, b) => a - b);
  }

  /** The group a unit is in, or null. */
  groupOf(id: number): number | null {
    const i = this.groups.findIndex((g) => g.ids.includes(id));
    return i < 0 ? null : i;
  }

  /** How many of these units are in each group. */
  perGroup(ids: readonly number[]): number[] {
    return this.groups.map((g) => g.ids.filter((id) => ids.includes(id)).length);
  }

  /** Stationed in a town, or away from its group at an outpost or in a building. */
  private parked(id: number): boolean {
    return this.away.has(id) || this.isGarrisoned(id);
  }

  /** Whether this member is away from its group at an outpost or in a building (as of the last snapshot). */
  isAway(id: number): boolean {
    return this.away.has(id);
  }

  /** Group i's members at an outpost or in a building (as of the last snapshot). */
  awayOf(i: number): number[] {
    return this.groups[i].ids.filter((id) => this.away.has(id));
  }

  /** Group i's members not stationed in a town nor away: those its button selects, 「退」 sends, its alarm counts and its recruits walk to. */
  marching(i: number): number[] {
    return this.groups[i].ids.filter((id) => !this.parked(id));
  }

  /**
   * Every snapshot (哨所 D-080, 躲進建築 D-083): the groups' members now away (`away`: posted at an
   * outpost or hiding in a building, on their way too) stay their groups' but are out of their
   * buttons and no longer recruits; those back with no order (`idle`: 全部離開, 全部出來, the
   * building gone) walk back to their group. Those back with an order of the player's go where he
   * sent them. Returns how many of each group went away since the last snapshot (none on the
   * first one: after 繼續上一局 they were away already) and who came back.
   */
  updateAway(away: (id: number) => boolean, idle: (id: number) => boolean): { left: number[]; back: number[] } {
    const left = this.groups.map(() => 0);
    const back: number[] = [];
    this.groups.forEach((g, i) => {
      for (const id of g.ids) {
        if (away(id)) {
          if (this.away.has(id)) continue;
          this.away.add(id);
          if (this.awaySeen) left[i]++;
        } else if (this.away.delete(id) && idle(id)) {
          back.push(id);
        }
      }
    });
    // Those in no group any more, or dead (pruned), are forgotten.
    for (const id of [...this.away]) if (this.groupOf(id) === null) this.away.delete(id);
    this.stay([...this.away]);
    this.rejoin(back);
    this.awaySeen = true;
    return { left, back };
  }

  /** Where group i stands: the centre of its members with it (not recruits, not stationed or away), fixed point; null with none. */
  centreOf(i: number, where: (id: number) => { x: number; y: number } | null): { x: number; y: number } | null {
    const g = this.groups[i];
    const recruit = new Set(g.recruits.map((r) => r.id));
    let n = 0;
    let cx = 0;
    let cy = 0;
    for (const id of g.ids) {
      const p = recruit.has(id) || this.parked(id) ? null : where(id);
      if (p === null) continue;
      n++;
      cx += p.x;
      cy += p.y;
    }
    return n === 0 ? null : { x: cx / n, y: cy / n };
  }

  /** Group i's members stationed in towns (駐守中), town by town in town order. */
  stationedOf(i: number): { town: number; ids: number[] }[] {
    const g = this.groups[i];
    return [...this.garrisons]
      .map(([town, list]) => ({ town, ids: list.filter((id) => g.ids.includes(id)) }))
      .filter((e) => e.ids.length > 0)
      .sort((a, b) => a.town - b.town);
  }

  /** The town's 留守 by group, in group order, those in no group last (group null). */
  garrisonByGroup(town: number): { group: number | null; ids: number[] }[] {
    const list = this.garrisons.get(town) ?? [];
    const out: { group: number | null; ids: number[] }[] = [];
    this.groups.forEach((g, i) => {
      const ids = list.filter((id) => g.ids.includes(id));
      if (ids.length > 0) out.push({ group: i, ids });
    });
    const none = list.filter((id) => this.groupOf(id) === null);
    if (none.length > 0) out.push({ group: null, ids: none });
    return out;
  }

  /**
   * Station up to n more soldiers in the town. They stay in their control groups (counted in
   * what each wants, so 自動補兵 does not replace them), but the groups' buttons, 全軍 and 「退」
   * no longer take them. Returns the ids stationed (the caller sets them to 堅守).
   */
  station(units: ArmyUnit[], town: TownArea, n: number): number[] {
    const chosen = this.candidates(units, town).slice(0, Math.max(0, n));
    if (chosen.length === 0) return [];
    this.garrisons.set(town.id, [...(this.garrisons.get(town.id) ?? []), ...chosen]);
    this.stay(chosen);
    return chosen;
  }

  /**
   * 駐軍 (station.ts), 上城牆: these soldiers stay in the town from now, on their way in too (out of
   * any other garrison). Returns how many of each group were not stationed before.
   */
  stationAll(town: number, ids: readonly number[]): number[] {
    const fresh = ids.filter((id) => !this.isGarrisoned(id));
    this.drop([...ids]);
    this.garrisons.set(town, [...(this.garrisons.get(town) ?? []), ...ids]);
    this.stay(ids);
    return this.perGroup(fresh);
  }

  /** Stationed: no longer a recruit walking to its group. */
  private stay(ids: readonly number[]): void {
    for (const g of this.groups) if (g.recruits.some((r) => ids.includes(r.id))) g.recruits = g.recruits.filter((r) => !ids.includes(r.id));
  }

  /**
   * Take one soldier off the town's garrison: the last choice goes first (a mage before the
   * others, then the one farthest from the centre, then the higher id). It walks back to its
   * group, if it has one. Returns its id (the caller sets it back to 積極), or null when nobody
   * is stationed there.
   */
  releaseOne(units: ArmyUnit[], town: TownArea): number | null {
    const ids = this.garrisons.get(town.id) ?? [];
    const here = units.filter((u) => ids.includes(u.id)).sort(byGarrisonOrder(town));
    const last = here.at(-1);
    if (last === undefined) return null;
    this.drop([last.id]);
    this.rejoin([last.id]);
    return last.id;
  }

  /**
   * 出城歸隊、歸隊、解除留守、全部帶走 (the user 2026-10-26, choosing 自動留最少人數): those of the
   * town's 留守 that `whose` picks come out, but the town keeps `keep` in all; the others stationed
   * there count first, then those picked stay in the order soldiers are chosen to stay. Those in a
   * group walk back to it (as recruits); those in none are 全軍's again. Returns who came out (the
   * caller sets them to 積極) and who stayed.
   */
  unstation(units: ArmyUnit[], town: TownArea, whose: (id: number) => boolean, keep: number): { out: number[]; kept: number[] } {
    const list = this.garrisons.get(town.id) ?? [];
    const mine = list.filter(whose);
    const stay = Math.max(0, Math.min(mine.length, keep - (list.length - mine.length)));
    const at = new Map(units.map((u) => [u.id, u]));
    // Those not among the units (hiding in a building) are no help to the town: they go first.
    const ranked = [
      ...mine
        .map((id) => at.get(id))
        .filter((u): u is ArmyUnit => u !== undefined)
        .sort(byGarrisonOrder(town))
        .map((u) => u.id),
      ...mine.filter((id) => !at.has(id)),
    ];
    const kept = ranked.slice(0, stay);
    const out = ranked.slice(stay);
    this.drop(out);
    this.rejoin(out);
    return { out, kept };
  }

  /** 下城牆: these soldiers, those in a group, are out of any garrison and walk back to their groups. Returns those. */
  backToGroups(ids: readonly number[]): number[] {
    const grouped = ids.filter((id) => this.groupOf(id) !== null);
    this.drop(grouped);
    this.rejoin(grouped);
    return grouped;
  }

  /** These soldiers, out of a town, walk back to their groups (as 自動補兵's recruits, from the next muster). */
  private rejoin(ids: readonly number[]): void {
    for (const g of this.groups) {
      const back = ids.filter((id) => g.ids.includes(id) && !g.recruits.some((r) => r.id === id));
      if (back.length === 0) continue;
      for (const id of back) g.recruits.push({ id, byHand: false });
      g.goal = null;
      g.checked = Number.NEGATIVE_INFINITY;
    }
  }

  /** 繼續上一局 (D-083): the book as plain data. 搶 and 治理 waiting for the simulation's answer are not kept. */
  save(): ArmyState {
    return {
      groups: this.groups.map((g) => ({
        ids: [...g.ids],
        want: { ...g.want },
        saved: g.saved,
        refill: g.refill,
        recruits: g.recruits.map((r) => ({ ...r })),
        goal: g.goal === null ? null : { ...g.goal },
        checked: Number.isFinite(g.checked) ? g.checked : null,
      })),
      garrisons: [...this.garrisons].map(([town, ids]) => [town, [...ids]]),
      keptOut: [],
    };
  }

  /** 繼續上一局: the book as saved (save()). */
  restore(s: ArmyState): void {
    this.groups.forEach((g, i) => {
      const k = s.groups[i];
      if (k === undefined) return;
      g.ids = [...k.ids];
      g.want = { ...k.want };
      g.saved = k.saved;
      g.refill = k.refill;
      g.recruits = k.recruits.map((r) => ({ ...r }));
      g.goal = k.goal === null ? null : { ...k.goal };
      g.checked = k.checked ?? Number.NEGATIVE_INFINITY;
    });
    this.garrisons.clear();
    for (const [town, ids] of s.garrisons) this.garrisons.set(town, [...ids]);
    this.pending.clear();
    this.away.clear();
    this.awaySeen = false;
  }

  /**
   * These units stop being garrison (the player ordered them away, GDD §5): they stay in their
   * groups and go where he sent them. Returns the ones that were stationed.
   */
  release(ids: number[]): number[] {
    const stationed = ids.filter((id) => this.isGarrisoned(id));
    this.drop(stationed);
    return stationed;
  }

  /**
   * Forget the dead, and end the garrison of every town that is no longer held (plundered
   * to ruins, revolted, taken). Returns the survivors released that way; those in a group walk
   * back to it.
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
    this.rejoin(released);
    return released;
  }

  /** These soldiers were stationed together with a 搶 or 治理 (command `seq`) that is still to be answered. */
  awaitChoice(town: number, seq: number, ids: number[]): void {
    if (ids.length > 0) this.pending.set(town, { seq, ids: [...ids] });
  }

  /**
   * The simulation refused command `seq`. If it was a 搶 or 治理 with soldiers stationed, they
   * stop being garrison (the town still waits for a choice) and rejoin their groups. Returns them.
   */
  refused(seq: number): number[] {
    for (const [town, p] of [...this.pending]) {
      if (p.seq !== seq) continue;
      this.pending.delete(town);
      const out = this.release(p.ids);
      this.rejoin(out);
      return out;
    }
    return [];
  }

  /** Command `seq` was refused but its soldiers stay stationed (等錢治理): forget it without releasing them. */
  keepStationed(seq: number): void {
    for (const [town, p] of [...this.pending]) if (p.seq === seq) this.pending.delete(town);
  }

  /** Forget the choices that went through: their towns no longer wait for one. */
  settle(awaiting: (town: number) => boolean): void {
    for (const town of [...this.pending.keys()]) if (!awaiting(town)) this.pending.delete(town);
  }

  // --- control groups and 自動補兵 (GDD §10) --------------------------------------------

  /**
   * 長按編隊按鈕: these units become group i, which remembers how many soldiers of each type
   * it has. A unit belongs to one group only: it leaves the others, and their 原本 shrinks
   * with it (the player is regrouping, which must not read as losses to fill). Its members
   * stationed in towns or at outposts stay in it (the group's button does not select them):
   * `typeOf` gives their types, null for the dead. Returns those it put out of group i.
   */
  saveGroup(i: number, units: { id: number; type: number }[], typeOf: (id: number) => number | null = () => null): number[] {
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
    const away = g.ids
      .filter((id) => this.parked(id) && !units.some((u) => u.id === id))
      .map((id) => ({ id, type: typeOf(id) }))
      .filter((u): u is { id: number; type: number } => u.type !== null);
    units = [...units, ...away];
    const ids = units.map((u) => u.id);
    const want: Record<number, number> = {};
    for (const u of units) if (isSoldier(u.type)) want[u.type] = (want[u.type] ?? 0) + 1;
    const out = g.ids.filter((id) => !ids.includes(id));
    g.ids = ids;
    g.want = want;
    g.saved = ids.length;
    g.recruits = g.recruits.filter((r) => ids.includes(r.id));
    return out;
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
      // The main army: those stationed in towns or at outposts are not marching with it.
      const n = g.ids.filter((m) => typeOf(m) !== null && !this.parked(m)).length;
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
   * join leave the group (they are free again, for the groups still short), those stationed in
   * towns or at outposts last. Returns those.
   * `typeOf`: the type of a living unit, null for a dead one.
   */
  setWant(i: number, type: number, n: number, typeOf: (id: number) => number | null): number[] {
    const g = this.groups[i];
    const want = Math.max(0, Math.floor(n));
    g.want = { ...g.want, [type]: want };
    const ofType = g.ids.filter((id) => typeOf(id) === type);
    const leave = [...ofType.filter((id) => this.parked(id)), ...ofType.filter((id) => !this.parked(id))].slice(want);
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
   * everyone fell, or everyone else stays in towns or at outposts): its recruits are the group where they stand
   * (D-080: 「部隊剛編兵的時候預測就是站在原地，不要往主城集合」). Returns the 前進 orders to give.
   * `where`: a living unit's position (fixed point), null for a dead one.
   */
  muster(tick: number, where: (id: number) => { x: number; y: number } | null): MarchOrder[] {
    const orders: MarchOrder[] = [];
    for (const g of this.groups) {
      if (g.recruits.length === 0) continue;
      g.recruits = g.recruits.filter((r) => g.ids.includes(r.id) && where(r.id) !== null);
      const centre = this.centreOf(this.groups.indexOf(g), where);
      if (centre === null) {
        // Nobody to join: the recruits are the group now, where they stand.
        g.recruits = [];
        g.goal = null;
        continue;
      }
      const cx = centre.x;
      const cy = centre.y;
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
