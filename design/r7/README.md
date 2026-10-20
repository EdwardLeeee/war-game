# R7 寫實畫風比較（D-092）

brief：`docs/briefs/2026-10-r7-realism-ui.md`。同一組內容做成四個版本並排：東陸槍兵、弩手，一座兵營，一塊 12×8 格的地面。四個版本都用方形斜看。

| 版本 | 做法 | 程式 |
|---|---|---|
| 0 現在 | art-v4 原樣，地面是遊戲現在的兩種綠格子（`client/src/render/world.ts`） | `common/boards_r7.py`（用 art-v4 合成） |
| 1 現在形狀加工序 | 形狀不變，頭縮成身高約 1/7.5；材質換成 CC0 貼圖，建築加倒角和髒污；換成 R7 打光、拿掉描邊；CC0 地面 | `blender/look.py`、`blender/ground_r7.py` |
| 2 寫實人體底模 | 版本 1，加上兵換成 MPFB 寫實人體，用核准的動作驅動 | `blender/human_r7.py` |
| 3 AI 生成（只做測試） | Hunyuan3D 2.1 試用頁從我們的概念圖生成形狀，依部位套我們的 CC0 材質，綁到我們的骨架 | `common/hunyuan.py`、`blender/ai_r7.py` |

- 外部素材：授權記在 `../../THIRD_PARTY_NOTICES.md`。
  - CC0 貼圖照 `common/textures_sha.json` 下載，核對 sha256，原始檔不進 repo。
  - 版本 3 的生成物不放進任何 Release，它的比較圖也不放進 repo（公開 repo 就等於散布）。使用者已經在電腦上看過；`boards_r7.py` 把版本 3 的圖存在 `build/private/`。
- 版本 1–3 的打光一樣：太陽方向和現在一樣，加補光、天空光，用 AgX Medium High Contrast。圖上都註明打光也改了。

## 輸出（`out/`）

| 檔名 | 內容 |
|---|---|
| `R7-0<k>-寫實-<k>-<名>-mobile.png` | 版本 0–2 一個版本一張：手機 3 倍、實際大小、四名兵並排（藍、紅），代價 |
| `R7-0<k>-寫實-<k>-<名>-動作.gif` | 版本 0–2 的槍兵、弩手 walk 和 attack |
| `R7-99-寫實-總覽.png` | 版本 0–2 並排，實際大小 |

## 怎麼重做

```bash
python3 common/textures.py fetch                 # CC0 貼圖（核對 sha256）
python3 common/run.py 1                          # 版本 1：戰場和兵的影格（build/v1/）
python3 common/run.py 2                          # 版本 2：要先在 Blender 裝 MPFB 2.0.18（THIRD_PARTY_NOTICES.md 有網址和 sha256）
# 版本 3：先算概念圖（render_r7.py 的 concept 項目），再用 common/hunyuan.py 生成形狀，放到 build/ai/
python3 common/run.py 3
python3 common/boards_r7.py ART 0 1 2 3          # ART：解開的 art-v4-x3
```
