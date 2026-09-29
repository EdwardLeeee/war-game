// Draws the placeholder art both spikes share, as plain geometric shapes (no third-party
// assets), and writes PNGs with Node's zlib only:
//   node spikes/tools/make-art.mjs
// units.png: 12 rows (team * 3 + type) x 12 frames of 32 x 32 px; frames 0-7 walk,
//            8-11 attack. Units face right; the renderer mirrors them to face left.
//            Row 12 holds extras: 0 selection ring, 1 white square (health bars).
// tiles.png: 8 tiles of 16 x 16 px: 0-3 grass, 4-5 rock, 6-7 trees.
// godot/icon.png: 1024 x 1024 app icon (the iOS export requires one).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUTPUTS = [join(ROOT, "web", "public", "art"), join(ROOT, "godot", "art")];

const TEAM = [
  [217, 67, 59],
  [59, 115, 217],
  [222, 178, 48],
  [58, 170, 90],
];
const F = 32;

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Float64Array(w * h * 4);
  }
  /** Paint shape(x, y) -> bool with 4x4 supersampling inside the box, over existing pixels. */
  fill(x0, y0, x1, y1, color, shape, alpha = 1) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++) {
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, Math.ceil(x1)); x++) {
        let hit = 0;
        for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (shape(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hit++;
        if (hit === 0) continue;
        const a = (hit / 16) * alpha;
        const i = (y * this.w + x) * 4;
        const da = this.px[i + 3];
        const oa = a + da * (1 - a);
        for (let c = 0; c < 3; c++) this.px[i + c] = oa === 0 ? 0 : (color[c] * a + this.px[i + c] * da * (1 - a)) / oa;
        this.px[i + 3] = oa;
      }
    }
  }
  circle(cx, cy, r, color, alpha = 1) {
    this.fill(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, color, (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r, alpha);
  }
  ring(cx, cy, r, w, color) {
    this.fill(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, color, (x, y) => {
      const d = Math.hypot(x - cx, y - cy);
      return d <= r && d >= r - w;
    });
  }
  rect(x0, y0, x1, y1, color) {
    this.fill(x0, y0, x1, y1, color, (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1);
  }
  poly(points, color) {
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    this.fill(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), color, (x, y) => {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i];
        const [xj, yj] = points[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    });
  }
  line(x0, y0, x1, y1, w, color) {
    const len = Math.hypot(x1 - x0, y1 - y0);
    this.fill(Math.min(x0, x1) - w, Math.min(y0, y1) - w, Math.max(x0, x1) + w, Math.max(y0, y1) + w, color, (x, y) => {
      const t = Math.max(0, Math.min(1, ((x - x0) * (x1 - x0) + (y - y0) * (y1 - y0)) / (len * len)));
      return Math.hypot(x - (x0 + t * (x1 - x0)), y - (y0 + t * (y1 - y0))) <= w / 2;
    });
  }
  png() {
    const raw = Buffer.alloc((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        const o = y * (this.w * 4 + 1) + 1 + x * 4;
        for (let c = 0; c < 4; c++) raw[o + c] = Math.round(Math.max(0, Math.min(1, c === 3 ? this.px[i + 3] : this.px[i + c] / 255)) * 255);
      }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr.set([8, 6, 0, 0, 0], 8);
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }
}

const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const DARK = [28, 24, 22];
const LIGHT = [245, 240, 225];
const STEEL = [200, 205, 215];
const WOOD = [140, 95, 50];
const shade = (c, k) => c.map((v) => Math.round(v * k));

function drawUnit(cv, ox, oy, team, type, frame) {
  const col = TEAM[team];
  const walk = frame < 8;
  const bob = walk ? [0, -1, -2, -1, 0, 1, 2, 1][frame] * 0.6 : 0;
  const lean = walk ? 0 : [0, 2, 4, 1][frame - 8];
  const cx = ox + 16 + lean * 0.5;
  const cy = oy + 17 + bob;
  // feet alternate while walking
  const step = walk ? [0, 1, 2, 1, 0, -1, -2, -1][frame] : 0;
  cv.circle(cx - 4 + step, oy + 27, 2.2, DARK);
  cv.circle(cx + 4 - step, oy + 27, 2.2, DARK);
  if (type === 0) {
    // melee: round body, shield, spear
    cv.circle(cx, cy, 8.5, DARK);
    cv.circle(cx, cy, 7.2, col);
    cv.circle(cx - 2, cy - 2.5, 2.5, shade(col, 1.25));
    cv.line(cx - 6, cy + 6 - lean, cx + 13 + lean * 1.5, cy - 7, 2, WOOD);
    cv.poly([[cx + 13 + lean * 1.5, cy - 10], [cx + 17 + lean * 1.5, cy - 9], [cx + 14 + lean * 1.5, cy - 5]], STEEL);
    cv.rect(cx - 9, cy - 3, cx - 5, cy + 5, LIGHT);
  } else if (type === 1) {
    // ranged: triangle body, bow
    cv.poly([[cx - 8, cy + 8], [cx + 8, cy + 8], [cx, cy - 9]], DARK);
    cv.poly([[cx - 6, cy + 6.5], [cx + 6, cy + 6.5], [cx, cy - 6.5]], col);
    cv.fill(cx + 4, cy - 9, cx + 16, cy + 9, WOOD, (x, y) => {
      const d = Math.hypot(x - (cx + 6), y - cy);
      return x >= cx + 6 && d <= 8 && d >= 6.2;
    });
    cv.line(cx + 6, cy - 7.5, cx + 6 - lean, cy + 7.5, 1, LIGHT);
    if (!walk && frame >= 10) cv.line(cx + 6, cy, cx + 15, cy, 1.2, STEEL);
  } else {
    // fast: diamond body with a trailing streak
    cv.line(cx - 15, cy + 2, cx - 7, cy + 2, 2, shade(col, 0.7));
    cv.poly([[cx - 10, cy], [cx, cy - 9], [cx + 11, cy], [cx, cy + 9]], DARK);
    cv.poly([[cx - 8, cy], [cx, cy - 7], [cx + 9, cy], [cx, cy + 7]], col);
    cv.line(cx + 2, cy, cx + 14 + lean * 1.5, cy - 3, 2, STEEL);
  }
  if (!walk) {
    const r = [2, 4, 6, 3][frame - 8];
    cv.circle(ox + 27, cy - 2, r, [255, 248, 200], 0.85);
  }
}

const units = new Canvas(12 * F, 13 * F);
for (let team = 0; team < 4; team++) {
  for (let type = 0; type < 3; type++) {
    for (let frame = 0; frame < 12; frame++) drawUnit(units, frame * F, (team * 3 + type) * F, team, type, frame);
  }
}
units.ring(16, 12 * F + 16, 15, 2, [255, 255, 255]);
units.rect(F, 12 * F, 2 * F, 13 * F, [255, 255, 255]);

const T = 16;
const tiles = new Canvas(8 * T, T);
let seed = 7;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let v = 0; v < 4; v++) {
  tiles.rect(v * T, 0, (v + 1) * T, T, [86 + v * 3, 128 - v * 2, 70]);
  for (let k = 0; k < 10; k++) {
    const x = v * T + rnd() * T;
    const y = rnd() * T;
    tiles.line(x, y, x + 1, y - 2.5, 1, [110, 160, 84]);
  }
}
for (let v = 0; v < 2; v++) {
  const ox = (4 + v) * T;
  tiles.rect(ox, 0, ox + T, T, [80, 110, 66]);
  tiles.poly([[ox + 1, T - 1], [ox + 4 + v * 2, 3], [ox + 10, 1 + v], [ox + T - 1, T - 2]], [118, 112, 104]);
  tiles.poly([[ox + 4 + v * 2, 3], [ox + 10, 1 + v], [ox + 8, 8]], [150, 144, 134]);
}
for (let v = 0; v < 2; v++) {
  const ox = (6 + v) * T;
  tiles.rect(ox, 0, ox + T, T, [74, 104, 60]);
  tiles.circle(ox + 5 + v * 3, 6, 5, [36, 84, 44]);
  tiles.circle(ox + 11 - v * 2, 9, 5.5, [44, 96, 50]);
  tiles.circle(ox + 6, 12, 4, [40, 90, 46]);
}

// App icon (opaque, as iOS wants): a spear across a bow on a dark field.
const icon = new Canvas(1024, 1024);
icon.rect(0, 0, 1024, 1024, [40, 52, 44]);
icon.circle(512, 512, 330, DARK);
icon.circle(512, 512, 300, [236, 226, 200]);
icon.line(300, 730, 730, 300, 44, WOOD);
icon.poly([[700, 250], [790, 230], [770, 320]], STEEL);
icon.fill(420, 250, 760, 780, WOOD, (x, y) => {
  const d = Math.hypot(x - 430, y - 512);
  return x >= 470 && d <= 270 && d >= 238;
});
icon.line(470, 260, 470, 764, 10, DARK);

for (const dir of OUTPUTS) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "units.png"), units.png());
  writeFileSync(join(dir, "tiles.png"), tiles.png());
}
writeFileSync(join(ROOT, "godot", "icon.png"), icon.png());
console.log(`wrote units.png (${units.w}x${units.h}) and tiles.png (${tiles.w}x${tiles.h}) to ${OUTPUTS.join(", ")}`);
