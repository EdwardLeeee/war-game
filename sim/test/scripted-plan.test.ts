// D-147: the scripted player's plan from outside (scripted-games --plan, plan-space.ts, playScripted). Every CI group's
// plan lies in PLAN_SPACE; every field of the plan has a range; --plan reports what is wrong; the CLI's presets written
// as --plan make the same plan; playScripted leaves the caller's plan alone, plays the same with hard {} as without,
// and records the plan and the forts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { type Plan, planFor, TUNE } from "../src/ai/scripted-player.ts";
import { applyPlan, PLAN_SPACE, planValue, validatePlan } from "../src/plan-space.ts";
import { scriptedArgs } from "../src/scripted-args.ts";
import { type GameRecord, playScripted, type ScriptedOptions } from "../src/scripted-play.ts";

const MIN = 1200;

/** The args of every scripted group in sim.yml. */
function ciGroups(): string[][] {
  const yml = readFileSync(new URL("../../.github/workflows/sim.yml", import.meta.url), "utf8");
  return [...yml.matchAll(/args: (--strategy [^}]*?) \}/g)].map((m) => m[1].trim().split(/\s+/));
}

/** Every leaf path of the plan (the tune's objects walked; arrays are leaves). */
function leaves(x: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(x).flatMap(([k, v]) => {
    const path = prefix === "" ? k : `${prefix}.${k}`;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? leaves(v as Record<string, unknown>, path) : [path];
  });
}

function deepFreeze<T>(x: T): T {
  if (x !== null && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

test("every CI group's plan lies in PLAN_SPACE", () => {
  const groups = ciGroups();
  assert.ok(groups.length >= 40, `${groups.length} groups`);
  for (const args of groups) {
    const a = scriptedArgs(args);
    assert.deepEqual(validatePlan(a.plan, a.mapMode), [], args.join(" "));
  }
});

test("every field of the plan has a range in PLAN_SPACE, and every range a field", () => {
  const plan = { ...planFor("push", "h1", "close"), tune: TUNE } as unknown as Record<string, unknown>;
  const paths = leaves(plan);
  for (const p of paths) assert.ok(p in PLAN_SPACE, `${p} has no range`);
  for (const p of Object.keys(PLAN_SPACE)) assert.ok(paths.includes(p), `${p} is no field`);
  for (const [p, f] of Object.entries(PLAN_SPACE)) {
    if (f.type !== "int") continue;
    const v = planValue(plan as unknown as Plan, p) as number;
    assert.ok(v >= f.min! && v <= f.max!, `${p}: the default ${v} outside ${f.min}-${f.max}`);
  }
  // Without --plan the plan carries no tune (TUNE is read), as before.
  assert.equal(scriptedArgs(["--strategy", "push"]).plan.tune, undefined);
});

test("--plan: unknown fields, wrong types, out of range, needs, the fixed map, conflicts and tables are errors", () => {
  const base = planFor("push", "h1", "close");
  const wrong = (partial: unknown, map: "fixed" | "random", ...bits: string[]) => {
    assert.throws(() => applyPlan(base, partial, map), (e: Error) => bits.every((b) => e.message.includes(b)), JSON.stringify(partial));
  };
  wrong({ pushAtt: 30 }, "fixed", "pushAtt: no such field");
  wrong({ tune: { fort: { far: 3 } } }, "fixed", "tune.fort.far: no such field");
  wrong({ tune: 3 }, "fixed", "tune: not an object");
  wrong({ pushAt: "30" }, "fixed", "pushAt: not a whole number");
  wrong({ pushAt: 30.5 }, "fixed", "pushAt: not a whole number");
  wrong({ corners: 1 }, "fixed", "corners: not true or false");
  wrong({ choice: "keep" }, "fixed", "choice: one of");
  wrong({ pushAt: 151 }, "fixed", "pushAt: 151 outside 0-150");
  wrong({ spearShare: 52 }, "fixed", "spearShare: 52 not 0 + a multiple of 5");
  wrong({ raceAt: 40 }, "fixed", "raceAt: does nothing unless race is on");
  wrong({ tune: { fort: { dist: 30 } } }, "fixed", "tune.fort.dist: does nothing unless fortress is on");
  wrong({ guards: 4 }, "fixed", 'guards: does nothing unless choice is "govern"');
  wrong({ race: "edge" }, "random", "race: on the fixed map only");
  wrong({ towerRush: 6, rushBuildersOnly: true }, "fixed", "towerRush and rushBuildersOnly");
  wrong({ turtle: true, tune: { turtle: { boomFood: [50, 30, 30] } } }, "fixed", "shares add up to 100");
  wrong({ turtle: true, tune: { turtle: { towers: [[20, 7], [14, 0]] } } }, "fixed", "minutes rising");
  // Every error at once.
  wrong({ pushAt: 999, raceAt: 40 }, "fixed", "pushAt: 999", "raceAt:");
  // What needs it on, given, passes; the base plan and TUNE are left alone.
  const before = JSON.stringify(base);
  const tune = JSON.stringify(TUNE);
  const p = applyPlan(base, { fortress: true, tune: { fort: { dist: 30 } }, race: "sentry", raceSeen: 8 }, "fixed");
  assert.equal(p.tune!.fort.dist, 30);
  assert.equal(p.tune!.fort.from, TUNE.fort.from);
  assert.equal(p.raceSeen, 8);
  assert.equal(JSON.stringify(base), before);
  assert.equal(JSON.stringify(TUNE), tune);
});

test("the presets written as --plan make the same plan; a recorded plan passes as it is", () => {
  const presets: [string[], Record<string, unknown>][] = [
    [["--late"], { farmers: 24, production: 4, spearShare: 35, choice: "govern", corners: true, townAt: 10, homeTowers: 2, cavalryShare: 15, pushAt: 50, counterAt: 50, pushAhead: true }],
    [["--turtle"], { farmers: 40, production: 4, choice: "govern", corners: true, townAt: 60, guards: 3, cavalryShare: 30, pushAt: 100, counterAt: 100, pushAhead: true, turtle: true }],
    [["--crush", "--early-towns", "6"], { farmers: 40, production: 4, choice: "govern", corners: true, townAt: 6, guards: 3, cavalryShare: 30, pushAt: 100, counterAt: 100, pushAhead: true, turtle: true, crush: true, earlyTowns: true }],
    [["--late-siege"], { production: 4, choice: "govern", corners: true, townAt: 60, guards: 3, cavalryShare: 30, pushAt: 100, counterAt: 100, pushAhead: true, turtle: true, lateSiege: true }],
    [["--user-eco"], { userEco: true, bigTown: true, autoTrain: true, hallFirst: false, farmers: 16, townAt: 10, again: false }],
    [["--mage-rush"], { mageRush: true, hallFirst: true }],
    [["--race", "edge", "--race-stage", "--race-at", "99", "--race-by", "11.5"], { race: "edge", raceStage: true, raceAt: 99, raceBy: 11.5 * MIN }],
    [["--fortress-hold", "60", "--fort-guards", "0"], { fortress: true, fortressHold: 60, fortGuards: 0 }],
    [["--steal", "away"], { steal: "away", raid: 30, cavalryShare: 0 }],
  ];
  for (const [flags, partial] of presets) {
    const a = scriptedArgs(["--strategy", "push", ...flags]);
    const b = scriptedArgs(["--strategy", "push", "--plan", JSON.stringify(partial)]);
    assert.deepEqual({ ...b.plan, tune: undefined }, { ...a.plan, tune: undefined }, flags.join(" "));
    assert.deepEqual(b.plan.tune, TUNE);
    // A record's plan (tune included) fed back whole.
    const whole = { ...a.plan, tune: TUNE };
    assert.deepEqual(validatePlan(whole, "fixed"), [], flags.join(" "));
    assert.deepEqual(applyPlan(planFor("defend", "eco", "all"), JSON.parse(JSON.stringify(whole)), "fixed"), whole);
  }
});

/** A short game. */
function short(more: Partial<ScriptedOptions> & { plan: Plan }): GameRecord {
  return playScripted({ seed: 2, difficulty: "hard", map: "fixed", style: "", think: 40, cap: 12 * MIN, trace: false, takeover: 0, bonus: 0, probe: "", probeFrom: 15, ...more });
}

test("playScripted: the caller's plan untouched, hard {} as without it, the plan and the forts recorded", () => {
  const plan = deepFreeze({ ...planFor("push", "h1", "close"), homeTowers: 2, tune: { ...TUNE, homeTowerAt: 7 } });
  const a = short({ plan });
  const b = short({ plan, hard: {} });
  assert.equal(b.finalHash, a.finalHash);
  assert.deepEqual(b, a);
  assert.deepEqual(a.plan, JSON.parse(JSON.stringify(plan)));
  assert.ok(a.forts.towers >= 1, `towers ${a.forts.towers}`);
  assert.equal(a.forts.outposts, 0);
  assert.ok(a.forts.firstTower !== null && a.forts.firstTower.toHome >= 5 && a.forts.firstTower.toHome <= 12, JSON.stringify(a.forts));
  // A hard of its own plays another game: 12 farmers, not 32.
  const c = short({ plan, hard: { farmers: 12 } });
  assert.notEqual(c.finalHash, a.finalHash);
  // The tune is played: the towers nearer home.
  const d = short({ plan: { ...plan, tune: { ...TUNE, homeTowerAt: 12 } } });
  assert.ok(d.forts.firstTower !== null && d.forts.firstTower.toHome > a.forts.firstTower!.toHome, `${JSON.stringify(d.forts)} against ${JSON.stringify(a.forts)}`);
});
