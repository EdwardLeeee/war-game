// What a scripted player's plan may be set to from outside (D-147: war-game-ai searches for plans that beat hard without
// a bonus). PLAN_SPACE has every field of Plan and of its tune (constants of the plays, ai/scripted-player.ts TUNE):
// type, range, unit, the fields that must be on for it to matter, the fixed map only, and whether a search should try
// it; PLAN_CONFLICTS the pairs that cannot be on together. validatePlan lists what is wrong with a plan; applyPlan lays a
// partial plan (scripted-games' --plan) over one and throws on anything wrong. A field that does not matter (its
// prerequisite off) must keep its default value, so a plan read back from a record (GameRecord.plan) always passes.
//
// Ranges are where the scripted player still plays sensibly, wider than any group in CI; ticks are 1/20 s (1200 a
// minute), cells are map cells.

import { type Plan, planFor, TUNE, type Tune } from "./ai/scripted-player.ts";
import type { MapMode } from "./protocol.ts";

/** A value a field must have: `values` given, one of them; else on (true, more than 0, not ""). */
export interface Need {
  field: string;
  values?: readonly (string | number | boolean)[];
}

/** A table of the plays (search: false; settable, checked). */
export type TableSpace =
  /** [minute, value] pairs, minutes rising, straight between them (byClock). */
  | { kind: "clock"; length: [number, number]; minute: [number, number]; value: [number, number] }
  /** Minutes, rising. */
  | { kind: "minutes"; length: [number, number]; minute: [number, number] }
  /** Percent shares that add up to `sum`. */
  | { kind: "shares"; length: number; sum: number };

export interface FieldSpace {
  type: "int" | "bool" | "enum" | "table";
  /** int: inclusive; a value is min + k * step. */
  min?: number;
  max?: number;
  step?: number;
  /** enum. */
  values?: readonly string[];
  table?: TableSpace;
  unit?: "count" | "percent" | "tick" | "cell" | "tenths" | "gold";
  /** Every one of these must hold for the field to matter. */
  needs?: readonly Need[];
  /** At least one of these must hold for the field to matter. */
  needsAny?: readonly Need[];
  /** Only on the fixed map (the play's route is drawn on it). */
  fixedOnly?: boolean;
  /** Whether a search should try it; false: measuring only, or no effect any more. */
  search: boolean;
  note: string;
}

const MIN = 1200;
const int = (min: number, max: number, unit: FieldSpace["unit"], note: string, more: Partial<FieldSpace> = {}): FieldSpace => ({ type: "int", min, max, step: 1, unit, search: true, note, ...more });
const bool = (note: string, more: Partial<FieldSpace> = {}): FieldSpace => ({ type: "bool", search: true, note, ...more });
const on = (field: string): Need => ({ field });
const is = (field: string, ...values: (string | number | boolean)[]): Need => ({ field, values });

const TURTLE_ON = [on("turtle")];
const LATE_ON = [on("turtle"), on("lateSiege")];

/** Every settable field, by its path in the plan ("tune.fort.dist" is plan.tune.fort.dist). */
export const PLAN_SPACE: Readonly<Record<string, FieldSpace>> = {
  // --- the economy and the army ---
  farmers: int(10, 80, "count", "farmers it trains (plan.lateSiege: by tune.lateSiege.farmers instead)"),
  production: int(1, 8, "count", "barracks plus ranges at most"),
  spearShare: int(0, 100, "percent", "spearmen among spearmen and ranged", { step: 5 }),
  cavalryShare: int(0, 50, "percent", "cavalry among its soldiers, from a stable once a range stands"),
  autoTrain: bool("the buildings train soldiers on their own; farmers still by hand"),
  userEco: bool("the user's economy of the game they beat hard: farmers held at `farmers`, no gold until the first plunder, barracks and range early"),
  woodBias: bool("farmers 20/60/20 while food and gold pile up and wood is short"),
  staticRatio: bool("the economy ratio left at 40/35/25 (a measurement)", { search: false }),
  noRange: bool("never builds a range: spearmen (and mages) only"),
  noMage: bool("never builds a mage hall"),
  hallFirst: bool("the mage hall first once it may have a mage (no crystal: after a plunder, minute 16, or mageRush)", { needs: [is("noMage", false)] }),
  mageRush: bool("the mage hall as soon as it can pay, mages whenever it can", { needs: [is("noMage", false)] }),
  mageReserve: int(0, 50, "count", "crystal kept per mage: no effect without crystal (D-135)", { search: false }),
  vein: int(0, 10, "count", "farmers sent to the crystal vein: no effect, no vein since D-135", { search: false }),
  loose: int(0, 2, "count", "loose formation: 0 nobody, 1 ranged and mages, 2 everyone"),
  // --- towns ---
  townAt: int(0, 60, "count", "soldiers before the first town trip (0: never)"),
  choice: { type: "enum", values: ["plunder", "govern"], search: true, note: "a town taken is plundered or governed" },
  again: bool("plunders the town again once its ruins turn neutral", { needs: [on("townAt"), is("choice", "plunder")] }),
  corners: bool("keeps taking the nearest small town not its own, not in ruins", { needs: [on("townAt")] }),
  bigTown: bool("the plan's town is the big town", { needs: [on("townAt")] }),
  guards: int(0, 10, "count", "soldiers kept in a governed town", { needs: [is("choice", "govern")] }),
  townGuard: bool("those soldiers guard the town (`guard`)", { needs: [is("choice", "govern"), on("guards")] }),
  // --- marching on the enemy ---
  pushAt: int(0, 150, "count", "marches on the enemy's main city with this many (0: never)"),
  counterAt: int(6, 150, "count", "after beating off an attack at home, marches with this many"),
  pushAhead: bool("marches only with more soldiers than the most enemy soldiers seen at once lately"),
  focus: int(0, 20, "count", "at the enemy's main city with this many defenders or fewer in sight, everyone hits the city (0: defenders first)"),
  engines: int(0, 6, "count", "siege engines kept up once the range stands and 14 farmers; marches on the main city wait for them (D-141)"),
  // --- cavalry ---
  raid: int(0, 40, "count", "cavalry kept apart for raids on the enemy's farmers at its main city (or, with steal, on the city)"),
  steal: { type: "enum", values: ["", "home", "away"], search: true, note: "the raid's cavalry go for the main city itself: as soon as the group is full, or while the enemy's army is out (D-141)", needs: [on("raid")] },
  harass: int(0, 20, "count", "soldiers kept apart for the enemy's farmers far from its main city"),
  // --- the race (fixed map) ---
  race: { type: "enum", values: ["", "edge", "sentry"], search: true, fixedOnly: true, note: "races the AI to its main city: up the map's edge, or once a sentry sees its army coming; never comes home" },
  raceAt: int(10, 120, "count", "the race sets out with this many", { needs: [on("race")], fixedOnly: true }),
  raceSeen: int(4, 40, "count", "the sentry: this many enemy soldiers on our half, nearer than before", { needsAny: [is("race", "sentry"), is("raceStage", true)], fixedOnly: true }),
  raceBy: int(5 * MIN, 40 * MIN, "tick", "the race sets out at this tick with counterAt or more", { needs: [on("race")], step: MIN / 2, fixedOnly: true }),
  raceStage: bool("edge: stops at the second waypoint until the sentry sees the enemy's army coming", { needs: [is("race", "edge")], fixedOnly: true }),
  // --- forts ---
  towerRush: int(0, 9, "count", "the tower rush: spearmen posted at an outpost tune.rush.dist cells from the enemy's main city (0: none)", { fixedOnly: true }),
  rushBuildersOnly: bool("the tower rush with its farmers alone", { fixedOnly: true }),
  fortress: bool("the midway fortress: an outpost and tune.fort.towers arrow towers tune.fort.dist cells from home toward the enemy"),
  fortressHold: int(0, 150, "count", "the army waits by the fortress until this many or tune.fort.holdUntil (0: no waiting)", { needs: [on("fortress")] }),
  fortGuards: int(-1, 9, "count", "spearmen posted at the fortress (-1: as many as an outpost takes)", { needs: [on("fortress")] }),
  homeTowers: int(0, 10, "count", "arrow towers by home toward the map's centre once a range stands"),
  // --- the turtle and what comes with it ---
  turtle: bool("towers by home by the clock (tune.turtle), towers by every governed town, outposts by home"),
  crush: bool("with the turtle: out after a big wave beaten off at home, the enemy's governed towns first", { needs: TURTLE_ON }),
  earlyTowns: bool("with the turtle: town trips with townAt soldiers, no towers by home needed", { needs: TURTLE_ON }),
  lateSiege: bool("with the turtle: farmers and towers by the user's late clock, a siege works and engines, out with tune.lateSiege.army", { needs: TURTLE_ON }),

  // --- tune: the constants of the plays ---
  "tune.fort.from": int(5 * MIN, 40 * MIN, "tick", "the fortress goes up from this tick", { step: MIN / 2, needs: [on("fortress")] }),
  "tune.fort.dist": int(15, 70, "cell", "the fortress this far from home toward the enemy's main city", { needs: [on("fortress")] }),
  "tune.fort.towers": int(0, 10, "count", "arrow towers beside the fortress", { needs: [on("fortress")] }),
  "tune.fort.holdUntil": int(10 * MIN, 60 * MIN, "tick", "the army holding by the fortress marches from this tick whatever its size", { step: MIN / 2, needs: [on("fortress"), on("fortressHold")] }),
  "tune.harass.from": int(5 * MIN, 40 * MIN, "tick", "the harassers go out from this tick", { step: MIN / 2, needs: [on("harass")] }),
  "tune.harass.far": int(10, 40, "cell", "enemy farmers this far from their main city", { needs: [on("harass")] }),
  "tune.harass.rest": int(0, 5 * MIN, "tick", "the harassers rest this long after falling back", { step: MIN / 4, needs: [on("harass")] }),
  "tune.rush.dist": int(6, 30, "cell", "the tower rush's outpost this far from the enemy's main city", { needsAny: [on("towerRush"), on("rushBuildersOnly")], fixedOnly: true }),
  "tune.rush.builders": int(1, 8, "count", "farmers that build the tower rush's or the fortress's outpost and towers", { needsAny: [on("towerRush"), on("rushBuildersOnly"), on("fortress")] }),
  "tune.homeTowerAt": int(4, 20, "cell", "arrow towers by home this far toward the centre (homeTowers, the turtle)", { needsAny: [on("homeTowers"), on("turtle")] }),
  "tune.turtle.towers": { type: "table", table: { kind: "clock", length: [1, 10], minute: [0, 120], value: [0, 40] }, search: false, note: "(minute, towers by home) pairs", needs: TURTLE_ON },
  "tune.turtle.max": int(0, 40, "count", "towers by home at most", { needs: TURTLE_ON }),
  "tune.turtle.townTowers": int(0, 6, "count", "towers by each governed town and each mine away from home", { needs: TURTLE_ON }),
  "tune.turtle.outposts": { type: "table", table: { kind: "minutes", length: [0, 10], minute: [0, 120] }, search: false, note: "an outpost by home from each of these minutes", needs: TURTLE_ON },
  "tune.turtle.outpostAt": int(6, 30, "cell", "the outposts this far from home", { needs: TURTLE_ON }),
  "tune.turtle.manned": int(0, 6, "count", "the first this many outposts get guards", { needs: TURTLE_ON }),
  "tune.turtle.outpostGuards": int(0, 9, "count", "spearmen at each manned outpost", { needs: TURTLE_ON }),
  "tune.turtle.boomBy": int(0, 30 * MIN, "tick", "food first and few soldiers before this tick", { step: MIN / 2, needs: TURTLE_ON }),
  "tune.turtle.boomFood": { type: "table", table: { kind: "shares", length: 3, sum: 100 }, search: false, note: "food, wood, gold percent while booming", needs: TURTLE_ON },
  "tune.turtle.boomSoldiers": int(0, 60, "count", "soldiers at most while booming", { needs: TURTLE_ON }),
  "tune.turtle.goldLow": int(0, 1000, "gold", "a mine at the next gold once the gold by its mines is under this", { step: 50, needs: TURTLE_ON }),
  "tune.turtle.goldGlut": int(100, 2000, "gold", "farmers off gold while it has more than this", { step: 50, needs: TURTLE_ON }),
  "tune.turtle.sites": int(1, 6, "count", "buildings going up at once", { needs: TURTLE_ON }),
  "tune.turtle.homeR": int(8, 30, "cell", "towers this near home count as by home", { needs: TURTLE_ON }),
  "tune.turtle.tripTowers": int(0, 30, "count", "a town trip only with this many towers by home (not with earlyTowns)", { needs: TURTLE_ON }),
  "tune.turtle.bigAt": int(10, 150, "count", "the big city too once the army is this many", { needs: [on("turtle"), on("corners")] }),
  "tune.crush.wave": int(4, 40, "count", "a wave of this many enemy soldiers beaten off at home lets it go out", { needs: [on("turtle"), on("crush")] }),
  "tune.crush.min": int(10, 150, "count", "out with this many at least", { needs: [on("turtle"), on("crush")] }),
  "tune.crush.ratio": int(5, 30, "tenths", "out with this many tenths of the most enemy soldiers seen at once; falls back below it", { needs: [on("turtle"), on("crush")] }),
  "tune.crush.seen": int(100, 3 * MIN, "tick", "how long it remembers what it saw of the enemy", { step: 100, needs: [on("turtle"), on("crush")] }),
  "tune.crush.near": int(6, 30, "cell", "enemy soldiers this near the army count", { needs: [on("turtle"), on("crush")] }),
  "tune.lateSiege.farmers": { type: "table", table: { kind: "clock", length: [1, 10], minute: [0, 120], value: [10, 100] }, search: false, note: "(minute, farmers) pairs", needs: LATE_ON },
  "tune.lateSiege.towers": { type: "table", table: { kind: "clock", length: [1, 10], minute: [0, 120], value: [0, 50] }, search: false, note: "(minute, arrow towers) pairs", needs: LATE_ON },
  "tune.lateSiege.governed": int(0, 8, "count", "towns governed at most", { needs: LATE_ON }),
  "tune.lateSiege.worksAt": int(10 * MIN, 90 * MIN, "tick", "a siege works from this tick", { step: MIN / 2, needs: LATE_ON }),
  "tune.lateSiege.worksTowers": int(0, 50, "count", "or once it has this many arrow towers", { needs: LATE_ON }),
  "tune.lateSiege.engines": int(0, 8, "count", "siege engines kept up", { needs: LATE_ON }),
  "tune.lateSiege.army": int(20, 150, "count", "out with this many soldiers and the engines", { needs: LATE_ON }),
};

/** Pairs that cannot be on together. */
export const PLAN_CONFLICTS: readonly { a: Need; b: Need; why: string }[] = [
  { a: on("towerRush"), b: on("rushBuildersOnly"), why: "the tower rush is escorted (towerRush) or its farmers alone, not both" },
];

/** The value at `path` in `plan` ("tune.fort.dist"); a missing tune reads TUNE. */
export function planValue(plan: Plan, path: string): unknown {
  let x: unknown = { ...plan, tune: plan.tune ?? TUNE };
  for (const k of path.split(".")) x = x === null || typeof x !== "object" ? undefined : (x as Record<string, unknown>)[k];
  return x;
}

const holds = (plan: Plan, n: Need): boolean => {
  const v = planValue(plan, n.field);
  if (n.values !== undefined) return n.values.includes(v as string | number | boolean);
  return v === true || (typeof v === "number" && v > 0) || (typeof v === "string" && v !== "");
};
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The defaults a field that does not matter must keep. */
const DEFAULT: Plan = { ...planFor("push", "h1", "close"), tune: TUNE };

function tableErrors(path: string, v: unknown, t: TableSpace): string[] {
  const bad = (why: string) => [`${path}: ${why}`];
  if (!Array.isArray(v)) return bad("not an array");
  const whole = (x: unknown, lo: number, hi: number) => typeof x === "number" && Number.isInteger(x) && x >= lo && x <= hi;
  if (t.kind === "shares") {
    if (v.length !== t.length || !v.every((x) => whole(x, 0, t.sum))) return bad(`${t.length} whole percents`);
    return v.reduce((a: number, b: number) => a + b, 0) === t.sum ? [] : bad(`shares add up to ${t.sum}`);
  }
  if (v.length < t.length[0] || v.length > t.length[1]) return bad(`${t.length[0]}-${t.length[1]} rows`);
  const minutes: number[] = [];
  for (const row of v) {
    if (t.kind === "minutes") {
      if (!whole(row, t.minute[0], t.minute[1])) return bad(`minutes ${t.minute[0]}-${t.minute[1]}`);
      minutes.push(row as number);
    } else {
      if (!Array.isArray(row) || row.length !== 2 || !whole(row[0], t.minute[0], t.minute[1]) || !whole(row[1], t.value[0], t.value[1])) return bad(`[minute ${t.minute[0]}-${t.minute[1]}, value ${t.value[0]}-${t.value[1]}] pairs`);
      minutes.push(row[0]);
    }
  }
  return minutes.every((m, k) => k === 0 || m > minutes[k - 1]) ? [] : bad("minutes rising");
}

/** What is wrong with `plan` on `map`: types and ranges, fields that need another on, the fixed map only, conflicts. */
export function validatePlan(plan: Plan, map: MapMode): string[] {
  const errors: string[] = [];
  for (const [path, f] of Object.entries(PLAN_SPACE)) {
    const v = planValue(plan, path);
    if (f.type === "bool") {
      if (typeof v !== "boolean") errors.push(`${path}: not true or false`);
    } else if (f.type === "enum") {
      if (!f.values!.includes(v as string)) errors.push(`${path}: one of ${f.values!.map((x) => JSON.stringify(x)).join(", ")}`);
    } else if (f.type === "int") {
      const step = f.step ?? 1;
      if (typeof v !== "number" || !Number.isInteger(v)) errors.push(`${path}: not a whole number`);
      else if (v < f.min! || v > f.max!) errors.push(`${path}: ${v} outside ${f.min}-${f.max}`);
      else if ((v - f.min!) % step !== 0 && !same(v, planValue(DEFAULT, path))) errors.push(`${path}: ${v} not ${f.min} + a multiple of ${step}`);
    } else errors.push(...tableErrors(path, v, f.table!));
    const changed = !same(v, planValue(DEFAULT, path));
    if (!changed) continue;
    const missing = (f.needs ?? []).filter((n) => !holds(plan, n));
    if (missing.length > 0) errors.push(`${path}: does nothing unless ${missing.map(needText).join(" and ")} (keep it ${JSON.stringify(planValue(DEFAULT, path))})`);
    if (f.needsAny !== undefined && !f.needsAny.some((n) => holds(plan, n))) errors.push(`${path}: does nothing unless ${f.needsAny.map(needText).join(" or ")} (keep it ${JSON.stringify(planValue(DEFAULT, path))})`);
    if (f.fixedOnly && map !== "fixed") errors.push(`${path}: on the fixed map only`);
  }
  for (const c of PLAN_CONFLICTS) if (holds(plan, c.a) && holds(plan, c.b)) errors.push(`${c.a.field} and ${c.b.field}: ${c.why}`);
  return errors;
}

function needText(n: Need): string {
  return n.values === undefined ? `${n.field} is on` : `${n.field} is ${n.values.map((x) => JSON.stringify(x)).join(" or ")}`;
}

/** Paths a partial plan may set: PLAN_SPACE's, and their parents (objects of the tune). */
function walk(partial: unknown, prefix: string, errors: string[]): void {
  if (partial === null || typeof partial !== "object" || Array.isArray(partial)) {
    errors.push(`${prefix || "plan"}: not an object`);
    return;
  }
  for (const [k, v] of Object.entries(partial as Record<string, unknown>)) {
    const path = prefix === "" ? k : `${prefix}.${k}`;
    if (path in PLAN_SPACE) continue;
    if (Object.keys(PLAN_SPACE).some((p) => p.startsWith(`${path}.`))) walk(v, path, errors);
    else errors.push(`${path}: no such field`);
  }
}

function lay(base: Record<string, unknown>, partial: Record<string, unknown>, prefix: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(partial)) {
    const path = prefix === "" ? k : `${prefix}.${k}`;
    out[k] = path in PLAN_SPACE ? structuredClone(v) : lay(base[k] as Record<string, unknown>, v as Record<string, unknown>, path);
  }
  return out;
}

/**
 * `partial` (parsed JSON: some fields of Plan, the tune nested) laid over `plan`; throws listing every unknown field and
 * everything validatePlan finds on `map`. The result has its own tune.
 */
export function applyPlan(plan: Plan, partial: unknown, map: MapMode): Plan {
  const errors: string[] = [];
  walk(partial, "", errors);
  if (errors.length > 0) throw new Error(`--plan: ${errors.join("; ")}`);
  const out = lay({ ...plan, tune: structuredClone(plan.tune ?? TUNE) } as unknown as Record<string, unknown>, partial as Record<string, unknown>, "") as unknown as Plan;
  const wrong = validatePlan(out, map);
  if (wrong.length > 0) throw new Error(`--plan: ${wrong.join("; ")}`);
  return out;
}

export type { Tune };
