# 模擬與畫面之間的介面（PROTOCOL_VERSION 1）

`sim/`（war-game-core）和 `client/`（war-game-client）之間的契約。型別、列舉、欄位順序都在
`sim/src/protocol.ts`，client 直接 import，所以兩邊對不上時編譯就會失敗。這份文件用白話說明每一項。

## 0. 規則

- **版本**：`PROTOCOL_VERSION`。只要 client 需要跟著改，就遞增版本。
- **改格式的流程**：core 通知 war-game-ceo，由 ceo 轉給 war-game-client。client 有需求也先回報 ceo。
- **所有權**：`sim/src/protocol.ts`、`sim/PROTOCOL.md`、`sim/src/worker.ts`、`sim/src/placement.ts` 都屬於 war-game-core。
- **分階段填值**：原型的所有欄位、事件和指令，這一版都已經定義好了。
  - 標「PR-n 起」的欄位，在那個 PR 之前是 0 或 -1，指令會被拒絕（原因碼 `NotAvailable`）。
  - 補上這些值不算改格式。
- **怎麼用 sim**：
  - `sim/` 是獨立的套件，沒有建置步驟。
  - client 用相對路徑或 Vite alias 匯入 `sim/src/protocol.ts` 和 `sim/src/placement.ts`，再用
    `new Worker(new URL("<到 sim/src/worker.ts 的路徑>", import.meta.url), { type: "module" })` 開模擬。
  - Vite 需要的 `server.fs.allow` 由 client 在自己的設定裡處理。

## 1. 時間與座標

| 名稱 | 值 | 說明 |
|---|---|---|
| `TICKS_PER_SECOND` | 20 | 模擬每秒 20 步 |
| `CELL` | 1024 | 1 格 = 1024 定點單位。快照裡的位置 `x`、`y` 都是定點 |
| `CELL_SHIFT` | 10 | 格子 = 定點 >> 10 |
| `DIRECTIONS` | 16 | 朝向 k × 22.5°，0 = 東（+x），y 向下，所以順時針 |
| `HASH_EVERY` | 100 | 每 100 tick（含 tick 0）發一次狀態雜湊 |
| `FOG_EVERY` | 5 | 每 5 tick 重算並送出一次戰爭迷霧 |
| `MAX_TICKS` | 36,000 | 30 分鐘還沒分出勝負就是平手 |
| `STEP_BATCH` | 20 | 表頭附上最近 20 tick 的模擬時間總和 |

- **格子座標**：`cellX = x >> 10`。格子中心的定點值是 `cellX * 1024 + 512`。
- **格子編號**：`y * size + x`，也就是一列一列排。

玩家：
- 0 和 1 是對戰的兩方。
- `NEUTRAL = 2` 是城鎮的民兵與箭樓。
- `NO_OWNER = -1` 是「沒有人」。

## 2. 開局的靜態資料（`ready` 訊息）

- `map: MapInfo`
  - `size`：96。
  - `terrain`：`size * size` 個 `Terrain`，0 可走、1 不可走。
    - 樹不算地形，是資源點；樹會擋路，砍完後變成可走。
  - `spawns`：兩個出生點。
  - `towns`：城鎮的 id、大小、中心格與判定半徑。
  - 這些都是地圖知識，雙方和 AI 一樣知道。
  - 資源點不在這裡，探索到以後才會出現在快照的 `nodes`。
- `rules: Rules`：兵種與建築的資料表，client 顯示花費、血量、占地、視野、射程時用這份，不要自己抄數值。
  - `units`：血量、防護罩、攻擊、射程（定點）、速度（每 tick 定點）、視野（格）、攻擊間隔（tick）、花費、訓練 tick、人口。
  - `buildings`：血量、占地邊長、能不能走過、花費、建造 tick、視野、人口上限、可以存放哪些資源、可以訓練哪些兵、全體回城時能躲幾名農民。
  - `multipliers`：剋制加成。`target` 是兵種或 `"shield"`；傷害 × num / den，全部整數運算。
  - `mageCap`（6）、`maxPopulation`（120）、`queueMax`（每棟建築的訓練佇列上限）。

## 3. 指令

一行一個 JSON 物件，也就是指令紀錄（JSONL）裡的一行。

- client 送 `{ type: "command", cmd }`，`cmd` 只含下面的欄位加上 `seq`（client 自己編的序號）。
- `t`（在哪個 tick 執行）和 `p`（哪位玩家）由 Worker 蓋上。
  - `t` 是「下一個還沒跑的 tick」。暫停時收到的指令，恢復後就在下一個 tick 執行。
- 指令在它的 tick 開頭套用，並驗證擁有者、花費、人口、上限。
  - 不合格就不執行，回傳事件 `rejected { seq, reason }`。
  - 被拒的指令也照樣寫進紀錄，重播時才會完全一致。

| `c` | 欄位 | 說明 | 從 |
|---|---|---|---|
| `move` | `u`、`x`、`y` | 前進到格子 (x, y)，路上遇到敵人會打。一起下指令的部隊等最慢的，抵達後近戰在前、遠程在後 | PR-2 |
| `retreat` | `u`、`x`、`y` | 撤退：不理會敵人，直接走 | PR-2 |
| `attack` | `u`、`target` | 集中攻擊某個單位或建築（單位和建築共用 id） | PR-2 |
| `stop` | `u` | 停下，清掉指令 | PR-2 |
| `stance` | `u`、`stance` | `Aggressive`：會追擊附近的敵人，但不會追太遠；`Hold`：原地不動，只打射程內的 | PR-2 |
| `gather` | `u`、`node` | 農民去採某個資源點。晶脈只能用這個指令派 | PR-3 |
| `build` | `u`、`type`、`x`、`y` | 在左上角格子 (x, y) 放一棟建築並派這些農民去蓋。花費在放下時扣 | PR-3 |
| `repair` | `u`、`building` | 修理（不花資源，每名農民每秒 5 點） | PR-3 |
| `train` | `building`、`type`、`n` | 排 n 個訓練。花費在排入時扣 | PR-3 |
| `cancel_train` | `building`、`index` | 取消佇列第 index 個，退回花費 | PR-3 |
| `rally` | `building`、`x`、`y` | 集結點（格子） | PR-3 |
| `eco_ratio` | `food`、`wood`、`gold`、`on` | 經濟分配的比例（百分比，加起來 100）與開關 | PR-3 |
| `recall` | `on` | 全體回城（`true`）或回去工作（`false`），是同一個指令 | PR-3 |
| `cast` | `u`、`fx`、`fy` | 一名法師對定點位置發晶砲：原地校準 1.5 秒，期間出現預警區 | PR-4 |
| `autocast` | `u`、`on` | 法師的自動施放開關 | PR-4 |
| `town_choice` | `town`、`choice` | 攻下的城鎮選搶（0）或治理（1） | PR-4 |
| `surrender` | — | 投降 | PR-4 |

**被拒的原因碼**（`Reject`）：

| 碼 | 名稱 | 意思 |
|---|---|---|
| 1 | `NotOwner` | 不是你的單位或建築 |
| 2 | `InvalidTarget` | 目標不存在或不能當目標 |
| 3 | `CannotAfford` | 資源不夠 |
| 4 | `PopulationCap` | 人口已滿 |
| 5 | `MageCap` | 法師已達上限 6 名 |
| 6 | `NoCrystal` | 魔晶不夠一發晶砲（5） |
| 7 | `Cooldown` | 晶砲還在冷卻 |
| 8 | `BadPlacement` | 這裡不能蓋，判定見第 7 節 |
| 9 | `QueueFull` | 訓練佇列已滿 |
| 10 | `NotAvailable` | 這棟建築不訓練這種兵、這個單位不能做這件事，或這個功能還沒實作 |
| 11 | `TownNotYours` | 不是你攻下的城鎮 |
| 12 | `TownChoiceMade` | 這座城鎮已經選過了 |
| 13 | `GameOver` | 這局已經結束 |
| 14 | `OutOfRange` | 晶砲的目標超出射程 |

## 4. 快照（`snapshot` 訊息，每個 tick 一份）

內容是人類玩家的視角，也就是 PlayerView，跟 AI 讀的是同一套規則：
- 自己的東西全部都有。
- 敵方與中立的單位，只有站在看得到的格子上才會出現。
- 敵方建築：看得到的是現況，看不到的是記憶中最後一次看到的樣子。

所有 typed array 都用 transferable 傳，client 收到後直接擁有。各表都是 `Int32Array`，每列固定長度（stride），依 id 由小到大排列。

### 4.1 表頭 `header`（長度 `HEADER_LENGTH` = 21）

| 欄 | 名稱 | 說明 | 從 |
|---|---|---|---|
| 0 | `tick` | 這份快照是哪一個 tick 跑完的結果 | PR-2 |
| 1 | `paused` | 1 = 暫停中 | PR-2 |
| 2 | `speed` | 每秒 tick 數 × 100（正常是 2000） | PR-2 |
| 3 | `gameState` | `GameState`：進行中、贏、輸、平手 | PR-2 |
| 4–7 | `food`、`wood`、`gold`、`crystal` | 資源 | PR-3 |
| 8–9 | `population`、`populationCap` | 人口與上限 | PR-3 |
| 10–11 | `mages`、`mageCap` | 法師數與上限 | PR-4 |
| 12–15 | `ratioFood`、`ratioWood`、`ratioGold`、`ratioOn` | 經濟分配的比例與開關 | PR-3 |
| 16 | `recall` | 全體回城中 = 1 | PR-3 |
| 17 | `stepMicros` | 這個 tick 的模擬時間（微秒） | PR-2 |
| 18 | `stepBatchMicros` | 最近 20 tick 的總和。iOS 計時精度只有 1 ms，要算平均請用這個 | PR-2 |
| 19 | `fogTick` | 最近一次迷霧更新的 tick | PR-2 |
| 20 | `scenario` | `Scenario` | PR-2 |

### 4.2 單位 `units`（stride `UNIT_STRIDE` = 20）

| 欄 | 名稱 | 說明 | 從 |
|---|---|---|---|
| 0 | `id` | 單位與建築共用 id | PR-2 |
| 1 | `owner` | 0、1 或 `NEUTRAL` | PR-2 |
| 2 | `type` | `UnitType` | PR-2 |
| 3–4 | `x`、`y` | 定點位置 | PR-2 |
| 5 | `hp` | 生命（上限見 `rules`） | PR-2 |
| 6 | `shield` | 法師的防護罩剩多少 | PR-4 |
| 7 | `action` | `Action`，動畫用：待命、走、攻擊、採集、蓋、修、校準、躲在建築裡（不畫） | PR-2 |
| 8 | `facing` | 0–15 | PR-2 |
| 9–10 | `carryKind`、`carryAmount` | 搬運中的資源（`Resource`）與數量；沒有搬就是 -1、0 | PR-3 |
| 11 | `order` | `Order`，目前的指令 | PR-2 |
| 12 | `orderTarget` | 目標 id、資源點 id，或 move／retreat 的目的格編號；沒有就是 -1 | PR-2 |
| 13 | `stance` | `Stance` | PR-2 |
| 14 | `castProgress` | 晶砲已經校準幾個 tick（30 = 發射） | PR-4 |
| 15 | `flags` | `UnitFlag`：1 自動施放、2 閒置農民、4 最近 60 tick 內受過傷 | PR-2（2 從 PR-3、1 從 PR-4） |
| 16 | `castCooldown` | 晶砲還要冷卻幾個 tick | PR-4 |
| 17–19 | 保留 | 0 | — |

### 4.3 建築 `buildings`（stride `BUILDING_STRIDE` = 16）

| 欄 | 名稱 | 說明 | 從 |
|---|---|---|---|
| 0 | `id` | | PR-2 |
| 1 | `owner` | | PR-2 |
| 2 | `type` | `BuildingType` | PR-2 |
| 3–4 | `cellX`、`cellY` | 占地的左上角格子 | PR-2 |
| 5 | `hp` | 記憶中的建築是最後看到的血量 | PR-2 |
| 6 | `progress` | 建造進度（千分比，1000 = 完成） | PR-3 |
| 7 | `queueLength` | 訓練佇列長度（只有自己的） | PR-3 |
| 8 | `queuePacked` | 佇列裡最多 7 個兵種，每個 4 位元，最低位是隊首 | PR-3 |
| 9 | `queueProgress` | 隊首的訓練進度（千分比） | PR-3 |
| 10–11 | `rallyX`、`rallyY` | 集結點（定點），沒有就是 -1 | PR-3 |
| 12 | `garrisoned` | 躲在裡面的農民數 | PR-3 |
| 13 | `flags` | `BuildingFlag`：1 記憶中（目前看不到）、2 最近 60 tick 內受過傷 | PR-2 |
| 14–15 | 保留 | 0 | — |

開局時雙方各有一座主城（PR-2 起）。大城的中立箭樓也是一棟建築（`TownTower`，擁有者 `NEUTRAL`）。

### 4.4 資源點 `nodes`（stride `NODE_STRIDE` = 6，只送有變化的）

- 資源點很多，光是樹就上千棵，所以每份快照只送這個玩家「有變化」的資源點。
- 有變化是指：剛被探索到、看得到時剩餘量改變、或看得到與看不到之間切換。
- client 自己保存一份表，照 id 更新。

| 欄 | 名稱 | 說明 | 從 |
|---|---|---|---|
| 0 | `id` | 資源點自己的 id（和單位、建築分開） | PR-2 |
| 1 | `kind` | `NodeKind`：樹、金礦、野果、晶脈 | PR-2 |
| 2–3 | `cellX`、`cellY` | 格子 | PR-2 |
| 4 | `amount` | 剩餘量；看不到時是最後看到的。0 = 採完（樹那格變成可走） | PR-2（會減少從 PR-3） |
| 5 | `visible` | 1 看得到、0 看不到 | PR-2 |

農田不是資源點，是建築（不會用完，一塊一名農民）。

### 4.5 城鎮 `towns`（stride `TOWN_STRIDE` = 10，已探索的城鎮、最後看到的狀態）

| 欄 | 名稱 | 說明 | 從 |
|---|---|---|---|
| 0 | `id` | 同 `map.towns` 的 id | PR-2 |
| 1 | `state` | `TownState`：中立、待選擇、搶奪中、修繕中、治理中、廢墟 | PR-2（變化從 PR-4） |
| 2 | `owner` | 持有者、`NEUTRAL` 或 `NO_OWNER` | PR-2 |
| 3 | `timer` | 目前狀態的計時還剩幾 tick（搶、修繕、廢墟）；暫停時保持原值 | PR-4 |
| 4 | `timerTotal` | 那個計時的總長，給進度條用 | PR-4 |
| 5 | `garrison` | 持有者在判定半徑內的軍隊數（農民不算） | PR-4 |
| 6 | `garrisonNeeded` | 修繕中與治理中需要的最少駐軍（小鎮 1、大城 3） | PR-4 |
| 7 | `militia` | 民兵數 | PR-2 |
| 8 | `revoltTimer` | 駐軍不足時，距離叛離還剩幾 tick；0 = 沒在倒數 | PR-4 |
| 9 | `flags` | `TownFlag`：1 爭奪中（雙方軍隊都在，狀態凍結）、2 看得到、4 駐軍不足 | PR-2 |

畫面要分四種狀態時：
- 中立：`state` = Neutral。
- 廢墟：`state` = Ruins。
- 我方治理：`owner` = 我，`state` 是 Repairing 或 Governed。
- 敵方治理：`owner` = 敵方，`state` 是 Repairing 或 Governed。
- 待選擇和搶奪中是短暫狀態，可以用進度條表示。

### 4.6 晶砲預警區 `warnings`（stride `WARNING_STRIDE` = 6，PR-4 起）

- 預警區落在看得到的格子上就會送，敵我都看得到。
- 欄位：`id`、`owner`、`x`、`y`（定點中心）、`radius`（定點）、`ticksLeft`。

### 4.7 其他欄位

- **`fog`**：`size * size` 個 `Fog` 值。0 沒去過、1 去過但目前看不到、2 看得到。
  - 只在有迷霧更新的快照裡出現（每 5 tick），其他快照是 `null`。PR-2 起。
- **`placement`**：`size * size` 個 `PlaceBit`，跟 `fog` 一起送，給建築預覽用（見第 7 節）。PR-3 起。
- **`idleFarmers`**：自己閒置的農民 id，依 id 排序。PR-3 起。
- **`events`**：這個 tick 發生的事件（見第 5 節）。

## 5. 事件（`SimEvent`）

| `k` | 欄位 | 什麼時候 | 從 |
|---|---|---|---|
| `attacked` | `x`、`y`、`target` | 自己的東西受傷。同一個 8×8 格的區塊，每 60 tick 最多一次。給小地圖閃爍和邊緣箭頭用 | PR-2 |
| `unit_trained` | `id`、`type`、`building` | 訓練完成 | PR-3 |
| `building_done` | `id`、`type` | 建造完成 | PR-3 |
| `node_depleted` | `id` | 資源點採完 | PR-3 |
| `town_captured` | `town`、`by` | 城鎮被攻下。`by` 是你的話，請用 `town_choice` 選擇；人類玩家可以一直不選 | PR-4 |
| `town_plundered` | `town`、`by`、`food`、`gold`、`crystal` | 搶完，拿到的資源 | PR-4 |
| `town_repaired` | `town`、`by` | 修繕完成，開始產出 | PR-4 |
| `town_revolted` | `town`、`from` | 駐軍不足滿 60 秒，叛離回中立 | PR-4 |
| `town_restored` | `town` | 廢墟恢復成中立 | PR-4 |
| `mage_killed` | `id`、`owner`、`killer`、`crystal` | 法師陣亡，擊殺方得到的魔晶 | PR-4 |
| `rejected` | `seq`、`reason` | 指令被拒 | PR-2 |
| `game_over` | `winner`、`reason` | 主城被摧毀、投降，或時間到（平手時 `winner` = -1） | PR-2 |

事件只送這位玩家看得到或跟他有關的。

## 6. Worker 訊息

**送給 Worker（`ToWorker`）**

| `type` | 欄位 | 說明 |
|---|---|---|
| `init` | `protocol`、`seed`、`human`、`ai`、`tps`、`scenario` | 開新局。`human` 是畫面操作的玩家；`null` = 旁觀 AI 對 AI（看得到全部）。`scenario` 見第 8 節 |
| `command` | `cmd` | 見第 3 節 |
| `pause`／`resume` | — | 暫停時模擬停下，但照收指令 |
| `speed` | `tps` | 每秒跑幾個 tick：慢 15、正常 20、快 30，測試時可以更快。不會改變戰局 |
| `determinism` | `protocol`、`seed`、`scenario`、`maxTicks` | 用最快的速度跑一整局 AI 對 AI，回報雜湊。請另外開一個 Worker 來跑，不要用正在玩的那個 |
| `export_log` | — | 取回目前這局的指令紀錄 |

**Worker 送出（`FromWorker`）**

| `type` | 說明 |
|---|---|
| `ready` | 靜態資料（第 2 節），之後開始送快照 |
| `snapshot` | 第 4 節 |
| `hash` | 每 100 tick：`tick`、8 碼十六進位的 `hash` |
| `game_over` | `winner`、`reason`、`stats`（採集量、訓練與損失、法師產量與陣亡、搶與治理次數） |
| `determinism_progress`／`determinism_done` | 確定性檢查的進度與結果：總 tick、最終雜湊、耗時、每 tick 中位數與最大值 |
| `log` | 指令紀錄：第一行是 `LogHeader`（protocol、seed、scenario、ai），之後一行一道指令 |
| `error` | 版本不合或內部錯誤 |

**暫停與速度**：
- 暫停只是讓 Worker 不再跑下一個 tick，模擬的狀態完全不受影響。
- 暫停時收到的指令，蓋上下一個還沒跑的 tick，恢復後在那個 tick 執行。
- 速度只決定每秒跑幾個 tick。

## 7. 能不能蓋：`sim/src/placement.ts`

- `checkPlacement(grid, building, cellX, cellY)` 回傳 0（可以蓋）或 `Reject.BadPlacement`。
- client 用快照裡的 `placement` 做即時的紅綠預覽；模擬用同一個函式、配上自己掌握全部資訊的格子圖來判定 `build` 指令。
- 最後一律以模擬的判定為準。例如迷霧裡看不到的敵方建築，預覽會顯示綠色，但模擬會拒絕。
- 判定規則：
  - 占地的每一格都要在地圖內、已探索、沒有被擋住。擋住的包括不可走的地形、樹、已知的建築（含農田）。
  - 農田的每一格還要在自己主城或糧倉的範圍內（`FarmLand`）。
  - 站在那裡的單位不算阻擋，會被推開。

## 8. 場景（`init.scenario`）

場景由模擬用種子完整產生，有確定性，畫面端不能改。

| 名稱 | 內容 | 從 |
|---|---|---|
| `standard` | 正式原型局：雙方各一座主城加 5 名農民，資源照 GDD 附錄 A | 單位 PR-2、經濟 PR-3、法師與城鎮 PR-4 |
| `e2e` | 雙方資源充足，小鎮旁有一小隊兵，讓瀏覽器測試幾分鐘內走完「蓋房子 → 訓練 → 攻下城鎮 → 搶或治理」 | 蓋與訓練 PR-3、城鎮 PR-4 |
| `perf` | 雙方接近人口上限、法師開著自動施放、迷霧開著、在城鎮附近交戰，用來量「所有系統都開著」的效能 | PR-4 |

## 9. 重播與雜湊

- **指令紀錄**（`export_log`）：第一行是 `LogHeader`，之後每行一道已經套用的指令（含被拒的）。
  - 同一份紀錄關掉 AI 重播，每 100 tick 的雜湊都會相同。
- **雜湊**：FNV-1a 32 位元，輸出 8 碼十六進位。範圍是模擬的全部狀態，依 id 順序：
  - 資源、單位、建築、生產佇列、資源點、城鎮與計時、法師的防護罩與冷卻、亂數狀態、每位玩家的記憶表。
- **確定性檢查的期望值**：`node sim/src/headless.ts --scenario standard --seed <n> --expected <檔案>` 會寫出 `ExpectedHashes` 格式的 JSON（PR-2 起）。
  - Pages 建置時用它產生 `expected-hashes.json`。
  - 手機上的 `determinism` 結果跟它比對。

## 10. 效能

- 表頭的 `stepMicros` 是這個 tick 的模擬時間，`stepBatchMicros` 是最近 20 tick 的總和。
- iOS Safari 的計時精度只有 1 ms，一個 tick 常常不到 1 ms，所以中位數會變成 0。量測頁請同時報平均值：`stepBatchMicros / 20`。
- 驗收標準：iPhone 上每 tick 模擬的中位數 ≤ 5 ms。
