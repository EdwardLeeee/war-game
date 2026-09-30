# 第 1 輪：畫面風格（R1-01）

- 日期：2026-09-30
- 負責：war-game-ui
- 依據：`docs/briefs/2026-10-ui-r1-art-direction.md`
  - 在 PR #1 合併前，以 ceo worktree 的版本為準。
- 選項：
  - A 彩繪桌遊：純 2D，明亮
  - B 立體微縮：3D 模型算成 2D，中間偏暖
  - C 水墨戰卷：和 B 共用 3D 模型，畫成紙白墨黑，只有玩家色與魔法上色
    - 原本偏暗，依 ceo 回饋改成紙白墨黑，和 B 明顯區隔
- 三個選項用同一個戰場：
  - 我方南溟（東陸，藍）
  - 敵方布倫莫爾王國（西陸，紅）
  - 東陸小鎮是「我方治理」
  - 另外放了一座西陸石造箭樓，用來檢查西陸建築放在各畫風裡協不協調

## 成品（`out/`）

| 檔名 | 內容 |
|---|---|
| `R1-01-畫面風格-<字母>-<名稱>-mobile.png` | 戰鬥畫面設計稿（iPhone 14 Pro Max 橫向，3 倍輸出）＋實際大小縮圖＋兵種高度尺規 |
| `R1-01-畫面風格-<字母>-<名稱>-法師動畫.gif` | 術士的完整動作：待機、走路、晶砲、中彈、罩碎、倒下。左邊是實際大小，右邊放大 4 倍 |
| `R1-01-畫面風格-<字母>-<名稱>-法師關鍵影格.png` | 同一段動作的關鍵影格 |
| `R1-01-畫面風格-<字母>-<名稱>-法師8方向.png` | 只有 B、C 有：腳本自動產生的 8 方向，每個方向 4 個姿勢 |
| `R1-01-畫面風格-<字母>-<名稱>-量產說明.png` | 量產說明卡。完整文字在各資料夾的 `量產說明.md` |
| `R1-99-總覽對照.png` | 三個選項並排比較 |

圖內左上角的標籤與檔名（去掉副檔名）逐字相同。

## 怎麼重新產生

先準備環境：

- Blender 5.2.2 裝在 `~/.local/opt/blender-5.2.2`（官網 Linux 版，sha256 已比對）。
- `pyoxipng` 裝在 `~/.local/opt/war-game-tools-venv`（venv 帶系統套件）。
- 系統要有：Python 3.10、Pillow 11.1、numpy 1.26、pycairo、ffmpeg、Google Chrome。

在 `design/round1/` 底下依序執行：

```bash
python3 common/emblems.py build/emblems          # 徽章（白鶴、雙塔）
python3 blender/render_scene.py                  # B、C 共用：場景所有素材（每個模型一個 Blender 程序）
python3 blender/render_mage.py                   # B、C 共用：術士動作、8 方向、頭像
python3 b-3d/build_b.py && python3 b-3d/mage_b.py && python3 b-3d/prod_b.py
python3 c-ink/build_c.py && python3 c-ink/prod_c.py
python3 a-2d/build_a.py && python3 a-2d/prod_a.py   # A（純 2D，不用 Blender）
python3 common/summaries.py && python3 common/overview.py   # 總覽
~/.local/opt/war-game-tools-venv/bin/python common/optimize.py   # 無損壓縮 out/ 的 PNG
```

中間檔都放在 `build/`，不進 git。`.blend` 檔也不存，模型每次都由腳本重新產生。

## 記憶體規則（這台電腦的 Blender 與 Chrome）

- 一律透過 `common/config.py` 的 `capped()` 執行，等於 `systemd-run --user --scope -p MemoryMax=1500M -p MemorySwapMax=0`。
- 開跑前可用記憶體（available）少於 2000 MB 就等。
- 一次只跑一個 Blender。
- 被上限關掉（exit 137）時，降解析度或取樣數。本輪的實例：
  - 主城一角整張算時超過上限，改成分塊算圖，每個分層用獨立程序跑。
  - 影子改成半解析度、不降噪。
  - 之後主城的本體與光影層最高 1.43 GB，其他素材都在 0.4–0.9 GB。

## 尺寸與安全區

- 畫面 932×430 pt，3 倍輸出為 2796×1290 px。
- 安全區：左右各 59 pt、下 21 pt、上 0。
  - 來源：useyourloaf.com「iPhone 14 Screen Sizes」，iPhone 14 Pro Max 橫向的 safe area insets。
- 動態島畫在左側，37×126 pt，距邊 11 pt。
- 螢幕圓角半徑約 55 pt。
- 以上兩項**待實機確認**。
- 美術比例：地面每公尺 20 pt，鏡頭仰角 30 度（地面菱形 2:1）。三個選項相同。

## 授權

- Blender 5.2.2：GPL。只當製作工具；算出來的圖不受 GPL 限制，可以商用。
- Noto Sans CJK TC、Noto Serif CJK TC：SIL Open Font License 1.1，系統已安裝，只用在設計稿的文字，字型檔不進 repo。
- pyoxipng：MIT，只用來壓縮 PNG。
- Pillow、numpy、pycairo、ffmpeg、Chrome：製作工具，不隨遊戲發佈。
- 模型、材質、徽章、地面、UI 圖示都是本資料夾的程式產生或手寫 SVG，沒有使用第三方素材。
- 根目錄的 `THIRD_PARTY_NOTICES.md` 這輪依 ceo 指示不建立。

## 工作紀錄

- 各階段的實際時間記在 `worklog.md`（B、C）與 `a-2d/worklog-a.md`（A）。
- 量產說明的工時由這兩份紀錄推算，推算的部分都標「估計」。

## 這輪依 ceo 回饋定下的原則

- 玩家色只出現在換色區：旗、背旗、披風、罩袍、馬衣、馬鎧下擺。衣甲與武器一律避開玩家色。
- 同一種兵在兩個文化之間，玩家色的面積要差不多。
- 法師要有專屬剪影與配色（法器發光、魔晶色點綴），不能只靠防護罩辨認。
- 雙塔徽章是兩座分開的塔，不可以用橫槓連起來，避免看起來像字母 H。
- 還沒處理：4 方混戰的 4 種玩家色，以及魔晶青、預警圈橘紅等中性色會不會撞色。建築的朱紅柱子暫時保留。這些第 2 輪再定。

## 中間檔

- `build/` 約 82 MB，不進 git。
  - 保留到使用者選完風格，方便小修後快速重新合成。
  - 之後依 ceo 規則清掉。
- 工具安裝在 repo 外：
  - Blender 1.2 GB
  - venv 21 MB
