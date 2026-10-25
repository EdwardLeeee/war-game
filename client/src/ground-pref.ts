// 寫實地面 開／關 (ceo 2026-10-25): the player's own switch in 選單, on by default and remembered on
// this device, stored as 介面風格 is (theme.ts). Should the realistic ground be too slow on a phone,
// it goes off at once, without waiting for a new version.

export const GROUND_KEY = "war-game.proto.ground";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** On unless this device was told off. */
export function loadGroundOn(store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(GROUND_KEY) !== "off";
  } catch {
    // Unreadable: as if never saved.
    return true;
  }
}

export function saveGroundOn(on: boolean, store: Store | null = browserStore()): void {
  try {
    store?.setItem(GROUND_KEY, on ? "on" : "off");
  } catch {
    // Not saved: on again next time.
  }
}
