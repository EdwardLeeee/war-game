// Runs a game tick by tick for the worker and the headless tool: lets each AI think on its
// own staggered schedule from its PlayerView (previous tick's state), steps the game, and
// times the step. AI commands go into the log like a player's, so a replay needs no AI.

import { type Ai, createAi } from "./ai/ai.ts";
import { type GameConfig, Game } from "./core/game.ts";
import { type Command, type CommandBody, PLAYER_COUNT } from "./protocol.ts";
import { buildView } from "./view/view.ts";

export const AI_THINK_EVERY = 10;

export interface RunnerConfig extends GameConfig {
  /** Which players the AI plays; ignored for replays. */
  ai: boolean[];
  /** Commands to replay (from a log); AIs are off when given. */
  replay?: Command[];
}

export class Runner {
  readonly game: Game;
  private ais: (Ai | null)[] = [];
  private aiSeq = 0;
  readonly hashes: { tick: number; hash: number }[] = [];

  constructor(cfg: RunnerConfig) {
    this.game = new Game({ seed: cfg.seed, scenario: cfg.scenario });
    for (let p = 0; p < PLAYER_COUNT; p++) {
      this.ais.push(cfg.replay === undefined && cfg.ai[p] ? createAi(p, cfg.seed) : null);
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
      if (ai === null || g.tick % AI_THINK_EVERY !== (p * AI_THINK_EVERY) / 2) continue;
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

  get over(): boolean {
    return this.game.w.over;
  }
}

