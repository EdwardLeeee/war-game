# sim：遊戲規則與原型的簡單 AI

負責：war-game-core。依據：`docs/briefs/2026-10-core-prototype-sim.md`、`docs/design/gdd.md`。

- **介面**：`PROTOCOL.md`（說明）與 `src/protocol.ts`（型別）。client 只透過這兩份和 `src/worker.ts` 使用模擬。
- **確定性**：照 `AGENTS.md` 的「模擬與 AI 規則」，沿用引擎 spike 驗證過的做法。
  - 1 格 = 1024 定點、每秒 20 tick、xorshift32、依 ID 迭代、flow field、FNV-1a 雜湊、JSONL 重播。
- **沒有建置步驟**：Node 直接執行 TypeScript（只用可以剝掉的型別語法），Vite 直接匯入。

```bash
cd sim
npm ci
npm run typecheck
npm test
```

在這台開發機上，重工作一律用 `systemd-run --user --scope -q -p MemoryMax=1500M -p MemorySwapMax=0` 包起來。100 場 AI 對打和瀏覽器測試交給 CI（`.github/workflows/sim.yml`）。

## 進度（照核准的計畫分 5 個 PR）

| PR | 內容 | 狀態 |
|---|---|---|
| 1 | 介面（這一版） | 進行中 |
| 2 | 骨架：地圖、移動、隊形、戰鬥、戰爭迷霧與 PlayerView、雜湊、重播、Worker、無畫面執行 | |
| 3 | 經濟：資源、農民、建築、訓練、人口、經濟分配、全體回城 | |
| 4 | 法師、城鎮、勝負 | |
| 5 | 簡單 AI、100 場 AI 對打、瀏覽器確定性、效能報告 | |
