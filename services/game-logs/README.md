# 對局紀錄收集（D-056）

試玩頁每打完一局，手機自動把這局的指令紀錄存起來，再上傳到使用者自己的 Cloudflare。
war-game-ai 用讀取金鑰把紀錄抓回來，重播同一局、看電腦輸在哪、統計打法，用來訓練困難電腦。
玩的人不用按任何東西，也看不到上傳的事。

- 收紀錄的程式：這個資料夾，一個 Cloudflare Worker 加一個 KV（`src/worker.ts`）。
- 手機那一半：`client/src/logs/`（存在 IndexedDB，最多 50 局；網址是 `client/src/logs/collect.ts` 的 `GAME_LOGS_URL`，部署前是空的，只存不傳）。
- 紀錄的格式和檢查：`src/record.ts`，手機和 Worker 共用。

## 一筆紀錄裡有什麼

| 欄位 | 內容 |
|---|---|
| `id` | 局編號：隨機的 UUID，同一局傳兩次只存一次 |
| `code` | 紀錄代號：8 個隨機的小寫英數字（下面說明） |
| `commit` | 遊戲版本（試玩頁開局畫面寫的那個） |
| `protocol` | 模擬的協定版本，重播要用同一版 |
| `scenario`、`difficulty` | 場景、電腦的難度 |
| `result`、`reason` | 勝負（`win`、`loss`、`draw`、重來時沒打完的 `abandoned`）和原因（`main_city`、`surrender`、`time_limit`） |
| `ticks` | 遊戲時間（每秒 20 tick） |
| `lastHash` | 這局最後一次的狀態雜湊，用來核對重播 |
| `log` | 指令紀錄：第一行是 LogHeader，之後一行一個指令（`sim/src/protocol.ts`） |

**紀錄代號**是手機第一次打開遊戲時隨機產生、存在手機上的 8 個字，開局畫面的版本號旁邊有小字寫著。
它不是帳號，也認不出是誰：沒有名字、email、裝置名稱或位置。清掉網站資料或換瀏覽器就會換一個新的。
用途是分開不同手機的紀錄：使用者把自己的代號告訴 war-game-ai，ai 就可以只用他的局。
別人打的局也收（使用者 2026-10-04：「別人的也可以，反正我會跟玩的人說」）。

存起來的局：打完的（勝、負、投降、時間到），以及按「重來」時已經打了一分鐘以上的。量測（perf）和假世界不存。

## 介面

| | 說明 |
|---|---|
| `POST /logs` | 手機上傳一筆。只收試玩頁網域（`wrangler.toml` 的 `ALLOWED_ORIGINS`）；本文是 JSON（`text/plain`，跨網域不用預檢）。201 存好；200 這局已經有了（不再寫入）；400 格式不對；403 別的網域；413 超過 2 MB；503 沒存進去（例如當天的 KV 寫入用完），手機下次再傳。 |
| `GET /logs` | 要帶 `Authorization: Bearer <讀取金鑰>`。列出摘要（沒有 `log`），一次 1,000 筆：`{ logs, cursor }`，`cursor` 不是 null 就用 `?cursor=` 拿下一頁。 |
| `GET /logs/<id>` | 要帶讀取金鑰。下載整筆紀錄。 |

沒帶金鑰或金鑰不對回 401；還沒設金鑰回 503。

## 額度和上限

- Cloudflare 免費方案：Workers 每天 10 萬次請求；KV 每天寫入 1,000 次、讀取 10 萬次，儲存 1 GB，一筆最大 25 MiB（<https://developers.cloudflare.com/kv/platform/limits/>）。
  一局只寫一次；已經有的局先讀一次就回 200，不再寫。寫入額度用完時回 503，手機下一局結束或下次打開遊戲時再傳。
- 一筆最大 2 MB。量過：時間上限 40 分鐘、電腦對電腦的局（種子 1–3）約 20 分鐘就分出勝負，指令紀錄 33–46 KB。
  人一秒下好幾個指令打滿 40 分鐘，也遠小於 2 MB。
- 手機最多留最近 50 局（已傳的也留著，舊的先刪）。

## 部署（使用者做一次）

在已經合併這個資料夾的 war-game 資料夾裡（例如 `~/Desktop/war-game`），在 Claude Code 打 `!` 加指令，一步一步做。
每一步都不會把金鑰印在畫面上。session 不替你登入，也不碰你的金鑰。

1. **裝 wrangler**（Cloudflare 的部署工具，版本釘在 `package.json`）。

   ```
   ! cd services/game-logs && npm ci
   ```

   最後會看到 `added <數字> packages`。要 Node 22 以上（`node --version` 可以查）。

2. **登入 Cloudflare**。

   ```
   ! cd services/game-logs && npx wrangler login
   ```

   瀏覽器會打開 Cloudflare 的授權頁，按「Allow」。終端機會出現 `Successfully logged in.`

3. **確認 workers.dev 子網域**。打開 Cloudflare 後台的 Workers & Pages，看右邊的「Subdomain」。
   - 還沒有就設一個。
   - 這個子網域會出現在收紀錄的網址裡，而網址會寫進公開的 repo：**不要用你的名字或 email**。已經是的話先在這裡改掉。

4. **部署**。

   ```
   ! cd services/game-logs && npx wrangler deploy
   ```

   - wrangler 會自動建一個 KV（`Provisioning LOGS (KV Namespace)...`、`Creating new KV Namespace ...`），再上傳 Worker。
   - 最後一行附近有網址：`https://war-game-logs.<你的子網域>.workers.dev`。
   - 如果 wrangler 把 KV 的 id 寫回 `wrangler.toml`（在可以互動的終端機才會），那不是金鑰，留著或丟掉都可以；之後再部署都會用同一個 KV。
   - 出現 `You need to register a workers.dev subdomain` 就回到第 3 步。

5. **產生讀取金鑰，只存在這台筆電**。

   ```
   ! mkdir -p ~/.config/war-game && chmod 700 ~/.config/war-game && (umask 077 && printf 'GAME_LOGS_READ_KEY=%s\n' "$(openssl rand -hex 32)" > ~/.config/war-game/game-logs.env)
   ```

   什麼都不會印出來。金鑰在 `~/.config/war-game/game-logs.env`，只有你讀得到。

6. **把讀取金鑰放上 Cloudflare**（從檔案讀，不經過畫面）。

   ```
   ! cd services/game-logs && . ~/.config/war-game/game-logs.env && printf %s "$GAME_LOGS_READ_KEY" | npx wrangler secret put READ_KEY
   ```

   會看到 `Creating the secret for the Worker "war-game-logs"` 和 `Success! Uploaded secret READ_KEY`。

7. **把網址記在同一個檔案**（`<你的子網域>` 換成第 4 步看到的）。

   ```
   ! echo 'GAME_LOGS_URL=https://war-game-logs.<你的子網域>.workers.dev' >> ~/.config/war-game/game-logs.env
   ```

8. **檢查**。

   ```
   ! node services/game-logs/fetch.ts
   ```

   剛部署時是 `0 records listed, 0 kept, 0 downloaded to /home/…/war-game-logs`。看到 `401` 是金鑰沒放好，回第 6 步。

9. **把網址貼給 ceo**（只貼網址，不貼金鑰）。ceo 轉給 war-game-client 填進 `GAME_LOGS_URL`，合併上線後手機才開始上傳；
   在那之前打的局已經存在手機上，上線後下次打開遊戲就會補傳。

## 給 war-game-ai：抓紀錄

```
node services/game-logs/fetch.ts [--out ~/war-game-logs] [--code ab12cd34]
```

- 從環境變數或 `~/.config/war-game/game-logs.env` 讀 `GAME_LOGS_URL`、`GAME_LOGS_READ_KEY`，不會印出金鑰。
- 把還沒抓過的紀錄存成 `<資料夾>/<id>.json`（整筆）和 `<資料夾>/<id>.jsonl`（只有指令紀錄），另外寫 `index.json`（摘要）。
  資料夾預設 `~/war-game-logs`，在 repo 外面。`--code` 只留一支手機的紀錄。
- 重播：`node sim/src/headless.ts --replay ~/war-game-logs/<id>.jsonl --out <資料夾>`。要用紀錄的 `commit` 那一版的 `sim/`；
  同一版重播到 `lastHash.tick` 的雜湊會和 `lastHash.hash` 一樣（client 的 e2e `e2e/logs.spec.ts` 每次都核對）。

## 測試

- `node --test services/game-logs/test/*.test.ts`：Worker 的格式檢查、大小上限、去重、503、讀取要金鑰、分頁，和 `fetch.ts`。
  client 的 `npm test` 會一起跑，`.github/workflows/client.yml` 在這個資料夾改動時也會跑。
- 型別檢查在 client 的 `npm run typecheck` 裡。
