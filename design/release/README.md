# 美術 Release（art-vN）

把 CI 已經算好的量產圖集打包成 GitHub Release，給 client 照 tag 下載（D-085）。
格式和 war-game-client 談定，寫在 `client/docs/sprite-atlas.md` 第 2 節。

## 附件

| 附件 | 內容 |
|---|---|
| `art-vN-x3.tar.gz`、`art-vN-x2.tar.gz` | 一個倍率一個檔。最上層是 `units/<unit>/`（`<unit>.json`、`<unit>_<layer>_<k>.png`、`memory.json`，不放 `raw/`）和 `effects/`（`effects.json`、`effects_0.png`）。art-v2 起加 `buildings/`、`nodes/`；art-v3 起建築和資源點是方形斜看（D-088，說明檔有 `"view": "oblique"`）；art-v4 起加 `castle/`（城牆，D-089；發布清單寫 `"castle": true`）；art-v5 起加 `terrain/`（地形，R6-51；發布清單寫 `"terrain": true`，說明檔 `design/b1/atlas-buildings.md` 第 12 節）。art-v6 起加 `ground/`（寫實地面、水、城裡的土路，D-093；發布清單寫 `"ground": true`），城牆說明檔改成 `war-game castle 2`（說明檔第 13 節）。另有 `art-release.json`：tag、commit、來源 run、每個檔的 sha256。 |
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
| art-v5.2 | 2026-10-22 12:02 | 8a6c90b | 39774657771 | D-096：城牆四面分開、牆上的兵的站點和前片、城門四種樣子、城樓射箭 `tower_shot`、民兵投石（`spear_e`、`pike_w` 的 `sling`）；其他和 art-v5.1 相同 |
| art-v6 | 2026-10-25 07:40 | 7f5c1ba | 40173553884 | D-093 寫實整套（R8）與 D-100 主堡：12 種兵寫實（東陸弓手 `bow_e`），建築、資源點、地形寫實，主堡 `Keep` 取代 `TownTower`、加砲坊 `SiegeWorks`、射點 `shoot_at_m`；城牆 `war-game castle 2`（D-100 格局、擺設、城裡的土路）；加 `ground/`；效果加 `arrow`、`sling_stone`、`siege_*`（說明檔第 13 節） |

每一號發布後都從公開網址重新下載，`sha256sum -c SHA256SUMS` 全部 OK。

### 記憶體（2 倍，給 iPhone 記憶體檢查用）

數字取自發布檔裡各 `memory.json`：每點未壓縮 4 位元組，ASTC 4×4 每點 1 位元組。東西陸兩套都算在內，遊戲只載入用得到的那一套。

| art-v6，2 倍 | 未壓縮 RGBA8 | ASTC 4×4 |
|---|---|---|
| 兵種 12 種 | 158.8 MB | 39.7 MB |
| 建築（東陸 24.1、西陸 25.7 MB） | 49.8 MB | 12.5 MB |
| 城牆（東陸 17.6、西陸 17.9 MB） | 35.5 MB | 8.9 MB |
| 資源點 | 2.4 MB | 0.6 MB |
| 地形 | 3.9 MB | 1.0 MB |
| 地面（6 層和水，`ground/`） | 1.3 MB | 0.3 MB |
| 合計 | 251.7 MB | 62.9 MB |
| 效果（`effects_0.png`，2048×488，不在合計裡） | 4.0 MB | 1.0 MB |

- 和 art-v5.2 比：兵種 147.0 → 158.8 MB（12 種都換成寫實的兵，東陸遠程是弓手 `bow_e`）；建築 45.2 → 49.8 MB（多主堡四種樣子和砲坊，少大城箭樓）；城牆 49.0 → 35.5 MB（只剩 D-100 用到的牆片，沒有地磚，多 6 種擺設）。
- 3 倍：合計 542.2 MB 未壓縮、135.6 MB ASTC（兵種 343.9／86.0、建築 109.0／27.2、城牆 75.4／18.9、資源點 3.8／0.9、地形 7.2／1.8、地面 2.8／0.7）。

| art-v5.2，2 倍 | 未壓縮 RGBA8 | ASTC 4×4 |
|---|---|---|
| 兵種 12 種 | 147.0 MB | 36.8 MB |
| 建築（東陸、西陸各 22.6 MB） | 45.2 MB | 11.3 MB |
| 城牆（東陸 23.8、西陸 25.2 MB） | 49.0 MB | 12.2 MB |
| 資源點 | 1.6 MB | 0.4 MB |
| 地形 | 2.2 MB | 0.6 MB |
| 合計 | 245.0 MB | 61.3 MB |

- 城牆比 art-v4 大約一倍：2 倍 ASTC 東陸 3.3 → 5.95 MB、西陸 3.2 → 6.30 MB。多出來的是城門的三個狀態、四面分開的牆和前片。
- 投石讓兩種兵各多 50 張影格：2 倍 ASTC `spear_e` 2.30 → 2.70 MB、`pike_w` 2.38 → 2.87 MB。
- 如果 client 把 PNG 解成未壓縮的材質（沒有用 ASTC），手機上佔的是左欄的數字。

失敗時：
- 草稿建好了、還沒公開就失敗：會留下一個草稿，重跑會因為 tag 已存在而停下。先看失敗原因，在 Releases 頁刪掉那個草稿（草稿還沒有 tag），再重跑。
- 已經公開、核對才失敗：這個 tag 不交給 client。修好後發下一號。

本機試打包（需要 `gh` 已登入；astcenc 可省略，省略就沒有 ASTC 樣本）：

```bash
python3 design/release/pack.py --tag art-v1 --work /tmp/art --astcenc <astcenc 路徑>
```
