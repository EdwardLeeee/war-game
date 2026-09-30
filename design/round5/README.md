# 第 5 輪：西陸晶術師＋兵種總表（R5）

- 日期：2026-09-30
- 負責：war-game-ui
- 依據：`docs/briefs/2026-10-ui-r5-roster.md`
  - 東陸術士定為 B 劍修（D-019），劍指手訣施法（D-018），不會飛（D-010）。
  - 西陸晶術師用晶杖，杖頂嵌魔晶，出身暫定為晶術學院（`docs/world/bible.md`「施法方式」）。
  - 畫面風格 B 立體微縮（D-012），精緻度 C（D-015），素材 3 倍（D-017）。

## 項目與選項

| 項目 | 選項 |
|---|---|
| R5-01 西陸晶術師 | 0 現況、A 晶劍士、B 學院大師、C 女晶術師 |
| R5-02 兵種總表 | 東陸、西陸各 6 種，C 精緻度（西陸法師那一格等 R5-01 選好再補） |

- 選項 0 直接沿用 R3 的現況算圖（`design/round3/build/r3/mage0`），設定相同。
- R5-01 總覽最下面是實際大小下晶術師和長弓兵、長矛兵的比較。長弓兵、長矛兵暫用 R1 模型，只比外形；
  C 版在 R5-02 總表再比一次。
- 杖頭晶石的大小是從實際大小的算圖量出來的，寫在每張設計稿上。
- 原創：晶杖、學院長袍、披肩、頭巾、斗笠、長弓、長矛、投石機都是一般的中古元素，不仿任何作品的角色造型。

## 程式

- `blender/mage5.py`：三種西陸晶術師。長杖拿在右手、杖腳著地；施法時舉杖前指，魔法陣出在杖頭。
- `blender/roster5.py`：還沒精緻化過的兵種（農夫、弩手、長弓兵、長矛兵、霹靂車、投石機）與新加的西陸農民，C 精緻度。
- `blender/units5.py`：依兵種分派到 R5、R4（劍修）、R3（騎兵修正過的腿）、R2 的模型。
- `blender/render_r5.py`：算圖目標
  - `mageWA`、`mageWB`、`mageWC`：R5-01 的三款。
  - `compare`：R1 的長弓兵、長矛兵，只給 R5-01 的比較列用。
  - `rosterE1`、`rosterE2`、`rosterW1`、`rosterW2`：R5-02 的 11 個兵種（右前的待機與動作，加上隊伍排列用的朝向）。
- `common/r5art.py`：R5-01 設計稿、動作對照 GIF、總覽。沿用 R3 的版面程式；杖頭晶石在合成時加光暈。
- 正式算圖在 GitHub Actions 上跑（`.github/workflows/design-render.yml`，預設 round5）。

## 重新產生

```bash
python3 common/fetch_ci.py <run_id> [target ...]
python3 common/r5art.py
~/.local/opt/war-game-tools-venv/bin/python common/optimize.py
```
