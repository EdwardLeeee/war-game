// 建築圖的透明遮罩 (ceo 2026-11-20): a tap on a villager standing behind a building, seen over its roof or beside its
// tower, picked the building: the cover test took the picture's whole box, its transparent sky and corners too. For
// each building picture of every atlas set under public/art/<tag>/x{2,3}/buildings/, which cells of it are drawn:
// buildings_<culture>.mask.json beside buildings_<culture>.json, read by the page with the pictures
// (src/render/picture-mask.ts). Made when the atlases are fetched (fetch-art.ts), from the PNG pages: a phone gets the
// ASTC pages, which the page cannot read back, so the mask cannot be made there; it is a few kB besides.
//
//   node scripts/building-masks.ts     every set under public/art/ (fetch-art.ts runs it after fetching)

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";

const CLIENT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ART = join(CLIENT, "public", "art");

/** A cell of the mask is this many texture px on a side at 3 倍 (2 倍: two thirds of it): about 2.7 screen pt at zoom 1. */
export const MASK_CELL_X3 = 8;
/** A cell counts as drawn when some pixel in it is at least this opaque (of 255). */
export const MASK_ALPHA = 128;

/** A PNG's alpha: 8-bit RGBA, not interlaced, as ui's atlas pages are (anything else: an error). */
export function pngAlpha(file: string): { width: number; height: number; alpha: Uint8Array } {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: not a PNG`);
  let pos = 8;
  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("latin1", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const [depth, colour, , , interlace] = data.subarray(8, 13);
      if (depth !== 8 || colour !== 6 || interlace !== 0) throw new Error(`${file}: ${depth}-bit colour type ${colour} interlace ${interlace}, not 8-bit RGBA`);
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const rows = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = rows.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? rows.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[i - 4] : 0;
      const b = prev === null ? 0 : prev[i];
      const c = prev === null || i < 4 ? 0 : prev[i - 4];
      let v = src[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`${file}: filter ${filter}`);
      out[i] = v & 0xff;
    }
  }
  const alpha = new Uint8Array(width * height);
  for (let k = 0; k < alpha.length; k++) alpha[k] = rows[k * 4 + 3];
  return { width, height, alpha };
}

interface FrameRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One frame's mask: `cols` × `rows` cells of `cell` px, a bit each (row by row, low bit first), base64. */
export function frameMask(page: { width: number; alpha: Uint8Array }, r: FrameRect, cell: number): { w: number; h: number; bits: string } {
  const cols = Math.ceil(r.w / cell);
  const rows = Math.ceil(r.h / cell);
  const bits = new Uint8Array(Math.ceil((cols * rows) / 8));
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let drawn = false;
      for (let y = cy * cell; y < Math.min(r.h, (cy + 1) * cell) && !drawn; y++) {
        const row = (r.y + y) * page.width + r.x;
        for (let x = cx * cell; x < Math.min(r.w, (cx + 1) * cell); x++) {
          if (page.alpha[row + x] >= MASK_ALPHA) {
            drawn = true;
            break;
          }
        }
      }
      if (drawn) {
        const k = cy * cols + cx;
        bits[k >> 3] |= 1 << (k & 7);
      }
    }
  }
  return { w: cols, h: rows, bits: Buffer.from(bits).toString("base64") };
}

/** Every buildings_<culture>.json under `root` (public/art): its mask file written beside it. Returns how many. */
export function writeBuildingMasks(root = ART): number {
  let n = 0;
  if (!existsSync(root)) return 0;
  for (const tag of readdirSync(root)) {
    for (const x of ["x3", "x2"]) {
      const dir = join(root, tag, x, "buildings");
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        const m = /^buildings_([A-Z]+)\.json$/.exec(f);
        if (m === null) continue;
        const json = JSON.parse(readFileSync(join(dir, f), "utf8")) as { scale?: number; pages: { color: string[] }; frames: Record<string, FrameRect> };
        const pages = json.pages.color.map((p) => (existsSync(join(dir, p)) ? pngAlpha(join(dir, p)) : null));
        const cell = Math.max(2, Math.round((MASK_CELL_X3 * (json.scale ?? 3)) / 3));
        const frames: Record<string, { w: number; h: number; bits: string }> = {};
        for (const [name, r] of Object.entries(json.frames)) {
          const page = pages[r.page];
          if (page === null || page === undefined) continue;
          frames[name] = frameMask(page, r, cell);
        }
        writeFileSync(join(dir, `buildings_${m[1]}.mask.json`), JSON.stringify({ format: "war-game building masks 1", cell, frames }));
        n++;
      }
    }
  }
  return n;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const t = performance.now();
  console.log(`building masks: ${writeBuildingMasks()} sets in ${Math.round(performance.now() - t)} ms`);
}
