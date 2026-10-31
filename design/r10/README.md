# R10 輪：開局畫面多一張存下來的地圖

- 主題：使用者 2026-10-31 喜歡上一局的隨機地圖（種子 2106939660，「有好幾個地形關口」），選了「把這張存成可以選的地圖」（ceo 派工）。
- 底稿：R6-10 開局卡片 A 銅木（`design/r6/mock`，核准版）。main b4ea244 的 client 開局卡片還是原型的（`FORMAL_UI_DEFAULT` 關著，`ui=r6` 也沒有換這張卡片），所以畫在 R6 的 mock 上，不是畫在 client 上。
- 這張地圖：129×129 格，南北鏡像，雙方都在西邊。西半邊兩條東西向的河，各一座橋、一處淺灘；兩河之間有岩脊和懸崖夾成的口子。河只到地圖中間，東邊是開闊的。

## 項目

| 項目 | 選項 | 檔名（`out/`） |
|---|---|---|
| 01 開局地圖（名字） | 0 現況、A 關口、B 雙河關、C 雙橋 | `R10-01-開局地圖-<選項>-<名字>-<橫向／直向>.png` |
| 02 地圖縮圖 | A 不放、B 放縮圖 | `R10-02-地圖縮圖-<選項>-<橫向／直向>.png` |
| 總覽 | | `R10-99-總覽對照.png` |

說明一行照 ceo 的文案：「隨機地圖裡挑出來的一張，有好幾個關口」。

## 要注意

- **直向**：現在手機直拿時整個畫面是「請轉成橫向」（INV-17，`client/src/style.css` 的 `#rotate`），開局卡片也被蓋住。直向的稿是提案：單欄卡片，要看到它，開局畫面得拿掉那個遮罩。橫向才是現在實際會看到的畫面。
- **縮圖**：只畫河、橋、淺灘、樹林、岩石、懸崖，沒有城鎮、礦和出生點，因為這張圖照樣要探。河和岩石畫得比實際粗一點，不然 92 pt 看不出來。

## 重做

```bash
(cd client && npm ci)                        # Playwright
(cd design/r6 && python3 common/build.py ART)   # 第一次：R6 的戰場底圖（build/ 不進 git）
(cd sim && node src/map-grid.ts --map random --seed 2106939660) > GRID.json
python3 design/r10/common/thumb.py GRID.json THUMB.png
node design/r10/common/shoot.mjs THUMB.png RAW_DIR
python3 design/r10/common/compose.py RAW_DIR  # out/
```

Chromium（`@playwright/test` 1.63.0），zh-TW，淺色，`reducedMotion: reduce`，裝置像素比 3。畫面：橫向 814×380、直向 380×814（R6 的尺寸）。第三顆按鈕、說明和縮圖是畫完 mock 以後用 JS 改 DOM 做的（`shoot.mjs`），只是核准的樣子，不是可以直接搬進程式的 CSS。
