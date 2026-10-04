// The phone's game records (D-056): the last 50 games, each marked once the Worker has it.
// IndexedDB in the browser, a Map in the unit tests. Storage can be missing or fail (private
// browsing, a full disk): then nothing is kept and the game goes on as before.

import type { GameRecord } from "../../../services/game-logs/src/record.ts";

export const KEEP_GAMES = 50;

/** One game kept on the phone. `rejected`: the Worker said it will never take it (not sent again). */
export interface StoredLog {
  id: string;
  /** When it was saved (ms since 1970), for keeping the newest. */
  savedAt: number;
  state: "pending" | "sent" | "rejected";
  rec: GameRecord;
}

export interface LogBackend {
  all(): Promise<StoredLog[]>;
  put(entry: StoredLog): Promise<void>;
  remove(id: string): Promise<void>;
}

const newestFirst = (a: StoredLog, b: StoredLog) => b.savedAt - a.savedAt || (a.id < b.id ? 1 : -1);

export class LogStore {
  private readonly backend: LogBackend;

  constructor(backend: LogBackend) {
    this.backend = backend;
  }

  /** Keeps a game (once per 局編號) and drops the oldest beyond KEEP_GAMES. False: already kept. */
  async save(rec: GameRecord, now: number): Promise<boolean> {
    const all = await this.backend.all();
    if (all.some((e) => e.id === rec.id)) return false;
    const entry: StoredLog = { id: rec.id, savedAt: now, state: "pending", rec };
    await this.backend.put(entry);
    for (const old of [...all, entry].sort(newestFirst).slice(KEEP_GAMES)) await this.backend.remove(old.id);
    return true;
  }

  /** Newest first. */
  async list(): Promise<StoredLog[]> {
    return (await this.backend.all()).sort(newestFirst);
  }

  /** The games still to upload, oldest first. */
  async pending(): Promise<StoredLog[]> {
    return (await this.backend.all()).filter((e) => e.state === "pending").sort((a, b) => -newestFirst(a, b));
  }

  async mark(id: string, state: StoredLog["state"]): Promise<void> {
    const entry = (await this.backend.all()).find((e) => e.id === id);
    if (entry !== undefined) await this.backend.put({ ...entry, state });
  }
}

export class MemoryBackend implements LogBackend {
  readonly map = new Map<string, StoredLog>();
  async all(): Promise<StoredLog[]> {
    return [...this.map.values()];
  }
  async put(entry: StoredLog): Promise<void> {
    this.map.set(entry.id, entry);
  }
  async remove(id: string): Promise<void> {
    this.map.delete(id);
  }
}

const DB_NAME = "war-game-logs";
const STORE = "logs";

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

class IdbBackend implements LogBackend {
  private readonly db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db.transaction(STORE, mode).objectStore(STORE);
  }

  all(): Promise<StoredLog[]> {
    return done(this.store("readonly").getAll() as IDBRequest<StoredLog[]>);
  }

  async put(entry: StoredLog): Promise<void> {
    await done(this.store("readwrite").put(entry));
  }

  async remove(id: string): Promise<void> {
    await done(this.store("readwrite").delete(id));
  }
}

/** The browser's store, or null where IndexedDB is missing or will not open. */
export async function openIndexedDb(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<LogBackend | null> {
  if (factory === undefined) return null;
  try {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    return new IdbBackend(await done(req));
  } catch {
    return null;
  }
}
