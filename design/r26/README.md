# R26 電腦版介面：設計稿

Brief：`docs/briefs/2026-11-r26-desktop-ui.md` 第 3 節。使用者 2026-11-18：「電腦版UI優化一下吧，然後框起來選兵可以用右鍵？」

| 圖 | 項目 | 選項 |
|---|---|---|
| R26-01-介面放大-A自動放大-B加設定可調-desktop | 介面依視窗放大（戰場不放大）；選兵那一條和軍團畫面限制寬度 | A 自動；B 再加設定 |
| R26-02-快捷鍵-A照字的意思-B照位置-desktop | 按鈕角落標按鍵 | A 英文字頭；B QWER 位置 |
| R26-03-滑鼠說明-A貼在按鈕上-B固定在右下-desktop | 滑鼠停在按鈕上的說明 | A 貼按鈕；B 固定位置 |
| R26-04-小地圖常開-desktop | 小地圖常開在左下 | 只有一種 |
| R26-05-滑鼠游標-desktop | 游標隨目標變 | 只有一種 |
| R26-06-滑鼠操作-A右鍵框選-B左鍵框選右鍵下指令-desktop | 左右鍵各做什麼 | A 右鍵框選；B 左鍵框選、右鍵下指令 |
| R26-07-局後統計-desktop | 放大，總覽下面放兵力圖 | 只有一種 |
| R26-總覽-電腦版介面-desktop | 全部 | |

生效條件：放大只在視窗高 ≥ 600 px；其他只在有滑鼠的裝置（`(hover: hover) and (pointer: fine)`）。手機版不受影響。

使用者 2026-11-18 選了 01 B、02 B、03 A、06 B；04、05、07 照稿（D-154）。給 client 的實作規格：[`spec.md`](spec.md)。

## 怎麼做的

- 真頁面（Chromium，1920×950 和 1366×768，滑鼠、沒有觸控，正式介面 A 銅木，假世界 art-v7.11；新手教學用真的遊戲）。
- 放大用 CSS `zoom` 只放大 `#hud` 和 `#start`，戰場 `#stage` 不動。其他改法都在 `common/r26-page.js`，不是 client 的程式。
- 每一格量按鈕有沒有重疊、超出視窗，和畫面上最小的字（`build/shots/checks.json`）。

## 重做

```
cd client && npx vite build && npx vite preview --host 127.0.0.1 --port 5199 --strictPort   # art 解到 client/public/art/art-v7.11/{x3,x2}
node design/r26/common/r26-now.mjs design/r26/build/now big      # 現況（small：1366×768）
node design/r26/common/r26.mjs design/r26/build/shots            # 改法，可加項目編號 1–7
python3 -I design/r26/common/boards_r26.py design/r26/build/shots design/r26/build/boards
```

圖在 `design/r26/build/`（不進 repo）。
