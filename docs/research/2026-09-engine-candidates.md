# war-game 要用哪個引擎：候選調查（spike 前）

- 日期：2026-09-30
- 負責：war-game-ceo（只做文件調查，沒有寫產品程式）。版本與引文由調查 agent 用 curl 對官方頁面逐字核對。
- 問題：使用者要做「跟世紀帝國、星海爭霸類型的手機跨平台遊戲」，目標平台是 iOS 與 Android，第一版單機對電腦 AI，
  之後可能加線上對戰。
- 實測結果（spike）由 war-game-core 補在本文第 7 節，量測程式與原始數據放在 `spikes/` 和 `docs/research/2026-09-engine-candidates/`。

## 先說結論

1. 兩個候選都做得到，實測後二選一：
   - **Godot 4.7.2（2D）**
   - **TypeScript + PixiJS 8.21 + Capacitor 8.5.2**（也就是 connect4-web2 的打包流程）
2. 兩者執行時都只畫 2D 圖片。3D 只當美術製作工具，例如先做 3D 模型再算成 2D 圖，這是世紀帝國二的做法。
   如果使用者選的畫面風格需要即時 3D，再另做一輪 3D spike（Godot 3D 對 Three.js）。
3. 不論選哪個，iOS 都要在 macOS 上建置。GitHub 的 macOS runner 做得到，repo 公開所以免費。
4. 要實測的是三件事，不只 fps：
   - 400 個單位（4 方混戰，每方 100 個）同時尋路交戰時，在手機上順不順。
   - 同一份操作紀錄在不同裝置上能不能算出一模一樣的戰局（確定性）。
   - 能不能在沒有畫面的情況下快速跑 AI 對 AI。
5. **不建議 Unity**：
   - 官方需求頁寫 Linux 編輯器要「Nvidia and AMD GPUs」，這台開發機是 Intel UHD Graphics 620（`lspci` 確認）。
   - 它以圖形編輯器為主，AI session 用文字和指令列不容易可靠地修改。

## 名詞

- **spike**：丟棄式的小實驗，用實際量到的數字來做技術選擇。
- **確定性（determinism）**：同一份操作紀錄，在每台機器上都算出完全相同的戰局。線上對戰通常靠它：各台手機只交換指令、
  各自計算，這種同步方式叫 lockstep。重播與 AI 對 AI 測試也靠它。
- **tick**：模擬前進一步。本專案固定每秒 20 步，畫面用插值補成順暢的動畫。
- **無畫面模式（headless）**：只跑遊戲規則，不畫圖。用於自動測試和大量 AI 對 AI。

## 1. 候選引擎的官方定位

### Godot 4.7.2（2026-08-18 釋出）

- **iOS**：「You must export for iOS from a computer running macOS with Xcode installed.」
  （[exporting_for_ios](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_ios.html)）
  → 要在 GitHub macOS runner 上匯出。
- **Android**：「Download and install OpenJDK 17.」Linux 上可以匯出。
  （[exporting_for_android](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_android.html)）
- **網頁版與 iOS Safari**：
  - 「Since Godot 4.3, Godot supports exporting your game on a single thread … The single-threaded export works very well on macOS and iOS too」
  - 「native Android and iOS exports will always perform better by a significant margin」
  - 來源：[exporting_for_web](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)
- **指令列**：
  - `--export-release` 會用 `export_presets.cfg` 裡的 preset 匯出。
  - 「Using the --headless command line argument is required on platforms that do not have GPU access (such as continuous integration).」
  - 來源：[command_line_tutorial](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html)
- **授權**：MIT，而且「do not apply to the content you create with it」（[license](https://godotengine.org/license/)）。

### PixiJS 8.21.0（2026-09-17 釋出）+ Capacitor 8.5.2（2026-09-11 釋出）

- **PixiJS 渲染器**：「It is recommended to use the WebGL renderer for production applications.」
  WebGPU 渲染器雖然功能完整，官方仍建議正式產品用 WebGL。
  （[renderers](https://pixijs.com/8.x/guides/components/renderers)）
- **PixiJS 手機效能**：「Passing in the option useContextAlpha: false and antialias: false … can help with performance」
  （[performance-tips](https://pixijs.com/8.x/guides/concepts/performance-tips)）
- **Capacitor 用來做遊戲**：「Capacitor is a great platform for building cross-platform games. With broad support for WebGL and canvas rendering…」
  （[guides/games](https://capacitorjs.com/docs/guides/games)）
  - Ionic 部落格舉的例子是 Vampire Survivors。
  - 官方文件沒有寫 WKWebView 裡的 WebGL 效能，所以要實測。
- **Capacitor 9**：官方預計 11 月底推出（[road-to-capacitor-9](https://ionic.io/blog/the-road-to-capacitor-9)）。spike 先用 8.5.2。
- **已知經驗**：connect4-web2 在 Capacitor 8.5.2 app 內跑 WASM 加 Web Worker，iOS 模擬器（當時從 userAgent 讀到「18.7」；iOS 26 起 userAgent 的系統版本號是凍結的，實際版本未確認）與 Android API 36 模擬器都成功。
  重算一律放 Worker，不放主執行緒，這點可以直接沿用。

## 2. 確定性：JavaScript 規格原文

出處：ECMA-262 [numbers-and-dates](https://tc39.es/ecma262/multipage/numbers-and-dates.html)、
[data types](https://tc39.es/ecma262/multipage/ecmascript-data-types-and-values.html)。

- `sin`、`cos`、`atan2`、`exp`、`log`、`pow` 等函式「is not precisely specified」。
  以 Math.sin 為例，規格只要求它「Return an implementation-approximated Number value」。`**` 運算子也一樣。
- 加法依「IEEE 754-2019 binary double-precision arithmetic」精確規定，乘法、除法同樣如此。`Math.sqrt` 也精確規定。
- **影響**：iPhone 的 JavaScriptCore 與 Android 的 V8 算三角函數時，最後幾位數可能不同，足以讓線上對戰的兩邊算出不同戰局。
  所以模擬只用整數或定點數、三角函數查表、亂數用固定種子（寫進 AGENTS.md）。
- Godot 這條路的確定性沒有做文件調查，改由 spike 直接比對雜湊。GDScript 的整數是 64 位元，整數運算不受上述問題影響。

## 3. 商店規則（App Store Review Guidelines，2026-06-08 版）

來源：[App Store Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)

- **4.1(a)**：「Don't simply copy the latest popular app on the App Store, or make some minor changes to another app's name or UI and pass it off as your own.」
- **4.2**：「Your app should include features, content, and UI that elevate it beyond a repackaged website.」
  我們是完整的遊戲，不是網站外殼。Capacitor 路線也要把遊戲打包在 app 內，不能用 `server.url` 載入遠端網站。
- **5.2.1**：「Don't use protected third-party material such as trademarks, copyrighted works, or patented ideas in your app without permission」
  → 世界觀原創（見 `docs/decisions/log.md` D-002）。

## 4. 手機上的 RTS 前例（觸控操作參考）

- **Rusted Warfare**（Corroding Games）：
  - Google Play 頁面：「Issue commands through the minimap, multi-touch support, unit groups, rally points」、
    「Zoom out to view and issue commands across the whole battlefield」。
  - 支援 Windows、Linux、iOS、Android 跨平台連線。
  - 開發者在論壇說沒用現成引擎，全部自己寫。這不是官方文件。
- **Company of Heroes 手機版**（Feral）：有指令面板與指令輪盤兩種操作。指令輪盤的用法是「select a squad then tap and hold on it」
  （[Feral FAQ](https://www.feralinteractive.com/en/faqs/companyofheroes/1.0.2/ios/)）。後來又加了讓按鈕更好點的選項。
- **Iron Marines**（Ironhide）：官方沒說用哪個引擎。工程師的個人部落格顯示是 Unity，不是官方聲明。
- **對我們的啟示**：用小地圖下指令、拉遠整個戰場、編隊、長按叫出指令，都是手機上已經驗證過的做法。GDD 的觸控操作以這些為基礎。

## 5. 替代方案

| 方案 | 結論 | 理由 |
|---|---|---|
| Unity 6.3 LTS | 不列入 | 見「先說結論」第 5 點。Personal 版營收門檻「less than $200K」，Runtime Fee 已於 2024-09-12 取消，授權本身不是問題 |
| Phaser 4.2.1 | 不列入 | 我們自己寫確定性模擬，只需要繪圖層，PixiJS 比較精簡。Phaser 4 的 WebGL 管線是 2026-04 才整個重寫的 |
| Flutter + Flame | 第一輪不列入 | cow-farm 專案在用，那邊的實測會有數字。兩個候選都不過，再把它加進來 |
| 即時 3D（Godot 3D、Three.js） | 看風格再決定 | 只有使用者選的畫面風格需要時才做 3D spike |

## 6. spike 規格與通過標準

兩個候選照同一份規格各做一次。詳細任務見 `docs/briefs/2026-10-core-engine-spike.md`。

- 176×176 格地圖（混戰地圖的大小），400 個單位，四軍同時尋路並交戰。第一版要支援 4 方混戰（D-011），所以從計畫原本的 300 個提高到 400 個。
- 觸控：點選、長按拖曳框選、單指拖曳移動畫面、雙指縮放。
- 每秒固定 20 tick。操作紀錄可以重播，每 100 tick 輸出一次狀態雜湊。
- 畫面上即時顯示 fps 和每個 tick 的模擬時間，同時寫進 log。

| 項目 | 通過標準 |
|---|---|
| iPhone 14 Pro Max 實機（使用者的手機） | 400 個單位都在畫面內交戰時，fps 中位數 ≥ 55，最慢 5% 的畫格 ≥ 30 fps，每個 tick 的模擬中位數 ≤ 5 ms |
| 無畫面模式 | 20 分鐘（24,000 tick）的 AI 對 AI，在 CI runner 上 ≤ 60 秒跑完 |
| 確定性 | 同一份紀錄在桌機無畫面、iOS 模擬器、Android 模擬器上跑，每 100 tick 的雜湊 100% 相同 |
| 自動化 | 建置、測試、匯出 iOS 與 Android，都能在 CI 用指令完成，不需要開圖形編輯器 |
| 模擬器 | 只當預檢：記錄數字，不判斷通過與否。另外記錄 app 大小與冷啟動時間 |

Godot 的實機數字用它的單執行緒網頁版在 iPhone Safari 上量，當成下限：網頁版通過就代表原生版也會通過，
依據是上面「native … will always perform better by a significant margin」這句。網頁版沒通過就無法下結論，要改用 TestFlight 再測。

**更正（2026-09-30，war-game-core 指出、ceo 查證原文）**：原本寫「GitHub Pages 不能設 COOP/COEP 標頭，所以多執行緒版跑不起來」，這不完整。Godot 網頁匯出的 PWA 選項寫：「Ensure cross-origin isolation headers are always present, even if the web server hasn't been configured to send them. This allows exports with threads enabled to work when hosted on any website」（[exporting_for_web](https://docs.godotengine.org/en/stable/tutorials/export/exporting_for_web.html)）。所以多執行緒版也能放在 Pages 上。spike 仍先用單執行緒版當下限，沒通過時再測多執行緒版。

## 7. 實測結果

- 日期：2026-09-30。負責：war-game-core。
- 程式在 `spikes/`，規則全文在 `spikes/README.md`。原始數據、實機截圖和全部樣本在 `docs/research/2026-09-engine-candidates/`，說明見該資料夾的 README。
- 兩個候選跑的是同一套模擬：TypeScript 版是參考，GDScript 版逐行移植。同一份指令紀錄在兩個引擎上算出**逐位元相同**的戰局，所以下面的速度差距是同一份工作量的差距。

### 先說結果

- **iPhone 實機**
  - PixiJS 三項全部通過：fps 中位數 58.82（標準 ≥ 55）、最慢 5% 58.82（≥ 30）、每 tick 模擬平均 0.4 ms、最大 1 ms（≤ 5 ms）。
  - Godot 無法下結論：
    - fps 量測無效，因為量測時確定性檢查也在跑，即時對局暫停了。
    - 次佳證據是面板「最近 30 秒」的每 tick 模擬中位數 5.00 ms，剛好在 5 ms 上限上。PixiJS 同一項的平均是 0.4 ms。
- **無畫面 20 分鐘 AI 對 AI**（標準 CI runner 上 ≤ 60 秒）
  - PixiJS（TypeScript）通過：15 次都在 2.16–3.43 秒，只用到上限的 6% 以內。
  - Godot 在部分 runner 上未通過：Linux runner 8 次全部過（27.7–51.9 秒）；macOS runner 6 次有 2 次超過（61.4、67.7 秒）。
  - 同一台機器上，Godot 約要 TypeScript 的 13–20 倍時間。
- **確定性**：兩個都通過。桌機無畫面、iOS 模擬器、Android 模擬器的雜湊 100% 相同，另外加測的 3 個環境也相同；兩個引擎之間也逐位元相同。
- **自動化**：兩個都能在 CI 用指令完成建置、測試與匯出。Godot 的 iOS 模擬器版只能建 x86_64、靠 Rosetta 執行。
- **模擬器**：只當預檢，不判定。PixiJS 的 app 小很多：iOS 6.0 MB 對 98.1 MB，Android 4.4 MB 對 57.1 MB。

### 結果表

| 項目 | 標準 | TypeScript + PixiJS + Capacitor | Godot 4.7.2 |
|---|---|---|---|
| 實機 fps 中位數 | ≥ 55 | **通過** 58.82 | 量測無效（和確定性檢查重疊） |
| 實機最慢 5% 的 fps | ≥ 30 | **通過** 58.82 | 量測無效 |
| 實機每 tick 模擬中位數 | ≤ 5 ms | **通過** 中位數 0 ms（計時精度 1 ms）、平均 0.4 ms、最大 1 ms | 約 5 ms：面板「最近 30 秒」中位數 5.00 ms、最大 7.00 ms（次佳證據，樣本數未知） |
| 20 分鐘 AI 對 AI，CI 無畫面 | ≤ 60 s | **通過** 2.16–3.43 s（15 次） | **在部分 runner 上未通過**：Linux 8 次 27.7–51.9 s 全過；macOS 6 次 40.8–67.7 s，2 次超過 |
| 確定性（桌機無畫面／iOS 模擬器／Android 模擬器） | 100% 相同 | **通過** | **通過**，且與 TypeScript 版逐位元相同 |
| 建置、測試、匯出全在 CI 用指令完成 | 能 | **能**（Capacitor 原生專案在 CI 產生） | **能**（iOS 模擬器只能 x86_64＋Rosetta） |

### 實機：使用者的 iPhone 14 Pro Max

- 環境：Safari 18.3.1（userAgent `iPhone OS 18_3_2`）、devicePixelRatio 3、測試頁 commit `856c45c`。
- 截圖：`docs/research/2026-09-engine-candidates/device/`。
- 量測方法：暖機 5 秒後量 30 秒，四個出生區與中央戰場都在畫面內；每 10 秒補兵，讓畫面上維持約 400 個單位。

| 數字 | PixiJS | Godot（單執行緒網頁版） |
|---|---|---|
| 結果框 | 通過 | 未通過，但**量測無效**（見下） |
| fps 中位數／最慢 5% | 58.82／58.82（1,793 幀） | 32.26／31.25（965 幀、0 tick，量測期間模擬暫停） |
| 每 tick 模擬 | 中位數 0 ms、平均 0.4 ms、最大 1 ms（600 tick） | 結果框 0 tick，無數據；面板「最近 30 秒」中位數 5.00 ms、最大 7.00 ms |
| 實機確定性 | 沒有執行 | 固定腳本對局與 CI 相同（✓）；AI 對局的結果行被 log 框裁掉，未確認 |

- **Godot 的量測為什麼無效**：log 的順序是「確定性檢查開始」→「量測開始（30 秒）」。確定性檢查和即時對局在同一個主執行緒上輪流跑，確定性檢查進行時即時對局是暫停的，所以量測期間是 0 tick，量到的是檢查占住主執行緒時的畫面。
- **每 tick 約 5 ms 的來源**：上方面板「最近 30 秒」的統計，只算即時對局的 tick。這是次佳證據：
  - 樣本數面板沒有顯示。
  - Safari 的計時器精度是 1 ms，5.00 ms 只能讀成「大約 5 ms」。
  - 同一面板的 fps（中位數 58.82、最慢 5% 31.25）那 30 秒可能包含確定性檢查的時段，所以不採用。
- **結果框和 log 對不上**：結果框寫 965 幀，log 裡那行 `measure` 寫 957 幀。同一次量測的兩個輸出不會不同，所以推論是量了兩次，兩次都和確定性檢查重疊。這是推論，未查證。
- **Godot 另一個實機數字**：確定性檢查跑固定腳本對局時，每 tick 中位數 1.000 ms（2,370 tick）。這局單位會隨交戰減少，比 400 個單位時輕。
- **要和實機放在一起看的 CI 數字**：Godot 網頁版（wasm）在 CI 的 WebKit 上，每 tick 模擬中位數 4.0 ms、最大 7.0 ms（x86 runner，run 36642203634）。和實機面板的約 5 ms 一致，都落在上限附近。
- 使用者沒有重測 Godot。

### 無畫面：20 分鐘 AI 對 AI 的全部樣本

每列是 24,000 tick 的一局，「同機 TS」是同一台機器上 TypeScript 跑同一局的秒數。runner 的機器每次不同，所以另外用 `spike-bench.yml` 一次開 5 台 Linux、3 台 macOS 補樣本。

| run | runner | CPU | Godot | Godot 每 tick 中位數 | 同機 TS |
|---|---|---|---|---|---|
| [36636173230](https://github.com/EdwardLeeee/war-game/actions/runs/36636173230) | ubuntu-latest | Intel Xeon 6973P-C | 27.67 s | 1.087 ms | 2.21 s |
| [36642203634](https://github.com/EdwardLeeee/war-game/actions/runs/36642203634) | ubuntu-latest | AMD EPYC 7763 | 51.94 s | 2.039 ms | 2.83 s |
| [36643977278](https://github.com/EdwardLeeee/war-game/actions/runs/36643977278) | ubuntu-latest | AMD EPYC 7763 | 47.70 s | 1.877 ms | 2.60 s |
| [36643681932](https://github.com/EdwardLeeee/war-game/actions/runs/36643681932) | ubuntu-latest | Intel Xeon Platinum 8370C | 41.17 s | 1.623 ms | 2.96 s |
| 36643681932 | ubuntu-latest | AMD EPYC 9V74 | 36.81 s | 1.448 ms | 2.16 s |
| 36643681932 | ubuntu-latest | AMD EPYC 9V74 | 36.99 s | 1.455 ms | 2.17 s |
| 36643681932 | ubuntu-latest | AMD EPYC 9V74 | 47.50 s | 1.868 ms | 2.79 s |
| 36643681932 | ubuntu-latest | Intel Xeon Platinum 8573C | 32.66 s | 1.281 ms | 2.59 s |
| 36636173230 | macos-latest | Apple M1（虛擬機） | **61.40 s** | 1.936 ms | |
| 36642203634 | macos-latest | Apple M1（虛擬機） | 40.85 s | 1.577 ms | |
| 36643977278 | macos-latest | Apple M1（虛擬機） | 58.15 s | 1.968 ms | |
| 36643681932 | macos-latest | Apple M1（虛擬機） | 43.31 s | 1.627 ms | 2.18 s |
| 36643681932 | macos-latest | Apple M1（虛擬機） | **67.74 s** | 2.201 ms | 3.43 s |
| 36643681932 | macos-latest | Apple M1（虛擬機） | 54.93 s | 1.705 ms | 3.25 s |

- TypeScript 另外 4 次在 [36635934301](https://github.com/EdwardLeeee/war-game/actions/runs/36635934301) 和 [36637122243](https://github.com/EdwardLeeee/war-game/actions/runs/36637122243)：Linux 2.75、2.84 s，macOS 3.29、3.28 s。全部 15 次是 2.16–3.43 s。
- macOS runner 的 Godot 那幾列（除了 bench 的 3 次）在 Godot workflow 裡沒有同機 TS，所以留空。
- 測速的 8 台上，兩個候選的最終狀態逐位元相同。在 CI 各輪裡，AI 對局的指令紀錄重播後，每個雜湊與最終狀態也都和原局相同。

### 確定性

| 環境 | TypeScript + PixiJS | Godot 4.7.2 |
|---|---|---|
| 桌機無畫面（ubuntu-latest） | 基準 | 基準 |
| iOS 模擬器（iPhone 16e，iOS 26.2） | 相同 | 相同 |
| Android 模擬器（API 36 x86_64） | 相同 | 相同 |
| macOS 無畫面（Apple M1 虛擬機） | 相同 | 相同 |
| Chromium 153 | 相同 | 相同（wasm） |
| WebKit 26.6（Playwright） | 相同 | 相同（wasm） |

- 「相同」的意思：固定腳本對局 25 個檢查點（2,370 tick 時只剩一方）、20 分鐘 AI 對局 241 個檢查點，全部相同。
- 最終雜湊是 `af824f2c` 和 `77af0e0a`，兩個引擎一樣。
- 來源：PixiJS 是 run 36635934301、36637122243；Godot 是 run 36642203634、36643977278。
- 跨引擎：TypeScript 的 AI 對局指令紀錄在 Godot 重播，241 個雜湊全部相同；兩份對局的最終狀態檔也逐位元相同。
- 實機：Godot 網頁版在 iPhone 上跑的固定腳本對局與 CI 相同（見上）。

### 模擬器與桌機瀏覽器（預檢，只記錄）

| 環境 | 候選 | fps 中位數／最慢 5% | 每 tick 模擬 | app 大小 | 冷啟動（3 次） |
|---|---|---|---|---|---|
| iOS 模擬器 | PixiJS | 58.82／37.04（1,664 幀） | 中位數 0 ms（精度 1 ms）、平均 0.37、最大 2 ms | 6.0 MB | 19.5、23.9、59.0 s |
| iOS 模擬器 | Godot | 9.96／8.56（294 幀）**不列入比較** | 中位數 5.27、最大 7.41 ms | 98.1 MB | 12.5、15.6、31.8 s |
| Android 模擬器 | PixiJS | 52.36／19.84（1,297 幀） | 中位數 0.3、最大 26.2 ms | 4.4 MB | 8.6、8.7、11.1 s |
| Android 模擬器 | Godot | 59.89／49.61（1,780 幀） | 中位數 3.99、最大 21.84 ms | 57.1 MB | 8.1、8.1、9.3 s |
| WebKit 26.6 | PixiJS | 62.5／58.82 | 中位數 0 ms（精度 1 ms）、平均 0.26 ms | | |
| WebKit 26.6 | Godot（wasm） | 41.67／37.04 | 中位數 4.0、最大 7.0 ms | | |
| Chromium 153 | PixiJS | 20.75／16.72（軟體 GPU） | 中位數 0.3 ms | | |
| Chromium 153 | Godot（wasm） | 7.37／7.04（軟體 GPU） | 中位數 4.0 ms | | |

- 數字來源：PixiJS 是 run 36635934301，Godot 是 run 36642203634。
- 冷啟動是從 `simctl launch`（iOS）或 ActivityManager 的「Start proc」（Android）到畫出第一幀、印出「SPIKE ready」的時間。
- **Godot 的 iOS 模擬器 fps 不列入比較**：
  - 官方 4.7.2 範本只能建 x86_64 版，在 Apple 晶片 runner 上要經 Rosetta 執行。
  - 而且 Godot 回報的繪圖器是 Apple Software Renderer（軟體繪圖）。
  - 同一台模擬器裡，PixiJS（WKWebView 的 WebGL）是 58.82 fps。
  - 軟體繪圖是 Rosetta、模擬器本身，還是兩者一起造成的：未查證。
- Android 模擬器和桌機瀏覽器都是軟體 GPU（Android 用 SwiftShader），fps 只是冒煙測試。

### 過程中的發現

1. **Godot 4.7.2 官方 iOS 範本的模擬器函式庫**：Info.plist 列了 arm64 和 x86_64，但在 Apple 晶片 runner（macos-26-arm64、Xcode 26.6）上連結 arm64 時，libgodot.a 裡只有 x86_64 的目的檔。所以建 x86_64 版，交給 Rosetta 執行。
2. **Godot iOS 匯出**：沒有 app 圖示、Team ID 或 bundle ID 空白都會失敗。CI 用 10 碼的假 Team ID 加上「只匯出 Xcode 專案」，再用 xcodebuild 不簽章建模擬器版。
3. **Godot Android**：
   - 啟動用的 activity 不是 `com.godot.game.GodotApp`（它沒有 exported），要用 `cmd package resolve-activity` 查。
   - SDK 和 JDK 的路徑是編輯器設定，CI 要寫 `editor_settings-4.tres`。
   - 匯出範本 1.28 GB，只解出需要的檔案，再用 cache 快取。
4. **iOS 網頁的計時器精度只有 1 ms**：每 tick 0.3–0.4 ms 的工作，中位數會顯示成 0，所以另外附上平均值。
5. **iOS 26 的 userAgent 版本號是凍結的**：模擬器實際是 iOS 26.2（Godot 原生讀到的），WKWebView 的 userAgent 卻寫 `iPhone OS 18_7`。使用者的 iPhone 是 iOS 18，版本號沒有凍結。
6. **GDScript 的速度**：同一套模擬，GDScript 約比 V8／JavaScriptCore 的 JIT 慢 13–20 倍。
7. **runner 的機器每次不同**：同一局 Godot 在 Linux runner 上是 27.7–51.9 秒，在 macOS runner 上是 40.8–67.7 秒。只看一次 CI 會誤判，所以補了多台同時測。
8. **測試頁的問題**（這次 spike 不修，記下來）：
   - 確定性檢查進行中還能按「開始量測」，應該擋住，或在結果框標示「量測無效」。
   - 左下角的 log 框超出高度後，新的行會被裁掉，應該捲到最新一行。PixiJS 頁用同樣的寫法。
   - CI 找到並修好一個 Godot 的 bug：確定性對局分段執行，最後一局剛好在一段的時間預算用完時結束的話，量測不會開始（run 36636173230 的 iOS 模擬器因此逾時）。

### 未查證

- Godot 在 iOS 模擬器上用軟體繪圖的原因。
- Godot 實機量測是不是真的量了兩次（957 幀與 965 幀）。
- Godot 實機 20 分鐘 AI 對局的確定性（結果行被 log 框裁掉）。
- Godot 原生 iOS／Android 版在實機上的效能：沒有做 TestFlight，實機只量了單執行緒網頁版。

使用者選定 TypeScript + PixiJS + Capacitor，見 `docs/decisions/log.md` D-013。

## 附錄：來源

- Godot：[download](https://godotengine.org/download/linux/)、各段連結如上
- PixiJS：[releases](https://github.com/pixijs/pixijs/releases)
- Phaser：[stable](https://phaser.io/download/stable)、[v4.0.0](https://phaser.io/download/release/v4.0.0)
- Unity：
  - [Unity 6 support](https://unity.com/releases/unity-6/support)
  - [Personal](https://unity.com/products/unity-personal)
  - [Runtime Fee 取消](https://unity.com/blog/unity-is-canceling-the-runtime-fee)
  - [系統需求](https://docs.unity3d.com/6000.3/Documentation/Manual/system-requirements.html)
  - [iOS 環境](https://docs.unity3d.com/6000.3/Documentation/Manual/ios-environment-setup.html)
- Capacitor：[games guide](https://capacitorjs.com/docs/guides/games)、[Ionic blog](https://ionic.io/blog/capacitor-everything-youve-ever-wanted-to-know)
- Rusted Warfare：[Google Play](https://play.google.com/store/apps/details?id=com.corrodinggames.rts)、
  [官網](http://corrodinggames.com/rusted_warfare)、[Steam AMA](https://steamcommunity.com/app/647960/discussions/0/2119355556476608633/)
- Company of Heroes 手機版：[App Store](https://apps.apple.com/us/app/company-of-heroes/id1464645812)
