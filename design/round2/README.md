# 第 2 輪：模型精緻化（R2）

- 日期：2026-09-30
- 負責：war-game-ui
- 依據：
  - 使用者在 R1 選了 B。
  - 使用者原話：「我覺得b版不錯，只是現在的模型太粗糙了，要改一下」（決策紀錄 D-012）。
  - 引擎定為 PixiJS（D-013），執行時只畫 2D 圖，B 的製作流程不受影響。
- `design/round1/` 保持原樣，是 R1 的核准紀錄。這一輪需要改的共用程式都複製到 `design/round2/` 再改。

## 項目與選項

| 項目 | 選項 |
|---|---|
| R2-01 模型精緻度 | 0 現況（R1 原樣）、A 算圖升級、B 造型升級、C 細節升級（逐級累加） |
| R2-02 放大清晰度 | A 3 倍素材（現在）、B 4.5 倍、C 6 倍 |

- 代表樣本：
  - 東陸：槍兵、具裝騎兵、術士
  - 西陸：騎士
  - 建築：東陸城樓、西陸石塔
- 動作對照：`R2-99-動作對照.gif`，0／A／B／C 四格並排。
- 總覽：`R2-99-總覽對照.png`。

## 怎麼做出來的

- **選項 0**：直接用 `design/round1/blender/` 的程式算圖。
- **選項 A**：R1 的模型，換成這輪的算圖設定：
  - 2 倍超取樣：先算 2 倍大，再縮小。
  - 64 次取樣。
  - 多算一層環境遮蔽（縫隙變暗），合成時疊上去。
  - 輕微銳化。
- **選項 B**：
  - 身體用 Blender 的 Skin 修改器沿骨架長出一整塊平滑網格。馬用自己寫的橢圓剖面建模（`body2.loft`）。
  - 每格用自算權重的線性混合蒙皮（`body2.Skinner`），讓網格跟著 R1 的關節變形。沒有用 Blender 的骨架自動權重，所以 R1 的所有動作都能直接沿用。
  - 長袍、裙甲、罩袍、馬衣也用同一種蒙皮，走路時會跟著腿動。
  - 材質：甲片、布紋、金屬邊緣磨亮。
  - 建築：加上斗拱、椽子、格子窗、匾額、托石、鐵箍。
- **選項 C**：B 再加上臉、鉚釘、護腕、韁繩、流蘇、門釘、燈籠、角石。

## 在哪裡算

- 這台筆電要替其他 session 保留 2 GB 可用記憶體，所以正式算圖都在 GitHub Actions 上跑：`.github/workflows/design-render.yml`。
  - 四個等級平行跑。
  - Blender 5.2.2 從官網下載並驗證 sha256。
  - 成品上傳成 artifact `r2-<等級>`。
- 本機只在可用記憶體 ≥ 2 GB 時，用 `--preview` 算單一兵種的小預覽，並放在 1.5 GB 上限區裡跑。
- 兩邊都固定 Blender 版本、取樣數與亂數種子（`cycles.seed = 0`）。如果結果不同，以 CI 的成品為準。

## 重新產生

```bash
# 1. 算圖（在 GitHub 上）：推送到 design/** 分支、改到 design/round2/** 就會觸發；也可以手動觸發 design-render
# 2. 抓回本機
python3 common/fetch_ci.py <run_id>
# 3. 合成設計稿
python3 common/r2art.py 01 02 gif overview
~/.local/opt/war-game-tools-venv/bin/python common/optimize.py
```

本機預覽（只算 3 倍、低取樣）：

```bash
python3 blender/render_r2.py --level B --only spear_e --preview --parts detail
```

## 記憶體數字

- 一律以**未壓縮 RGBA8**（每像素 4 bytes）計算，依完整量產規格：2 文化 × 6 兵種 × 4 動作 × 8 方向，3 個方向用鏡像。
- 壓縮貼圖能省多少，第二階段由 core 實測。

## 授權

- 同 R1：Blender（GPL，只當工具，算出的圖不受限制）、Noto CJK（OFL，只用於設計稿文字）。
- 模型、材質、徽章都由本資料夾與 `design/round1/` 的程式產生，沒有第三方素材。
