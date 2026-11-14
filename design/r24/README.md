# R24 介面健檢：改法的稿

Brief：`docs/briefs/2026-11-r24-ui-audit.md`（D-149）。使用者 2026-11-15：「1-5都可以改。我覺得你可以把有問題的頁面打開然後給我看你想的改法。」

每項一張，現況和改法並排，加一張總覽（iPhone 932×336 加安全區，正式介面 A 銅木）：

| 圖 | 項目 | 改法 |
|---|---|---|
| R24-01-正式介面設成預設-phone | 01 | 原型和正式介面並排五個畫面（client 拍的） |
| R24-02-選取資訊面板-phone | 02 | 選兵後只剩貼底邊的一條（44 pt）；說明字收進「？」；「展開」換成「軍團」那一格，軍團畫面不超過畫面高的 40% |
| R24-03-常駐按鈕-phone | 03 | 指令區一排四顆：攻擊、移動、進駐、更多；隊形、堅守、整理隊形、停止照使用次數收進「更多」 |
| R24-04-用到才教-phone | 04 | 遇到時在訊息條跳一句提示（四句；「第一次攻下城鎮」不加） |
| R24-總覽-phone | 全部 | 選了部隊時，四項都改前和改後 |

## 怎麼做的

- 現況和改法都在 client 的真頁面上拍：`?test=1&mock=1&ui=r6&art=x3&ground=real`（假世界、art-v7.11），Playwright Chromium，932×336，安全區用 CSS 變數 `--safe-*`（左右 59、下 21）。R24-03 和總覽加 `&r7=1&outpost=1`，讓假世界有「進駐」（真的遊戲有）。
- 改法是 `common/r24-page.js` 把頁面上現有的元件改位置、改樣子（選取資訊面板變成一條、軍團畫面套高度上限、指令區收進「更多」、訊息條放提示），不是 client 的程式。量的方框和訊息條的位置都是頁面自己的。
- 每個狀態都照 client 的檢查量一次（`zz-r24.spec.ts`：按鈕小於 44 pt、互相重疊、超出安全區），結果印在終端機，存在 `build/shots/checks.json`。
- client 的原圖（`war-game-worktrees/review/r24/raw/`）是 WebKit 拍的；這台機器跑不了 WebKit，所以 02–04 的現況也在 Chromium 重拍，兩邊字型才一致。R24-01 和 04 的「開局提示」用 client 的原圖。

## 重做

```
cd client && npx vite build && npx vite preview --host 127.0.0.1 --port 5199 --strictPort   # art 解到 client/public/art/art-v7.11/{x3,x2}
node design/r24/common/r24.mjs design/r24/build/shots 02 03 04 all
python3 -I design/r24/common/boards_r24.py design/r24/build/shots ../review/r24/raw design/r24/build/boards
```

圖在 `design/r24/build/`（不進 repo）。
