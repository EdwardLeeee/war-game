// 開一局要等多久 (D-091): the lines the screen and the 量測 panel show, and where a file came from.

import assert from "node:assert/strict";
import { test } from "node:test";
import { type LoadReport, loadLines, sourceOf } from "../src/lab/load-times.ts";

const picture = (name: string, start: number, downloaded: number, decoded: number, source: "網路" | "手機裡" = "網路") => ({ name, bytes: 4 * 1048576, source, start, downloaded, decoded });

test("每一步一行：準備、美術（幾檔、從哪來、下載完和解碼完的時間、最慢的一張）、建立遊戲、模擬啟動、畫面準備、第一格、合計", () => {
  const r: LoadReport = {
    trigger: "開始",
    game: 1,
    page: "navigate",
    art: "載入",
    marks: { art: 120, artDone: 8120, init: 8170, ready: 8470, drawn: 8670, frame: 9020 },
    files: [
      { name: "units/spear_e/spear_e.json", bytes: 1048576 / 2, source: "網路", start: 130, downloaded: 400, decoded: null },
      picture("units/spear_e/spear_e_color_0.png", 400, 6000, 6100),
      picture("units/spear_e/spear_e_team_0.png", 400, 7800, 8100, "手機裡"),
    ],
  };
  assert.deepEqual(loadLines(r), [
    "載入計時：開始（這頁第 1 局，剛打開）",
    "準備（存檔、畫布） 0.12 秒",
    "美術 8.00 秒：3 檔 8.5 MB（手機裡 1、網路 2）",
    "　全部下載完 +7.68 秒，全部解碼完 +7.98 秒",
    "　解碼每張平均 200 ms，最慢 300 ms（units/spear_e/spear_e_team_0.png）",
    "建立遊戲 0.05 秒",
    "模擬啟動 0.30 秒",
    "畫面準備 0.20 秒",
    "第一格繪製 350 ms（含上傳顯示卡）",
    "合計 9.02 秒",
  ]);
});

test("載入中只寫到現在這一步；同一頁再開一局沿用已載入的圖", () => {
  const loading: LoadReport = { trigger: "開始", game: 1, page: "reload", art: null, marks: { art: 100 }, files: [picture("a.png", 100, 900, 1000)] };
  assert.deepEqual(loadLines(loading), ["載入計時：開始（這頁第 1 局，重新整理後）", "準備（存檔、畫布） 0.10 秒", "美術載入中…已載入 1 檔 4.0 MB"]);
  const again: LoadReport = { trigger: "重來", game: 2, page: "navigate", art: "沿用", marks: { art: 40, artDone: 41, init: 60, ready: 300 }, files: [] };
  assert.deepEqual(loadLines(again), ["載入計時：重來（這頁第 2 局，剛打開）", "準備（存檔、畫布） 0.04 秒", "美術 0.00 秒（沿用這頁已載入的圖）", "建立遊戲 0.02 秒", "模擬啟動 0.24 秒"]);
});

test("檔案從哪來：service worker 說從手機裡拿的就是手機裡、剛下載存起來的是網路；否則看瀏覽器的紀錄：沒送東西是瀏覽器快取，只送標頭是問過伺服器，其他是網路；沒有紀錄或沒有大小是不明", () => {
  assert.equal(sourceOf("hit", undefined), "手機裡");
  assert.equal(sourceOf("stored", { transferSize: 0, encodedBodySize: 5000 }), "網路");
  assert.equal(sourceOf(null, { transferSize: 0, encodedBodySize: 5000 }), "瀏覽器快取");
  assert.equal(sourceOf(null, { transferSize: 300, encodedBodySize: 5000 }), "問過伺服器");
  assert.equal(sourceOf(null, { transferSize: 5300, encodedBodySize: 5000 }), "網路");
  assert.equal(sourceOf(null, undefined), "不明");
  assert.equal(sourceOf(null, {}), "不明");
});
