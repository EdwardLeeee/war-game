// Turning "go there" into this tick's velocity, for soldiers and farmers alike: straight at
// the point when it is close, otherwise along a cached flow field.

import { Action, CELL, CELL_SHIFT } from "../protocol.ts";
import { DIR16_X, DIR16_Y, dir16, idiv, isqrt, NO_DIR } from "./fixed.ts";
import { type FieldCache, fieldStep, nearestWalkable } from "./paths.ts";
import { DIRECT_STEER } from "./rules.ts";
import type { World } from "./world.ts";

/**
 * Head for (tx, ty): straight when within DIRECT_STEER, else along the field `key`. Without
 * `goals` the key is a cell index (-1 = the cell of (tx, ty)) and the goal is the walkable
 * cell nearest it. `drop` marks a drop-off field (see FieldCache.get).
 */
export function steerTo(
  w: World,
  fields: FieldCache,
  i: number,
  tx: number,
  ty: number,
  key: number,
  speed: number,
  goals: (() => number[]) | null = null,
  drop = false,
): void {
  const u = w.units.col;
  const n = w.size;
  const dx = tx - u.x[i];
  const dy = ty - u.y[i];
  if (goals === null && dx * dx + dy * dy <= DIRECT_STEER * DIRECT_STEER) {
    steerDirect(w, i, dx, dy, speed);
    return;
  }
  let fieldKey = key;
  let g = goals;
  if (g === null) {
    if (fieldKey < 0) fieldKey = (ty >> CELL_SHIFT) * n + (tx >> CELL_SHIFT);
    const goalCell = fieldKey;
    g = () => {
      const c = nearestWalkable(w, goalCell % n, Math.trunc(goalCell / n));
      return c < 0 ? [] : [c];
    };
  }
  const f = fields.get(w, fieldKey, g, drop);
  const cell = (u.y[i] >> CELL_SHIFT) * n + (u.x[i] >> CELL_SHIFT);
  const d = f === null ? NO_DIR : fieldStep(w, f, cell);
  // No field yet this tick, on a goal cell, or on a cell the field cannot route from: head
  // straight for the point.
  if (d === NO_DIR) {
    steerDirect(w, i, dx, dy, speed);
    return;
  }
  const k = d * 2;
  u.facing[i] = k;
  u.vx[i] = idiv(DIR16_X[k] * speed, CELL);
  u.vy[i] = idiv(DIR16_Y[k] * speed, CELL);
  u.action[i] = Action.Move;
}

export function steerDirect(w: World, i: number, dx: number, dy: number, speed: number): void {
  const u = w.units.col;
  const k = dir16(dx, dy);
  u.facing[i] = k;
  // Do not overshoot a close target point.
  const dist2 = dx * dx + dy * dy;
  const s = dist2 < speed * speed ? Math.max(1, isqrt(dist2)) : speed;
  u.vx[i] = idiv(DIR16_X[k] * s, CELL);
  u.vy[i] = idiv(DIR16_Y[k] * s, CELL);
  u.action[i] = Action.Move;
}
