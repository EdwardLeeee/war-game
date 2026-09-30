// Messages between the page and the simulation worker.

import type { Mode } from "../sim/scenarios.ts";

/** Per unit in a snapshot: id, team, type, x, y, hp, anim, facing. */
export const STRIDE = 8;

export type PlayerCommand =
  | { c: "move"; u: number[]; x: number; y: number }
  | { c: "attack"; u: number[]; target: number }
  | { c: "stop"; u: number[] };

export type ToWorker =
  | { type: "live"; mode: Mode }
  | { type: "command"; cmd: PlayerCommand }
  | { type: "determinism"; games: Mode[]; ticks: number };

export type FromWorker =
  | { type: "snapshot"; tick: number; count: number; units: Int32Array; stepMs: number }
  | { type: "hash"; game: Mode; tick: number; hash: string; count: number }
  | { type: "game-done"; game: Mode; ticks: number; totalMs: number; finalHash: string; tickMedianMs: number; tickMaxMs: number }
  | { type: "determinism-done" };
