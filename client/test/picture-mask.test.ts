// The cover test with the building pictures' masks (ceo 2026-11-20: a villager seen over the main city's roof, beside
// its tower or behind a flat foundation was taken as hidden by it, and a tap on him picked the building): a tap where
// the picture is transparent picks the unit; where it is drawn, the building; a flat foundation never hides anyone.
// And the masks made from a PNG page as the build makes them (scripts/building-masks.ts).

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { frameMask, pngAlpha } from "../scripts/building-masks.ts";
import { MOCK_RULES } from "../src/mock/mock-port.ts";
import { coverPicture, type DrawnPicture } from "../src/render/building-depth.ts";
import { maskDrawn, parseMasks, type PictureMask } from "../src/render/picture-mask.ts";
import { Action, BUILDING_STRIDE, BuildingField as B, BuildingType, CELL, HEADER_LENGTH, type MapInfo, type Snapshot, UNIT_STRIDE, UnitField as U, UnitType } from "../src/sim.ts";
import { TILE_PX } from "../src/tuning.ts";
import { GameView } from "../src/view/view.ts";

/** A 4 × 2 mask: its left half drawn, its right half transparent. */
function leftHalf(): PictureMask {
  const bits = new Uint8Array(1);
  for (const k of [0, 1, 4, 5]) bits[k >> 3] |= 1 << (k & 7);
  return { cols: 4, rows: 2, bits };
}

test("遮罩：畫到的格子是 true，透明的、圖外面的是 false；檔案讀得回來", () => {
  const m = leftHalf();
  assert.equal(maskDrawn(m, 0.1, 0.2), true);
  assert.equal(maskDrawn(m, 0.4, 0.9), true);
  assert.equal(maskDrawn(m, 0.6, 0.2), false);
  assert.equal(maskDrawn(m, 0.99, 0.99), false);
  assert.equal(maskDrawn(m, -0.1, 0.5), false);
  assert.equal(maskDrawn(m, 0.2, 1), false);
  const parsed = parseMasks({ format: "war-game building masks 1", cell: 8, frames: { a: { w: 4, h: 2, bits: Buffer.from(m.bits).toString("base64") } } });
  assert.deepEqual(parsed?.get("a"), m);
  assert.equal(parseMasks({ format: "something else" }), null);
});

test("蓋住的判斷：只算圖真的畫到的地方；平的地基不算；沒有遮罩照整個外框", () => {
  // A picture's box 0–100 × 0–200 on the plane, drawn in front (z 500) of a unit at depth 400.
  const house: DrawnPicture = { cellX: 0, cellY: 0, size: 2, z: 500, x0: 0, y0: 0, x1: 100, y1: 200, mask: leftHalf() };
  assert.equal(coverPicture([house], 20, 50, 400), 0, "drawn there: it hides him");
  assert.equal(coverPicture([house], 80, 50, 400), -1, "transparent there: not hidden");
  assert.equal(coverPicture([house], 20, 50, 600), -1, "the unit in front of it");
  assert.equal(coverPicture([{ ...house, flat: true }], 20, 50, 400), -1, "a flat foundation hides no one");
  assert.equal(coverPicture([{ ...house, mask: null }], 80, 50, 400), 0, "no mask: its whole box, as before");
});

// The same through the tap (GameView.pick, the cover hook as world.ts sets it): a soldier of ours behind a building.
const SIZE = 32;
const map: MapInfo = { seed: 1, size: SIZE, terrain: new Uint8Array(SIZE * SIZE), spawns: [], towns: [] };

function viewBehind(mask: PictureMask): GameView {
  const v = new GameView(0, map, MOCK_RULES);
  const u = new Int32Array(UNIT_STRIDE);
  u[U.action] = Action.Idle;
  u[U.id] = 1;
  u[U.owner] = 0;
  u[U.type] = UnitType.Spearman;
  u[U.x] = Math.round(11.5 * CELL);
  u[U.y] = Math.round(9.5 * CELL);
  const b = new Int32Array(BUILDING_STRIDE);
  b[B.id] = 50;
  b[B.owner] = 0;
  b[B.type] = BuildingType.House;
  b[B.cellX] = 10;
  b[B.cellY] = 10;
  b[B.hp] = 100;
  b[B.progress] = 1000;
  const snap: Snapshot = { type: "snapshot", header: new Int32Array(HEADER_LENGTH), units: u, buildings: b, towns: new Int32Array(0), warnings: new Int32Array(0), nodes: new Int32Array(0), fog: null, placement: null, idleFarmers: new Int32Array(0), events: [] };
  v.push(snap, 0);
  // The house's picture: a box 9–14 cells across, 6–12 down (the unit behind it, at 11.5, 9.5), in front of him.
  const picture: DrawnPicture = { cellX: 10, cellY: 10, size: 2, z: 12 * TILE_PX, x0: 9 * TILE_PX, y0: 6 * TILE_PX, x1: 14 * TILE_PX, y1: 12 * TILE_PX, mask };
  v.coverAt = (px, py, _ux, uy) => {
    const i = coverPicture([picture], px, py, uy);
    return i < 0 ? null : 50;
  };
  return v;
}

test("點選：兵在建築後面，點下去的地方建築圖是透明的 → 選到兵；畫到的 → 選到建築", () => {
  const at = [11.5 * TILE_PX, 9.5 * TILE_PX] as const;
  // His feet at 2.5 / 5 across the box and 3.5 / 6 down: the mask's 3rd column, 2nd row.
  const clear: PictureMask = { cols: 5, rows: 6, bits: new Uint8Array(4) };
  assert.deepEqual(viewBehind(clear).pick(...at, 22), { kind: "unit", id: 1, owner: 0, type: UnitType.Spearman });
  const full: PictureMask = { cols: 5, rows: 6, bits: new Uint8Array(4).fill(255) };
  assert.deepEqual(viewBehind(full).pick(...at, 22), { kind: "building", id: 50, owner: 0, type: BuildingType.House });
});

/** A PNG (8-bit RGBA) of these alphas, filtered row by row with these filters, as an encoder may. */
function png(width: number, height: number, alpha: (x: number, y: number) => number, filters: number[]): string {
  const raw: number[] = [];
  const rows: number[][] = [];
  for (let y = 0; y < height; y++) {
    const row: number[] = [];
    for (let x = 0; x < width; x++) row.push(90, 120, 60, alpha(x, y));
    rows.push(row);
  }
  for (let y = 0; y < height; y++) {
    const f = filters[y % filters.length];
    raw.push(f);
    const r = rows[y];
    const up = y > 0 ? rows[y - 1] : null;
    for (let i = 0; i < r.length; i++) {
      const a = i >= 4 ? r[i - 4] : 0;
      const b = up === null ? 0 : up[i];
      const c = up === null || i < 4 ? 0 : up[i - 4];
      const p = a + b - c;
      const pr = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? pr : 0;
      raw.push((r[i] - pred) & 0xff);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const file = join(mkdtempSync(join(tmpdir(), "mask-")), "page.png");
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.from(raw))), chunk("IEND", Buffer.alloc(0))]));
  return file;
}

test("建置時的遮罩：PNG 的透明度讀得對（五種濾波），每格有一點不透明就算畫到", () => {
  // 16 × 8: opaque in a 5 × 3 block from (2, 1), else transparent.
  const file = png(16, 8, (x, y) => (x >= 2 && x < 7 && y >= 1 && y < 4 ? 255 : 0), [0, 1, 2, 3, 4]);
  const page = pngAlpha(file);
  assert.equal(page.width, 16);
  assert.equal(page.alpha[1 * 16 + 2], 255);
  assert.equal(page.alpha[0 * 16 + 2], 0);
  assert.equal(page.alpha[3 * 16 + 6], 255);
  assert.equal(page.alpha[4 * 16 + 6], 0);
  // The frame at (0, 0) 16 × 8 in cells of 4: 4 × 2 cells; drawn: columns 0 and 1 of row 0 (block x 2–6, y 1–3).
  const m = frameMask(page, { page: 0, x: 0, y: 0, w: 16, h: 8 }, 4);
  assert.equal(m.w, 4);
  assert.equal(m.h, 2);
  const parsed = parseMasks({ format: "war-game building masks 1", cell: 4, frames: { f: m } })?.get("f");
  if (parsed === undefined) throw new Error("no mask");
  const drawn = [0, 1, 2, 3, 4, 5, 6, 7].filter((k) => (parsed.bits[k >> 3] & (1 << (k & 7))) !== 0);
  assert.deepEqual(drawn, [0, 1]);
});
