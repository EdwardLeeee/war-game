// D-147 (the hands-off training plan, ai-tools selftrain-plan.md 4.1): the scripted player's plays drawn at random
// from core's PLAN_SPACE, for the search for examiners (exam.ts): plans that beat hard with no bonus. Pure: no games.
// Never imported by the simulation Worker.

import { PLAN_CONFLICTS, PLAN_SPACE, planValue, validatePlan, type Need } from "../../plan-space.ts";
import { FORMATIONS, planFor, SPEEDS, STRATEGIES, TUNE, type Plan } from "../scripted-player.ts";
import type { MapMode } from "../../protocol.ts";

/** A seeded generator (mulberry32): the same seed draws the same plans. Floats here are fine: never in a game. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];

/** validatePlan's defaults: what a field that does not matter keeps. */
const DEFAULT: Plan = { ...planFor("push", "h1", "close"), tune: TUNE };

/** The fields a search draws: PLAN_SPACE's with search on, not tables. */
export const SEARCHED: readonly string[] = Object.entries(PLAN_SPACE)
  .filter(([, f]) => f.search && f.type !== "table")
  .map(([path]) => path);

/** `plan` with its own tune (TUNE is shared and frozen in spirit). */
function own(plan: Plan): Plan {
  return { ...plan, tune: structuredClone(plan.tune ?? TUNE) };
}
function setPath(plan: Plan, path: string, v: unknown): void {
  const keys = path.split(".");
  let o = plan as unknown as Record<string, unknown>;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]] = v;
}
const holds = (plan: Plan, n: Need): boolean => {
  const v = planValue(plan, n.field);
  if (n.values !== undefined) return n.values.includes(v as string | number | boolean);
  return v === true || (typeof v === "number" && v > 0) || (typeof v === "string" && v !== "");
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A random value for `path` within PLAN_SPACE's range. */
function draw(r: () => number, path: string): unknown {
  const f = PLAN_SPACE[path];
  if (f.type === "bool") return r() < 0.5;
  if (f.type === "enum") return pick(r, f.values!);
  const step = f.step ?? 1;
  const n = Math.floor((f.max! - f.min!) / step);
  return f.min! + step * Math.floor(r() * (n + 1));
}

/**
 * `plan` made valid on `map`, as validatePlan asks: a field changed from the default whose needs do not hold, or on the
 * fixed map only, goes back to the default (repeated, as one reset can undo another's need); of a conflicting pair the
 * second goes back.
 */
export function repair(plan: Plan, map: MapMode): Plan {
  const p = own(plan);
  for (let round = 0; round < 8; round++) {
    let changed = false;
    for (const [path, f] of Object.entries(PLAN_SPACE)) {
      const v = planValue(p, path);
      const d = planValue(DEFAULT, path);
      if (same(v, d)) continue;
      const needsOk = (f.needs ?? []).every((n) => holds(p, n)) && (f.needsAny === undefined || f.needsAny.some((n) => holds(p, n)));
      if (!needsOk || (f.fixedOnly && map !== "fixed")) {
        setPath(p, path, structuredClone(d));
        changed = true;
      }
    }
    for (const c of PLAN_CONFLICTS) {
      if (holds(p, c.a) && holds(p, c.b)) {
        setPath(p, c.b.field, structuredClone(planValue(DEFAULT, c.b.field)));
        changed = true;
      }
    }
    if (!changed) break;
  }
  return p;
}

export interface Drawn {
  plan: Plan;
  /** How it was made: the base strategy, speed and formation, and the fields set over it. */
  base: string;
  set: Record<string, unknown>;
}

/** The fields of `plan` that differ from its base. */
function changes(plan: Plan, base: Plan): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const path of Object.keys(PLAN_SPACE)) {
    const v = planValue(plan, path);
    if (!same(v, planValue(base, path))) out[path] = v;
  }
  return out;
}

/** The base plans: a strategy, a speed and a formation (push weighted 4 to 1 to 1: the examiners are to win). */
function drawBase(r: () => number): { plan: Plan; base: string } {
  const strategy = r() < 2 / 3 ? "push" : pick(r, STRATEGIES);
  const speed = pick(r, SPEEDS);
  const formation = pick(r, FORMATIONS);
  return { plan: own({ ...planFor(strategy, speed, formation), tune: TUNE }), base: `${strategy}/${speed}/${formation}` };
}

/**
 * A plan drawn at random: a base, then each searched field set to a random value with probability `share`, made valid.
 * Throws if it cannot draw a valid one in 50 tries (a broken PLAN_SPACE).
 */
export function drawPlan(r: () => number, map: MapMode, share = 0.25): Drawn {
  for (let tries = 0; tries < 50; tries++) {
    const { plan, base } = drawBase(r);
    const p = own(plan);
    for (const path of SEARCHED) if (r() < share) setPath(p, path, draw(r, path));
    const fixed = repair(p, map);
    if (validatePlan(fixed, map).length === 0) return { plan: fixed, base, set: changes(fixed, plan) };
  }
  throw new Error("drawPlan: no valid plan in 50 tries");
}

/** `plan` with `k` searched fields set to new random values, made valid. */
export function mutate(r: () => number, from: Drawn, map: MapMode, k: number): Drawn {
  for (let tries = 0; tries < 50; tries++) {
    const p = own(from.plan);
    for (let i = 0; i < k; i++) {
      const path = pick(r, SEARCHED);
      setPath(p, path, draw(r, path));
    }
    const fixed = repair(p, map);
    if (validatePlan(fixed, map).length === 0 && !same(fixed, from.plan)) {
      const [strategy, speed, formation] = from.base.split("/") as [never, never, never];
      return { plan: fixed, base: from.base, set: changes(fixed, own({ ...planFor(strategy, speed, formation), tune: TUNE })) };
    }
  }
  return from;
}
