# art-v7 的菱形鏡頭、浮空大陸邊緣、地面新欄位：格式提案

狀態：**定稿**（war-game-ui 2026-11-04 提案，war-game-client 同日同意；第 4 節是 client 的回覆）。依據：使用者 2026-11-04 選「C 遠方浮島」、核准照這個方向量產 art-v7（D-118）；client 2026-11-04 寄來的需求（本文照它的命名）。

## 1. 菱形鏡頭的切換

- `art-release.json` 頂層加 `"view": "diamond"`。client 開局讀到它就換成菱形斜看；沒有這個欄位就照舊用方形斜看。
- 每一份描述檔也都寫同樣的 `"view": "diamond"`：`units/<unit>/<unit>.json`、`buildings/buildings_<c>.json`、`castle/castle_<c>.json`、`nodes/nodes.json`、`terrain/terrain.json`、`ground/ground.json`、`edge/edge.json`。
  - 發布程式（`design/release/pack.py`）會檢查，同一個包裡混到方形斜看的圖就拒絕發布。
  - client 只讀頂層的 `view`。
- 兵的圖不用為了鏡頭重算：太陽固定在畫面左上，相機轉 45 度看兵，和兵轉一格方向是同一張圖。sim 朝向對圖片方向的公式照 `client/docs/sprite-atlas.md` 第 3 節的菱形那一列：sim 的 +x 是右下，也就是方向 7，`方向 = (7 − k / 2) mod 8`。
- 建築、城牆、資源點、地形都用菱形鏡頭重算（仰角 30 度、方位角 −45 度），錨點的定義不變。

## 2. 浮空大陸的邊緣：`edge/`

x3、x2 各一套，加一份 `edge/edge.json`。PNG 照其他圖的規則：帶透明的不預先乘 alpha。

### 畫面上的配置（由下往上）

1. 雲海 `clouds.far`、`clouds.near`。
2. 遠方浮島 `islands`。
3. 崖面 `cliff`。
4. 瀑布 `fall`：瀑布本身 `loop`、底下的水霧 `spray`、河到崖邊的出口 `mouth`。
5. 地面（client 的 shader）。
6. 地上的東西。
7. 飄雲 `puffs`。

崖面不帶迷霧，client 照那段邊緣的迷霧壓暗。

### 哪幾條邊有崖面

菱形下地圖的四個角是：左＝西北、下＝西南、右＝東南、上＝東北。

- 左下斜邊（地圖西邊）和右下斜邊（南邊）看得到崖面：`cliff.sw`、`cliff.se`。
- 轉角 3 個：
  - `corner.left`（西北）：左下斜邊在這裡結束，接上面看不到崖面的邊。
  - `corner.bottom`（西南）：兩條斜邊在這裡相接，是凸出去的角，兩面都看得到。
  - `corner.right`（東南）：右下斜邊在這裡結束。
- 上面兩條邊（左上、右上）看不到崖面，只要讓地面淡進雲海，這個 client 自己做。我這邊在 `edge.json` 給一個建議的淡出寬度 `rim.fade_m`。

### `edge.json`

```jsonc
{
  "format": "war-game edge 1", "view": "diamond", "scale": 3.0,
  "pxPerM": 60,                                   // 和兵、建築同一個比例（x2 是 40）
  "clouds": {
    "far":  {"file": "clouds_far.png",  "alpha": false, "tile_px": 1024, "parallax": 0.2,  "drift_px_s": [6, 2],  "fade_s": 12},
    "near": {"file": "clouds_near.png", "alpha": true,  "tile_px": 1024, "parallax": 0.35, "drift_px_s": [10, 3], "fade_s": 9}
  },
  "islands": [{"file": "island_0.png", "anchor": [x, y], "size_m": 10, "bob_px": 3, "bob_s": 5}],
  "cliff": {
    "height_m": 13, "stretch_m": 16, "overlap_m": 1,
    "sw": [{"file": "cliff_sw_0.png", "anchor": [x, y], "lip": [[x0, y0], [x1, y1]]}, ...3 段],
    "se": [...3 段],
    "corner": {"left": {"file": "corner_left.png", "anchor": [x, y]}, "bottom": {...}, "right": {...}}
  },
  "fall": {
    "loop":  {"file": "fall_loop.png", "width_m": 6, "body_px": [x0, x1], "period_px": 512, "scroll_m_s": 4.0, "widen_per_m": 0.07},
    "spray": {"file": "fall_spray.png", "anchor": [x, y]},
    "mouth": {"file": "fall_mouth.png", "anchor": [x, y], "foam_m": 3.5, "se": {"file": "fall_mouth_se.png", "anchor": [x, y]}}
  },
  "puffs": [{"file": "puff_0.png", "drift_px_s": [8, -2], "alpha_max": 0.6}],
  "rim": {"fade_m": 3}
}
```

- **雲海**
  - `clouds_far.png`：不透明。`clouds_near.png`：帶透明，疊在遠層上。
  - 兩張都是方形、四邊無縫，在螢幕上拼貼，不是貼在地圖上。`tile_px` 是 3 倍畫質的像素，x2 那套是 2/3。
  - 雲已經畫成一團一團、上亮下藍灰，亮暗都在圖裡，client 不用另外打光。
  - 每層各自捲動，一層自己和自己錯開半個週期交叉淡入淡出（`fade_s`）。視差：鏡頭移 1，遠層移 0.2、近層移 0.35。
  - 試驗用的算法在 `design/r11/common/edge_scene_r11.py` 的 `clouds()`。
- **崖面**
  - 每段沿地圖邊 16 公尺，兩頭各多畫 1 公尺讓相鄰的段疊住（試驗時疊 0.25 公尺會露出細縫）。client 照 16 公尺的間距擺，不用裁。
  - 從哪裡開始擺（量產時補，`cliff.from`、`corner_leg_m`、`edge_m`）：從下角（西南）沿兩條邊量，第 k 段的中點在 16k 公尺（k＝1 到 (邊長−18)/16，129 格的地圖是 1–15）。下角往兩邊各畫 8 公尺，左角、右角各畫最後 10 公尺。左、右角的岩紋是照 258 公尺（129 格）的邊對齊的，別的長度在那個角會有一條接縫。
  - 每段（和轉角）疊在鄰居上的那 1 公尺，只畫崖面不透明的上半段；往下淡進雲裡的部分不疊，免得兩層半透明疊出一條較濃的縫。
  - `anchor`：這段中點的崖頂、地圖邊線上的那一點在圖上的像素位置，地面高度 0。`lip`：這段崖頂那條線兩端在圖上的像素位置，給 client 對地面的邊。
  - 3 段可以任意順序接，接縫的岩紋和崖頂高度都對得上。
  - 崖頂的岬角（往外凸出地圖邊 0–4 公尺，只往外、不改模擬的地圖）已經畫在圖裡，連崖頂的草和土層一起，client 照圖畫，地面在地圖邊切直就好。
  - 崖頂的草和土往地圖**裡面**多畫 1 公尺，被地面蓋住。client 讓地面在左下、右下兩條邊的最後約 0.75 公尺慢慢變透明，透出底下崖頂的草，所以接縫不會是一條直線。
  - 崖頂的草用寫實地面草地的平均色，或略暗一點。地面邊上的格子是沙、石時，也是那 0.75 公尺淡出後交給崖頂；是水的地方由 `fall.mouth` 蓋住。
- **瀑布**
  - `fall_loop.png`：上下無縫的一條。client 往下捲 `scroll_m_s`；越往下越寬（`widen_per_m`），兩側碎成水絲的形狀已經畫在圖裡。
    - `body_px`（量產時補）：圖裡哪幾欄是河本身（`width_m` 寬的河在畫面上的寬度，cos 45 度），左右多出來的是碎掉的水絲。client 把 `body_px` 對到崖口那段河在畫面上的左右兩端，每一欄從那一欄的崖口往下掛。
  - `fall_spray.png`：瀑布底的水霧，帶透明。client 可以讓它跟著雲海的近層慢慢飄。
  - `fall_mouth.png`：河到崖邊的出口，畫在崖頂，包括濕的崖口和最後幾公尺河面的白沫。白沫也想動的話，用 `fall_loop.png` 往河的流向捲。
    - 量產時補：`fall_mouth.png` 是從左下（西）邊流出去的河；從右下（南）邊流出去的用 `mouth.se` 那一張（方向不同，不能只左右翻，光從左上來）。`anchor` 是河的中線在地圖邊線上的那一點。
  - 河寬照地圖：雙河關的河是 3 格（6 公尺）。其他寬度的河用同一套圖、橫向縮放。
- **遠方浮島**：每座一張帶透明的圖。`anchor` 是島底（浮在雲上的那一點）；`size_m` 是它在雲海裡看起來的大小，給 client 縮放；霧已經畫在圖裡；`bob_px`、`bob_s` 是建議的上下浮動。放在遠層雲海裡，左下、右下兩側各兩座，位置由 client 決定，跟著遠層的視差走。
- **飄雲**：3 到 4 朵帶透明，最上層，建議的飄動速度和最大不透明度寫在 `drift_px_s`、`alpha_max`。

### 成本（R11 試驗量的，3 倍）

| 做法 | 大小 |
|---|---|
| shader 捲動（採用） | 試驗的單色貼圖約 0.7 MB。art-v7 改成上了色的雲海，遠近各一張 1024² RGBA：未壓縮 8 MB／ASTC 2 MB |
| 逐格圖（不做） | 約 112 MB 未壓縮／28 MB ASTC |

每一格畫面多畫一層雲海，約佔畫面一半，每點取 4 次貼圖，手機上估計不到 1 毫秒。

## 3. `ground/ground.json` 的新欄位（PR 3，數值到時候給）

- `relief`：可以接縫的起伏圖。
  - x3 用 `relief.png` 960²，x2 用 640²，`tile_m` 16。
  - RGB 的意思：R＝亮度 ÷ 2、G＝小沖溝、B＝丘頂。
  - 照菱形鏡頭的太陽（畫面左上）算好光。
  - 取兩次，第二次轉 37 度再混合，避免看出重複。
  - 算法在 `design/r9/common/ground_r9.py` 的 `relief_tile()`、`compose()`。
- `ripple`：水面的漣漪圖。`ripple.png` 256²，`tile_m` 4；R＝高度，G、B＝兩個方向的斜率。
- `water`：R9 的水邊參數，包括深淺吸收、河底顏色、天空、近岸濕線、對岸土坎、亮點等，名稱照 `ground_r9.R9`，另加 `"version": "r9"`。以後再改水面時只換 version，不換鍵名。

## 4. client 的回覆（2026-11-04）

1. 檔名和鍵名：照第 2 節，全部可以；client 只讀 art-release.json 頂層的 `view`。
2. 雲海在螢幕上拼貼：對。照 `parallax` 捲動；鏡頭縮放時雲海也跟著縮一點，遠層 0.2 倍、近層 0.35 倍。
3. 崖頂岬角畫在崖面圖裡、地面在地圖邊切直。另外要求兩件事，已經寫進第 2 節：崖頂多畫 1 公尺進地圖；崖頂的草用地面草地的平均色。
4. `ground.json` 新欄位的名稱可以；`water_r9` 改成 `water` 加 `"version": "r9"`，已經改了。
5. client 自己做：
   - 浮島放在哪裡。
   - 上面兩條邊：用 `clouds_near.png` 沿邊蓋一條 `rim.fade_m` 寬的雲。
   - 瀑布的位置：開局照地形找水碰到左下、右下邊的段落，探索到新地形時再重找。
   - 素材到之前，client 用 `make-test-atlas.ts` 做同樣格式的色塊代替圖。
