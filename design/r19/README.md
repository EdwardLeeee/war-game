# R19 兵種動作總檢查

使用者 2026-11-10 選的改進項目之一，起因是種田的鋤頭（R16）要他自己發現才改。ceo 的 brief：把 12 個兵種的每個動作照手機上的大小排開、再放大一份，ui 自己先挑出怪的地方；只挑問題和出看板，先不改模型。使用者挑了要改哪些，再排進下一版美術包。

看的是已發布的美術包（art-v7.8 的 x3，手機上現在的樣子），不是本機算的圖。

```bash
tar xzf art-v7.8-x3.tar.gz -C design/r19/build/art/x3                      # 發布的包，不進 repo
python3 design/r19/common/inspect_r19.py design/r19/build/art/x3 design/r19/build/inspect farmer_e   # 檢查用：每個動作 5 個方向每一格
python3 design/r19/common/zoom_r19.py design/r19/build/art/x3 OUT.png 4 farmer_e:walk:0:2:grid       # 放大幾格；grid 畫座標格，圈的位置從這裡讀
python3 design/r19/common/feet_r19.py design/r19/build/art/x3 farmer_e                                # 走路時腳貼地的位置
python3 design/r19/common/boards_r19.py design/r19/build/art/x3 design/r19/build/out farmer_e farmer_w
python3 design/r19/common/gif_r19.py design/r19/build/art/x3 design/r19/build/out farmer_e farmer_w
```

- `common/findings_r19.py`：挑到的問題（編號、嚴重程度、哪些動作、圈在哪一格的哪裡、問題、建議、估的工）。
- 每個兵種兩張圖（一張會有 5000×10000 px，縮到視窗裡字看不到，所以拆開）：
  - `R19-NN-<兵種>-phone.png`：問題小卡，最怪的排最前面。只有編號、一句問題、一張圈起來的小圖。
  - `R19-NN-<兵種>-依據-phone.png`：每個動作每一格。
    - 手機上的大小（上藍下紅，旁邊一名槍兵），和同一批格放大。
    - 打中那一格的另外四個方向；和待機怎麼接；被圈到的其他格。
    - 走路多一排：照遊戲的速度往前移，地上有釘住的短線，看腳滑不滑。
- `R19-NN-<兵種>-動作-phone.gif`（`common/gif_r19.py`）：所有動作照遊戲的速度播，左邊手機大小、右邊放大 3 倍；走路時照遊戲的速度往右走。
- 量過、看過但不算問題的事寫在 `findings_r19.py` 的 `notes`，印在那個動作的標題下面。
- 判斷穿模、擋臉這類事要換方向再看一次：只從側面看到兩樣東西疊在一起，不等於穿模（農民西陸走路的鋤頭、蓋房的木槌第一次都判錯）。
- 嚴重程度：高、中、低，照手機上看起來有多怪。估的工：小（改數值或材質）、中（改一個動作）、大（改模型或好幾個動作）。
