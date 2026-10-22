// 閃退的線索 (ceo 2026-10-22, after the user's 「剛剛兩場對局都打到一半跳掉」): while a game is on
// screen the page writes a heartbeat to this device every few seconds (the tick, how many units
// and buildings, the art's scale and its bytes on the GPU, WebGL contexts lost, the last error).
// If the page then dies with the game on screen (iOS drops it when out of memory, with no event),
// the next start finds the heartbeat still 「playing」 and keeps a note of it, which goes with the
// next record uploaded (D-056). Nothing in it says who played. Browser storage is a convenience
// only: missing or throwing, there is no note.

export const BEAT_KEY = "war-game.proto.beat";
export const CRASH_KEY = "war-game.proto.crash";
/** How often the page writes its heartbeat while a game is on screen. */
export const BEAT_EVERY_MS = 5000;

/** On screen and seen; the page in the background or another screen; no game. */
export type BeatState = "playing" | "away" | "ended";

/** What the page was doing, as last written. */
export interface Beat {
  v: 1;
  state: BeatState;
  /** When written, and when this page started showing the game (ms since 1970). */
  at: number;
  since: number;
  tick: number;
  units: number;
  buildings: number;
  /** 美術 in use: x3, x2, off, test. */
  art: string;
  gpuPages: number;
  gpuMB: number;
  contextLost: number;
  lastError: string | null;
  commit: string;
}

/** The game on screen when the page last died (a Beat still 「playing」), for the next record. */
export interface CrashNote {
  at: number;
  /** Seconds the page had shown the game. */
  upS: number;
  tick: number;
  units: number;
  buildings: number;
  art: string;
  gpuPages: number;
  gpuMB: number;
  contextLost: number;
  lastError: string | null;
  commit: string;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** A heartbeat that ended with the game on screen: its note; anything else (left, ended, unreadable): null. */
export function crashOf(v: unknown): CrashNote | null {
  const b = v as Partial<Beat> | null;
  if (typeof b !== "object" || b === null || b.v !== 1 || b.state !== "playing") return null;
  if (!isNum(b.at) || !isNum(b.since) || !isNum(b.tick) || !isNum(b.units) || !isNum(b.buildings)) return null;
  return {
    at: b.at,
    upS: Math.max(0, Math.round((b.at - b.since) / 1000)),
    tick: b.tick,
    units: b.units,
    buildings: b.buildings,
    art: typeof b.art === "string" ? b.art : "",
    gpuPages: isNum(b.gpuPages) ? b.gpuPages : 0,
    gpuMB: isNum(b.gpuMB) ? b.gpuMB : 0,
    contextLost: isNum(b.contextLost) ? b.contextLost : 0,
    lastError: typeof b.lastError === "string" ? b.lastError.slice(0, 200) : null,
    commit: typeof b.commit === "string" ? b.commit : "",
  };
}

export class Heartbeat {
  private readonly store: Store | null;
  private state: BeatState | null = null;

  constructor(store: Store | null = browserStore()) {
    this.store = store;
  }

  /**
   * At the page's start: a heartbeat left 「playing」 by the page before is kept as the note for
   * the next record (until takeCrash); the heartbeat starts over.
   */
  startup(): void {
    try {
      const raw = this.store?.getItem(BEAT_KEY) ?? null;
      const note = raw === null ? null : crashOf(JSON.parse(raw));
      if (note !== null) this.store?.setItem(CRASH_KEY, JSON.stringify(note));
      this.store?.removeItem(BEAT_KEY);
    } catch {
      // Unreadable: no note.
    }
  }

  /** Written every BEAT_EVERY_MS while a game is on screen. */
  beat(b: Omit<Beat, "v" | "at">, now: number = Date.now()): void {
    this.state = b.state;
    try {
      this.store?.setItem(BEAT_KEY, JSON.stringify({ v: 1, at: now, ...b }));
    } catch {
      // Not written: no note next time.
    }
  }

  /** The page went to the background or left the game: not 「playing」 any more (only if it was). */
  leave(state: "away" | "ended"): void {
    if (this.state === null || this.state === state) return;
    this.state = state;
    try {
      const raw = this.store?.getItem(BEAT_KEY) ?? null;
      if (raw === null) return;
      this.store?.setItem(BEAT_KEY, JSON.stringify({ ...JSON.parse(raw), state, at: Date.now() }));
    } catch {
      // Not written.
    }
  }

  /** The note of the last unexpected end, once: it goes with the next record uploaded. */
  takeCrash(): CrashNote | null {
    try {
      const raw = this.store?.getItem(CRASH_KEY) ?? null;
      if (raw === null) return null;
      this.store?.removeItem(CRASH_KEY);
      return JSON.parse(raw) as CrashNote;
    } catch {
      return null;
    }
  }
}
