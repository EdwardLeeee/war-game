# R9 寫實試驗：學 napali（只出圖，沒有上線）

ceo 2026-11-01 派工。使用者看了 https://github.com/Leonxlnx/napali（MIT）問：「你的畫風不能跟它一樣真實嗎」，選「地面加兵和建築一起試」；又問「為啥我們的地圖是長方形的？建築也是」，選兩種鏡頭都出圖比（R9-06）。

## 學了 napali 什麼

讀了它的 `tools/v3_geo.glsl`、`v3_shade.glsl`、`v4_water.glsl`，沒有複製它的程式碼（所以 THIRD_PARTY_NOTICES.md 不用加）。學的是做法：
- 地形用雜訊加水力侵蝕，同一個太陽打光，沿著太陽方向在高度圖上走一段算軟陰影，加天光和遮蔽；
- 水照深度吸收顏色（看得到淺處的底），菲涅耳反射天空，水面漣漪，水邊濕地和白沫；
- 整張用 ACES 底片曲線調色；
- 一輪一輪由評審拿真實照片打分，改最差的三點（分數表：`scores.md`）。

## 做法（都能在手機上的 shader 做）

| 檔案 | 做什麼 |
|---|---|
| `common/ground_r9.py` | 可接縫的 16 公尺起伏圖（週期性 FFT 雜訊 → 粒子侵蝕，邊界繞回 → 照遊戲的太陽算軟陰影、天光、遮蔽；RGB＝亮度、沖溝、丘頂），地面（art-v6 的圖層和權重照舊，再乘起伏、草叢、風吹的草色、沖溝濕土）、水（深淺吸收、FFT 漣漪圖沿水流拉長、菲涅耳天空、對岸倒影、土坎、草唇、濕土、礫石灘、淺灘碎浪）、ACES |
| `common/scene_r9.py` | 「雙河關」（種子 2106939660）的場景：現在和 R9，橋、石頭、樹、兵、主城照遊戲的擺法；R9-06 方形和菱形兩種鏡頭、地圖邊緣 |
| `blender/main_city_r9.py` | 東陸主城：正堂、夯土墩台上的鼓樓、偏殿、松樹，輪廓不是方塊；`arch_r8.tang_roof(fine=True)` 細筒瓦、瓦當、疊瓦正脊 |
| `blender/unit_r9.py` | 槍兵（`R9_UNIT=1`）：玩家色布料先調暗（以前乘 1.6 過曝成一片青色）、布紋和光澤、皮膚透光、甲片凹凸和粗糙度、草地往上反的光 |
| `common/boards_r9.py` | 看板：`R9-01`…`R9-06`、`R9-99-總覽`、槍兵 GIF |
| `common/one_piece.py` | 本機一次算幾件（記憶體上限內） |

參考照片只給評審打分，不放進遊戲、不進 repo：`research/r9-reference/`（美國農業部的河岸空拍，公有領域）、`research/nature-reference/14`、`05`；兵 `research/east-reference/`；建築 `research/east-arch-reference/`。

## 記憶體（地面）

| | 2 倍 未壓縮 | 2 倍 ASTC 4×4 | 3 倍 未壓縮 | 3 倍 ASTC |
|---|---|---|---|---|
| art-v6.3 的地面（7 張圖層） | 1.3 MB | 0.33 MB | 2.8 MB | 0.7 MB |
| R9 多的起伏圖（16 m，640²／960²） | +1.6 MB | +0.41 MB | +3.7 MB | +0.92 MB |
| R9 的漣漪圖（4 m，256²，可以取代 water.png） | +0.26 MB | +0.07 MB | 同 | 同 |
| R9 合計 | 約 3.2 MB | 約 0.8 MB | 約 6.8 MB | 約 1.7 MB |

PNG 檔：起伏圖 3 倍 1.4 MB、2 倍 0.63 MB。地面全部加起來還是遠小於兵（2 倍 ASTC 39.7 MB）和建築（14.1 MB）。

## 重做

```bash
python3 design/r9/common/ground_r9.py tile design/r9/build          # 起伏圖（3 倍、2 倍、菱形鏡頭用的 3 倍）
(cd sim && node src/map-grid.ts --map random --seed 2106939660) > GRID.json
python3 design/r9/common/scene_r9.py ART_X3 GRID.json OUT            # 河段場景（現在、R9）
python3 design/r9/common/scene_r9.py ART_X3 GRID.json OUT edge UNITS # 地圖邊緣
(cd design/b1 && python3 ../r9/common/one_piece.py r9_city main_city_E_r9 && python3 ../r9/common/one_piece.py r9_city_d main_city_E_r9_d)
(cd design/production && R9_UNIT=1 R7_VERSION=8 R7_TEX=… python3 blender/render_prod.py --target spear_e --facings 7,1 --anims idle,walk,attack \
  && R9_UNIT=1 R7_VERSION=8 python3 common/postprocess.py --target spear_e --scale 3 --facings 7,1)
python3 design/r9/common/scene_r9.py ART_X3 GRID.json OUT 06 design/b1/build/b1/r9 design/production/build/r9u/prod/spear_e/atlas_x3
ART_X3=… python3 design/r9/common/boards_r9.py OUT ART_X3/units/spear_e design/production/build/r9u/prod/spear_e/atlas_x3 design/b1/build/b1/r9 design/r9/out
```
