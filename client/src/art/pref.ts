// 美術 in the 量測 panel (D-085): whether the units are drawn from war-game-ui's atlases, and at
// which scale. On at 3 倍 unless chosen otherwise there (D-087: the iPhone measured both, ceo
// chose 3 倍; the player opened from the Home Screen icon has no address bar for ?art=),
// remembered on this device, used from the next game on. Browser storage is a convenience
// only: missing or throwing, it is as if nothing was saved (3 倍).

export type ArtChoice = "off" | "x3" | "x2";

export const ART_KEY = "war-game.proto.art";
export const ART_CHOICES: readonly ArtChoice[] = ["off", "x3", "x2"];
export const ART_LABEL: Record<ArtChoice, string> = { off: "關", x3: "3 倍", x2: "2 倍" };
/** Without a choice saved on the device. */
export const ART_DEFAULT: ArtChoice = "x3";

type Store = Pick<Storage, "getItem" | "setItem">;

function browserStore(): Store | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadArtChoice(store: Store | null = browserStore()): ArtChoice {
  try {
    const v = store?.getItem(ART_KEY);
    const known = ART_CHOICES.find((c) => c === v);
    if (known !== undefined) return known;
  } catch {
    // Unreadable: as if never saved.
  }
  return ART_DEFAULT;
}

export function saveArtChoice(c: ArtChoice, store: Store | null = browserStore()): void {
  try {
    store?.setItem(ART_KEY, c);
  } catch {
    // Not saved: 3 倍 again next time.
  }
}

/** Where a choice's atlases are, under the page: the Release's tag (art.lock.json), or the test page's stand-ins. */
export function artBase(choice: ArtChoice | "test", tag: string | null): string | null {
  if (choice === "test") return "./art/test/x3/";
  if (choice === "off" || tag === null) return null;
  return `./art/${tag}/${choice}/`;
}
