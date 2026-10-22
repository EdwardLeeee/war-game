# 美術 Release（art-vN）

把 CI 已經算好的量產圖集打包成 GitHub Release，給 client 照 tag 下載（D-085）。
格式和 war-game-client 談定，寫在 `client/docs/sprite-atlas.md` 第 2 節。

## 附件

| 附件 | 內容 |
|---|---|
| `art-vN-x3.tar.gz`、`art-vN-x2.tar.gz` | 一個倍率一個檔。最上層是 `units/<unit>/`（`<unit>.json`、`<unit>_<layer>_<k>.png`、`memory.json`，不放 `raw/`）和 `effects/`（`effects.json`、`effects_0.png`）。art-v2 起加 `buildings/`、`nodes/`；art-v3 起建築和資源點是方形斜看（D-088，說明檔有 `"view": "oblique"`）；art-v4 起加 `castle/`（城牆，D-089；發布清單寫 `"castle": true`）；art-v5 起加 `terrain/`（地形，R6-51；發布清單寫 `"terrain": true`，說明檔 `design/b1/atlas-buildings.md` 第 12 節）。另有 `art-release.json`：tag、commit、來源 run、每個檔的 sha256。 |
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

## 已發布

| tag | 公開（UTC） | main | 發布 run | 內容 |
|---|---|---|---|---|
| art-v1 | 2026-10-18 13:06 | e78d939 | 39130015427 | 12 種兵種、揚塵 |
| art-v2 | 2026-10-18 13:51 | c21cd9f | 39133286241 | 加建築與資源點（菱形，斜 45°）、晶砲預警圈 |
| art-v3 | 2026-10-19 11:25 | 2da2698 | 39242920677 | 建築與資源點改成方形斜看（D-088，`view: oblique`）；兵種、效果和 art-v2 相同 |
| art-v4 | 2026-10-19 18:33 | 5ed0880 | 39303076729 | 加城牆（`castle/`，D-089）與 3×3 大城箭樓；其他和 art-v3 相同 |
| art-v5 | 2026-10-20 15:17 | 98f755b | 39446538988 | 加地形（`terrain/`，R6-51，core #245）；其他和 art-v4 相同 |
| art-v5.1 | 2026-10-22 06:50 | d668193 | 39736249554 | 建築加哨所（`Outpost`，D-080 暫用版）；其他和 art-v5 相同 |

每一號發布後都從公開網址重新下載，`sha256sum -c SHA256SUMS` 全部 OK。

失敗時：
- 草稿建好了、還沒公開就失敗：會留下一個草稿，重跑會因為 tag 已存在而停下。先看失敗原因，在 Releases 頁刪掉那個草稿（草稿還沒有 tag），再重跑。
- 已經公開、核對才失敗：這個 tag 不交給 client。修好後發下一號。

本機試打包（需要 `gh` 已登入；astcenc 可省略，省略就沒有 ASTC 樣本）：

```bash
python3 design/release/pack.py --tag art-v1 --work /tmp/art --astcenc <astcenc 路徑>
```
