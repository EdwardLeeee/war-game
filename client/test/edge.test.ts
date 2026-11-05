// 浮空大陸的邊緣 (R11 C, D-118): its description read, the cliff's pieces along the two lower edges,
// the waterfalls where water meets them, and how light each piece is under the fog.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cliffFromBottom, cliffPieces, edgeCell, edgeFalls, edgeFiles, edgeLight, edgePoint, parseEdge } from "../src/render/edge-layout.ts";
import { Fog, Terrain } from "../src/sim.ts";

const piece = (file: string) => ({ file, anchor: [1, 1] as [number, number] });
const EDGE = {
  format: "war-game edge 1",
  view: "diamond",
  scale: 3,
  pxPerM: 60,
  clouds: {
    far: { file: "clouds_far.png", alpha: false, tile_px: 1024, parallax: 0.2, drift_px_s: [6, 2], fade_s: 12 },
    near: { file: "clouds_near.png", alpha: true, tile_px: 1024, parallax: 0.35, drift_px_s: [10, 3], fade_s: 9 },
  },
  islands: [{ ...piece("island_0.png"), size_m: 10, bob_px: 3, bob_s: 5 }],
  cliff: {
    height_m: 13,
    stretch_m: 16,
    overlap_m: 1,
    sw: [0, 1, 2].map((k) => ({ ...piece(`cliff_sw_${k}.png`), lip: [[0, 0], [9, 4]] })),
    se: [0, 1, 2].map((k) => ({ ...piece(`cliff_se_${k}.png`), lip: [[0, 4], [9, 0]] })),
    corner: { left: piece("corner_left.png"), bottom: piece("corner_bottom.png"), right: piece("corner_right.png") },
  },
  fall: { loop: { file: "fall_loop.png", width_m: 6, period_px: 512, scroll_m_s: 4, widen_per_m: 0.07 }, spray: piece("fall_spray.png"), mouth: { ...piece("fall_mouth.png"), foam_m: 3.5 } },
  puffs: [{ file: "puff_0.png", drift_px_s: [8, -2], alpha_max: 0.6 }],
  rim: { fade_m: 3 },
};

test("edge.json：照 ui 的格式讀進來；格式不對、缺崖面或雲海就不畫；每個檔案只列一次", () => {
  const e = parseEdge(EDGE);
  assert.ok(e !== null);
  assert.equal(parseEdge({ ...EDGE, format: "war-game edge 2" }), null);
  assert.equal(parseEdge({ ...EDGE, cliff: { ...EDGE.cliff, sw: [] } }), null);
  assert.equal(parseEdge({ ...EDGE, clouds: { far: EDGE.clouds.far } }), null);
  assert.equal(parseEdge(null), null);
  const files = edgeFiles(e);
  assert.equal(files.length, new Set(files).size);
  assert.ok(files.includes("cliff_se_2.png") && files.includes("corner_bottom.png") && files.includes("fall_mouth.png"));
  // art-v7: the se edge's own mouth.
  const v7 = parseEdge({ ...EDGE, fall: { ...EDGE.fall, mouth: { ...EDGE.fall.mouth, se: piece("fall_mouth_se.png") } } });
  assert.ok(v7 !== null && edgeFiles(v7).includes("fall_mouth_se.png"));
});

test("崖面：每 16 公尺（8 格）一段，排滿整條邊、不重疊也不留空；用哪一段照位置決定，兩次一樣", () => {
  const a = cliffPieces(128, "sw", 16, 3);
  assert.equal(a.length, 16);
  assert.equal(a[0].from, 0);
  assert.equal(a.at(-1)?.to, 128);
  for (let k = 1; k < a.length; k++) assert.equal(a[k].from, a[k - 1].to);
  assert.deepEqual(a, cliffPieces(128, "sw", 16, 3));
  assert.ok(a.every((p) => p.kind >= 0 && p.kind < 3));
  assert.ok(new Set(a.map((p) => p.kind)).size === 3, "all three pieces used");
  // A map not a multiple of 8: the pieces stretch a little, still edge to edge.
  const b = cliffPieces(125, "se", 16, 3);
  assert.equal(b.at(-1)?.to, 125);
});

test("art-v7 的崖面（from: bottom）：從下角沿兩條邊，第 k 段中點在 16k 公尺；129 格是 1–15 段；兩頭留給下角 8 公尺、左右角 10 公尺", () => {
  const sw = cliffFromBottom(129, "sw", 16, 3);
  const se = cliffFromBottom(129, "se", 16, 3);
  assert.equal(sw.length, 15);
  assert.equal(se.length, 15);
  // sw: along from the left corner, the bottom at 129; piece 1 nearest the bottom.
  assert.deepEqual(sw.map((p) => p.mid), Array.from({ length: 15 }, (_, k) => 129 - 8 * (k + 1)));
  assert.deepEqual([sw[0].from, sw[0].to], [117, 125], "下角的 8 公尺（4 格）之後");
  assert.deepEqual([sw.at(-1)?.from, sw.at(-1)?.to], [5, 13], "左角的 10 公尺（5 格）之前");
  assert.deepEqual(se.map((p) => p.mid), Array.from({ length: 15 }, (_, k) => 8 * (k + 1)));
  assert.deepEqual([se.at(-1)?.from, se.at(-1)?.to], [116, 124], "右角的 10 公尺之前");
  for (const list of [sw, se]) for (let k = 1; k < list.length; k++) assert.equal(Math.abs(list[k].mid - list[k - 1].mid), 8, "一段 16 公尺，不拉長");
  assert.ok(sw.every((p) => p.kind >= 0 && p.kind < 3) && new Set(sw.map((p) => p.kind)).size === 3);
  assert.deepEqual(sw, cliffFromBottom(129, "sw", 16, 3), "兩次一樣");
  // Another length (128 cells, 256 m): one more piece against the far corner's leg, no gap.
  const short = cliffFromBottom(128, "se", 16, 3);
  assert.equal(short.length, 15);
  assert.equal(short.at(-1)?.to, 123, "右角的 10 公尺（5 格）之前");
});

test("邊上的格子：左下邊是最下一列由左到右，右下邊是最右一行由下到上；點在地圖邊線上", () => {
  assert.equal(edgeCell(10, "sw", 0), 90);
  assert.equal(edgeCell(10, "sw", 9), 99);
  assert.equal(edgeCell(10, "se", 0), 99);
  assert.equal(edgeCell(10, "se", 9), 9);
  assert.deepEqual(edgePoint(10, "sw", 3), { x: 3, y: 10 });
  assert.deepEqual(edgePoint(10, "se", 3), { x: 10, y: 7 });
});

test("瀑布：水（含淺灘、橋下）碰到左下或右下邊的每一段；上面兩條邊不算", () => {
  const n = 12;
  const t = new Uint8Array(n * n);
  // A river leaving by the bottom row at x 4-6 (a ford at 6), and by the right column at y 1-2.
  for (const x of [4, 5]) t[(n - 1) * n + x] = Terrain.Water;
  t[(n - 1) * n + 6] = Terrain.Ford;
  for (const y of [1, 2]) t[y * n + n - 1] = Terrain.Water;
  // Water on the top row: no cliff there.
  t[3] = Terrain.Water;
  assert.deepEqual(edgeFalls(t, n), [
    { side: "sw", from: 4, to: 7 },
    { side: "se", from: 9, to: 11 },
  ]);
  // Water up to the corner: the run ends with the edge.
  const c = new Uint8Array(n * n);
  c[(n - 1) * n + n - 1] = Terrain.Water;
  assert.deepEqual(edgeFalls(c, n), [
    { side: "sw", from: 11, to: 12 },
    { side: "se", from: 0, to: 1 },
  ]);
});

test("崖面的亮度跟著那段邊的迷霧：看得到 1、探索過 0.55、沒探索 0.15，取平均；沒有迷霧時全亮", () => {
  const n = 8;
  const fog = new Uint8Array(n * n).fill(Fog.Unexplored);
  assert.equal(edgeLight(fog, n, "sw", 0, 4), 0.15);
  for (let x = 0; x < 4; x++) fog[(n - 1) * n + x] = Fog.Visible;
  assert.equal(edgeLight(fog, n, "sw", 0, 4), 1);
  fog[(n - 1) * n + 3] = Fog.Explored;
  assert.ok(Math.abs(edgeLight(fog, n, "sw", 0, 4) - (3 + 0.55) / 4) < 1e-9);
  assert.equal(edgeLight(null, n, "se", 0, 8), 1);
});
