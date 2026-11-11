// A late game to start from (D-115, ceo 2026-11-03; for push-late-siege's --takeover and war-game-ai's learn/): the scripted
// player plays push-late-siege against normal up to a minute, then another AI (hard, or a network) takes the normal one's
// side over, having watched for a while first (it thinks, its orders dropped) so it knows what it saw. No side effects on
// import; nothing here is in the worker.

import { type Ai, type AiStyle, createAi } from "./ai/ai.ts";
import { createScriptedPlayer, type Plan, planFor, SCRIPTED_THINK_EVERY } from "./ai/scripted-player.ts";
import type { Game } from "./core/game.ts";
import type { World } from "./core/world.ts";
import { type AiDifficulty, type MapMode, Resource } from "./protocol.ts";
import { AI_THINK_EVERY, aiKnowledge, Runner } from "./runner.ts";
import { buildView, mapInfo } from "./view/view.ts";
import { rules } from "./core/rules.ts";

/** How long the AI taking over watches before it gives orders: 3 minutes. */
export const WATCH_TICKS = 3 * 60 * 20;

/** push-late-siege's plan (D-115): the turtle with the user's 8d02b76f clock, govern, corners, 3 engines, out with 100. */
export function latePlanFor(): Plan {
  return lateSiege(planFor("push", "h1", "close"));
}

/** push-late-siege's changes on a plan (scripted-games --late-siege): `plan`, changed. */
export function lateSiege(plan: Plan): Plan {
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
  plan.lateSiege = true;
  return plan;
}

/**
 * The player's gathering of food, wood and gold plus `percent` (push-crush, push-late-siege's --bonus), credited every 20
 * ticks in equal shares of the three. For measurement only: a game's log does not replay it.
 */
export class Bonus {
  private readonly last = [0, 0, 0];
  private left = 0;
  private readonly percent: number;
  constructor(percent: number) {
    this.percent = percent;
  }

  /** After each tick. */
  tick(w: World): void {
    if (this.percent <= 0 || w.tick % 20 !== 0) return;
    const kinds = [Resource.Food, Resource.Wood, Resource.Gold];
    for (const k of kinds) {
      this.left += (w.gathered[k] - this.last[k]) * this.percent;
      this.last[k] = w.gathered[k];
    }
    const share = Math.trunc(this.left / (100 * kinds.length));
    this.left -= share * 100 * kinds.length;
    for (const k of kinds) w.res[k] += share;
  }
}

/**
 * Player p's AI, played outside the Runner's own (as the Runner would: every AI_THINK_EVERY ticks, before the step), and
 * one that may take over: it thinks from `from` on, its orders dropped, and plays from `at`.
 */
export class AiSeat {
  private next: Ai | null = null;
  private at = -1;
  private nextSeq = 0;

  private readonly r: Runner;
  readonly p: number;
  private ai: Ai;

  constructor(r: Runner, p: number, ai: Ai) {
    this.r = r;
    this.p = p;
    this.ai = ai;
  }

  /** `ai` watches from now and plays from tick `at`. */
  takeOver(ai: Ai, at: number): void {
    this.next = ai;
    this.at = at;
  }

  /** The AI playing now. */
  get playing(): Ai {
    return this.ai;
  }

  /** The seq the next order gets. */
  seq(): number {
    return this.nextSeq;
  }

  /** Before each tick. */
  think(): void {
    const g = this.r.game;
    if (g.tick % AI_THINK_EVERY !== 0) return;
    if (this.next !== null && g.tick >= this.at) {
      this.ai = this.next;
      this.next = null;
    }
    for (const body of this.ai.think(buildView(g, this.p))) this.r.command(this.p, { ...body, seq: this.nextSeq++ });
    if (this.next !== null) this.next.think(buildView(g, this.p));
  }
}

export interface LateStartOptions {
  seed: number;
  map: MapMode;
  plan?: Plan;
  /** --bonus: percent added to the player's gathering. */
  bonus?: number;
  /** The AI's style before the takeover (the Runner draws one when absent). */
  style?: AiStyle;
}

export interface LateStart {
  runner: Runner;
  game: Game;
  /** One tick: the scripted player (every SCRIPTED_THINK_EVERY) and player 1's seat think, the game steps, the bonus. */
  step(): void;
  /** Steps up to tick `t`. */
  runTo(t: number): void;
  /** From now `ai` watches as player 1, and plays from tick `at` (normal's side, its buildings and army, are its). */
  takeOver(ai: Ai, at: number): void;
  /** An AI of player 1 of difficulty d, as the Runner would make it. */
  aiFor(d: AiDifficulty): Ai;
  /** Player 1's next order's seq. */
  seq(): number;
}

/** A game: the scripted player (player 0) on `plan` (push-late-siege's by default) against normal (player 1). */
export function lateStart(o: LateStartOptions): LateStart {
  const plan = o.plan ?? latePlanFor();
  const r = new Runner({ seed: o.seed, scenario: "standard", ai: [false, false], maxTicks: 0, autoTrain: [plan.autoTrain, false], map: o.map });
  const g = r.game;
  const map = g.w.map;
  const aiFor = (d: AiDifficulty) => createAi(1, o.seed, aiKnowledge(map, 1, 0, d), 1, o.style);
  const seat = new AiSeat(r, 1, aiFor("normal"));
  const player = createScriptedPlayer(0, { map: mapInfo(map, 0), rules: rules(map), frame: map.frames[0] }, plan);
  const bonus = new Bonus(o.bonus ?? 0);
  let seq = 0;
  const step = () => {
    if (g.tick % SCRIPTED_THINK_EVERY === 0) for (const body of player.think(buildView(g, 0))) r.command(0, { ...body, seq: seq++ });
    seat.think();
    r.tick();
    bonus.tick(g.w);
  };
  return {
    runner: r,
    game: g,
    step,
    runTo: (t) => {
      while (!r.over && g.tick < t) step();
    },
    takeOver: (ai, at) => seat.takeOver(ai, at),
    aiFor,
    seq: () => seat.seq(),
  };
}
