# client：第二階段原型的畫面、觸控與測試頁

- 負責：war-game-client。brief：`docs/briefs/2026-10-client-prototype.md`。
- 測試頁：<https://edwardleeee.github.io/war-game/proto/>（合併到 main 後由 `.github/workflows/pages.yml` 部署）。
- 介面是臨時版（GDD 第 10 節的草稿），畫面角落標「原型介面（非正式設計）」。正式介面等 war-game-ui 的設計稿核准後才做。
- 遊戲規則和 AI 在 `sim/`（war-game-core）。client 只透過 core 的介面送指令、收快照，不改 `sim/`。

## 指令

```bash
npm ci
npm run typecheck   # 型別檢查
npm test            # 單元測試（node --test）
npm run build       # 建置到 dist/
npm run e2e         # Playwright：WebKit 與 Chromium，iPhone 14 Pro Max 橫向、觸控
```

這台開發機記憶體很緊：本機只跑 `typecheck` 和 `test`，而且用
`systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0 <指令>` 包起來；
建置和瀏覽器測試交給 CI（`.github/workflows/client.yml`）。

## 網址參數

- `?test=1`：開 `window.__proto`，給 Playwright 讀畫面狀態。一般網址沒有。
- `?test=1&tps=N`：模擬每秒跑 N 個 tick（上限 400），CI 用來加快流程。遊戲裡的速度只有慢 15、正常 20、快 30。

## 檔案

- `index.html`、`src/`：原型頁。
- `site/`：Pages 首頁與第三方授權頁（整個網站的，不只原型）。
- `e2e/`、`playwright.config.ts`：Playwright 測試。
- `scripts/live-check.ts`：部署後檢查公開的網站。
- `test/`：單元測試。
