// ASTC 4×4 (D-128, the user 2026-11-05: 最高畫質、壓縮): which of an art folder's pages have a
// compressed version, and what a page takes on the GPU. Pure (no PixiJS), for the unit tests;
// render/unit-art.ts loads them.

/**
 * ASTC 4×4 (D-128): the pages under an art folder that have a compressed version beside them, as
 * art-v7.1's art-release-astc.json lists them (ui's design/release/README.md: every page but the
 * ground's, at the PNG's path with .png turned into .astc.ktx), for a GPU that takes ASTC. Null: PNG.
 */
export interface Compressed {
  /** The folder the list is in (…/x3/). */
  base: string;
  /** Its .astc.ktx files, relative to it. */
  files: ReadonlySet<string>;
}

/** The .astc.ktx beside a page, when the list has one; else null (the PNG). */
export function ktxFor(url: string, c: Compressed | null): string | null {
  if (c === null || !url.startsWith(c.base) || !url.endsWith(".png")) return null;
  const rel = `${url.slice(c.base.length, -".png".length)}.astc.ktx`;
  return c.files.has(rel) ? `${c.base}${rel}` : null;
}

/** What a page takes on the GPU: 4 bytes a pixel, or ASTC 4×4's 16 a block of 4 × 4 (a page's edge rounded up). */
export function gpuBytes(s: { pixelWidth: number; pixelHeight: number; format: string }): number {
  return s.format.startsWith("astc-4x4") ? Math.ceil(s.pixelWidth / 4) * Math.ceil(s.pixelHeight / 4) * 16 : s.pixelWidth * s.pixelHeight * 4;
}
