// 難度 on the start screen (D-024): 簡單 the first time, then the last choice on this device.
// Browser storage is only a convenience: it can be missing or throw (private browsing,
// blocked site data), and then the page behaves as if nothing was saved.

import { AI_DIFFICULTIES, type AiDifficulty } from "./sim.ts";

export const DIFFICULTY_KEY = "war-game.proto.difficulty";
export const DEFAULT_DIFFICULTY: AiDifficulty = "easy";
export const DIFFICULTY_LABEL: Record<AiDifficulty, string> = { easy: "簡單", normal: "普通", hard: "困難" };

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadDifficulty(store: Store | null = browserStore()): AiDifficulty {
  try {
    const v = store?.getItem(DIFFICULTY_KEY);
    const known = AI_DIFFICULTIES.find((d) => d === v);
    if (known !== undefined) return known;
  } catch {
    // Unreadable: as if never saved.
  }
  return DEFAULT_DIFFICULTY;
}

export function saveDifficulty(d: AiDifficulty, store: Store | null = browserStore()): void {
  try {
    store?.setItem(DIFFICULTY_KEY, d);
  } catch {
    // Not saved: the next visit starts from the default again.
  }
}
