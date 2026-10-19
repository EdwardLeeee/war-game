// 你的陸 on the start screen (the user 2026-10-19: 「我覺得可以自選」, the computer the other): 東陸
// the first time, then the last choice on this device, stored as 地圖 is (map-mode.ts). Only the
// picture: who wears which atlases (art/spec.ts cultureOf); the game is the same.

import type { Culture } from "./art/spec.ts";

export const CULTURE_KEY = "war-game.proto.culture";
export const CULTURES: readonly Culture[] = ["e", "w"];
export const DEFAULT_CULTURE: Culture = "e";
export const CULTURE_LABEL: Record<Culture, string> = { e: "東陸", w: "西陸" };

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadCulture(store: Store | null = browserStore()): Culture {
  try {
    const v = store?.getItem(CULTURE_KEY);
    const known = CULTURES.find((c) => c === v);
    if (known !== undefined) return known;
  } catch {
    // Unreadable: as if never saved.
  }
  return DEFAULT_CULTURE;
}

export function saveCulture(c: Culture, store: Store | null = browserStore()): void {
  try {
    store?.setItem(CULTURE_KEY, c);
  } catch {
    // Not saved: the next visit starts from 東陸 again.
  }
}
