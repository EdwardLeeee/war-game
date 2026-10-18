# R6 輪：正式介面

- brief：`docs/briefs/2026-10-ui-r6.md` B（D-085）。
- 盤點：`inventory.md`（ceo 2026-10-18 核准，#208）。

## B.2 選風格（使用者選）

ceo 2026-10-18：「風格」和「左邊四樣怎麼收」分兩題問；風格圖排版都一樣，只換風格，旁邊附「按下」和「不能按」。

| 檔名（`out/`） | 內容 |
|---|---|
| `R6-01-介面風格-A-銅木-mobile.png`、`…-B-墨漆金線-…`、`…-C-沙盤軍帖-…` | 代表畫面（菱形戰場、選到一隊兵，資源列、編隊、指令區都在），手機像素與實際大小；按鈕四種狀態 |
| `R6-01-介面風格-總覽.png` | 三種並排 |
| `R6-02-左邊收法-A-照現在-mobile.png`、`…-B-收成一顆-…`、`…-C-需要時才出現-…`、`…-D-搬到別處-…` | 重設、全體回城、閒置、小地圖的四種收法，都用 B 畫，只比位置 |
| `R6-02-左邊收法-總覽.png` | 四種並排 |
| `R6-03-小地圖形狀-A-方形-mobile.png`、`…-B-菱形-…`、`R6-03-小地圖形狀-總覽.png` | 方形（現在）與菱形（和戰場一樣斜 45 度、2:1） |

- 戰場：art-v2 的兵種與建築圖，照 client 的畫法組（`common/field.py`、`common/scene_r6.py`）。地形還是 B2 的工作，先用素色草地。
- 介面：HTML／CSS（`mock/screen.html`、`mock/themes.css`、`mock/screen.js`），位置照原型（盤點的數字），用 Playwright 以 3 倍拍下。
- 字：iPhone 內建的字（PingFang TC；這台電腦用 Noto Sans CJK TC 代替），只用兩種粗細：400、700。

```bash
# art-v2-x3.tar.gz 解開到 ART
python3 common/build.py ART                 # build/：每種風格的戰場、小地圖、選取的位置
(cd ../../client && npm ci)                 # Playwright
node common/shoot.mjs a "theme=a" b "theme=b" c "theme=c" sa "theme=a&states=1" sb "theme=b&states=1" sc "theme=c&states=1" \
  L-fan "theme=b&left=fan" L-fanopen "theme=b&left=fan-open" L-ond "theme=b&left=ondemand" L-ondopen "theme=b&left=ondemand-open" \
  L-moved "theme=b&left=moved" M-sq "theme=b&minimap=square" M-di "theme=b&minimap=diamond"
python3 common/boards.py                    # out/
```
