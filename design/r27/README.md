# R27 哨所轉向：設計稿

使用者 2026-11-27：「你哨所的角度都一樣，其實應該要應對關口的位置轉向」。使用者選「先自動轉，不滿意再自己轉」：蓋的時候照地形自動轉（牆橫跨窄處、門洞順著路；空曠地背對自己的主城），放的時候可以按「旋轉」；也選了「蓋好也能轉」（哨所面板多一顆「轉向」）。擋路照舊是 3×3，只有外觀轉。

| 圖 | 項目 | 選項 |
|---|---|---|
| R27-01-方向-AB-南北向-phone | 南北向（橋頭） | A、B 都有 |
| R27-01-方向-AB-東西向-phone | 東西向（山谷口；現在的哨所就是這個方向） | A、B 都有 |
| R27-01-方向-B-斜向西北東南-phone | 斜向，牆在畫面上是橫的 | 只有 B |
| R27-01-方向-B-斜向東北西南-phone | 斜向，牆在畫面上是直的 | 只有 B |
| R27-01-方向-B-斜放對照-phone | 斜放：原尺寸（角凸出 3×3）或縮小塞進 3×3 | 選 B 才要選 |
| R27-02-放哨所介面-phone | 手機：「旋轉」「自動」標籤、蓋好後的「轉向」；app 全螢幕和 Safari | |
| R27-02-放哨所介面-desktop | 電腦：同上，R 鍵 | |
| R27-03-總覽-phone | 全部 | |

## 發現

門洞前後貫穿，兩面一樣，所以轉 180° 只差旗子插在哪個角：A 的四個方向只有 2 種樣子，B 的八個方向只有 4 種樣子。方向那組照 ceo 2026-11-27 定的，每種樣子一張，每張附轉 180° 的小圖。

## 怎麼做的

- 哨所：art-v7 的那座（`design/r12/blender/outpost_v7.py`，D-121 敵臺門洞）。轉向是轉鏡頭的方位（`design/b1/common/run.py` 的 `r27y000`–`r27y315`：az＝菱形的 −45 減去轉的角度），因為燈跟著鏡頭（round2 的 lib），光照和遊戲裡的其他建築一樣。牆頂的站點（`stand_at_*`）掛在模型上，跟著轉。縮小版（`r27fit*`）長寬乘 0.816，高度不變（`render_b1.py` 的 `xy_scale`）。
- 背景：client 的雙河關，電腦對電腦觀戰（沒有戰爭迷霧），開局暫停、介面藏起來（`common/scenes.mjs`、`scenes_ui.mjs`），iPhone 14 Pro Max 橫放的 app 全螢幕 932×430、Safari 932×336，電腦 1920×950。
- 合成（`common/compose.py`）照 client 畫建築的做法（`render/structure-art.ts`）：圖的錨點對在占地正中間，比例 ptPerM ÷ px_per_m，隊伍顏色照 mask 上色，牆頂的槍兵用 art-v7.11 的圖集、面朝外，前景層蓋在槍兵上面。
- 介面（`common/ui.mjs`）：假世界的真介面拍下來，戰場藏掉、背景透明，再疊到雙河關上；「旋轉」「自動」標籤、「轉向」、「已轉向」用頁面自己的樣式加進去，排版時用黃框標出來。
- 排版：`common/boards_r27.py`。畫字以前先檢查字型有沒有那個字。

## 重做

```
python3 design/b1/common/run.py r27y000      # …r27y315、r27fit315（Blender，每個約 4 分鐘）
cd client && npx vite build && npx vite preview --host 127.0.0.1 --port 5199 --strictPort   # art 解到 client/public/art/art-v7.11
node design/r27/common/scenes.mjs design/r27/build/bg
node design/r27/common/scenes_ui.mjs design/r27/build/bg
node design/r27/common/ui.mjs design/r27/build/hud
python3 -I design/r27/common/boards_r27.py design/r27/build/boards
```

圖在 `design/r27/build/` 和 `design/b1/build/b1/r27/`（都不進 repo）。

## 參考做法（只參考做法，不仿外觀）

- AoE2 DE：城門放的時候可以轉（預設按住 Ctrl 轉滾輪，可以改鍵），貼著城牆時自動對齊牆；城門有橫、直和兩個斜的。來源：Age of Empires 論壇「How to rotate gates?」、「Gate rotation hotkey should be prioritized over building hotkey」。
- AoE4：大部分建築不能轉，城門、牆塔會貼著牆自動對齊。來源：GamesRadar「How to rotate buildings in Age of Empires 4」等攻略。
