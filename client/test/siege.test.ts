// 攻城砲的石頭 (D-099): from the engine when it is seen, from `from`'s side when only the landing
// is; a parabola from the release to the ground, gone once it lands.

import assert from "node:assert/strict";
import { test } from "node:test";
import { AFAR_M, dirStep, FROM_AFAR_CELLS, RELEASE_M, stoneAt, stoneOf } from "../src/game/siege.ts";

const cellOf = (fixed: number) => fixed / 1024;

test("攻城砲的石頭：看得到攻城砲時從它出發；只看得到落點時從 from 的方向、6 格外高處飛進來；兩個都不知道就不畫", () => {
  const ev = { x: 20 * 1024, y: 10 * 1024, lands: 120 };
  assert.deepEqual(stoneOf(ev, { x: 12, y: 10 }, 100, cellOf), { fromX: 12, fromY: 10, fromUpM: RELEASE_M, toX: 20, toY: 10, thrown: 100, lands: 120 });
  // from 8: west (the engine is west of the landing).
  const afar = stoneOf({ ...ev, from: 8 }, null, 100, cellOf);
  assert.ok(afar !== null);
  assert.ok(Math.abs(afar.fromX - (20 - FROM_AFAR_CELLS)) < 1e-9 && Math.abs(afar.fromY - 10) < 1e-9);
  assert.equal(afar.fromUpM, AFAR_M);
  assert.equal(stoneOf(ev, null, 100, cellOf), null);
  // 4: south (y down).
  const [sx, sy] = dirStep(4);
  assert.ok(Math.abs(sx) < 1e-9 && Math.abs(sy - 1) < 1e-9);
});

test("攻城砲的石頭：丟出時在放開的高度，飛到中途比直線高，落地那一刻起就不在空中", () => {
  const s = { fromX: 0, fromY: 0, fromUpM: RELEASE_M, toX: 10, toY: 0, thrown: 0, lands: 20 };
  const start = stoneAt(s, 0, 2);
  assert.deepEqual(start, { x: 0, y: 0, upM: RELEASE_M });
  const mid = stoneAt(s, 10, 2);
  assert.ok(mid !== null && mid.x === 5 && mid.upM > RELEASE_M, "higher than its release midway (20 m: a 6 m arc)");
  const late = stoneAt(s, 19, 2);
  assert.ok(late !== null && late.upM < 1.5, "nearly down");
  assert.equal(stoneAt(s, 20, 2), null, "landed");
  assert.equal(stoneAt(s, -1, 2), null, "not thrown yet");
});
