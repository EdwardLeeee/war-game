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
  Stance,
  UnitFlag,
  UnitType,
} from "../protocol.ts";
import { clamp, DIR16_X, DIR16_Y, dir16, idiv } from "./fixed.ts";
import type { Fog } from "./fog.ts";
import { type FieldCache, buildingKey, cellsAround } from "./paths.ts";
import {
  AGGRO_RANGE,
  ARRIVE_DISTANCE,
  BUILDINGS,
  DIRECT_STEER,
  LEASH,
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
import { steerDirect, steerTo } from "./steer.ts";
import type { World } from "./world.ts";

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
  private attacking = new Uint8Array(256);
  private unitDamage = new Int32Array(256);
  private buildingDamage = new Int32Array(64);
  private newX = new Int32Array(256);
  private newY = new Int32Array(256);
  private deadUnits = new Uint8Array(256);
  private deadBuildings = new Uint8Array(64);

  constructor(size: number) {
    this.cellHead = new Int32Array(size * size);
  }

  private fit(n: number, nb: number): void {
    if (this.cellNext.length < n) {
      const c = Math.max(n, this.cellNext.length * 2);
      this.cellNext = new Int32Array(c);
      this.attacking = new Uint8Array(c);
      this.unitDamage = new Int32Array(c);
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
          if (d2 < best || (d2 === best && u.id[j] < bestId)) {
            best = d2;
            bestId = u.id[j];
          }
        }
      }
    }
    if (bestId >= 0) return bestId;
    const b = w.buildings.col;
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.owner[s] === me) continue;
      const d2 = rectDist2(mx, my, b.cellX[s], b.cellY[s], BUILDINGS[b.type[s]].size);
      if (d2 > r2) continue;
      const bx = (b.cellX[s] << CELL_SHIFT) + 512;
      const by = (b.cellY[s] << CELL_SHIFT) + 512;
      if (!this.sees(fog, me, bx, by, n)) continue;
      if (d2 < best || (d2 === best && b.id[s] < bestId)) {
        best = d2;
        bestId = b.id[s];
      }
    }
    return bestId;
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
    } else if ((w.tick + u.id[i]) % RETARGET_EVERY === 0) {
      const hold = order === Order.None && u.stance[i] === Stance.Hold;
      tid = this.findTarget(w, fog, i, hold ? info.range : Math.max(AGGRO_RANGE, info.range));
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
      const dx = u.orderX[i] - u.x[i];
      const dy = u.orderY[i] - u.y[i];
      if (dx * dx + dy * dy <= ARRIVE_DISTANCE * ARRIVE_DISTANCE) {
        this.arrive(w, i);
        return;
      }
      const sp = u.speedCap[i] > 0 ? Math.min(u.speedCap[i], info.speed) : info.speed;
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

  private arrive(w: World, i: number): void {
    const u = w.units.col;
    u.order[i] = Order.None;
    u.orderTarget[i] = -1;
    u.group[i] = -1;
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
      for (let y = Math.max(cy - 1, 0); y <= Math.min(cy + 1, n - 1); y++) {
        for (let x = Math.max(cx - 1, 0); x <= Math.min(cx + 1, n - 1); x++) {
          for (let j = this.cellHead[y * n + x]; j >= 0; j = this.cellNext[j]) {
            if (j === i || u.action[j] === Action.Garrisoned) continue;
            const dx = xi - u.x[j];
            const dy = yi - u.y[j];
            if (dx >= SEPARATION || dx <= -SEPARATION || dy >= SEPARATION || dy <= -SEPARATION) continue;
            if (dx * dx + dy * dy >= sep2) continue;
            const k = dx === 0 && dy === 0 ? (u.id[i] < u.id[j] ? 0 : 8) : dir16(dx, dy);
            px += idiv(DIR16_X[k] * PUSH, CELL);
            py += idiv(DIR16_Y[k] * PUSH, CELL);
          }
        }
      }
      px = clamp(px, -MAX_PUSH, MAX_PUSH);
      py = clamp(py, -MAX_PUSH, MAX_PUSH);
      let tx = clamp(xi + u.vx[i] + px, 0, max - 1);
      let ty = clamp(yi + u.vy[i] + py, 0, max - 1);
      // Wall sliding: try the larger component first; on a tie player 1 tries y first, the
      // mirror image of player 0 trying x first.
      const ax = Math.abs(tx - xi);
      const ay = Math.abs(ty - yi);
      if (ax > ay || (ax === ay && u.owner[i] !== 1)) {
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
    this.buildingDamage.fill(0, 0, w.buildings.count);
    for (let i = 0; i < count; i++) {
      if (u.cooldown[i] > 0) u.cooldown[i]--;
      if (this.attacking[i] === 0 || u.cooldown[i] > 0) continue;
      const tid = u.target[i];
      const info = UNITS[u.type[i]];
      const ts = w.unit(tid);
      if (ts >= 0) {
        this.unitDamage[ts] += damage(info.attack, u.type[i], u.type[ts]);
      } else {
        const bs = w.building(tid);
        if (bs >= 0) this.buildingDamage[bs] += info.attack;
      }
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
      for (let j = 0; j < count; j++) {
        if (u.owner[j] === b.owner[s] || u.action[j] === Action.Garrisoned) continue;
        if (b.owner[s] !== NEUTRAL && fog.visible[b.owner[s]][(u.y[j] >> CELL_SHIFT) * n + (u.x[j] >> CELL_SHIFT)] !== 1) continue;
        const d2 = rectDist2(u.x[j], u.y[j], b.cellX[s], b.cellY[s], size);
        if (d2 < best) {
          best = d2;
          bestSlot = j;
        }
      }
      if (bestSlot < 0) continue;
      const arrows = type === BuildingType.MainCity ? 1 + Math.min(b.garrisoned[s], MAIN_ARROW.extraMax) : 1;
      this.unitDamage[bestSlot] += arrow.damage * arrows;
      b.target[s] = u.id[bestSlot];
      b.cooldown[s] = arrow.cooldown;
    }

    const hurt: Hurt[] = [];
    for (let i = 0; i < count; i++) {
      const dmg = this.unitDamage[i];
      if (dmg === 0) continue;
      u.hp[i] -= dmg;
      u.lastHurt[i] = w.tick;
      hurt.push({ owner: u.owner[i], x: u.x[i], y: u.y[i], id: u.id[i] });
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

  // --- deaths ----------------------------------------------------------------------------

  /**
   * Removes units and buildings at 0 hp. A fallen building lets out the farmers hidden in it
   * (`release`), no longer blocks its cells, and a fallen main city ends the game.
   */
  removeDead(w: World, release: (slot: number) => void): void {
    const u = w.units.col;
    const b = w.buildings.col;
    let anyUnit = false;
    for (let i = 0; i < w.units.count; i++) {
      this.deadUnits[i] = u.hp[i] <= 0 ? 1 : 0;
      if (this.deadUnits[i] === 1) {
        anyUnit = true;
        w.unitSlot[u.id[i]] = -1;
        if (u.owner[i] < PLAYER_COUNT) w.lost[u.owner[i] * 5 + u.type[i]]++;
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

/** Damage after the attacker-vs-target multiplier (integer, at least 1). */
export function damage(attack: number, attacker: number, target: number): number {
  return Math.max(1, idiv(attack * MULT_NUM[attacker][target], MULT_DEN[attacker][target]));
}

/** Squared fixed-point distance from a point to a building's footprint (0 inside). */
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

