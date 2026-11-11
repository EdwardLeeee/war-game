// scripted-games.ts's command line: the groups' options, the plan they make, and --plan laid over it (D-147,
// plan-space.ts). A function, so tests and war-game-ai's tools read the CI groups' plans without playing.

import { readFileSync } from "node:fs";
import { FORMATIONS, type Formation, type Plan, planFor, SCRIPTED_THINK_EVERY, SPEEDS, type Speed, STRATEGIES, type Strategy } from "./ai/scripted-player.ts";
import { AI_STYLES } from "./ai/ai.ts";
import { AI_DIFFICULTIES, type AiDifficulty, MAP_MODES, type MapMode } from "./protocol.ts";
import { lateSiege, WATCH_TICKS } from "./late-start.ts";
import { applyPlan } from "./plan-space.ts";

/** "1-5" or "1,3,7" (or both: "1-3,9"). */
function seedList(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(",")) {
    const [a, b] = part.split("-").map(Number);
    if (b === undefined) out.push(a);
    else for (let s = a; s <= b; s++) out.push(s);
  }
  return out;
}

export interface ScriptedArgs {
  strategy: Strategy;
  speed: Speed;
  formation: Formation;
  difficulty: AiDifficulty;
  mapMode: MapMode;
  style: string;
  seeds: number[];
  think: number;
  /** In ticks. */
  cap: number;
  trace: boolean;
  jsonOut: string;
  plan: Plan;
  /** --plan as given ("": none). */
  planText: string;
  probeMode: string;
  probeFrom: number;
  /** In ticks. */
  takeover: number;
  bonus: number;
}

/** scripted-games' options from `argv` (process.argv or the words of a CI group's args). */
export function scriptedArgs(argv: readonly string[]): ScriptedArgs {
  const arg = (name: string, fallback: string): string => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
  };
  const flag = (name: string) => argv.includes(`--${name}`);
  function oneOf<T extends string>(name: string, values: readonly T[], fallback: T): T {
    const v = arg(name, fallback);
    if (!(values as readonly string[]).includes(v)) throw new Error(`--${name} ${v}: one of ${values.join(", ")}`);
    return v as T;
  }

  const strategy = oneOf<Strategy>("strategy", STRATEGIES, "defend");
  const speed = oneOf<Speed>("speed", SPEEDS, "h1");
  const formation = oneOf<Formation>("formation", FORMATIONS, "close");
  const difficulty = oneOf<AiDifficulty>("difficulty", AI_DIFFICULTIES, "normal");
  const mapMode = oneOf<MapMode>("map", MAP_MODES, "fixed");
  /** The AI's style for every game; empty: drawn from the seed, as in an ordinary game. */
  const style = arg("style", "");
  if (style !== "" && !(AI_STYLES as readonly string[]).includes(style)) throw new Error(`--style ${style}: one of ${AI_STYLES.join(", ")}`);
  const seeds = seedList(arg("seeds", "1-5"));
  const think = Number(arg("think", String(SCRIPTED_THINK_EVERY)));
  /** Games still going at this game minute are stopped and counted apart. */
  const CAP = Number(arg("cap", "120")) * 1200;
  const trace = flag("trace");
  const jsonOut = arg("json", "");
  const plan = planFor(strategy, speed, formation);
  // Options outside the fixed groups (ceo's measurements, D-046): the economy ratio left at
  // 40/35/25, no mage hall, no range (with --no-mage too: spearmen only).
  if (flag("static-ratio")) plan.staticRatio = true;
  if (flag("no-mage")) plan.noMage = true;
  if (flag("no-range")) plan.noRange = true;
  if (flag("corners")) plan.corners = true;
  if (flag("auto-train")) plan.autoTrain = true;
  // Round 7 (D-061): every town taken is governed, not plundered.
  if (flag("govern")) plan.choice = "govern";
  // The soldiers left in a town, and whether they guard it (`guard`): how much stronger a guarded town is.
  if (arg("guards", "") !== "") plan.guards = Number(arg("guards", ""));
  if (flag("town-guard")) plan.townGuard = true;
  // Round 7 (D-061): cavalry raiders, this many (--raid 4).
  plan.raid = Number(arg("raid", "0"));
  // D-141 --steal-probe away|home (from minute --steal-from, 15; PROBE_AT in scripted-play.ts): the player gets PROBE.cavalry cavalry PROBE.from cells
  // from the AI's main city, sent at it, the first time the AI's army is out (PROBE.outMin or more of its soldiers beyond
  // PROBE.out cells of its city) or at home (PROBE.homeMin or more within PROBE.home, fewer than PROBE.outFew out). The
  // scripted player builds no such group itself against hard (it trains 5-12 cavalry and loses its army by minute 25), so
  // the probe puts it there: whether a steal takes the city, how long the city holds, whether the AI comes back for it.
  // D-141: this many siege engines kept up and taken along on marches on the AI's main city (plan.engines).
  plan.engines = Number(arg("engines", "0"));
  const probeMode = arg("steal-probe", "");
  const probeFrom = Number(arg("steal-from", "15"));
  // D-141: stealing the main city with 30 cavalry (or --raid N): "home" as soon as the group is full, "away" while the AI's army is out.
  const steal = arg("steal", "");
  if (steal === "home" || steal === "away") {
    plan.steal = steal;
    if (plan.raid === 0) plan.raid = 30;
    // Its cavalry are the group's.
    plan.cavalryShare = 0;
  }
  // D-072: racing the AI to its main city (--race edge|sentry), with these numbers.
  const race = arg("race", "");
  if (race !== "" && race !== "edge" && race !== "sentry") throw new Error(`--race ${race}: edge or sentry`);
  plan.race = race;
  plan.raceAt = Number(arg("race-at", String(plan.raceAt)));
  plan.raceSeen = Number(arg("race-seen", String(plan.raceSeen)));
  plan.raceBy = Number(arg("race-by", String(plan.raceBy / 1200))) * 1200;
  plan.raceStage = flag("race-stage");
  // D-080: the tower rush, with this many spearmen (--tower-rush 6), or its builders alone (--tower-rush-farmers).
  plan.towerRush = Number(arg("tower-rush", "0"));
  plan.rushBuildersOnly = flag("tower-rush-farmers");
  // D-081: the midway fortress (--fortress).
  plan.fortress = flag("fortress");
  // D-119: the spearmen posted at the fortress (--fort-guards 0: none; absent: as many as an outpost takes).
  if (arg("fort-guards", "") !== "") plan.fortGuards = Number(arg("fort-guards", ""));
  // D-081: the army holds by the fortress until it is this many or minute 30 (--fortress-hold 60).
  plan.fortressHold = Number(arg("fortress-hold", "0"));
  if (plan.fortressHold > 0) plan.fortress = true;
  // D-086 A (the user's long wins against hard, docs/research/2026-10-ai-late.md): 24 farmers, ranged
  // first, 2 arrow towers by home, cavalry a sixth of the army, every town taken governed (town after
  // town), and the march on the AI's main city with 50 or more, more than it saw of the AI's army lately.
  if (flag("late")) {
    plan.farmers = 24;
    plan.production = 4;
    plan.spearShare = 35;
    plan.choice = "govern";
    plan.corners = true;
    plan.townAt = 10;
    plan.homeTowers = 2;
    plan.cavalryShare = 15;
    plan.pushAt = 50;
    plan.counterAt = 50;
    plan.pushAhead = true;
  }
  // D-086 A3: this many soldiers go for the AI's farmers far from its main city (--late --harass 10).
  plan.harass = Number(arg("harass", "0"));
  // D-086 A5 (ceo 2026-10-22; the user's long wins against hard, f331df3c 77.5 min and 6a024b3c 81 min):
  // 40 farmers, arrow towers by home by the clock and by every town it governs, outposts by home, every
  // town taken governed (town after town, the big city too), and the march with 100 or more, a third
  // cavalry, more than it saw of the AI's army lately. With --cap 90 in CI.
  if (flag("turtle")) {
    plan.farmers = 40;
    plan.production = 4;
    plan.choice = "govern";
    plan.corners = true;
    plan.townAt = 60;
    plan.guards = 3;
    plan.cavalryShare = 30;
    plan.pushAt = 100;
    plan.counterAt = 100;
    plan.pushAhead = true;
    plan.turtle = true;
  }
  // push-crush (ceo 2026-10-25, for war-game-ai): the turtle, out after a big wave beaten off at home, the
  // AI's governed towns first (--crush).
  if (flag("crush")) {
    plan.farmers = 40;
    plan.production = 4;
    plan.choice = "govern";
    plan.corners = true;
    plan.townAt = 60;
    plan.guards = 3;
    plan.cavalryShare = 30;
    plan.pushAt = 100;
    plan.counterAt = 100;
    plan.pushAhead = true;
    plan.turtle = true;
    plan.crush = true;
  }
  // push-late-siege (D-115, ceo 2026-10-31: the user's late game in 8d02b76f): the turtle with farmers and towers by
  // that game's clock, 1-4 towns governed, a siege works and 3 engines, out with 100 soldiers (--late-siege).
  if (flag("late-siege")) lateSiege(plan);
  /**
   * push-late-siege's --takeover N (ceo 2026-11-03): the scripted player plays normal up to minute N; from N - 3 the AI of
   * --difficulty watches (thinks, its orders dropped) and from N it plays normal's side (late-start.ts). 0: none.
   */
  const TAKEOVER = Number(arg("takeover", "0")) * 1200;
  /**
   * push-crush (ceo 2026-10-25): the player's gathering of food, wood and gold plus this many percent (--bonus
   * 50), credited every 20 ticks in equal shares of the three (its own gold runs out, and a share of nothing is
   * nothing); for the measurement only (the game's log does not replay it). 0: none.
   */
  const BONUS = Number(arg("bonus", "0"));
  if (TAKEOVER > 0 && TAKEOVER < WATCH_TICKS) throw new Error(`--takeover: from minute ${WATCH_TICKS / 1200} on`);
  // Barracks plus ranges at most (--production 8; else the plan's).
  plan.production = Number(arg("production", String(plan.production)));
  // With the turtle (ceo 2026-10-25): town trips as the push's, with this many soldiers and no towers by home
  // needed, every town taken governed (--early-towns 6).
  if (arg("early-towns", "") !== "") {
    plan.earlyTowns = true;
    plan.townAt = Number(arg("early-towns", "6"));
  }
  // D-097: cavalry this share of its soldiers (percent), a stable once it has a range (--cavalry-share 18).
  plan.cavalryShare = Number(arg("cavalry-share", String(plan.cavalryShare)));
  // D-072: the user's economy (ai's replay of the game they beat hard): automatic training, 16
  // farmers, no gold until the plunder, one trip, to the big town with 10 soldiers.
  // D-135: how early a mage may come (no crystal: as soon as it can pay for the hall and the mage).
  if (flag("mage-rush")) {
    plan.mageRush = true;
    plan.hallFirst = true;
  }
  if (flag("user-eco")) {
    plan.userEco = true;
    plan.bigTown = true;
    plan.autoTrain = true;
    plan.hallFirst = false;
    plan.farmers = 16;
    plan.townAt = 10;
    plan.again = false;
  }
  // D-147 (war-game-ai's search): --plan '{"pushAt": 40, "tune": {"fort": {"dist": 30}}}' or --plan FILE, some fields of
  // Plan laid over the plan the options above made; anything unknown, of the wrong type, out of range, set while what it
  // needs is off, or off the fixed map stops it (plan-space.ts).
  const planText = arg("plan", "");
  const given = planText === "" ? plan : applyPlan(plan, JSON.parse(planText.trimStart().startsWith("{") ? planText : readFileSync(planText, "utf8")), mapMode);
  return { strategy, speed, formation, difficulty, mapMode, style, seeds, think, cap: CAP, trace, jsonOut, plan: given, planText, probeMode, probeFrom, takeover: TAKEOVER, bonus: BONUS };
}
