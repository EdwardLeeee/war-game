# 訓練的鏈在讓位以後自己接回（D-147 PR B 的設計，還沒做）

2026-11-23，war-game-ai。ceo 要的（D-162 之後）：段因為讓位或佇列在忙而沒接下去時，佇列空了以後約 10 分鐘內鏈自己接回，不靠定時排程；開關、上限、暫停照舊；等的時候最多佔 1 個 runner；排程留著當最後的備援。

## 為什麼不能靠排程

- 實測：合併 A2 以後約 33 小時（2026-11-21 07:39Z 到 11-22 16:42Z）只出現 5 次，相鄰最長隔 8 小時 26 分；照 cron 應該約 66 次。
- 官方文件（events-that-trigger-workflows，schedule 一節）：「The `schedule` event can be delayed during periods of high loads of GitHub Actions workflow runs.」「If the load is sufficiently high enough, some queued jobs may be dropped.」

## 三個做法

| | A：等待的 run 佔 1 個 runner 輪詢 | **B：別的 workflow 一結束就派工（建議）** | C：環境的等待計時器輪詢 |
|---|---|---|---|
| 怎麼接回 | 每 2–3 分鐘看一次佇列，空了就派段 | Client、Sim、Pages 等任何一個 run 結束，就跑一次派工（`workflow_run`，types: completed）；佇列只會在有 run 結束時變空 | 每 10 分鐘一個 run，job 先等計時器再看一次 |
| 等的時候佔的 runner | 1 | 0 | 0（文件：保護規則都過了，job 才送到 runner） |
| 多出來的 run | 1 個長的 | 約每天 25 個（過去 7 天 Client 80、Pages 79、Sim 14 個 run）；開關關著時整個跳過 | 等的時候每 10 分鐘 1 個 |
| 取消等待中的 run | 算暫停 | 沒有等待中的 run；要停就把 AI_TRAIN 關掉，或取消正在跑的段（照舊算暫停） | 算暫停（放在自己的 concurrency group，不會被新的 pending 換掉） |
| 要使用者動設定 | 不用 | 不用 | 要：建 environment、設等待計時器 |
| 問題 | 全部 20 台都忙、Pages 在等時，它佔的那台擋到上線（D-123） | 名單漏掉一個 workflow，那次結束就接不回（測試擋：名單要等於 .github/workflows 的全部，ai-train 除外） | 零件多、run 多 |

否決 A：它佔著 runner 等，正好跟 D-123「訓練讓位給別人」衝突。C 留作 B 不可靠時的備案。

## B 的依據（官方文件原文）

- events-that-trigger-workflows，workflow_run：只有 workflow 檔在預設分支上才會觸發（文件原文的摘要）。「A workflow run is triggered regardless of the conclusion of the previous workflow.」所以取消、失敗的 run 結束也算。
- 同一節：「You can't use `workflow_run` to chain together more than three levels of workflows.」我們只有兩層：Client 等 → AI train 的派工；派工再用 `workflow_dispatch` 派段。
- github_token：GITHUB_TOKEN 觸發的事件不會建立新的 run，但「`workflow_dispatch` and `repository_dispatch` events always create workflow runs.」所以派工照舊能派段（現在的做法就是這樣）。
- workflow-syntax，concurrency：同一個 group 預設最多一個 pending，「any existing `pending` job or workflow run in the same group is canceled and replaced.」派工在自己的 group（ai-train-dispatch）：連續幾個 run 結束時，只留最新的那次派工，剛好是要的。
- 安全：`workflow_run` 用預設分支的程式和權限跑，fork 的 PR 也會觸發。派工 job 只 checkout 預設分支的 `.github/ai-train`，不讀觸發它的 run 的任何東西（程式、artifact、輸入），只看 API 上的狀態，所以 fork 的 PR 只能讓它多跑一次「不派」。

## B 還沒驗的，和怎麼驗

- 從「最後一個 run 結束」到「派工判斷」多久（事件延遲＋派工 run 等 runner）。文件沒寫。驗法不花訓練時數：合併後 AI_TRAIN 先關著，每個「AI train: dispatch (off)」的建立時間，減去觸發它的 run 的結束時間，量一週，看中位數和最慢值。超過 10 分鐘再換 C。
- 時間到了才解開的條件（派了沒看到新 run 的 15 分鐘、每天的段數）解開時，不一定剛好有 run 結束；這種情況照舊靠排程和手動派工。

## 要改的地方（做的時候）

- ai-train.yml：`on.workflow_run`（workflows：Client、Sim、Pages、design-render、Spike Bench、Spike Godot、Spike Live Check、Spike Web；types: completed）；派工 job 的 `if` 和 run-name 加上這個事件，開關關著就跳過。
- dispatch.py：角色「派工」多一種事件；別的判斷全部不變。
- test_dispatch.py：名單等於 .github/workflows 裡的全部名稱（ai-train 除外）；新事件只當派工、不當段的結尾。
