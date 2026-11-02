// 電影色調 開／關 (the user 2026-11-02, R9-05 B): the player's own switch in 選單, off by default
// (ceo: on once the iPhone's 量測 120 人 says it is fast enough), remembered on this device as
// 寫實地面 is (ground-pref.ts).

export const GRADE_KEY = "war-game.proto.grade";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Off unless this device was told on. */
export function loadGradeOn(store: Store | null = browserStore()): boolean {
  try {
    return store?.getItem(GRADE_KEY) === "on";
  } catch {
    // Unreadable: as if never saved.
    return false;
  }
}

export function saveGradeOn(on: boolean, store: Store | null = browserStore()): void {
  try {
    store?.setItem(GRADE_KEY, on ? "on" : "off");
  } catch {
    // Not saved: off again next time.
  }
}
