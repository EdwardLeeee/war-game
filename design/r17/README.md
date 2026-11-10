# R17 局後統計標出電腦進攻和團戰

使用者 2026-11-10：「我覺得結算畫面 也可以把電腦來進攻我們打團戰的飆進去」。brief：`docs/briefs/2026-11-r17-stats-battles.md`。

稿用 client 真的局後統計頁畫（`?ui=r6`，A 銅木，iPhone 932×336 加安全區），餵 war-game-client 重播的使用者對局時間軸（`war-game-worktrees/review/r17/`，不在 repo），選項畫在頁面上，加的地方用黃框標出。

```bash
python3 design/r17/common/events_r17.py ../review/r17/結果-原始.txt 33cdaaa5 2fd2e236 62ae4218 > EVENTS.json   # 再把每局的 ticks 加進去
(cd client && npx vite build && npx vite preview --host 127.0.0.1 --port 5199)       # art.lock 的美術解在 client/public/art/
R17_TIMELINES=../review/r17/timelines node design/r17/common/r17.mjs SHOTS EVENTS.json
python3 design/r17/common/boards_r17.py SHOTS design/r17/build/out
```

- 選項：
  - `A 圖上全標`：團戰是圖上的直條，進攻是頂端的記號。
  - `B 戰事清單`：「戰鬥」頁加「兵種｜戰事」切換，點一列跳到兵力圖。
  - `C 圖下戰事帶`：圖下一條帶，上排進攻、下排團戰。
- 記號都不用玩家色：
  - 進攻：▽ 擋下、▼ 城鎮失守、× 主城被毀。
  - 團戰：淡色實心＝我方贏、斜線＝敵方贏、虛線框＝平手。
  - 說明卡上寫字。差不到 14 pt 的記號合成一個，寫上數字。
  - 點記號跳出最近那件的說明卡，卡上有「上一件／下一件」。
