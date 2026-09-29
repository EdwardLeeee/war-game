主旨：war-game-core 做引擎 spike。Godot 4.7.2 和 TypeScript + PixiJS + Capacitor 各做一個 400 單位、4 方混戰的 RTS 小實驗，量出數字，讓使用者選引擎。

## 目標

用實際量到的數字回答三個問題：
- 兩個候選引擎，哪個能在使用者的 iPhone 上順暢跑 400 個單位的即時戰鬥？
- 哪個能保持確定性（同一份操作紀錄在每台機器上算出一模一樣的戰局）？
- 哪個能在 CI 上不開畫面，快速跑完 AI 對 AI？

## 依據

- 使用者 2026-09-30 核准的第一階段計畫：`docs/decisions/log.md` D-008。第一版要支援最多 4 方混戰（D-011），所以規模從計畫原本的 300 單位提高到 400。
- 研究筆記：`docs/research/2026-09-engine-candidates.md`，裡面有官方文件原文、版本和通過標準。
- `AGENTS.md` 的「模擬與 AI 規則」：只用整數或定點數、三角函數查表、亂數用固定種子、迭代依 ID 排序、每秒 20 tick。
- 目標實機是使用者的 iPhone 14 Pro Max。使用者沒有 Android 手機（2026-09-30），Android 只在 CI 的模擬器上預檢。
- 可參考的既有經驗（repo `EdwardLeeee/connect4-web2`，本機在 `/home/oraclelee/Desktop/connect4-web2`）：
  - Capacitor 8.5.2 app 內可以跑 WASM 和 Web Worker，iOS 18.7 模擬器與 Android API 36 模擬器都成功。
  - 重算放 Worker，不放主執行緒。曾經在主執行緒解題，iOS 畫面空白了 60 秒。
  - 驗證頁要把結果一步一步寫進 DOM 和 log，這樣卡住時 XCUITest 也讀得到做到哪裡。
  - iOS 與 Android 模擬器在 CI 上的冒煙測試，可以參考該 repo 的 `.github/workflows/ci.yml`。

## 實驗規格（兩個候選相同）

- **地圖**：
  - 176×176 格，也就是混戰地圖的大小（GDD 第 12 節），約 20% 是障礙，用固定種子產生。
  - 地形用 tile 貼圖。
- **單位**：
  - 400 個，四隊各 100。四隊都是敵人，互相攻擊。
  - 三種：近戰、遠程、快速。
  - 各有血量、攻擊力、射程、移動速度，死亡就移除。
- **尋路**：
  - 兩邊用同一種演算法，由你提案（例如 flow field，或 A* 加分群）。
  - 單位之間要有基本的避讓，不能疊在一起看不出來。
- **模擬**：
  - 每秒 20 tick，只用整數或定點數，亂數用固定種子，迭代依 ID 排序。
  - 指令紀錄的格式是 `(tick, player, command)`，要能重播。
  - 每 100 tick 輸出一次狀態雜湊：把所有單位的 ID、位置、血量算成一個雜湊值，演算法由你提案。
- **兩份測試對局**：
  - 固定腳本對局：四軍在地圖中央交戰，打到只剩一方或滿 24,000 tick。用於比對確定性。
  - 簡單 AI 對 AI：四方用同一套簡單規則，跑滿 20 分鐘（24,000 tick）。用於測無畫面的速度。
- **繪圖（暫代圖形）**：
  - 每個單位畫一張小圖加血條。
  - 移動和攻擊時每一幀換一次貼圖，模擬正式動畫的負擔。
  - 鏡頭可以拖曳和縮放，縮小時 400 個單位要能同時出現在畫面裡。
- **觸控**：點選、長按後拖曳框選、單指拖曳移動畫面、雙指縮放、點地面移動。
- **量測**：
  - 畫面上即時顯示 fps（中位數、最慢 5%）和每個 tick 的模擬時間（中位數、最大值），同時寫進 log 和 DOM。
  - 量測窗口 30 秒，期間 400 個單位都在畫面內交戰。

## 通過標準

| 項目 | 標準 |
|---|---|
| iPhone 14 Pro Max 實機 | fps 中位數 ≥ 55，最慢 5% 的畫格 ≥ 30 fps，每個 tick 的模擬中位數 ≤ 5 ms |
| 無畫面模式 | 20 分鐘 AI 對 AI 在 CI runner 上 ≤ 60 秒 |
| 確定性 | 桌機無畫面、iOS 模擬器、Android 模擬器三個環境，每 100 tick 的雜湊 100% 相同 |
| 自動化 | 建置、測試、匯出 iOS 與 Android，全部能在 CI 用指令完成，不開圖形編輯器 |
| 模擬器 | 只當預檢，記錄數字不判斷通過與否。另外記錄 app 大小與冷啟動時間 |

**Godot 的實機數字怎麼量**：
- 用 Godot 的單執行緒網頁版，在 iPhone Safari 上量，當成下限。
- 這樣做的原因：Godot 文件寫原生版「will always perform better by a significant margin」，所以網頁版通過，原生版一定也會通過。
- 更正：原本這裡寫「GitHub Pages 不能設 COOP/COEP 標頭，多執行緒版跑不起來」，這不完整。Godot 的 PWA 選項可以用 service worker 補上這些標頭（研究筆記第 6 節有原文），所以多執行緒版也能放在 Pages 上。先用單執行緒版當下限，沒通過時再測多執行緒版。
- 網頁版沒通過就無法下結論。這時回報 ceo，由 ceo 決定要不要改走 TestFlight；那需要使用者操作 App Store Connect。

## 範圍

- 要改：
  - `spikes/godot/`、`spikes/web/`
  - 只跑 spike 的 CI 工作，例如 `.github/workflows/spike-*.yml`
  - GitHub Pages 上的 spike 測試頁。用 GitHub Actions 部署 Pages，不要設定成直接發布 `main` 的 `/docs`，
    因為 `docs/` 是專案文件，不該變成網站。
  - 研究筆記第 7 節，以及原始數據資料夾 `docs/research/2026-09-engine-candidates/`
- 不做：正式遊戲程式、正式美術、GDD。spike 程式是丟棄式的，之後不直接沿用，只借用做法。

## 驗收條件

- [ ] 兩個候選都要有以下結果：
  - iPhone Safari 可以直接打開的測試頁（放在 GitHub Pages）
  - iOS 模擬器與 Android 模擬器在 CI 上的執行結果
  - 無畫面測速結果
  - 三個環境的雜湊比對結果
- [ ] Godot 的 iOS 匯出在 macOS runner 完成，Android 匯出在 ubuntu runner 完成。不需要簽章，能在模擬器上跑就好。
- [ ] 每個數字都寫明：
  - 環境：裝置、作業系統、瀏覽器或引擎版本
  - 樣本數
  - 中位數與最慢值
  - CI run 連結
- [ ] 研究筆記第 7 節有結果表和白話結論：哪個通過、哪個沒通過、差多少。
- [ ] PR 描述寫給使用者的實機測試步驟：網址、要按哪裡、要看哪個數字。由 ceo 轉給使用者。

## 限制

- 公開 repo：不放金鑰；GitHub Pages 只放 spike 測試頁。
- 不需要 Apple 簽章或 TestFlight。
- 本機只跑相關測試，iOS 與 Android 建置交給 CI。
- 要安裝的工具（Godot、匯出範本、Android SDK 等）先列在計畫裡。能在 CI 上裝的優先在 CI 上裝，本機只裝必要的。
- 這台開發機的顯示卡是 Intel UHD Graphics 620，本機不需要開 Godot 編輯器。

## 回報方式

1. 先把計畫回給 ceo（不用 plan mode），內容包括：
   - 尋路演算法
   - 雜湊方式
   - CI 工作的設計
   - GitHub Pages 的設定方式
   - 要安裝的工具
   - 先做哪個候選
   ceo 核准後才開始做。
2. 用 `scripts/dev-worktree.sh core spike/engine` 建自己的 worktree。可以分兩個 PR，一個候選一個。
3. 需要使用者在實機上測試時，把網址與步驟回報 ceo。
