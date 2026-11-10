# R20 農民的工具和拿法（R19 的第 1–5、12 項）

使用者 2026-11-11 看了 R19 的總表，15 項全部要改（D-142）。這是四批裡的第 1 批：最怪的先。

- 斧頭、十字鎬、木槌改成真實大小、暗色舊鐵或整支木頭，照鋤頭（R16，使用者選 A 真實大小）的標準。兩國農民共用。
- 東陸農民平常拿斧頭：握在斧頭下面（重心）、垂在身側、刃朝下。
- 東陸農民攻擊：兩手握柄，舉到右肩後面往前劈。格數（10）和打中那一格（第 8 格）不變。
- 挖礦舉鎬改成舉過右肩（左前臂原本橫在臉前）。這是兩國共用的動作。

程式在 `design/production/blender/anims.py`：`R20`、`AXE`、`PICK`、`MALLET`、`_tools_r20()`、`carry_axe()`、`AXE_ATTACK`。
**`R20=1` 才會打開**；使用者核准稿以前，CI 正式算圖不帶這些改動。核准後把預設改成開。

出處寫在 `anims.py` 的註解和 `R20-00-參考資料`：中古出土的鐵斧（15.5–19 公分長）、羅馬的 dolabra 和現在的鎬頭（33–55 公分）、細木工的木槌（槌頭 12–16.5 公分長）、美國林務署的拿法。唐代鐵斧和唐宋礦工工具的尺寸沒查到。

## 稿（`build/out/`，不在 repo）

```bash
# 本機 Blender 算草稿（MPFB、CC0 貼圖，同 r7 的 CI）；改前（不設 R20）和改後用同一條流程
R20=1 R20_SS=2 R20_SAMPLES=48 python3 design/r20/common/render_r20.py farmer_e design/r20/build/draft/e_new eN idle:0-7:7 walk:0-7:0,7 ...
R20_SS=2 R20_SAMPLES=48 python3 design/r20/common/render_r20.py farmer_e design/r20/build/draft/e_old eO idle:0-7:7 ...
python3 design/r20/common/boards_r20.py design/r20/build/draft design/r19/build/art/x3 design/r20/build/out
python3 design/r20/common/gif_r20.py design/r20/build/draft design/r19/build/art/x3 design/r20/build/out
python3 design/r20/common/sheet_r20.py OUT.png 3 design/r20/build/draft/e_new/eN_attack_f7_05 ...     # 看幾格草稿
```

- 草稿資料夾：`e_old`／`e_new`／`w_old`／`w_new`，檔名前綴 `eO`／`eN`／`wO`／`wN`。`R20_RESUME=1` 跳過已經算好的格。
- `R20-總覽-農民-phone.png`：整批一張，每項一列，左改前、右改後。使用者看這張就能說可以或不行。
- `R20-00-參考資料-phone.png`：出處（只有文字）。
- `R20-01-工具`、`R20-02-東陸平常拿斧頭`、`R20-03-東陸攻擊`、`R20-04-砍樹挖礦蓋房`（都是 `-改前改後-phone.png`）：細的，當依據。
- `R20-農民東陸／西陸-改前改後-phone.gif`：改到的動作照遊戲的速度播，左改前、右改後。
