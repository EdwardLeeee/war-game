// 地圖 on the start screen (D-074): 固定地圖 the first time, then the last choice on this device,
// stored as 難度 is (difficulty.ts). Browser storage is only a convenience: it can be missing or
// throw (private browsing, blocked site data), and then the page behaves as if nothing was saved.

import { MAP_MODES, type MapMode } from "./sim.ts";

export const MAP_KEY = "war-game.proto.map";
export const DEFAULT_MAP: MapMode = "fixed";
export const MAP_LABEL: Record<MapMode, string> = { fixed: "固定地圖", random: "隨機地圖" };
/** One line under the choice, what it means for the player (ceo's brief, D-074). */
export const MAP_NOTE: Record<MapMode, string> = {
  fixed: "每局同一張，適合比較電腦強弱",
  random: "每局不同，只看得到自己家附近",
};

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadMapMode(store: Store | null = browserStore()): MapMode {
  try {
    const v = store?.getItem(MAP_KEY);
    const known = MAP_MODES.find((m) => m === v);
    if (known !== undefined) return known;
  } catch {
    // Unreadable: as if never saved.
  }
  return DEFAULT_MAP;
}

export function saveMapMode(m: MapMode, store: Store | null = browserStore()): void {
  try {
    store?.setItem(MAP_KEY, m);
  } catch {
    // Not saved: the next visit starts from the default again.
  }
}
