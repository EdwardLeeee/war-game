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
- **已知經驗**：connect4-web2 在 Capacitor 8.5.2 app 內跑 WASM 加 Web Worker，iOS 18.7 模擬器與 Android API 36 模擬器都成功。
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

## 7. 實測結果

（由 war-game-core 在 spike 完成後補上：環境與版本、樣本數、中位數與最慢值、CI run 連結。）

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
