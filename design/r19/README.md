# R19 兵種動作總檢查

使用者 2026-11-10 選的改進項目之一，起因是種田的鋤頭（R16）要他自己發現才改。ceo 的 brief：把 12 個兵種的每個動作照手機上的大小排開、再放大一份，ui 自己先挑出怪的地方；只挑問題和出看板，先不改模型。使用者挑了要改哪些，再排進下一版美術包。

看的是已發布的美術包（art-v7.8 的 x3，main 釘的版本），不是本機算的圖。圖照 client 的疊法畫：顏色、玩家色、法師的護盾和特效（`client/src/render/unit-art-draw.ts`）。

```bash
tar xzf art-v7.8-x3.tar.gz -C design/r19/build/art/x3                      # 發布的包，不進 repo
python3 design/r19/common/inspect_r19.py design/r19/build/art/x3 design/r19/build/inspect farmer_e   # 檢查用：每個動作 5 個方向每一格
python3 design/r19/common/zoom_r19.py design/r19/build/art/x3 OUT.png 4 farmer_e:walk:0:2:grid       # 放大幾格；grid 畫座標格，圈的位置從這裡讀
python3 design/r19/common/feet_r19.py design/r19/build/art/x3 farmer_e                                # 走路時腳貼地的位置
python3 design/r19/common/boards_r19.py design/r19/build/art/x3 design/r19/build/out farmer_e farmer_w
python3 design/r19/common/gif_r19.py design/r19/build/art/x3 design/r19/build/out farmer_e farmer_w
python3 design/r19/common/table_r19.py design/r19/build/art/x3 design/r19/build/out                    # R19-13 總表
R19_N=1.5 R19_FACES=7,0,6 R19_STACK=1 python3 design/r19/common/inspect_r19.py ART OUT mage_e idle walk attack   # 幾個動作疊成一張，先看一遍
```

- `common/findings_r19.py`：挑到的問題（編號、嚴重程度、哪些動作、圈在哪一格的哪裡、問題、建議、估的工）。
- 每個兵種兩張圖（一張會有 5000×10000 px，縮到視窗裡字看不到，所以拆開）：
  - `R19-NN-<兵種>-phone.png`：問題小卡，最怪的排最前面。只有編號、一句問題、一張圈起來的小圖。
  - `R19-NN-<兵種>-依據-phone.png`：每個動作每一格。
    - 手機上的大小（上藍下紅，旁邊一名槍兵），和同一批格放大。
    - 打中那一格的另外四個方向；和待機怎麼接；被圈到的其他格。
    - 走路多一排：照遊戲的速度往前移，地上有釘住的短線，看腳滑不滑。
- `R19-NN-<兵種>-動作-phone.gif`（`common/gif_r19.py`）：所有動作照遊戲的速度播（走路的格率照兵種的速度，攻擊之間照冷卻時間停在第 1 格；`art_r19.SPEED`、`COOLDOWN_S` 抄自 `sim/src/core/rules.ts`），左邊手機大小、右邊放大；走路時照遊戲的速度往右走。
- `R19-13-總表-phone.png`（`common/table_r19.py`）：所有問題一張表，最怪的在前；同一件事出現在好幾個兵種的（`key` 相同）併成一列；表下寫哪些可以併在一起重算。
- 小卡那張的下面有「看過、沒問題的」（`checked`）：武器的大小和真的對照、拿法、玩家色。武器長度是在朝右那個方向的圖上量的：橫向 60 px 一公尺、直向 52 px 一公尺（鏡頭仰角 30 度）。
- 法師（`shield`）：手機大小那一排罩著護盾（手機上平常就是這樣），放大的圖不畫護盾。
- 量過、看過但不算問題的事寫在 `findings_r19.py` 的 `notes`，印在那個動作的標題下面。
- 判斷穿模、擋臉這類事要換方向再看一次：只從側面看到兩樣東西疊在一起，不等於穿模（農民西陸走路的鋤頭、蓋房的木槌第一次都判錯）。
- 嚴重程度：高、中、低，照手機上看起來有多怪。估的工：小（改數值或材質）、中（改一個動作）、大（改模型或好幾個動作）。
