import assert from "node:assert/strict";
import { test } from "node:test";
import { arrivedLine, cellStretch, type ShiftRow, shiftLine, shiftRows, stretchName, viaGates, type WallNames } from "../src/ui/hud/wall-shift.ts";

const compass: WallNames = { words: "compass", view: "diamond" };
const screen: WallNames = { words: "screen", view: "diamond" };

test("牆段的名字照地圖方位（PROTOCOL.md 4.7 的例子：東門頂 3、東牆南段 5、北牆西段 1）", () => {
  assert.equal(stretchName(3, compass), "東門頂");
  assert.equal(stretchName(5, compass), "東牆南段");
  assert.equal(stretchName(1, compass), "北牆西段");
  assert.equal(stretchName(11, compass), "西牆南段");
});

test("菱形鏡頭下照畫面方向：北牆在右上、東牆右下、南牆左下、西牆左上；兩半看靠哪個角", () => {
  assert.equal(stretchName(3, screen), "右下門頂");
  assert.equal(stretchName(5, screen), "右下牆靠下那段");
  assert.equal(stretchName(4, screen), "右下牆靠右那段");
  assert.equal(stretchName(1, screen), "右上牆靠上那段");
  assert.equal(stretchName(2, screen), "右上牆靠右那段");
  assert.equal(stretchName(7, screen), "左下牆靠左那段");
  assert.equal(stretchName(10, screen), "左上牆靠上那段");
  assert.equal(stretchName(11, screen), "左上牆靠左那段");
  // Square: north up.
  assert.equal(stretchName(5, { words: "screen", view: "square" }), "右牆靠下那段");
});

test("經過的城門頂照北東南西排", () => {
  assert.deepEqual(viaGates(2 | 1, compass), ["北門頂", "東門頂"]);
  assert.deepEqual(viaGates(0, compass), []);
});

const row = (r: Partial<ShiftRow>): ShiftRow => ({ town: 0, owner: 0, n: 4, from: 1, to: 5, via: 2, foes: 7, home: false, ...r });

test("R14-07 的字：換邊、走回原位、到了（照稿）", () => {
  assert.equal(shiftLine(row({}), 2, 10, compass), "換邊：4 名走過東門頂，去打東牆南段（敵人 7 名，沒超過牆上的 2 倍）");
  assert.equal(shiftLine(row({ via: 0, to: 4 }), 2, 10, compass), "換邊：4 名去打東牆北段（敵人 7 名，沒超過牆上的 2 倍）");
  assert.equal(shiftLine(row({ home: true }), 2, 10, compass), "敵人走了 10 秒：走回原位");
  assert.equal(arrivedLine(5, 6, compass), "東牆南段：6 名一起打");
  assert.equal(shiftLine(row({}), 2, 10, screen), "換邊：4 名走過右下門頂，去打右下牆靠下那段（敵人 7 名，沒超過牆上的 2 倍）");
});

test("快照的列：只要這座城、這一方的，人多的在前面", () => {
  const rows = Int32Array.from([0, 0, 2, 1, 4, 0, 3, 0, 1, 0, 5, 1, 5, 0, 3, 0, 0, 1, 9, 1, 5, 0, 3, 0, 0, 0, 5, 7, 5, 8, 3, 1]);
  assert.deepEqual(
    shiftRows(rows, 0, 0).map((r) => [r.n, r.to, r.home]),
    [
      [5, 5, true],
      [2, 4, false],
    ],
  );
  assert.deepEqual(shiftRows(undefined, 0, 0), []);
});

test("同一段、同一條路的換邊合成一行（出發的段不寫）；走回原位的全部合成一行", () => {
  // Seen on scenario wallshift: 2 from 北牆西段 and 2 from 北牆東段, both over 北門頂 to 東牆北段; three walking back.
  const rows = Int32Array.from([0, 0, 2, 1, 4, 1, 0, 0, 0, 0, 2, 2, 4, 1, 0, 0, 0, 0, 1, 4, 1, 1, 0, 1, 0, 0, 2, 5, 7, 4, 0, 1]);
  const got = shiftRows(rows, 0, 0);
  assert.deepEqual(
    got.map((r) => [r.n, r.to, r.home]),
    [
      [4, 4, false],
      [3, 1, true],
    ],
  );
  // No enemy seen there now (ceo 2026-11-06): not 「敵人 0 名」.
  assert.equal(shiftLine(got[0], 2, 10, compass), "換邊：4 名走過北門頂，去打東牆北段（敵人已離開視野）");
});

test("牆格屬於哪一段，和模擬一樣（wall-walk.ts wallStretch）：角落算北牆、南牆", () => {
  // Town centre (10, 10).
  assert.equal(cellStretch(13, 5, 10, 10, false), 2); // north, larger x
  assert.equal(cellStretch(7, 5, 10, 10, false), 1); // north, smaller x
  assert.equal(cellStretch(10, 5, 10, 10, true), 0); // north gate
  assert.equal(cellStretch(15, 8, 10, 10, false), 4); // east, smaller y
  assert.equal(cellStretch(15, 12, 10, 10, false), 5); // east, larger y
  assert.equal(cellStretch(15, 5, 10, 10, false), 2); // the corner: north
  assert.equal(cellStretch(5, 15, 10, 10, false), 7); // the corner: south, smaller x
  assert.equal(cellStretch(5, 9, 10, 10, false), 10); // west, smaller y
});
