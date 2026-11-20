// 快捷鍵 (R26 02 B, design/r26/spec.md section 02; ceo 2026-11-20): which key a press is, and which cell's letter a
// button takes by where it is drawn.

import assert from "node:assert/strict";
import { test } from "node:test";
import { cellKeys, hotkeyOf } from "../src/input/hotkeys.ts";

const press = (code: string, o: Partial<{ shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; repeat: boolean }> = {}) =>
  hotkeyOf({ code, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, repeat: false, ...o });

test("按鍵：字母照位置、1–4 編隊（Shift、Ctrl 存）、F2、句點、Space、Esc、Backspace；照鍵盤上的位置（Shift+1 是 1）", () => {
  assert.deepEqual(press("KeyQ"), { kind: "slot", key: "Q" });
  assert.deepEqual(press("KeyB"), { kind: "slot", key: "B" });
  assert.equal(press("KeyP"), null, "not a cell's");
  assert.deepEqual(press("Digit3"), { kind: "group", n: 2, save: false });
  assert.deepEqual(press("Digit1", { shiftKey: true }), { kind: "group", n: 0, save: true });
  assert.deepEqual(press("Digit4", { ctrlKey: true }), { kind: "group", n: 3, save: true });
  assert.equal(press("Digit5"), null);
  assert.deepEqual(press("F2"), { kind: "army" });
  assert.deepEqual(press("Period"), { kind: "idle" });
  assert.deepEqual(press("Space"), { kind: "pause" });
  assert.deepEqual(press("Escape"), { kind: "escape" });
  assert.deepEqual(press("Backspace"), { kind: "retreatAll" });
});

test("按鍵：Ctrl、Alt、⌘ 和字母一起不收（重新整理、關分頁是瀏覽器的）；Shift 和字母不收；按著不連發", () => {
  assert.equal(press("KeyR", { ctrlKey: true }), null);
  assert.equal(press("KeyW", { metaKey: true }), null);
  assert.equal(press("KeyQ", { altKey: true }), null);
  assert.equal(press("KeyQ", { shiftKey: true }), null);
  assert.equal(press("Digit1", { altKey: true }), null);
  assert.equal(press("Space", { shiftKey: true }), null);
  assert.equal(press("KeyQ", { repeat: true }), null);
  assert.equal(press("Digit2", { repeat: true }), null);
});

test("格子的字母：照畫出來的列和欄；寬的照它開始的那一格；五欄時第五欄是 T、G、B；第四列以後沒有", () => {
  const cols = [100, 161, 222, 283];
  // A building's panel: 訓練 two wide, 集結點, 自動訓練; then a second row.
  assert.deepEqual(
    cellKeys(cols, [
      { x: 100, y: 500 },
      { x: 222, y: 500 },
      { x: 283, y: 500 },
      { x: 100, y: 556 },
      { x: 161, y: 556.5 },
    ]),
    ["Q", "E", "R", "A", "S"],
  );
  // A cell left empty: the next keeps its own letter.
  assert.deepEqual(
    cellKeys(cols, [
      { x: 100, y: 10 },
      { x: 283, y: 10 },
    ]),
    ["Q", "R"],
  );
  const five = [0, 57, 114, 171, 228];
  assert.deepEqual(
    cellKeys(five, [
      { x: 228, y: 0 },
      { x: 228, y: 60 },
      { x: 228, y: 120 },
      { x: 0, y: 180 },
    ]),
    ["T", "G", "B", null],
  );
});
