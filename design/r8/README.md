# R8 寫實整套核准稿（D-093）

brief：`docs/briefs/2026-10-r8-realism-ui.md`。使用者選的 R7 版本 2（MPFB 寫實人體、CC0 材質、寫實打光和地面），12 種兵先出核准稿。

## 程式

| 檔案 | 做什麼 |
|---|---|
| `blender/r8.py` | 正式流程用 `R7_VERSION=8` 時加上的東西：槍兵雙手持槍（`before_extend`，在 `anims.extend` 之前，倒下的第一格也是雙手）、弓弦跟著右手、拉弓拉到臉頰、輪廓光 |
| `blender/east_r8.py` | 東陸槍兵、弓手的唐末五代服裝（照 ceo 的考據筆記）：札甲材質、兜鍪和頓項、圓領缺胯袍、幞頭、胡祿、角弓 |
| `common/boards_r8.py` | 每種兵一張核准稿、動作 GIF、好不好認的量測（全部方向全部影格）；`R8_REFS` 有設定時，旁邊放參考圖和要點 |

## 參考圖

- 東陸的考據筆記在 research 工作區（`research/east-reference/notes.md`，圖 01–15，授權 `LICENSES.md`），不在這個 repo。
- 核准稿上只放公有領域和 CC0 的圖（01、02、04、06），授權記在 `../../THIRD_PARTY_NOTICES.md`。CC BY-SA 的圖只拿來看。
- 每條要點標證據等級：一手（當時的文獻、文物、壁畫）、二手（現代研究）、推論、設計選擇。

## 怎麼重做

```bash
# CI：design-render，round r7，targets ["v8-spear_e","v8-bow_e"]；下載 r7-v8-<兵> 的 artifact
R8_REFS=<research>/east-reference python3 design/r8/common/boards_r8.py \
  spear_e <artifact>/r7v8/prod/spear_e/atlas_x3 bow_e <artifact>/r7v8/prod/bow_e/atlas_x3
```

本機試做用 `design/production/blender/render_prod.py --target <兵> --preview`（每個動作第一格，低取樣），全部影格交給 CI。`R8_DEBUG=1` 會印出看得到的部件、MPFB 頭和身體的大小（做頭盔、衣服的尺寸依據）。
