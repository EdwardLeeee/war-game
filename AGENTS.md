# war-game 專案指南

東西並存、群雄割據的中古魔法亂世，手機即時戰略遊戲（iOS／Android）。第一版是單機對電腦 AI（1 對 1，或最多 4 方混戰）。
設計以 `docs/design/gdd.md` 為準，世界觀以 `docs/world/bible.md` 為準，決策與使用者原話記在 `docs/decisions/log.md`。

## 角色與負責路徑

| 角色（session 名稱） | 負責路徑 |
|---|---|
| `war-game-ceo`（總設計師兼 CEO） | `AGENTS.md`、`README.md`、`docs/design/`、`docs/world/`、`docs/decisions/`、`docs/briefs/`、`scripts/` |
| `war-game-ui` | `design/`、`.github/workflows/design-render.yml` |
| `war-game-core` | `sim/`（遊戲規則、地圖、協定、量測工具與腳本玩家；電腦對手除外）、`.github/workflows/sim.yml`、`spikes/`、`docs/research/` 裡自己的研究筆記 |
| `war-game-ai` | 電腦對手：`sim/src/ai/ai.ts`、之後新增的 `sim/src/ai/` 電腦檔案（`scripted-player.ts` 除外）、`sim/test/ai.test.ts`、`docs/research/` 裡自己的研究筆記 |
| `war-game-client` | `client/`（畫面、觸控、介面、測試頁）、`services/game-logs/`（收對局紀錄的小程式，D-056）、`.github/workflows/client.yml`、`.github/workflows/pages.yml` |

`war-game-ai` 從 2026-10-03 起負責電腦對手（D-052）。之後再加 `war-game-mobile`（打包與上架）。
協定（`sim/src/protocol.ts`）屬於 core：電腦需要新欄位或新難度時，war-game-ai 回報 ceo，由 core 加。引擎是 TypeScript + PixiJS + Capacitor（D-013）。
一條路徑只屬於一個角色。要改別人的路徑，先回報 ceo。

## 工作流程

- 用 `scripts/dev-worktree.sh <角色> [分支]` 建立自己的 worktree（在 `../war-game-worktrees/<角色>`），
  不要在共用的 checkout 上改東西。
- 收到 brief 後，先把計畫回給 ceo（不用 plan mode）；ceo 核准後才實作。
- 做完開 PR，回報 PR 連結與 CI 結果。ceo 讀 diff、對照 brief 後用 squash 合併。
  `main` 上鎖，只能經由 PR 合併。
- 需要使用者決定的事回報 ceo，由 ceo 問使用者。使用者的裁示連同日期與原話寫進 `docs/decisions/log.md`。
- 本機只跑和改動相關的測試，完整測試交給 CI；PR 以 CI 結果為準。
- 所有 session 共用同一個 GitHub 帳號，所以 review 是流程規則，不是 GitHub 強制。

## 設計規則

- **原創**：世界觀、國家、角色、專有名詞與美術都必須原創。不用幼女戰記或其他作品、遊戲的名字與專有名詞，
  也不仿製它們的美術或介面（App Store Review Guidelines 4.1、5.2.1）。
- **畫面**：看得到的改動要先出設計稿，使用者核准後才實作。核准的設計稿就是實作規格，也是 QA 比對的基準。
- **手機實機**：模擬器與瀏覽器模擬只算預檢；最後以使用者的 iPhone 實機為準。
- **白話**：對使用者說明時用白話中文，第一次出現的術語附一句解釋。

## 模擬與 AI 規則（不論用哪個引擎）

- 模擬（遊戲規則與戰局狀態）和畫面分開，模擬要能在沒有畫面時執行，用於測試、AI 對 AI 和重播。
- **確定性**：同一份指令紀錄，在任何裝置上都要算出一模一樣的戰局。
  - 戰局狀態只用整數或定點數，不用浮點數。
  - 模擬裡不用 `Math.sin`、`cos`、`atan2`、`exp`、`log`、`pow`、`**` 這類函式。ECMA-262 對它們的規定是
    「implementation-approximated」，不同引擎可能算出不同結果。三角函數改用查表。
    加減乘除與 `sqrt` 依 IEEE 754 精確規定，可以用。
  - 亂數用固定種子的亂數產生器，不用 `Math.random` 或引擎內建的亂數。
  - 固定 tick（每秒 20 步）。畫面用插值顯示，不能回頭影響模擬。
  - 迭代順序固定（例如依單位 ID 排序），不依賴雜湊表或物件的列舉順序。
- **AI**：電腦對手跟玩家走同一套指令介面，只能看到自己視野內的資訊。某個難度如果要給加成（例如資源），
  必須寫在 GDD 裡。

## 公開 repo 規則

- repo 是公開的，但沒有開源授權，保留所有權利。不要新增 LICENSE 檔。
- 不提交金鑰、憑證、簽章檔、token、密碼。使用者的真實姓名與個資不能出現在程式、截圖、測試資料和訊息裡。
- 不提交建置產物與大型暫存檔。第三方素材必須確認可以商用，並記在 `THIRD_PARTY_NOTICES.md`。

## 文件位置

- `docs/design/gdd.md`：遊戲設計文件（GDD）
- `docs/world/bible.md`：世界觀設定
- `docs/research/<YYYY-MM>-<主題>.md`：技術研究筆記，量測程式與原始數據放在旁邊的同名資料夾
- `docs/decisions/log.md`：決策紀錄
- `docs/briefs/`：ceo 派工的 brief
