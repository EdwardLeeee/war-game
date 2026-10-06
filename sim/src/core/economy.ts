// The economy (GDD sections 3, 4, 8): farmers gathering, carrying, building, repairing and
// hiding (recall), the economy ratio and auto-repair that hand idle farmers work, and
// training. Tick order (game.ts): `periodic` before combat decisions; `decide` for farmers
// with a work order during the unit decisions; `work` after attacks (progress for the
// farmers that `decide` put at their work); `produce` after deaths.
//
// Ties in every "nearest" choice break toward the owner's spawn before ids or cells, so the
// mirror-image situation of the other player resolves the mirror-image way.

import {
  Action,
  BuildingType,
  CELL,
  CELL_SHIFT,
  NodeKind,
  Order,
  PLAYER_COUNT,
  Resource,
  type SimEvent,
  TICKS_PER_SECOND,
  UnitFlag,
  UnitType,
} from "../protocol.ts";
import { toCanon } from "../frame.ts";
import { isqrt } from "./fixed.ts";
import type { Fog } from "./fog.ts";
import { type FieldCache, buildingKey, cellsAround, dropKey, nearestWalkable, nodeKey } from "./paths.ts";
import {
  AUTO_REPAIR_RANGE,
  BERRIES_PER_MINUTE,
  BUILDERS_MAX,
  BUILDINGS,
  CARRY,
  CROWD_PENALTY,
  ECO_EVERY,
  GATHER_PER_MINUTE,
  GATHER_UNIT,
  MAIN_CITY_REPAIR_LOCK,
  NEXT_NODE_RADIUS,
  REPAIR_PER_SECOND,
  UNITS,
  WORK_REACH,
} from "./rules.ts";
import { steerTo } from "./steer.ts";
import { rectDist2 } from "./units.ts";
import { BLOCK_NODE, UNIT_KINDS, type World } from "./world.ts";

/** Farmer task phases (unit column `task`). */
export const Task = { Go: 0, Return: 1 } as const;

const S = TICKS_PER_SECOND;
const center = (c: number) => (c << CELL_SHIFT) + 512;

export function nodeResource(kind: number): Resource {
  return kind === NodeKind.Tree
    ? Resource.Wood
    : kind === NodeKind.GoldMine
      ? Resource.Gold
      : kind === NodeKind.CrystalVein
        ? Resource.Crystal
        : Resource.Food;
}

/** Walkable cells touching a node's cell (8-neighbourhood). */
export function nodeGoals(w: World, node: number): number[] {
  const n = w.size;
  const out: number[] = [];
  const x0 = w.nodeX[node];
  const y0 = w.nodeY[node];
  for (let y = y0 - 1; y <= y0 + 1; y++) {
    for (let x = x0 - 1; x <= x0 + 1; x++) {
      if ((x !== x0 || y !== y0) && w.walkable(x, y)) out.push(y * n + x);
    }
  }
  return out;
}

/** A node a farmer can work: not used up, with a walkable cell beside it. */
export function nodeOpen(w: World, node: number): boolean {
  if (node < 0 || node >= w.nodeAmount.length || w.nodeAmount[node] <= 0) return false;
  const x0 = w.nodeX[node];
  const y0 = w.nodeY[node];
  for (let y = y0 - 1; y <= y0 + 1; y++) {
    for (let x = x0 - 1; x <= x0 + 1; x++) {
      if ((x !== x0 || y !== y0) && w.walkable(x, y)) return true;
    }
  }
  return false;
}

function footprintCells(w: World, bs: number): number[] {
  const b = w.buildings.col;
  const size = BUILDINGS[b.type[bs]].size;
  const out: number[] = [];
  for (let y = b.cellY[bs]; y < b.cellY[bs] + size; y++) {
    for (let x = b.cellX[bs]; x < b.cellX[bs] + size; x++) out.push(y * w.size + x);
  }
  return out;
}

/** Cells a farmer walks to for a building: onto a farm, beside anything else. */
function buildingGoals(w: World, bs: number): () => number[] {
  const b = w.buildings.col;
  if (b.type[bs] === BuildingType.Farm) return () => footprintCells(w, bs);
  return () => cellsAround(w, b.cellX[bs], b.cellY[bs], BUILDINGS[b.type[bs]].size);
}

function buildingCentre(w: World, bs: number): [number, number] {
  const b = w.buildings.col;
  const half = (BUILDINGS[b.type[bs]].size << CELL_SHIFT) >> 1;
  return [(b.cellX[bs] << CELL_SHIFT) + half, (b.cellY[bs] << CELL_SHIFT) + half];
}

function distToBuilding2(w: World, i: number, bs: number): number {
  const u = w.units.col;
  const b = w.buildings.col;
  return rectDist2(u.x[i], u.y[i], b.cellX[bs], b.cellY[bs], BUILDINGS[b.type[bs]].size);
}

export type Emit = (to: number, ev: SimEvent) => void;

export class Economy {
  private readonly fog: Fog;
  private readonly emit: Emit;
  /** Per building slot: builders / repairers that added progress this tick. */
  private helpers = new Int32Array(64);
  /** Per node: farmers gathering it (economy pass). */
  private nodeLoad: Int32Array;
  /** Per building slot: 1 when a farmer works this farm (economy pass). */
  private farmTaken = new Uint8Array(64);

  constructor(w: World, fog: Fog, emit: Emit) {
    this.fog = fog;
    this.emit = emit;
    this.nodeLoad = new Int32Array(w.nodeAmount.length);
  }

  // --- orders --------------------------------------------------------------------------

  idle(w: World, i: number): void {
    const u = w.units.col;
    u.order[i] = Order.None;
    u.orderTarget[i] = -1;
    u.onFarm[i] = 0;
    u.task[i] = Task.Go;
    u.group[i] = -1;
    u.speedCap[i] = 0;
    u.anchorX[i] = u.x[i];
    u.anchorY[i] = u.y[i];
    if (u.action[i] !== Action.Garrisoned) u.action[i] = Action.Idle;
  }

  /** Gather a node, or work a farm (farm = true, target = building id). Carried goods of another kind are dropped. */
  gather(w: World, i: number, target: number, farm: boolean): void {
    const u = w.units.col;
    const r = farm ? Resource.Food : nodeResource(w.nodeKind[target]);
    if (u.carryAmount[i] > 0 && u.carryKind[i] !== r) {
      u.carryAmount[i] = 0;
      u.carryKind[i] = -1;
    }
    this.work(w, i, Order.Gather, target);
    u.onFarm[i] = farm ? 1 : 0;
  }

  /** Build, Repair, Gather or Recall `target`, from the Go phase. */
  work(w: World, i: number, order: number, target: number): void {
    const u = w.units.col;
    u.order[i] = order;
    u.orderTarget[i] = target;
    u.onFarm[i] = 0;
    u.task[i] = Task.Go;
    u.acc[i] = 0;
    u.target[i] = -1;
    u.group[i] = -1;
    u.speedCap[i] = 0;
    u.stuck[i] = 0;
  }

  /** Is a farmer other than `except` already working this farm? */
  farmTakenBy(w: World, farmId: number, except: number): boolean {
    const u = w.units.col;
    for (let s = 0; s < w.units.count; s++) {
      if (s !== except && u.order[s] === Order.Gather && u.onFarm[s] === 1 && u.orderTarget[s] === farmId) return true;
    }
    return false;
  }

  /** Lets a hidden farmer, or a soldier hiding in a building (round 7), out where it went in. */
  release(w: World, i: number): void {
    const u = w.units.col;
    if (u.action[i] !== Action.Garrisoned) return;
    const farmer = u.type[i] === UnitType.Farmer;
    // A calibrating mage keeps its building in prevTarget (units.ts, startCast).
    const bs = w.building(!farmer && u.order[i] === Order.Cast ? u.prevTarget[i] : u.orderTarget[i]);
    const b = w.buildings.col;
    if (bs >= 0 && farmer && b.garrisoned[bs] > 0) b.garrisoned[bs]--;
    if (bs >= 0 && !farmer && b.soldiers[bs] > 0) b.soldiers[bs]--;
    if (!farmer) {
      u.castProgress[i] = 0;
      u.prevOrder[i] = Order.None;
      u.prevTarget[i] = -1;
      u.target[i] = -1;
    }
    u.action[i] = Action.Idle;
    u.order[i] = Order.None;
    u.orderTarget[i] = -1;
    u.anchorX[i] = u.x[i];
    u.anchorY[i] = u.y[i];
  }

  // --- recall --------------------------------------------------------------------------

  /** Nearest own finished shelter with room (counting farmers already on their way), or -1. */
  private shelterFor(w: World, i: number): number {
    const u = w.units.col;
    const b = w.buildings.col;
    const p = u.owner[i];
    let best = -1;
    let bestD = 0;
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.owner[s] !== p || b.progress[s] < 1000) continue;
      const room = BUILDINGS[b.type[s]].shelter - b.garrisoned[s];
      if (room <= 0) continue;
      let coming = 0;
      for (let k = 0; k < w.units.count; k++) {
        if (k !== i && u.order[k] === Order.Recall && u.orderTarget[k] === b.id[s] && u.action[k] !== Action.Garrisoned) coming++;
      }
      if (coming >= room) continue;
      const d = distToBuilding2(w, i, s);
      if (best < 0 || d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best < 0 ? -1 : b.id[best];
  }

  /** Sends a farmer to hide, remembering the work it was doing. */
  recallFarmer(w: World, i: number): void {
    const u = w.units.col;
    const o = u.order[i];
    if (o === Order.Gather || o === Order.Build || o === Order.Repair) {
      u.prevOrder[i] = o;
      u.prevTarget[i] = u.orderTarget[i];
      u.prevOnFarm[i] = u.onFarm[i];
    } else if (o !== Order.Recall) {
      u.prevOrder[i] = Order.None;
      u.prevTarget[i] = -1;
      u.prevOnFarm[i] = 0;
    }
    this.work(w, i, Order.Recall, this.shelterFor(w, i));
  }

  setRecall(w: World, p: number, on: boolean): void {
    const u = w.units.col;
    w.recall[p] = on ? 1 : 0;
    for (let i = 0; i < w.units.count; i++) {
      if (u.owner[i] !== p || u.type[i] !== UnitType.Farmer) continue;
      if (on) {
        if (u.action[i] !== Action.Garrisoned) this.recallFarmer(w, i);
        continue;
      }
      if (u.action[i] !== Action.Garrisoned && u.order[i] !== Order.Recall) continue;
      this.release(w, i);
      if (u.prevOrder[i] !== Order.None) {
        this.work(w, i, u.prevOrder[i], u.prevTarget[i]);
        u.onFarm[i] = u.prevOnFarm[i];
      } else {
        this.idle(w, i);
      }
      u.prevOrder[i] = Order.None;
      u.prevTarget[i] = -1;
      u.prevOnFarm[i] = 0;
    }
  }

  // --- finding work --------------------------------------------------------------------

  /**
   * Best node of `kind` the player knows: least distance plus CROWD_PENALTY per farmer
   * already there, within `radius` cells of (cx, cy) when radius > 0; ties to the node
   * nearer the owner's spawn, then the first in the owner's canonical frame (frame.ts).
   * Returns [node, score] or [-1, 0].
   */
  private bestNode(w: World, i: number, kind: number, cx: number, cy: number, radius: number, crowd: boolean): [number, number] {
    const u = w.units.col;
    const p = u.owner[i];
    const seen = this.fog.nodeSeen[p];
    const spawn = w.map.spawns[p];
    const frame = w.map.frames[p];
    let best = -1;
    let bestScore = 0;
    let bestSpawn = 0;
    let bestKey = 0;
    for (let k = 0; k < w.nodeAmount.length; k++) {
      if (w.nodeKind[k] !== kind || seen[k] < 0) continue;
      const nx = w.nodeX[k];
      const ny = w.nodeY[k];
      if (radius > 0 && (nx - cx) * (nx - cx) + (ny - cy) * (ny - cy) > radius * radius) continue;
      if (!nodeOpen(w, k)) continue;
      const dx = center(nx) - u.x[i];
      const dy = center(ny) - u.y[i];
      const score = isqrt(dx * dx + dy * dy) + (crowd ? this.nodeLoad[k] * CROWD_PENALTY : 0);
      const sp = (nx - spawn.cellX) * (nx - spawn.cellX) + (ny - spawn.cellY) * (ny - spawn.cellY);
      const c = toCanon(frame, nx, ny);
      const key = c.v * w.size + c.u;
      if (best < 0 || score < bestScore || (score === bestScore && (sp < bestSpawn || (sp === bestSpawn && key < bestKey)))) {
        best = k;
        bestScore = score;
        bestSpawn = sp;
        bestKey = key;
      }
    }
    return [best, bestScore];
  }

  /** After a node runs out: the nearest node of the same kind near it, or -1. */
  private nextNode(w: World, i: number, node: number): number {
    return this.bestNode(w, i, w.nodeKind[node], w.nodeX[node], w.nodeY[node], NEXT_NODE_RADIUS, false)[0];
  }

  /** Nearest free own finished farm: [building slot, distance] or [-1, 0]. */
  private freeFarm(w: World, i: number): [number, number] {
    const u = w.units.col;
    const b = w.buildings.col;
    let best = -1;
    let bestD = 0;
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.owner[s] !== u.owner[i] || b.type[s] !== BuildingType.Farm || b.progress[s] < 1000 || this.farmTaken[s] === 1) continue;
      const [fx, fy] = buildingCentre(w, s);
      const d = isqrt((fx - u.x[i]) * (fx - u.x[i]) + (fy - u.y[i]) * (fy - u.y[i]));
      if (best < 0 || d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return [best, bestD];
  }

  /** Puts an idle farmer on resource r if there is a source; false if none. */
  private assign(w: World, i: number, r: Resource): boolean {
    if (r === Resource.Food) {
      const [farm, fd] = this.freeFarm(w, i);
      const [bush, bd] = this.bestNode(w, i, NodeKind.Berries, 0, 0, 0, true);
      if (farm >= 0 && (bush < 0 || fd <= bd)) {
        this.farmTaken[farm] = 1;
        this.gather(w, i, w.buildings.col.id[farm], true);
        return true;
      }
      if (bush < 0) return false;
      this.nodeLoad[bush]++;
      this.gather(w, i, bush, false);
      return true;
    }
    const [node] = this.bestNode(w, i, r === Resource.Wood ? NodeKind.Tree : NodeKind.GoldMine, 0, 0, 0, true);
    if (node < 0) return false;
    this.nodeLoad[node]++;
    this.gather(w, i, node, false);
    return true;
  }

  /** Own finished damaged building within AUTO_REPAIR_RANGE with room for another repairer, or -1. */
  private repairTarget(w: World, i: number): number {
    const u = w.units.col;
    const b = w.buildings.col;
    const reach = AUTO_REPAIR_RANGE * CELL;
    let best = -1;
    let bestD = 0;
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.owner[s] !== u.owner[i] || b.progress[s] < 1000 || b.hp[s] >= BUILDINGS[b.type[s]].hp) continue;
      const d = distToBuilding2(w, i, s);
      if (d > reach * reach) continue;
      let crew = 0;
      for (let k = 0; k < w.units.count; k++) if (u.order[k] === Order.Repair && u.orderTarget[k] === b.id[s]) crew++;
      if (crew >= BUILDERS_MAX) continue;
      if (best < 0 || d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best < 0 ? -1 : b.id[best];
  }

  /**
   * Every ECO_EVERY ticks, per player, idle farmers get work: during recall they go and
   * hide; otherwise they repair a damaged building nearby, and then, with the economy ratio
   * on, go to the resource furthest below its share (ties: food, wood, gold). Crystal is
   * never assigned: the vein is by hand only. Farmers the player placed (`stay`) are left
   * where they are, except by recall. Then the farmers already at work follow the ratio too
   * (`rebalance`, operations round, D-050).
   */
  periodic(w: World): void {
    if (w.tick % ECO_EVERY !== 0) return;
    const u = w.units.col;
    if (this.farmTaken.length < w.buildings.count) this.farmTaken = new Uint8Array(w.buildings.count * 2);
    for (let p = 0; p < PLAYER_COUNT; p++) {
      const idle: number[] = [];
      for (let i = 0; i < w.units.count; i++) {
        if (u.owner[i] !== p || u.type[i] !== UnitType.Farmer || u.action[i] === Action.Garrisoned) continue;
        if (u.order[i] === Order.None) {
          // Idle, it is no longer on the job it was sent to by hand.
          u.flags[i] &= ~UnitFlag.HandPicked;
          idle.push(i);
        } else if (w.recall[p] === 1 && u.order[i] === Order.Recall && u.orderTarget[i] < 0) {
          u.orderTarget[i] = this.shelterFor(w, i);
        }
      }
      if (w.recall[p] === 1) {
        for (const i of idle) this.recallFarmer(w, i);
        continue;
      }
      // Farmers the player placed wait where they are (GDD section 4).
      const rest: number[] = [];
      for (const i of idle) {
        if (u.stay[i] === 1) continue;
        const t = this.repairTarget(w, i);
        if (t >= 0) this.work(w, i, Order.Repair, t);
        else rest.push(i);
      }
      if (w.ecoOn[p] === 0) continue;

      // Current shares.
      this.nodeLoad.fill(0);
      this.farmTaken.fill(0);
      const count = [0, 0, 0];
      for (let i = 0; i < w.units.count; i++) {
        if (u.order[i] !== Order.Gather) continue;
        const t = u.orderTarget[i];
        if (u.onFarm[i] === 1) {
          const fs = w.building(t);
          if (fs >= 0) this.farmTaken[fs] = 1;
        } else if (t >= 0) {
          this.nodeLoad[t]++;
        }
        if (u.owner[i] !== p) continue;
        const r = this.gathering(w, i);
        if (r >= 0 && r < 3) count[r]++;
      }
      const total = count[0] + count[1] + count[2] + rest.length;
      const ratio = [w.ecoRatio[p * 3], w.ecoRatio[p * 3 + 1], w.ecoRatio[p * 3 + 2]];
      for (const i of rest) {
        const order = [0, 1, 2].sort((a, c) => ratio[c] * total - 100 * count[c] - (ratio[a] * total - 100 * count[a]) || a - c);
        for (const r of order) {
          if (this.assign(w, i, r as Resource)) {
            count[r]++;
            break;
          }
        }
      }
      this.rebalance(w, p, count, ratio);
    }
  }

  /** The resource farmer i is gathering (Resource), from its job or else what it carries; -1 if none. */
  private gathering(w: World, i: number): number {
    const u = w.units.col;
    const t = u.orderTarget[i];
    return u.onFarm[i] === 1 ? Resource.Food : t >= 0 ? nodeResource(w.nodeKind[t]) : u.carryKind[i];
  }

  /**
   * The economy ratio for farmers already at work (operations round, D-050): while some
   * resource is more than one farmer off its share of all the player's food, wood and gold
   * farmers, one farmer moves from the resource furthest above its share to the one furthest
   * below, the farmer with the shortest way to its new work. Within one farmer of the ratio
   * nobody moves, so a farmer is not sent back and forth. Never moved: farmers sent by hand
   * (UnitFlag.HandPicked), on the crystal vein (not a share), placed to stay, building,
   * repairing or hiding (none of them is gathering a share); farmers sent by hand still count.
   */
  private rebalance(w: World, p: number, count: number[], ratio: number[]): void {
    const n = count[0] + count[1] + count[2];
    for (let moves = 0; moves < n; moves++) {
      // Hundredths of a farmer above (+) or below (-) each share.
      const off = [0, 1, 2].map((r) => 100 * count[r] - ratio[r] * n);
      if (Math.max(off[0], off[1], off[2]) <= 100 && Math.min(off[0], off[1], off[2]) >= -100) return;
      const to = [0, 1, 2].reduce((a, r) => (off[r] < off[a] ? r : a), 0);
      if (!this.anyWork(w, p, to as Resource)) return;
      const from = [0, 1, 2].filter((r) => r !== to && off[r] > 0).sort((a, c) => off[c] - off[a] || a - c);
      let moved = false;
      for (const r of from) {
        const i = this.mover(w, p, r, to as Resource);
        if (i < 0) continue;
        this.leave(w, i);
        if (!this.assign(w, i, to as Resource)) return;
        count[r]--;
        count[to]++;
        moved = true;
        break;
      }
      if (!moved) return;
    }
  }

  /**
   * The farmer of player p gathering resource `from` that may be moved by the ratio: empty-handed
   * first (a farmer moved to another resource drops what it carries), then the shortest way to
   * work on `to`, then the lower id; -1 if none.
   */
  private mover(w: World, p: number, from: number, to: Resource): number {
    const u = w.units.col;
    let best = -1;
    let bestD = 0;
    let bestFull = 0;
    for (let i = 0; i < w.units.count; i++) {
      if (u.owner[i] !== p || u.type[i] !== UnitType.Farmer || u.order[i] !== Order.Gather) continue;
      if ((u.flags[i] & UnitFlag.HandPicked) !== 0 || u.action[i] === Action.Garrisoned) continue;
      if (this.gathering(w, i) !== from) continue;
      const d = this.wayTo(w, i, to);
      if (d < 0) continue;
      const full = u.carryAmount[i] > 0 ? 1 : 0;
      if (best < 0 || full < bestFull || (full === bestFull && (d < bestD || (d === bestD && u.id[i] < u.id[best])))) {
        best = i;
        bestD = d;
        bestFull = full;
      }
    }
    return best;
  }

  /** Is there any work on resource r for player p: a free own farm or berries for food, a known open node otherwise? */
  private anyWork(w: World, p: number, r: Resource): boolean {
    if (r === Resource.Food) {
      const b = w.buildings.col;
      for (let s = 0; s < w.buildings.count; s++) {
        if (b.owner[s] === p && b.type[s] === BuildingType.Farm && b.progress[s] >= 1000 && this.farmTaken[s] === 0) return true;
      }
    }
    const kind = r === Resource.Food ? NodeKind.Berries : r === Resource.Wood ? NodeKind.Tree : NodeKind.GoldMine;
    const seen = this.fog.nodeSeen[p];
    for (let k = 0; k < w.nodeAmount.length; k++) if (w.nodeKind[k] === kind && seen[k] >= 0 && nodeOpen(w, k)) return true;
    return false;
  }

  /** How far farmer i would walk to work on resource r (as `assign` would choose), or -1 if there is no such work. */
  private wayTo(w: World, i: number, r: Resource): number {
    if (r === Resource.Food) {
      const [farm, fd] = this.freeFarm(w, i);
      const [bush, bd] = this.bestNode(w, i, NodeKind.Berries, 0, 0, 0, true);
      if (farm >= 0 && (bush < 0 || fd <= bd)) return fd;
      return bush < 0 ? -1 : bd;
    }
    const [node, d] = this.bestNode(w, i, r === Resource.Wood ? NodeKind.Tree : NodeKind.GoldMine, 0, 0, 0, true);
    return node < 0 ? -1 : d;
  }

  /** Farmer i stops working its node or farm (for the shares counted this period). */
  private leave(w: World, i: number): void {
    const u = w.units.col;
    const t = u.orderTarget[i];
    if (u.onFarm[i] === 1) {
      const fs = w.building(t);
      if (fs >= 0) this.farmTaken[fs] = 0;
    } else if (t >= 0 && this.nodeLoad[t] > 0) {
      this.nodeLoad[t]--;
    }
  }

  // --- decisions -------------------------------------------------------------------------

  decide(w: World, fields: FieldCache, i: number): void {
    const u = w.units.col;
    switch (u.order[i]) {
      case Order.Gather:
        this.decideGather(w, fields, i);
        return;
      case Order.Build:
      case Order.Repair:
        this.decideBuild(w, fields, i);
        return;
      case Order.Recall:
        this.decideRecall(w, fields, i);
        return;
    }
  }

  private decideGather(w: World, fields: FieldCache, i: number): void {
    const u = w.units.col;
    const b = w.buildings.col;
    const p = u.owner[i];
    const speed = UNITS[UnitType.Farmer].speed;
    if (u.carryAmount[i] >= CARRY) u.task[i] = Task.Return;
    if (u.task[i] === Task.Go) {
      const t = u.orderTarget[i];
      let lost = false;
      if (u.onFarm[i] === 1) {
        const fs = w.building(t);
        lost = fs < 0 || b.owner[fs] !== p || b.progress[fs] < 1000;
      } else if (t < 0 || !nodeOpen(w, t)) {
        const next = t < 0 ? -1 : this.nextNode(w, i, t);
        if (next >= 0) u.orderTarget[i] = next;
        else lost = true;
      }
      if (lost) {
        u.orderTarget[i] = -1;
        u.onFarm[i] = 0;
        if (u.carryAmount[i] > 0) u.task[i] = Task.Return;
        else {
          this.idle(w, i);
          return;
        }
      }
    }

    if (u.task[i] === Task.Return) {
      if (u.carryAmount[i] === 0) {
        u.task[i] = Task.Go;
        if (u.orderTarget[i] < 0) this.idle(w, i);
        return;
      }
      const r = u.carryKind[i];
      const [near, nearD] = this.nearestDrop(w, i, r);
      if (near < 0) {
        u.action[i] = Action.Idle;
        return;
      }
      if (nearD <= WORK_REACH * WORK_REACH) {
        u.working[i] = 1;
        u.action[i] = Action.Idle;
        return;
      }
      const [tx, ty] = buildingCentre(w, near);
      steerTo(w, fields, i, tx, ty, dropKey(p, r), speed, () => this.dropGoals(w, p, r), true);
      return;
    }

    const t = u.orderTarget[i];
    if (u.onFarm[i] === 1) {
      const fs = w.building(t);
      const [tx, ty] = buildingCentre(w, fs);
      if (distToBuilding2(w, i, fs) === 0) {
        u.working[i] = 1;
        u.action[i] = Action.Gather;
        return;
      }
      steerTo(w, fields, i, tx, ty, buildingKey(t), speed, buildingGoals(w, fs));
      return;
    }
    const tx = center(w.nodeX[t]);
    const ty = center(w.nodeY[t]);
    if (rectDist2(u.x[i], u.y[i], w.nodeX[t], w.nodeY[t], 1) <= WORK_REACH * WORK_REACH) {
      u.working[i] = 1;
      u.action[i] = Action.Gather;
      return;
    }
    steerTo(w, fields, i, tx, ty, nodeKey(t), speed, () => nodeGoals(w, t));
  }

  /** Build and Repair: walk to the building, then work while in reach. */
  private decideBuild(w: World, fields: FieldCache, i: number): void {
    const u = w.units.col;
    const b = w.buildings.col;
    const t = u.orderTarget[i];
    const bs = w.building(t);
    if (bs < 0 || b.owner[bs] !== u.owner[i]) {
      this.idle(w, i);
      return;
    }
    const build = u.order[i] === Order.Build;
    if (build && b.progress[bs] >= 1000) {
      this.afterBuild(w, i, bs);
      return;
    }
    if (!build && (b.progress[bs] < 1000 || b.hp[bs] >= BUILDINGS[b.type[bs]].hp)) {
      this.idle(w, i);
      return;
    }
    const [tx, ty] = buildingCentre(w, bs);
    if (distToBuilding2(w, i, bs) <= WORK_REACH * WORK_REACH) {
      u.working[i] = 1;
      u.action[i] = build ? Action.Build : Action.Repair;
      return;
    }
    steerTo(w, fields, i, tx, ty, buildingKey(t), UNITS[UnitType.Farmer].speed, buildingGoals(w, bs));
  }

  /**
   * A finished building's builders. Sent by a build without farmers: back to what it was
   * gathering if that is still there, otherwise to the economy ratio (idle). Otherwise: a farm
   * is farmed, a lumber camp or mine sends them to the nearest wood or gold.
   */
  private afterBuild(w: World, i: number, bs: number): void {
    const b = w.buildings.col;
    const u = w.units.col;
    if (u.autoBuild[i] === b.id[bs]) {
      const t = u.resumeTarget[i];
      const farm = u.resumeFarm[i] === 1;
      u.autoBuild[i] = -1;
      u.resumeTarget[i] = -1;
      u.resumeFarm[i] = 0;
      if (t >= 0) {
        const fs = farm ? w.building(t) : -1;
        if (farm && fs >= 0 && b.owner[fs] === u.owner[i] && b.progress[fs] >= 1000 && !this.farmTakenBy(w, t, i)) {
          this.gather(w, i, t, true);
          return;
        }
        if (!farm && nodeOpen(w, t)) {
          this.gather(w, i, t, false);
          return;
        }
      }
      this.idle(w, i);
      return;
    }
    const type = b.type[bs];
    if (type === BuildingType.Farm && !this.farmTakenBy(w, b.id[bs], i)) {
      this.gather(w, i, b.id[bs], true);
      return;
    }
    if (type === BuildingType.LumberCamp || type === BuildingType.Mine) {
      const kind = type === BuildingType.LumberCamp ? NodeKind.Tree : NodeKind.GoldMine;
      const size = BUILDINGS[type].size;
      const [node] = this.bestNode(w, i, kind, b.cellX[bs] + (size >> 1), b.cellY[bs] + (size >> 1), NEXT_NODE_RADIUS, false);
      if (node >= 0) {
        this.gather(w, i, node, false);
        return;
      }
    }
    this.idle(w, i);
  }

  private decideRecall(w: World, fields: FieldCache, i: number): void {
    const u = w.units.col;
    const b = w.buildings.col;
    const p = u.owner[i];
    let bs = w.building(u.orderTarget[i]);
    if (bs >= 0 && (b.owner[bs] !== p || b.progress[bs] < 1000)) bs = -1;
    if (bs < 0) u.orderTarget[i] = -1;
    const speed = UNITS[UnitType.Farmer].speed;
    // No room anywhere yet: wait beside the main city.
    const dest = bs >= 0 ? bs : w.mainCity(p);
    if (dest < 0) {
      u.action[i] = Action.Idle;
      return;
    }
    if (distToBuilding2(w, i, dest) <= WORK_REACH * WORK_REACH) {
      if (bs >= 0) u.working[i] = 1;
      u.action[i] = Action.Idle;
      return;
    }
    const [tx, ty] = buildingCentre(w, dest);
    steerTo(w, fields, i, tx, ty, buildingKey(b.id[dest]), speed, buildingGoals(w, dest));
  }

  /** Nearest own finished building that accepts r: [slot, squared distance] or [-1, 0]. */
  private nearestDrop(w: World, i: number, r: number): [number, number] {
    const u = w.units.col;
    const b = w.buildings.col;
    let best = -1;
    let bestD = 0;
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.owner[s] !== u.owner[i] || b.progress[s] < 1000 || !BUILDINGS[b.type[s]].accepts.includes(r as Resource)) continue;
      const d = distToBuilding2(w, i, s);
      if (best < 0 || d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return [best, bestD];
  }

  private dropGoals(w: World, p: number, r: number): number[] {
    const b = w.buildings.col;
    const out: number[] = [];
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.owner[s] !== p || b.progress[s] < 1000 || !BUILDINGS[b.type[s]].accepts.includes(r as Resource)) continue;
      for (const c of cellsAround(w, b.cellX[s], b.cellY[s], BUILDINGS[b.type[s]].size)) out.push(c);
    }
    return out;
  }

  // --- work ------------------------------------------------------------------------------

  /** Progress for the farmers `decide` put at their work this tick, in id order. */
  workTick(w: World): void {
    const u = w.units.col;
    const b = w.buildings.col;
    if (this.helpers.length < w.buildings.count) this.helpers = new Int32Array(w.buildings.count * 2);
    this.helpers.fill(0, 0, w.buildings.count);
    for (let i = 0; i < w.units.count; i++) {
      if (u.working[i] !== 1 || u.hp[i] <= 0) continue;
      const p = u.owner[i];
      const t = u.orderTarget[i];
      switch (u.order[i]) {
        case Order.Gather: {
          if (u.task[i] === Task.Return) {
            const r = u.carryKind[i];
            w.res[p * 4 + r] += u.carryAmount[i];
            w.gathered[p * 4 + r] += u.carryAmount[i];
            u.carryAmount[i] = 0;
            u.carryKind[i] = -1;
            u.task[i] = Task.Go;
            if (t < 0) this.idle(w, i);
            break;
          }
          const farm = u.onFarm[i] === 1;
          const kind = farm ? -1 : w.nodeKind[t];
          const r = farm ? Resource.Food : nodeResource(kind);
          if (u.carryKind[i] !== r) {
            u.carryKind[i] = r;
            u.carryAmount[i] = 0;
          }
          u.acc[i] += kind === NodeKind.Berries ? BERRIES_PER_MINUTE : GATHER_PER_MINUTE[r];
          while (u.acc[i] >= GATHER_UNIT && u.carryAmount[i] < CARRY) {
            if (!farm) {
              if (w.nodeAmount[t] <= 0) break;
              w.nodeAmount[t]--;
              if (w.nodeAmount[t] === 0) this.deplete(w, t, p);
            }
            u.acc[i] -= GATHER_UNIT;
            u.carryAmount[i]++;
          }
          if (u.carryAmount[i] >= CARRY) u.task[i] = Task.Return;
          break;
        }
        case Order.Build: {
          const bs = w.building(t);
          if (bs < 0 || b.hp[bs] <= 0 || b.progress[bs] >= 1000 || this.helpers[bs] >= BUILDERS_MAX) break;
          this.helpers[bs]++;
          this.advance(w, bs);
          break;
        }
        case Order.Repair: {
          const bs = w.building(t);
          if (bs < 0 || b.hp[bs] <= 0 || this.helpers[bs] >= BUILDERS_MAX) break;
          const max = BUILDINGS[b.type[bs]].hp;
          if (b.hp[bs] >= max) break;
          // A main city under attack cannot be patched up on the spot: its repairers wait.
          if (b.type[bs] === BuildingType.MainCity && w.tick - b.lastHurt[bs] < MAIN_CITY_REPAIR_LOCK) break;
          this.helpers[bs]++;
          b.acc[bs] += REPAIR_PER_SECOND;
          while (b.acc[bs] >= S) {
            b.acc[bs] -= S;
            b.hp[bs]++;
          }
          if (b.hp[bs] >= max) {
            b.hp[bs] = max;
            b.acc[bs] = 0;
          }
          break;
        }
        case Order.Recall: {
          const bs = w.building(t);
          if (bs < 0) break;
          if (b.garrisoned[bs] < BUILDINGS[b.type[bs]].shelter) {
            b.garrisoned[bs]++;
            u.action[i] = Action.Garrisoned;
          } else {
            u.orderTarget[i] = this.shelterFor(w, i);
          }
          break;
        }
      }
    }
  }

  /** One builder-tick of construction: hp grows from 1 to full with the work done. */
  private advance(w: World, bs: number): void {
    const b = w.buildings.col;
    const info = BUILDINGS[b.type[bs]];
    const total = info.buildTicks;
    const before = Math.trunc(((info.hp - 1) * b.work[bs]) / total);
    b.work[bs]++;
    const after = Math.trunc(((info.hp - 1) * b.work[bs]) / total);
    b.hp[bs] = Math.min(info.hp, b.hp[bs] + after - before);
    if (b.work[bs] < total) {
      b.progress[bs] = Math.min(999, Math.trunc((b.work[bs] * 1000) / total));
      return;
    }
    b.progress[bs] = 1000;
    if (info.accepts.length > 0) w.dropVersion++;
    this.emit(b.owner[bs], { k: "building_done", id: b.id[bs], type: b.type[bs] as BuildingType });
  }

  private deplete(w: World, node: number, p: number): void {
    const c = w.nodeY[node] * w.size + w.nodeX[node];
    w.grid[c] &= ~BLOCK_NODE;
    w.openVersion++;
    this.emit(p, { k: "node_depleted", id: node });
  }

  // --- training --------------------------------------------------------------------------

  /** Advances every training queue; the head waits at 100% while the population is full. */
  produce(w: World): void {
    const b = w.buildings.col;
    const pop: number[] = [];
    const cap: number[] = [];
    for (let p = 0; p < PLAYER_COUNT; p++) {
      pop.push(w.population(p));
      cap.push(w.populationCap(p));
    }
    for (let s = 0; s < w.buildings.count; s++) {
      if (b.queueLength[s] === 0 || b.progress[s] < 1000 || b.hp[s] <= 0) continue;
      const p = b.owner[s];
      const type = b.q0[s] as UnitType;
      const info = UNITS[type];
      if (b.queueTicks[s] < info.trainTicks) b.queueTicks[s]++;
      if (b.queueTicks[s] < info.trainTicks || pop[p] + info.population > cap[p]) continue;
      this.spawn(w, s, type);
      pop[p] += info.population;
      shiftQueue(w, s, 0);
      b.queueTicks[s] = 0;
    }
  }

  private spawn(w: World, bs: number, type: UnitType): void {
    const b = w.buildings.col;
    const u = w.units.col;
    const n = w.size;
    const p = b.owner[bs];
    const size = BUILDINGS[b.type[bs]].size;
    const spawn = w.map.spawns[p];
    const rallied = b.rallyX[bs] >= 0;
    const aimX = rallied ? b.rallyX[bs] >> CELL_SHIFT : n >> 1;
    const aimY = rallied ? b.rallyY[bs] >> CELL_SHIFT : n >> 1;
    let cell = -1;
    let bestD = 0;
    let bestS = 0;
    for (const c of cellsAround(w, b.cellX[bs], b.cellY[bs], size)) {
      const x = c % n;
      const y = Math.trunc(c / n);
      const d = (x - aimX) * (x - aimX) + (y - aimY) * (y - aimY);
      const sp = (x - spawn.cellX) * (x - spawn.cellX) + (y - spawn.cellY) * (y - spawn.cellY);
      if (cell < 0 || d < bestD || (d === bestD && sp < bestS)) {
        cell = c;
        bestD = d;
        bestS = sp;
      }
    }
    if (cell < 0) cell = nearestWalkable(w, b.cellX[bs], b.cellY[bs], spawn);
    const info = UNITS[type];
    const id = w.addUnit(p, type, center(cell % n), center(Math.trunc(cell / n)), info.hp);
    const i = w.unit(id);
    // A trained mage casts on its own from the start (D-026: the player found mages with
    // autocast off "of little use"); the `autocast` command switches it off.
    if (type === UnitType.Mage) u.flags[i] |= UnitFlag.Autocast;
    w.trained[p * UNIT_KINDS + type]++;
    this.emit(p, { k: "unit_trained", id, type, building: b.id[bs] });

    if (type === UnitType.Farmer && w.recall[p] === 1) {
      this.recallFarmer(w, i);
      return;
    }
    if (!rallied) return;
    const rc = (b.rallyY[bs] >> CELL_SHIFT) * n + (b.rallyX[bs] >> CELL_SHIFT);
    if (type === UnitType.Farmer) {
      const node = w.nodeAt[rc];
      if (node >= 0 && nodeOpen(w, node)) {
        this.gather(w, i, node, false);
        return;
      }
      const fid = w.buildingAt[rc];
      const fs = w.building(fid);
      if (fs >= 0 && b.owner[fs] === p && b.type[fs] === BuildingType.Farm && b.progress[fs] >= 1000 && !this.farmTakenBy(w, fid, i)) {
        this.gather(w, i, fid, true);
        return;
      }
    }
    const goal = nearestWalkable(w, rc % n, Math.trunc(rc / n), spawn);
    u.order[i] = Order.Move;
    u.orderTarget[i] = goal;
    u.orderX[i] = center(goal % n);
    u.orderY[i] = center(Math.trunc(goal / n));
  }
}

/** Removes queue entry k, shifting the rest forward. */
export function shiftQueue(w: World, s: number, k: number): void {
  const b = w.buildings.col;
  const q = [b.q0, b.q1, b.q2, b.q3, b.q4, b.q5, b.q6];
  for (let j = k; j < b.queueLength[s] - 1; j++) q[j][s] = q[j + 1][s];
  b.queueLength[s]--;
  q[b.queueLength[s]][s] = 0;
}
