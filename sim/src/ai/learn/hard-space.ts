// D-147 PR C (selftrain-plan 4.3; ceo 2026-11-24): the fields of hard's plan the training may change, each with its range
// and why, and the fields it never changes, each with why. Never imported by the simulation Worker; changes nothing in
// ai.ts (a value the training finds goes into the game only later, as a change of ai.ts's constants: it breaks saves,
// and the user decides whether as a new difficulty or in place of hard, D-147).
//
// Fields that change no game of the examiners', hard and normal under the rules as they are are fixed too (HARD_FIXED,
// measured; ceo 2026-11-25): each proposal of them would be the champion's games again.
//
// The ranges keep a plan legal and not plainly broken (ceo: "no march with 0 soldiers"): each is around hard's own value
// (HARD), never past what a rule or a measurement already showed to fail, and validateHard checks what crosses fields.
// A proposal out of range is dropped before any game is played (gen.ts).

import { createHash } from "node:crypto";
import { HARD, type HardPlan } from "../ai.ts";

export type HP = Partial<HardPlan>;
export type Field = keyof HardPlan;

export interface IntSpace {
  type: "int";
  min: number;
  max: number;
  step: number;
  /** Fields that must be on (true, or above 0) for this one to change anything: not changed while they are not. */
  needs?: Field[];
  /** At least one of these must be on. */
  needsAny?: Field[];
  why: string;
}
export interface BoolSpace {
  type: "bool";
  needs?: Field[];
  needsAny?: Field[];
  why: string;
}
export type Space = IntSpace | BoolSpace;

const int = (min: number, max: number, step: number, why: string, needs?: Field[], needsAny?: Field[]): IntSpace => ({ type: "int", min, max, step, why, ...(needs ? { needs } : {}), ...(needsAny ? { needsAny } : {}) });
const bool = (why: string, needs?: Field[]): BoolSpace => ({ type: "bool", why, ...(needs ? { needs } : {}) });

/** The fields the training may change. Population ceiling 200 (rules.ts POPULATION_200), mages at most 6. */
export const HARD_SPACE: Partial<Record<Field, Space>> = {
  // Economy.
  farmers: int(22, 44, 2, "each game +-2 already; 14 with production 1 lost clearly (PR B trial weak); 44 leaves 150 of the 200 for soldiers"),
  production: int(2, 6, 1, "at least a barracks and a range for the mix; 1 lost clearly (PR B trial weak)"),
  sites: int(1, 3, 1, "0 would build nothing; more than 3 at once spreads the farmers thin"),
  woodShift: bool("a ratio switch measured on (D-086 A6); off is as before A6"),
  woodFarmers: int(0, 6, 2, "extra farmers while wood is short; 0 is as before"),
  ratioCalm: bool("on with A8 (fewer ratio changes); off is as before"),
  lumberFar: int(3, 10, 1, "a new lumber camp once trees are this far (cells); A8 found 6; under 3 builds camps on every move"),
  shortEither: bool("measured off (D-086 A3)"),
  farmerFood: int(0, 100, 25, "food left for farmers; 0 is as before", ["farmers"]),
  mageHallFirst: int(6, 16, 2, "minute the mage hall comes first (D-135); the user's first mage 12.1-14.2"),
  // The mix.
  spearShare: int(30, 70, 5, "each game +-5 already; past 30-70 one counter beats it"),
  counterMix: int(0, 30, 5, "points toward what beats the enemy's mix; 0 never"),
  cavalryMix: int(10, 40, 5, "enemy cavalry share that moves the mix (D-097 found 15)", ["counterCavalry"]),
  cavalry: int(0, 20, 5, "cavalry while wood is short (D-086 A); 0 as before"),
  goldCavalry: int(0, 40, 5, "cavalry first while gold piles (A6 found 25)"),
  cavalryCounter: int(0, 30, 5, "cavalry against ranged and mages (D-097 found 20)"),
  cavalryWhen: int(0, 50, 10, "enemy ranged and mages share before cavalry", ["cavalryCounter"]),
  cavalryRandomOnly: bool("D-097: cavalry lost on the fixed map, won on random ones"),
  charge: bool("A4: cavalry charge ranged and mages", ["cavalryCounter"]),
  // The army: sizes and when to go.
  townArmy: int(3, 10, 1, "fewer than 3 do not beat a small town's militia", ["bigArmy"]),
  bigArmy: int(10, 24, 2, "the big town's keep holds 12 down (D-100)"),
  keepTownArmy: int(6, 16, 2, "towns with a keep (D-100 found 10)"),
  keepBigArmy: int(14, 30, 2, "the big town with a keep (D-100 found 20)"),
  keepContest: bool("measured off (D-100)"),
  pushArmy: int(34, 60, 2, "R8: 31-37 fell under the break-off at the city, 44 took it (PR #171); 60 is still a march of a quarter of the population"),
  strongPush: int(0, 60, 10, "D-100: a march when strong enough; 0 as before"),
  strongRatio: int(150, 300, 25, "how much stronger for strongPush", ["strongPush"]),
  counterArmy: int(8, 24, 2, "soldiers striking back after a wave; under 8 die to what is left of it"),
  cityAgain: int(0, 150, 25, "D-089: share of the last march before marching on the city again; 0 as before"),
  peekFirst: int(0, 6, 2, "minutes without a sighting before a scout looks first; 0 never"),
  foeMemory: bool("D-086 A3, measured off"),
  foeDecay: int(5, 20, 5, "percent a minute the remembered enemy shrinks", ["foeMemory"]),
  foeGrow: bool("the remembered enemy grows as it trains", ["foeMemory"]),
  // Home and towns.
  recallAt: int(0, 8, 1, "enemy soldiers near the main city before the farmers hide; 0 never"),
  pullAll: int(1, 8, 1, "enemy soldiers near home that call the army back; 1 any"),
  dodge: bool("steps out of cannon warnings"),
  hide: bool("ranged and mages hide in the city with enemies near"),
  looseAt: int(0, 4, 1, "enemy mages before a loose formation; 0 never"),
  looseWho: int(1, 2, 1, "1 ranged and mages, 2 every soldier", ["looseAt"]),
  townRest: int(0, 3, 1, "D-081: minutes a town is left alone after falling back; 0 never"),
  townQuickRest: int(0, 3, 1, "D-131: the same after a quick break-off (found 1)"),
  governFrom: int(0, 20, 5, "minute from which a town taken is governed; 0 never (D-086 A)"),
  governSpare: int(0, 200, 50, "food and gold kept besides", ["governFrom"]),
  governNearest: bool("only the nearest small town", ["governFrom"]),
  governHold: bool("A7: govern what it can hold"),
  governTowers: int(0, 3, 1, "towers by a governed town"),
  holdTowns: bool("A6: hold its towns"),
  econBehind: bool("A6: behind on towns, go for them on even terms"),
  townSave: bool("A5: save for a town's governing"),
  townScout: bool("A4: scout the random map for towns"),
  ruinsAgain: bool("A4, measured off"),
  mineMove: bool("A4, measured off"),
  rescue: bool("A3: soldiers go to farmers under attack far off"),
  // Towers and being behind.
  towers: int(0, 4, 1, "towers by its main city; 0 none"),
  townTowers: int(0, 3, 1, "towers by each governed town; 0 none"),
  towerSpare: int(50, 300, 50, "wood and gold kept besides a tower", undefined, ["towers", "townTowers"]),
  behind: bool("A5: towers and outposts when behind"),
  behindFail: bool("a broken-off march counts as behind", ["behind"]),
  behindTowers: int(1, 6, 1, "towers by its main city when behind", ["behind"]),
  behindTownTowers: int(0, 4, 1, "towers by a governed town when behind", ["behind"]),
  behindOutpost: bool("an outpost toward the threat when behind", ["behind"]),
  behindGuards: int(2, 8, 2, "spearmen posted there", ["behindOutpost"]),
  // Forts on the way.
  cityForts: bool("A5: forts by the enemy's main city counted when weighing a march; measured off"),
  fortStage: bool("A4: gather outside forts' reach first"),
  fortAgain: bool("A4: after a break-off at forts, the next go takes more"),
  fortArmyBy: int(10, 16, 1, "P1: tenths the enemy by forts counts (13)"),
  fortIntel: int(2, 6, 1, "P1: minutes a sighting by forts counts (4)"),
  fortLockOver: int(0, 4, 1, "P4: 2 lost 7.5 and 14.6 more soldiers a game, left 0"),
  // Tactics.
  focusFire: bool("D-131: ranged shoot the weakest in reach"),
};

/**
 * The fields never changed, each with why. Fixes for what the user's games showed are kept on: no examiner plays that
 * way, so the exam cannot see that turning one off is worse, and a search would drop them for nothing.
 */
const D135 = "D-135: no crystal under the rules as they are (NO_CRYSTAL), so it does nothing";
/**
 * Measured 2026-11-24/25 (ceo): under the rules as they are (main f1b7906b, sim build id 40b95e9b4837) no game of `n` of
 * hard with the field one step from hard, and at the ends of its range (a switch flipped), differed from the same game
 * of hard without the change: the three examiners' plans, hard (the champion's side) and normal, on new seeds. A field that
 * changes no game of those is dropped by the screening (its proposals are the champion's games), so each proposal of it would be
 * wasted. It is not a proof that it can do nothing: the examiners changed, or the rules, and it is measured again.
 */
const measured = (n: number) => `measured: no game of ${n} differed (12 one step from hard, the rest at the ends of its range; the three examiners, hard, normal); the examiners or the rules changed, measure again`;
export const HARD_FIXED: Partial<Record<Field, string>> = {
  net: "the network: PR C2",
  netLog: "learn/ only",
  netSeen: "learn/ only",
  netMarch: "only with the network",
  netFarmers: "only with the network",
  farAvoid: "D-130: a squad by its far work spots killed 67 farmers; no examiner does that",
  hideFar: "D-086 A3: the farmers by such a spot go home; the same",
  buildSafe: "A4: buildings put down where the enemy stands, paid for each; a fix",
  routeFromArmy: "A9: armies turning back every half second; a fix",
  fortExit: "A9: forts barring an army many times them; a fix",
  aheadHold: "P2: 104-150 soldiers stood still by a fortress in the user's game; a fix",
  fortArmyWorth: "P1: no automated opponent shows it, the user's games do",
  cornerGuess: "D-139: where the enemy's main city is; a fix",
  lumberMove: "D-096: one lumber camp all game in the user's game; a fix",
  // D-135 (rules.ts NO_CRYSTAL): the mage hall's crystal condition is cut short, the maps have no vein, crystal is always 0.
  vein: D135,
  crystalStop: D135,
  mageReserve: D135,
  productionFirst: measured(36),
  counterCavalry: measured(36),
  chargeRest: measured(60),
  pushRatio: measured(60),
  cityCap: measured(36),
  cityForget: measured(36),
  rescueRest: measured(60),
  towerFirst: measured(36),
};

/** The fields neither searched nor fixed: none may be left out (a test checks every field of HARD is in one of them). */
export const fieldsOf = () => Object.keys(HARD) as Field[];

const isOn = (plan: HardPlan, f: Field) => {
  const v = plan[f];
  return typeof v === "boolean" ? v : typeof v === "number" ? v > 0 : v !== null && v !== undefined;
};

/** Whether field `f` can change anything in `plan` (its needs on, and one of its needsAny). */
export function active(plan: HardPlan, f: Field): boolean {
  const s = HARD_SPACE[f];
  const any = s?.needsAny ?? [];
  return (s?.needs ?? []).every((n) => isOn(plan, n)) && (any.length === 0 || any.some((n) => isOn(plan, n)));
}

/** Why `p` (over HARD) is not a plan the training may examine; "" when it is. */
export function validateHard(p: HP): string {
  const plan = { ...HARD, ...p } as HardPlan;
  for (const [k, v] of Object.entries(p) as [Field, unknown][]) {
    if (HARD_FIXED[k] !== undefined) {
      if (v !== HARD[k]) return `${k} is never changed (${HARD_FIXED[k]})`;
      continue;
    }
    const s = HARD_SPACE[k];
    if (s === undefined) return `${k} is not a field of hard's plan`;
    if (s.type === "bool") {
      if (typeof v !== "boolean") return `${k}: ${String(v)} is not true or false`;
      continue;
    }
    if (typeof v !== "number" || !Number.isInteger(v)) return `${k}: ${String(v)} is not a whole number`;
    if (v < s.min || v > s.max) return `${k}: ${v} is outside ${s.min}-${s.max} (${s.why})`;
    if ((v - s.min) % s.step !== 0 && v !== HARD[k]) return `${k}: ${v} is off its steps of ${s.step} from ${s.min}`;
  }
  // Across fields: armies in the order they are used, and room for them.
  if (plan.townArmy > plan.bigArmy) return `townArmy ${plan.townArmy} over bigArmy ${plan.bigArmy}`;
  if (plan.bigArmy > plan.pushArmy) return `bigArmy ${plan.bigArmy} over pushArmy ${plan.pushArmy}`;
  if (plan.keepTownArmy > plan.keepBigArmy) return `keepTownArmy ${plan.keepTownArmy} over keepBigArmy ${plan.keepBigArmy}`;
  if (plan.counterArmy > plan.pushArmy) return `counterArmy ${plan.counterArmy} over pushArmy ${plan.pushArmy}`;
  if (plan.farmers + plan.pushArmy > 160) return `farmers ${plan.farmers} and pushArmy ${plan.pushArmy} leave under 40 of the 200 for the rest`;
  return "";
}

/** A plan's hash: its JSON with the keys sorted, 12 hex digits. */
export function planHash(p: HP): string {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sorted) : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])])) : v;
  return createHash("sha256").update(JSON.stringify(sorted(p))).digest("hex").slice(0, 12);
}

/** The plan with only what differs from HARD: a plan that plays as another has its hash. */
export function normalize(p: HP): HP {
  return Object.fromEntries(Object.entries(p).filter(([k, v]) => v !== HARD[k as Field])) as HP;
}
