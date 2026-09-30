// Validating and applying commands at the start of their tick. A rejected command changes
// nothing and returns a Reject code; it is still written to the log, so a replay rejects
// it the same way. Kinds whose systems come in later PRs are rejected with NotAvailable.

import {
  type Command,
  CELL_SHIFT,
  Order,
  Reject,
  Stance,
  UnitType,
} from "../protocol.ts";
import { clamp, DIR16_X, DIR16_Y, dir16, idiv, isqrt } from "./fixed.ts";
import type { Fog } from "./fog.ts";
import { nearestWalkable } from "./paths.ts";
import { FORMATION_SPACING, UNITS } from "./rules.ts";
import type { World } from "./world.ts";

export interface CommandContext {
  w: World;
  fog: Fog;
  /** Next formation group id. */
  nextGroup: { value: number };
}

/** Own, living units named in the command, in id order (duplicates dropped). */
function ownUnits(w: World, p: number, ids: number[]): number[] {
  const slots: number[] = [];
  for (const id of ids) {
    if (!Number.isInteger(id)) continue;
    const s = w.unit(id);
    if (s >= 0 && w.units.col.owner[s] === p && !slots.includes(s)) slots.push(s);
  }
  return slots.sort((a, b) => a - b);
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
      formation(ctx, slots, cmd.x, cmd.y, cmd.c === "move" ? Order.Move : Order.Retreat);
      return 0;
    }
    case "attack": {
      const slots = ownUnits(w, p, cmd.u);
      if (slots.length === 0) return Reject.NotOwner;
      if (!targetable(ctx, p, cmd.target)) return Reject.InvalidTarget;
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
    default:
      return Reject.NotAvailable;
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
    if (u.owner[s] === p) return false;
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
  const group = ctx.nextGroup.value++;
  let speed = Infinity;
  let sx = 0;
  let sy = 0;
  for (const s of slots) {
    speed = Math.min(speed, UNITS[u.type[s]].speed);
    sx += u.x[s];
    sy += u.y[s];
  }
  const cx = idiv(sx, slots.length);
  const cy = idiv(sy, slots.length);
  const spawn = w.map.spawns[u.owner[slots[0]]];
  const goal = nearestWalkable(w, cellX, cellY, spawn);
  const gx = ((goal % n) << CELL_SHIFT) + 512;
  const gy = (Math.trunc(goal / n) << CELL_SHIFT) + 512;
  const k = dir16(gx - cx, gy - cy);
  const fx = DIR16_X[k];
  const fy = DIR16_Y[k];
  const lx = DIR16_X[(k + 4) % 16];
  const ly = DIR16_Y[(k + 4) % 16];
  const rank = (t: number) => (t === UnitType.Ranged ? 1 : t === UnitType.Mage ? 2 : 0);
  const ordered = [...slots].sort((a, b) => rank(u.type[a]) - rank(u.type[b]) || u.id[a] - u.id[b]);
  const width = isqrt(ordered.length - 1) + 1;
  const max = (n << CELL_SHIFT) - 1;
  ordered.forEach((s, i) => {
    const row = Math.trunc(i / width);
    const col = i % width;
    const back = row * FORMATION_SPACING;
    const side = idiv((2 * col - (width - 1)) * FORMATION_SPACING, 2);
    let px = clamp(gx - idiv(fx * back, 1024) + idiv(lx * side, 1024), 0, max);
    let py = clamp(gy - idiv(fy * back, 1024) + idiv(ly * side, 1024), 0, max);
    if (!w.walkable(px >> CELL_SHIFT, py >> CELL_SHIFT)) {
      const c = nearestWalkable(w, px >> CELL_SHIFT, py >> CELL_SHIFT, spawn);
      px = ((c % n) << CELL_SHIFT) + 512;
      py = (Math.trunc(c / n) << CELL_SHIFT) + 512;
    }
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
