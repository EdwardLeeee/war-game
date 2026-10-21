// Unit behaviour for one tick, in phases the game calls in order: prepare (bucket by cell),
// decide (targets, stance, orders -> desired velocity; farmers at work are decided by the
// economy), move (separation from start-of-tick positions, wall sliding), attack (cooldowns,
// damage summed per target), then, after the economy's work, remove the dead. Every loop
// runs in id order and reads start-of-tick state, so results do not depend on iteration
// details.

import {
  Action,
  BuildingFlag,
  BuildingType,
  CELL,
  CELL_SHIFT,
  GameOverReason,
  NEUTRAL,
  Order,
  PLAYER_COUNT,
  Resource,
  type SimEvent,
  Stance,
  TICKS_PER_SECOND,
  TownState,
  UnitFlag,
  UnitType,
} from "../protocol.ts";
import { clamp, DIR16_X, DIR16_Y, dir16, idiv, isqrt } from "./fixed.ts";
import type { Fog } from "./fog.ts";
import { type FieldCache, buildingKey, cellsAround, nearestWalkable, Regions } from "./paths.ts";
import {
  AGGRO_RANGE,
  ARRIVE_DISTANCE,
  ARROW_TOWER,
  GARRISON,
  BUILDINGS,
  AVENGE,
  CANNON,
  CAV_FLANK,
  DODGE,
  FIRE_BACK,
  GATE,
  GATE_ARROW,
  WALLS,
  HOME_GUARD,
  COUNTER_ATTACK,
  MAGE_BOUNTY,
  SHIELD,
  SHIELD_REGEN,
  SLOT_GIVE_UP,
  DIRECT_STEER,
  JOIN_FIGHT,
  SQUAD,
  LEASH,
  LOOSE_KEEP,
  MAIN_ARROW,
  MARCH_ORDER,
  MAX_PUSH,
  MULT_DEN,
  MULT_NUM,
  OUTPOST,
  PUSH,
  rank,
  RETARGET_EVERY,
  SEPARATION,
  TOWER_ARROW,
  UNDER_ATTACK_TICKS,
  UNITS,
  WORK_REACH,
} from "./rules.ts";
import { type Frame, IDENTITY, fromCanon, toCanon } from "../frame.ts";
import { openLine, steerDirect, steerTo } from "./steer.ts";
import { HitCause, UNIT_KINDS, type World } from "./world.ts";

const TICKS = TICKS_PER_SECOND;

/** Decides a farmer that carries an economy order (Gather, Build, Repair, Recall). */
export interface FarmerDecider {
  decide(w: World, fields: FieldCache, i: number): void;
}

/** Orders the economy decides instead of the combat logic. */
export function isWorkOrder(order: number): boolean {
  return order === Order.Gather || order === Order.Build || order === Order.Repair || order === Order.Recall;
}

/** Numbers per calibrating cannon in UnitSystem.warns. */
const WARN_STRIDE = 7;

export interface Hurt {
  /** Owner of what was hurt, fixed-point position, id. */
  owner: number;
  x: number;
  y: number;
  id: number;
  /** Who hurt it this tick (D-087): bit `1 << o` for each owner o (a player, or NEUTRAL). */
  by: number;
}

/** Per-tick scratch arrays, reused. */
export class UnitSystem {
  private cellHead: Int32Array;
  private cellNext = new Int32Array(256);
  /** The same buckets for the loose soldiers that keep LOOSE_KEEP.spacing, and their teams (0: none), rebuilt in move(). */
  private keepHead: Int32Array;
  private keepNext = new Int32Array(256);
  private team = new Int32Array(256);
  /** Per unit this tick (move()): 1 when standing mates of its team pushed it apart, 2 when one on the move did too. */
  private kept = new Uint8Array(256);
  private attacking = new Uint8Array(256);
  /** Per unit this tick: 1 while it steps out of a cannon warning (DODGE, round 8). */
  private dodging = new Uint8Array(256);
  /** Per unit slot: its place among the guards of its outpost (id order), or -1 (D-080). */
  private postIndex = new Int32Array(256);
  /**
   * Cannons calibrating at the start of the tick (DODGE, round 8): owner, target point, the
   * mage's position, moves left before the shot lands and the mage's id, WARN_STRIDE each.
   */
  private readonly warns: number[] = [];
  /**
   * This tick's shots of buildings' own arrows and of soldiers hiding in buildings, as pairs
   * (building id, target unit id), for the `shot` event (round 7, D-061; game.ts sends them).
   */
  readonly shots: number[] = [];
  /** Each unit's target at the start of the tick (joining a fight reads these, not this tick's). */
  private startTarget = new Int32Array(256);
  /** Per squad, at the start of the tick: what its soldiers are fighting (unit positions, building ids). */
  private readonly squadFights = new Map<number, { x: number[]; y: number[]; buildings: number[] }>();
  /** Per enemy unit id, how many units had it as their target at the start of the tick. */
  private readonly attackers = new Map<number, number>();
  /**
   * Per group, at the start of the tick (MARCH_ORDER): of its spearmen and cavalry, then of its
   * ranged, that walk on the move, the sums of x and y and the number; then how many of the group
   * fight.
   */
  private readonly marching = new Map<number, number[]>();
  private unitDamage = new Int32Array(256);
  /** The same hits counted against a mage's shield (its own multipliers). */
  private shieldDamage = new Int32Array(256);
  private buildingDamage = new Int32Array(64);
  /** Per unit and building slot, this tick: bit `1 << o` for each owner o whose hits landed (Hurt.by). */
  private unitHitBy = new Uint8Array(256);
  private buildingHitBy = new Uint8Array(64);
  private newX = new Int32Array(256);
  private newY = new Int32Array(256);
  private deadUnits = new Uint8Array(256);
  private deadBuildings = new Uint8Array(64);
  /** Which walkable cells connect (for goals walled in by buildings). */
  private readonly regions = new Regions();
  /**
   * breakThrough's answers by (owner, area, goal point): the nearest cell of the area and the
   * building to break. They depend only on the grid and the buildings, so they are kept until
   * cells are blocked or opened (every building placed or gone changes one of the two).
   */
  private readonly walled = new Map<string, { cell: number; blocker: number }>();
  /** Building slots that shoot arrows this tick (CAV_FLANK keeps cavalry out of their range). */
  private readonly shooters: number[] = [];
  private walledBlock = -1;
  private walledOpen = -1;

  constructor(size: number) {
    this.cellHead = new Int32Array(size * size);
    this.keepHead = new Int32Array(size * size);
  }

  private fit(n: number, nb: number): void {
    if (this.cellNext.length < n) {
      const c = Math.max(n, this.cellNext.length * 2);
      this.cellNext = new Int32Array(c);
      this.keepNext = new Int32Array(c);
      this.team = new Int32Array(c);
      this.kept = new Uint8Array(c);
      this.attacking = new Uint8Array(c);
      this.dodging = new Uint8Array(c);
      this.postIndex = new Int32Array(c);
      this.startTarget = new Int32Array(c);
      this.unitDamage = new Int32Array(c);
      this.shieldDamage = new Int32Array(c);
      this.unitHitBy = new Uint8Array(c);
      this.newX = new Int32Array(c);
      this.newY = new Int32Array(c);
      this.deadUnits = new Uint8Array(c);
    }
    if (this.buildingDamage.length < nb) {
      const c = Math.max(nb, this.buildingDamage.length * 2);
      this.buildingDamage = new Int32Array(c);
      this.buildingHitBy = new Uint8Array(c);
      this.deadBuildings = new Uint8Array(c);
    }
  }

  /** Decide, move and attack. Returns what got hurt (for events); removeDead comes later. */
  run(w: World, fog: Fog, fields: FieldCache, farmers: FarmerDecider): Hurt[] {
    this.fit(w.units.count, w.buildings.count);
    this.bucket(w);
    this.startTarget.set(w.units.col.target.subarray(0, w.units.count));
    this.collectSquadFights(w);
    this.collectMarching(w);
    this.collectWarnings(w);
    this.dodging.fill(0, 0, w.units.count);
    if (OUTPOST.on) this.collectPosts(w, fog);
    if (CAV_FLANK.on) this.collectShooters(w);
    for (let i = 0; i < w.units.count; i++) this.decide(w, fog, fields, farmers, i);
    if (this.warns.length > 0) this.keepOut(w, fog);
    this.move(w);
    return this.attack(w, fog);
  }

  private bucket(w: World): void {
    const u = w.units.col;
    const n = w.size;
    this.cellHead.fill(-1);
    for (let i = 0; i < w.units.count; i++) {
      const c = (u.y[i] >> CELL_SHIFT) * n + (u.x[i] >> CELL_SHIFT);
      this.cellNext[i] = this.cellHead[c];
      this.cellHead[c] = i;
    }
  }

  // --- targets ---------------------------------------------------------------------------

  /** Can this unit's owner see that cell? Neutral sees by distance only. */
  private sees(fog: Fog, owner: number, x: number, y: number, n: number): boolean {
    if (owner === NEUTRAL) return true;
    return fog.visible[owner][(y >> CELL_SHIFT) * n + (x >> CELL_SHIFT)] === 1;
  }

  /**
   * Counter-attack (COUNTER_ATTACK): the unit that hit unit i, or a friend of i within
   * JOIN_FIGHT.range, in the last RETARGET_EVERY ticks, if i's owner sees it and it is within
   * LEASH of i's place; the nearest such (ties to the lower id), or -1.
   */
  private counterAttack(w: World, fog: Fog, i: number): number {
    const u = w.units.col;
    const n = w.size;
    const me = u.owner[i];
    const reach = JOIN_FIGHT.range;
    const cells = (reach >> CELL_SHIFT) + 1;
    const cx = u.x[i] >> CELL_SHIFT;
    const cy = u.y[i] >> CELL_SHIFT;
    let best = 0;
    let bestId = -1;
    for (let y = Math.max(cy - cells, 0); y <= Math.min(cy + cells, n - 1); y++) {
      for (let x = Math.max(cx - cells, 0); x <= Math.min(cx + cells, n - 1); x++) {
        for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
          if (u.owner[j] !== me || w.tick - u.lastHurt[j] > RETARGET_EVERY) continue;
          if (j !== i) {
            const fx = u.x[j] - u.x[i];
            const fy = u.y[j] - u.y[i];
            if (fx * fx + fy * fy > reach * reach) continue;
          }
          const a = u.hitById[j];
          const as = a >= 0 ? w.unit(a) : -1;
          if (as < 0 || u.owner[as] === me || u.action[as] === Action.Garrisoned) continue;
          if (!this.sees(fog, me, u.x[as], u.y[as], n)) continue;
          if (UNITS[u.type[i]].range <= CELL && !this.reaches(w, i, as)) continue;
          const ax = u.x[as] - u.anchorX[i];
          const ay = u.y[as] - u.anchorY[i];
          if (ax * ax + ay * ay > LEASH * LEASH) continue;
          const dx = u.x[as] - u.x[i];
          const dy = u.y[as] - u.y[i];
          const d2 = dx * dx + dy * dy;
          if (bestId < 0 || d2 < best || (d2 === best && a < bestId)) {
            best = d2;
            bestId = a;
          }
        }
      }
    }
    return bestId;
  }

  /**
   * Shooting back on a move (FIRE_BACK): the enemy unit that hit unit i in the last
   * RETARGET_EVERY ticks, if i's owner sees it, it stands within FIRE_BACK.reach of i and it does
   * not hide in a building (buildings' arrows leave no unit to go for); else -1.
   */
  private shooter(w: World, fog: Fog, i: number): number {
    const u = w.units.col;
    if (w.tick - u.lastHurt[i] > RETARGET_EVERY) return -1;
    const a = u.hitById[i];
    const as = a >= 0 ? w.unit(a) : -1;
    if (as < 0 || u.owner[as] === u.owner[i] || u.action[as] === Action.Garrisoned) return -1;
    if (!this.sees(fog, u.owner[i], u.x[as], u.y[as], w.size)) return -1;
    const dx = u.x[as] - u.x[i];
    const dy = u.y[as] - u.y[i];
    return dx * dx + dy * dy <= FIRE_BACK.reach * FIRE_BACK.reach ? a : -1;
  }

  /**
   * Joining a fight (JOIN_FIGHT): the enemy unit that a friend within JOIN_FIGHT.range had as
   * its target at the start of the tick, nearest unit i (ties: lower id), among those i's owner
   * sees within LEASH of i's place (anchor); -1 if none. Farmers' targets do not count.
   */
  private joinFight(w: World, fog: Fog, i: number): number {
    const reach = JOIN_FIGHT.range;
    if (reach <= 0) return -1;
    const u = w.units.col;
    const n = w.size;
    const me = u.owner[i];
    const mx = u.x[i];
    const my = u.y[i];
    const cells = (reach >> CELL_SHIFT) + 1;
    const cx = mx >> CELL_SHIFT;
    const cy = my >> CELL_SHIFT;
    const r2 = reach * reach;
    let best = 0;
    let bestId = -1;
    for (let y = Math.max(cy - cells, 0); y <= Math.min(cy + cells, n - 1); y++) {
      for (let x = Math.max(cx - cells, 0); x <= Math.min(cx + cells, n - 1); x++) {
        for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
          if (j === i || u.owner[j] !== me || u.type[j] === UnitType.Farmer) continue;
          const t = this.startTarget[j];
          if (t < 0) continue;
          const fx = u.x[j] - mx;
          const fy = u.y[j] - my;
          if (fx * fx + fy * fy > r2) continue;
          const ts = w.unit(t);
          if (ts < 0 || u.owner[ts] === me || u.action[ts] === Action.Garrisoned) continue;
          if (!this.sees(fog, me, u.x[ts], u.y[ts], n)) continue;
          if (UNITS[u.type[i]].range <= CELL && !this.reaches(w, i, ts)) continue;
          const ax = u.x[ts] - u.anchorX[i];
          const ay = u.y[ts] - u.anchorY[i];
          if (ax * ax + ay * ay > LEASH * LEASH) continue;
          const dx = u.x[ts] - mx;
          const dy = u.y[ts] - my;
          const d2 = dx * dx + dy * dy;
          if (bestId < 0 || d2 < best || (d2 === best && t < bestId)) {
            best = d2;
            bestId = t;
          }
        }
      }
    }
    return bestId;
  }

  /**
   * Where each group's lower ranks walk at the start of the tick (MARCH_ORDER): last tick's walkers
   * on the move with no target; and whether any of the group (on the move or there) fights.
   */
  private collectMarching(w: World): void {
    this.marching.clear();
    if (!MARCH_ORDER.on) return;
    const u = w.units.col;
    for (let j = 0; j < w.units.count; j++) {
      if (u.group[j] < 0 || u.type[j] === UnitType.Farmer) continue;
      const fights = this.startTarget[j] >= 0;
      const r = rank(u.type[j]);
      const walks = u.order[j] === Order.Move && !fights && r <= 1 && (u.vx[j] !== 0 || u.vy[j] !== 0);
      if (!fights && !walks) continue;
      let m = this.marching.get(u.group[j]);
      if (m === undefined) {
        m = [0, 0, 0, 0, 0, 0, 0];
        this.marching.set(u.group[j], m);
      }
      if (fights) {
        m[6]++;
        continue;
      }
      m[3 * r] += u.x[j];
      m[3 * r + 1] += u.y[j];
      m[3 * r + 2]++;
    }
  }

  /**
   * MARCH_ORDER: unit i (on a move, (dx, dy) from its place, not fighting) stands this tick to let
   * the lower ranks of its group pass; counts the tick.
   */
  private letPass(w: World, i: number, dx: number, dy: number): boolean {
    const u = w.units.col;
    const r = rank(u.type[i]);
    if (r === 0 || u.waited[i] >= MARCH_ORDER.maxWait || dx * dx + dy * dy <= DIRECT_STEER * DIRECT_STEER) return false;
    // A group in a fight fights as it stands.
    const m = this.marching.get(u.group[i]);
    if (m === undefined || m[6] > 0) return false;
    const c = r === 1 ? m[2] : m[2] + m[5];
    if (c === 0) return false;
    const mx = idiv(r === 1 ? m[0] : m[0] + m[3], c);
    const my = idiv(r === 1 ? m[1] : m[1] + m[4], c);
    // How far ahead of their middle it is, along its way: behind by `margin` or more, it walks.
    const ahead = (u.x[i] - mx) * dx + (u.y[i] - my) * dy;
    if (ahead <= -MARCH_ORDER.margin * isqrt(dx * dx + dy * dy)) return false;
    u.waited[i]++;
    return true;
  }

  /** What each squad's soldiers had as targets at the start of the tick (SQUAD). */
  private collectSquadFights(w: World): void {
    this.squadFights.clear();
    this.attackers.clear();
    if (SQUAD.reach <= 0) return;
    const u = w.units.col;
    for (let j = 0; j < w.units.count; j++) {
      const t = this.startTarget[j];
      if (t >= 0) this.attackers.set(t, (this.attackers.get(t) ?? 0) + 1);
      if (t < 0 || u.squad[j] === 0 || u.type[j] === UnitType.Farmer) continue;
      let f = this.squadFights.get(u.squad[j]);
      if (f === undefined) {
        f = { x: [], y: [], buildings: [] };
        this.squadFights.set(u.squad[j], f);
      }
      const ts = w.unit(t);
      if (ts >= 0) {
        if (u.owner[ts] === u.owner[j]) continue;
        f.x.push(u.x[ts]);
        f.y.push(u.y[ts]);
      } else if (w.building(t) >= 0 && !f.buildings.includes(t)) {
        f.buildings.push(t);
      }
    }
  }

  /**
   * A squad fights together (SQUAD, operations round, D-050): the enemy unit nearest unit i, within
   * SQUAD.reach of it and seen by its owner, that one of its squad mates was fighting at the start
   * of the tick or that stands within SQUAD.near of one of those (ties as findTarget); else the
   * nearest building a mate was hitting, within reach; -1 if none.
   */
  private squadTarget(w: World, fog: Fog, i: number): number {
    const u = w.units.col;
    const f = this.squadFights.get(u.squad[i]);
    if (f === undefined) return -1;
    const n = w.size;
    const me = u.owner[i];
    const mx = u.x[i];
    const my = u.y[i];
    const reach = SQUAD.reach;
    const r2 = reach * reach;
    const near2 = SQUAD.near * SQUAD.near;
    const cells = (reach >> CELL_SHIFT) + 1;
    const cx = mx >> CELL_SHIFT;
    const cy = my >> CELL_SHIFT;
    const high = preferHighId(w, u.id[i]);
    // Melee crowd at a target that already has SQUAD.crowd attackers: one more cell per attacker over that.
    const melee = UNITS[u.type[i]].range <= CELL;
    let best = r2 + 1;
    let bestId = -1;
    if (f.x.length > 0) {
      for (let y = Math.max(cy - cells, 0); y <= Math.min(cy + cells, n - 1); y++) {
        for (let x = Math.max(cx - cells, 0); x <= Math.min(cx + cells, n - 1); x++) {
          for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
            if (u.owner[j] === me || u.action[j] === Action.Garrisoned) continue;
            const dx = u.x[j] - mx;
            const dy = u.y[j] - my;
            let d2 = dx * dx + dy * dy;
            if (d2 > r2) continue;
            if (melee) {
              const over = (this.attackers.get(u.id[j]) ?? 0) - SQUAD.crowd;
              if (over > 0) {
                const d = isqrt(d2) + over * CELL;
                d2 = d * d;
              }
            }
            if (d2 > best || (d2 === best && (high ? u.id[j] < bestId : u.id[j] > bestId))) continue;
            let fought = false;
            for (let k = 0; k < f.x.length && !fought; k++) {
              const fx = u.x[j] - f.x[k];
              const fy = u.y[j] - f.y[k];
              if (fx * fx + fy * fy <= near2) fought = true;
            }
            if (!fought || !this.sees(fog, me, u.x[j], u.y[j], n) || (melee && !this.reaches(w, i, j))) continue;
            best = d2;
            bestId = u.id[j];
          }
        }
      }
      if (bestId >= 0) return bestId;
    }
    const b = w.buildings.col;
    for (const id of f.buildings) {
      const s = w.building(id);
      if (s < 0 || b.owner[s] === me) continue;
      // Mates breaking a gate (D-096): the melee join in, ranged units and mages hardly scratch it.
      if (b.type[s] === BuildingType.Gate && !melee) continue;
      const d2 = rectDist2(mx, my, b.cellX[s], b.cellY[s], w.wide(s), w.tall(s));
      if (d2 > r2 || d2 > best || (d2 === best && (high ? id < bestId : id > bestId))) continue;
      best = d2;
      bestId = id;
    }
    return bestId;
  }

  /**
   * Can unit i walk to unit j (D-096: closed gates stand between a castle and the world): both in
   * the same area of i's owner's grid. A unit on a cell that grid does not walk counts as reachable.
   */
  private reaches(w: World, i: number, j: number): boolean {
    if (!GATE.on) return true;
    const u = w.units.col;
    const n = w.size;
    const ci = (u.y[i] >> CELL_SHIFT) * n + (u.x[i] >> CELL_SHIFT);
    const cj = (u.y[j] >> CELL_SHIFT) * n + (u.x[j] >> CELL_SHIFT);
    // One on a wall: only from inside its town (WALLS).
    if (onWall(w, j)) return w.insideAt[ci] === w.wallTown[cj];
    // Both outside every castle, or inside the same one: as everywhere else, taken as reachable
    // (the areas are only worked out where walls and gates stand between them).
    if (w.insideAt[ci] === w.insideAt[cj]) return true;
    const cls = w.passClass(u.owner[i]);
    const a = this.regions.of(w, ci, cls);
    const b = this.regions.of(w, cj, cls);
    return a < 0 || b < 0 || a === b;
  }

  /** Nearest enemy unit within reach (ties to the lower id), else the nearest enemy building; returns an id or -1. */
  private findTarget(w: World, fog: Fog, i: number, reach: number): number {
    const u = w.units.col;
    const n = w.size;
    const me = u.owner[i];
    const mx = u.x[i];
    const my = u.y[i];
    const cells = (reach >> CELL_SHIFT) + 1;
    const cx = mx >> CELL_SHIFT;
    const cy = my >> CELL_SHIFT;
    const r2 = reach * reach;
    const high = preferHighId(w, u.id[i]);
    const melee = UNITS[u.type[i]].range <= CELL;
    let best = r2 + 1;
    let bestId = -1;
    for (let y = Math.max(cy - cells, 0); y <= Math.min(cy + cells, n - 1); y++) {
      for (let x = Math.max(cx - cells, 0); x <= Math.min(cx + cells, n - 1); x++) {
        for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
          if (u.owner[j] === me || u.action[j] === Action.Garrisoned) continue;
          const dx = u.x[j] - mx;
          const dy = u.y[j] - my;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          if (!this.sees(fog, me, u.x[j], u.y[j], n)) continue;
          // Melee goes only for what it can walk to (D-096: not over a closed gate).
          if (melee && !this.reaches(w, i, j)) continue;
          if (d2 < best || (d2 === best && (high ? u.id[j] > bestId : u.id[j] < bestId))) {
            best = d2;
            bestId = u.id[j];
          }
        }
      }
    }
    if (bestId >= 0) return bestId;
    const b = w.buildings.col;
    for (let s = 0; s < w.buildings.count; s++) {
      // A gate is never just in the way to hit (D-096): only an attack on it, or a goal behind it.
      if (b.owner[s] === me || b.type[s] === BuildingType.Gate) continue;
      const d2 = rectDist2(mx, my, b.cellX[s], b.cellY[s], w.wide(s), w.tall(s));
      if (d2 > r2) continue;
      const bx = (b.cellX[s] << CELL_SHIFT) + 512;
      const by = (b.cellY[s] << CELL_SHIFT) + 512;
      if (!this.sees(fog, me, bx, by, n)) continue;
      if (d2 < best || (d2 === best && (high ? b.id[s] > bestId : b.id[s] < bestId))) {
        best = d2;
        bestId = b.id[s];
      }
    }
    return bestId;
  }

  /**
   * Autocast (D1): among the enemy units the mage's owner sees within cannon range, the one
   * whose position would hit the most enemies (at least CANNON.autocastMinTargets) within
   * the blast radius; ties to the lower id. Returns a unit slot or -1.
   */
  private autocastAim(w: World, fog: Fog, i: number, from = -1): number {
    const u = w.units.col;
    const b = w.buildings.col;
    const n = w.size;
    const me = u.owner[i];
    const range2 = CANNON.range * CANNON.range;
    const r2 = CANNON.radius * CANNON.radius;
    const hostile = (j: number) =>
      u.owner[j] !== me && u.action[j] !== Action.Garrisoned && this.sees(fog, me, u.x[j], u.y[j], n);
    // A mage hiding in a building (round 7) measures the range from the building's edge.
    const size = from >= 0 ? w.buildingSize(b.type[from]) : 0;
    const reach = (CANNON.range >> CELL_SHIFT) + 1 + size;
    const blast = (CANNON.radius >> CELL_SHIFT) + 1;
    const cx = from >= 0 ? b.cellX[from] + (size >> 1) : u.x[i] >> CELL_SHIFT;
    const cy = from >= 0 ? b.cellY[from] + (size >> 1) : u.y[i] >> CELL_SHIFT;
    let best = -1;
    let bestCount = CANNON.autocastMinTargets - 1;
    let bestId = 0;
    for (let y = Math.max(cy - reach, 0); y <= Math.min(cy + reach, n - 1); y++) {
      for (let x = Math.max(cx - reach, 0); x <= Math.min(cx + reach, n - 1); x++) {
        for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
          if (!hostile(j)) continue;
          const dx = u.x[j] - u.x[i];
          const dy = u.y[j] - u.y[i];
          const d2 = from >= 0 ? rectDist2(u.x[j], u.y[j], b.cellX[from], b.cellY[from], size) : dx * dx + dy * dy;
          if (d2 > range2) continue;
          let count = 0;
          const jx = u.x[j] >> CELL_SHIFT;
          const jy = u.y[j] >> CELL_SHIFT;
          for (let yy = Math.max(jy - blast, 0); yy <= Math.min(jy + blast, n - 1); yy++) {
            for (let xx = Math.max(jx - blast, 0); xx <= Math.min(jx + blast, n - 1); xx++) {
              for (let k = this.cellHead[yy * n + xx]; k >= 0; k = this.cellNext[k]) {
                if (!hostile(k)) continue;
                const ex = u.x[k] - u.x[j];
                const ey = u.y[k] - u.y[j];
                if (ex * ex + ey * ey <= r2) count++;
              }
            }
          }
          if (count > bestCount || (count === bestCount && best >= 0 && u.id[j] < bestId)) {
            best = j;
            bestCount = count;
            bestId = u.id[j];
          }
        }
      }
    }
    return best;
  }

  /**
   * When a unit looks for targets: every RETARGET_EVERY ticks, staggered by u + v of its
   * cell in its owner's canonical frame (frame.ts), so mirror-image units look on the same
   * tick. (Staggering by id made one side's units see enemies a tick earlier.)
   */
  private phase(w: World, i: number): number {
    const u = w.units.col;
    const c = toCanon(w.map.frames[u.owner[i]] ?? IDENTITY, u.x[i] >> CELL_SHIFT, u.y[i] >> CELL_SHIFT);
    return c.u + c.v;
  }

  // --- outposts (D-080) ------------------------------------------------------------------

  /**
   * Each guard's place among the guards of its outpost (id order), and every outpost's provoker
   * checked: dropped once dead, hidden, out of its owner's sight or beyond OUTPOST.chase.
   */
  private collectPosts(w: World, fog: Fog): void {
    const u = w.units.col;
    const b = w.buildings.col;
    const count = new Map<number, number>();
    for (let i = 0; i < w.units.count; i++) {
      if (u.order[i] !== Order.Post) {
        this.postIndex[i] = -1;
        continue;
      }
      const k = count.get(u.orderTarget[i]) ?? 0;
      this.postIndex[i] = k;
      count.set(u.orderTarget[i], k + 1);
    }
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.type[s] !== BuildingType.Outpost || b.provoker[s] < 0) continue;
      if (!this.withinChase(w, fog, b.owner[s], s, b.provoker[s])) b.provoker[s] = -1;
    }
  }

  /** Can the outpost at slot bs (its owner p) still go for unit or building id: alive, seen, within OUTPOST.chase? */
  private withinChase(w: World, fog: Fog, p: number, bs: number, id: number): boolean {
    const u = w.units.col;
    const b = w.buildings.col;
    const n = w.size;
    const size = w.buildingSize(b.type[bs]);
    const chase = OUTPOST.chase << CELL_SHIFT;
    const ts = w.unit(id);
    if (ts >= 0) {
      if (u.hp[ts] <= 0 || u.action[ts] === Action.Garrisoned || !this.sees(fog, p, u.x[ts], u.y[ts], n)) return false;
      return rectDist2(u.x[ts], u.y[ts], b.cellX[bs], b.cellY[bs], size) <= chase * chase;
    }
    const ks = w.building(id);
    if (ks < 0 || b.hp[ks] <= 0) return false;
    const half = (w.buildingSize(b.type[ks]) << CELL_SHIFT) >> 1;
    const kx = (b.cellX[ks] << CELL_SHIFT) + half;
    const ky = (b.cellY[ks] << CELL_SHIFT) + half;
    if (!this.sees(fog, p, kx, ky, n)) return false;
    return rectDist2(kx, ky, b.cellX[bs], b.cellY[bs], size) <= chase * chase;
  }

  /**
   * A spearman posted at an outpost (Order.Post, D-080). Whoever hit the outpost or a guard
   * (the provoker) first, while within chase; then, attacking, the nearest enemy unit within
   * OUTPOST.reach of the outpost, else the nearest enemy building within it; holding, only what
   * stands next to him. Without a target he walks back to his place around the outpost. False
   * when the outpost is gone.
   */
  private guard(w: World, fog: Fog, fields: FieldCache, i: number): boolean {
    const u = w.units.col;
    const b = w.buildings.col;
    const n = w.size;
    const me = u.owner[i];
    const bs = w.building(u.orderTarget[i]);
    if (bs < 0 || b.owner[bs] !== me || b.type[bs] !== BuildingType.Outpost || b.hp[bs] <= 0) return false;
    const info = UNITS[u.type[i]];
    const hold = (b.flags[bs] & BuildingFlag.Hold) !== 0;
    let tid = u.target[i];
    if (tid >= 0 && !this.withinChase(w, fog, me, bs, tid)) tid = -1;
    const provoker = b.provoker[bs];
    if (provoker >= 0) {
      tid = provoker;
    } else if ((w.tick + this.phase(w, i)) % RETARGET_EVERY === 0) {
      // Every RETARGET_EVERY ticks, as other soldiers look round: a nearer intruder within reach
      // takes over; the one he chases (still within chase) is kept otherwise; else anything
      // hostile right next to him (neutral militia too), in either mode.
      const next = hold ? -1 : this.outpostTarget(w, fog, i, bs);
      if (next >= 0) tid = next;
      else if (tid < 0) tid = this.findTarget(w, fog, i, info.range);
    }
    u.target[i] = tid;
    if (tid >= 0) {
      const ts = w.unit(tid);
      let tx: number;
      let ty: number;
      let d2: number;
      if (ts >= 0) {
        tx = u.x[ts];
        ty = u.y[ts];
        d2 = (tx - u.x[i]) * (tx - u.x[i]) + (ty - u.y[i]) * (ty - u.y[i]);
      } else {
        const ks = w.building(tid);
        const sx = w.wide(ks);
        const sy = w.tall(ks);
        tx = (b.cellX[ks] << CELL_SHIFT) + ((sx << CELL_SHIFT) >> 1);
        ty = (b.cellY[ks] << CELL_SHIFT) + ((sy << CELL_SHIFT) >> 1);
        d2 = rectDist2(u.x[i], u.y[i], b.cellX[ks], b.cellY[ks], sx, sy);
      }
      u.facing[i] = dir16(tx - u.x[i], ty - u.y[i]);
      if (d2 <= info.range * info.range) {
        this.attacking[i] = 1;
        u.action[i] = Action.Attack;
        return true;
      }
      if (!hold || provoker >= 0) {
        if (d2 > DIRECT_STEER * DIRECT_STEER) {
          if (ts >= 0) {
            steerTo(w, fields, i, tx, ty, (ty >> CELL_SHIFT) * n + (tx >> CELL_SHIFT), info.speed);
          } else {
            const ks = w.building(tid);
            steerTo(w, fields, i, tx, ty, buildingKey(tid), info.speed, () => cellsAround(w, b.cellX[ks], b.cellY[ks], w.wide(ks), w.tall(ks)));
          }
        } else {
          steerDirect(w, i, tx - u.x[i], ty - u.y[i], info.speed);
        }
        return true;
      }
      // Holding: what stepped away is let go.
      u.target[i] = -1;
    }
    const at = this.postPlace(w, i, bs);
    u.anchorX[i] = at.x;
    u.anchorY[i] = at.y;
    const dx = at.x - u.x[i];
    const dy = at.y - u.y[i];
    if (dx * dx + dy * dy > ARRIVE_DISTANCE * ARRIVE_DISTANCE) {
      steerTo(w, fields, i, at.x, at.y, -1, info.speed);
      return true;
    }
    u.action[i] = Action.Idle;
    return true;
  }

  /**
   * Attacking (D-080): the enemy player's unit within OUTPOST.reach of the outpost nearest the
   * guard, else its building nearest him; ties to the first in the guard's owner's canonical
   * frame, so mirror-image outposts take mirror-image targets. Neutral militia are left alone
   * (unless they come next to him). An id or -1.
   */
  private outpostTarget(w: World, fog: Fog, i: number, bs: number): number {
    const u = w.units.col;
    const b = w.buildings.col;
    const n = w.size;
    const me = u.owner[i];
    const size = w.buildingSize(b.type[bs]);
    const reach = OUTPOST.reach << CELL_SHIFT;
    const r2 = reach * reach;
    const x0 = Math.max(b.cellX[bs] - OUTPOST.reach - 1, 0);
    const y0 = Math.max(b.cellY[bs] - OUTPOST.reach - 1, 0);
    const x1 = Math.min(b.cellX[bs] + size + OUTPOST.reach, n - 1);
    const y1 = Math.min(b.cellY[bs] + size + OUTPOST.reach, n - 1);
    let best = -1;
    let bestD = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
          const o = u.owner[j];
          if (o === me || o >= PLAYER_COUNT || u.action[j] === Action.Garrisoned) continue;
          if (rectDist2(u.x[j], u.y[j], b.cellX[bs], b.cellY[bs], size) > r2) continue;
          if (!this.sees(fog, me, u.x[j], u.y[j], n)) continue;
          const d = (u.x[j] - u.x[i]) * (u.x[j] - u.x[i]) + (u.y[j] - u.y[i]) * (u.y[j] - u.y[i]);
          if (best < 0 || d < bestD || (d === bestD && canonFirst(w, me, j, best))) {
            best = j;
            bestD = d;
          }
        }
      }
    }
    if (best >= 0) return u.id[best];
    const f = w.map.frames[me] ?? IDENTITY;
    let bestKey = 0;
    for (let s = 0; s < w.buildings.count; s++) {
      const o = b.owner[s];
      if (o === me || o >= PLAYER_COUNT || b.hp[s] <= 0) continue;
      const half = (w.buildingSize(b.type[s]) << CELL_SHIFT) >> 1;
      const kx = (b.cellX[s] << CELL_SHIFT) + half;
      const ky = (b.cellY[s] << CELL_SHIFT) + half;
      if (rectDist2(kx, ky, b.cellX[bs], b.cellY[bs], size) > r2) continue;
      if (!this.sees(fog, me, kx, ky, n)) continue;
      const d = rectDist2(u.x[i], u.y[i], b.cellX[s], b.cellY[s], w.buildingSize(b.type[s]));
      const c = toCanon(f, b.cellX[s], b.cellY[s]);
      const key = c.v * n + c.u;
      if (best < 0 || d < bestD || (d === bestD && key < bestKey)) {
        best = s;
        bestD = d;
        bestKey = key;
      }
    }
    return best < 0 ? -1 : b.id[best];
  }

  /**
   * The guard's place (fixed point, a cell centre): POST_PLACES[k] for the k-th guard in id
   * order, around the outpost's footprint in its owner's canonical frame (so mirror-image
   * outposts have mirror-image places); the nearest walkable cell if built over.
   */
  private postPlace(w: World, i: number, bs: number): { x: number; y: number } {
    const u = w.units.col;
    const b = w.buildings.col;
    const p = u.owner[i];
    const f = w.map.frames[p] ?? IDENTITY;
    const size = w.buildingSize(b.type[bs]);
    const a = toCanon(f, b.cellX[bs], b.cellY[bs]);
    const c = toCanon(f, b.cellX[bs] + size - 1, b.cellY[bs] + size - 1);
    const k = Math.max(0, this.postIndex[i]) % POST_PLACES.length;
    const cell = fromCanon(f, Math.min(a.u, c.u) + POST_PLACES[k][0], Math.min(a.v, c.v) + POST_PLACES[k][1]);
    const n = w.size;
    let x = cell.x;
    let y = cell.y;
    if (!w.walkable(x, y)) {
      const near = nearestWalkable(w, x, y, w.homes[p]);
      if (near >= 0) {
        x = near % n;
        y = Math.trunc(near / n);
      }
    }
    return { x: (x << CELL_SHIFT) + (CELL >> 1), y: (y << CELL_SHIFT) + (CELL >> 1) };
  }

  /** Someone hit unit slot ts: if it guards an outpost, that outpost's guards go for the attacker (D-080). */
  private provoke(w: World, ts: number, attackerId: number): void {
    const u = w.units.col;
    if (u.order[ts] !== Order.Post) return;
    const bs = w.building(u.orderTarget[ts]);
    if (bs >= 0 && w.buildings.col.type[bs] === BuildingType.Outpost) w.buildings.col.provoker[bs] = attackerId;
  }

  // --- hiding in buildings (round 7, D-061) --------------------------------------------

  /**
   * A soldier on its way to hide (Order.Garrison): it walks to the building ignoring enemies, as
   * on a retreat, and goes in once within WORK_REACH of the footprint if there is room; no room,
   * or the building gone, it stands where it is.
   */
  private toShelter(w: World, fields: FieldCache, i: number): void {
    const u = w.units.col;
    const b = w.buildings.col;
    const id = u.orderTarget[i];
    const bs = w.building(id);
    u.target[i] = -1;
    const stand = () => {
      u.order[i] = Order.None;
      u.orderTarget[i] = -1;
      u.anchorX[i] = u.x[i];
      u.anchorY[i] = u.y[i];
      u.action[i] = Action.Idle;
    };
    if (bs < 0 || b.owner[bs] !== u.owner[i]) {
      stand();
      return;
    }
    const size = w.buildingSize(b.type[bs]);
    if (rectDist2(u.x[i], u.y[i], b.cellX[bs], b.cellY[bs], size) <= WORK_REACH * WORK_REACH) {
      if (b.soldiers[bs] < BUILDINGS[b.type[bs]].holds) {
        b.soldiers[bs]++;
        u.action[i] = Action.Garrisoned;
      } else {
        stand();
      }
      return;
    }
    const half = (size << CELL_SHIFT) >> 1;
    steerTo(w, fields, i, (b.cellX[bs] << CELL_SHIFT) + half, (b.cellY[bs] << CELL_SHIFT) + half, buildingKey(id), UNITS[u.type[i]].speed, () =>
      cellsAround(w, b.cellX[bs], b.cellY[bs], size),
    );
  }

  /**
   * A soldier hiding in a building fights from it: its own attack, cooldown and multipliers at
   * the visible enemy unit nearest the footprint within its range of the footprint; a mage on
   * autocast fires the cannon with the range from the footprint too. It never moves.
   */
  private fromInside(w: World, fog: Fog, i: number): void {
    const u = w.units.col;
    const b = w.buildings.col;
    const n = w.size;
    if (u.order[i] === Order.Cast) return;
    const bs = w.building(u.orderTarget[i]);
    if (bs < 0) return;
    const size = w.buildingSize(b.type[bs]);
    const info = UNITS[u.type[i]];
    const look = (w.tick + this.phase(w, i)) % RETARGET_EVERY === 0;
    if (
      GARRISON.cannon &&
      u.type[i] === UnitType.Mage &&
      (u.flags[i] & UnitFlag.Autocast) !== 0 &&
      u.castCooldown[i] === 0 &&
      look &&
      w.res[u.owner[i] * 4 + Resource.Crystal] >= CANNON.crystal
    ) {
      const aim = this.autocastAim(w, fog, i, bs);
      if (aim >= 0) {
        startCast(w, i, u.x[aim], u.y[aim], true);
        return;
      }
    }
    const r2 = info.range * info.range;
    let tid = u.target[i];
    if (tid >= 0) {
      const ts = w.unit(tid);
      if (
        ts < 0 ||
        u.action[ts] === Action.Garrisoned ||
        !this.sees(fog, u.owner[i], u.x[ts], u.y[ts], n) ||
        rectDist2(u.x[ts], u.y[ts], b.cellX[bs], b.cellY[bs], size) > r2
      ) {
        tid = -1;
      }
    }
    if (tid < 0 && look) tid = this.nearestFrom(w, fog, i, bs, info.range);
    u.target[i] = tid;
    if (tid < 0) return;
    const ts = w.unit(tid);
    u.facing[i] = dir16(u.x[ts] - u.x[i], u.y[ts] - u.y[i]);
    this.attacking[i] = 1;
  }

  // --- on the walls (D-096) ----------------------------------------------------------------

  /**
   * A soldier going up onto its wall cell (Order.Wall): it walks to the cell inside it climbs from,
   * ignoring enemies, as to a shelter, and steps up once there. The town no longer its owner's
   * (a militia's: always theirs), it stays where it is.
   */
  private toWall(w: World, fields: FieldCache, i: number): void {
    const u = w.units.col;
    const n = w.size;
    const c = u.wall[i];
    u.target[i] = -1;
    if (u.owner[i] < PLAYER_COUNT && !w.heldBy(w.wallTown[c], u.owner[i])) {
      w.offWall(i);
      u.action[i] = Action.Idle;
      return;
    }
    const f = w.wallFoot[c];
    const fx = ((f % n) << CELL_SHIFT) + (CELL >> 1);
    const fy = (Math.trunc(f / n) << CELL_SHIFT) + (CELL >> 1);
    const dx = fx - u.x[i];
    const dy = fy - u.y[i];
    if (dx * dx + dy * dy <= ARRIVE_DISTANCE * ARRIVE_DISTANCE) {
      u.x[i] = ((c % n) << CELL_SHIFT) + (CELL >> 1);
      u.y[i] = (Math.trunc(c / n) << CELL_SHIFT) + (CELL >> 1);
      u.action[i] = Action.OnWall;
      u.anchorX[i] = u.x[i];
      u.anchorY[i] = u.y[i];
      return;
    }
    steerTo(w, fields, i, fx, fy, f, UNITS[u.type[i]].speed);
  }

  /**
   * A soldier on a wall (WALLS): it shoots the visible enemy unit nearest it within its range plus
   * WALLS.range (militia throw stones to WALLS.sling); a mage on autocast fires the cannon as ever.
   * It never moves. A player's town lost (or in ruins), it comes down.
   */
  private fromWall(w: World, fog: Fog, i: number): void {
    const u = w.units.col;
    if (u.order[i] === Order.Cast) {
      u.target[i] = -1;
      u.action[i] = Action.Calibrate;
      u.facing[i] = dir16(u.castX[i] - u.x[i], u.castY[i] - u.y[i]);
      return;
    }
    if (u.owner[i] < PLAYER_COUNT && !w.heldBy(w.wallTown[u.wall[i]], u.owner[i])) {
      w.offWall(i);
      return;
    }
    u.action[i] = Action.OnWall;
    const info = UNITS[u.type[i]];
    const look = (w.tick + this.phase(w, i)) % RETARGET_EVERY === 0;
    if (
      u.type[i] === UnitType.Mage &&
      (u.flags[i] & UnitFlag.Autocast) !== 0 &&
      u.castCooldown[i] === 0 &&
      look &&
      w.res[u.owner[i] * 4 + Resource.Crystal] >= CANNON.crystal
    ) {
      const aim = this.autocastAim(w, fog, i);
      if (aim >= 0) {
        startCast(w, i, u.x[aim], u.y[aim], true);
        u.action[i] = Action.Calibrate;
        return;
      }
    }
    const reach = wallReach(u.type[i], info.range);
    let tid = u.target[i];
    if (tid >= 0) {
      const ts = w.unit(tid);
      const dx = ts >= 0 ? u.x[ts] - u.x[i] : 0;
      const dy = ts >= 0 ? u.y[ts] - u.y[i] : 0;
      if (ts < 0 || u.action[ts] === Action.Garrisoned || !this.sees(fog, u.owner[i], u.x[ts], u.y[ts], w.size) || dx * dx + dy * dy > reach * reach) tid = -1;
    }
    if (tid < 0 && look) tid = this.nearestUnit(w, fog, i, reach);
    u.target[i] = tid;
    if (tid < 0) return;
    const ts = w.unit(tid);
    u.facing[i] = dir16(u.x[ts] - u.x[i], u.y[ts] - u.y[i]);
    this.attacking[i] = 1;
    // Shooting from it, as any soldier fighting (the screen raises it by UnitFlag.OnWall).
    u.action[i] = Action.Attack;
  }

  // --- cavalry for the back row (CAV_FLANK, D-097) ------------------------------------------

  private collectShooters(w: World): void {
    this.shooters.length = 0;
    for (let s = 0; s < w.buildings.count; s++) if (arrowOf(w, s) !== null) this.shooters.push(s);
  }

  /** Does player `me` know of an enemy building that shoots within its range plus CAV_FLANK.towerMargin of (x, y)? */
  private underArrows(w: World, fog: Fog, me: number, x: number, y: number): boolean {
    const b = w.buildings.col;
    const seen = fog.memory[me];
    for (const s of this.shooters) {
      if (b.owner[s] === me) continue;
      const r = arrowOf(w, s)!.range + CAV_FLANK.towerMargin;
      if (rectDist2(x, y, b.cellX[s], b.cellY[s], w.wide(s), w.tall(s)) > r * r) continue;
      // Remembered (fog.memory, in id order) or seen now.
      const id = b.id[s];
      let lo = 0;
      let hi = seen.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (seen[mid][0] < id) lo = mid + 1;
        else hi = mid;
      }
      if (lo < seen.length && seen[lo][0] === id) return true;
    }
    return false;
  }

  /** Cavalry choosing its own target (CAV_FLANK): a player's, not on hold, idle or on a move, not resting from a flank. */
  private flanker(w: World, i: number, order: number): boolean {
    const u = w.units.col;
    return (
      u.type[i] === UnitType.Cavalry &&
      u.owner[i] < PLAYER_COUNT &&
      u.stance[i] !== Stance.Hold &&
      (order === Order.None || order === Order.Move) &&
      !(u.flank[i] < 0 && u.flankTick[i] > w.tick)
    );
  }

  /**
   * The back row for cavalry unit i (CAV_FLANK): the nearest enemy mage its owner sees within
   * CAV_FLANK.reach, else the nearest ranged unit, that it can walk to, within CAV_FLANK.leash of
   * (bx, by) and not under known enemy arrows (ties as findTarget); an id or -1.
   */
  private backRow(w: World, fog: Fog, i: number, bx: number, by: number): number {
    const u = w.units.col;
    const n = w.size;
    const me = u.owner[i];
    const mx = u.x[i];
    const my = u.y[i];
    const reach = CAV_FLANK.reach;
    const r2 = reach * reach;
    const l2 = CAV_FLANK.leash * CAV_FLANK.leash;
    const cells = (reach >> CELL_SHIFT) + 1;
    const cx = mx >> CELL_SHIFT;
    const cy = my >> CELL_SHIFT;
    const high = preferHighId(w, u.id[i]);
    let bestRank = 2;
    let best = 0;
    let bestId = -1;
    for (let y = Math.max(cy - cells, 0); y <= Math.min(cy + cells, n - 1); y++) {
      for (let x = Math.max(cx - cells, 0); x <= Math.min(cx + cells, n - 1); x++) {
        for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
          const t = u.type[j];
          const rank = t === UnitType.Mage ? 0 : t === UnitType.Ranged ? 1 : 2;
          if (rank > bestRank || u.owner[j] === me || u.action[j] === Action.Garrisoned) continue;
          const dx = u.x[j] - mx;
          const dy = u.y[j] - my;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2) continue;
          if (rank === bestRank && (d2 > best || (d2 === best && (high ? u.id[j] < bestId : u.id[j] > bestId)))) continue;
          const ax = u.x[j] - bx;
          const ay = u.y[j] - by;
          if (ax * ax + ay * ay > l2) continue;
          if (!this.sees(fog, me, u.x[j], u.y[j], n) || !this.reaches(w, i, j)) continue;
          if (this.underArrows(w, fog, me, u.x[j], u.y[j])) continue;
          bestRank = rank;
          best = d2;
          bestId = u.id[j];
        }
      }
    }
    return bestId;
  }

  /**
   * Cavalry unit i with target tid (CAV_FLANK, every tick): a mage or ranged unit chosen by itself
   * starts or goes on with a dive for the back row (on a move it turns here: the anchor); anything
   * else ends one. CAV_FLANK.giveUpTicks without a hit it gives up, rests, and takes the nearest
   * enemy instead. Returns the target.
   */
  private flankDive(w: World, fog: Fog, i: number, order: number, tid: number): number {
    const u = w.units.col;
    const ts = tid >= 0 ? w.unit(tid) : -1;
    const back = ts >= 0 && (u.type[ts] === UnitType.Mage || u.type[ts] === UnitType.Ranged) && order !== Order.Attack && this.flanker(w, i, order);
    if (!back) {
      if (u.flank[i] >= 0) this.endDive(w, i, false);
      return tid;
    }
    if (u.flank[i] < 0) {
      u.flankTick[i] = w.tick;
      u.flankSide[i] = 0;
      u.flankX[i] = -1;
      u.flankY[i] = -1;
      if (order === Order.Move) {
        u.anchorX[i] = u.x[i];
        u.anchorY[i] = u.y[i];
      }
    } else if (w.tick - u.lastDealt[i] <= 1) {
      u.flankTick[i] = w.tick;
    }
    u.flank[i] = tid;
    if (w.tick - u.flankTick[i] <= CAV_FLANK.giveUpTicks) return tid;
    this.endDive(w, i, true);
    return this.findTarget(w, fog, i, Math.max(AGGRO_RANGE, UNITS[u.type[i]].range));
  }

  private endDive(w: World, i: number, rest: boolean): void {
    const u = w.units.col;
    u.flank[i] = -1;
    u.flankSide[i] = 0;
    u.flankX[i] = -1;
    u.flankY[i] = -1;
    u.flankTick[i] = rest ? w.tick + CAV_FLANK.restTicks : 0;
  }

  /**
   * Cavalry unit i riding for its back-row target ts (CAV_FLANK): to its flank point while it has
   * one (flankPoint: looked for every RETARGET_EVERY ticks while it has none, and again on
   * reaching one), else straight at the target when the way is open, else along the field.
   */
  private flankStep(w: World, fog: Fog, fields: FieldCache, i: number, ts: number): void {
    const u = w.units.col;
    const n = w.size;
    const speed = UNITS[u.type[i]].speed;
    // A point is kept until it is reached: worked out again on the way, it would creep in toward
    // the target and the turn would cut past the front.
    if (u.flankX[i] < 0 && (w.tick + this.phase(w, i)) % RETARGET_EVERY === 0) this.flankPoint(w, fog, i, ts);
    const near = () => {
      const dx = u.flankX[i] - u.x[i];
      const dy = u.flankY[i] - u.y[i];
      return dx * dx + dy * dy <= CAV_FLANK.arrive * CAV_FLANK.arrive;
    };
    // At its point: the next one from here at once, so it does not cut the corner.
    if (u.flankX[i] >= 0 && near()) this.flankPoint(w, fog, i, ts);
    if (u.flankX[i] >= 0 && !near()) {
      steerDirect(w, i, u.flankX[i] - u.x[i], u.flankY[i] - u.y[i], speed);
      return;
    }
    u.flankX[i] = -1;
    u.flankY[i] = -1;
    const tx = u.x[ts];
    const ty = u.y[ts];
    if (openLine(w, u.x[i], u.y[i], tx, ty)) steerDirect(w, i, tx - u.x[i], ty - u.y[i], speed);
    else steerTo(w, fields, i, tx, ty, (ty >> CELL_SHIFT) * n + (tx >> CELL_SHIFT), speed);
  }

  /**
   * The point beside the front for cavalry unit i riding for ts (CAV_FLANK): none (-1) when no
   * enemy melee its owner sees stands within CAV_FLANK.line of the straight way. Else, of the
   * enemy melee within CAV_FLANK.scan either side of the way (between the two), on the side they
   * reach less far out (kept for the dive once chosen; equally far, the point first in the
   * owner's canonical frame), CAV_FLANK.margin beyond the furthest out of them, level with the one
   * furthest along. None too when that point is not open ground reached in straight lines both
   * ways, or lies under known enemy arrows.
   */
  private flankPoint(w: World, fog: Fog, i: number, ts: number): void {
    const u = w.units.col;
    const n = w.size;
    const me = u.owner[i];
    const x0 = u.x[i];
    const y0 = u.y[i];
    const dx = u.x[ts] - x0;
    const dy = u.y[ts] - y0;
    const len = isqrt(dx * dx + dy * dy);
    u.flankX[i] = -1;
    u.flankY[i] = -1;
    if (len <= CELL) return;
    const scan = CAV_FLANK.scan;
    const line = CAV_FLANK.line;
    const ax = Math.max((Math.min(x0, u.x[ts]) - scan) >> CELL_SHIFT, 0);
    const bx = Math.min((Math.max(x0, u.x[ts]) + scan) >> CELL_SHIFT, n - 1);
    const ay = Math.max((Math.min(y0, u.y[ts]) - scan) >> CELL_SHIFT, 0);
    const by = Math.min((Math.max(y0, u.y[ts]) + scan) >> CELL_SHIFT, n - 1);
    let blocked = false;
    let left = 0;
    let right = 0;
    let far = 0;
    for (let y = ay; y <= by; y++) {
      for (let x = ax; x <= bx; x++) {
        for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
          const t = u.type[j];
          if (u.owner[j] === me || t === UnitType.Farmer || UNITS[t].range > CELL || u.action[j] === Action.Garrisoned || onWall(w, j)) continue;
          const rx = u.x[j] - x0;
          const ry = u.y[j] - y0;
          const along = idiv(rx * dx + ry * dy, len);
          if (along <= 0 || along >= len) continue;
          // Positive to the side (dy, -dx) points to.
          const side = idiv(rx * dy - ry * dx, len);
          if (side > scan || side < -scan || !this.sees(fog, me, u.x[j], u.y[j], n)) continue;
          if (side <= line && side >= -line) blocked = true;
          left = Math.max(left, side);
          right = Math.min(right, side);
          far = Math.max(far, along);
        }
      }
    }
    if (!blocked) return;
    const at = (k: number) => {
      const off = k > 0 ? left + CAV_FLANK.margin : right - CAV_FLANK.margin;
      return { x: x0 + idiv(dx * far + dy * off, len), y: y0 + idiv(dy * far - dx * off, len) };
    };
    let k = u.flankSide[i];
    if (k === 0) {
      if (left !== -right) {
        k = left < -right ? 1 : -1;
      } else {
        const p = at(1);
        const q = at(-1);
        const f = w.map.frames[me] ?? IDENTITY;
        const inMap = (c: { x: number; y: number }) => c.x >= 0 && c.y >= 0 && c.x >> CELL_SHIFT < n && c.y >> CELL_SHIFT < n;
        k = !inMap(q) || (inMap(p) && canonBefore(f, (p.y >> CELL_SHIFT) * n + (p.x >> CELL_SHIFT), (q.y >> CELL_SHIFT) * n + (q.x >> CELL_SHIFT), n)) ? 1 : -1;
      }
    }
    const p = at(k);
    if (p.x < 0 || p.y < 0 || p.x >> CELL_SHIFT >= n || p.y >> CELL_SHIFT >= n || !w.walkable(p.x >> CELL_SHIFT, p.y >> CELL_SHIFT)) return;
    if (!openLine(w, x0, y0, p.x, p.y) || !openLine(w, p.x, p.y, u.x[ts], u.y[ts]) || this.underArrows(w, fog, me, p.x, p.y)) return;
    u.flankSide[i] = k;
    u.flankX[i] = p.x;
    u.flankY[i] = p.y;
  }

  /** The visible enemy unit nearest unit i within `reach` (ties as findTarget), as an id, or -1. */
  private nearestUnit(w: World, fog: Fog, i: number, reach: number): number {
    const u = w.units.col;
    const n = w.size;
    const me = u.owner[i];
    const mx = u.x[i];
    const my = u.y[i];
    const cells = (reach >> CELL_SHIFT) + 1;
    const cx = mx >> CELL_SHIFT;
    const cy = my >> CELL_SHIFT;
    const r2 = reach * reach;
    const high = preferHighId(w, u.id[i]);
    let best = r2 + 1;
    let bestId = -1;
    for (let y = Math.max(cy - cells, 0); y <= Math.min(cy + cells, n - 1); y++) {
      for (let x = Math.max(cx - cells, 0); x <= Math.min(cx + cells, n - 1); x++) {
        for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
          if (u.owner[j] === me || u.action[j] === Action.Garrisoned) continue;
          const dx = u.x[j] - mx;
          const dy = u.y[j] - my;
          const d2 = dx * dx + dy * dy;
          if (d2 > r2 || !this.sees(fog, me, u.x[j], u.y[j], n)) continue;
          if (d2 < best || (d2 === best && (high ? u.id[j] > bestId : u.id[j] < bestId))) {
            best = d2;
            bestId = u.id[j];
          }
        }
      }
    }
    return bestId;
  }

  /** The visible enemy unit nearest building bs's footprint within `reach` of it (id), or -1. */
  private nearestFrom(w: World, fog: Fog, i: number, bs: number, reach: number): number {
    const u = w.units.col;
    const b = w.buildings.col;
    const n = w.size;
    const me = u.owner[i];
    const size = w.buildingSize(b.type[bs]);
    const r2 = reach * reach;
    let best = r2 + 1;
    let bestSlot = -1;
    for (let j = 0; j < w.units.count; j++) {
      if (u.owner[j] === me || u.action[j] === Action.Garrisoned) continue;
      const d2 = rectDist2(u.x[j], u.y[j], b.cellX[bs], b.cellY[bs], size);
      if (d2 > r2 || !this.sees(fog, me, u.x[j], u.y[j], n)) continue;
      if (d2 < best || (d2 === best && canonFirst(w, me, j, bestSlot))) {
        best = d2;
        bestSlot = j;
      }
    }
    return bestSlot < 0 ? -1 : u.id[bestSlot];
  }

  // --- decide ----------------------------------------------------------------------------

  // --- stepping out of cannon warnings (DODGE, round 8, D-069) ----------------------------

  /** Cannons calibrating at the start of the tick, as the screen shows them (warns). */
  private collectWarnings(w: World): void {
    this.warns.length = 0;
    if (!DODGE.on) return;
    const u = w.units.col;
    for (let s = 0; s < w.units.count; s++) {
      if (u.order[s] !== Order.Cast) continue;
      this.warns.push(u.owner[s], u.castX[s], u.castY[s], u.x[s], u.y[s], CANNON.calibrateTicks - u.castProgress[s], u.id[s]);
    }
  }

  /** Does unit i step out of warnings: a player's soldier with no order, or (DODGE.farmers) a farmer idle or at work? */
  private dodges(w: World, i: number): boolean {
    const u = w.units.col;
    if (u.owner[i] >= PLAYER_COUNT || u.action[i] === Action.Garrisoned) return false;
    if (u.type[i] === UnitType.Farmer) return DODGE.farmers && (u.order[i] === Order.None || isWorkOrder(u.order[i]));
    return u.order[i] === Order.None;
  }

  /** The warning (index into warns) whose blast (plus DODGE.margin) holds point (x, y) for player me, or -1; enemy warnings it sees only. */
  private warnAt(w: World, fog: Fog, me: number, x: number, y: number): number {
    const reach = CANNON.radius + DODGE.margin;
    for (let k = 0; k < this.warns.length; k += WARN_STRIDE) {
      if (this.warns[k] === me || !this.sees(fog, me, this.warns[k + 1], this.warns[k + 2], w.size)) continue;
      const dx = x - this.warns[k + 1];
      const dy = y - this.warns[k + 2];
      if (dx * dx + dy * dy <= reach * reach) return k;
    }
    return -1;
  }

  /**
   * Unit i inside an enemy warning it can leave before the shot lands walks straight out
   * (from the nearest such blast's centre; ties to the lower mage id) and drops its target.
   * Returns false when there is none, or it is too late for all of them.
   */
  private dodge(w: World, fog: Fog, i: number): boolean {
    const u = w.units.col;
    const me = u.owner[i];
    const reach = CANNON.radius + DODGE.margin;
    const speed = UNITS[u.type[i]].speed;
    let best = -1;
    let bestD2 = 0;
    for (let k = 0; k < this.warns.length; k += WARN_STRIDE) {
      if (this.warns[k] === me || !this.sees(fog, me, this.warns[k + 1], this.warns[k + 2], w.size)) continue;
      const dx = u.x[i] - this.warns[k + 1];
      const dy = u.y[i] - this.warns[k + 2];
      const d2 = dx * dx + dy * dy;
      if (d2 > reach * reach) continue;
      if (reach - isqrt(d2) > speed * this.warns[k + 5]) continue; // too late: it keeps fighting
      if (best < 0 || d2 < bestD2 || (d2 === bestD2 && this.warns[k + 6] < this.warns[best + 6])) {
        best = k;
        bestD2 = d2;
      }
    }
    if (best < 0) return false;
    const cx = this.warns[best + 1];
    const cy = this.warns[best + 2];
    let ex = u.x[i] - cx;
    let ey = u.y[i] - cy;
    if (bestD2 < 128 * 128) {
      // From the centre itself: away from the caster (or, standing on it, toward its own place).
      ex = cx - this.warns[best + 3];
      ey = cy - this.warns[best + 4];
      if (ex === 0 && ey === 0) {
        ex = u.anchorX[i] - cx;
        ey = u.anchorY[i] - cy;
      }
      if (ex === 0 && ey === 0) ey = CELL;
    }
    const e = Math.max(1, isqrt(ex * ex + ey * ey));
    const out = reach - isqrt(bestD2) + 128;
    steerDirect(w, i, idiv(ex * out, e), idiv(ey * out, e), speed);
    u.target[i] = -1;
    this.dodging[i] = 1;
    return true;
  }

  /** No unit that steps out of warnings walks into one (it stands instead) while the cannon calibrates. */
  private keepOut(w: World, fog: Fog): void {
    const u = w.units.col;
    for (let i = 0; i < w.units.count; i++) {
      if (this.dodging[i] === 1 || (u.vx[i] === 0 && u.vy[i] === 0) || !this.dodges(w, i)) continue;
      const me = u.owner[i];
      if (this.warnAt(w, fog, me, u.x[i] + u.vx[i], u.y[i] + u.vy[i]) < 0 || this.warnAt(w, fog, me, u.x[i], u.y[i]) >= 0) continue;
      u.vx[i] = 0;
      u.vy[i] = 0;
      u.working[i] = 0;
      u.action[i] = Action.Idle;
    }
  }

  private decide(w: World, fog: Fog, fields: FieldCache, farmers: FarmerDecider, i: number): void {
    const u = w.units.col;
    const n = w.size;
    const info = UNITS[u.type[i]];
    u.vx[i] = 0;
    u.vy[i] = 0;
    u.working[i] = 0;
    this.attacking[i] = 0;
    if (u.action[i] === Action.Garrisoned) {
      // A soldier hiding in a building shoots from it (round 7, D-061); a farmer just hides.
      if (u.type[i] !== UnitType.Farmer) this.fromInside(w, fog, i);
      return;
    }
    // On a castle wall, or going up (D-096).
    if (u.wall[i] >= 0) {
      if (onWall(w, i)) this.fromWall(w, fog, i);
      else this.toWall(w, fields, i);
      return;
    }
    const order = u.order[i];
    const farmer = u.type[i] === UnitType.Farmer;
    if (this.warns.length > 0 && this.dodges(w, i) && this.dodge(w, fog, i)) return;
    if (isWorkOrder(order)) {
      u.target[i] = -1;
      farmers.decide(w, fields, i);
      return;
    }
    if (order === Order.Garrison) {
      this.toShelter(w, fields, i);
      return;
    }
    if (order === Order.Post) {
      if (OUTPOST.on && this.guard(w, fog, fields, i)) return;
      // The outpost is gone: an ordinary soldier again, where it stands (D-080).
      u.order[i] = Order.None;
      u.orderTarget[i] = -1;
      u.target[i] = -1;
      u.anchorX[i] = u.x[i];
      u.anchorY[i] = u.y[i];
    }

    // Crystal cannon: a calibrating mage stands still; any other order has cancelled it.
    if (order !== Order.Cast && u.castProgress[i] > 0) u.castProgress[i] = 0;
    if (order === Order.Cast) {
      u.target[i] = -1;
      u.action[i] = Action.Calibrate;
      u.facing[i] = dir16(u.castX[i] - u.x[i], u.castY[i] - u.y[i]);
      return;
    }
    if (
      u.type[i] === UnitType.Mage &&
      (u.flags[i] & UnitFlag.Autocast) !== 0 &&
      order !== Order.Retreat &&
      u.castCooldown[i] === 0 &&
      (w.tick + this.phase(w, i)) % RETARGET_EVERY === 0 &&
      w.res[u.owner[i] * 4 + Resource.Crystal] >= CANNON.crystal
    ) {
      const aim = this.autocastAim(w, fog, i);
      if (aim >= 0) {
        startCast(w, i, u.x[aim], u.y[aim], true);
        u.action[i] = Action.Calibrate;
        return;
      }
    }

    // Drop a target that died, hid in a building, or (for player units) walked into the fog.
    const gone = (id: number) => {
      if (!alive(w, id)) return true;
      const ts = w.unit(id);
      return ts >= 0 && (u.action[ts] === Action.Garrisoned || !this.sees(fog, u.owner[i], u.x[ts], u.y[ts], n));
    };
    let tid = u.target[i];
    if (tid >= 0 && gone(tid)) tid = -1;
    if (order === Order.Attack) {
      const ot = u.orderTarget[i];
      if (gone(ot)) {
        u.order[i] = Order.None;
        u.orderTarget[i] = -1;
        u.anchorX[i] = u.x[i];
        u.anchorY[i] = u.y[i];
        tid = -1;
      } else {
        tid = ot;
      }
    } else if (order === Order.Retreat || farmer) {
      // Farmers fight only when told to attack something.
      tid = -1;
    } else if ((w.tick + this.phase(w, i)) % RETARGET_EVERY === 0) {
      const hold = order === Order.None && u.stance[i] === Stance.Hold;
      tid = this.findTarget(w, fog, i, hold ? info.range : Math.max(AGGRO_RANGE, info.range));
      if (tid < 0 && (order === Order.None || order === Order.Move) && u.stance[i] !== Stance.Hold && u.squad[i] !== 0) tid = this.squadTarget(w, fog, i);
      if (tid < 0 && order === Order.None && !hold && u.owner[i] < PLAYER_COUNT) tid = this.joinFight(w, fog, i);
      // A soldier without a squad hits back at what hit it or a friend (COUNTER_ATTACK); a squad's
      // soldiers fight together instead (SQUAD).
      if (tid < 0 && order === Order.None && !hold && u.owner[i] < PLAYER_COUNT && u.squad[i] === 0 && COUNTER_ATTACK.on) tid = this.counterAttack(w, fog, i);
      // Cavalry choosing for itself go for the back row (CAV_FLANK): idle, or on a move when it
      // fights anyway or is diving already; measured from where a move turns for it.
      if (CAV_FLANK.on && this.flanker(w, i, order) && (order === Order.None || tid >= 0 || u.flank[i] >= 0)) {
        const turn = order === Order.Move && u.flank[i] < 0;
        const back = this.backRow(w, fog, i, turn ? u.x[i] : u.anchorX[i], turn ? u.y[i] : u.anchorY[i]);
        if (back >= 0) tid = back;
      }
      // Shot on a move from further off (FIRE_BACK, D-095): it turns where it is.
      if (tid < 0 && order === Order.Move && FIRE_BACK.on && u.stance[i] !== Stance.Hold && u.owner[i] < PLAYER_COUNT && u.fireBack[i] < 0) {
        u.fireBack[i] = this.shooter(w, fog, i);
        if (u.fireBack[i] >= 0) {
          u.anchorX[i] = u.x[i];
          u.anchorY[i] = u.y[i];
        }
      }
    }
    // A cannon shot sent it after the mage (AVENGE, round 8): while it has no order, sees the
    // mage, and the mage is within AVENGE.reach of its place; hold stance too.
    let avenging = false;
    if (AVENGE.on && u.avenge[i] >= 0) {
      const m = u.avenge[i];
      const ms = order === Order.None && !gone(m) ? w.unit(m) : -1;
      const ax = ms >= 0 ? u.x[ms] - u.anchorX[i] : 0;
      const ay = ms >= 0 ? u.y[ms] - u.anchorY[i] : 0;
      if (ms < 0 || ax * ax + ay * ay > AVENGE.reach * AVENGE.reach) {
        u.avenge[i] = -1;
      } else {
        tid = m;
        avenging = true;
      }
    }
    // After the unit that shot it on a move (FIRE_BACK): while still on the move, it sees the
    // shooter, and the shooter is within FIRE_BACK.leash of where it turned; then on with the move.
    // Once within AGGRO_RANGE the shooter is just an enemy on the way.
    if (FIRE_BACK.on && u.fireBack[i] >= 0) {
      const m = u.fireBack[i];
      const ms = order === Order.Move && !gone(m) ? w.unit(m) : -1;
      const ax = ms >= 0 ? u.x[ms] - u.anchorX[i] : 0;
      const ay = ms >= 0 ? u.y[ms] - u.anchorY[i] : 0;
      const dx = ms >= 0 ? u.x[ms] - u.x[i] : 0;
      const dy = ms >= 0 ? u.y[ms] - u.y[i] : 0;
      const aggro = Math.max(AGGRO_RANGE, info.range);
      if (ms >= 0 && dx * dx + dy * dy <= aggro * aggro) {
        u.fireBack[i] = -1;
        if (tid < 0) tid = m;
      } else if (ms < 0 || ax * ax + ay * ay > FIRE_BACK.leash * FIRE_BACK.leash) {
        u.fireBack[i] = -1;
        if (tid === m) tid = -1;
      } else if (tid < 0) {
        tid = m;
      }
    }
    // Melee and a target on a wall it cannot reach from here (D-096): let it be, unless told to attack it.
    if (tid >= 0 && order !== Order.Attack && info.range <= CELL) {
      const t0 = w.unit(tid);
      if (t0 >= 0 && onWall(w, t0) && !this.reaches(w, i, t0)) tid = -1;
    }
    if (CAV_FLANK.on && u.type[i] === UnitType.Cavalry) tid = this.flankDive(w, fog, i, order, tid);
    u.target[i] = tid;

    if (tid >= 0) {
      const ts = w.unit(tid);
      let tx: number;
      let ty: number;
      let d2: number;
      if (ts >= 0) {
        tx = u.x[ts];
        ty = u.y[ts];
        const dx = tx - u.x[i];
        const dy = ty - u.y[i];
        d2 = dx * dx + dy * dy;
      } else {
        const bs = w.building(tid);
        const b = w.buildings.col;
        const sx = w.wide(bs);
        const sy = w.tall(bs);
        tx = (b.cellX[bs] << CELL_SHIFT) + ((sx << CELL_SHIFT) >> 1);
        ty = (b.cellY[bs] << CELL_SHIFT) + ((sy << CELL_SHIFT) >> 1);
        d2 = rectDist2(u.x[i], u.y[i], b.cellX[bs], b.cellY[bs], sx, sy);
      }
      u.facing[i] = dir16(tx - u.x[i], ty - u.y[i]);
      // Melee at one on a wall from outside its town (D-096) cannot hit it (an attack goes in by a gate, below).
      if (d2 <= info.range * info.range && !(ts >= 0 && info.range <= CELL && onWall(w, ts) && !this.reaches(w, i, ts))) {
        this.attacking[i] = 1;
        u.action[i] = Action.Attack;
        return;
      }
      const idle = order === Order.None;
      if (idle && u.stance[i] === Stance.Hold && !avenging) {
        u.target[i] = -1;
        u.action[i] = Action.Idle;
        return;
      }
      const diving = CAV_FLANK.on && ts >= 0 && u.flank[i] === tid;
      if (idle) {
        const ax = tx - u.anchorX[i];
        const ay = ty - u.anchorY[i];
        const leash = diving ? CAV_FLANK.leash : u.squad[i] !== 0 && SQUAD.reach > 0 ? SQUAD.leash : LEASH;
        if (ax * ax + ay * ay > leash * leash) {
          u.target[i] = -1;
          steerTo(w, fields, i, u.anchorX[i], u.anchorY[i], -1, info.speed);
          return;
        }
      }
      if (diving) {
        this.flankStep(w, fog, fields, i, ts);
        return;
      }
      if (order === Order.Attack) {
        const here = this.walledOff(w, i, ts, tid);
        if (here >= 0) {
          this.breakThrough(w, fields, i, here, tx, ty, true);
          return;
        }
      }
      // Far off: along the field; a building (D-096: the gate a move breaks through) on a move too.
      if ((order === Order.Attack || (ts < 0 && GATE.on)) && d2 > DIRECT_STEER * DIRECT_STEER) {
        if (ts >= 0) {
          steerTo(w, fields, i, tx, ty, (ty >> CELL_SHIFT) * n + (tx >> CELL_SHIFT), info.speed);
        } else {
          const bs = w.building(tid);
          const b = w.buildings.col;
          steerTo(w, fields, i, tx, ty, buildingKey(tid), info.speed, () => cellsAround(w, b.cellX[bs], b.cellY[bs], w.wide(bs), w.tall(bs)));
        }
      } else {
        steerDirect(w, i, tx - u.x[i], ty - u.y[i], info.speed);
      }
      return;
    }

    if (order === Order.Move || order === Order.Retreat) {
      const dx = u.orderX[i] - u.x[i];
      const dy = u.orderY[i] - u.y[i];
      if (dx * dx + dy * dy <= ARRIVE_DISTANCE * ARRIVE_DISTANCE) {
        this.arrive(w, i);
        return;
      }
      const sp = u.speedCap[i] > 0 ? Math.min(u.speedCap[i], info.speed) : info.speed;
      // A point no one can walk to from here: soldiers on a move break through, farmers and
      // retreats go as near as they can get.
      const key = u.orderTarget[i] >= 0 ? u.orderTarget[i] : (u.orderY[i] >> CELL_SHIFT) * n + (u.orderX[i] >> CELL_SHIFT);
      const goal = nearestWalkable(w, key % n, Math.trunc(key / n));
      const cls = w.passClass(u.owner[i]);
      const here = this.regions.of(w, (u.y[i] >> CELL_SHIFT) * n + (u.x[i] >> CELL_SHIFT), cls);
      if (goal >= 0 && here >= 0 && this.regions.of(w, goal, cls) !== here) {
        this.breakThrough(w, fields, i, here, u.orderX[i], u.orderY[i], order === Order.Move && !farmer);
        return;
      }
      if (order === Order.Move && MARCH_ORDER.on && this.letPass(w, i, dx, dy)) {
        u.action[i] = Action.Idle;
        return;
      }
      if (this.slotInReach(w, i, dx, dy)) {
        steerDirect(w, i, dx, dy, sp);
        return;
      }
      steerTo(w, fields, i, u.orderX[i], u.orderY[i], u.orderTarget[i], sp);
      return;
    }

    // Idle: aggressive units walk back to where they stood after a chase (farmers never chase).
    const ax = u.anchorX[i] - u.x[i];
    const ay = u.anchorY[i] - u.y[i];
    if (!farmer && ax * ax + ay * ay > 4 * ARRIVE_DISTANCE * ARRIVE_DISTANCE) {
      steerTo(w, fields, i, u.anchorX[i], u.anchorY[i], -1, info.speed);
      return;
    }
    u.action[i] = Action.Idle;
  }

  /**
   * A unit on a move, more than DIRECT_STEER from its slot (dx, dy away) but no farther from
   * the group's goal cell than the slot is, heads straight for the slot when the straight way
   * there is open (round 3). The group's field leads only to the goal cell: a slot off to the
   * side of the way in (a wide formation, a loose one above all) never came within
   * DIRECT_STEER, and the unit ended up shuttling at the goal cell.
   */
  private slotInReach(w: World, i: number, dx: number, dy: number): boolean {
    const u = w.units.col;
    const t = u.orderTarget[i];
    if (t < 0 || dx * dx + dy * dy <= DIRECT_STEER * DIRECT_STEER) return false;
    const n = w.size;
    const gx = ((t % n) << CELL_SHIFT) + (CELL >> 1);
    const gy = (Math.trunc(t / n) << CELL_SHIFT) + (CELL >> 1);
    const ux = u.x[i] - gx;
    const uy = u.y[i] - gy;
    const sx = u.orderX[i] - gx;
    const sy = u.orderY[i] - gy;
    return ux * ux + uy * uy <= sx * sx + sy * sy && openLine(w, u.x[i], u.y[i], u.orderX[i], u.orderY[i]);
  }

  /**
   * The area unit i stands in when its attack target (unit ts, or building tid) cannot be
   * reached from there at all, else -1 (also when i stands on a cell that is not walkable).
   */
  private walledOff(w: World, i: number, ts: number, tid: number): number {
    const u = w.units.col;
    const n = w.size;
    const cls = w.passClass(u.owner[i]);
    const here = this.regions.of(w, (u.y[i] >> CELL_SHIFT) * n + (u.x[i] >> CELL_SHIFT), cls);
    if (here < 0) return -1;
    if (ts >= 0) {
      const c = (u.y[ts] >> CELL_SHIFT) * n + (u.x[ts] >> CELL_SHIFT);
      // One on a wall (D-096): melee gets at it from the cell inside next to it.
      const there = this.regions.of(w, onWall(w, ts) && UNITS[u.type[i]].range <= CELL ? w.wallFoot[c] : c, cls);
      return there >= 0 && there !== here ? here : -1;
    }
    const bs = w.building(tid);
    const b = w.buildings.col;
    for (const c of cellsAround(w, b.cellX[bs], b.cellY[bs], w.wide(bs), w.tall(bs))) {
      if (this.regions.of(w, c, cls) === here) return -1;
    }
    return here;
  }

  /**
   * A goal at (tx, ty) walled off from area `here` (round 2, GDD section 9). With `fight`,
   * attack the enemy building that blocks the way: of the enemy players' buildings touching
   * the area and nearer the goal than any cell of the area (so they stand in between), the
   * one nearest the goal (ties: lower id). Otherwise, or with none to attack (walled in by
   * rock, trees or own buildings), walk to the cell of the area nearest the goal and wait.
   */
  private breakThrough(w: World, fields: FieldCache, i: number, here: number, tx: number, ty: number, fight: boolean): void {
    const u = w.units.col;
    const b = w.buildings.col;
    const n = w.size;
    const info = UNITS[u.type[i]];
    if (w.blockVersion !== this.walledBlock || w.openVersion !== this.walledOpen) {
      this.walled.clear();
      this.walledBlock = w.blockVersion;
      this.walledOpen = w.openVersion;
    }
    const cls = w.passClass(u.owner[i]);
    // A goal inside a castle with standing gates (D-096): break the gate nearest this unit.
    if (fight && GATE.on) {
      const gate = this.gateToBreak(w, i, tx, ty, here, cls);
      if (gate >= 0) {
        this.hitBlocker(w, fields, i, gate);
        return;
      }
    }
    const key = `${u.owner[i]},${here},${tx},${ty}`;
    let known = this.walled.get(key);
    if (known === undefined) {
      const c = this.nearestIn(w, here, tx, ty, cls, u.owner[i]);
      const reach = c < 0 ? 0 : cellDist2(c, n, tx, ty);
      let blocker = -1;
      let bestD = 0;
      for (let s = 0; c >= 0 && s < w.buildings.count; s++) {
        const o = b.owner[s];
        const bi = BUILDINGS[b.type[s]];
        if (o === u.owner[i] || o >= PLAYER_COUNT || b.hp[s] <= 0 || bi.walkable) continue;
        const d = rectDist2(tx, ty, b.cellX[s], b.cellY[s], w.wide(s), w.tall(s));
        if (d >= reach) continue;
        if (!cellsAround(w, b.cellX[s], b.cellY[s], w.wide(s), w.tall(s)).some((k) => this.regions.of(w, k, cls) === here)) continue;
        if (blocker < 0 || d < bestD || (d === bestD && b.id[s] < blocker)) {
          blocker = b.id[s];
          bestD = d;
        }
      }
      known = { cell: c, blocker };
      this.walled.set(key, known);
    }
    const c = known.cell;
    const best = fight && known.blocker >= 0 ? w.building(known.blocker) : -1;
    if (best >= 0) {
      this.hitBlocker(w, fields, i, best);
      return;
    }
    if (c < 0) {
      u.action[i] = Action.Idle;
      return;
    }
    const gx = ((c % n) << CELL_SHIFT) + (CELL >> 1);
    const gy = (Math.trunc(c / n) << CELL_SHIFT) + (CELL >> 1);
    const dx = gx - u.x[i];
    const dy = gy - u.y[i];
    if (dx * dx + dy * dy <= ARRIVE_DISTANCE * ARRIVE_DISTANCE) {
      // As near as it gets: a move or retreat is done; an attack waits here for a way in.
      if (u.order[i] === Order.Move || u.order[i] === Order.Retreat) this.arrive(w, i);
      else u.action[i] = Action.Idle;
      return;
    }
    steerTo(w, fields, i, gx, gy, c, info.speed);
  }

  /** Player p's soldiers inside town t's walls or on them (D-096, GATE_ARROW): its gates' extra arrows. */
  private holders(w: World, t: number, p: number): number {
    const u = w.units.col;
    let k = 0;
    for (let j = 0; j < w.units.count; j++) {
      if (u.owner[j] !== p || u.type[j] === UnitType.Farmer || u.action[j] === Action.Garrisoned) continue;
      if (w.inTown(t, u.x[j] >> CELL_SHIFT, u.y[j] >> CELL_SHIFT) || (onWall(w, j) && w.wallTown[u.wall[j]] === t)) k++;
    }
    return k;
  }

  /** Unit i goes for building slot bs that stands in its way (breakThrough): hits it in range, else walks to it. */
  private hitBlocker(w: World, fields: FieldCache, i: number, bs: number): void {
    const u = w.units.col;
    const b = w.buildings.col;
    const info = UNITS[u.type[i]];
    const sx = w.wide(bs);
    const sy = w.tall(bs);
    const bx = (b.cellX[bs] << CELL_SHIFT) + ((sx << CELL_SHIFT) >> 1);
    const by = (b.cellY[bs] << CELL_SHIFT) + ((sy << CELL_SHIFT) >> 1);
    u.target[i] = b.id[bs];
    u.facing[i] = dir16(bx - u.x[i], by - u.y[i]);
    if (rectDist2(u.x[i], u.y[i], b.cellX[bs], b.cellY[bs], sx, sy) <= info.range * info.range) {
      this.attacking[i] = 1;
      u.action[i] = Action.Attack;
      return;
    }
    const cx = b.cellX[bs];
    const cy = b.cellY[bs];
    steerTo(w, fields, i, bx, by, buildingKey(b.id[bs]), info.speed, () => cellsAround(w, cx, cy, sx, sy));
  }

  /**
   * D-096: a goal (tx, ty) inside a castle's walls (or in its gate) walled off from area `here`:
   * the standing gate of that castle with a cell of `here` around it nearest unit i (ties: lower
   * id), as a slot; -1 when the goal is in no castle or no such gate stands.
   */
  private gateToBreak(w: World, i: number, tx: number, ty: number, here: number, cls: number): number {
    const u = w.units.col;
    const b = w.buildings.col;
    const gx = tx >> CELL_SHIFT;
    const gy = ty >> CELL_SHIFT;
    let town = -1;
    for (let t = 0; t < w.townSize.length && town < 0; t++) {
      const c = w.castles[t].inside;
      if (gx >= w.townX[t] + c.x0 - 1 && gx <= w.townX[t] + c.x1 + 1 && gy >= w.townY[t] + c.y0 - 1 && gy <= w.townY[t] + c.y1 + 1) town = t;
    }
    if (town < 0) return -1;
    let best = -1;
    let bestD = 0;
    for (let k = 0; k < w.castles[town].gates.length; k++) {
      const s = w.gateIn(town, k);
      if (s < 0 || b.owner[s] === u.owner[i]) continue;
      if (!cellsAround(w, b.cellX[s], b.cellY[s], w.wide(s), w.tall(s)).some((c) => this.regions.of(w, c, cls) === here)) continue;
      const d = rectDist2(u.x[i], u.y[i], b.cellX[s], b.cellY[s], w.wide(s), w.tall(s));
      if (best < 0 || d < bestD || (d === bestD && b.id[s] < b.id[best])) {
        best = s;
        bestD = d;
      }
    }
    return best;
  }

  /**
   * The cell of area `region` nearest the point (tx, ty): the nearest ring around it that has one,
   * then the nearest; ties go to the first in `owner`'s canonical frame (lower v, then u), so
   * mirror-image units pick mirror-image cells (D-096: a castle with its gates closed has many
   * equally near cells round it).
   */
  private nearestIn(w: World, region: number, tx: number, ty: number, cls: number, owner: number): number {
    const f = w.map.frames[owner] ?? IDENTITY;
    const n = w.size;
    const cx = tx >> CELL_SHIFT;
    const cy = ty >> CELL_SHIFT;
    for (let r = 0; r < n; r++) {
      let best = -1;
      let bestD = 0;
      for (let y = cy - r; y <= cy + r; y++) {
        if (y < 0 || y >= n) continue;
        const step = y === cy - r || y === cy + r ? 1 : 2 * r;
        for (let x = cx - r; x <= cx + r; x += Math.max(step, 1)) {
          if (x < 0 || x >= n) continue;
          const c = y * n + x;
          if (this.regions.of(w, c, cls) !== region) continue;
          const d = cellDist2(c, n, tx, ty);
          if (best < 0 || d < bestD || (d === bestD && (GATE.on ? canonBefore(f, c, best, n) : c < best))) {
            best = c;
            bestD = d;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /**
   * SLOT_GIVE_UP: unit i, (dx, dy) from its place and within its formation, has come no nearer its
   * place for SLOT_GIVE_UP.ticks ticks; counts the ticks and the nearest it came.
   */
  private givesUp(w: World, i: number, dx: number, dy: number): boolean {
    const u = w.units.col;
    const t = u.orderTarget[i];
    if (t < 0) return false;
    const n = w.size;
    const gx = ((t % n) << CELL_SHIFT) + (CELL >> 1);
    const gy = (Math.trunc(t / n) << CELL_SHIFT) + (CELL >> 1);
    const d = isqrt(dx * dx + dy * dy);
    const sx = u.orderX[i] - gx;
    const sy = u.orderY[i] - gy;
    const ux = u.x[i] - gx;
    const uy = u.y[i] - gy;
    const area = isqrt(sx * sx + sy * sy) + DIRECT_STEER;
    if (ux * ux + uy * uy > area * area) return false;
    if (u.slotBest[i] === 0 || d + SLOT_GIVE_UP.progress <= u.slotBest[i]) {
      u.slotBest[i] = Math.max(d, 1);
      u.slotIdle[i] = 0;
      return false;
    }
    return ++u.slotIdle[i] >= SLOT_GIVE_UP.ticks;
  }

  private arrive(w: World, i: number): void {
    const u = w.units.col;
    u.order[i] = Order.None;
    u.orderTarget[i] = -1;
    // The group stays: a `formation` command re-forms the members who are already there
    // together with those still on the way (commands.ts, reform).
    u.speedCap[i] = 0;
    u.anchorX[i] = u.x[i];
    u.anchorY[i] = u.y[i];
    u.stuck[i] = 0;
    u.action[i] = Action.Idle;
  }

  // --- move ------------------------------------------------------------------------------

  private move(w: World): void {
    const u = w.units.col;
    const n = w.size;
    const count = w.units.count;
    const max = n << CELL_SHIFT;
    const sep2 = SEPARATION * SEPARATION;
    // Loose soldiers and their teams (LOOSE_KEEP), in their own buckets: only they are looked
    // at for the wider spacing.
    const spacing = LOOSE_KEEP.spacing;
    let anyKeep = false;
    for (let i = 0; i < count; i++) {
      const loose = spacing > 0 && (u.flags[i] & UnitFlag.Loose) !== 0 && u.type[i] !== UnitType.Farmer && u.owner[i] < PLAYER_COUNT;
      this.team[i] = !loose || u.action[i] === Action.Garrisoned ? 0 : u.squad[i] !== 0 ? u.squad[i] : u.group[i] + 1;
      if (this.team[i] !== 0) anyKeep = true;
    }
    if (anyKeep) {
      this.keepHead.fill(-1);
      for (let i = 0; i < count; i++) {
        if (this.team[i] === 0) continue;
        const c = (u.y[i] >> CELL_SHIFT) * n + (u.x[i] >> CELL_SHIFT);
        this.keepNext[i] = this.keepHead[c];
        this.keepHead[c] = i;
      }
    }
    for (let i = 0; i < count; i++) {
      const xi = u.x[i];
      const yi = u.y[i];
      // Hiding in a building, or standing on a wall (D-096): it does not move.
      if (u.action[i] === Action.Garrisoned || onWall(w, i)) {
        this.newX[i] = xi;
        this.newY[i] = yi;
        continue;
      }
      const cx = xi >> CELL_SHIFT;
      const cy = yi >> CELL_SHIFT;
      let px = 0;
      let py = 0;
      // A loose soldier keeps those of its own player and team at `spacing` (below).
      const ti = this.team[i];
      this.kept[i] = 0;
      for (let y = Math.max(cy - 1, 0); y <= Math.min(cy + 1, n - 1); y++) {
        for (let x = Math.max(cx - 1, 0); x <= Math.min(cx + 1, n - 1); x++) {
          for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
            if (j === i || u.action[j] === Action.Garrisoned || onWall(w, j)) continue;
            if (ti !== 0 && this.team[j] === ti && u.owner[j] === u.owner[i]) continue;
            const dx = xi - u.x[j];
            const dy = yi - u.y[j];
            if (dx >= SEPARATION || dx <= -SEPARATION || dy >= SEPARATION || dy <= -SEPARATION) continue;
            if (dx * dx + dy * dy >= sep2) continue;
            // Two units on the very same point part along the owner's canonical x axis.
            const k = dx === 0 && dy === 0 ? (u.id[i] < u.id[j] ? 0 : 8) + (w.yFirst[u.owner[i]] ? 4 : 0) : dir16(dx, dy);
            px += idiv(DIR16_X[k] * PUSH, CELL);
            py += idiv(DIR16_Y[k] * PUSH, CELL);
          }
        }
      }
      if (ti !== 0) {
        // Reach 2 cells is enough: units two cells further off along an axis are at least
        // 2 * CELL + 1 apart, never closer than `spacing` (2 * CELL).
        const reach = (spacing + CELL - 1) >> CELL_SHIFT;
        for (let y = Math.max(cy - reach, 0); y <= Math.min(cy + reach, n - 1); y++) {
          for (let x = Math.max(cx - reach, 0); x <= Math.min(cx + reach, n - 1); x++) {
            for (let j = this.keepHead[y * n + x]; j >= 0; j = this.keepNext[j]) {
              if (j === i || this.team[j] !== ti || u.owner[j] !== u.owner[i]) continue;
              const dx = xi - u.x[j];
              const dy = yi - u.y[j];
              if (dx >= spacing || dx <= -spacing || dy >= spacing || dy <= -spacing) continue;
              if (dx * dx + dy * dy >= spacing * spacing) continue;
              const k = dx === 0 && dy === 0 ? (u.id[i] < u.id[j] ? 0 : 8) + (w.yFirst[u.owner[i]] ? 4 : 0) : dir16(dx, dy);
              px += idiv(DIR16_X[k] * PUSH, CELL);
              py += idiv(DIR16_Y[k] * PUSH, CELL);
              if (this.kept[i] === 0) this.kept[i] = 1;
              if (u.action[j] !== Action.Idle) this.kept[i] = 2;
            }
          }
        }
      }
      px = clamp(px, -MAX_PUSH, MAX_PUSH);
      py = clamp(py, -MAX_PUSH, MAX_PUSH);
      let tx = clamp(xi + u.vx[i] + px, 0, max - 1);
      let ty = clamp(yi + u.vy[i] + py, 0, max - 1);
      // Wall sliding: try the larger component first; on a tie, the axis that is x in the
      // owner's canonical frame (frame.ts), so mirror-image situations slide the same way.
      const ax = Math.abs(tx - xi);
      const ay = Math.abs(ty - yi);
      // The grid this unit walks: its owner's own gates open (D-096).
      const grid = w.passGrid(w.passClass(u.owner[i]));
      if (ax > ay || (ax === ay && !w.yFirst[u.owner[i]])) {
        if (grid[(yi >> CELL_SHIFT) * n + (tx >> CELL_SHIFT)] !== 0) tx = xi;
        if (grid[(ty >> CELL_SHIFT) * n + (tx >> CELL_SHIFT)] !== 0) ty = yi;
      } else {
        if (grid[(ty >> CELL_SHIFT) * n + (xi >> CELL_SHIFT)] !== 0) ty = yi;
        if (grid[(ty >> CELL_SHIFT) * n + (tx >> CELL_SHIFT)] !== 0) tx = xi;
      }
      this.newX[i] = tx;
      this.newY[i] = ty;
    }
    for (let i = 0; i < count; i++) {
      const moved = Math.abs(this.newX[i] - u.x[i]) + Math.abs(this.newY[i] - u.y[i]);
      u.x[i] = this.newX[i];
      u.y[i] = this.newY[i];
      // A loose soldier standing at its place (#116): pushed apart by mates who stand too, its
      // place moves with it. Otherwise one pushed against a rock walked back to the place, was
      // pushed off again, and never stood still. A mate still on its way only bumps it: it goes
      // back to its place. One walking back after a chase is not Idle.
      if (this.kept[i] === 1 && u.action[i] === Action.Idle) {
        u.anchorX[i] = u.x[i];
        u.anchorY[i] = u.y[i];
      }
      // A unit pressed against others near its slot for 40 ticks counts as arrived.
      if ((u.order[i] === Order.Move || u.order[i] === Order.Retreat) && u.target[i] < 0) {
        const dx = u.orderX[i] - u.x[i];
        const dy = u.orderY[i] - u.y[i];
        const near = dx * dx + dy * dy <= DIRECT_STEER * DIRECT_STEER;
        u.stuck[i] = near && moved < 8 ? u.stuck[i] + 1 : 0;
        if (u.stuck[i] >= 40) this.arrive(w, i);
        else if (SLOT_GIVE_UP.on && this.givesUp(w, i, dx, dy)) this.arrive(w, i);
      } else if (SLOT_GIVE_UP.on && u.slotBest[i] !== 0) {
        // Fighting on the way: it starts over once it walks on.
        u.slotBest[i] = 0;
        u.slotIdle[i] = 0;
      }
    }
  }

  // --- attack ----------------------------------------------------------------------------

  private attack(w: World, fog: Fog): Hurt[] {
    const u = w.units.col;
    const b = w.buildings.col;
    const count = w.units.count;
    this.unitDamage.fill(0, 0, count);
    this.shieldDamage.fill(0, 0, count);
    this.buildingDamage.fill(0, 0, w.buildings.count);
    this.unitHitBy.fill(0, 0, count);
    this.buildingHitBy.fill(0, 0, w.buildings.count);
    this.shots.length = 0;
    for (let i = 0; i < count; i++) {
      if (u.cooldown[i] > 0) u.cooldown[i]--;
      if (u.castCooldown[i] > 0) u.castCooldown[i]--;
      if (u.order[i] === Order.Cast) {
        u.castProgress[i]++;
        if (u.castProgress[i] >= CANNON.calibrateTicks) this.fireCannon(w, i);
        continue;
      }
      if (this.attacking[i] === 0 || u.cooldown[i] > 0) continue;
      const tid = u.target[i];
      const info = UNITS[u.type[i]];
      const ts = w.unit(tid);
      if (ts >= 0) {
        this.hit(w, ts, info.attack, u.type[i], u.owner[i], u.owner[i] === NEUTRAL ? HitCause.Militia : HitCause.Unit, u.id[i]);
        if (u.action[i] === Action.Garrisoned) this.shots.push(u.orderTarget[i], tid);
      } else {
        const bs = w.building(tid);
        if (bs >= 0) {
          this.buildingDamage[bs] += b.type[bs] === BuildingType.Gate ? gateDamage(info.attack, u.type[i]) : info.attack;
          this.buildingHitBy[bs] |= 1 << u.owner[i];
        }
        // An outpost under attack sends its guards after the attacker (D-080).
        if (OUTPOST.on && bs >= 0 && b.type[bs] === BuildingType.Outpost) b.provoker[bs] = u.id[i];
      }
      u.lastDealt[i] = w.tick;
      u.cooldown[i] = info.cooldown;
    }
    // Arrows from main cities, the big city's tower and players' arrow towers (round 7, once built),
    // and governed towns' gates (D-096).
    const n = w.size;
    for (let s = 0; s < w.buildings.count; s++) {
      const arrow = arrowOf(w, s);
      if (arrow === null) continue;
      if (b.cooldown[s] > 0) {
        b.cooldown[s]--;
        continue;
      }
      const type = b.type[s];
      const gate = type === BuildingType.Gate;
      const size = w.wide(s);
      const sizeY = w.tall(s);
      let best = arrow.range * arrow.range + 1;
      let bestSlot = -1;
      // Slots are in id order: `<=` keeps the last (highest id) of equally near units. A
      // player's arrow tower (round 7) takes the first in its owner's canonical frame instead,
      // so mirror-image towers shoot mirror-image units.
      const high = preferHighId(w, b.id[s]);
      const canon = type === BuildingType.ArrowTower || gate;
      for (let j = 0; j < count; j++) {
        if (u.owner[j] === b.owner[s] || u.action[j] === Action.Garrisoned) continue;
        if (b.owner[s] !== NEUTRAL && fog.visible[b.owner[s]][(u.y[j] >> CELL_SHIFT) * n + (u.x[j] >> CELL_SHIFT)] !== 1) continue;
        const d2 = rectDist2(u.x[j], u.y[j], b.cellX[s], b.cellY[s], size, sizeY);
        if (d2 < best || (d2 === best && (canon ? canonFirst(w, b.owner[s], j, bestSlot) : high))) {
          best = d2;
          bestSlot = j;
        }
      }
      if (bestSlot < 0) continue;
      const arrows = gate
        ? 1 + Math.min(Math.trunc(this.holders(w, b.town[s], b.owner[s]) / GATE_ARROW.perSoldiers), GATE_ARROW.extraMax)
        : type === BuildingType.MainCity
          ? 1 + Math.min(b.garrisoned[s], MAIN_ARROW.extraMax)
          : 1;
      // On a wall (D-096): arrows for less too.
      const hits = onWall(w, bestSlot) ? coverDamage(arrow.damage * arrows) : arrow.damage * arrows;
      this.unitDamage[bestSlot] += hits;
      this.shieldDamage[bestSlot] += hits;
      this.unitHitBy[bestSlot] |= 1 << b.owner[s];
      u.hitBy[bestSlot] = b.owner[s];
      u.hitCause[bestSlot] = HitCause.Arrow;
      u.hitById[bestSlot] = -1;
      if (OUTPOST.on) this.provoke(w, bestSlot, b.id[s]);
      b.target[s] = u.id[bestSlot];
      b.cooldown[s] = arrow.cooldown;
      this.shots.push(b.id[s], u.id[bestSlot]);
    }

    const hurt: Hurt[] = [];
    for (let i = 0; i < count; i++) {
      let dmg = this.unitDamage[i];
      if (dmg === 0) continue;
      let shieldDmg = this.shieldDamage[i];
      // Fighting at home (HOME_GUARD, round 8): less damage.
      if (HOME_GUARD.on && u.owner[i] < PLAYER_COUNT && u.type[i] !== UnitType.Farmer && atHome(w, i)) {
        dmg -= Math.trunc((dmg * HOME_GUARD.permille) / 1000);
        shieldDmg -= Math.trunc((shieldDmg * HOME_GUARD.permille) / 1000);
      }
      // A shield takes this tick's hits whole, however much they exceed it.
      if (u.shield[i] > 0) u.shield[i] = Math.max(0, u.shield[i] - shieldDmg);
      else u.hp[i] -= dmg;
      u.lastHurt[i] = w.tick;
      hurt.push({ owner: u.owner[i], x: u.x[i], y: u.y[i], id: u.id[i], by: this.unitHitBy[i] });
    }
    // Shields regenerate after SHIELD_REGEN.afterTicks without taking or dealing damage.
    for (let i = 0; i < count; i++) {
      const max = UNITS[u.type[i]].shield;
      if (max === 0) continue;
      if (w.tick - Math.max(u.lastHurt[i], u.lastDealt[i]) < SHIELD_REGEN.afterTicks || u.shield[i] >= max) {
        u.acc[i] = 0;
        continue;
      }
      u.acc[i] += SHIELD_REGEN.perSecond;
      while (u.acc[i] >= TICKS) {
        u.acc[i] -= TICKS;
        u.shield[i]++;
      }
      if (u.shield[i] >= max) {
        u.shield[i] = max;
        u.acc[i] = 0;
      }
    }
    for (let s = 0; s < w.buildings.count; s++) {
      const dmg = this.buildingDamage[s];
      if (dmg === 0) continue;
      b.hp[s] -= dmg;
      b.lastHurt[s] = w.tick;
      hurt.push({
        owner: b.owner[s],
        x: (b.cellX[s] << CELL_SHIFT) + ((w.wide(s) << CELL_SHIFT) >> 1),
        y: (b.cellY[s] << CELL_SHIFT) + ((w.tall(s) << CELL_SHIFT) >> 1),
        id: b.id[s],
        by: this.buildingHitBy[s],
      });
    }
    // UnderAttack flag for the snapshot.
    for (let i = 0; i < count; i++) {
      if (w.tick - u.lastHurt[i] < UNDER_ATTACK_TICKS) u.flags[i] |= UnitFlag.UnderAttack;
      else u.flags[i] &= ~UnitFlag.UnderAttack;
    }
    return hurt;
  }

  /** One hit on unit slot ts: hp damage and shield damage with their multipliers. */
  private hit(w: World, ts: number, attack: number, attackerType: number, attackerOwner: number, cause: HitCause, attackerId: number): void {
    const u = w.units.col;
    if (OUTPOST.on) this.provoke(w, ts, attackerId);
    u.hitCause[ts] = cause;
    u.hitById[ts] = attackerId;
    // On a wall (D-096): ranged units' and mages' shots (not the cannon) for less.
    const cover = cause !== HitCause.Cannon && (attackerType === UnitType.Ranged || attackerType === UnitType.Mage) && onWall(w, ts);
    this.unitDamage[ts] += cover ? coverDamage(damage(attack, attackerType, u.type[ts])) : damage(attack, attackerType, u.type[ts]);
    this.shieldDamage[ts] += cover ? coverDamage(damage(attack, attackerType, SHIELD)) : damage(attack, attackerType, SHIELD);
    this.unitHitBy[ts] |= 1 << attackerOwner;
    u.hitBy[ts] = attackerOwner;
  }

  /**
   * The cannon fires at (castX, castY) if the owner still has the crystal: every unit not
   * the mage owner's within the radius is hit (never own units). Then cooldown; an autocast
   * returns to the order it interrupted.
   */
  private fireCannon(w: World, i: number): void {
    const u = w.units.col;
    const n = w.size;
    const p = u.owner[i];
    const o = p * 4 + Resource.Crystal;
    if (w.res[o] >= CANNON.crystal) {
      w.res[o] -= CANNON.crystal;
      // From inside a building (round 7): weaker and slower (GARRISON).
      const inside = u.action[i] === Action.Garrisoned;
      const dmg = inside ? Math.trunc((CANNON.damage * GARRISON.cannonPermille) / 1000) : CANNON.damage;
      const r2 = CANNON.radius * CANNON.radius;
      const blast = (CANNON.radius >> CELL_SHIFT) + 1;
      const cx = u.castX[i] >> CELL_SHIFT;
      const cy = u.castY[i] >> CELL_SHIFT;
      for (let y = Math.max(cy - blast, 0); y <= Math.min(cy + blast, n - 1); y++) {
        for (let x = Math.max(cx - blast, 0); x <= Math.min(cx + blast, n - 1); x++) {
          for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
            if (u.owner[j] === p || u.action[j] === Action.Garrisoned) continue;
            const dx = u.x[j] - u.castX[i];
            const dy = u.y[j] - u.castY[i];
            if (dx * dx + dy * dy <= r2) {
              this.hit(w, j, dmg, UnitType.Mage, p, HitCause.Cannon, u.id[i]);
              // A soldier standing with no order goes for the mage (AVENGE, round 8).
              if (AVENGE.on && u.owner[j] < PLAYER_COUNT && u.type[j] !== UnitType.Farmer && u.order[j] === Order.None) u.avenge[j] = u.id[i];
              if (p < PLAYER_COUNT) w.cannonHits[p]++;
            }
          }
        }
      }
      if (p < PLAYER_COUNT) w.cannonShots[p]++;
      u.lastDealt[i] = w.tick;
      u.castCooldown[i] = inside ? CANNON.cooldownTicks * GARRISON.cannonCooldown : CANNON.cooldownTicks;
    }
    u.castProgress[i] = 0;
    u.order[i] = u.prevOrder[i];
    u.orderTarget[i] = u.prevTarget[i];
    u.prevOrder[i] = Order.None;
    u.prevTarget[i] = -1;
    if (u.order[i] === Order.None) {
      u.anchorX[i] = u.x[i];
      u.anchorY[i] = u.y[i];
    }
  }

  // --- deaths ----------------------------------------------------------------------------

  /**
   * Removes units and buildings at 0 hp. A fallen building lets out the farmers hidden in it
   * (`release`), no longer blocks its cells, and a fallen main city ends the game.
   */
  removeDead(w: World, release: (slot: number) => void, emit: (to: number, ev: SimEvent) => void): void {
    const u = w.units.col;
    const b = w.buildings.col;
    let anyUnit = false;
    for (let i = 0; i < w.units.count; i++) {
      this.deadUnits[i] = u.hp[i] <= 0 ? 1 : 0;
      if (this.deadUnits[i] === 1) {
        anyUnit = true;
        w.unitSlot[u.id[i]] = -1;
        // Its wall cell is free again (D-096).
        if (u.wall[i] >= 0 && w.wallAt[u.wall[i]] === u.id[i]) w.wallAt[u.wall[i]] = -1;
        if (u.owner[i] < PLAYER_COUNT) w.lost[u.owner[i] * UNIT_KINDS + u.type[i]]++;
        // D-089's measurement: soldiers lost at the castles and at their gates.
        if (u.owner[i] < PLAYER_COUNT && u.type[i] !== UnitType.Farmer) {
          const cell = (u.y[i] >> CELL_SHIFT) * w.size + (u.x[i] >> CELL_SHIFT);
          if (w.nearGate[cell] === 1) w.gateDeaths[u.owner[i]]++;
          if (w.nearCastle[cell] === 1) w.townDeaths[u.owner[i]]++;
        }
        if (u.owner[i] < PLAYER_COUNT && u.type[i] === UnitType.Farmer) {
          w.farmerDeaths[u.owner[i] * 5 + u.hitCause[i]]++;
          w.farmerDeathLog.push(u.owner[i], u.x[i] >> CELL_SHIFT, u.y[i] >> CELL_SHIFT, u.hitCause[i], w.tick);
        }
        if (u.hitCause[i] === HitCause.Cannon && u.hitBy[i] >= 0 && u.hitBy[i] < PLAYER_COUNT) w.cannonKills[u.hitBy[i]]++;
        if (u.type[i] === UnitType.Mage) {
          // The killer's side picks up the bounty (none for the neutral side).
          const killer = u.hitBy[i];
          const bounty = killer >= 0 && killer < PLAYER_COUNT && killer !== u.owner[i] ? MAGE_BOUNTY : 0;
          if (bounty > 0) w.res[killer * 4 + Resource.Crystal] += bounty;
          const ev: SimEvent = { k: "mage_killed", id: u.id[i], owner: u.owner[i], killer, crystal: bounty };
          emit(u.owner[i], ev);
          if (killer !== u.owner[i] && killer >= 0 && killer < PLAYER_COUNT) emit(killer, ev);
        }
      }
    }
    if (anyUnit) {
      w.units.compact(this.deadUnits, (_from, to) => {
        w.unitSlot[u.id[to]] = to;
      });
    }
    let lost0 = false;
    let lost1 = false;
    let anyBuilding = false;
    const brokenIn: number[] = [];
    for (let s = 0; s < w.buildings.count; s++) {
      this.deadBuildings[s] = b.hp[s] <= 0 ? 1 : 0;
      if (this.deadBuildings[s] === 0) continue;
      anyBuilding = true;
      // A broken gate (D-096): its opening is open to everyone.
      if (b.type[s] === BuildingType.Gate && !brokenIn.includes(b.town[s])) brokenIn.push(b.town[s]);
      w.setFootprint(b.id[s], b.type[s] as BuildingType, b.cellX[s], b.cellY[s], false);
      if (b.garrisoned[s] > 0 || b.soldiers[s] > 0) {
        for (let i = 0; i < w.units.count; i++) {
          if (u.action[i] !== Action.Garrisoned) continue;
          // A calibrating mage keeps its building in prevTarget (startCast).
          const at = u.order[i] === Order.Cast ? u.prevTarget[i] : u.orderTarget[i];
          if (at === b.id[s]) release(i);
        }
        b.garrisoned[s] = 0;
        b.soldiers[s] = 0;
      }
      w.buildingSlot[b.id[s]] = -1;
      if (b.progress[s] >= 1000 && BUILDINGS[b.type[s]].accepts.length > 0) w.dropVersion++;
      if (b.type[s] === BuildingType.MainCity) {
        if (b.owner[s] === 0) lost0 = true;
        if (b.owner[s] === 1) lost1 = true;
      }
    }
    if (anyBuilding) {
      w.buildings.compact(this.deadBuildings, (_from, to) => {
        w.buildingSlot[b.id[to]] = to;
      });
    }
    for (const t of brokenIn) w.refreshGates(t);
    if ((lost0 || lost1) && !w.over) {
      w.winner = lost0 && lost1 ? -1 : lost0 ? 1 : 0;
      w.endReason = GameOverReason.MainCityDestroyed;
    }
  }
}

/**
 * Equally near targets of the round 7 shooters (arrow towers, soldiers hiding in buildings):
 * is unit slot j before slot k (k < 0: none yet) in the chooser's canonical frame — the
 * lower canonical v, then u, of their cells, then the lower id? Mirror-image choosers pick
 * mirror-image targets.
 */
/**
 * Is unit slot i at home (HOME_GUARD, round 8): within HOME_GUARD.mainCity cells (Chebyshev, from
 * the footprint) of its owner's finished main city, or inside the walls of a town its owner governs
 * (D-089)?
 */
export function atHome(w: World, i: number): boolean {
  const u = w.units.col;
  const p = u.owner[i];
  const cx = u.x[i] >> CELL_SHIFT;
  const cy = u.y[i] >> CELL_SHIFT;
  const b = w.buildings.col;
  for (let s = 0; s < w.buildings.count; s++) {
    if (b.owner[s] !== p || b.type[s] !== BuildingType.MainCity || b.progress[s] < 1000) continue;
    const size = BUILDINGS[BuildingType.MainCity].size;
    const dx = Math.max(b.cellX[s] - cx, 0, cx - (b.cellX[s] + size - 1));
    const dy = Math.max(b.cellY[s] - cy, 0, cy - (b.cellY[s] + size - 1));
    if (Math.max(dx, dy) <= HOME_GUARD.mainCity) return true;
  }
  for (let t = 0; t < w.townSize.length; t++) {
    if (w.townOwner[t] !== p || w.townState[t] !== TownState.Governed) continue;
    // Inside the walls (D-089).
    if (w.inTown(t, u.x[i] >> CELL_SHIFT, u.y[i] >> CELL_SHIFT)) return true;
  }
  return false;
}

/** Guards' places around an outpost's 2 x 2 footprint, from its canonical top-left cell (D-080). */
const POST_PLACES: readonly (readonly [number, number])[] = [
  [-1, -1], [2, -1], [-1, 2], [2, 2], [0, -1], [1, 2],
];

/** Is unit slot i standing on its castle wall (D-096): its wall cell is where it is? */
export function onWall(w: World, i: number): boolean {
  const u = w.units.col;
  return u.wall[i] >= 0 && (u.y[i] >> CELL_SHIFT) * w.size + (u.x[i] >> CELL_SHIFT) === u.wall[i];
}

/** A hit on a soldier on a wall by an arrow or a shot (WALLS.takenNum / takenDen, at least 1). */
export function coverDamage(d: number): number {
  return Math.max(1, idiv(d * WALLS.takenNum, WALLS.takenDen));
}

/**
 * The arrows building slot s shoots, null if none: a finished main city, the big city's tower or
 * an arrow tower (round 7), or a governed town's gate (D-096).
 */
function arrowOf(w: World, s: number): { damage: number; range: number; cooldown: number } | null {
  const b = w.buildings.col;
  if (b.progress[s] < 1000) return null;
  switch (b.type[s]) {
    case BuildingType.MainCity:
      return MAIN_ARROW;
    case BuildingType.TownTower:
      return TOWER_ARROW;
    case BuildingType.ArrowTower:
      return ARROW_TOWER;
    case BuildingType.Gate:
      return GATE.on && w.townState[b.town[s]] === TownState.Governed ? GATE_ARROW : null;
    default:
      return null;
  }
}

/** How far a soldier on a wall shoots (WALLS): its range plus WALLS.range; militia throw stones to WALLS.sling. */
export function wallReach(type: number, range: number): number {
  return type === UnitType.Militia ? WALLS.sling : range + WALLS.range;
}

/** Is cell a before cell b in frame f's canonical order (lower v, then u)? */
function canonBefore(f: Frame, a: number, b: number, n: number): boolean {
  const p = toCanon(f, a % n, Math.trunc(a / n));
  const q = toCanon(f, b % n, Math.trunc(b / n));
  return p.v !== q.v ? p.v < q.v : p.u < q.u;
}

function canonFirst(w: World, owner: number, j: number, k: number): boolean {
  if (k < 0) return true;
  const u = w.units.col;
  const f = w.map.frames[owner] ?? IDENTITY;
  const a = toCanon(f, u.x[j] >> CELL_SHIFT, u.y[j] >> CELL_SHIFT);
  const c = toCanon(f, u.x[k] >> CELL_SHIFT, u.y[k] >> CELL_SHIFT);
  if (a.v !== c.v) return a.v < c.v;
  if (a.u !== c.u) return a.u < c.u;
  return u.id[j] < u.id[k];
}

/**
 * Equally near targets: the lower or the higher id, alternating with the time and the
 * chooser's id. Ids are handed out in creation order, so always preferring the lower id
 * would make neutral militia and towers pick on whichever player built first.
 */
export function preferHighId(w: World, chooser: number): boolean {
  return ((Math.trunc(w.tick / RETARGET_EVERY) + chooser) & 1) === 1;
}

/**
 * A hit on a castle gate (D-096, GATE): melee in full, ranged units and mages GATE.rangedNum /
 * rangedDen of it, at least 1. Kept apart from the unit-vs-unit multipliers (MULTIPLIERS).
 */
export function gateDamage(attack: number, attacker: number): number {
  if (attacker !== UnitType.Ranged && attacker !== UnitType.Mage) return attack;
  return Math.max(1, idiv(attack * GATE.rangedNum, GATE.rangedDen));
}

/** Damage after the attacker-vs-target multiplier (integer, at least 1). */
/** Starts a cannon calibration at the fixed-point point (x, y); an autocast remembers the order it interrupts. */
export function startCast(w: World, i: number, x: number, y: number, auto: boolean): void {
  const u = w.units.col;
  if (u.order[i] !== Order.Cast) {
    // A mage hiding in a building (round 7) always goes back to hiding in it after the shot.
    const back = auto || u.action[i] === Action.Garrisoned;
    u.prevOrder[i] = back ? u.order[i] : Order.None;
    u.prevTarget[i] = back ? u.orderTarget[i] : -1;
  }
  u.order[i] = Order.Cast;
  u.orderTarget[i] = -1;
  u.castX[i] = x;
  u.castY[i] = y;
  u.castProgress[i] = 0;
  u.target[i] = -1;
  u.vx[i] = 0;
  u.vy[i] = 0;
}

export function damage(attack: number, attacker: number, target: number): number {
  return Math.max(1, idiv(attack * MULT_NUM[attacker][target], MULT_DEN[attacker][target]));
}

/** Squared fixed-point distance from a point to a building's footprint (0 inside). */
/** Squared distance from the centre of cell c to the point (tx, ty). */
function cellDist2(c: number, n: number, tx: number, ty: number): number {
  const dx = ((c % n) << CELL_SHIFT) + (CELL >> 1) - tx;
  const dy = (Math.trunc(c / n) << CELL_SHIFT) + (CELL >> 1) - ty;
  return dx * dx + dy * dy;
}

export function rectDist2(x: number, y: number, cellX: number, cellY: number, size: number, sizeY = size): number {
  const x0 = cellX << CELL_SHIFT;
  const y0 = cellY << CELL_SHIFT;
  const x1 = (cellX + size) << CELL_SHIFT;
  const y1 = (cellY + sizeY) << CELL_SHIFT;
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return dx * dx + dy * dy;
}

export function alive(w: World, id: number): boolean {
  return w.unit(id) >= 0 || w.building(id) >= 0;
}

