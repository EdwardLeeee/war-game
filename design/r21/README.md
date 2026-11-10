# R21 攻城砲（R19 的第 6、7 項）

使用者 2026-11-11 看了 R19 的總表，15 項全部要改（D-142）。這是四批裡的第 2 批，兩項都給選項。

- **第 6 項 東陸**：靠人拉繩發射的砲沒有人，發射時四條拉繩不動（掛在砲桿的短端已經離開的地方）。
  - `R21_E=A`：拉繩的上端跟著砲桿走，握把留在地上。只改 `anims.extend_siege`。
  - `R21_E=B`／`C`：兩名／四名拽手拉繩。稿上的人是示意：用農民另外算（`R21_PULL=1`，`extend_farmer` 的 `pull()`）再疊到砲前面。選了才正式做進砲的圖裡。
- **第 7 項 西陸**：固定木架沒有輪子，走路的 8 格是同一張圖。
  - `R21_W=A`：四個實心小木輪（`west_r8._siege_r21`，名字 `siege_w_w<s><e>`，`extend_siege` 會自動轉）。
  - `R21_W=B`：底架下墊滾木，走路時每根往後移一格、轉一圈。前後各有一根在循環接起來的地方出現／消失。
  - 兩個都不算照史實（2026-10-21 把沒有中古依據的帶輪扭力砲換成固定木架的配重砲；帶輪子的配重砲在圖像裡少見），稿上寫明。底架抬高時，石堆留在地上、往外移 30 公分。

**使用者的選擇**（2026-11-11，D-143）：東陸 B 兩名拽手、西陸 A 四個小木輪。從 art-v7.10 起是預設；沒選的（東陸 A、C，西陸 B 滾木）程式已拿掉。

- **東陸**（`R21_E`，預設 `B`；`0` 是沒有人的砲）：
  - 兩個人建在砲的場景裡（`east_r8._pullers`，rig 叫 `siege_e_p0`／`p1`，在 `u.rigs` 裡是 `puller0`／`puller1`），不是另外疊的。穿東陸弓手那種玩家色的圓領袍、黑幞頭、綁腿，不帶武器。身體由 `r7_prod.apply` 套上。
  - 動作在 `anims.extend_siege` 的 `crew()`：待機和發射時面向砲拉繩（`pull_height`）；走路時轉向前、繩拉過右肩；砲垮時被甩到車頭兩側倒下（步兵的 `FALL_KEYS`）。繩 1、2 接到右手，繩 0、3 和地上的握把藏掉。
  - 輪子一個循環轉 135 度（原本 90）：`anims.SPIN_PER_CYCLE`、`spec.STRIDE_M["siege_e"]` 0.66 → 0.99 公尺，人的一步才有半公尺。8 根輪輻每 45 度重複，一格轉 16.9 度，看得出方向（180 度會剛好看不出往哪轉）。
  - 不照史實：《武經總要》裡拉繩的砲最少四十人。
- **西陸**（`R21_W`，預設 `A`；`0` 是沒有輪子的木架）：四個實心小木輪（`west_r8._siege_r21`），`spec.STRIDE_M["siege_w"]` 0.565 → 0.377 公尺；倒下（`collapse_w`）照有輪子的底架重做。不照史實。
- CI 正式算圖會先把畫框放大到單位伸得到的範圍（`render_prod.fit_frame`），所以 `spec.UNITS` 的 frame 不用改；本機草稿用 spec 的畫框，砲垮的殘骸會被切到，要用 `R21_FRAME`。

出處在 `notes.md` 和 `R21-00-參考資料`。

## 稿（`build/out/`，不在 repo）

```bash
bash design/r21/build/run_drafts.sh        # 本機算草稿：東陸 現況／A／B／C、拽手、西陸 現況／A／B（不在 repo，內容見下）
R21_E=A R21_SS=2 R21_SAMPLES=48 python3 design/r21/common/render_r21.py siege_e design/r21/build/draft/e_A eA attack:0-9:7 attack:0,3:0 idle:0:7
R21_PULL=1 R21_SS=2 R21_SAMPLES=48 python3 design/r21/common/render_r21.py farmer_e design/r21/build/draft/crew cr attack:0-9:1 attack:0,3:0 idle:0:1
R21_W=A R21_SS=2 R21_SAMPLES=48 python3 design/r21/common/render_r21.py siege_w design/r21/build/draft/w_A wA walk:0-7:7,0 idle:0:7
python3 design/r21/common/boards_r21.py design/r21/build/draft design/r19/build/art/x3 design/r21/build/out
```

- 草稿資料夾：`e_0`（現況）、`e_A`、`e_B`、`e_C`、`crew`、`w_0`、`w_A`、`w_B`；檔名前綴 `e0`、`eA`…、`cr`、`w0`…。
- `R21-總覽-攻城砲-phone.png`：兩項各一列，現況和選項並排。
- `R21-01-東陸拉繩-<選項>-phone.png`、`R21-02-西陸移動-<選項>-phone.png`：每個選項一張。
- `R21-東陸-發射-各選項-phone.gif`、`R21-西陸-走路-各選項-phone.gif`：選項並排，照遊戲的速度。
- 選定以後（`common/final_r21.py`）：`R21-03-東陸兩名拽手-改前改後-phone.png`、`R21-04-西陸四個小木輪-改前改後-phone.png`。改前是已發布的圖，改後是草稿 `e_B2`、`w_A`、`w_A2`：

```bash
R21_SS=2 R21_SAMPLES=48 python3 design/r21/common/render_r21.py siege_e design/r21/build/draft/e_B2 eB idle:0:7,0,6 attack:0-9:7 attack:3:0 walk:0-7:7 walk:0,2,4:0 walk:2:6
R21_FRAME=9,8,0.5,0.7 R21_SS=2 R21_SAMPLES=48 python3 design/r21/common/render_r21.py siege_e design/r21/build/draft/e_B2 eB death:0-9:7 death:0,4,6,9:0 death:9:6,2
python3 design/r21/common/final_r21.py design/r21/build/draft design/r19/build/art/x3 design/r21/build/out
```

`boards_r21.py`（選項的看板）要用選項那時的草稿（`e_0`、`e_A`、`e_B`、`e_C`、`crew`、`w_0`、`w_B`）和那時的程式（#478），現在的程式已經沒有那些選項。
