// A small stand-in for war-game-ui's atlases (D-085), made when the tests run: every unit the
// prototype draws, in the real description format (docs/sprite-atlas.md version 2), each frame a
// coloured block, so the e2e tests draw units from atlases without any art in the repository or
// a Release. Written to public/art/test/x3/ (git ignores public/art/); the page loads it with
// ?test=1&art=test.
//
//   node scripts/make-test-atlas.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { ATLAS_FORMAT, ATLAS_NAMES, EFFECTS_FORMAT } from "../src/art/spec.ts";

const OUT = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "public", "art", "test", "x3");

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** An RGBA PNG of w × h, coloured by `px(x, y)` → [r, g, b, a]. */
export function png(w: number, h: number, px: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const raw = new Uint8Array(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    for (let x = 0; x < w; x++) raw.set(px(x, y), y * (w * 4 + 1) + 1 + x * 4);
  }
  const head = new Uint8Array(13);
  const v = new DataView(head.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  head.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const RENDERED = [0, 1, 2, 6, 7];
const FRAMES = 2;

/** One unit: a 48 × 64 page per layer; every frame is its whole page (a block from the foot up). */
function unit(name: string, k: number): void {
  const dir = join(OUT, "units", name);
  mkdirSync(dir, { recursive: true });
  const anims: Record<string, { frames: number; fps: number; loop: boolean; placeholder: boolean; hit?: number; impact?: number }> = {
    idle: { frames: FRAMES, fps: 8, loop: true, placeholder: false },
    walk: { frames: FRAMES, fps: 12, loop: true, placeholder: false },
    attack: { frames: FRAMES, fps: 20, loop: false, placeholder: false, hit: 1 },
    death: { frames: FRAMES, fps: 12, loop: false, placeholder: false, impact: 1 },
  };
  if (name.startsWith("farmer")) for (const w of ["work_chop", "work_mine", "work_farm", "work_build"]) anims[w] = { frames: FRAMES, fps: 10, loop: true, placeholder: false, hit: 1 };
  if (name.startsWith("mage")) anims.cast = { frames: 30, fps: 20, loop: false, placeholder: false };
  const frame = { page: 0, x: 0, y: 0, w: 48, h: 64, ax: 24, ay: 60 };
  const frames: Record<string, typeof frame> = {};
  const team: Record<string, typeof frame> = {};
  const shadows: Record<string, typeof frame & { half_res: boolean }> = {};
  for (const [anim, info] of Object.entries(anims)) {
    for (let i = 0; i < info.frames; i++) {
      const ii = String(i).padStart(2, "0");
      for (const f of RENDERED) frames[`${name}_${anim}_f${f}_${ii}`] = team[`${name}_${anim}_f${f}_${ii}`] = frame;
      for (let f = 0; f < 8; f++) shadows[`${name}_${anim}_f${f}_${ii}`] = { page: 0, x: 0, y: 0, w: 24, h: 12, ax: 12, ay: 6, half_res: true };
    }
  }
  const shade = 120 + ((k * 37) % 120);
  writeFileSync(join(dir, `${name}_color_0.png`), png(48, 64, (x, y) => (x > 10 && x < 38 && y > 4 ? [shade, shade, shade, 255] : [0, 0, 0, 0])));
  writeFileSync(join(dir, `${name}_team_0.png`), png(48, 64, (x, y) => (x > 14 && x < 34 && y > 20 && y < 44 ? [255, 255, 255, 255] : [0, 0, 0, 0])));
  writeFileSync(join(dir, `${name}_shadow_0.png`), png(24, 12, () => [0, 0, 0, 90]));
  const json = {
    format: ATLAS_FORMAT,
    unit: name,
    scale: 3,
    px_per_m: 60,
    team_gain: 1.6,
    facings: { rendered: RENDERED, mirrored: { 3: 1, 4: 0, 5: 7 } },
    anims,
    pages: { color: [`${name}_color_0.png`], team: [`${name}_team_0.png`], shadow: [`${name}_shadow_0.png`], fx: [], shield: [] as string[] },
    frames,
    team,
    shadows,
    fx: {},
  };
  if (name.startsWith("mage")) {
    json.pages.shield = [`${name}_shield_0.png`];
    writeFileSync(join(dir, `${name}_shield_0.png`), png(48, 64, (x, y) => ((x - 24) ** 2 + (y - 34) ** 2 < 22 ** 2 ? [90, 230, 240, 70] : [0, 0, 0, 0])));
    Object.assign(json, { shield: { anims: { on: { frames: 1, fps: 8, loop: true } }, frames: { [`${name}_shield_on_00`]: { page: 0, x: 0, y: 0, w: 48, h: 64, ax: 24, ay: 60 } } } });
  }
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(json));
}

function effects(): void {
  const dir = join(OUT, "effects");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "effects_0.png"), png(32, 16, () => [200, 180, 150, 120]));
  const frames: Record<string, object> = {};
  for (let i = 0; i < 2; i++) frames[`dust_0${i}`] = { page: 0, x: 0, y: 0, w: 32, h: 16, ax: 16, ay: 8 };
  writeFileSync(join(dir, "effects.json"), JSON.stringify({ format: EFFECTS_FORMAT, scale: 3, px_per_m: 60, pages: ["effects_0.png"], effects: { dust: { frames: 2, fps: 12, loop: false } }, frames }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  ATLAS_NAMES.forEach((name, k) => unit(name, k));
  effects();
  console.log(`test atlases: ${ATLAS_NAMES.length} units and effects → public/art/test/x3/`);
}
