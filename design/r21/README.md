# R21 攻城砲（R19 的第 6、7 項）

使用者 2026-11-11 看了 R19 的總表，15 項全部要改（D-142）。這是四批裡的第 2 批，兩項都給選項。

- **第 6 項 東陸**：靠人拉繩發射的砲沒有人，發射時四條拉繩不動（掛在砲桿的短端已經離開的地方）。
  - `R21_E=A`：拉繩的上端跟著砲桿走，握把留在地上。只改 `anims.extend_siege`。
  - `R21_E=B`／`C`：兩名／四名拽手拉繩。稿上的人是示意：用農民另外算（`R21_PULL=1`，`extend_farmer` 的 `pull()`）再疊到砲前面。選了才正式做進砲的圖裡。
- **第 7 項 西陸**：固定木架沒有輪子，走路的 8 格是同一張圖。
  - `R21_W=A`：四個實心小木輪（`west_r8._siege_r21`，名字 `siege_w_w<s><e>`，`extend_siege` 會自動轉）。
  - `R21_W=B`：底架下墊滾木，走路時每根往後移一格、轉一圈。前後各有一根在循環接起來的地方出現／消失。
  - 兩個都不照史實（配重砲是拆開運、到了再組；2026-10-21 才照史實改成固定木架），稿上寫明。

都要設環境變數才打開，預設和 art-v7.8 一樣。出處在 `notes.md` 和 `R21-00-參考資料`。

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
