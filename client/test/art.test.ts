// 兵種精靈圖集 (D-085, docs/sprite-atlas.md): which picture direction a sim facing shows, from
// above and as a diamond; which frame (mirrored or not) and when; the description files read
// and refused; the 量測 panel's 美術 kept on the device; where a Release's archives unpack.

import assert from "node:assert/strict";
import { test } from "node:test";
import { animFor, attackFrame, ATLAS_NAMES, type AtlasJson, frameAt, frameName, parseAtlas, pictureDirection, UNIT_ATLAS, walkFps, workOfNode } from "../src/art/spec.ts";
import { artBase, loadArtChoice, saveArtChoice } from "../src/art/pref.ts";
import { sha256, unpackDir } from "../scripts/fetch-art.ts";
import { png } from "../scripts/make-test-atlas.ts";
import { Action, CELL, NodeKind, UnitType } from "../src/sim.ts";

test("朝向：俯視時 +x 是右（方向 0），菱形時 +x 是右下（方向 7）；偶數剛好一個方向（規格第 3 節的表）", () => {
  assert.deepEqual([0, 2, 4, 6, 8, 10, 12, 14].map((k) => pictureDirection(k, null, "diamond")), [7, 6, 5, 4, 3, 2, 1, 0]);
  assert.deepEqual([0, 2, 4, 6, 8, 10, 12, 14].map((k) => pictureDirection(k, null, "top")), [0, 7, 6, 5, 4, 3, 2, 1]);
});

test("朝向：奇數在兩個方向中間——原本就是其中一個就保留（不來回閃），不然取比較靠近面向鏡頭（6）的", () => {
  // Diamond, facing 1: between 7 and 6.
  assert.equal(pictureDirection(1, null, "diamond"), 6);
  assert.equal(pictureDirection(1, 7, "diamond"), 7);
  assert.equal(pictureDirection(1, 6, "diamond"), 6);
  assert.equal(pictureDirection(1, 2, "diamond"), 6, "neither: the one nearer 6");
  // Facing 9 (between 3 and 2): 3 is nearer 6.
  assert.equal(pictureDirection(9, null, "diamond"), 3);
  // Out of range wraps.
  assert.equal(pictureDirection(16, null, "diamond"), 7);
  assert.equal(pictureDirection(-2, null, "diamond"), 0);
});

const ATLAS: AtlasJson = parseAtlas({
  format: "war-game atlas 2",
  unit: "spear_e",
  scale: 3,
  px_per_m: 60,
  facings: { rendered: [0, 1, 2, 6, 7], mirrored: { 3: 1, 4: 0, 5: 7 } },
  anims: {
    idle: { frames: 8, fps: 8, loop: true },
    walk: { frames: 8, fps: 12, loop: true },
    attack: { frames: 10, fps: 20, loop: false, hit: 5 },
    death: { frames: 10, fps: 12, loop: false, impact: 7 },
    work_chop: { frames: 8, fps: 10, loop: true },
  },
  pages: { color: [], team: [], shadow: [], fx: [], shield: [] },
  frames: {},
  team: {},
  shadows: {},
  fx: {},
});

test("影格名稱：3、4、5 方向借 1、0、7 的圖、左右翻；影子 8 個方向都有、不翻", () => {
  assert.deepEqual(frameName(ATLAS, "walk", 7, 3), { name: "spear_e_walk_f7_03", mirror: false });
  assert.deepEqual(frameName(ATLAS, "walk", 4, 3), { name: "spear_e_walk_f0_03", mirror: true });
  assert.deepEqual(frameName(ATLAS, "attack", 5, 10), { name: "spear_e_attack_f7_10", mirror: true });
  assert.deepEqual(frameName(ATLAS, "walk", 4, 3, "shadow"), { name: "spear_e_walk_f4_03", mirror: false });
});

test("動作：sim 的 action 對到動作；採集看資源點；圖集沒有的動作用待機", () => {
  assert.equal(animFor(ATLAS, Action.Idle, null), "idle");
  assert.equal(animFor(ATLAS, Action.Move, null), "walk");
  assert.equal(animFor(ATLAS, Action.Attack, null), "attack");
  assert.equal(animFor(ATLAS, Action.Gather, workOfNode(NodeKind.Tree)), "work_chop");
  assert.equal(animFor(ATLAS, Action.Gather, workOfNode(NodeKind.GoldMine)), "idle", "no work_mine in this atlas");
  assert.equal(animFor(ATLAS, Action.Calibrate, null), "idle", "no cast");
  assert.equal(workOfNode(NodeKind.CrystalVein), "mine");
  assert.equal(workOfNode(NodeKind.Berries), "farm");
});

test("播放：循環的從 start 那一格開始轉圈；只播一次的停在最後一格；攻擊每隔一個冷卻重播一次、中間停在第 0 格", () => {
  const idle = ATLAS.anims.idle;
  assert.equal(frameAt(idle, 8, 0, 3), 3);
  assert.equal(frameAt(idle, 8, 1, 3), 3, "8 frames a second: around once");
  assert.equal(frameAt(idle, 8, 0.25, 3), 5);
  const death = ATLAS.anims.death;
  assert.equal(frameAt(death, 12, 0.5), 6);
  assert.equal(frameAt(death, 12, 9), 9, "held at the last");
  const attack = ATLAS.anims.attack;
  // Cooldown 1.5 s (30 ticks), 20 frames a second: 10 frames in 0.5 s, then the first frame.
  assert.equal(attackFrame(attack, 20, 0.25, 1.5), 5);
  assert.equal(attackFrame(attack, 20, 1.0, 1.5), 9);
  assert.equal(attackFrame(attack, 20, 1.5, 1.5), 0, "the next swing");
  assert.equal(attackFrame(attack, 20, 1.6, 1.5), 2);
});

test("走路的速度：1 格／秒是每秒 12 格；有 stride_m 時照步幅（腳不滑）", () => {
  const oneCellPerSecond = CELL / 20;
  assert.equal(walkFps(ATLAS, oneCellPerSecond), 12);
  assert.equal(walkFps(ATLAS, oneCellPerSecond * 2), 24);
  const strided = { ...ATLAS, anims: { ...ATLAS.anims, walk: { frames: 8, fps: 12, loop: true, stride_m: 4 } } };
  // 1 cell a second = 2 m a second: 8 frames per 4 m → 4 frames a second.
  assert.equal(walkFps(strided, oneCellPerSecond), 4);
});

test("說明檔：只收 war-game atlas 2（第 1 版的特效層含防護罩）", () => {
  assert.throws(() => parseAtlas({ ...ATLAS, format: "war-game atlas 1" }), /atlas 2/);
  assert.throws(() => parseAtlas(null));
  assert.throws(() => parseAtlas({ format: "war-game atlas 2", unit: "x" }), /incomplete/);
});

test("原型的兵穿哪套圖：東陸、西陸各 5 種，民兵用槍兵；圍城器械不在原型", () => {
  assert.deepEqual(ATLAS_NAMES, ["bow_w", "farmer_e", "farmer_w", "hcav_e", "knight_w", "mage_e", "mage_w", "pike_w", "spear_e", "xbow_e"]);
  assert.deepEqual(UNIT_ATLAS[UnitType.Militia], UNIT_ATLAS[UnitType.Spearman]);
});

test("量測面板的美術：存在這台裝置，讀不到就是關；位置照 Release 的 tag，沒有 tag 就沒有", () => {
  const map = new Map<string, string>();
  const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
  assert.equal(loadArtChoice(store), "off");
  saveArtChoice("x2", store);
  assert.equal(loadArtChoice(store), "x2");
  map.set("war-game.proto.art", "x9");
  assert.equal(loadArtChoice(store), "off");
  const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(loadArtChoice(broken), "off");
  saveArtChoice("x3", broken);
  assert.equal(artBase("x3", "art-v1"), "./art/art-v1/x3/");
  assert.equal(artBase("x3", null), null);
  assert.equal(artBase("off", "art-v1"), null);
  assert.equal(artBase("test", null), "./art/test/x3/");
});

test("拿圖：Release 的壓縮檔解到哪裡；雜湊；測試用的 PNG 是合法的", () => {
  assert.equal(unpackDir("art-v1-x3.tar.gz"), "x3");
  assert.equal(unpackDir("art-v12-x2.tar.gz"), "x2");
  assert.equal(unpackDir("astc-sample.tar.gz"), "astc-sample");
  assert.equal(sha256(new TextEncoder().encode("abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  const p = png(3, 2, () => [255, 0, 0, 255]);
  assert.deepEqual([...p.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(new DataView(p.buffer).getUint32(16), 3);
  assert.equal(new DataView(p.buffer).getUint32(20), 2);
});
