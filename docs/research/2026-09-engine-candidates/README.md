# 引擎 spike 原始數據（2026-09-30）

研究筆記 `docs/research/2026-09-engine-candidates.md` 第 7 節的原始數據。量測程式在 `spikes/`
（PR #2：TypeScript 參考模擬與 PixiJS 候選；PR #4：Godot 候選），規則全文在 `spikes/README.md`。
整理：war-game-core。

## 1. 實機：使用者的 iPhone 14 Pro Max

- 使用者 2026-09-30 用 Safari 開 GitHub Pages 測試頁，截圖由 war-game-ceo 轉交。
- 截圖只有狀態列與測試頁。存檔前縮成一半（645 × 1398），再做無損壓縮；小字仍然清楚。
- 測試頁版本：commit `856c45c`，Pages 部署 run 36643972411。
- 環境（讀自結果框與 log）：
  - Safari 18.3.1，userAgent 是 `iPhone OS 18_3_2`。iOS 18 的 userAgent 版本號沒有凍結，所以就是實際系統版本。
  - devicePixelRatio 3。
  - viewport：PixiJS 頁 430 × 729 CSS px；Godot 頁 1290 × 2187 px（Godot 回報的是實體像素）。
- 計時器精度 1 ms：Safari 的 `performance.now()` 最小間隔是 1 ms，所以每 tick 模擬時間只能讀到整數毫秒。

### PixiJS：`device/device-iphone14promax-pixijs.png`

| 數字 | 值 |
|---|---|
| 結果框 | 通過 |
| fps 中位數 | 58.82（畫格時間中位數 17 ms） |
| 最慢 5% 的 fps | 58.82（第 95 百分位畫格時間 17 ms） |
| 每 tick 模擬 | 中位數 0 ms、最大 1 ms、平均 0.4 ms |
| 樣本 | 1,793 幀、600 tick（30 秒） |
| 當時 | tick 3,885、單位 360 |
| 確定性檢查 | 沒有執行 |

### Godot（單執行緒網頁版）：`device/device-iphone14promax-godot.png`

**這次 fps 量測無效**：量測期間，確定性檢查也在同一個主執行緒上跑，即時對局因此暫停（量測期間 0 tick）。

- log 的順序：ready → 暖機 5 秒 → 確定性檢查開始 → 量測開始（30 秒） → `game scripted 2370 ticks 2431 ms final af824f2c tick_median_ms 1.000 tick_max_ms 127.00` → `scripted ✓ 與 CI 相同` → `measure {…}`。
- 結果框的數字（無效，只記錄）：
  - 「未通過」；fps 中位數 32.26、最慢 5% 31.25。
  - 每 tick 中位數 0 ms、最大 0 ms。
  - 965 幀、0 tick。
- log 裡那行 `measure` 寫的是 **957 幀**（fps 中位數 32.26、最慢 5% 31.25，畫格時間中位數 31 ms、第 95 百分位 32 ms），跟結果框的 965 幀不同。
  - 同一次量測的兩個輸出不會不一樣，所以應該是量了兩次：log 是第一次，結果框是第二次。兩次都和確定性檢查重疊。
  - 這是推論，未查證：後面的 log 被裁掉了，見下面的「測試頁的問題」。
- 次佳證據：上方面板「最近 30 秒」的數字：
  - 每 tick 模擬中位數 5.00 ms、最大 7.00 ms。
  - fps 中位數 58.82、最慢 5% 31.25。
  - 當時 tick 1,516、單位 337。
  - 面板只統計即時對局的 tick（確定性檢查的 tick 不算），所以每 tick 的數字是即時對局的；但樣本數面板沒有顯示。
  - 計時精度 1 ms，5.00 ms 只能讀成「大約 5 ms，剛好在 ≤ 5 ms 標準的邊界上」。
  - fps 的 30 秒視窗可能包含確定性檢查的時段。
- 實機確定性：
  - 固定腳本對局：25 個檢查點與 CI 相同（✓）。
  - 20 分鐘 AI 對局：結果行被 log 框裁掉，看不到，未確認。
- 另一個實機數字：確定性檢查跑固定腳本對局時，每 tick 中位數 1.000 ms（2,370 tick，共 2,431 ms）。這局單位會隨交戰減少，所以比 400 個單位時輕。

### 測試頁的問題（這次 spike 不修，記下來）

1. 確定性檢查進行中仍然可以按「開始量測」，量到的是模擬暫停時的畫面。應該擋住，或在結果框標示「量測無效」。
2. 左下角的 log 框只顯示最前面的行，超出高度的新行會被裁掉，應該改成捲到最新一行。PixiJS 頁用的是同樣的寫法，這次內容短沒遇到。

## 2. CI（GitHub Actions，EdwardLeeee/war-game）

| run | workflow | 觸發 | commit | 結果 | 內容 |
|---|---|---|---|---|---|
| 36635934301 | Spike Web | push spike/engine | 42e26cd | 成功 | PixiJS：無畫面、Chromium／WebKit、Android 模擬器、iOS 模擬器、雜湊比對 |
| 36637122243 | Spike Web | pull_request #2 | bc823bf | 成功 | 同上 |
| 36636173230 | Spike Godot | push spike/engine-godot | c98cfec | 失敗（iOS 模擬器那一步） | Godot 全套；失敗原因是確定性分段結束的 bug，雜湊全部相同 |
| 36642203634 | Spike Godot | push spike/engine-godot | 208838e | 成功 | Godot 全套（修好 bug 後） |
| 36643977278 | Spike Godot | pull_request #4 | 856c45c | 成功 | 同上 |
| 36643681932 | Spike Bench | push spike/engine-godot | ea59206 | 成功 | 5 台 Linux、3 台 macOS 各跑兩個候選的 20 分鐘 AI 對局 |
| 36643972504 | Spike Live Check | push spike/engine-godot | 856c45c | 成功 | WebKit、iPhone 尺寸走一次使用者的測試步驟（只證明步驟可行） |

模擬器環境：
- iOS：iPhone 16e 模擬器、iOS 26.2（macos-26-arm64 映像 20260907.0351.1、Xcode 26.6）。
  - WKWebView 的 userAgent 寫 `iPhone OS 18_7`，那是 iOS 26 凍結的版本號，不是實際系統版本。
- Android：API 36 x86_64 模擬器（`sdk_gphone64_x86_64`、Android 16），用軟體 GPU（SwiftShader）。

## 3. 20 分鐘 AI 對 AI，無畫面，全部樣本

標準：CI runner 上 ≤ 60 s。每列是 24,000 tick 的一局。

- 「同機 TS」：同一台機器上跑同一局 TypeScript 的秒數。
- Godot 工作裡的 `ts-reference` 和 Godot 跑在同一台機器；macOS 那幾列在 Godot workflow 裡沒有跑 TS，所以留空。

| run | 位置 | CPU | Godot | Godot 每 tick 中位數 | 同機 TS |
|---|---|---|---|---|---|
| 36636173230 | Linux | Intel Xeon 6973P-C | 27.67 s | 1.087 ms | 2.21 s |
| 36642203634 | Linux | AMD EPYC 7763 | 51.94 s | 2.039 ms | 2.83 s |
| 36643977278 | Linux | AMD EPYC 7763 | 47.70 s | 1.877 ms | 2.60 s |
| 36643681932 | Linux | Intel Xeon Platinum 8370C | 41.17 s | 1.623 ms | 2.96 s |
| 36643681932 | Linux | AMD EPYC 9V74 | 36.81 s | 1.448 ms | 2.16 s |
| 36643681932 | Linux | AMD EPYC 9V74 | 36.99 s | 1.455 ms | 2.17 s |
| 36643681932 | Linux | AMD EPYC 9V74 | 47.50 s | 1.868 ms | 2.79 s |
| 36643681932 | Linux | Intel Xeon Platinum 8573C | 32.66 s | 1.281 ms | 2.59 s |
| 36636173230 | macOS | Apple M1（虛擬機） | **61.40 s** | 1.936 ms | |
| 36642203634 | macOS | Apple M1（虛擬機） | 40.85 s | 1.577 ms | |
| 36643977278 | macOS | Apple M1（虛擬機） | 58.15 s | 1.968 ms | |
| 36643681932 | macOS | Apple M1（虛擬機） | 43.31 s | 1.627 ms | 2.18 s |
| 36643681932 | macOS | Apple M1（虛擬機） | **67.74 s** | 2.201 ms | 3.43 s |
| 36643681932 | macOS | Apple M1（虛擬機） | 54.93 s | 1.705 ms | 3.25 s |

- Godot：Linux 8 次全部 ≤ 60 s（27.7–51.9 s）；macOS 6 次有 2 次超過（61.4、67.7 s）。所以是「在部分 runner 上未通過」。
- TypeScript：全部 15 次都在 2.16–3.43 s。其中 4 次不在上表：Spike Web 兩輪各有一次 Linux、一次 macOS 的單獨執行（2.75、3.29、2.84、3.28 s）。
- 同一台機器上，Godot 約是 TypeScript 的 13–20 倍時間。
- 每一台上兩個候選的最終狀態都相同。

## 4. 檔案

- `device/`：實機截圖。
- `ai-commands.typescript.jsonl`、`ai-commands.godot.jsonl`：20 分鐘 AI 對局的指令紀錄，480 道指令。
  - 兩份解析後內容完全相同，只是 JSON 欄位順序不一樣（Godot 會把鍵排序）。
  - 各輪 CI 產生的 13 份，各自跟這兩份之一逐位元相同。
- `ci/run-<run id>/<artifact>/`：各輪 CI 產物的節錄（完整產物在 Actions 上保留 30–90 天）。
  - `*.hashes.txt`：每 100 tick 一行，格式是「tick 雜湊 單位數」。
  - `*.timing.json`：無畫面執行的環境、總時間與每 tick 統計。
  - `state.sha256`：最終狀態檔的 sha256。
  - `cpu.txt`：runner 的 CPU。
  - `spike.txt`：模擬器或瀏覽器裡印出的全部 `SPIKE` 行，包含雜湊、量測與環境。
  - `size.txt`、`coldstart.txt`、`device.txt`、`am-start-*.txt`：app 大小、三次冷啟動、裝置資訊。
  - `report*.json`：雜湊比對報告，由 `spikes/tools/report.mjs` 產生。
  - `web.txt`、`godot.txt`：Live Check 的結果框文字。
