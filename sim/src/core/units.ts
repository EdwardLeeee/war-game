// Unit behaviour for one tick, in phases the game calls in order: prepare (bucket by cell),
// decide (targets, stance, orders -> desired velocity; farmers at work are decided by the
// economy), move (separation from start-of-tick positions, wall sliding), attack (cooldowns,
// damage summed per target), then, after the economy's work, remove the dead. Every loop
// runs in id order and reads start-of-tick state, so results do not depend on iteration
// details.

import {
  Action,
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
  UnitFlag,
  UnitType,
} from "../protocol.ts";
import { clamp, DIR16_X, DIR16_Y, dir16, idiv } from "./fixed.ts";
import type { Fog } from "./fog.ts";
import { type FieldCache, buildingKey, cellsAround, nearestWalkable, Regions } from "./paths.ts";
import {
  AGGRO_RANGE,
  ARRIVE_DISTANCE,
  BUILDINGS,
  CANNON,
  COUNTER_ATTACK,
  MAGE_BOUNTY,
  SHIELD,
  SHIELD_REGEN,
  DIRECT_STEER,
  JOIN_FIGHT,
  LEASH,
  LOOSE_KEEP,
  MAIN_ARROW,
  MAX_PUSH,
  MULT_DEN,
  MULT_NUM,
  PUSH,
  RETARGET_EVERY,
  SEPARATION,
  TOWER_ARROW,
  UNDER_ATTACK_TICKS,
  UNITS,
} from "./rules.ts";
import { IDENTITY, toCanon } from "../frame.ts";
import { openLine, steerDirect, steerTo } from "./steer.ts";
import { HitCause, type World } from "./world.ts";

const TICKS = TICKS_PER_SECOND;

/** Decides a farmer that carries an economy order (Gather, Build, Repair, Recall). */
export interface FarmerDecider {
  decide(w: World, fields: FieldCache, i: number): void;
}

/** Orders the economy decides instead of the combat logic. */
export function isWorkOrder(order: number): boolean {
  return order === Order.Gather || order === Order.Build || order === Order.Repair || order === Order.Recall;
}

export interface Hurt {
  /** Owner of what was hurt, fixed-point position, id. */
  owner: number;
  x: number;
  y: number;
  id: number;
}

/** Per-tick scratch arrays, reused. */
export class UnitSystem {
  private cellHead: Int32Array;
  private cellNext = new Int32Array(256);
  /** The same buckets for the loose soldiers that push apart (LOOSE_KEEP), rebuilt in move(). */
  private keepHead: Int32Array;
  private keepNext = new Int32Array(256);
  private keeps = new Uint8Array(256);
  private attacking = new Uint8Array(256);
  /** Each unit's target at the start of the tick (joining a fight reads these, not this tick's). */
  private startTarget = new Int32Array(256);
  private unitDamage = new Int32Array(256);
  /** The same hits counted against a mage's shield (its own multipliers). */
  private shieldDamage = new Int32Array(256);
  private buildingDamage = new Int32Array(64);
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
      this.keeps = new Uint8Array(c);
      this.attacking = new Uint8Array(c);
      this.startTarget = new Int32Array(c);
      this.unitDamage = new Int32Array(c);
      this.shieldDamage = new Int32Array(c);
      this.newX = new Int32Array(c);
      this.newY = new Int32Array(c);
      this.deadUnits = new Uint8Array(c);
    }
    if (this.buildingDamage.length < nb) {
      const c = Math.max(nb, this.buildingDamage.length * 2);
      this.buildingDamage = new Int32Array(c);
      this.deadBuildings = new Uint8Array(c);
    }
  }

  /** Decide, move and attack. Returns what got hurt (for events); removeDead comes later. */
  run(w: World, fog: Fog, fields: FieldCache, farmers: FarmerDecider): Hurt[] {
    this.fit(w.units.count, w.buildings.count);
    this.bucket(w);
    this.startTarget.set(w.units.col.target.subarray(0, w.units.count));
    for (let i = 0; i < w.units.count; i++) this.decide(w, fog, fields, farmers, i);
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
   * Nearest enemy unit within reach (ties to the lower id), else the nearest enemy building; returns
   * an id or -1. Town militia (neutral) guard against units only: never a building or a building
   * site (round 4, ceo: with a town 18 cells from each main city they walked into the base and
   * knocked down sites, with nothing to tell a player why).
   */
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
          if (d2 < best || (d2 === best && (high ? u.id[j] > bestId : u.id[j] < bestId))) {
            best = d2;
            bestId = u.id[j];
          }
        }
      }
    }
    if (bestId >= 0 || me === NEUTRAL) return bestId;
    const b = w.buildings.col;
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.owner[s] === me) continue;
      const d2 = rectDist2(mx, my, b.cellX[s], b.cellY[s], BUILDINGS[b.type[s]].size);
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
  private autocastAim(w: World, fog: Fog, i: number): number {
    const u = w.units.col;
    const n = w.size;
    const me = u.owner[i];
    const range2 = CANNON.range * CANNON.range;
    const r2 = CANNON.radius * CANNON.radius;
    const hostile = (j: number) =>
      u.owner[j] !== me && u.action[j] !== Action.Garrisoned && this.sees(fog, me, u.x[j], u.y[j], n);
    const reach = (CANNON.range >> CELL_SHIFT) + 1;
    const blast = (CANNON.radius >> CELL_SHIFT) + 1;
    const cx = u.x[i] >> CELL_SHIFT;
    const cy = u.y[i] >> CELL_SHIFT;
    let best = -1;
    let bestCount = CANNON.autocastMinTargets - 1;
    let bestId = 0;
    for (let y = Math.max(cy - reach, 0); y <= Math.min(cy + reach, n - 1); y++) {
      for (let x = Math.max(cx - reach, 0); x <= Math.min(cx + reach, n - 1); x++) {
        for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
          if (!hostile(j)) continue;
          const dx = u.x[j] - u.x[i];
          const dy = u.y[j] - u.y[i];
          if (dx * dx + dy * dy > range2) continue;
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

  // --- decide ----------------------------------------------------------------------------

  private decide(w: World, fog: Fog, fields: FieldCache, farmers: FarmerDecider, i: number): void {
    const u = w.units.col;
    const n = w.size;
    const info = UNITS[u.type[i]];
    u.vx[i] = 0;
    u.vy[i] = 0;
    u.working[i] = 0;
    this.attacking[i] = 0;
    if (u.action[i] === Action.Garrisoned) return;
    const order = u.order[i];
    if (isWorkOrder(order)) {
      u.target[i] = -1;
      farmers.decide(w, fields, i);
      return;
    }
    const farmer = u.type[i] === UnitType.Farmer;

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
      if (tid < 0 && order === Order.None && !hold && u.owner[i] < PLAYER_COUNT) tid = this.joinFight(w, fog, i);
      if (tid < 0 && order === Order.None && !hold && u.owner[i] < PLAYER_COUNT && COUNTER_ATTACK.on) tid = this.counterAttack(w, fog, i);
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
        const dx = tx - u.x[i];
        const dy = ty - u.y[i];
        d2 = dx * dx + dy * dy;
      } else {
        const bs = w.building(tid);
        const b = w.buildings.col;
        const size = BUILDINGS[b.type[bs]].size;
        tx = (b.cellX[bs] << CELL_SHIFT) + ((size << CELL_SHIFT) >> 1);
        ty = (b.cellY[bs] << CELL_SHIFT) + ((size << CELL_SHIFT) >> 1);
        d2 = rectDist2(u.x[i], u.y[i], b.cellX[bs], b.cellY[bs], size);
      }
      u.facing[i] = dir16(tx - u.x[i], ty - u.y[i]);
      if (d2 <= info.range * info.range) {
        this.attacking[i] = 1;
        u.action[i] = Action.Attack;
        return;
      }
      if (order === Order.Move && this.keepsPlace(w, i)) {
        // A loose ranged unit or mage keeps to its place instead of going for a target out of range.
        this.march(w, fields, i, order, farmer, info.speed);
        return;
      }
      const idle = order === Order.None;
      if (idle && u.stance[i] === Stance.Hold) {
        u.target[i] = -1;
        u.action[i] = Action.Idle;
        return;
      }
      if (idle) {
        const ax = tx - u.anchorX[i];
        const ay = ty - u.anchorY[i];
        if (ax * ax + ay * ay > LEASH * LEASH) {
          u.target[i] = -1;
          steerTo(w, fields, i, u.anchorX[i], u.anchorY[i], -1, info.speed);
          return;
        }
      }
      if (order === Order.Attack) {
        const here = this.walledOff(w, i, ts, tid);
        if (here >= 0) {
          this.breakThrough(w, fields, i, here, tx, ty, true);
          return;
        }
      }
      if (order === Order.Attack && d2 > DIRECT_STEER * DIRECT_STEER) {
        if (ts >= 0) {
          steerTo(w, fields, i, tx, ty, (ty >> CELL_SHIFT) * n + (tx >> CELL_SHIFT), info.speed);
        } else {
          const bs = w.building(tid);
          const b = w.buildings.col;
          steerTo(w, fields, i, tx, ty, buildingKey(tid), info.speed, () =>
            cellsAround(w, b.cellX[bs], b.cellY[bs], BUILDINGS[b.type[bs]].size),
          );
        }
      } else {
        steerDirect(w, i, tx - u.x[i], ty - u.y[i], info.speed);
      }
      return;
    }

    if (order === Order.Move || order === Order.Retreat) {
      this.march(w, fields, i, order, farmer, info.speed);
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

  /** A move or a retreat toward the unit's slot: the group's field, or straight when near or keeping its place. */
  private march(w: World, fields: FieldCache, i: number, order: number, farmer: boolean, speed: number): void {
    const u = w.units.col;
    const n = w.size;
    const dx = u.orderX[i] - u.x[i];
    const dy = u.orderY[i] - u.y[i];
    if (dx * dx + dy * dy <= ARRIVE_DISTANCE * ARRIVE_DISTANCE) {
      this.arrive(w, i);
      return;
    }
    const sp = u.speedCap[i] > 0 ? Math.min(u.speedCap[i], speed) : speed;
    // A point no one can walk to from here: soldiers on a move break through, farmers and
    // retreats go as near as they can get.
    const key = u.orderTarget[i] >= 0 ? u.orderTarget[i] : (u.orderY[i] >> CELL_SHIFT) * n + (u.orderX[i] >> CELL_SHIFT);
    const goal = nearestWalkable(w, key % n, Math.trunc(key / n));
    const here = this.regions.of(w, (u.y[i] >> CELL_SHIFT) * n + (u.x[i] >> CELL_SHIFT));
    if (goal >= 0 && here >= 0 && this.regions.of(w, goal) !== here) {
      this.breakThrough(w, fields, i, here, u.orderX[i], u.orderY[i], order === Order.Move && !farmer);
      return;
    }
    // Loose ranged units and mages go straight to their place whenever the way is open, so the
    // formation keeps its shape on the march (LOOSE_KEEP).
    if (this.slotInReach(w, i, dx, dy) || (this.keepsPlace(w, i) && openLine(w, u.x[i], u.y[i], u.orderX[i], u.orderY[i]))) {
      steerDirect(w, i, dx, dy, sp);
      return;
    }
    steerTo(w, fields, i, u.orderX[i], u.orderY[i], u.orderTarget[i], sp);
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

  /** A player's loose soldier that keeps the wider spacing: any type, or ranged units and mages only without LOOSE_KEEP.everyone. */
  private pushesApart(w: World, i: number): boolean {
    const u = w.units.col;
    const t = u.type[i];
    if (LOOSE_KEEP.spacing === 0 || (u.flags[i] & UnitFlag.Loose) === 0 || u.owner[i] >= PLAYER_COUNT || t === UnitType.Farmer) return false;
    return LOOSE_KEEP.everyone || t === UnitType.Ranged || t === UnitType.Mage;
  }

  /** A player's loose ranged unit or mage (LOOSE_KEEP): keeps to its place on a move. */
  private keepsPlace(w: World, i: number): boolean {
    const u = w.units.col;
    const t = u.type[i];
    return LOOSE_KEEP.spacing > 0 && (u.flags[i] & UnitFlag.Loose) !== 0 && (t === UnitType.Ranged || t === UnitType.Mage) && u.owner[i] < PLAYER_COUNT;
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
    const here = this.regions.of(w, (u.y[i] >> CELL_SHIFT) * n + (u.x[i] >> CELL_SHIFT));
    if (here < 0) return -1;
    if (ts >= 0) {
      const there = this.regions.of(w, (u.y[ts] >> CELL_SHIFT) * n + (u.x[ts] >> CELL_SHIFT));
      return there >= 0 && there !== here ? here : -1;
    }
    const bs = w.building(tid);
    const b = w.buildings.col;
    for (const c of cellsAround(w, b.cellX[bs], b.cellY[bs], BUILDINGS[b.type[bs]].size)) {
      if (this.regions.of(w, c) === here) return -1;
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
    const key = `${u.owner[i]},${here},${tx},${ty}`;
    let known = this.walled.get(key);
    if (known === undefined) {
      const c = this.nearestIn(w, here, tx, ty);
      const reach = c < 0 ? 0 : cellDist2(c, n, tx, ty);
      let blocker = -1;
      let bestD = 0;
      for (let s = 0; c >= 0 && s < w.buildings.count; s++) {
        const o = b.owner[s];
        const bi = BUILDINGS[b.type[s]];
        if (o === u.owner[i] || o >= PLAYER_COUNT || b.hp[s] <= 0 || bi.walkable) continue;
        const d = rectDist2(tx, ty, b.cellX[s], b.cellY[s], bi.size);
        if (d >= reach) continue;
        if (!cellsAround(w, b.cellX[s], b.cellY[s], bi.size).some((k) => this.regions.of(w, k) === here)) continue;
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
      const size = BUILDINGS[b.type[best]].size;
      const bx = (b.cellX[best] << CELL_SHIFT) + ((size << CELL_SHIFT) >> 1);
      const by = (b.cellY[best] << CELL_SHIFT) + ((size << CELL_SHIFT) >> 1);
      u.target[i] = b.id[best];
      u.facing[i] = dir16(bx - u.x[i], by - u.y[i]);
      if (rectDist2(u.x[i], u.y[i], b.cellX[best], b.cellY[best], size) <= info.range * info.range) {
        this.attacking[i] = 1;
        u.action[i] = Action.Attack;
        return;
      }
      const cx = b.cellX[best];
      const cy = b.cellY[best];
      steerTo(w, fields, i, bx, by, buildingKey(b.id[best]), info.speed, () => cellsAround(w, cx, cy, size));
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

  /** The cell of area `region` nearest the point (tx, ty): the nearest ring around it that has one, then the nearest (ties: lower index). */
  private nearestIn(w: World, region: number, tx: number, ty: number): number {
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
          if (this.regions.of(w, c) !== region) continue;
          const d = cellDist2(c, n, tx, ty);
          if (best < 0 || d < bestD || (d === bestD && c < best)) {
            best = c;
            bestD = d;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
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
    // Loose soldiers, and their own buckets (only they are looked at for the wider spacing).
    const spacing = LOOSE_KEEP.spacing;
    let anyKeep = false;
    for (let i = 0; i < count; i++) {
      this.keeps[i] = this.pushesApart(w, i) ? 1 : 0;
      if (this.keeps[i] === 1) anyKeep = true;
    }
    if (anyKeep) {
      this.keepHead.fill(-1);
      for (let i = 0; i < count; i++) {
        if (this.keeps[i] === 0) continue;
        const c = (u.y[i] >> CELL_SHIFT) * n + (u.x[i] >> CELL_SHIFT);
        this.keepNext[i] = this.keepHead[c];
        this.keepHead[c] = i;
      }
    }
    for (let i = 0; i < count; i++) {
      const xi = u.x[i];
      const yi = u.y[i];
      if (u.action[i] === Action.Garrisoned) {
        this.newX[i] = xi;
        this.newY[i] = yi;
        continue;
      }
      const cx = xi >> CELL_SHIFT;
      const cy = yi >> CELL_SHIFT;
      let px = 0;
      let py = 0;
      // A loose soldier keeps those of its own player and group at `spacing` (below).
      const wide = this.keeps[i] === 1 && u.group[i] >= 0;
      for (let y = Math.max(cy - 1, 0); y <= Math.min(cy + 1, n - 1); y++) {
        for (let x = Math.max(cx - 1, 0); x <= Math.min(cx + 1, n - 1); x++) {
          for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
            if (j === i || u.action[j] === Action.Garrisoned) continue;
            if (wide && this.keeps[j] === 1 && u.owner[j] === u.owner[i] && u.group[j] === u.group[i]) continue;
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
      if (wide) {
        // Reach 2 cells is enough: units two cells further off along an axis are at least
        // 2 * CELL + 1 apart, never closer than `spacing` (2 * CELL).
        const reach = (spacing + CELL - 1) >> CELL_SHIFT;
        for (let y = Math.max(cy - reach, 0); y <= Math.min(cy + reach, n - 1); y++) {
          for (let x = Math.max(cx - reach, 0); x <= Math.min(cx + reach, n - 1); x++) {
            for (let j = this.keepHead[y * n + x]; j >= 0; j = this.keepNext[j]) {
              if (j === i || u.owner[j] !== u.owner[i] || u.group[j] !== u.group[i]) continue;
              const dx = xi - u.x[j];
              const dy = yi - u.y[j];
              if (dx >= spacing || dx <= -spacing || dy >= spacing || dy <= -spacing) continue;
              if (dx * dx + dy * dy >= spacing * spacing) continue;
              const k = dx === 0 && dy === 0 ? (u.id[i] < u.id[j] ? 0 : 8) + (w.yFirst[u.owner[i]] ? 4 : 0) : dir16(dx, dy);
              px += idiv(DIR16_X[k] * PUSH, CELL);
              py += idiv(DIR16_Y[k] * PUSH, CELL);
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
      if (ax > ay || (ax === ay && !w.yFirst[u.owner[i]])) {
        if (w.grid[(yi >> CELL_SHIFT) * n + (tx >> CELL_SHIFT)] !== 0) tx = xi;
        if (w.grid[(ty >> CELL_SHIFT) * n + (tx >> CELL_SHIFT)] !== 0) ty = yi;
      } else {
        if (w.grid[(ty >> CELL_SHIFT) * n + (xi >> CELL_SHIFT)] !== 0) ty = yi;
        if (w.grid[(ty >> CELL_SHIFT) * n + (tx >> CELL_SHIFT)] !== 0) tx = xi;
      }
      this.newX[i] = tx;
      this.newY[i] = ty;
    }
    for (let i = 0; i < count; i++) {
      const moved = Math.abs(this.newX[i] - u.x[i]) + Math.abs(this.newY[i] - u.y[i]);
      u.x[i] = this.newX[i];
      u.y[i] = this.newY[i];
      // A unit pressed against others near its slot for 40 ticks counts as arrived.
      if ((u.order[i] === Order.Move || u.order[i] === Order.Retreat) && u.target[i] < 0) {
        const dx = u.orderX[i] - u.x[i];
        const dy = u.orderY[i] - u.y[i];
        const near = dx * dx + dy * dy <= DIRECT_STEER * DIRECT_STEER;
        u.stuck[i] = near && moved < 8 ? u.stuck[i] + 1 : 0;
        if (u.stuck[i] >= 40) this.arrive(w, i);
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
      } else {
        const bs = w.building(tid);
        if (bs >= 0) this.buildingDamage[bs] += info.attack;
      }
      u.lastDealt[i] = w.tick;
      u.cooldown[i] = info.cooldown;
    }
    // Arrows from main cities and the big city's tower.
    const n = w.size;
    for (let s = 0; s < w.buildings.count; s++) {
      const type = b.type[s];
      if (type !== BuildingType.MainCity && type !== BuildingType.TownTower) continue;
      if (b.cooldown[s] > 0) {
        b.cooldown[s]--;
        continue;
      }
      const arrow = type === BuildingType.MainCity ? MAIN_ARROW : TOWER_ARROW;
      const size = BUILDINGS[type].size;
      let best = arrow.range * arrow.range + 1;
      let bestSlot = -1;
      // Slots are in id order: `<=` keeps the last (highest id) of equally near units.
      const high = preferHighId(w, b.id[s]);
      for (let j = 0; j < count; j++) {
        if (u.owner[j] === b.owner[s] || u.action[j] === Action.Garrisoned) continue;
        if (b.owner[s] !== NEUTRAL && fog.visible[b.owner[s]][(u.y[j] >> CELL_SHIFT) * n + (u.x[j] >> CELL_SHIFT)] !== 1) continue;
        const d2 = rectDist2(u.x[j], u.y[j], b.cellX[s], b.cellY[s], size);
        if (d2 < best || (high && d2 === best)) {
          best = d2;
          bestSlot = j;
        }
      }
      if (bestSlot < 0) continue;
      const arrows = type === BuildingType.MainCity ? 1 + Math.min(b.garrisoned[s], MAIN_ARROW.extraMax) : 1;
      this.unitDamage[bestSlot] += arrow.damage * arrows;
      this.shieldDamage[bestSlot] += arrow.damage * arrows;
      u.hitBy[bestSlot] = b.owner[s];
      u.hitCause[bestSlot] = HitCause.Arrow;
      u.hitById[bestSlot] = -1;
      b.target[s] = u.id[bestSlot];
      b.cooldown[s] = arrow.cooldown;
    }

    const hurt: Hurt[] = [];
    for (let i = 0; i < count; i++) {
      const dmg = this.unitDamage[i];
      if (dmg === 0) continue;
      // A shield takes this tick's hits whole, however much they exceed it.
      if (u.shield[i] > 0) u.shield[i] = Math.max(0, u.shield[i] - this.shieldDamage[i]);
      else u.hp[i] -= dmg;
      u.lastHurt[i] = w.tick;
      hurt.push({ owner: u.owner[i], x: u.x[i], y: u.y[i], id: u.id[i] });
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
      const size = BUILDINGS[b.type[s]].size;
      hurt.push({ owner: b.owner[s], x: (b.cellX[s] << CELL_SHIFT) + ((size << CELL_SHIFT) >> 1), y: (b.cellY[s] << CELL_SHIFT) + ((size << CELL_SHIFT) >> 1), id: b.id[s] });
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
    this.unitDamage[ts] += damage(attack, attackerType, u.type[ts]);
    this.shieldDamage[ts] += damage(attack, attackerType, SHIELD);
    u.hitBy[ts] = attackerOwner;
    u.hitCause[ts] = cause;
    u.hitById[ts] = attackerId;
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
              this.hit(w, j, CANNON.damage, UnitType.Mage, p, HitCause.Cannon, u.id[i]);
              if (p < PLAYER_COUNT) w.cannonHits[p]++;
            }
          }
        }
      }
      if (p < PLAYER_COUNT) w.cannonShots[p]++;
      u.lastDealt[i] = w.tick;
      u.castCooldown[i] = CANNON.cooldownTicks;
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
        if (u.owner[i] < PLAYER_COUNT) w.lost[u.owner[i] * 5 + u.type[i]]++;
        if (u.owner[i] < PLAYER_COUNT && u.type[i] === UnitType.Farmer) w.farmerDeaths[u.owner[i] * 5 + u.hitCause[i]]++;
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
    for (let s = 0; s < w.buildings.count; s++) {
      this.deadBuildings[s] = b.hp[s] <= 0 ? 1 : 0;
      if (this.deadBuildings[s] === 0) continue;
      anyBuilding = true;
      w.setFootprint(b.id[s], b.type[s] as BuildingType, b.cellX[s], b.cellY[s], false);
      if (b.garrisoned[s] > 0) {
        for (let i = 0; i < w.units.count; i++) {
          if (u.action[i] === Action.Garrisoned && u.orderTarget[i] === b.id[s]) release(i);
        }
        b.garrisoned[s] = 0;
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
    if ((lost0 || lost1) && !w.over) {
      w.winner = lost0 && lost1 ? -1 : lost0 ? 1 : 0;
      w.endReason = GameOverReason.MainCityDestroyed;
    }
  }
}

/**
 * Equally near targets: the lower or the higher id, alternating with the time and the
 * chooser's id. Ids are handed out in creation order, so always preferring the lower id
 * would make neutral militia and towers pick on whichever player built first.
 */
export function preferHighId(w: World, chooser: number): boolean {
  return ((Math.trunc(w.tick / RETARGET_EVERY) + chooser) & 1) === 1;
}

/** Damage after the attacker-vs-target multiplier (integer, at least 1). */
/** Starts a cannon calibration at the fixed-point point (x, y); an autocast remembers the order it interrupts. */
export function startCast(w: World, i: number, x: number, y: number, auto: boolean): void {
  const u = w.units.col;
  if (u.order[i] !== Order.Cast) {
    u.prevOrder[i] = auto ? u.order[i] : Order.None;
    u.prevTarget[i] = auto ? u.orderTarget[i] : -1;
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

export function rectDist2(x: number, y: number, cellX: number, cellY: number, size: number): number {
  const x0 = cellX << CELL_SHIFT;
  const y0 = cellY << CELL_SHIFT;
  const x1 = (cellX + size) << CELL_SHIFT;
  const y1 = (cellY + size) << CELL_SHIFT;
  const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
  const dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
  return dx * dx + dy * dy;
}

export function alive(w: World, id: number): boolean {
  return w.unit(id) >= 0 || w.building(id) >= 0;
}

