// Validating and applying commands at the start of their tick. A rejected command changes
// nothing and returns a Reject code; it is still written to the log, so a replay rejects
// it the same way. Kinds whose systems come in later PRs are rejected with NotAvailable.
// Checks run in the order written below; the first failure is the reason reported.

import {
  Action,
  BuildingType,
  type Command,
  CELL,
  CELL_SHIFT,
  GameOverReason,
  NodeKind,
  Order,
  PlaceBit,
  Reject,
  Resource,
  Stance,
  TownChoice,
  TownState,
  UnitFlag,
  UnitType,
} from "../protocol.ts";
import { IDENTITY, isReflection } from "../frame.ts";
import { checkPlacement } from "../placement.ts";
import { type Economy, nodeOpen, shiftQueue } from "./economy.ts";
import { clamp, DIR16_X, DIR16_Y, dir16, idiv, isqrt } from "./fixed.ts";
import type { Fog } from "./fog.ts";
import { nearestWalkable } from "./paths.ts";
import {
  autoBuilders,
  BUILDINGS,
  CANNON,
  FARMLAND_REACH,
  FORMATION_LOOSE_SPACING,
  FORMATION_SPACING,
  LOOSE_KEEP,
  MAGE_CAP,
  QUEUE_MAX,
  TOWNS,
  UNITS,
} from "./rules.ts";
import { rectDist2, startCast } from "./units.ts";
import type { World } from "./world.ts";

export interface CommandContext {
  w: World;
  fog: Fog;
  econ: Economy;
  /** Next formation group id. */
  nextGroup: { value: number };
}

/** Own, living units named in the command, in id order (duplicates dropped). */
function ownUnits(w: World, p: number, ids: number[]): number[] {
  if (!Array.isArray(ids)) return [];
  const slots: number[] = [];
  for (const id of ids) {
    if (!Number.isInteger(id)) continue;
    const s = w.unit(id);
    if (s >= 0 && w.units.col.owner[s] === p && !slots.includes(s)) slots.push(s);
  }
  return slots.sort((a, b) => a - b);
}

/**
 * Farmers the player sends somewhere (move, retreat, stop, attack) wait there once idle;
 * giving them work (gather, build, repair) ends that (GDD section 4, `stay`).
 */
function placed(w: World, slots: number[], stay: boolean): void {
  const u = w.units.col;
  for (const s of slots) if (u.type[s] === UnitType.Farmer) u.stay[s] = stay ? 1 : 0;
}

/** Once a command is accepted, farmers hidden by recall come out to follow it. */
function releaseAll(ctx: CommandContext, slots: number[]): void {
  for (const s of slots) ctx.econ.release(ctx.w, s);
}

/** The farmers among own units; NotOwner / NotAvailable when there are none. */
function ownFarmers(ctx: CommandContext, p: number, ids: number[]): number[] | Reject {
  const { w } = ctx;
  const all = ownUnits(w, p, ids);
  if (all.length === 0) return Reject.NotOwner;
  const farmers = all.filter((s) => w.units.col.type[s] === UnitType.Farmer);
  if (farmers.length === 0) return Reject.NotAvailable;
  return farmers;
}

/**
 * The farmers a build without farmers sends: player p's nearest to the footprint (ties: lower
 * id), autoBuilders(size) of them, leaving out farmers the player placed (stay), those building
 * or repairing, those hiding or on their way to hide (recall), and those on the crystal vein
 * (by hand only: taking them would quietly empty it). PROTOCOL.md 3.1.
 */
function pickBuilders(w: World, p: number, type: BuildingType, x: number, y: number): number[] {
  const u = w.units.col;
  const size = BUILDINGS[type].size;
  const free: { s: number; d: number }[] = [];
  for (let s = 0; s < w.units.count; s++) {
    if (u.owner[s] !== p || u.type[s] !== UnitType.Farmer || u.stay[s] === 1 || u.action[s] === Action.Garrisoned) continue;
    const o = u.order[s];
    if (o === Order.Build || o === Order.Repair || o === Order.Recall) continue;
    if (o === Order.Gather && u.onFarm[s] === 0 && u.orderTarget[s] >= 0 && w.nodeKind[u.orderTarget[s]] === NodeKind.CrystalVein) continue;
    free.push({ s, d: rectDist2(u.x[s], u.y[s], x, y, size) });
  }
  free.sort((a, b) => a.d - b.d || u.id[a.s] - u.id[b.s]);
  return free.slice(0, autoBuilders(size)).map((f) => f.s);
}

/** An own building by id: its slot, or -1. */
function ownBuilding(w: World, p: number, id: number): number {
  if (!Number.isInteger(id)) return -1;
  const s = w.building(id);
  return s >= 0 && w.buildings.col.owner[s] === p ? s : -1;
}

function afford(w: World, p: number, cost: { food: number; wood: number; gold: number; crystal: number }, n: number): boolean {
  const r = w.res;
  const o = p * 4;
  return (
    r[o + Resource.Food] >= cost.food * n &&
    r[o + Resource.Wood] >= cost.wood * n &&
    r[o + Resource.Gold] >= cost.gold * n &&
    r[o + Resource.Crystal] >= cost.crystal * n
  );
}

function pay(w: World, p: number, cost: { food: number; wood: number; gold: number; crystal: number }, n: number): void {
  const o = p * 4;
  w.res[o + Resource.Food] -= cost.food * n;
  w.res[o + Resource.Wood] -= cost.wood * n;
  w.res[o + Resource.Gold] -= cost.gold * n;
  w.res[o + Resource.Crystal] -= cost.crystal * n;
}

function cellOk(w: World, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w.size && y < w.size;
}

/** 0 if applied, otherwise the reason it was rejected. */
export function applyCommand(ctx: CommandContext, cmd: Command): number {
  const { w } = ctx;
  if (w.over) return Reject.GameOver;
  const p = cmd.p;
  if (p !== 0 && p !== 1) return Reject.NotOwner;
  switch (cmd.c) {
    case "move":
    case "retreat": {
      const slots = ownUnits(w, p, cmd.u);
      if (slots.length === 0) return Reject.NotOwner;
      if (!cellOk(w, cmd.x, cmd.y)) return Reject.InvalidTarget;
      releaseAll(ctx, slots);
      formation(ctx, slots, cmd.x, cmd.y, cmd.c === "move" ? Order.Move : Order.Retreat);
      placed(w, slots, true);
      return 0;
    }
    case "attack": {
      const slots = ownUnits(w, p, cmd.u);
      if (slots.length === 0) return Reject.NotOwner;
      if (!targetable(ctx, p, cmd.target)) return Reject.InvalidTarget;
      releaseAll(ctx, slots);
      placed(w, slots, true);
      const u = w.units.col;
      for (const s of slots) {
        u.order[s] = Order.Attack;
        u.orderTarget[s] = cmd.target;
        u.target[s] = cmd.target;
        u.group[s] = -1;
        u.speedCap[s] = 0;
      }
      return 0;
    }
    case "stop": {
      const slots = ownUnits(w, p, cmd.u);
      if (slots.length === 0) return Reject.NotOwner;
      releaseAll(ctx, slots);
      placed(w, slots, true);
      const u = w.units.col;
      for (const s of slots) {
        u.order[s] = Order.None;
        u.orderTarget[s] = -1;
        u.target[s] = -1;
        u.group[s] = -1;
        u.speedCap[s] = 0;
        u.anchorX[s] = u.x[s];
        u.anchorY[s] = u.y[s];
      }
      return 0;
    }
    case "stance": {
      const slots = ownUnits(w, p, cmd.u);
      if (slots.length === 0) return Reject.NotOwner;
      if (cmd.stance !== Stance.Aggressive && cmd.stance !== Stance.Hold) return Reject.InvalidTarget;
      const u = w.units.col;
      for (const s of slots) {
        u.stance[s] = cmd.stance;
        if (cmd.stance === Stance.Hold && u.order[s] === Order.None) {
          u.anchorX[s] = u.x[s];
          u.anchorY[s] = u.y[s];
        }
      }
      return 0;
    }
    case "gather": {
      const farmers = ownFarmers(ctx, p, cmd.u);
      if (typeof farmers === "number") return farmers;
      const node = cmd.node;
      if (!Number.isInteger(node) || node < 0 || node >= w.nodeAmount.length) return Reject.InvalidTarget;
      if (ctx.fog.nodeSeen[p][node] < 0 || !nodeOpen(w, node)) return Reject.InvalidTarget;
      placed(w, farmers, false);
      for (const s of farmers) {
        ctx.econ.release(w, s);
        ctx.econ.gather(w, s, node, false);
      }
      return 0;
    }
    case "build": {
      // No farmers named: the simulation picks them (after the other checks).
      const auto = Array.isArray(cmd.u) && cmd.u.length === 0;
      let farmers: number[] = [];
      if (!auto) {
        const named = ownFarmers(ctx, p, cmd.u);
        if (typeof named === "number") return named;
        farmers = named;
      }
      const type = cmd.type;
      if (!Number.isInteger(type) || type < 0 || type >= BUILDINGS.length) return Reject.InvalidTarget;
      if (type === BuildingType.MainCity || type === BuildingType.TownTower) return Reject.NotAvailable;
      const info = BUILDINGS[type];
      if (placeCheck(ctx, p, type, cmd.x, cmd.y) !== 0) return Reject.BadPlacement;
      if (!afford(w, p, info.cost, 1)) return Reject.CannotAfford;
      if (auto) {
        farmers = pickBuilders(w, p, type, cmd.x, cmd.y);
        if (farmers.length === 0) return Reject.NoFarmer;
      }
      pay(w, p, info.cost, 1);
      const id = w.addBuilding(p, type, cmd.x, cmd.y, 1, 0);
      if (!info.walkable) pushOut(w, cmd.x, cmd.y, info.size);
      placed(w, farmers, false);
      const u = w.units.col;
      for (const s of farmers) {
        // Sent by the simulation: remember what it was gathering, to go back to it afterwards.
        const gathering = auto && u.order[s] === Order.Gather && u.orderTarget[s] >= 0;
        const resume = gathering ? u.orderTarget[s] : -1;
        const resumeFarm = gathering ? u.onFarm[s] : 0;
        ctx.econ.release(w, s);
        ctx.econ.work(w, s, Order.Build, id);
        u.autoBuild[s] = auto ? id : -1;
        u.resumeTarget[s] = resume;
        u.resumeFarm[s] = resumeFarm;
      }
      return 0;
    }
    case "repair": {
      const farmers = ownFarmers(ctx, p, cmd.u);
      if (typeof farmers === "number") return farmers;
      const bs = ownBuilding(w, p, cmd.building);
      if (bs < 0) return w.building(cmd.building) >= 0 ? Reject.NotOwner : Reject.InvalidTarget;
      const b = w.buildings.col;
      const info = BUILDINGS[b.type[bs]];
      let order: number = Order.None;
      if (b.progress[bs] < 1000) order = Order.Build;
      else if (b.hp[bs] < info.hp) order = Order.Repair;
      else if (b.type[bs] === BuildingType.Farm) order = Order.Gather;
      if (order === Order.None) return Reject.NotAvailable;
      placed(w, farmers, false);
      if (order === Order.Gather) {
        // One farmer per farm: the first named farmer takes it if it is free.
        if (ctx.econ.farmTakenBy(w, cmd.building, -1) && !farmers.some((s) => w.units.col.orderTarget[s] === cmd.building && w.units.col.onFarm[s] === 1)) {
          return Reject.NotAvailable;
        }
        farmers.forEach((s, k) => {
          ctx.econ.release(w, s);
          if (k === 0) ctx.econ.gather(w, s, cmd.building, true);
          else ctx.econ.idle(w, s);
        });
        return 0;
      }
      for (const s of farmers) {
        ctx.econ.release(w, s);
        ctx.econ.work(w, s, order, cmd.building);
      }
      return 0;
    }
    case "train": {
      const bs = ownBuilding(w, p, cmd.building);
      if (bs < 0) return w.building(cmd.building) >= 0 ? Reject.NotOwner : Reject.InvalidTarget;
      const b = w.buildings.col;
      const type = cmd.type;
      const n = cmd.n;
      if (!Number.isInteger(n) || n < 1 || n > QUEUE_MAX) return Reject.InvalidTarget;
      if (b.progress[bs] < 1000 || !BUILDINGS[b.type[bs]].trains.includes(type)) return Reject.NotAvailable;
      if (b.queueLength[bs] + n > QUEUE_MAX) return Reject.QueueFull;
      const queued = queuedUnits(w, p);
      if (w.population(p) + queued.all + n > w.populationCap(p)) return Reject.PopulationCap;
      if (type === UnitType.Mage && mages(w, p) + queued.mages + n > MAGE_CAP) return Reject.MageCap;
      const info = UNITS[type];
      if (!afford(w, p, info.cost, n)) return Reject.CannotAfford;
      pay(w, p, info.cost, n);
      const q = [b.q0, b.q1, b.q2, b.q3, b.q4, b.q5, b.q6];
      for (let k = 0; k < n; k++) q[b.queueLength[bs]++][bs] = type;
      return 0;
    }
    case "cancel_train": {
      const bs = ownBuilding(w, p, cmd.building);
      if (bs < 0) return w.building(cmd.building) >= 0 ? Reject.NotOwner : Reject.InvalidTarget;
      const b = w.buildings.col;
      const k = cmd.index;
      if (!Number.isInteger(k) || k < 0 || k >= b.queueLength[bs]) return Reject.InvalidTarget;
      const q = [b.q0, b.q1, b.q2, b.q3, b.q4, b.q5, b.q6];
      const info = UNITS[q[k][bs]];
      const o = p * 4;
      w.res[o + Resource.Food] += info.cost.food;
      w.res[o + Resource.Wood] += info.cost.wood;
      w.res[o + Resource.Gold] += info.cost.gold;
      w.res[o + Resource.Crystal] += info.cost.crystal;
      shiftQueue(w, bs, k);
      if (k === 0) b.queueTicks[bs] = 0;
      return 0;
    }
    case "rally": {
      const bs = ownBuilding(w, p, cmd.building);
      if (bs < 0) return w.building(cmd.building) >= 0 ? Reject.NotOwner : Reject.InvalidTarget;
      if (BUILDINGS[w.buildings.col.type[bs]].trains.length === 0) return Reject.NotAvailable;
      if (!cellOk(w, cmd.x, cmd.y)) return Reject.InvalidTarget;
      w.buildings.col.rallyX[bs] = (cmd.x << CELL_SHIFT) + 512;
      w.buildings.col.rallyY[bs] = (cmd.y << CELL_SHIFT) + 512;
      return 0;
    }
    case "eco_ratio": {
      const r = [cmd.food, cmd.wood, cmd.gold];
      if (!r.every((v) => Number.isInteger(v) && v >= 0 && v <= 100) || r[0] + r[1] + r[2] !== 100) return Reject.InvalidTarget;
      if (typeof cmd.on !== "boolean") return Reject.InvalidTarget;
      w.ecoRatio.set(r, p * 3);
      w.ecoOn[p] = cmd.on ? 1 : 0;
      return 0;
    }
    case "recall": {
      if (typeof cmd.on !== "boolean") return Reject.InvalidTarget;
      ctx.econ.setRecall(w, p, cmd.on);
      return 0;
    }
    case "cast": {
      const s = Number.isInteger(cmd.u) ? w.unit(cmd.u) : -1;
      const u = w.units.col;
      if (s < 0 || u.owner[s] !== p) return Reject.NotOwner;
      if (u.type[s] !== UnitType.Mage) return Reject.NotAvailable;
      const max = w.size << CELL_SHIFT;
      if (!Number.isInteger(cmd.fx) || !Number.isInteger(cmd.fy) || cmd.fx < 0 || cmd.fy < 0 || cmd.fx >= max || cmd.fy >= max) {
        return Reject.InvalidTarget;
      }
      const dx = cmd.fx - u.x[s];
      const dy = cmd.fy - u.y[s];
      if (dx * dx + dy * dy > CANNON.range * CANNON.range) return Reject.OutOfRange;
      if (u.castCooldown[s] > 0) return Reject.Cooldown;
      if (w.res[p * 4 + Resource.Crystal] < CANNON.crystal) return Reject.NoCrystal;
      startCast(w, s, cmd.fx, cmd.fy, false);
      return 0;
    }
    case "formation": {
      const slots = ownUnits(w, p, cmd.u);
      if (slots.length === 0) return Reject.NotOwner;
      if (typeof cmd.loose !== "boolean") return Reject.InvalidTarget;
      const u = w.units.col;
      for (const s of slots) {
        if (cmd.loose) u.flags[s] |= UnitFlag.Loose;
        else u.flags[s] &= ~UnitFlag.Loose;
      }
      reform(ctx, slots);
      return 0;
    }
    case "autocast": {
      const slots = ownUnits(w, p, cmd.u);
      if (slots.length === 0) return Reject.NotOwner;
      if (typeof cmd.on !== "boolean") return Reject.InvalidTarget;
      const u = w.units.col;
      const mageSlots = slots.filter((s) => u.type[s] === UnitType.Mage);
      if (mageSlots.length === 0) return Reject.NotAvailable;
      for (const s of mageSlots) {
        if (cmd.on) u.flags[s] |= UnitFlag.Autocast;
        else u.flags[s] &= ~UnitFlag.Autocast;
      }
      return 0;
    }
    case "town_choice": {
      const t = cmd.town;
      if (!Number.isInteger(t) || t < 0 || t >= w.townSize.length) return Reject.InvalidTarget;
      if (cmd.choice !== TownChoice.Plunder && cmd.choice !== TownChoice.Govern) return Reject.InvalidTarget;
      if (w.townOwner[t] !== p) return Reject.TownNotYours;
      if (w.townState[t] !== TownState.AwaitingChoice) return Reject.TownChoiceMade;
      const rule = TOWNS[w.townSize[t]];
      if (cmd.choice === TownChoice.Plunder) {
        w.townState[t] = TownState.Plundering;
        w.townTimer[t] = rule.plunderTicks;
        w.townTimerTotal[t] = rule.plunderTicks;
        return 0;
      }
      if (!afford(w, p, rule.governCost, 1)) return Reject.CannotAfford;
      pay(w, p, rule.governCost, 1);
      const c = rule.governCost;
      w.governChosen[p]++;
      w.governCost[p] += c.food + c.wood + c.gold + c.crystal;
      w.townSpellCost[t] = c.food + c.wood + c.gold + c.crystal;
      w.townSpellIncome[t] = 0;
      w.townState[t] = TownState.Repairing;
      w.townTimer[t] = rule.repairTicks;
      w.townTimerTotal[t] = rule.repairTicks;
      return 0;
    }
    case "surrender": {
      w.winner = 1 - p;
      w.endReason = GameOverReason.Surrender;
      return 0;
    }
    default:
      return Reject.NotAvailable;
  }
}

/** Units in every own training queue: all of them, and the mages. */
function queuedUnits(w: World, p: number): { all: number; mages: number } {
  const b = w.buildings.col;
  const q = [b.q0, b.q1, b.q2, b.q3, b.q4, b.q5, b.q6];
  let all = 0;
  let m = 0;
  for (let s = 0; s < w.buildings.count; s++) {
    if (b.owner[s] !== p) continue;
    all += b.queueLength[s];
    for (let k = 0; k < b.queueLength[s]; k++) if (q[k][s] === UnitType.Mage) m++;
  }
  return { all, mages: m };
}

function mages(w: World, p: number): number {
  const u = w.units.col;
  let m = 0;
  for (let s = 0; s < w.units.count; s++) if (u.owner[s] === p && u.type[s] === UnitType.Mage) m++;
  return m;
}

/** Is a cell farm land for player p: within FARMLAND_REACH of an own finished main city or granary? */
export function farmLand(w: World, p: number, cx: number, cy: number): boolean {
  const b = w.buildings.col;
  for (let s = 0; s < w.buildings.count; s++) {
    const t = b.type[s];
    if (b.owner[s] !== p || b.progress[s] < 1000 || (t !== BuildingType.MainCity && t !== BuildingType.Granary)) continue;
    const size = BUILDINGS[t].size;
    const dx = Math.max(b.cellX[s] - cx, 0, cx - (b.cellX[s] + size - 1));
    const dy = Math.max(b.cellY[s] - cy, 0, cy - (b.cellY[s] + size - 1));
    if (Math.max(dx, dy) <= FARMLAND_REACH) return true;
  }
  return false;
}

const scratch: { cells: Uint8Array | null } = { cells: null };

/**
 * The simulation's ruling on a `build`: checkPlacement (the function the screen uses) on
 * the footprint cells of the full-knowledge grid — anything really there blocks, even if
 * the player has not seen it; the player must have explored every cell.
 */
function placeCheck(ctx: CommandContext, p: number, type: BuildingType, x: number, y: number): number {
  const { w, fog } = ctx;
  const n = w.size;
  const info = BUILDINGS[type];
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + info.size > n || y + info.size > n) {
    return Reject.BadPlacement;
  }
  if (scratch.cells === null || scratch.cells.length !== n * n) scratch.cells = new Uint8Array(n * n);
  const cells = scratch.cells;
  for (let cy = y; cy < y + info.size; cy++) {
    for (let cx = x; cx < x + info.size; cx++) {
      const c = cy * n + cx;
      cells[c] =
        (w.grid[c] !== 0 || w.buildingAt[c] >= 0 ? PlaceBit.Blocked : 0) |
        (fog.explored[p][c] === 1 ? 0 : PlaceBit.Unexplored) |
        (farmLand(w, p, cx, cy) ? PlaceBit.FarmLand : 0);
    }
  }
  const result = checkPlacement({ size: n, cells }, info, x, y);
  for (let cy = y; cy < y + info.size; cy++) cells.fill(0, cy * n + x, cy * n + x + info.size);
  return result;
}

/** Units standing on a new building's footprint step to the nearest open cell (toward their own side). */
function pushOut(w: World, x: number, y: number, size: number): void {
  const u = w.units.col;
  const n = w.size;
  for (let s = 0; s < w.units.count; s++) {
    const cx = u.x[s] >> CELL_SHIFT;
    const cy = u.y[s] >> CELL_SHIFT;
    if (cx < x || cy < y || cx >= x + size || cy >= y + size) continue;
    const spawn = u.owner[s] < 2 ? w.map.spawns[u.owner[s]] : undefined;
    const c = nearestWalkable(w, cx, cy, spawn);
    if (c < 0) continue;
    u.x[s] = ((c % n) << CELL_SHIFT) + 512;
    u.y[s] = (Math.trunc(c / n) << CELL_SHIFT) + 512;
    u.anchorX[s] = u.x[s];
    u.anchorY[s] = u.y[s];
  }
}

/** Enemy or neutral unit the player can see, or an enemy/neutral building it sees or remembers. */
function targetable(ctx: CommandContext, p: number, id: number): boolean {
  const { w, fog } = ctx;
  if (!Number.isInteger(id)) return false;
  const n = w.size;
  const s = w.unit(id);
  if (s >= 0) {
    const u = w.units.col;
    if (u.owner[s] === p || u.action[s] === Action.Garrisoned) return false;
    return fog.visible[p][(u.y[s] >> CELL_SHIFT) * n + (u.x[s] >> CELL_SHIFT)] === 1;
  }
  const bs = w.building(id);
  if (bs < 0) return false;
  if (w.buildings.col.owner[bs] === p) return false;
  // The memory list holds every enemy or neutral building seen, including the ones in view.
  return fog.memory[p].some((m) => m[0] === id);
}

/**
 * Formation (GDD section 9): the group moves at its slowest member's speed; at the goal the
 * units stand in rows facing the way they came, melee in front, then ranged, then mages,
 * each rank in id order.
 */
function formation(ctx: CommandContext, slots: number[], cellX: number, cellY: number, order: number): void {
  const { w } = ctx;
  const u = w.units.col;
  const n = w.size;
  let sx = 0;
  let sy = 0;
  for (const s of slots) {
    sx += u.x[s];
    sy += u.y[s];
  }
  const cx = idiv(sx, slots.length);
  const cy = idiv(sy, slots.length);
  const spawn = w.map.spawns[u.owner[slots[0]]];
  const goal = nearestWalkable(w, cellX, cellY, spawn);
  const gx = ((goal % n) << CELL_SHIFT) + 512;
  const gy = (Math.trunc(goal / n) << CELL_SHIFT) + 512;
  layout(ctx, slots, gx, gy, dir16(gx - cx, gy - cy), order, goal);
}

/** Units standing this close (or closer, through one another) re-form as one formation. */
const REFORM_LINK = 3 * CELL;

/**
 * The `formation` command re-forms the units named in it with the new spacing (round 3, D-027),
 * each lot where it is, so troops in different places are never drawn together:
 * - a group still on its way (from one move or retreat) forms up again at its goal; members
 *   of it that are already there join in;
 * - units standing (no order) form up in place: those within REFORM_LINK of one another, or
 *   linked through others, are one formation, which keeps its middle and faces the way its
 *   melee stand from its ranged and mages (one kind only: toward the enemy's main city);
 *   a unit standing alone only keeps the new flag.
 * Farmers, units casting or attacking something, and new units walking to a rally point
 * only keep the new flag.
 */
function reform(ctx: CommandContext, slots: number[]): void {
  const { w } = ctx;
  const u = w.units.col;
  const n = w.size;
  const soldier = (s: number) => u.type[s] !== UnitType.Farmer && u.action[s] !== Action.Garrisoned;
  const moving = (s: number) => u.order[s] === Order.Move || u.order[s] === Order.Retreat;
  const done = new Set<number>();
  for (const s of slots) {
    if (!soldier(s) || !moving(s) || u.group[s] < 0 || done.has(s)) continue;
    const g = u.group[s];
    const members = slots.filter((m) => soldier(m) && u.group[m] === g && (moving(m) || u.order[m] === Order.None));
    for (const m of members) done.add(m);
    const goal = u.orderTarget[s];
    if (goal >= 0) formation(ctx, members, goal % n, Math.trunc(goal / n), u.order[s]);
  }
  const idle = slots.filter((s) => soldier(s) && !done.has(s) && u.order[s] === Order.None);
  // Clusters: union-find over pairs within REFORM_LINK, roots kept at the lowest slot.
  const root = idle.map((_, k) => k);
  const find = (k: number): number => (root[k] === k ? k : (root[k] = find(root[k])));
  for (let a = 0; a < idle.length; a++) {
    for (let b = a + 1; b < idle.length; b++) {
      const dx = u.x[idle[a]] - u.x[idle[b]];
      const dy = u.y[idle[a]] - u.y[idle[b]];
      if (dx * dx + dy * dy > REFORM_LINK * REFORM_LINK) continue;
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) root[Math.max(ra, rb)] = Math.min(ra, rb);
    }
  }
  for (let k = 0; k < idle.length; k++) {
    if (find(k) !== k) continue;
    const cluster = idle.filter((_, j) => find(j) === k);
    if (cluster.length < 2) continue;
    let sx = 0;
    let sy = 0;
    for (const s of cluster) {
      sx += u.x[s];
      sy += u.y[s];
    }
    const cx = idiv(sx, cluster.length);
    const cy = idiv(sy, cluster.length);
    layout(ctx, cluster, cx, cy, heading(w, cluster, cx, cy), Order.Move, -1);
  }
}

/**
 * The way a standing formation faces: from where its higher ranks stand toward its lower ones
 * (ranks weighted about their mean); with one kind of unit only, toward the enemy's main city.
 */
function heading(w: World, cluster: number[], cx: number, cy: number): number {
  const u = w.units.col;
  let total = 0;
  for (const s of cluster) total += rank(u.type[s]);
  let dx = 0;
  let dy = 0;
  for (const s of cluster) {
    const weight = total - cluster.length * rank(u.type[s]);
    dx += weight * (u.x[s] - cx);
    dy += weight * (u.y[s] - cy);
  }
  if (dx !== 0 || dy !== 0) return dir16(dx, dy);
  const enemy = w.map.spawns[1 - u.owner[cluster[0]]];
  return dir16((enemy.cellX << CELL_SHIFT) + 512 - cx, (enemy.cellY << CELL_SHIFT) + 512 - cy);
}

/** Melee in front, then ranged, then mages. */
const rank = (t: number) => (t === UnitType.Ranged ? 1 : t === UnitType.Mage ? 2 : 0);

/**
 * Slots for a group facing heading k (dir16), with `order` (Move or Retreat) to them. With a
 * goal cell, (x, y) is its centre and the middle of the front row stands there; with goal -1
 * (re-forming in place), (x, y) is where the middle of the whole formation goes and the goal
 * cell is the one under the front row's middle.
 */
function layout(ctx: CommandContext, slots: number[], x: number, y: number, k: number, order: number, goalCell: number): void {
  const { w } = ctx;
  const u = w.units.col;
  const n = w.size;
  const group = ctx.nextGroup.value++;
  let speed = Infinity;
  for (const s of slots) speed = Math.min(speed, UNITS[u.type[s]].speed);
  const spawn = w.map.spawns[u.owner[slots[0]]];
  const fx = DIR16_X[k];
  const fy = DIR16_Y[k];
  // "Left" of the heading, taken in the owner's canonical frame: a mirror frame swaps left
  // and right, so its left is the other side (units get the mirror image of the slots).
  const turn = isReflection(w.map.frames[u.owner[slots[0]]] ?? IDENTITY) ? 12 : 4;
  const lx = DIR16_X[(k + turn) % 16];
  const ly = DIR16_Y[(k + turn) % 16];
  let ordered = [...slots].sort((a, b) => rank(u.type[a]) - rank(u.type[b]) || u.id[a] - u.id[b]);
  const m = ordered.length;
  const width = isqrt(m - 1) + 1;
  const max = (n << CELL_SHIFT) - 1;
  // Loose when more than half of the group is (UnitFlag.Loose): the whole group forms up
  // further apart, so that a group told to go loose is not held together by a few who are not.
  let loose = 0;
  for (const s of slots) if ((u.flags[s] & UnitFlag.Loose) !== 0) loose++;
  const spacing = 2 * loose > m ? FORMATION_LOOSE_SPACING : FORMATION_SPACING;
  const back = (i: number) => Math.trunc(i / width) * spacing;
  const side = (i: number) => idiv((2 * (i % width) - (width - 1)) * spacing, 2);
  let gx = x;
  let gy = y;
  let goal = goalCell;
  if (goal < 0) {
    // The front row's middle sits ahead of the formation's middle by the mean offset.
    let sb = 0;
    let ss = 0;
    for (let i = 0; i < m; i++) {
      sb += back(i);
      ss += side(i);
    }
    const mb = idiv(sb, m);
    const ms = idiv(ss, m);
    gx = clamp(x + idiv(fx * mb, 1024) - idiv(lx * ms, 1024), 0, max);
    gy = clamp(y + idiv(fy * mb, 1024) - idiv(ly * ms, 1024), 0, max);
    goal = nearestWalkable(w, gx >> CELL_SHIFT, gy >> CELL_SHIFT, spawn);
  }
  // Slot i: rows back from the front, each row left to right.
  const sx: number[] = [];
  const sy: number[] = [];
  for (let i = 0; i < m; i++) {
    let px = clamp(gx - idiv(fx * back(i), 1024) + idiv(lx * side(i), 1024), 0, max);
    let py = clamp(gy - idiv(fy * back(i), 1024) + idiv(ly * side(i), 1024), 0, max);
    if (!w.walkable(px >> CELL_SHIFT, py >> CELL_SHIFT)) {
      const c = nearestWalkable(w, px >> CELL_SHIFT, py >> CELL_SHIFT, spawn);
      px = ((c % n) << CELL_SHIFT) + 512;
      py = (Math.trunc(c / n) << CELL_SHIFT) + 512;
    }
    sx.push(px);
    sy.push(py);
  }
  if (goalCell < 0 || (LOOSE_KEEP.spacing > 0 && spacing === FORMATION_LOOSE_SPACING)) {
    // Re-forming in place, or a loose group on a move (its ranged units and mages walk straight
    // to their places, LOOSE_KEEP), units may take the slots in the order they stand: each rank
    // front to back and each row left to right. Whichever order has the shorter longest walk (then
    // the smaller sum of squared walks; a tie keeps id order) is used, so the formation is
    // done sooner and nobody crosses it for nothing.
    const ahead = (s: number) => fx * (u.x[s] - x) + fy * (u.y[s] - y);
    const across = (s: number) => lx * (u.x[s] - x) + ly * (u.y[s] - y);
    const standing = [...ordered].sort((a, b) => rank(u.type[a]) - rank(u.type[b]) || ahead(b) - ahead(a) || u.id[a] - u.id[b]);
    for (let r = 0; r < m; r += width) {
      const row = standing.slice(r, r + width).sort((a, b) => across(a) - across(b) || u.id[a] - u.id[b]);
      standing.splice(r, row.length, ...row);
    }
    const walk = (o: number[]) => {
      let most = 0;
      let sum = 0;
      o.forEach((s, i) => {
        const dx = (sx[i] - u.x[s]) >> 4;
        const dy = (sy[i] - u.y[s]) >> 4;
        most = Math.max(most, dx * dx + dy * dy);
        sum += dx * dx + dy * dy;
      });
      return { most, sum };
    };
    const a = walk(standing);
    const b = walk(ordered);
    if (a.most < b.most || (a.most === b.most && a.sum < b.sum)) ordered = standing;
  }
  ordered.forEach((s, i) => {
    const px = sx[i];
    const py = sy[i];
    u.order[s] = order;
    u.orderTarget[s] = goal;
    u.orderX[s] = px;
    u.orderY[s] = py;
    u.group[s] = group;
    u.speedCap[s] = speed;
    u.target[s] = -1;
    u.stuck[s] = 0;
  });
}
