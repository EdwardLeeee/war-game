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
| `game/` | 一局遊戲：接模擬 Worker（`port.ts`）、收快照、把手勢變成選取和指令、暫停與速度、自動暫停（`game.ts`）；測試掛鉤（`test-hook.ts`） |
| `mock/` | 假世界：跟 `sim/src/worker.ts` 同一套訊息，版面固定，給手勢測試用（`?test=1&mock=1`） |
| `view/` | 畫面知道的一切：前後兩份快照（插值用）、資源點表、迷霧、放建築格子、選取 |
| `camera/` | 螢幕與世界座標、拖曳、縮放、慣性（純計算，Node 可測） |
| `input/` | 手勢狀態機（`gestures.ts`）、點擊的意思（`intent.ts`）、瀏覽器事件接線（`pointer.ts`） |
| `render/` | PixiJS 圖層與程式畫的暫代圖形 |
| `ui/` | DOM 介面：右上的速度與暫停（`controls.ts`）；手勢用到的長按提示圈、框選框、技能輪盤、提示列、放建築的 ✓ ✗ |
| `lab/` | 量測與確定性檢查（互斥、無效標示、對照 CI 雜湊）、log 框 |
| `tuning.ts` | 長按 350 ms、移動容許 10 px、點兩下 300 ms、慣性等參數 |

戰場接的是 core 的模擬 Worker（`game/port.ts` 的 `createSimPort`，Vite 把 `sim/src/worker.ts` 打包成獨立檔案）。
確定性檢查另開一個 Worker 跑同一局 AI 對 AI，逐一比對建置時用 `scripts/expected-hashes.sh`
（core 的 `sim/src/headless.ts --expected`）寫進 `dist/expected-hashes.json` 的雜湊。

## 網址參數

- `?test=1`：開 `window.__proto`（`commit`、`screen`、`ready`，以及 `game` 底下的選取、送出的指令、表頭、鏡頭、輪盤、放建築、格子轉螢幕座標、確定性檢查結果）。一般網址沒有。
- `?test=1&tps=N`：模擬每秒跑 N 個 tick（上限 400），CI 用來加快流程。遊戲裡的速度只有慢 15、正常 20、快 30。
- `?test=1&mock=1`：用假世界代替模擬（手勢測試用）。

## e2e 怎麼模擬觸控

Playwright 沒有兩個瀏覽器都能用的多指、長按拖曳 API。`e2e/touch.ts` 在頁面裡用頁面自己的計時器送出手指會產生的
PointerEvent（`pointerType: "touch"`），進的是同一個手勢狀態機；單點另外用 `page.touchscreen.tap` 走瀏覽器真正的觸控路徑。
Chromium 在 CI 上用裝置倍率 1（沒有 GPU，倍率 3 會拖慢到手勢計時失準），WebKit 維持 iPhone 的 3。

## 檔案

- `index.html`、`src/`：原型頁。
- `site/`：Pages 首頁與第三方授權頁（整個網站的，不只原型）。
- `e2e/`、`playwright.config.ts`：Playwright 測試。
- `scripts/live-check.ts`：部署後檢查公開的網站。
- `scripts/expected-hashes.sh`：產生確定性檢查的對照檔。
- `test/`：單元測試。
