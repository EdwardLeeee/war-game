# 第 4 輪：術士造型（道士／修仙）（R4）

- 日期：2026-09-30
- 負責：war-game-ui
- 依據：
  - 使用者看完 R3 後說：「我覺得都不好，應該做的像道士或是修仙者」。
  - 騎兵的腿，使用者說：「騎兵沒問題」。
  - 以上記為決策紀錄 D-017。
- 世界觀以 `docs/world/bible.md` 的「東陸法師的出身」為準：
  - 東陸法師是道門出身的修士，被法術營編進軍隊當精英。
  - 不會飛（沒有御劍飛行）。
  - 法器是法印。
  - 玩家色只出現在換色區。
- R2-02 放大清晰度由 ceo 決定先用 3 倍素材。

## 項目與選項

| 項目 | 選項 |
|---|---|
| R4-01 術士造型 | 0 現況、A 道長、B 劍修、C 女修 |

- 選項 0 直接沿用 R3 的現況算圖（`design/round3/build/r3/mage0`），設定相同。
- 總覽最下面有術士與農民的帽子剪影比較（ceo 要求）。
- 原創：
  - 只用八卦、太極、道袍、拂塵、偃月冠、披帛這類傳統元素。
  - 不仿任何仙俠作品的角色造型。

## 程式

- `blender/mage4.py`：三種道士／修仙術士。
  - 長袍加上垂墜的褶子，避免變成圓錐。
  - 玩家色的飄帶與披帛沿路徑建成布條，用和身體相同的自算權重蒙皮，會跟著手臂和腿動。
- `blender/render_r4.py`：算圖目標 `mageTA`、`mageTB`、`mageTC`、`farmer`。
  - 農夫是 R1 的模型，套用 R2 的算圖設定，只拿來比帽子。
- `common/r4art.py`：設計稿、動作對照 GIF、總覽。沿用 R3 的版面程式。
- 正式算圖在 GitHub Actions 上跑（`.github/workflows/design-render.yml`，預設 round4）。

## 重新產生

```bash
python3 common/fetch_ci.py <run_id>
python3 common/r4art.py
~/.local/opt/war-game-tools-venv/bin/python common/optimize.py
```
