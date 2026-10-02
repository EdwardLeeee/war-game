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
