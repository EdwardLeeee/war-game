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

/**
 * 貼圖 (D-128): the atlases' pages as PNG (decoded to 4 bytes a pixel on the GPU) or as ASTC 4×4
 * (a quarter of that, never decoded) where the GPU takes it and the art has them (art-v7.1 on).
 * Chosen in the 量測 panel (a page may ask with ?tex=), remembered on this device like 美術.
 */
export type TexChoice = "png" | "astc";

export const TEX_KEY = "war-game.proto.tex";
export const TEX_CHOICES: readonly TexChoice[] = ["png", "astc"];
export const TEX_LABEL: Record<TexChoice, string> = { png: "PNG", astc: "ASTC" };
/**
 * Without a choice saved: ASTC (D-128, the user 2026-11-05: 最高畫質、壓縮; art-v7.6 on). A GPU
 * without it, or art without the compressed pages, draws 2 倍's PNGs instead (artScale).
 */
export const TEX_DEFAULT: TexChoice = "astc";

export function loadTexChoice(store: Store | null = browserStore()): TexChoice {
  try {
    const v = store?.getItem(TEX_KEY);
    const known = TEX_CHOICES.find((c) => c === v);
    if (known !== undefined) return known;
  } catch {
    // Unreadable: as if never saved.
  }
  return TEX_DEFAULT;
}

export function saveTexChoice(c: TexChoice, store: Store | null = browserStore()): void {
  try {
    store?.setItem(TEX_KEY, c);
  } catch {
    // Not saved: the default again next time.
  }
}

/**
 * The scale drawn (D-128, the user 2026-11-05): 3 倍 with ASTC asked for, on a GPU without ASTC
 * (or art without its compressed pages), takes 2 倍's PNGs instead: art-v7's 3 倍 as PNG is 773 MB
 * on the GPU, 2 倍 351. Anything else as chosen.
 */
export function artScale(choice: ArtChoice | "test", tex: TexChoice, astc: boolean): ArtChoice | "test" {
  return choice === "x3" && tex === "astc" && !astc ? "x2" : choice;
}
