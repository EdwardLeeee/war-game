// 電影色調 (R9-05 B): off unless this device was told on; 圓邊霧 (R9-07): the fog's edge blurred
// round over FOG_ROUND_SCALE texels a cell, the middle of sight clear and the far fog whole.

import assert from "node:assert/strict";
import { test } from "node:test";
import { GRADE_KEY, loadGradeOn, saveGradeOn } from "../src/grade-pref.ts";
import { FOG_ROUND_SCALE, roundFog } from "../src/render/round-fog.ts";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

test("電影色調：沒存過就是關；存了開就開、存了關就關；讀不到也當關", () => {
  const s = memory();
  assert.equal(loadGradeOn(s), false);
  saveGradeOn(true, s);
  assert.equal(s.m.get(GRADE_KEY), "on");
  assert.equal(loadGradeOn(s), true);
  saveGradeOn(false, s);
  assert.equal(loadGradeOn(s), false);
  assert.equal(loadGradeOn({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined }), false);
  assert.equal(loadGradeOn(null), false);
});

test("圓邊霧：整片一樣的霧照舊；看得到的一大塊中間全清、遠處全暗，邊上由淡到濃，斜邊和直邊一樣柔", () => {
  const size = 32;
  const k = FOG_ROUND_SCALE;
  const n = size * k;
  const out = new Uint8ClampedArray(n * n * 4);
  const tmp = new Float32Array(n * n);
  roundFog(new Uint8Array(size * size).fill(140), size, out, tmp);
  for (let i = 0; i < n * n; i++) assert.equal(out[i * 4 + 3], 140);
  // A 12 × 12 cells square in sight in the middle.
  const cells = new Uint8Array(size * size).fill(255);
  for (let y = 10; y < 22; y++) for (let x = 10; x < 22; x++) cells[y * size + x] = 0;
  roundFog(cells, size, out, tmp);
  const at = (cx: number, cy: number) => out[(Math.round(cy * k) * n + Math.round(cx * k)) * 4 + 3];
  assert.equal(at(16, 16), 0, "the middle clear");
  assert.equal(at(2, 2), 255, "far off whole");
  // Across the left edge (x 10): fog to clear, never back.
  let last = 256;
  for (let x = 7; x <= 13; x += 0.25) {
    const v = at(x, 16);
    assert.ok(v <= last, `x ${x}: ${v} after ${last}`);
    last = v;
  }
  assert.ok(at(10, 16) > 40 && at(10, 16) < 215, "soft at the edge");
  // The corner is cut round: at the corner itself, less clear than on the edge's middle.
  assert.ok(at(10.25, 10.25) > at(10.25, 16));
});
