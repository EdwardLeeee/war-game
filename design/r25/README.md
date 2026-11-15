# R25 新手教學關卡：設計稿

Brief：`docs/briefs/2026-11-r25-tutorial.md`（D-150）。使用者：「我覺得可以做一個獨立的新手教學」，選「只要教學關卡」。

| 圖 | 內容 |
|---|---|
| R25-總覽-phone | 框的樣子 A（遮暗）｜B（金框加箭頭）並排，加九步各一格 |
| R25-框的樣子-A和B.gif | A、B 閃的樣子 |
| R25-共用元件-phone | 說明卡（平常、一行、等待、做對了、收起、移到左邊、目標不在畫面裡）、手勢、入口、離開、完成 |
| R25-步驟-1到5-phone、R25-步驟-6到9-phone | 每步每一格，寫要做的和過關條件 |

九步（ceo 草案的 11 步併成 9 步）：1 看地圖、2 採集、3 蓋兵營、4 練兵、5 選兵和移動、6 編軍團、7 守家（攻擊＋主城被打）、8 打城鎮（打城鎮＋進駐）、9 打下對手主城。

## 怎麼做的

- 畫在 client 的真頁面上：`?test=1&mock=1&ui=r6&art=x3&ground=real&r7=1&outpost=1&siege=1`（假世界代替 core 的教學場景），Chromium 932×336，iPhone 安全區。
- 介面先套 R24 改完的樣子（`design/r24/common/r24-page.js`：一條、指令區一排），再由 `common/tutorial-page.js` 加上說明卡、框、手勢、邊上的標籤、離開確認。都不是 client 的程式。
- 每一格照 client 的檢查量按鈕（44 pt 以下、超出安全區），也量說明卡有沒有蓋到按鈕、遊戲自己的提示或進駐標籤。結果存在 `build/shots/checks.json`。
- `boards_r25.py` 畫字以前先檢查字型有沒有那個字（R24 畫出過兩個空框）。

## 重做

```
cd client && npx vite build && npx vite preview --host 127.0.0.1 --port 5199 --strictPort   # art 解到 client/public/art/art-v7.11/{x3,x2}
node design/r25/common/r25.mjs design/r25/build/shots A          # 每一格，A
node design/r25/common/r25.mjs design/r25/build/shots B 3a 2b    # 總覽上的 B
node design/r25/common/gif_r25.mjs design/r25/build/gif
python3 -I design/r25/common/boards_r25.py design/r25/build/shots design/r25/build/boards
```

圖在 `design/r25/build/`（不進 repo）。使用者選了 B 的話，第一行改成 `B`，再排一次。
