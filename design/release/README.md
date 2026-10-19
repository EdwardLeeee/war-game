# 美術 Release（art-vN）

把 CI 已經算好的量產圖集打包成 GitHub Release，給 client 照 tag 下載（D-085）。
格式和 war-game-client 談定，寫在 `client/docs/sprite-atlas.md` 第 2 節。

## 附件

| 附件 | 內容 |
|---|---|
| `art-vN-x3.tar.gz`、`art-vN-x2.tar.gz` | 一個倍率一個檔。最上層是 `units/<unit>/`（`<unit>.json`、`<unit>_<layer>_<k>.png`、`memory.json`，不放 `raw/`）和 `effects/`（`effects.json`、`effects_0.png`）。art-v2 起加 `buildings/`、`nodes/`；art-v3 起建築和資源點是方形斜看（D-088，說明檔有 `"view": "oblique"`）。另有 `art-release.json`：tag、commit、來源 run、每個檔的 sha256。 |
| `astc-sample.tar.gz` | 一個兵種的 2 倍顏色層和玩家色層，ASTC 4×4，KTX 1（`<unit>_<layer>_<k>.astc.ktx`，`astcenc -cl`，未預乘 alpha）。 |
| `SHA256SUMS` | sha256sum 格式，列出上面每個附件。 |

壓縮檔是固定的：檔案依名稱排序，時間戳、擁有者固定，gzip 不記檔名和時間。同樣的來源和 commit 打出來的檔案一模一樣。

## 發布

1. 在 `design/release/<tag>.json` 寫下每個兵種、效果來自哪個 run 的哪個 artifact（artifact 保留 90 天），經 PR 合併進 main。
2. 先在分支上只打包、不發布，確認 CI 綠燈（打好的檔案留在 run 的 artifact `release-<tag>`）：

   ```bash
   gh workflow run design-render.yml --ref <分支> -f round=release -f tag=art-v1
   ```

3. 合併後從 main 發布：

   ```bash
   gh workflow run design-render.yml --ref main -f round=release -f tag=art-v1 -f publish=true
   ```

   workflow 會：
   - 確認是 main，而且這個 tag 還不存在。
   - 下載 artifact，打包。
   - astcenc 從官方 Release 下載，核對 sha256 後才用。
   - 先建草稿 Release，檔案都傳完才公開。
   - 公開後從下載網址重新抓一次，核對 SHA256SUMS。

已發布的 tag 不再換檔案；內容有改就發下一號。

失敗時：
- 草稿建好了、還沒公開就失敗：會留下一個草稿，重跑會因為 tag 已存在而停下。先看失敗原因，在 Releases 頁刪掉那個草稿（草稿還沒有 tag），再重跑。
- 已經公開、核對才失敗：這個 tag 不交給 client。修好後發下一號。

本機試打包（需要 `gh` 已登入；astcenc 可省略，省略就沒有 ASTC 樣本）：

```bash
python3 design/release/pack.py --tag art-v1 --work /tmp/art --astcenc <astcenc 路徑>
```
