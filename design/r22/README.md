# R22 倒下（R19 的第 8、9 項）

使用者 2026-11-11 看了 R19 的總表，15 項全部要改（D-142）。這是四批裡的第 3 批，兩項都沒有選項，出改前改後。

- **第 8 項**：倒下一開始兩三格兩臂向兩側平舉成 T 字。這個倒下是 P2-03 核准過的（D-029），步兵和法師共用同一組關鍵格（`anims.FALL_KEYS`）。只改第一個關鍵格（後仰那一下）的手臂：右臂彎起來抬到胸前，左臂垂在身側。時間和落地那一格不變。
- **第 9 項**：倒地後腰上的刀還照站著的角度固定在腰上（槍兵仰躺：插進地裡；騎兵趴著：朝天豎著）。倒下的 35%–70% 之間把刀鞘轉到貼著大腿（`anims._lay_swords`，`SWORD_LIES`）。有腰刀的是槍兵東陸、槍兵西陸、騎兵東陸、騎兵西陸。

**使用者 2026-11-11 核准**（「可以，照改後的做」）。程式在 `design/production/blender/anims.py`，現在還是 **`R22=1` 才打開**：照計畫等第 4 批（R23）的選項定了，一起把預設改成開、一起算圖、一起發 art-v7.11（兩批動到的兵種重疊，每個兵種只算一次）。東陸攻城砲的拽手也用這組倒下的動作，所以那台也要重算。

## 稿（`build/out/`，不在 repo）

```bash
bash design/r22/build/run_drafts.sh      # 本機草稿（改後，R22=1；不在 repo）：下面這種指令，六個兵種
R22=1 R21_SS=2 R21_SAMPLES=48 python3 design/r21/common/render_r21.py spear_e design/r22/build/draft/spear_e_new sN death:0-9:7 death:1,2,9:6 death:9:0
R22=1 R21_FRAME=9,7,0.5,0.6 R21_SS=2 R21_SAMPLES=48 python3 design/r21/common/render_r21.py hcav_e design/r22/build/draft/hcav_e_new hN death:0-9:7 death:9:0,1
python3 design/r22/common/boards_r22.py design/r22/build/draft ART_X3 design/r22/build/out      # ART_X3：已發布的 art-v7.9 的 x3
```

- 草稿資料夾 `<兵種>_new`，檔名前綴：`fN` 農民東陸、`sN` 槍兵東陸、`bN` 遠程兵東陸、`mN` 法師東陸、`pN` 槍兵西陸、`hN` 騎兵東陸、`kN` 騎兵西陸。改前用已發布的圖。
- `R22-總覽-倒下-phone.png`：兩項一張，上改前、下改後。
- `R22-01-倒下的開頭-改前改後-phone.png`、`R22-02-倒地後的腰刀-改前改後-phone.png`：細的。
- `R22-倒下-改前改後-phone.gif`：四個兵種倒下的過程，改前改後並排。
