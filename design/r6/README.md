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

**使用者的選擇**（2026-10-18，D-087，ceo 轉達）：
- 風格：在「其他」寫「a跟b都不錯，設定可調」；預設選 A 銅木。所以 A、B 都做，設定裡可以切換，預設 A；C 不做。
- 左邊：C「需要時才出現」。連帶改變寫在選項上，使用者看過才選：拿掉 D-024 的重設鈕（✕ 和提示列的「取消」接手）；全體回城平時收在選單，家被打時才跳出來（要新畫）。
- 小地圖：B「菱形」。

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

## B.3 整套設計稿（等使用者核准）

依據 D-087：A 銅木（預設）畫完盤點的 146 項；B 墨漆金線畫每一種元件的每一種狀態，加三個 A、B 並排的代表畫面。
玩家色照 R6-24 使用者選的「甲 藍紅黃紫」（藍 #3f7fe0、紅 #d9433a、黃 #e8c42e、紫 #9a5ce0，中立 #d8d2c0）。
R6-04：使用者 2026-10-18 先選了照舊用菱形；2026-10-19 改選甲「方形斜看」（D-088：「我覺得地圖還是正方形好」）。有戰場的設計稿都用方形斜看重拍，建築和資源點是 art-v3 的圖；面板和按鈕不動（`build/layout.json` 只有 ✓ ✗ 跟著變小的預覽框移動）。R6-01–04、R6-24 是當時讓使用者選的紀錄，照舊不重拍。

| 檔名（`out/`） | 內容 |
|---|---|
| `R6-99-整套總覽-A-銅木.png`、`R6-99-整套總覽-B-墨漆金線.png` | 每種風格一張總覽 |
| `R6-05-方形斜看建築-主城東陸／民居東陸／兵營西陸／總覽` | 核准稿（菱形）和方形斜看並排，標玩家色比例（使用者 2026-10-19 核准：「可以，全部照這樣算」） |
| `R6-06-野城-<甲|乙>-<中立|我方|敵方|廢墟>-mobile`、`R6-06-野城-總覽` | 中立城市的兩個選項（甲 牌坊、不改規則；乙 B1-03 原樣），等使用者選 |
| `R6-31-下指令的回饋-A／B`、`R6-25-11-取消放建築` | 暫停時下的指令先畫出結果、確認的訊息條、自動訓練暫停的記號（使用者 2026-10-19 核准） |
| `R6-10` 開局、`R6-11` 戰場上方、`R6-12` 編隊、`R6-13` 左邊、`R6-14` 單位資訊、`R6-15` 建築資訊、`R6-16` 資源與城鎮資訊、`R6-17` 軍團畫面、`R6-18` 指令區、`R6-19` 浮動元件、`R6-20` 對話框、`R6-21` 勝負、`R6-22` 提示與警報、`R6-23` 戰場世界介面、`R6-23b` 城鎮標記、`R6-30` 重設由誰接手（`-A-銅木-mobile`） | 盤點的每一項；每格上面寫盤點編號 |
| `R6-13`、`R6-22`、`R6-30`、`R6-40`（`-B-墨漆金線-mobile`） | B：第一批三張、元件表 |
| `R6-40-元件表-A-銅木-mobile.png` | A 的元件表 |
| `R6-41`–`R6-43`（`-AB-兩種並排-mobile`） | 戰場、對話框、開局的 A、B 並排 |
| `R6-24-玩家色-甲／乙／丙`、`總覽` | 玩家色的選項（使用者選甲） |
| `R6-25-01`–`11`（`-mobile.png` 分鏡、`-動作.gif`） | 按下、對話框出現、編隊快撐不住、被攻擊箭頭、地圖鈕警報、全體回城跳出、地圖打開、訊息條、長按圓圈、指令回饋圈、取消放建築 |
| `R6-04-地圖方向-甲／乙／總覽` | 方形地圖的兩個方案（使用者 2026-10-19 選甲，D-088） |
| `../spec.md` | 給 client 的規格：位置從 mock 量，規則從設計稿，動畫時間從分鏡 |

```bash
python3 common/build.py ART --view oblique       # build/：戰場、世界介面、小地圖（ART：art-v3-x3 解開；兵種同 art-v2）
python3 common/colours.py ART                     # R6-24
node common/shoot-boards.mjs R6-10:a R6-11:a …    # 每張設計稿（board.html＋boards.js＋states.js），同時檢查 44 pt
python3 common/anim.py                            # R6-25 分鏡和 GIF
node common/coverage.mjs                          # 盤點 146 項都在某張設計稿上
node common/layout.mjs && python3 common/spec.py  # spec.md
python3 common/overview.py                        # R6-99
```
