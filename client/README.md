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
| `game/` | 一局遊戲：接模擬的 port、收快照、把手勢變成選取和指令（`game.ts`）；測試掛鉤（`test-hook.ts`） |
| `mock/` | 假世界：跟 `sim/src/worker.ts` 同一套訊息，接上真的模擬前用來做畫面和手勢，之後留給手勢測試 |
| `view/` | 畫面知道的一切：前後兩份快照（插值用）、資源點表、迷霧、放建築格子、選取 |
| `camera/` | 螢幕與世界座標、拖曳、縮放、慣性（純計算，Node 可測） |
| `input/` | 手勢狀態機（`gestures.ts`）、點擊的意思（`intent.ts`）、瀏覽器事件接線（`pointer.ts`） |
| `render/` | PixiJS 圖層與程式畫的暫代圖形 |
| `ui/` | 手勢用到的 DOM：長按提示圈、框選框、技能輪盤、提示列、放建築的 ✓ ✗ |
| `lab/` | 量測與確定性檢查（互斥、無效標示）、log 框 |
| `tuning.ts` | 長按 350 ms、移動容許 10 px、點兩下 300 ms、慣性等參數 |

戰場目前接的是 `mock/`（`main.ts` 裡的 `new MockPort()`）；接上模擬時換成
`new Worker(new URL(".../sim/src/worker.ts", import.meta.url), { type: "module" })`，其他程式不用改。

## 網址參數

- `?test=1`：開 `window.__proto`（`commit`、`screen`、`ready`，以及 `game` 底下的選取、送出的指令、鏡頭、輪盤、放建築、格子轉螢幕座標）。一般網址沒有。
- `?test=1&tps=N`：模擬每秒跑 N 個 tick（上限 400），CI 用來加快流程。遊戲裡的速度只有慢 15、正常 20、快 30。

## e2e 怎麼模擬觸控

Playwright 沒有兩個瀏覽器都能用的多指、長按拖曳 API。`e2e/touch.ts` 在頁面裡用頁面自己的計時器送出手指會產生的
PointerEvent（`pointerType: "touch"`），進的是同一個手勢狀態機；單點另外用 `page.touchscreen.tap` 走瀏覽器真正的觸控路徑。
Chromium 在 CI 上用裝置倍率 1（沒有 GPU，倍率 3 會拖慢到手勢計時失準），WebKit 維持 iPhone 的 3。

## 檔案

- `index.html`、`src/`：原型頁。
- `site/`：Pages 首頁與第三方授權頁（整個網站的，不只原型）。
- `e2e/`、`playwright.config.ts`：Playwright 測試。
- `scripts/live-check.ts`：部署後檢查公開的網站。
- `test/`：單元測試。
