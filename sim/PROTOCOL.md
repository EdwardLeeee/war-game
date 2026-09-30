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
| `repair` | `u`、`building` | 農民對自己的建築工作：沒蓋好就幫忙蓋、受損就修理（不花資源，每名農民每秒 5 點）、農田就去耕作。見 3.1 | PR-3 |
| `train` | `building`、`type`、`n` | 排 n 個訓練。花費在排入時扣 | PR-3 |
| `cancel_train` | `building`、`index` | 取消佇列第 index 個，退回花費 | PR-3 |
| `rally` | `building`、`x`、`y` | 集結點（格子） | PR-3 |
| `eco_ratio` | `food`、`wood`、`gold`、`on` | 經濟分配的比例（百分比，加起來 100）與開關 | PR-3 |
| `recall` | `on` | 全體回城（`true`）或回去工作（`false`），是同一個指令 | PR-3 |
| `cast` | `u`、`fx`、`fy` | 一名法師對定點位置發晶砲：原地校準 1.5 秒，期間出現預警區 | PR-4 |
| `autocast` | `u`、`on` | 法師的自動施放開關 | PR-4 |
| `town_choice` | `town`、`choice` | 攻下的城鎮選搶（0）或治理（1） | PR-4 |
| `surrender` | — | 投降 | PR-4 |

### 3.1 經濟指令的細節（PR-3）

- **只有農民會做**：`gather`、`build`、`repair` 只派 `u` 裡的農民，其他兵種忽略。
  - `u` 裡沒有自己的單位：`NotOwner`。
  - 有自己的單位但沒有農民：`NotAvailable`。
- **躲在建築裡的農民**（全體回城）收到被接受的 `move`、`retreat`、`attack`、`stop`、`gather`、`build`、`repair`，會先出來再照做；被拒絕的指令和 `stance` 不會讓他們出來。
- **`gather`**：
  - 資源點要是自己看過的、還沒採完、旁邊有可走的格子，否則回 `InvalidTarget`。
  - 手上搬的資源種類不同時，會丟掉手上的。
- **`build`**：
  - `type` 不是 `BuildingType`：`InvalidTarget`。主城、城鎮箭樓不能蓋：`NotAvailable`。
  - 位置不行：`BadPlacement`（第 7 節）。
  - 資源不夠：`CannotAfford`。
  - 放下時就扣錢，工地立刻擋路。站在上面的單位會被推到最近的空格。
  - 工地從 1 點血開始，蓋的時候血量和進度一起長。
  - 同一棟最多 4 名農民一起加速，速度線性相加，多的在旁邊等。
  - 蓋好後：農田由第一名農民直接耕作；伐木場、礦場的農民去採附近的木頭或金；其他建築的農民變成閒置。
- **`repair`**，依建築狀態：
  - `building` 不存在：`InvalidTarget`；不是自己的：`NotOwner`。
  - 沒蓋好：幫忙蓋。
  - 受損：修理，每名農民每秒 5 點，同一棟最多 4 人。
  - 沒受損的農田：耕作。一塊田只給 1 名農民：名單中第一名去耕，其他人變成閒置；田已經有別人在耕：`NotAvailable`。
  - 其他情況（沒受損、也不是農田）：`NotAvailable`。
- **`train`**：
  - `building` 不存在：`InvalidTarget`；不是自己的：`NotOwner`。
  - `n` 不是 1–7 的整數：`InvalidTarget`。
  - 建築沒蓋好，或不訓練這種兵：`NotAvailable`。
  - 佇列放不下：`QueueFull`。
  - **人口**：現有人口 ＋ 自己所有建築佇列中的單位 ＋ `n` 超過上限：`PopulationCap`。表頭的 `population` 只算已經出生的單位。
  - 法師：現有法師 ＋ 佇列中的法師 ＋ `n` 超過 6：`MageCap`。
  - 資源不夠 `n` 個：`CannotAfford`。整批接受或整批拒絕。
  - 上限變低（例如民居被拆）時，隊首會停在 100%，等有空位才出生。
- **`cancel_train`**：`index` 超出佇列：`InvalidTarget`。退回全額花費。
- **`rally`**：
  - 只有會訓練的建築可以設，其他：`NotAvailable`。
  - 新單位出生後走到集結點。
  - 農民的集結點如果在資源點或空著的自家農田上，出生後直接去採或耕。
- **`eco_ratio`**：三個值都是 0–100 的整數、加起來 100，`on` 是布林值，否則 `InvalidTarget`。
- **`recall`**：
  - `on: true`：所有農民記下手上的工作，躲進最近還有空位的主城（15 人）或民居（5 人）。沒位子的在主城旁等。
  - 回城中新訓練的農民也會去躲。
  - `on: false`：全部出來，回去做原本的工作。
- **待命**（GDD 第 4 節）：
  - 玩家用 `move`、`retreat`、`stop`、`attack` 親手指揮過的農民，閒下來後原地待命。自動修理和經濟分配都不會把他們派走。
  - 待命的農民照樣在 `idleFarmers` 清單裡，也有 `IdleFarmer` 旗標。
  - 玩家再給他工作（`gather`、`build`、`repair`）時解除待命。
  - 全體回城照樣會帶走待命的農民；回城結束後，他們回到待命狀態。
- **自動派工**，每 20 tick 一次，只處理閒置、而且不是待命的農民（回城中則全部都去躲）：
  - 回城中：去躲。
  - 否則：附近 6 格內有受損的自家建築就去修。
  - 再來，經濟分配開著時：派去離自己比例最遠的資源（平手依糧、木、金），晶脈不會自動派。
  - 糧食從最近的空農田或野果中選，木頭找樹，金找金礦。
- **農民不會自己找敵人打**，只有用 `attack` 指定目標才打。

### 3.2 法師、城鎮與投降（PR-4）

- **`cast`**：`u` 是一名法師的 id；`fx`、`fy` 是**定點座標**（1 格 = 1024，跟快照裡單位的 `x`、`y` 一樣）。
  - 被拒的原因，依檢查順序：
    - 不是自己的單位：`NotOwner`。
    - 不是法師：`NotAvailable`。
    - 座標不在地圖內：`InvalidTarget`。
    - 距離超過 8 格：`OutOfRange`。
    - 還在冷卻：`Cooldown`。
    - 魔晶不到 5：`NoCrystal`。
  - 法師原地校準 30 tick（1.5 秒），不能動，出現預警區（4.6 節）。
  - 發射那一刻扣 5 魔晶；魔晶已經不夠就不發射。
  - 打中落點 1.5 格內所有**不是施法者自己**的單位（敵方和中立民兵，躲在建築裡的不算）；不打建築。
  - 之後冷卻 160 tick（8 秒）。
  - 校準期間收到其他指令就取消，不扣魔晶。
- **`autocast`**：開關 `u` 裡的法師（旗標 `Autocast`）；沒有法師：`NotAvailable`。
  - 開著時，每 10 tick 檢查一次；法師在撤退、冷卻中或魔晶不到 5 時不檢查。
  - 在射程內看得到的敵方單位中，找一個位置：以它為落點時，半徑 1.5 格內的敵人最多，而且至少 3 名。平手取 id 小的。
  - 找到就開始校準，發射後回到原本的指令（例如前進）。
- **防護罩**（法師出生時 60）：
  - 先吸收傷害，罩破之後才傷到本體。同一個 tick 打在罩上的傷害全部由罩吸收，多出來的不傳到本體。
  - 打罩時用對「shield」的加成：遠程 ×1.5，晶砲 ×1。
  - 5 秒內沒有受到、也沒有造成傷害時，每秒回復 6。
- **法師陣亡**：
  - 擊殺方加 15 魔晶。被中立民兵或箭樓打死時沒有人拿到。
  - `mage_killed` 的 `killer` 是擊殺方玩家；同一個 tick 有多方命中時，算 id 最大的攻擊者。
- **`town_choice`**：
  - 被拒的原因：
    - 城鎮 id 或 `choice` 不對：`InvalidTarget`。
    - 不是你攻下的：`TownNotYours`。
    - 已經選過（不在待選擇狀態）：`TownChoiceMade`。
    - 治理的錢不夠：`CannotAfford`。
  - 治理的花費在選擇時就扣，叛離不退還。
- **城鎮的規則**（D4）：
  - 只算半徑內的軍隊，農民和躲在建築裡的不算。雙方都有軍隊時是爭奪中（`Contested`），狀態凍結；廢墟照樣倒數。
  - **中立城鎮**：這座城鎮的民兵全部倒下（不管在不在半徑內），大城的箭樓也被拆掉，而且半徑內只有一方的軍隊，就被這一方攻下，變成待選擇。
    - 箭樓拆掉後不會再出現。
  - **被持有的城鎮**（待選擇、搶奪中、修繕中、治理中）：另一方有軍隊在半徑內、持有者沒有時，就被另一方攻下，重新待選擇；搶奪和修繕都取消。
  - **搶**：持有者有軍隊在半徑內時才倒數（小鎮 15 秒、大城 25 秒）。搶完拿到資源，變成廢墟 4 分鐘，之後回到中立、民兵補回一半。
  - **修繕**：駐軍達到最少人數時才倒數（小鎮 45 秒 1 人、大城 60 秒 3 人）。
  - **治理**：駐軍足夠時每分鐘產出；累加器每 20 tick 發放一次。人口上限 +5／+10。
  - **叛離**：修繕中或治理中駐軍不足，`revoltTimer` 從 1,200 tick 倒數，歸零時變回中立、民兵補回一半；駐軍補足就停止倒數。
- **`surrender`**：投降的一方輸，`game_over` 的原因是 `Surrender`。之後的指令都回 `GameOver`。

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

- 預警區中心的格子看得到就會送，敵我都看得到；自己法師的預警區一定會送。
- 一名法師同時只有一個預警區，`id` 就是法師的 id。
- 欄位：`id`、`owner`、`x`、`y`（定點中心）、`radius`（定點）、`ticksLeft`。
  - `ticksLeft` 從 30 倒數，到 0 就發射。

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

事件只送這位玩家看得到或跟他有關的：
- 城鎮事件：送給相關的玩家（攻下者、原本的持有者），以及當時看得到城鎮中心的玩家。
- `mage_killed`：送給法師的主人和擊殺方。
- `unit_trained`、`building_done`、`node_depleted`、`rejected`：只送給自己。

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
| `game_over` | `winner`、`reason`、`stats`（採集量、訓練與損失、法師產量與陣亡、搶與治理次數）。`unitsTrained`、`unitsLost` 依 `UnitType` 排：農民、槍兵、遠程、法師。城鎮次數從 PR-4 |
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
  - 農田的每一格還要在自己主城或糧倉的範圍內（`FarmLand`）：離已完成的主城或糧倉占地 6 格內（x、y 距離取較大的那個）。
  - 站在那裡的單位不算阻擋，會被推開。
- 快照裡的 `placement` 是這位玩家知道的狀況：資源點用最後看到的剩餘量，敵方建築用記憶。
- 開局時，每位玩家出生點周圍 16 格已經算探索過，也知道那裡的資源點。

## 8. 場景（`init.scenario`）

場景由模擬用種子完整產生，有確定性，畫面端不能改。

| 名稱 | 內容 | 從 |
|---|---|---|
| `standard` | 正式原型局：雙方各一座主城加 5 名農民，資源照 GDD 附錄 A | 單位 PR-2、經濟 PR-3、法師與城鎮 PR-4 |
| `e2e` | 雙方資源充足，小鎮旁有一小隊兵，讓瀏覽器測試幾分鐘內走完「蓋房子 → 訓練 → 攻下城鎮 → 搶或治理」 | 蓋與訓練 PR-3、城鎮 PR-4 |

`e2e` 的內容（PR-3 起），雙方互為鏡像：
- 資源：糧、木、金各 2,000，魔晶 300。
- 主城旁已經蓋好 2 座民居和 1 座兵營，所以人口是 15／20，一開始就能訓練。
- 開局的 5 名農民，加上一小隊兵：6 名槍兵、4 名遠程兵。
  - 玩家 0 的小隊在 (24–28, 40–41) 附近，玩家 1 在鏡像位置。
  - 離小鎮中心至少 10 格，在民兵的警戒距離外，所以戰鬥要由測試下指令才會開始。
| `perf` | 雙方接近人口上限、法師開著自動施放、迷霧開著、在城鎮附近交戰，用來量「所有系統都開著」的效能 | PR-4 |

`perf` 的內容（PR-4 起），雙方互為鏡像：
- 資源：糧、木、金各 3,000，魔晶 500。
- 主城旁 22 座民居，人口上限 120。
- 40 名農民照經濟分配工作。
- 34 名槍兵、34 名遠程兵、6 名法師（自動施放開著）在大城旁。
  - 玩家 0 的方陣從 (40, 51) 開始，每排 10 名，槍兵在最靠近大城的前排。
  - 跟大城的民兵、箭樓，以及對方的方陣都在交戰距離內，所以開局就開打，不需要下指令。
- 人口 114／120。

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
