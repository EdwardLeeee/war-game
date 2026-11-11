# R23 其他小項（R19 的第 10、11、13、14、15 項）

使用者 2026-11-11 看了 R19 的總表，15 項全部要改（D-142）。這是四批裡的第 4 批。和第 3 批（R22 倒下）動到的兵種重疊，所以分開出稿、分開核准，核准後一起算圖、一起發 art-v7.11。

**使用者的選擇**（2026-11-11，ceo 轉達，都選了推薦的）：第 10 項照改後；第 11 項 B 同色不透明；第 13 項 B 加玩家色圍裙（選項上寫了 A 會和西陸遠程兵很像）；第 14 項 A 八卦；第 15 項 B 領子和袖口。

在這個 PR 裡每一項還是要設環境變數才打開，預設和現在的圖一樣；art-v7.11 的 PR 才把選中的做成預設、把沒選的拿掉：

| 項 | 內容 | 開關 | 在哪裡 |
|---|---|---|---|
| 10 | 遠程兵（兩國）待機、走路時右臂自然垂下、走路時擺動（原本停在搭箭的位置，平舉在腰前） | `R23_BOW=1` | `design/r8/blender/r8.py` `bow_string` |
| 11 | 法師護盾的碎片（兩國）：A 護盾的淡青色、半透明；B 淡青色、不透明 | `R23_SHARD=A\|B` | `anims._shards` |
| 13 | 西陸農民的玩家色：A 兜帽戴起來；B 腰下加玩家色圍裙 | `R23_FARMER_W=A\|B` | `west_r8.dress_farmer` |
| 14 | 東陸法師手前的法陣：A 八卦；B 北斗七星（現況是六芒星，和西陸一樣） | `R23_SIGIL=A\|B` | `east_r8._sigil_r23` |
| 15 | 東陸法師的玩家色：A 帔加寬；B 領子和袖口各加一圈 | `R23_MAGE_E=A\|B` | `east_r8.dress_mage` |

- 第 11 項：碎片當初是故意做成不透明的（邊緣發亮的護盾材質，碎片正面看幾乎透明）。這次只把顏色從燒成純白改回護盾的顏色。
- 第 14 項：手前出現法陣是 D-018 定的，只換圖樣。出處寫在 `east_r8.py` 的註解：唐代鑄八卦的銅鏡、畫北斗的道教鏡。太極圖是宋代以後的，沒有用。
- 第 13、15 項的衣服本身是 R8 查過出處的（西陸的連肩兜帽、東陸道士的帔），選項只動玩家色放在哪。

## 稿（`build/out/`，不在 repo）

```bash
bash design/r23/build/run_drafts.sh      # 本機草稿：現況和每個選項（不在 repo），下面這種指令
R21_FX=1 R23_SIGIL=A R21_SS=2 R21_SAMPLES=48 python3 design/r21/common/render_r21.py mage_e design/r23/build/draft/mage_e_sigA sA cast:17-22:7 cast:19:0
R23_FARMER_W=B R21_SS=2 R21_SAMPLES=48 python3 design/r21/common/render_r21.py farmer_w design/r23/build/draft/farmer_w_B wB idle:0:7,6,0 walk:2:7 work_farm:3:7
python3 design/r23/common/boards_r23.py design/r23/build/draft ART_X3 design/r23/build/out
```

- `R21_FX=1`：連特效那一層一起算（法陣、碎片）；看板把它疊在人上面。草稿不畫護盾的球。
- 草稿資料夾：`mage_e_fx0`（現況的施法和破盾）、`mage_e_sigA`／`sigB`、`mage_e_shA`／`shB`、`mage_e_0`／`A`／`B`（玩家色）、`farmer_w_0`／`A`／`B`、`bow_e_0`／`bow_e_new`、`bow_w_0`／`bow_w_new`。
- `R23-總覽-其他小項-phone.png`：五項各一列，現況和選項並排。
- `R23-00-參考資料`、`R23-01-遠程兵的右手-改前改後`、`R23-02-護盾碎片-選項`、`R23-03-西陸農民玩家色-選項`、`R23-04-東陸法陣-選項`、`R23-05-東陸法師玩家色-選項`（都是 `-phone.png`）。
