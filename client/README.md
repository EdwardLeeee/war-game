# client：第二階段原型的畫面、觸控與測試頁

- 負責：war-game-client。brief：`docs/briefs/2026-10-client-prototype.md`。
- 測試頁：<https://edwardleeee.github.io/war-game/proto/>（合併到 main 後由 `.github/workflows/pages.yml` 部署）。
- 介面是臨時版（GDD 第 10 節的草稿），畫面角落標「原型介面（非正式設計）」。正式介面等 war-game-ui 的設計稿核准後才做。
- 遊戲規則和 AI 在 `sim/`（war-game-core）。client 只透過 `sim/PROTOCOL.md` 的 Worker 訊息送指令、收快照，不改 `sim/`。

## 指令

```bash
npm ci
npm run typecheck   # 型別檢查（連 sim/ 的型別一起）
npm test            # 單元測試（node --test）：手勢表每一列、鏡頭、量測互斥
npm run build       # 建置到 dist/
npm run e2e         # Playwright：WebKit 與 Chromium，iPhone 14 Pro Max 橫向、觸控
```

這台開發機記憶體很緊：本機只跑 `typecheck`、`test`，必要時跑一次 `build`，都用
`systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 <指令>` 包起來；
瀏覽器測試交給 CI（`.github/workflows/client.yml`）。

## 程式架構（`src/`）

| 資料夾 | 內容 |
|---|---|
| `sim.ts` | 唯一從 `sim/` 匯入的地方（`protocol.ts`、`placement.ts`） |
| `game/` | 一局遊戲：接模擬 Worker（`port.ts`）、收快照、把手勢變成選取和指令、暫停與速度、自動暫停（`game.ts`）；留守、編隊與自動補兵的名單（`army.ts`，純邏輯，D-026）；測試掛鉤（`test-hook.ts`） |
| `mock/` | 假世界：跟 `sim/src/worker.ts` 同一套訊息，版面固定，給手勢測試用（`?test=1&mock=1`） |
| `view/` | 畫面知道的一切：前後兩份快照（插值用）、資源點表、迷霧、放建築格子、選取 |
| `camera/` | 螢幕與世界座標、拖曳、縮放、慣性（純計算，Node 可測） |
| `input/` | 手勢狀態機（`gestures.ts`）、點擊的意思（`intent.ts`）、瀏覽器事件接線（`pointer.ts`）、介面按鈕的點／點兩下／長按（`pressable.ts`，同一個狀態機）、分出 N 名挑哪幾名（`split.ts`） |
| `render/` | PixiJS 圖層與程式畫的暫代圖形 |
| `ui/` | DOM 介面：右上的速度與暫停（`controls.ts`）；手勢用到的長按提示圈、框選框、技能輪盤、提示列、放建築的 ✓ ✗、被拒原因（`overlays.ts`） |
| `ui/hud/` | 介面外殼（臨時版）：`hud.ts`（編隊、全軍（寫會選到幾名）、閒置、全體回城、被攻擊箭頭、經濟分配、搶或治理、選單、勝負）、`panels.ts`（資源列（最後是遊戲時間）、選取資訊、指令區）、`minimap.ts`、`names.ts`（顯示用名稱）、`economy-ratio.ts` |
| `lab/` | 量測與確定性檢查（互斥、無效標示、對照 CI 雜湊）、log 框 |
| `tuning.ts` | 長按 350 ms、移動容許 10 px、點兩下 300 ms、慣性等參數 |
| `difficulty.ts` | 開局畫面的難度：第一次是簡單，之後記住這台手機上次選的；讀寫瀏覽器儲存空間失敗時當成沒存過（D-024） |

戰場接的是 core 的模擬 Worker（`game/port.ts` 的 `createSimPort`，Vite 把 `sim/src/worker.ts` 打包成獨立檔案）。
確定性檢查另開一個 Worker 跑同一局 AI 對 AI，逐一比對建置時用 `scripts/expected-hashes.sh`
（core 的 `sim/src/headless.ts --expected`）寫進 `dist/expected-hashes.json` 的雜湊。

## 網址參數

- `?test=1`：開 `window.__proto`（`commit`、`screen`、`ready`，以及 `game` 底下的選取、送出的指令、表頭、鏡頭、輪盤、放建築、格子轉螢幕座標、確定性檢查結果）。一般網址沒有。
- `?test=1&tps=N`：模擬每秒跑 N 個 tick（上限 400），CI 用來加快流程。遊戲裡的速度只有慢 20、正常 30、快 40（D-024）。
- `?test=1&mock=1`：用假世界代替模擬（`e2e/gestures.spec.ts`、`e2e/hud.spec.ts` 用；版面固定）。
- `?test=1&hint=1`：開局提示（D-044）。玩家的頁面每局都有；測試頁預設沒有，其他測試直接進戰場。
- `?test=1&ai=0`：對手不由電腦操作，單位站著不動。`e2e/main-flow.spec.ts` 用，免得電腦先搶走小鎮或打掉主城；電腦的行為由 core 的 AI 對打測試。量測一律有電腦。

開局畫面選難度（簡單／普通）。玩家的對局沒有時間上限（`init` 的 `maxTicks: 0`），電腦照選的難度下（D-024）。

量測與確定性檢查在「選單 → 量測與確定性檢查」。「開始量測」會開一局 `perf` 場景（所有系統都開著），鏡頭對準交戰部隊，暖機 5 秒後量 30 秒。量測一律用普通、30 分鐘上限，確定性檢查照 CI 的那一局，都不受開局畫面的難度影響。結果和 log 會附上手機的貼圖上限（最大貼圖、一次繪製幾張、有沒有 ASTC），給精靈圖集用。

## 開局提示（D-044）

- 每一局開始時（「重來」也算，「繼續這局」和量測不算）跳出「魔晶從城鎮來」：法師要用魔晶、魔晶主要從城鎮來、搶和治理各得到什麼、離主城最近的小鎮在哪個方向和幾格遠。遊戲在提示開著時暫停。
- 指的是離自己出生點最近的小鎮：大城比較近也一樣，免得新手先去打民兵多、有箭樓的大城（ceo）。地圖上沒有小鎮時才指最近的大城。一樣近挑編號小的（`src/game/town-hint.ts` 的 `hintTown`），不寫死編號。core 在主城附近加小鎮後，自動變成那一座。
- 小地圖在提示開著時和關掉後 10 秒，用魔晶的青色圈閃那座城鎮；「看那座城鎮」會把鏡頭移過去。
- 「不再提示」記在這台裝置上，記法和難度一樣（`localStorage` 的 `war-game.proto.townHint`，`src/hint-pref.ts`），之後開局不再自動跳。瀏覽器不給存時（無痕、封鎖網站資料）照樣提示。「知道了」「看那座城鎮」不算，下一局還會提示。
- 「選單 → 魔晶怎麼拿」隨時打開同一個提示，一樣暫停。已經按過不再提示時，那一顆改寫「開局時要提示」，按了就恢復。
- 對局中途打開時，指的是最近、可以攻下的小鎮：中立的、對手的、還沒探索過的都算；自己的和廢墟不算（廢墟要等變回中立才有東西拿）。跳過了比較近的小鎮時，寫「離你的主城最近、可以攻下的小鎮」。小鎮都是自己的（或廢墟）時，照舊指最近的小鎮（ceo）。開局時城鎮都是中立的，所以就是最近的小鎮。

## 離民兵太近（D-044）

- 放建築時，預覽落在還有民兵的中立城鎮附近，提示列多一行「這裡離城鎮的民兵太近，去蓋的農民會被攻擊」。只警告，✓ 照樣能按（`src/game/militia.ts`）。
- 附近：建築占地的中心到城鎮那一格的中心不超過 12 格，剛好 12 格也算；和 core 的電腦蓋建築時保持的距離一樣（`sim/src/ai/ai.ts` 的 `TOWN_CLEARANCE`）。core 把它搬到 `rules.ts` 之後，改成直接讀。
- 城鎮的狀態和民兵數照快照（在霧裡就是最後看到的樣子）：民兵都倒了、被自己或對手拿下、變成廢墟，都不警告。還沒探索過的城鎮照開局的樣子算（中立、有民兵），照樣警告。

## 加到主畫面（D-042）

- iPhone 的 Safari 用「加入主畫面」、或筆電的 Chrome 安裝之後，從圖示打開沒有網址列。名稱 `war-game` 和晶體圖示是暫時的（GDD 第 16 節）。
- 不用 service worker，什麼都不快取：常常部署，快取會讓人一直開到舊版。
- 建置時多一個 `version.json`（只有 commit）。頁面打開、從背景回來時繞過快取讀它，和自己的 commit 不同就在開局畫面顯示「有新版本」和「更新」。「更新」換到加上 `v=<新的 commit>` 的網址（其他參數保留），新網址不會拿到快取裡的舊 `index.html`；對局中只提示一次，不重新載入（`src/version.ts`）。

## e2e 怎麼模擬觸控

Playwright 沒有兩個瀏覽器都能用的多指、長按拖曳 API。`e2e/touch.ts` 在頁面裡用頁面自己的計時器送出手指會產生的
PointerEvent（`pointerType: "touch"`），進的是同一個手勢狀態機；單點另外用 `page.touchscreen.tap` 走瀏覽器真正的觸控路徑。
Chromium 在 CI 上用裝置倍率 1（沒有 GPU，倍率 3 會拖慢到手勢計時失準），WebKit 維持 iPhone 的 3。

## 檔案

- `index.html`、`src/`：原型頁。
- `site/`：Pages 首頁與第三方授權頁（整個網站的，不只原型）。
- `e2e/`、`playwright.config.ts`：Playwright 測試。
- `docs/`：client 的規格文件，例如兵種精靈圖集規格 `docs/sprite-atlas.md`。只改這裡不會觸發 CI 和 Pages 部署。
- `scripts/live-check.ts`：部署後檢查公開的網站（含 `version.json` 和 manifest）。
- `public/`：原樣複製到建置結果：`manifest.webmanifest` 和 `icons/`（加到主畫面用，D-042）。
- `scripts/icons.py`：畫暫時的主畫面圖示（`public/icons/` 的 SVG 和 180、192、512 的 PNG；要 Pillow，產出的檔案有進 repo，CI 不跑它）。
- `scripts/expected-hashes.sh`：產生確定性檢查的對照檔。
- `test/`：單元測試。

<!-- 暫時：確認只改 .md 不觸發 Pages 和 Client（#101），不合併 -->
