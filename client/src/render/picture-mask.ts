// A building picture's transparent cells (ceo 2026-11-20): which of its cells are drawn, from
// buildings_<culture>.mask.json beside the atlas (scripts/building-masks.ts makes them from the PNG pages when the
// atlases are fetched: a phone's ASTC pages cannot be read back). The cover test asks it so that a unit seen over a
// roof or beside a tower, where the picture's box is only sky, is not taken as hidden. No PixiJS: unit-tested alone.

/** `cols` × `rows` cells over the whole picture, a bit each (row by row, low bit first): 1 drawn. */
export interface PictureMask {
  cols: number;
  rows: number;
  bits: Uint8Array;
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The masks of a mask file, by frame name; null for anything that is not one. */
export function parseMasks(json: unknown): Map<string, PictureMask> | null {
  const j = json as { format?: string; frames?: Record<string, { w: number; h: number; bits: string }> } | null;
  if (j === null || typeof j !== "object" || j.format !== "war-game building masks 1" || j.frames === undefined) return null;
  const out = new Map<string, PictureMask>();
  for (const [name, f] of Object.entries(j.frames)) out.set(name, { cols: f.w, rows: f.h, bits: fromBase64(f.bits) });
  return out;
}

/** The picture is drawn at (fx, fy), each 0–1 across it (outside it: not drawn). */
export function maskDrawn(m: PictureMask, fx: number, fy: number): boolean {
  if (!(fx >= 0 && fx < 1 && fy >= 0 && fy < 1)) return false;
  const k = Math.floor(fy * m.rows) * m.cols + Math.floor(fx * m.cols);
  return (m.bits[k >> 3] & (1 << (k & 7))) !== 0;
}

/** Bytes these masks take. */
export function maskBytes(masks: Iterable<PictureMask>): number {
  let n = 0;
  for (const m of masks) n += m.bits.length;
  return n;
}
