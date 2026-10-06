// 紀錄代號 (D-056): 8 random characters made up the first time the game is opened on this
// device and kept there, sent with every game record so that war-game-ai can tell one
// phone's games from another's. Not an account and nothing about the person: a new code
// comes with cleared site data or another browser. Browser storage can be missing or throw
// (private browsing): then the code lasts as long as the page.

import { CODE_PATTERN } from "../../../services/game-logs/src/record.ts";

export const RECORD_CODE_KEY = "war-game.proto.recordCode";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** `random(n)`: n random bytes. */
export function newRecordCode(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  // 252 = 7 × 36: bytes at or above it are drawn again, so every character is equally likely.
  let out = "";
  while (out.length < 8) {
    for (const b of random(16)) if (b < 252 && out.length < 8) out += ALPHABET[b % 36];
  }
  return out;
}

/** The code when browser storage does not work: kept for this page only. */
let pageOnly: string | null = null;

/** This device's code: the saved one, or a new one saved now. */
export function recordCode(store: Store | null = browserStore()): string {
  try {
    const saved = store?.getItem(RECORD_CODE_KEY) ?? null;
    if (saved !== null && CODE_PATTERN.test(saved)) return saved;
    if (store !== null) {
      const code = newRecordCode();
      store.setItem(RECORD_CODE_KEY, code);
      return code;
    }
  } catch {
    // Unreadable or not saved: a code for this page only.
  }
  pageOnly ??= newRecordCode();
  return pageOnly;
}
