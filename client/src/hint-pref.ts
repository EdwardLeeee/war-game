// 開局提示 (D-044): 「不再提示」 is remembered on this device, the way 難度 is (D-024). Browser
// storage is only a convenience: it can be missing or throw (private browsing, blocked site
// data), and then the hint simply shows again.

export const TOWN_HINT_KEY = "war-game.proto.townHint";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Whether the player turned the hint off at the start of games. */
export function loadTownHintOff(store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(TOWN_HINT_KEY) === "off";
  } catch {
    return false;
  }
}

export function saveTownHintOff(off: boolean, store: Store | null = browserStore()): void {
  try {
    store?.setItem(TOWN_HINT_KEY, off ? "off" : "on");
  } catch {
    // Not saved: the next game shows the hint again.
  }
}

/**
 * 點城鎮＝攻擊這座城 (D-100): a hint shown once on this device, the first time soldiers are sent at
 * a town by a tap on its ground.
 */
export const KEEP_HINT_KEY = "war-game.proto.keepHint";
export const KEEP_HINT_TEXT = "點城鎮＝攻擊這座城";

/** Whether this device has shown the hint under `key` (missing storage: not yet, it shows again). */
export function loadHintSeen(key: string, store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(key) === "seen";
  } catch {
    return false;
  }
}

export function saveHintSeen(key: string, store: Store | null = browserStore()): void {
  try {
    store?.setItem(key, "seen");
  } catch {
    // Not saved: it shows again next time.
  }
}

/**
 * 市場 (D-101; the user 2026-10-24, on the draft: the line under the buttons only the first time):
 * how its prices move, said once on this device, the first time a market's panel opens.
 */
export const MARKET_HINT_KEY = "war-game.proto.marketHint";
