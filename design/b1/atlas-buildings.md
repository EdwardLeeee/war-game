# 建築與資源點的圖集（提案，給 client 併進 `client/docs/sprite-atlas.md`）

- 依據：R6 brief（`docs/briefs/2026-10-ui-r6.md`）A，D-085。
- 外觀照 B1 核准的設計稿（D-040、D-041，`design/b1/README.md`）：
  - 施工中 A 分三階段、受損 A 著火、被摧毀 A 瓦礫堆；
  - 東陸箭樓用精修版；農田是東陸稻田、西陸麥田，各三個階段。
- 製作方式（ceo 2026-10-18 同意）：
  - 每棟各一張：完成、施工第 2 階段、施工第 3 階段、受損。受損的火先用靜態的，畫在圖裡。
  - 依占地大小和文化共用：施工第 1 階段（地基）、瓦礫。
- 這份是格式提案。client 同意後才上 CI 量產；量產圖集放在 art-v2。
- 沒寫到的地方都和兵種圖集第 2 版一樣：
  - 比例：3 倍 `px_per_m` 60，2 倍 40。
  - 修邊：alpha > 4。
  - 頁寬 2048，頁高補到 4 的倍數，影格間隔 2 px，不用 mipmap。
  - 圖層的格式：玩家色層用 `team_gain` 1.6；影子半解析度、黑色加透明度。

## 1. 範圍

| sim `BuildingType` | 影格的名字 `<kind>` | 占地 | 東陸／西陸 |
|---|---|---|---|
| `MainCity` 0 | `main_city` | 4×4 | 各一套 |
| `House` 1 | `house` | 2×2 | 各一套 |
| `LumberCamp` 2 | `lumber_camp` | 2×2 | 各一套 |
| `Mine` 3 | `mine` | 2×2 | 各一套 |
| `Granary` 4 | `granary` | 2×2 | 各一套 |
| `Farm` 5 | `farm` | 3×3，可以走過去 | 東陸稻田、西陸麥田 |
| `Barracks` 6 | `barracks` | 3×3 | 各一套 |
| `Range` 7 | `range` | 3×3 | 各一套 |
| `MageHall` 8 | `mage_hall` | 3×3 | 東陸術院、西陸晶塔 |
| `TownTower` 9 | `town_tower` | 2×2 | 各一套（中立大城的箭樓，見第 8 節的問題） |
| `ArrowTower` 10 | `arrow_tower` | 2×2 | 東陸精修版、西陸 |
| `Stable` 11 | `stable` | 3×3 | 各一套 |

- 占地照 `sim/src/core/rules.ts` 的 `size`（main e78d939 核對過）。
- 不做：
  - 哨所 `Outpost` 12：還沒有設計稿，client 照舊用現在的圖形。
  - 城牆、城門、分城、鐵匠鋪、砲坊：原型沒有。
  - 城鎮的房子、廣場：要等城鎮配置寫進模擬。城鎮照 D-084 的城牆符號。
- 資源點（`NodeKind`）：樹、金礦、野果、晶脈（第 7 節）。

## 2. 檔案

art-vN 的壓縮檔裡，和 `units/`、`effects/` 並列：

```
buildings/
  buildings_E.json
  buildings_E_color_<k>.png
  buildings_E_team_<k>.png
  buildings_E_shadow_<k>.png
  buildings_W.json  … 西陸同上
  memory.json
nodes/
  nodes.json
  nodes_color_<k>.png
  nodes_shadow_<k>.png
  memory.json
```

- 一個文化一組頁，不是一棟一組：
  - 一棟只有幾張圖。一棟一組的話，每頁都很空，記憶體以整頁算。
  - 東陸對西陸載兩組；同文化對打只載一組。
- 資源點沒有玩家色層，所以只有顏色層和影子。
- 每組頁有自己的 `memory.json`，欄位和兵種的一樣。

## 3. 影格命名與狀態

影格名稱是 `<kind>_<c>_<state>`，`<c>` 是 `E` 或 `W`。建築不轉向、不鏡像，所以沒有方向。

| 狀態 `<state>` | 內容（B1-02 核准的樣子） | 誰有 |
|---|---|---|
| `done` | 完成 | 每棟（農田見下面） |
| `build1` | 施工第 1 階段：整塊占地打上木樁、拉繩，旁邊堆建材 | **共用**：`found_<n>x<n>_<c>`，依占地 2×2、3×3、4×4 和文化各一張 |
| `build2` | 施工第 2 階段：木架加鷹架 | 每棟 |
| `build3` | 施工第 3 階段：牆蓋好，屋頂只有椽子 | 每棟 |
| `damaged` | 受損：屋頂破洞、火、黑煙、牆被燻黑。火和煙是靜態的，畫在圖裡 | 每棟 |
| `rubble` | 被摧毀：低矮的瓦礫、燒黑的樑、餘煙（0.6 公尺以下） | **共用**：`rubble_<n>x<n>_<c>`，依占地和文化各一張 |

- 共用的地基和瓦礫，用 B1-02 核准的那三棟算：民居（2×2）、兵營（3×3）、主城（4×4）。發布前我會給 ceo 核准稿和量產圖的並排對照，大建築、小建築各至少一棟。
- **農田**：
  - 沒有 `done`，改成三個作物階段：`farm_<c>_sown`（剛播種）、`farm_<c>_growing`（長高）、`farm_<c>_ripe`（成熟）。
  - 施工第 1 階段是農田自己的 `farm_<c>_build1`：空田加木樁。共用的地基有兵營的台基，放在田上不對。
  - 施工第 2、3 階段用 `farm_<c>_sown`。
  - 沒有受損和瓦礫：田不會著火、也不會留瓦礫，被摧毀就直接消失。
  - 作物階段只是畫面，模擬裡沒有（農田不會採完）。建議 client：一名農民在田裡工作時，每 20 秒（sim 時間）換下一個階段，成熟之後回到剛播種；沒人工作就停在當時的階段。
- **大城的箭樓**（`TownTower`）：
  - 只有 `done`、`damaged`、`rubble`。玩家不能蓋，所以沒有施工階段。
  - `rubble` 用 B1-03 核准的「大城箭樓已拆」那張，不用共用瓦礫。
  - 玩家色層照持有者上色，中立時用 `NEUTRAL_TINT`。

一個文化總共 53 張：10 棟 × 4 張、農田 4 張、大城箭樓 3 張、共用地基 3 張、共用瓦礫 3 張。

## 4. 圖層

| 圖層 | 和兵種不同的地方 |
|---|---|
| 顏色 `color` | 受損的火和煙也在這一層。沒有特效層 |
| 玩家色 `team` | 一樣修到玩家色的範圍，另有一張 `team` 表。沒有玩家色的影格（例如瓦礫）不列在 `team` 裡 |
| 影子 `shadow` | 一樣，畫在地面層。只有一個方向，所以每張影格一個影子 |

煙在顏色層裡，所以影子層沒有煙的影子。

## 5. 說明檔 `buildings_<c>.json`

```json
{
  "format": "war-game buildings 1",
  "culture": "E",
  "scale": 3,
  "px_per_m": 60,
  "cell_m": 2,
  "team_gain": 1.6,
  "pages": {
    "color":  ["buildings_E_color_0.png", "buildings_E_color_1.png"],
    "team":   ["buildings_E_team_0.png"],
    "shadow": ["buildings_E_shadow_0.png"]
  },
  "buildings": {
    "House": {
      "type": 1, "footprint": [2, 2],
      "states": { "build1": "found_2x2_E", "build2": "house_E_build2", "build3": "house_E_build3",
                  "done": "house_E_done", "damaged": "house_E_damaged", "rubble": "rubble_2x2_E" }
    },
    "Farm": {
      "type": 5, "footprint": [3, 3], "ground": true,
      "states": { "build1": "farm_E_build1", "build2": "farm_E_sown", "build3": "farm_E_sown" },
      "crops": ["farm_E_sown", "farm_E_growing", "farm_E_ripe"]
    },
    "TownTower": {
      "type": 9, "footprint": [2, 2],
      "states": { "done": "town_tower_E_done", "damaged": "town_tower_E_damaged", "rubble": "town_tower_E_rubble" }
    }
  },
  "frames":  { "house_E_done": { "page": 0, "x": 0, "y": 0, "w": 260, "h": 230, "ax": 130.0, "ay": 172.5 } },
  "team":    { "house_E_done": { "page": 0, "x": 0, "y": 0, "w": 60, "h": 80, "ax": 40.0, "ay": 120.5 } },
  "shadows": { "house_E_done": { "page": 0, "x": 0, "y": 0, "w": 140, "h": 70, "ax": 60.0, "ay": 35.3, "half_res": true } }
}
```

- 上面的數字只是舉例。
- `buildings` 的 key 是 `BuildingType` 的名字，`type` 是它的數字。client 照 `states` 找影格名稱，不用自己拼。
- 同一張影格可以出現在好幾個狀態（例如共用地基、農田的 `build2`、`build3`）。
- 沒有的狀態就不列：農田沒有 `done`、`damaged`、`rubble`；大城箭樓沒有施工階段。
- `ground: true`：畫在地面層（第 6 節）。
- `footprint` 是格數 `[x, y]`。這次的建築都是正方形。

## 6. 錨點、前後順序、地面層

- **錨點**：占地的中心點，在地面上。也就是 sim 的 `cellX + size / 2`、`cellY + size / 2`（格座標）。
  - `ax`、`ay` 的規則和兵種一樣：錨點在「這一層修邊後的方框」裡的位置。
  - client 照第 1 節的公式把錨點換成畫面座標。
  - client 可以從 `footprint` 算出占地的四個角。
- **前後順序**：和 B1 的設計稿一樣（`design/b1/common/scene.py`）。
  - 用 sim 的格座標。x、y 越小離鏡頭越遠，在畫面上越上面（(0, 0) 在菱形的上角）。
  - A 的占地整個在 B 的 x 較小一側，或整個在 B 的 y 較小一側時，A 先畫（在後面）。
  - 其餘的依占地中心在畫面上的 y 排序，也就是 x + y 小的先畫。
  - 單位當成一個點，和建築用同一個規則比。
  - 只用一個點排的話，站在大建築旁邊的單位會一下在前、一下在後。
- **地面層**：農田、採完的資源點、瓦礫，比所有單位和建築先畫。三種都很低（0.6 公尺以下），不會擋人。
- **點選**：建築的圖比占地高，點到圖的範圍也算點到那棟（第 10 節「高的圖案怎麼點選」）。

## 7. 資源點 `nodes.json`

| sim `NodeKind` | 影格 | 狀態 |
|---|---|---|
| `Tree` 0 | `tree_E_v0`–`v2`、`tree_W_v0`–`v2` | 採完：`tree_<c>_stump`（樹樁，畫在地面層，可以走） |
| `GoldMine` 1 | `gold_v0`、`gold_v1` | `full` → `mined` → `depleted`，例如 `gold_v0_mined` |
| `Berries` 2 | `berry_v0`、`berry_v1` | `full` → `depleted` |
| `CrystalVein` 3 | `crystal_v0`、`crystal_v1` | `full` → `depleted` |

```json
{
  "format": "war-game nodes 1",
  "scale": 3, "px_per_m": 60, "cell_m": 2,
  "pages": { "color": ["nodes_color_0.png"], "shadow": ["nodes_shadow_0.png"] },
  "nodes": {
    "Tree":        { "kind": 0, "footprint": [1, 1],
                     "variants": { "E": ["tree_E_v0", "tree_E_v1", "tree_E_v2"], "W": ["tree_W_v0", "tree_W_v1", "tree_W_v2"] },
                     "depleted": { "E": "tree_E_stump", "W": "tree_W_stump" } },
    "GoldMine":    { "kind": 1, "footprint": [1, 1], "variants": ["gold_v0", "gold_v1"],
                     "stages": ["full", "mined", "depleted"] },
    "Berries":     { "kind": 2, "footprint": [1, 1], "variants": ["berry_v0", "berry_v1"], "stages": ["full", "depleted"] },
    "CrystalVein": { "kind": 3, "footprint": [1, 1], "variants": ["crystal_v0", "crystal_v1"], "stages": ["full", "depleted"] }
  },
  "frames":  { "gold_v0_full": { "page": 0, "x": 0, "y": 0, "w": 120, "h": 90, "ax": 60.0, "ay": 62.0 } },
  "shadows": { "gold_v0_full": { "page": 0, "x": 0, "y": 0, "w": 70, "h": 35, "ax": 30.0, "ay": 18.0, "half_res": true } }
}
```

- 錨點是那一格的中心，在地面上。
- 選哪一個 `variant`：建議用格座標算，例如 `(cellX × 7 + cellY × 13) mod 變體數`。同一格每次都一樣，看起來也不會整排相同。
- 樹用哪一陸（ceo 2026-10-18）：兩陸混著用，但要一片一片的，不要一格一格換，樹林才會一叢一叢的，不是棋盤格。
  - 建議：地圖切成 6×6 格的區塊，一塊用同一陸：`((⌊cellX / 6⌋ × 7 + ⌊cellY / 6⌋ × 13) mod 2)`，0 是東陸、1 是西陸。
  - 區塊裡每一格再照上一條選 `variant`。
- 金礦的 `mined`：建議剩下的量 ≤ 第一次看到時的一半就換。`amount` 是 0 時用 `depleted`。
- 金礦、野果、晶脈東西陸共用一套。樹分東陸、西陸，見第 8 節的問題。
- 森林是一格一棵樹排出來的；B1-04 總表裡的「森林」只是示範，不另外出圖。

## 8. 狀態怎麼選

client 2026-10-18 同意照這一節做。ceo 同意瓦礫、樹、大城箭樓的做法，各加了一個條件，已寫進下面和第 7 節。

- **施工**：快照的 `progress`（千分比）：
  - < 334 → `build1`；
  - < 667 → `build2`；
  - < 1000 → `build3`；
  - 1000 → `done`。
- **受損**：完成後，`hp` ≤ 最大血量的一半 → `damaged`。修好回到一半以上就換回 `done`。
- **被摧毀**：sim 會馬上把建築移走，那幾格可以走。
  - client 在原地畫 `rubble`，畫在地面層，不擋路。
  - 留 30 秒（sim 時間），最後 2 秒淡出。
  - 同一塊地上一有新建築開工，就馬上清掉那裡的瓦礫，不要疊在施工的地基下面（ceo 2026-10-18）。
- **記住的建築**（迷霧裡、`Remembered`）：用最後看到的那個狀態的圖。

## 9. 記憶體（量產實測，2026-10-18）

- 用程式把 128 張影格全部量過（`common/atlas_b1.py` 的 `report.json` 和每組頁的 `memory.json`），不是估的（ceo 2026-10-18）。
- 來源：CI run 39130760799（算圖）、39131997855（重算三張起火的塔）、39132395283（打包）。
- 算法和兵種一樣：未壓縮每點 4 位元組，ASTC 4×4 每點 1 位元組。

**每組頁（遊戲實際載入的）**

| | 3 倍未壓縮 | 2 倍 ASTC 4×4 |
|---|---|---|
| 東陸建築 `buildings_E` | 66.1 MB（顏色 4 頁、玩家色 1 頁、影子 1 頁） | 7.4 MB |
| 西陸建築 `buildings_W` | 62.9 MB（顏色 3 頁、玩家色 1 頁、影子 1 頁） | 7.2 MB |
| 資源點 `nodes` | 2.8 MB | 0.4 MB |
| **合計（東陸對西陸）** | **131.8 MB** | **15.0 MB** |

- 同文化對打只載一組建築：3 倍未壓縮約 66 MB。
- 頁面填滿約 81%（顏色層：影格 37.3 MB，頁 45.8 MB）。

**每棟自己的影格**（三層加起來，只算影格的面積；共用的地基和瓦礫另計），3 倍未壓縮：

| 建築 | 東陸 | 西陸 |
|---|---|---|
| 主城（**最大**） | 9.41 MB | 9.54 MB |
| 民居 | 2.29 MB | 2.25 MB |
| 伐木場 | 2.17 MB | 2.20 MB |
| 礦場 | 2.28 MB | 2.26 MB |
| 糧倉 | 2.25 MB | 2.11 MB |
| 農田 | 3.62 MB | 3.62 MB |
| 兵營 | 5.28 MB | 5.18 MB |
| 射場 | 4.68 MB | 4.57 MB |
| 法術營 | 5.35 MB | 4.41 MB |
| 箭樓 | 4.43 MB | 3.52 MB |
| 馬廄 | 4.69 MB | 4.64 MB |
| 大城箭樓（**最小**，只有 3 張） | 1.90 MB | 1.90 MB |
| 共用的地基與瓦礫（6 張） | 5.81 MB | 5.80 MB |

- 最小 1.90 MB（大城箭樓），最大 9.54 MB（西陸主城）。玩家能蓋的建築裡最小的是東陸伐木場 2.17 MB。
- 2 倍 ASTC 4×4 大約是上表的 1/9：最小 0.21 MB，最大 1.06 MB。
- 效果圖集（揚塵加晶砲預警圈六張）另計：3 倍未壓縮 5.4 MB，2 倍未壓縮 2.0 MB（各一頁）。

## 10. 已經談定的（2026-10-18）

- client 同意這個格式：一個文化一組頁、`states` 對照表、`frames`／`team`／`shadows` 三張表。
  - 說明檔的 `format` 只認 `war-game buildings 1` 和 `war-game nodes 1`。之後格式有改，就升這兩個字串。
- 第 8 節的門檻和作物換階段：client 照做。
- 樹兩陸混著用（一片一片的）、中立大城箭樓用東陸的：ceo 同意。
  - 使用者選了兩邊穿哪一陸以後，箭樓要不要跟著改，到時再說。
- 晶砲預警圈 B 的靜態圖放進 art-v2 的 `effects/`，格式照 `effects.json`（ceo、client 同意）。
  - 量產時改成六張，多一張 `warn_sigil_gold`：只用五張的話法陣的線一直是橘色，和核准的 GIF 不一樣。
  - 疊法、順序和透明度見 `design/b1/README.md`「給 client：晶砲預警圈 B」。
