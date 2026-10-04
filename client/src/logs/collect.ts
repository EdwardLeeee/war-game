// 對局紀錄自動收集 (D-056): after each game the page keeps its command log on the phone and
// uploads it to the user's Cloudflare Worker (services/game-logs/), for war-game-ai to replay
// and to train the 困難 computer. The player presses nothing and sees nothing of it.
//
// Kept: a game that ended (勝、負、投降、時間到), and one left by 重來 after at least a
// minute of game time. Not kept: the fake world, 量測 (perf), and any game the simulation
// will not give its log for. Nothing in a record says who played (services/game-logs/src/record.ts).

import { type GameRecord, RECORD_VERSION, type Result } from "../../../services/game-logs/src/record.ts";
import { GameOverReason, TICKS_PER_SECOND } from "../sim.ts";
import { type LogBackend, LogStore, type StoredLog } from "./store.ts";
import { type Poster, uploadPending } from "./upload.ts";

/**
 * Where records go: the Worker's /logs. Empty until the user has deployed it (README of
 * services/game-logs): then records are only kept on the phone.
 */
export const GAME_LOGS_URL = "";

/** A game left by 重來 is kept from this much game time on: shorter ones are restarts, not games. */
export const MIN_ABANDONED_TICKS = 60 * TICKS_PER_SECOND;

const REASON_NAME: Record<GameOverReason, string> = {
  [GameOverReason.MainCityDestroyed]: "main_city",
  [GameOverReason.Surrender]: "surrender",
  [GameOverReason.TimeLimit]: "time_limit",
};

export function reasonName(reason: GameOverReason): string {
  return REASON_NAME[reason] ?? "";
}

/** The person's result from the simulation's winner (a player index; anything else: no winner). */
export function resultFor(winner: number, me: number): Result {
  if (winner === me) return "win";
  return winner === 0 || winner === 1 ? "loss" : "draw";
}

export interface GameEnd {
  result: Result;
  reason: string;
  ticks: number;
}

export function makeRecord(o: {
  id: string;
  code: string;
  commit: string;
  protocol: number;
  scenario: string;
  difficulty: string;
  end: GameEnd;
  lastHash: { tick: number; hash: string } | null;
  log: string;
}): GameRecord {
  return {
    v: RECORD_VERSION,
    id: o.id,
    code: o.code,
    commit: o.commit,
    protocol: o.protocol,
    scenario: o.scenario,
    difficulty: o.difficulty,
    result: o.end.result,
    reason: o.end.reason,
    ticks: o.end.ticks,
    lastHash: o.lastHash,
    log: o.log,
  };
}

/** Keeps and uploads records one at a time; never throws, never waits on the network for the game. */
export class LogCollector {
  private readonly store: Promise<LogStore | null>;
  private readonly url: string;
  private readonly post: Poster;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(backend: Promise<LogBackend | null>, url: string, post: Poster) {
    this.store = backend.then((b) => (b === null ? null : new LogStore(b))).catch(() => null);
    this.url = url;
    this.post = post;
  }

  private run<T>(job: (store: LogStore) => Promise<T>, fallback: T): Promise<T> {
    const next = this.queue.then(async () => {
      const store = await this.store;
      if (store === null) return fallback;
      try {
        return await job(store);
      } catch {
        return fallback;
      }
    });
    this.queue = next;
    return next;
  }

  /** Keeps a game; the upload of everything waiting follows. Resolves once it is kept (or could not be). */
  keep(rec: GameRecord): Promise<boolean> {
    const kept = this.run((s) => s.save(rec, Date.now()), false);
    void this.flush();
    return kept;
  }

  /** Uploads what is waiting (when the page opens, and after each game). */
  flush(): Promise<number> {
    return this.run((s) => uploadPending(s, this.url, this.post), 0);
  }

  /** What the phone has kept, newest first (the test hook reads it). */
  list(): Promise<StoredLog[]> {
    return this.run((s) => s.list(), []);
  }
}
