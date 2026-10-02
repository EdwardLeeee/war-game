# ceo 的腳本玩家：逐種子結果（2026-10-02 到 10-03）

- 腳本：同一個資料夾的 `human.ts`（放在 `sim/src/ai/`）和 `duel.ts`（放在 `sim/src/`）。
- 每一段的第一行是打法的參數。`think` 是每幾 tick 下一輪指令。
- 每局寫成「種子＋電腦性格的第一個字母（b 均衡、g 治理、p 掠奪）：結果 第幾分」。時間是遊戲分鐘。
- 到第 50 分還沒分出勝負的局，括號裡是當時雙方的主城血量和兵數（槍兵／遠程／法師）。
- 暫存改動都只在 ceo 的暫存複本裡，沒有 commit，也沒有經過 CI。

## main-D-H1-s6-15

- 版本：main 的模擬（937e035，和線上 0251a36 相同）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":false,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 10 局贏 8 局
- 6b:贏 16.9; 7p:贏 30.7; 8g:贏 27.4; 9b:贏 16.2; 10b:贏 29.9; 11p:贏 21.6; 12g:贏 29.5; 13b:贏 16.6; 14b:輸 29.1; 15p:輸 28.7

## main-D-H1

- 版本：main 的模擬（937e035，和線上 0251a36 相同）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":false,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 5 局贏 4 局
- 1b:輸 31.7; 2b:贏 40.2; 3p:贏 30.8; 4g:贏 35.0; 5b:贏 20.7

## main-Deco-s15

- 版本：main 的模擬（937e035，和線上 0251a36 相同）
- 打法：{"farmers":30,"production":6,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":0,"woodBias":true,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 14 局
- 1b:輸 27.4; 2b:贏 16.3; 3p:贏 23.5; 4g:贏 28.8; 5b:贏 30.5; 6b:贏 16.9; 7p:贏 22.5; 8g:贏 30.3; 9b:贏 16.3; 10b:贏 24.7; 11p:贏 31.8; 12g:贏 28.1; 13b:贏 41.0; 14b:贏 20.8; 15p:贏 33.2

## main-Dnotown-H1-s15

- 版本：main 的模擬（937e035，和線上 0251a36 相同）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":0,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":false,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 2 局
- 1b:輸 19.6; 2b:輸 20.1; 3p:輸 18.6; 4g:輸 16.7; 5b:輸 27.7; 6b:輸 25.9; 7p:輸 16.5; 8g:輸 17.3; 9b:贏 39.8; 10b:輸 16.9; 11p:輸 18.2; 12g:贏 21.0; 13b:輸 27.4; 14b:輸 19.8; 15p:輸 17.2

## main-P24-H1-s20

- 版本：main 的模擬（937e035，和線上 0251a36 相同）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 19 局
- 1b:贏 14.5; 2b:贏 18.6; 3p:贏 20.5; 4g:贏 18.3; 5b:贏 18.1; 6b:贏 14.4; 7p:贏 24.1; 8g:贏 17.8; 9b:贏 16.6; 10b:贏 18.6; 11p:輸 24.4; 12g:贏 16.6; 13b:贏 14.4; 14b:贏 14.5; 15p:贏 20.2; 16g:贏 17.6; 17p:贏 22.1; 18b:贏 21.7; 19g:贏 16.7; 20g:贏 14.6

## main-P24F5-H1-s20

- 版本：main 的模擬（937e035，和線上 0251a36 相同）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":false,"focus":5}；每 40 tick 下一次指令；對手 normal
- 20 局贏 18 局
- 1b:贏 14.4; 2b:贏 18.6; 3p:贏 20.5; 4g:贏 20.1; 5b:贏 18.1; 6b:贏 14.4; 7p:贏 23.9; 8g:贏 17.8; 9b:贏 16.7; 10b:贏 18.6; 11p:輸 24.4; 12g:贏 16.6; 13b:贏 14.4; 14b:贏 14.5; 15p:輸 23.8; 16g:贏 17.6; 17p:贏 22.0; 18b:贏 21.7; 19g:贏 17.3; 20g:贏 14.6

## main-P24W-H1-s20

- 版本：main 的模擬（937e035，和線上 0251a36 相同）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":true,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 18 局
- 1b:贏 14.7; 2b:贏 20.7; 3p:贏 22.1; 4g:贏 18.1; 5b:贏 17.5; 6b:贏 14.4; 7p:輸 22.7; 8g:贏 14.5; 9b:贏 16.4; 10b:贏 18.2; 11p:贏 20.7; 12g:贏 17.1; 13b:贏 14.5; 14b:贏 14.6; 15p:贏 18.9; 16g:贏 14.7; 17p:輸 21.0; 18b:贏 22.8; 19g:贏 18.8; 20g:贏 14.5

## main-P24WF5-H1-s20

- 版本：main 的模擬（937e035，和線上 0251a36 相同）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":true,"focus":5,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 17 局
- 1b:贏 14.7; 2b:贏 20.7; 3p:贏 21.1; 4g:贏 19.8; 5b:贏 17.5; 6b:贏 14.4; 7p:輸 22.7; 8g:贏 14.5; 9b:贏 16.6; 10b:贏 19.3; 11p:贏 20.6; 12g:贏 17.1; 13b:贏 14.5; 14b:贏 14.4; 15p:輸 33.0; 16g:贏 14.7; 17p:輸 21.0; 18b:贏 18.0; 19g:贏 18.8; 20g:贏 14.5

## v87-A-H1

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":30,"vein":0,"loose":false}；每 40 tick 下一次指令；對手 normal
- 5 局贏 4 局
- 1b:贏 18.5; 2b:贏 18.3; 3p:輸 18.9; 4g:贏 15.2; 5b:贏 14.9

## v87-A-H2

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":16,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":30,"vein":0,"loose":false}；每 100 tick 下一次指令；對手 normal
- 5 局贏 4 局
- 1b:贏 15.4; 2b:贏 19.3; 3p:輸 21.5; 4g:贏 18.9; 5b:贏 15.7

## v87-A45-H0

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":30,"production":4,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":45,"vein":0,"loose":false}；每 10 tick 下一次指令；對手 normal
- 5 局贏 3 局
- 1b:贏 26.0; 2b:贏 26.1; 3p:輸 30.8; 4g:贏 22.0; 5b:輸 29.6

## v87-A45-H1

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":45,"vein":0,"loose":false}；每 40 tick 下一次指令；對手 normal
- 5 局贏 2 局
- 1b:贏 23.6; 2b:贏 23.8; 3p:輸 19.6; 4g:輸 32.8; 5b:輸 30.6

## v87-D-H1-s6-15

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":false,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 10 局贏 1 局
- 6b:輸 45.4; 7p:輸 18.5; 8g:輸 19.8; 9b:輸 21.1; 10b:贏 28.9; 11p:輸 23.3; 12g:輸 22.7; 13b:輸 31.2; 14b:輸 32.5; 15p:輸 26.9

## v87-D-H1

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":false}；每 40 tick 下一次指令；對手 normal
- 5 局贏 0 局
- 1b:輸 39.9; 2b:輸 20.6; 3p:輸 19.6; 4g:輸 41.7; 5b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 38/18/6／電腦 21/3/6）

## v87-Dnotown-H1-s15

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":0,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":false,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 0 局
- 1b:輸 27.4; 2b:輸 33.5; 3p:輸 18.7; 4g:輸 47.5; 5b:輸 28.1; 6b:輸 25.0; 7p:輸 19.6; 8g:輸 29.6; 9b:輸 17.2; 10b:輸 29.8; 11p:輸 19.2; 12g:輸 21.6; 13b:輸 36.7; 14b:輸 20.4; 15p:輸 18.8

## v87-P16-H1

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":16,"vein":0,"loose":false}；每 40 tick 下一次指令；對手 normal
- 5 局贏 2 局
- 1b:到第 50.0還沒結束（主城 我 1200／電腦 660，兵 我 7/6/3／電腦 2/0/0）; 2b:贏 46.1; 3p:輸 19.9; 4g:贏 41.3; 5b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 8/7/3／電腦 7/2/4）

## v87-P20-H1-plunder

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":20,"vein":0,"loose":false}；每 40 tick 下一次指令；對手 normal
- 5 局贏 2 局
- 1p:贏 35.5; 2p:輸 22.3; 3p:輸 22.7; 4p:輸 19.6; 5p:贏 29.1

## v87-P20-H1

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":20,"vein":0,"loose":false}；每 40 tick 下一次指令；對手 normal
- 5 局贏 3 局
- 1b:贏 17.7; 2b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 9/8/3／電腦 1/1/2）; 3p:輸 22.7; 4g:贏 39.9; 5b:贏 23.1

## v87-P24-H1-plunder

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false}；每 40 tick 下一次指令；對手 normal
- 5 局贏 2 局
- 1p:輸 24.3; 2p:輸 25.3; 3p:贏 28.7; 4p:贏 26.1; 5p:輸 27.2

## v87-P24-H1-s20

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 17 局
- 1b:贏 21.8; 2b:贏 17.2; 3p:贏 28.7; 4g:贏 22.1; 5b:贏 17.5; 6b:贏 28.8; 7p:輸 20.9; 8g:贏 26.8; 9b:贏 17.6; 10b:贏 17.0; 11p:贏 20.5; 12g:到第 50.0還沒結束（主城 我 1200／電腦 367，兵 我 11/12/5／電腦 3/0/0）; 13b:贏 40.9; 14b:贏 21.8; 15p:贏 37.5; 16g:贏 17.6; 17p:輸 24.2; 18b:贏 28.4; 19g:贏 22.6; 20g:贏 17.5

## v87-P24-H1

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false}；每 40 tick 下一次指令；對手 normal
- 5 局贏 5 局
- 1b:贏 21.8; 2b:贏 17.2; 3p:贏 28.7; 4g:贏 22.1; 5b:贏 17.5

## v87-P24-H2-s20

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":16,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":false,"focus":0}；每 100 tick 下一次指令；對手 normal
- 20 局贏 15 局
- 1b:贏 18.4; 2b:贏 27.6; 3p:輸 23.8; 4g:贏 17.6; 5b:贏 17.3; 6b:輸 27.7; 7p:輸 20.4; 8g:贏 31.0; 9b:贏 26.7; 10b:贏 26.2; 11p:贏 31.1; 12g:贏 17.8; 13b:贏 20.1; 14b:贏 17.6; 15p:輸 25.1; 16g:贏 22.9; 17p:輸 19.2; 18b:贏 21.5; 19g:贏 30.9; 20g:贏 17.3

## v87-P24F5-H0-s10

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":30,"production":4,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":false,"focus":5,"staticRatio":false,"noMage":false}；每 10 tick 下一次指令；對手 normal
- 10 局贏 9 局
- 1b:贏 18.9; 2b:贏 27.9; 3p:贏 21.7; 4g:贏 19.2; 5b:贏 13.7; 6b:贏 13.8; 7p:輸 22.0; 8g:贏 18.1; 9b:贏 17.3; 10b:贏 20.5

## v87-P24F5-H1-plunder-s10

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":false,"focus":5,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 10 局贏 3 局
- 1p:輸 23.5; 2p:輸 25.3; 3p:輸 22.2; 4p:贏 26.0; 5p:贏 35.4; 6p:贏 26.3; 7p:輸 20.9; 8p:輸 23.2; 9p:輸 22.1; 10p:輸 21.1

## v87-P24F5-H1-s20

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":false,"focus":5}；每 40 tick 下一次指令；對手 normal
- 20 局贏 16 局
- 1b:贏 13.7; 2b:贏 17.5; 3p:輸 22.2; 4g:贏 13.7; 5b:贏 17.3; 6b:贏 13.7; 7p:輸 20.9; 8g:贏 13.7; 9b:贏 17.3; 10b:贏 13.7; 11p:贏 20.5; 12g:贏 27.4; 13b:贏 24.6; 14b:贏 13.7; 15p:輸 23.7; 16g:贏 40.0; 17p:輸 24.2; 18b:贏 26.1; 19g:贏 17.1; 20g:贏 17.2

## v87-P24F5-H2-s20

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":16,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":false,"focus":5,"staticRatio":false,"noMage":false}；每 100 tick 下一次指令；對手 normal
- 20 局贏 15 局
- 1b:贏 17.8; 2b:贏 17.6; 3p:輸 23.8; 4g:贏 17.6; 5b:贏 42.2; 6b:贏 17.7; 7p:輸 20.4; 8g:輸 22.6; 9b:贏 20.4; 10b:贏 18.0; 11p:贏 31.1; 12g:贏 17.3; 13b:贏 28.9; 14b:贏 17.2; 15p:輸 24.0; 16g:贏 13.9; 17p:輸 19.2; 18b:贏 24.8; 19g:贏 30.9; 20g:贏 17.2

## v87-P24W-H1-plunder-s20

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":true,"focus":0,"staticRatio":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 10 局
- 1p:輸 23.9; 2p:輸 25.3; 3p:贏 28.6; 4p:贏 22.3; 5p:輸 28.0; 6p:輸 23.1; 7p:輸 18.8; 8p:輸 21.4; 9p:輸 21.9; 10p:輸 17.6; 11p:贏 20.5; 12p:贏 26.8; 13p:贏 21.9; 14p:贏 41.4; 15p:贏 37.2; 16p:贏 30.3; 17p:贏 26.4; 18p:輸 17.8; 19p:贏 17.6; 20p:輸 23.2

## v87-P24W-H1-s20

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":true}；每 40 tick 下一次指令；對手 normal
- 20 局贏 19 局
- 1b:贏 21.8; 2b:贏 17.2; 3p:贏 28.6; 4g:贏 26.9; 5b:贏 17.5; 6b:贏 27.2; 7p:輸 18.8; 8g:贏 21.7; 9b:贏 17.6; 10b:贏 17.0; 11p:贏 20.5; 12g:贏 28.8; 13b:贏 24.3; 14b:贏 21.7; 15p:贏 37.2; 16g:贏 17.6; 17p:贏 26.4; 18b:贏 26.5; 19g:贏 22.0; 20g:贏 17.5

## v87-P24WF5-H1-plunder-s20

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":true,"focus":5,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 8 局
- 1p:輸 23.1; 2p:輸 25.3; 3p:輸 22.3; 4p:贏 22.4; 5p:贏 26.7; 6p:贏 26.3; 7p:輸 18.8; 8p:輸 25.9; 9p:輸 21.9; 10p:輸 17.6; 11p:贏 20.5; 12p:贏 24.2; 13p:輸 24.5; 14p:輸 23.9; 15p:輸 23.7; 16p:贏 26.3; 17p:贏 26.5; 18p:輸 17.8; 19p:贏 18.3; 20p:輸 23.2

## v87-P24WF5-H1-s20

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":true,"focus":5}；每 40 tick 下一次指令；對手 normal
- 20 局贏 16 局
- 1b:贏 13.7; 2b:贏 17.5; 3p:輸 22.3; 4g:贏 13.7; 5b:贏 17.3; 6b:贏 13.7; 7p:輸 18.8; 8g:贏 13.7; 9b:贏 17.3; 10b:贏 13.7; 11p:贏 20.5; 12g:贏 21.5; 13b:贏 30.9; 14b:贏 13.7; 15p:輸 23.7; 16g:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 12/12/6／電腦 10/1/1）; 17p:贏 26.5; 18b:贏 26.5; 19g:贏 17.1; 20g:贏 17.2

## v87-P30-H1-plunder

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":30,"vein":0,"loose":false}；每 40 tick 下一次指令；對手 normal
- 5 局贏 0 局
- 1p:輸 19.4; 2p:輸 21.3; 3p:輸 18.9; 4p:輸 21.4; 5p:輸 26.7

## v87-P30WF5-H1-plunder-s20

- 版本：#87 的 61c33c7（家旁小鎮）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":30,"vein":0,"loose":false,"woodBias":true,"focus":5,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 11 局
- 1p:輸 19.4; 2p:輸 21.3; 3p:輸 18.9; 4p:贏 22.9; 5p:輸 23.4; 6p:贏 19.5; 7p:贏 27.1; 8p:贏 22.2; 9p:贏 22.0; 10p:輸 21.7; 11p:輸 23.9; 12p:贏 23.5; 13p:贏 14.8; 14p:贏 30.5; 15p:贏 24.0; 16p:輸 36.3; 17p:輸 21.3; 18p:贏 25.8; 19p:輸 37.5; 20p:贏 26.3

## v87cap-D-H1-s15

- 版本：61c33c7，暫存改動：普通電腦最多 3 名法師
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":false,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 3 局
- 1b:輸 38.8; 2b:贏 30.4; 3p:輸 21.9; 4g:輸 34.3; 5b:輸 29.9; 6b:贏 19.8; 7p:輸 21.4; 8g:輸 36.7; 9b:輸 30.8; 10b:輸 31.8; 11p:輸 35.3; 12g:輸 21.0; 13b:贏 25.9; 14b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 56/17/3／電腦 43/3/4）; 15p:輸 27.3

## v87cap-P24-H1-s20

- 版本：61c33c7，暫存改動：普通電腦最多 3 名法師
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 17 局
- 1b:贏 21.8; 2b:贏 17.2; 3p:贏 20.1; 4g:贏 22.1; 5b:贏 17.5; 6b:贏 35.9; 7p:輸 27.8; 8g:贏 26.8; 9b:贏 17.6; 10b:贏 17.0; 11p:贏 23.6; 12g:到第 50.0還沒結束（主城 我 1200／電腦 367，兵 我 11/12/5／電腦 3/0/0）; 13b:贏 40.9; 14b:贏 21.8; 15p:輸 25.7; 16g:贏 17.6; 17p:贏 35.6; 18b:贏 28.4; 19g:贏 22.6; 20g:贏 17.5

## v91-D-H1-loose-s15

- 版本：#91 的 38c57db（家旁小鎮＋剋法師三條規則）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":true,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 0 局
- 1b:輸 34.4; 2b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 29/31/2／電腦 28/0/2）; 3p:輸 22.2; 4g:輸 19.4; 5b:輸 30.2; 6b:輸 21.7; 7p:輸 21.3; 8g:輸 32.4; 9b:輸 23.6; 10b:輸 21.2; 11p:輸 20.9; 12g:輸 21.8; 13b:輸 28.6; 14b:輸 22.7; 15p:輸 19.5

## v91-D-H1-looseall-s15

- 版本：#91 的 38c57db（家旁小鎮＋剋法師三條規則）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":2,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 0 局
- 1b:輸 31.5; 2b:輸 24.9; 3p:輸 22.3; 4g:輸 20.7; 5b:輸 28.2; 6b:輸 23.5; 7p:輸 19.2; 8g:輸 25.9; 9b:輸 37.9; 10b:輸 29.5; 11p:輸 23.4; 12g:輸 23.4; 13b:輸 24.8; 14b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 71/21/6／電腦 36/2/6）; 15p:輸 26.1

## v91-D-H1-s15

- 版本：#91 的 38c57db（家旁小鎮＋剋法師三條規則）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":false,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 0 局
- 1b:輸 23.5; 2b:輸 19.3; 3p:輸 21.4; 4g:輸 19.8; 5b:輸 22.8; 6b:輸 22.8; 7p:輸 19.2; 8g:輸 32.8; 9b:輸 19.9; 10b:輸 21.9; 11p:輸 19.0; 12g:輸 21.3; 13b:輸 27.1; 14b:輸 41.8; 15p:輸 19.3

## v91-Dnotown-H1-s15

- 版本：#91 的 38c57db（家旁小鎮＋剋法師三條規則）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":0,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":false,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 0 局
- 1b:輸 15.6; 2b:輸 22.4; 3p:輸 19.4; 4g:輸 20.1; 5b:輸 22.6; 6b:輸 19.9; 7p:輸 18.8; 8g:輸 22.8; 9b:輸 22.8; 10b:輸 20.3; 11p:輸 19.5; 12g:輸 22.9; 13b:輸 23.1; 14b:輸 19.0; 15p:輸 18.8

## v91-P24-H1-loose-s20

- 版本：#91 的 38c57db（家旁小鎮＋剋法師三條規則）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":true,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 17 局
- 1b:贏 24.5; 2b:贏 17.4; 3p:贏 30.4; 4g:贏 17.3; 5b:贏 20.0; 6b:贏 17.0; 7p:輸 17.6; 8g:贏 32.1; 9b:贏 19.9; 10b:贏 22.1; 11p:贏 17.4; 12g:贏 40.3; 13b:贏 26.8; 14b:贏 25.9; 15p:輸 21.7; 16g:贏 23.4; 17p:輸 19.1; 18b:贏 21.8; 19g:贏 23.4; 20g:贏 17.2

## v91-P24-H1-s20

- 版本：#91 的 38c57db（家旁小鎮＋剋法師三條規則）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":false,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 14 局
- 1b:輸 38.2; 2b:贏 19.4; 3p:輸 25.2; 4g:贏 18.2; 5b:贏 17.4; 6b:贏 17.0; 7p:輸 19.6; 8g:贏 21.7; 9b:贏 17.6; 10b:贏 20.8; 11p:贏 17.0; 12g:輸 31.0; 13b:贏 33.7; 14b:贏 20.4; 15p:輸 22.6; 16g:贏 17.5; 17p:輸 19.6; 18b:贏 37.1; 19g:贏 20.0; 20g:贏 43.0

## v91L1-D-H1-looseall-s15

- 版本：4f0ebca，暫存改動：普通電腦不拿自己家旁的小鎮
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":2,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 0 局
- 1b:輸 43.7; 2b:輸 32.3; 3p:輸 21.1; 4g:輸 25.9; 5b:輸 27.4; 6b:輸 22.0; 7p:輸 21.0; 8g:輸 25.7; 9b:輸 25.3; 10b:輸 25.1; 11p:輸 23.1; 12g:輸 41.7; 13b:輸 25.2; 14b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 38/13/2／電腦 30/2/4）; 15p:輸 27.0

## v91L1-Deco-looseall-s15

- 版本：4f0ebca，暫存改動：普通電腦不拿自己家旁的小鎮
- 打法：{"farmers":30,"production":6,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":2,"woodBias":true,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 0 局
- 1b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 61/4/3／電腦 29/10/5）; 2b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 62/6/2／電腦 35/7/6）; 3p:輸 22.5; 4g:輸 30.8; 5b:輸 46.1; 6b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 9/3/3／電腦 25/5/5）; 7p:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 71/14/5／電腦 29/8/5）; 8g:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 77/1/3／電腦 33/5/4）; 9b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 57/1/1／電腦 18/6/6）; 10b:輸 43.9; 11p:輸 43.5; 12g:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 17/3/1／電腦 29/7/5）; 13b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 49/33/5／電腦 30/6/6）; 14b:到第 50.0還沒結束（主城 我 1073／電腦 1200，兵 我 0/0/0／電腦 30/3/5）; 15p:輸 23.2

## v91L1-P24-H1-looseall-s20

- 版本：4f0ebca，暫存改動：普通電腦不拿自己家旁的小鎮
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":2,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 17 局
- 1b:贏 26.3; 2b:贏 22.8; 3p:輸 24.8; 4g:贏 20.0; 5b:輸 24.3; 6b:贏 24.6; 7p:贏 24.5; 8g:贏 49.8; 9b:贏 15.9; 10b:贏 25.0; 11p:贏 17.3; 12g:贏 26.4; 13b:贏 36.7; 14b:贏 22.0; 15p:贏 29.3; 16g:贏 45.9; 17p:輸 25.2; 18b:贏 20.3; 19g:贏 30.9; 20g:贏 17.0

## v91Y-D-H1-looseall-s15

- 版本：4f0ebca，暫存改動：map.ts 換回 main 的（只加剋法師）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":2,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 4 局
- 1b:輸 33.1; 2b:輸 43.3; 3p:輸 29.5; 4g:輸 33.0; 5b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 49/25/4／電腦 28/4/2）; 6b:贏 35.7; 7p:輸 36.0; 8g:贏 27.4; 9b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 34/24/5／電腦 20/1/2）; 10b:輸 22.1; 11p:輸 23.0; 12g:輸 33.9; 13b:贏 36.0; 14b:贏 21.9; 15p:輸 24.8

## v91Y-D-H1-s15

- 版本：4f0ebca，暫存改動：map.ts 換回 main 的（只加剋法師）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":0,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 5 局
- 1b:輸 49.2; 2b:贏 16.3; 3p:輸 38.7; 4g:贏 29.9; 5b:輸 35.0; 6b:贏 16.8; 7p:輸 22.3; 8g:贏 16.7; 9b:贏 16.2; 10b:輸 37.6; 11p:輸 24.0; 12g:輸 22.0; 13b:輸 48.6; 14b:輸 38.8; 15p:輸 28.6

## v91Y-Deco-looseall-s15

- 版本：4f0ebca，暫存改動：map.ts 換回 main 的（只加剋法師）
- 打法：{"farmers":30,"production":6,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":2,"woodBias":true,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 7 局
- 1b:贏 16.1; 2b:贏 16.7; 3p:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 58/17/6／電腦 24/15/5）; 4g:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 13/1/1／電腦 29/12/4）; 5b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 58/14/6／電腦 20/10/6）; 6b:贏 35.1; 7p:贏 26.7; 8g:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 18/11/2／電腦 20/9/3）; 9b:贏 25.7; 10b:贏 44.4; 11p:輸 29.6; 12g:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 53/15/4／電腦 15/8/1）; 13b:贏 35.1; 14b:輸 28.2; 15p:輸 25.8

## v91Y-P24-H1-looseall-s20

- 版本：4f0ebca，暫存改動：map.ts 換回 main 的（只加剋法師）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":2,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 10 局
- 1b:輸 27.4; 2b:輸 19.0; 3p:贏 21.2; 4g:贏 19.5; 5b:輸 27.4; 6b:贏 23.5; 7p:輸 23.2; 8g:贏 40.7; 9b:輸 31.8; 10b:贏 19.1; 11p:輸 24.0; 12g:贏 29.4; 13b:贏 26.0; 14b:輸 29.7; 15p:贏 29.4; 16g:贏 19.9; 17p:輸 21.1; 18b:贏 18.3; 19g:輸 25.3; 20g:輸 24.7

## v91Y-P24-H1-s20

- 版本：4f0ebca，暫存改動：map.ts 換回 main 的（只加剋法師）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":0,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 17 局
- 1b:贏 14.5; 2b:贏 21.1; 3p:贏 20.0; 4g:贏 22.4; 5b:贏 17.5; 6b:贏 14.4; 7p:輸 27.3; 8g:贏 17.8; 9b:贏 17.6; 10b:贏 29.3; 11p:輸 25.8; 12g:贏 16.8; 13b:贏 14.4; 14b:贏 14.5; 15p:贏 20.7; 16g:贏 17.3; 17p:輸 26.3; 18b:贏 18.3; 19g:贏 16.7; 20g:贏 14.6

## v91b-D-H1-looseall-s15

- 版本：#91 的 4f0ebca（再加 E4）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":2,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 0 局
- 1b:輸 25.1; 2b:輸 30.7; 3p:輸 21.1; 4g:輸 24.9; 5b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 68/25/6／電腦 36/2/4）; 6b:輸 27.5; 7p:輸 21.0; 8g:輸 25.7; 9b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 47/12/6／電腦 24/1/3）; 10b:輸 23.0; 11p:輸 23.0; 12g:輸 35.3; 13b:輸 29.4; 14b:輸 26.7; 15p:輸 22.7

## v91b-Deco-looseall-s15

- 版本：#91 的 4f0ebca（再加 E4）
- 打法：{"farmers":30,"production":6,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":2,"woodBias":true,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 0 局
- 1b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 0/0/0／電腦 46/6/6）; 2b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 65/21/3／電腦 36/1/4）; 3p:輸 22.1; 4g:輸 39.2; 5b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 36/2/1／電腦 30/5/3）; 6b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 46/0/3／電腦 34/2/5）; 7p:輸 32.4; 8g:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 77/1/3／電腦 33/5/4）; 9b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 76/10/4／電腦 27/1/4）; 10b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 54/6/6／電腦 34/3/3）; 11p:輸 42.9; 12g:輸 38.1; 13b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 52/5/1／電腦 25/7/4）; 14b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 70/5/5／電腦 36/4/5）; 15p:輸 22.9

## v91b-P24-H1-looseall-s20

- 版本：#91 的 4f0ebca（再加 E4）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":2,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 17 局
- 1b:贏 23.6; 2b:贏 18.4; 3p:贏 31.4; 4g:贏 17.6; 5b:贏 24.3; 6b:贏 22.5; 7p:輸 20.9; 8g:贏 49.8; 9b:贏 22.9; 10b:贏 17.2; 11p:贏 18.8; 12g:贏 26.5; 13b:贏 18.8; 14b:贏 22.3; 15p:輸 23.5; 16g:贏 23.1; 17p:輸 19.1; 18b:贏 23.1; 19g:贏 30.9; 20g:贏 17.2

## v91b-P24eco-looseall-s15

- 版本：#91 的 4f0ebca（再加 E4）
- 打法：{"farmers":30,"production":6,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":2,"woodBias":true,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 14 局
- 1b:贏 22.1; 2b:贏 18.1; 3p:贏 21.6; 4g:贏 19.7; 5b:贏 18.5; 6b:贏 13.8; 7p:輸 21.9; 8g:贏 27.2; 9b:贏 23.2; 10b:贏 17.2; 11p:贏 18.8; 12g:贏 19.1; 13b:贏 19.7; 14b:贏 20.0; 15p:贏 22.0

## v91e4-D-H1-looseall-s15

- 版本：38c57db，暫存改動：ceo 自己試的 E4（連「照位置走」也放寬）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":0,"vein":0,"loose":2,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 15 局贏 0 局
- 1b:輸 25.4; 2b:輸 26.7; 3p:輸 22.1; 4g:輸 22.3; 5b:到第 50.0還沒結束（主城 我 1200／電腦 1200，兵 我 42/4/2／電腦 28/4/3）; 6b:輸 26.0; 7p:輸 19.4; 8g:輸 35.0; 9b:輸 31.3; 10b:輸 30.7; 11p:輸 22.6; 12g:輸 23.6; 13b:輸 26.4; 14b:輸 25.1; 15p:輸 25.7

## v91e4-P24-H1-looseall-s20

- 版本：38c57db，暫存改動：ceo 自己試的 E4（連「照位置走」也放寬）
- 打法：{"farmers":22,"production":2,"spearShare":50,"townAt":6,"choice":"plunder","again":true,"guards":2,"hallFirst":true,"mageReserve":10,"counterAt":14,"pushAt":24,"vein":0,"loose":2,"woodBias":false,"focus":0,"staticRatio":false,"noMage":false}；每 40 tick 下一次指令；對手 normal
- 20 局贏 15 局
- 1b:贏 27.3; 2b:贏 21.8; 3p:輸 30.6; 4g:贏 17.8; 5b:贏 24.5; 6b:贏 17.1; 7p:輸 21.6; 8g:贏 33.5; 9b:贏 26.5; 10b:贏 24.3; 11p:贏 31.0; 12g:輸 28.2; 13b:贏 23.8; 14b:贏 29.4; 15p:輸 27.0; 16g:贏 17.8; 17p:輸 17.0; 18b:贏 17.2; 19g:贏 27.1; 20g:贏 17.8
