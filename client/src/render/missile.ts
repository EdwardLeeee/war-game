// 真的箭 (R8-35 B, the user's choice; ceo 2026-10-23; war-game-ui's effects.py): arrows from
// buildings (the `shot` event) and bowmen (their attack's hit frame), and stones from slings (the
// sling's hit frame), fly to the target's chest on a low arc. The simulation has done the damage
// when they leave (no flight in it), so a long flight is cut short: at most `maxS`, or the life
// bar would drop half a second before the arrow came. Pure, for the unit tests.

import type { AnimInfo } from "../art/spec.ts";

export interface Flight {
  /** Metres a second. */
  speedMps: number;
  /** The most seconds a flight takes. */
  maxS: number;
  /** The arc's top above the straight line, per metre between from and to. */
  arcK: number;
}

/** ui's numbers for `arrow` (effects.py), when the effects leave them out. */
export const ARROW_FLIGHT: Flight = { speedMps: 35, maxS: 0.35, arcK: 0.06 };
/** ui's numbers for `sling_stone`: thrown higher, a little slower to land. */
export const SLING_FLIGHT: Flight = { speedMps: 35, maxS: 0.45, arcK: 0.18 };
/** Where an arrow or a stone lands: the target's chest, metres up. */
export const CHEST_M = 1.2;
/** Where a bowman's arrow leaves (right, forward, up), when the effects do not say (ui: bow_e, bow_w). */
export const ARROW_FROM_M: [number, number, number] = [-0.15, 0.7, 1.45];

/** An effect's flight: its own numbers, else `fallback`'s. */
export function flightOf(info: AnimInfo | undefined, fallback: Flight): Flight {
  return { speedMps: info?.speed_mps ?? fallback.speedMps, maxS: info?.max_s ?? fallback.maxS, arcK: info?.arc_k ?? fallback.arcK };
}

/** Seconds a flight of `metres` takes. */
export function flightSeconds(metres: number, f: Flight): number {
  return Math.min(metres / f.speedMps, f.maxS);
}

/**
 * Metres up at `k` (0 leaving, 1 landing) of a flight of `metres` from `up0` to `up1` metres up:
 * the straight line between, and the arc over it, highest half way (arcK × metres).
 */
export function heightAt(k: number, metres: number, up0: number, up1: number, arcK: number): number {
  return up0 + (up1 - up0) * k + 4 * arcK * metres * k * (1 - k);
}
