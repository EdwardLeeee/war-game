// D-086 B training (docs/research/2026-10-ai-nn.md): one game for training or measuring, played the way the
// Runner plays it (AIs think every AI_THINK_EVERY ticks, before the step) but with the plans given here.
// Never imported by the simulation Worker (ai.test.ts checks).

import { createAi, type HardPlan } from "../ai.ts";
import { createScriptedPlayer, type Plan, planFor, SCRIPTED_THINK_EVERY } from "../scripted-player.ts";
import { Game } from "../../core/game.ts";
import { KEEP } from "../../core/keep.ts";
import { MARKET, RICH, rules, SIEGE } from "../../core/rules.ts";
import { BuildingType, type Command, type CommandBody, type MapMode, MAX_TICKS, Resource, TownState, UnitType } from "../../protocol.ts";
import { UNIT_KINDS } from "../../core/world.ts";
import { AI_THINK_EVERY, aiKnowledge } from "../../runner.ts";
import { buildView, mapInfo } from "../../view/view.ts";

/**
 * Who the trained side plays against: hard (its own plan, by default HARD's), normal, the late scripted group
 * (D-086 A), or the scripted groups CI plays hard with (NN v2, ceo 2026-10-29, the user's "跟模仿你的測試玩家練"):
 * push (--strategy push --speed h1 --formation close; with cavalry, --cavalry-share 18), push-crush (--crush
 * --early-towns 6 --bonus 30) and push-turtle (--turtle).
 */
export type Opponent =
  | { kind: "hard"; plan?: Partial<HardPlan> }
  | { kind: "normal" }
  | { kind: "late" }
  | { kind: "push"; cavalry?: boolean }
  | { kind: "crush" }
  | { kind: "turtle" };

/**
 * Rule switches a game is played with (absent: as they are; on main since D-112 all on): KEEP, SIEGE, RICH
 * (RICH's contested gold stays as RICH.contested says) and MARKET. Set in the thread that plays the game (each
 * worker has its own), and back as they were after it.
 */
export interface Switches {
  keep?: boolean;
  siege?: boolean;
  rich?: boolean;
  market?: boolean;
}

export interface GameSpec {
  seed: number;
  map: MapMode;
  /** The trained side plays from spawn 1 (against a scripted player it always does: the scripted player is player 0). */
  swap: boolean;
  /** Time limit in ticks (0: none). */
  maxTicks: number;
  /** The trained side's plan (its net, and anything else). */
  me: Partial<HardPlan>;
  opp: Opponent;
  rules?: Switches;
}

export interface GameOutcome {
  /** 1: the trained side won, 0: lost, -1: no winner by the time limit. */
  won: number;
  ticks: number;
  /** At the end: (its soldiers - theirs) / (both + 1) plus (its city hp - theirs) / both full, each side's share, -2..2. */
  margin: number;
  /**
   * What D-086 A measured, for the trained side (ceo 2026-10-19: small rewards on the way): towns it governs
   * at minute 20; minutes 10-20 with wood under 50 and food plus gold 600 or more; its soldiers over theirs at
   * minutes 15 and 20 (-1: over by then); farmer losses of 5 or more in two minutes, and those back within 2
   * in three minutes; whether 10 or more of its soldiers ever stood within 12 cells of the enemy's main city.
   */
  governed20: number;
  stuck: number;
  ratio15: number;
  ratio20: number;
  farmerHits: number;
  farmerBack: number;
  reached: boolean;
  /** NN v2 (ceo 2026-10-29): its finished arrow towers and the towns it governs at minute 45 (-1: over by then). */
  towers45: number;
  governed45: number;
  /** The trained side's network: per head, how many thinks it made each choice (empty: no network). */
  choices: number[][];
  /** The switches the game was played with. */
  switches: Required<Switches>;
}

/** As scripted-games --strategy push --speed h1 --formation close --late (D-086 A). */
function latePlan(): Plan {
  const plan = planFor("push", "h1", "close");
  Object.assign(plan, { farmers: 24, production: 4, spearShare: 35, choice: "govern", corners: true, townAt: 10, homeTowers: 2, cavalryShare: 15, pushAt: 50, counterAt: 50, pushAhead: true });
  return plan;
}

/** As scripted-games --strategy push --speed h1 --formation close with the group's flags (sim.yml's push, push-cavalry, push-crush, push-turtle). */
function scriptedPlan(opp: Opponent): Plan {
  const plan = planFor("push", "h1", "close");
  if (opp.kind === "push" && opp.cavalry === true) plan.cavalryShare = 18;
  if (opp.kind === "crush" || opp.kind === "turtle") {
    Object.assign(plan, { farmers: 40, production: 4, choice: "govern", corners: true, townAt: 60, guards: 3, cavalryShare: 30, pushAt: 100, counterAt: 100, pushAhead: true, turtle: true });
  }
  if (opp.kind === "crush") Object.assign(plan, { crush: true, earlyTowns: true, townAt: 6 });
  return plan;
}

/** push-crush's --bonus 30: the scripted player's food, wood and gold gathered plus 30%, credited as scripted-games does. */
const CRUSH_BONUS = 30;

export function playGame(spec: GameSpec): GameOutcome {
  const was = { keep: KEEP.on, siege: SIEGE.on, rich: RICH.on, market: MARKET.on };
  const s = { ...was, ...spec.rules };
  KEEP.on = s.keep;
  SIEGE.on = s.siege;
  RICH.on = s.rich;
  MARKET.on = s.market;
  try {
    return play(spec);
  } finally {
    KEEP.on = was.keep;
    SIEGE.on = was.siege;
    RICH.on = was.rich;
    MARKET.on = was.market;
  }
}

function play(spec: GameSpec): GameOutcome {
  const maxTicks = spec.maxTicks > 0 ? spec.maxTicks : MAX_TICKS;
  const g = new Game({ seed: spec.seed, scenario: "standard", maxTicks, map: spec.map });
  const w = g.w;
  const scripted = spec.opp.kind !== "hard" && spec.opp.kind !== "normal";
  const me = scripted ? 1 : spec.swap ? 1 : 0;
  const thinkers: { p: number; every: number; think: (p: number) => CommandBody[] }[] = [];
  const hard = (p: number, plan: Partial<HardPlan>) => {
    const ai = createAi(p, spec.seed, { ...aiKnowledge(w.map, p, maxTicks, "hard"), hard: plan }, p);
    thinkers.push({ p, every: AI_THINK_EVERY, think: () => ai.think(buildView(g, p)) });
  };
  const choices: number[][] = [];
  hard(me, {
    ...spec.me,
    netSeen: (c) => {
      c.forEach((k, h) => {
        choices[h] ??= [];
        choices[h][k] = (choices[h][k] ?? 0) + 1;
      });
    },
  });
  const them = 1 - me;
  if (spec.opp.kind === "hard") hard(them, spec.opp.plan ?? {});
  else if (spec.opp.kind === "normal") {
    const ai = createAi(them, spec.seed, aiKnowledge(w.map, them, maxTicks, "normal"), them);
    thinkers.push({ p: them, every: AI_THINK_EVERY, think: () => ai.think(buildView(g, them)) });
  } else {
    const plan = spec.opp.kind === "late" ? latePlan() : scriptedPlan(spec.opp);
    const player = createScriptedPlayer(them, { map: mapInfo(w.map, them), rules: rules(w.map), frame: w.map.frames[them] }, plan);
    thinkers.push({ p: them, every: SCRIPTED_THINK_EVERY, think: () => player.think(buildView(g, them)) });
  }
  thinkers.sort((a, b) => a.p - b.p);
  const bonus = spec.opp.kind === "crush" ? CRUSH_BONUS : 0;
  const bonusLast = [0, 0, 0];
  let bonusLeft = 0;
  const u = w.units.col;
  const b = w.buildings.col;
  const count = () => {
    const soldiers = [0, 0];
    const farmers = [0, 0];
    for (let s = 0; s < w.units.count; s++) {
      const o = u.owner[s];
      if (o !== 0 && o !== 1 || u.type[s] === UnitType.Militia) continue;
      if (u.type[s] === UnitType.Farmer) farmers[o]++;
      else soldiers[o]++;
    }
    return { soldiers, farmers };
  };
  const governedBy = (p: number) => {
    let n = 0;
    for (let t = 0; t < w.townSize.length; t++) if (w.townOwner[t] === p && w.townState[t] === TownState.Governed) n++;
    return n;
  };
  const out = { governed20: 0, stuck: 0, ratio15: -1, ratio20: -1, farmerHits: 0, farmerBack: 0, reached: false, towers45: -1, governed45: -1 };
  /** Per minute: its farmers, and its farmers lost so far. */
  const farmerLog: { farmers: number; lost: number }[] = [];
  let lastHit = -10;
  const checks: { at: number; before: number }[] = [];
  const enemyCity = w.map.spawns[them];
  let seq = 0;
  while (!w.over && g.tick < maxTicks) {
    for (const t of thinkers) {
      if (g.tick % t.every !== 0) continue;
      for (const body of t.think(t.p)) g.push({ ...body, t: g.tick, p: t.p, seq: seq++ } as Command);
    }
    g.step();
    // As scripted-games: every 20 ticks, the scripted player's (player 0's) gathering since, times the bonus, in equal shares.
    if (bonus > 0 && g.tick % 20 === 0) {
      const kinds = [Resource.Food, Resource.Wood, Resource.Gold];
      for (const k of kinds) {
        bonusLeft += (w.gathered[k] - bonusLast[k]) * bonus;
        bonusLast[k] = w.gathered[k];
      }
      const share = Math.trunc(bonusLeft / (100 * kinds.length));
      bonusLeft -= share * 100 * kinds.length;
      for (const k of kinds) w.res[k] += share;
    }
    if (!out.reached && g.tick % 100 === 0) {
      let near = 0;
      for (let s = 0; s < w.units.count; s++) {
        if (u.owner[s] !== me || u.type[s] === UnitType.Farmer) continue;
        const dx = (u.x[s] >> 10) - enemyCity.cellX - 2;
        const dy = (u.y[s] >> 10) - enemyCity.cellY - 2;
        if (dx * dx + dy * dy <= 144) near++;
      }
      if (near >= 10) out.reached = true;
    }
    if (g.tick % 1200 !== 0) continue;
    const minute = g.tick / 1200;
    const c = count();
    const res = [0, 1, 2].map((k) => w.res[me * 4 + k]);
    if (minute >= 10 && minute <= 20 && res[1] < 50 && res[0] + res[2] >= 600) out.stuck++;
    if (minute === 15) out.ratio15 = c.soldiers[me] / Math.max(1, c.soldiers[them]);
    if (minute === 20) {
      out.ratio20 = c.soldiers[me] / Math.max(1, c.soldiers[them]);
      out.governed20 = governedBy(me);
    }
    if (minute === 45) {
      out.towers45 = 0;
      for (let s = 0; s < w.buildings.count; s++) if (b.owner[s] === me && b.type[s] === BuildingType.ArrowTower && b.progress[s] >= 1000) out.towers45++;
      out.governed45 = governedBy(me);
    }
    farmerLog.push({ farmers: c.farmers[me], lost: w.lost[me * UNIT_KINDS + UnitType.Farmer] });
    const k = farmerLog.length - 1;
    // A hit: 5 or more of its farmers lost in two minutes (none counted in the three before); back: three
    // minutes later within 2 of what it had before the hit.
    if (k >= 2 && farmerLog[k].lost - farmerLog[k - 2].lost >= 5 && k - lastHit > 3) {
      lastHit = k;
      out.farmerHits++;
      checks.push({ at: k + 3, before: farmerLog[k - 2].farmers });
    }
    for (const x of checks.filter((x) => x.at === k)) if (c.farmers[me] >= x.before - 2) out.farmerBack++;
  }
  const soldiers = count().soldiers;
  const hp = [0, 1].map((p) => (w.mainCity(p) < 0 ? 0 : b.hp[w.mainCity(p)]));
  const full = rules(w.map).buildings[0].hp || 1;
  const margin = (soldiers[me] - soldiers[them]) / (soldiers[me] + soldiers[them] + 1) + (hp[me] - hp[them]) / full;
  const won = !w.over || (w.winner !== 0 && w.winner !== 1) ? -1 : w.winner === me ? 1 : 0;
  const switches = { keep: KEEP.on, siege: SIEGE.on, rich: RICH.on, market: MARKET.on };
  return { won, ticks: g.tick, margin, ...out, choices: choices.map((h) => Array.from(h, (v) => v ?? 0)), switches };
}
