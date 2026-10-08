// Runs a game tick by tick for the worker and the headless tool: lets each AI think from its
// PlayerView (previous tick's state) every AI_THINK_EVERY ticks, steps the game, and times
// the step. AI commands go into the log like a player's, so a replay needs no AI. Both AIs
// think on the same tick: staggering them gave one side a fixed head start.

import { type Ai, type AiStyle, createAi } from "./ai/ai.ts";
import { type GameConfig, Game } from "./core/game.ts";
import { rules } from "./core/rules.ts";
import {
  type AiDifficulty,
  type Command,
  type CommandBody,
  type LogHeader,
  MAX_TICKS,
  PLAYER_COUNT,
  PROTOCOL_VERSION,
  type ScenarioName,
} from "./protocol.ts";
import { buildView } from "./view/view.ts";

export const AI_THINK_EVERY = 10;

export interface RunnerConfig extends GameConfig {
  /** Which players the AI plays; ignored for replays. */
  ai: boolean[];
  /** Commands to replay (from a log); AIs are off when given. */
  replay?: Command[];
  /** Tournament: the two AIs swap slots (each plays from the other spawn). */
  swap?: boolean;
  /** Tournament: the AI style of slot 0 and slot 1 (otherwise drawn at random each game). */
  styles?: [AiStyle, AiStyle];
  /** Per player, how its AI plays (default all "normal"). */
  difficulty?: AiDifficulty[];
}

export class Runner {
  readonly game: Game;
  private ais: (Ai | null)[] = [];
  private aiSeq = 0;
  readonly hashes: { tick: number; hash: number }[] = [];
  /** Per player, how its AI plays (recorded in the log header). */
  readonly difficulty: AiDifficulty[];

  constructor(cfg: RunnerConfig) {
    this.game = new Game({ seed: cfg.seed, scenario: cfg.scenario, maxTicks: cfg.maxTicks ?? MAX_TICKS, autoTrain: cfg.autoTrain, map: cfg.map });
    this.difficulty = Array.from({ length: PLAYER_COUNT }, (_, p) => cfg.difficulty?.[p] ?? "normal");
    for (let p = 0; p < PLAYER_COUNT; p++) {
      const slot = cfg.swap === true ? 1 - p : p;
      // TEMPORARY (D-074, ceo 2026-10-07): the AI cannot scout yet, so on a random map it still
      // gets the whole map (the enemy's main city, every town) instead of what the screen gets,
      // view.ts mapInfo(map, p). Remove with war-game-ai's scouting PR. Until then a person
      // cannot play a random map (worker.ts), and AI-vs-AI games on random maps only check
      // whether the maps are fair.
      const know = { map: this.game.w.map, rules: rules(this.game.w.map), frame: this.game.w.map.frames[p], maxTicks: this.maxTicks, difficulty: this.difficulty[p] };
      this.ais.push(cfg.replay === undefined && cfg.ai[p] ? createAi(p, cfg.seed, know, slot, cfg.styles?.[slot]) : null);
    }
    if (cfg.replay !== undefined) for (const c of cfg.replay) this.game.push(c);
    this.hashes.push({ tick: 0, hash: this.game.hash() });
  }

  /** A command from the screen: stamped for the next tick not yet run. */
  command(player: number, body: CommandBody & { seq: number }): Command {
    const cmd = { ...body, t: this.game.tick, p: player } as Command;
    this.game.push(cmd);
    return cmd;
  }

  /** One tick. Returns the step time in microseconds when a clock is given. */
  tick(clock?: () => number): number {
    const g = this.game;
    for (let p = 0; p < PLAYER_COUNT; p++) {
      const ai = this.ais[p];
      if (ai === null || g.tick % AI_THINK_EVERY !== 0) continue;
      for (const body of ai.think(buildView(g, p))) {
        g.push({ ...body, t: g.tick, p, seq: this.aiSeq++ } as Command);
      }
    }
    const t0 = clock?.() ?? 0;
    g.step();
    const micros = clock === undefined ? 0 : Math.round((clock() - t0) * 1000);
    if (g.shouldHash()) this.hashes.push({ tick: g.tick, hash: g.hash() });
    return micros;
  }

  /** The style each AI plays (null where there is no AI). */
  get styles(): (AiStyle | null)[] {
    return this.ais.map((a) => (a === null ? null : a.style));
  }

  get over(): boolean {
    return this.game.w.over;
  }

  /** The game's time limit in ticks (0 = none). */
  get maxTicks(): number {
    return this.game.config.maxTicks ?? MAX_TICKS;
  }

  /** The first line of this game's command log. */
  header(ai: boolean[]): LogHeader {
    const c = this.game.config;
    const head: LogHeader = { protocol: PROTOCOL_VERSION, seed: c.seed, scenario: c.scenario as ScenarioName, ai, maxTicks: this.maxTicks, difficulty: this.difficulty };
    // Only when some player has it, so the logs of AI-vs-AI games stay as they were.
    if (c.autoTrain?.some((on) => on) === true) head.autoTrain = Array.from({ length: PLAYER_COUNT }, (_, p) => c.autoTrain?.[p] === true);
    // Only on a random map, so fixed-map logs stay as they were (D-074).
    if (c.map === "random") head.map = "random";
    return head;
  }
}

