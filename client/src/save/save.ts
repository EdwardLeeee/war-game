// 繼續上一局 (D-083): the game being played, kept on this phone so that it goes on after Safari
// drops the page while the phone is put away. What the simulation gives for it (export_log: the
// command log, its hashes, the tick it got to), what the game was started with, and what the
// screen keeps beside the simulation (groups, garrisons, the alarm's bases, the camera, the
// speed). Saved when the page goes to the background and every minute of game time; one game,
// the last; cleared when it ends or another starts. IndexedDB in the browser, memory in the unit
// tests; when storage fails, nothing is kept and the game goes on as before.

import type { Culture } from "../art/spec.ts";
import type { ArmyState } from "../game/army.ts";
import type { Charge } from "../game/follow.ts";
import type { GovernWaitState } from "../game/govern-wait.ts";
import { type AiDifficulty, type ContinueFailure, type MapMode, type ScenarioName, TICKS_PER_SECOND } from "../sim.ts";
import type { SpeedName } from "../ui/controls.ts";

/** The screen's part's format. A page with another number goes on without it (ceo 2026-10-17). */
export const SCREEN_VERSION = 1;
const MINUTE_TICKS = 60 * TICKS_PER_SECOND;
/** Saved every minute of game time as well: the background save does not come when the page crashes. */
export const SAVE_EVERY_TICKS = MINUTE_TICKS;

/** What the screen keeps beside the simulation. */
export interface ScreenState {
  army: ArmyState;
  alarms: { base: (number | null)[]; told: boolean[] };
  charges: [number, Charge][];
  /** The world point in the middle of the screen (pixels) and the zoom. */
  camera: { x: number; y: number; scale: number } | null;
  speed: SpeedName;
  /** The next command's sequence number: the log goes on after the old ones. */
  seq: number;
  /** The tick of the last message about a recruit; null for none. */
  recruitMessageTick: number | null;
  /** 等錢治理 (ceo 2026-10-21): the towns waiting for 治理's cost and the player's own reserve; saves from before have none. */
  govern?: GovernWaitState;
}

/** What the game was started with (its init). */
export interface SavedInit {
  seed: number;
  scenario: ScenarioName;
  difficulty: AiDifficulty;
  map: MapMode;
  maxTicks: number;
  enemyAi: boolean;
  /** 你的陸 it was played with (only the picture); saves from before the choice have none (東陸). */
  culture?: Culture;
}

export interface SavedGame {
  savedAt: number;
  /** The site's commit, and the simulation's protocol and build (scripts/sim-build.ts), it was played on. */
  commit: string;
  protocol: number;
  build: string;
  /** Which game it is among the phone's records (logs/store.ts): going on, it keeps the same entry. */
  game: string;
  init: SavedInit;
  /** export_log's command log, hashes and tick. */
  log: string;
  hashes: { tick: number; hash: string }[];
  tick: number;
  screenVersion: number;
  screen: ScreenState;
}

/** Minutes of game time at this tick (第 N 分). */
export const minuteOf = (tick: number): number => Math.floor(tick / MINUTE_TICKS);

/** The start screen's button. */
export const continueLabel = (s: SavedGame): string => `繼續上一局（第 ${minuteOf(s.tick)} 分）`;

/** Under the button when the simulation is not the one the game was played on. */
export const UPDATED_TEXT = "網站已經更新，這一局不能繼續";

/** The saved game goes on on this page: the same simulation (protocol and build). */
export const canGoOn = (s: SavedGame, protocol: number, build: string): boolean => s.protocol === protocol && s.build === build;

/** The screen's part can be put back (the same format). */
export const screenUsable = (s: SavedGame): boolean => s.screenVersion === SCREEN_VERSION;

/** Said when the game went on without the screen's part. */
export const SCREEN_LOST_TEXT = "編隊沒有還原，請重新編";

/** While the simulation runs the game again up to where it was. */
export const progressText = (tick: number, toTick: number): string => `快轉中：第 ${minuteOf(tick)}／${minuteOf(toTick)} 分`;

/**
 * Why the game cannot go on, in two kinds (ceo 2026-10-17): the site was updated (another
 * simulation), or the log does not play back the same (its record went up in the background;
 * war-game-ai can look into it).
 */
export function failureText(reason: ContinueFailure, tick: number): string {
  if (reason === "protocol" || reason === "build") return UPDATED_TEXT;
  return `紀錄對不上（第 ${minuteOf(tick)} 分），這一局不能繼續`;
}

/** A record read back is a saved game (what storage gives back is not trusted blindly). */
export function isSavedGame(v: unknown): v is SavedGame {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  const init = s.init as Record<string, unknown> | null;
  return (
    typeof s.log === "string" &&
    Array.isArray(s.hashes) &&
    typeof s.tick === "number" &&
    typeof s.protocol === "number" &&
    typeof s.build === "string" &&
    typeof s.game === "string" &&
    typeof s.screenVersion === "number" &&
    typeof init === "object" &&
    init !== null &&
    typeof init.seed === "number" &&
    typeof init.scenario === "string"
  );
}

export interface SaveBackend {
  get(): Promise<unknown>;
  put(s: SavedGame): Promise<void>;
  clear(): Promise<void>;
}

/** The one saved game; storage failing never reaches the game. */
export class SaveStore {
  private readonly backend: Promise<SaveBackend | null>;
  /** The main thread's time in the last put (IndexedDB copies the save there), ms. */
  lastPutMs = 0;

  constructor(backend: Promise<SaveBackend | null>) {
    this.backend = backend;
  }

  async load(): Promise<SavedGame | null> {
    try {
      const v = await (await this.backend)?.get();
      return isSavedGame(v) ? v : null;
    } catch {
      return null;
    }
  }

  /** Returns whether it was kept. */
  async save(s: SavedGame): Promise<boolean> {
    try {
      const b = await this.backend;
      if (b === null) return false;
      const t = performance.now();
      const put = b.put(s);
      this.lastPutMs = performance.now() - t;
      await put;
      return true;
    } catch {
      return false;
    }
  }

  async clear(): Promise<void> {
    try {
      await (await this.backend)?.clear();
    } catch {
      // Nothing kept, or nothing to clear.
    }
  }
}

export class MemorySaveBackend implements SaveBackend {
  value: SavedGame | undefined = undefined;
  async get(): Promise<unknown> {
    // Structured clone, as IndexedDB keeps it.
    return this.value === undefined ? undefined : structuredClone(this.value);
  }
  async put(s: SavedGame): Promise<void> {
    this.value = structuredClone(s);
  }
  async clear(): Promise<void> {
    this.value = undefined;
  }
}

const DB_NAME = "war-game-continue";
const STORE = "game";
const KEY = "last";

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class IdbSaveBackend implements SaveBackend {
  private readonly db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  get(): Promise<unknown> {
    return done(this.store("readonly").get(KEY));
  }

  async put(s: SavedGame): Promise<void> {
    await done(this.store("readwrite").put(s, KEY));
  }

  async clear(): Promise<void> {
    await done(this.store("readwrite").delete(KEY));
  }
}

/** The browser's store (its own database, apart from the records'), or null where IndexedDB is missing or will not open. */
export async function openSaveDb(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<SaveBackend | null> {
  if (factory === undefined) return null;
  try {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    return new IdbSaveBackend(await done(req));
  } catch {
    return null;
  }
}
