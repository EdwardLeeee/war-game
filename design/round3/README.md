# 第 3 輪：術士造型與騎兵的腿（R3）

- 日期：2026-09-30
- 負責：war-game-ui
- 依據：使用者看完 R2 的回覆：「c 最好 但是騎士沒有腳，而且魔法師的設計改一下吧 我不太喜歡這風格的」（決策紀錄 D-015）。
  - R2-01 模型精緻度選 C，這一輪全部用 C 級。
  - R2-02 放大清晰度使用者還沒選。

## 項目與選項

| 項目 | 選項 |
|---|---|
| R3-01 術士造型 | 0 現況、A 軍裝術士、B 制式秘術兵、C 符籙術士 |
| R3-02 騎兵的腿 | A 跨坐修正（只有這一種改法） |

- R3-01 的三個方向都依照 ceo 定的原則：
  - 正規軍的精英，不穿金屬鎧甲。
  - 法器是法印。
  - 玩家色只出現在換色區：披肩、臂章、肩章、腰帶、帽帶。
  - 不靠防護罩也要認得出。
  - 每個選項的評估裡另有一行「西陸版會怎麼延伸」，下一輪才畫。
- R3-02 的原因：R2 的騎手少了坐姿，腿直直插進馬身裡。現在改成大腿外張跨過馬身、小腿垂在馬衣外，加上馬鐙。

## 程式

- `blender/mage3.py`：四種術士（0 是 R2 的 C 級術士），共用施法特效（防護罩、面向鏡頭的魔法陣、地面法陣、晶砲）與 R1 的動作。
- `blender/units3.py`：R2 的 C 級模型，加上騎手坐姿修正與馬鐙。
- `blender/render_r3.py`：算圖清單，目標為 `mage0`、`mageA`、`mageB`、`mageC`、`legs`。
- `common/r3art.py`：設計稿、動作對照 GIF、總覽。
- 沒變的單位（槍兵）直接用 `design/round2/build/r2/C/` 的 R2 成品。
- 正式算圖在 GitHub Actions 上跑（`.github/workflows/design-render.yml`，預設 round3）。

## 重新產生

```bash
# 本機預覽（可用記憶體 ≥ 2 GB 時，放在 1.5 GB 上限區）
python3 blender/render_r3.py --target mageA --preview
# 正式算圖：推送 design/round3/blender/** 就會觸發 CI，或手動觸發 design-render
python3 common/fetch_ci.py <run_id>
python3 common/r3art.py
~/.local/opt/war-game-tools-venv/bin/python common/optimize.py
```

## 授權

同 R1、R2：模型與材質都由程式產生；Blender（GPL，只當工具）、Noto CJK（OFL，只用於設計稿文字）。
