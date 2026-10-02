# 第四輪腳本玩家分析的原始數據

說明在上一層的 `2026-10-round4-scripted-analysis.md`，每個資料夾對應的版本、改動和 run 見那份文件的「資料來源」。這裡只說檔案怎麼讀。

## 資料夾

- `run-<run id>-<名稱>-<commit>/`：CI 一個 run 的腳本玩家結果，從 artifact 下載，JSON 去掉空白，內容沒改。
  - `scripted-<組>.json`：#93 的工具在 CI 固定跑的五組（`push`、`defend`、`defend-loose`、`defend-eco`、`notown`）。
  - `scripted-<變體>-<組>.json`：暫存分支的變體。變體名稱：
    - `all`：六條剋法師規則全開；`none`：全關。
    - `no<規則>`：只關這一條；`only<規則>`：只開這一條。規則：`shield`（遠程對防護罩 ×3）、`spacing`（散開維持間隔）、`ailoose`（電腦見 2 名法師就散開）、`retreat`（撤退各跑各的）、`reveal`（開砲現形）、`counter`（反擊）。
    - `no1`／`no2`／`no3`、`only1`／`only2`／`only3`：按 commit 分組（規則 1＝shield、spacing、ailoose；規則 2＝retreat；規則 3＝reveal、counter）。
    - `noE4`：只關 E4；`onlyspacingnoE4`：只開散開維持間隔、不含 E4。
    - `home`／`middle`：腳本玩家去搶自己家旁的小鎮（照常）或中間的小鎮。
  - `tournament-summary.json`、`tournament-summary-easy.json`：電腦對電腦 100 局的彙整（普通對普通、普通對簡單）。
- `local-controlled-fights/`：本機的受控小對戰，腳本和輸出。
- `local-town-owners/`：本機的城鎮主人紀錄，腳本和輸出。

## `scripted-*.json` 的欄位

- 頂層：`strategy`、`speed`、`formation`、`difficulty`、`style`、`think`、`cap`、`plan`、`games`。
- `games[]` 每一局：
  - `seed`、`style`（電腦的性格）、`result`（`won`／`lost`／`open`，open 是到第 50 分還沒分出勝負）、`endTick`（每 1,200 tick 是 1 分鐘）、`finalHash`。
  - `town`：玩家第一次拿下自己要搶的小鎮的 tick；`myMage`、`aiMage`：雙方第一名法師；`cityHit`：玩家主城第一次被打。
  - `firstMarch`、`marches`、`brokenOff`：第一次出發打電腦主城、出發幾次、撤回幾次。
  - `waves[]`：電腦打到家門口的每一波（開始、結束、最多幾名兵和法師、雙方損失、結束時主城血量）。
  - `trained.mages`：雙方練出的法師數；`cannonShots`：雙方晶砲發數。
- 只有暫存分支的 JSON 有的欄位：
  - `myMages`：我方法師 `count`（練出）、`died`、`meanLife`（死掉的平均活了幾 tick）。
  - `shieldTaken`：電腦打在我方法師防護罩上的傷害，`all`、`ranged`（其中遠程）、`rangedHalf`（遠程照 ×3/2 算會是多少）。
  - `aiMagesAtMarch`：第一次出發時電腦有幾名法師。
  - `marchLog[]`（第 2 輪以後）：每次出發的 `start`、`aiMages`、`aiSoldiers`、`mine`（我方兵：槍兵/遠程/法師）、`peakAiMages`（途中電腦最多幾名法師）、`end`、`how`（`won`／`broken` 撤回／`recalled` 被叫回家／`lost`／`open`）、`myLost`、`aiLost`。
