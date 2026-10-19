// 介面風格 (R6-20, D-087): A 銅木 (the default) or B 墨漆金線, chosen in 選單 → 設定, at once, and
// remembered on this device, stored as 地圖 is (map-mode.ts). Both lay out the same; only the look
// changes (ui/r6.css, by the root element's data-theme).

export type Theme = "a" | "b";

export const THEME_KEY = "war-game.proto.theme";
export const THEMES: readonly Theme[] = ["a", "b"];
export const DEFAULT_THEME: Theme = "a";
export const THEME_LABEL: Record<Theme, string> = { a: "A 銅木", b: "B 墨漆金線" };

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadTheme(store: Store | null = browserStore()): Theme {
  try {
    const v = store?.getItem(THEME_KEY);
    const known = THEMES.find((t) => t === v);
    if (known !== undefined) return known;
  } catch {
    // Unreadable: as if never saved.
  }
  return DEFAULT_THEME;
}

export function saveTheme(t: Theme, store: Store | null = browserStore()): void {
  try {
    store?.setItem(THEME_KEY, t);
  } catch {
    // Not saved: A again next time.
  }
}

/** The look on the page now: the root element's data-theme (ui/r6.css). */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = t;
}
