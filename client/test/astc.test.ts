// 貼圖 ASTC (D-128): which pages are loaded compressed, what they take on the GPU, the 3 倍 → 2 倍
// fallback, the choice kept on the device, art-v7 量測's result rows, and the test page's stand-ins.

import assert from "node:assert/strict";
import { test } from "node:test";
import { gpuBytes, ktxFor } from "../src/art/compressed.ts";
import { artScale, loadTexChoice, saveTexChoice, TEX_KEY } from "../src/art/pref.ts";
import { ART_VARIANTS, artMeasureRows, artVariant } from "../src/lab/art-measure.ts";
import { astcKtx } from "../scripts/make-test-atlas.ts";

test("壓縮圖：清單（art-release-astc.json）有的頁換成同路徑的 .astc.ktx；地面、別的資料夾、清單沒有的照舊 PNG", () => {
  const c = { base: "./art/art-v7.1/x3/", files: new Set(["units/spear_e/spear_e_color_0.astc.ktx", "edge/cliff_sw_0.astc.ktx"]) };
  assert.equal(ktxFor("./art/art-v7.1/x3/units/spear_e/spear_e_color_0.png", c), "./art/art-v7.1/x3/units/spear_e/spear_e_color_0.astc.ktx");
  assert.equal(ktxFor("./art/art-v7.1/x3/edge/cliff_sw_0.png", c), "./art/art-v7.1/x3/edge/cliff_sw_0.astc.ktx");
  assert.equal(ktxFor("./art/art-v7.1/x3/ground/grass.png", c), null);
  assert.equal(ktxFor("./art/art-v7.1/x2/units/spear_e/spear_e_color_0.png", c), null);
  assert.equal(ktxFor("./art/art-v7.1/x3/units/spear_e/spear_e_color_0.png", null), null);
});

test("顯示卡上的大小：PNG 每像素 4 bytes；ASTC 4×4 每 4×4 一塊 16 bytes，邊長不是 4 的倍數時進位（ui 的 865×888）", () => {
  assert.equal(gpuBytes({ pixelWidth: 2048, pixelHeight: 2048, format: "rgba8unorm" }), 2048 * 2048 * 4);
  assert.equal(gpuBytes({ pixelWidth: 2048, pixelHeight: 2048, format: "astc-4x4-unorm" }), 2048 * 2048);
  assert.equal(gpuBytes({ pixelWidth: 865, pixelHeight: 888, format: "astc-4x4-unorm" }), 217 * 222 * 16);
});

test("D-128：3 倍要 ASTC 但顯示卡沒有（或美術沒有壓縮圖）就用 2 倍 PNG；其他照選的", () => {
  assert.equal(artScale("x3", "astc", false), "x2");
  assert.equal(artScale("x3", "astc", true), "x3");
  assert.equal(artScale("x3", "png", false), "x3");
  assert.equal(artScale("x2", "astc", false), "x2");
  assert.equal(artScale("off", "astc", false), "off");
  assert.equal(artScale("test", "astc", false), "test");
});

test("貼圖的選擇記在這台裝置；沒選過、讀不到或亂寫的都算 ASTC（D-128，art-v7.5 起）", () => {
  const kept = new Map<string, string>();
  const store = { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => void kept.set(k, v) };
  assert.equal(loadTexChoice(store), "astc");
  saveTexChoice("png", store);
  assert.equal(kept.get(TEX_KEY), "png");
  assert.equal(loadTexChoice(store), "png");
  kept.set(TEX_KEY, "etc2");
  assert.equal(loadTexChoice(store), "astc");
  const broken = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(loadTexChoice(broken), "astc");
  assert.doesNotThrow(() => saveTexChoice("png", broken));
});

test("art-v7 量測：三種的順序是 x3 ASTC、x2 PNG、x3 PNG（最可能撐不住的最後）；結果寫實際畫的、貼圖 MB、地面另計、ASTC、瀏覽器", () => {
  assert.deepEqual(
    ART_VARIANTS.map((v) => v.id),
    ["x3-astc", "x2-png", "x3-png"],
  );
  assert.equal(artVariant("x2-png")?.scale, "x2");
  assert.equal(artVariant("nope"), null);
  const v = ART_VARIANTS[0];
  const rows = artMeasureRows(v, "3 倍 ASTC", { atlas: 193.3 * 2 ** 20, edge: 2 * 2 ** 20, ground: 7.9 * 2 ** 20, pages: 112, astcPages: 104 }, true, "Mozilla/5.0 (iPhone)");
  assert.deepEqual(rows, [
    ["art-v7 量測", "x3 ASTC（實際畫的：3 倍 ASTC）"],
    ["貼圖", "195.3 MB（112 頁，其中 ASTC 104 頁；邊緣 2.0 MB）"],
    ["地面", "7.9 MB（PNG，另計）"],
    ["顯示卡有 ASTC", "有"],
    ["瀏覽器", "Mozilla/5.0 (iPhone)"],
  ]);
});

test("測試頁的壓縮圖：KTX 1、0x93B0、4×4 一塊；每塊是那 16 個像素預乘後的平均（只是替身，不是編碼器）", () => {
  const k = astcKtx(6, 5, (x) => (x < 4 ? [200, 100, 50, 128] : [0, 0, 0, 0]), true);
  const v = new DataView(k.buffer);
  assert.deepEqual([...k.subarray(0, 12)], [0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(v.getUint32(28, true), 0x93b0);
  assert.equal(v.getUint32(36, true), 6);
  assert.equal(v.getUint32(40, true), 5);
  // 2 × 2 blocks of 16 bytes after the 64-byte header and the 4-byte size.
  assert.equal(v.getUint32(64, true), 4 * 16);
  assert.equal(k.length, 64 + 4 + 4 * 16);
  // The first block: all four columns coloured, premultiplied (200 × 128 / 255 ≈ 100).
  assert.equal(v.getUint16(68 + 8, true), Math.round((200 * 128) / 255) * 257);
  assert.equal(v.getUint16(68 + 14, true), 128 * 257);
  // The second (x 4–5): clear.
  assert.equal(v.getUint16(68 + 16 + 14, true), 0);
});
