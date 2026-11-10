"""R19: what the look over every unit's every action found (ui, 2026-11-10, on the published art-v7.8).

A unit: its board's number and name, its tag, the enlargement of its frames, its findings. A finding:
  id     its number on the board (the tag and it: 農東-1)
  sev    3 高, 2 中, 1 低 (how odd it looks on the phone)
  anims  the actions it shows in
  marks  [(anim, facing, frame, (x, y), r)]: circles, in the px of inspect_r19.py's cell of that action (from its
         top-left); the first is the card's picture
  problem, fix: a sentence each;  cost: 小 (a number or a material), 中 (an action), 大 (a model or several actions)
  same   the same thing on another unit's board (one row in the table)

A unit's `notes`: {action: a sentence} for something measured that is not a finding (it goes under the action's
title, among the grounds).
"""

WALK_NOTE = ("量過腳滑：朝右走時，同一隻腳著地的位置前後差約 14 px（手機上約 5 pt）。這個量法分不出腳跟到腳尖的滾動，"
             "下面那一排看起來也幾乎停在同一條線上，所以不列成問題；請看 GIF。步兵共用這個走路。")

UNITS = {
    "farmer_e": dict(no=1, name="農民東陸", tag="農東", n=3, findings=[
        dict(id=1, sev=3, anims=["idle", "walk"],
             marks=[("walk", 0, 2, (107, 79), 17), ("idle", 7, 0, (56, 97), 12), ("idle", 7, 0, (50, 52), 8)],
             problem="斧頭握在柄尾、整根往前伸，斧頭擱在一步外的地上；走路時像推著拖把走。左手也懸空往前伸。",
             fix="照西陸鋤頭改後的拿法：右手握柄的中段垂在身側，斧頭朝下、離地；左手自然垂下。", cost="中"),
        dict(id=2, sev=3, anims=["idle", "walk", "attack", "death", "work_chop"], same="農西-1",
             marks=[("work_chop", 0, 6, (100, 41), 16), ("death", 0, 8, (115, 111), 16)],
             problem="斧頭太大太白：斧頭長 41 公分、刃口 34 公分、亮鋼色，砍樹和掉在地上時整片發白。真的伐木斧長約 20 公分、刃口約 11 公分。",
             fix="照鋤頭（R16 選 A）的標準：真實大小、暗色舊鐵、刃口一條磨亮的細線。兩國砍樹用同一把，一起改。", cost="小"),
        dict(id=3, sev=2, anims=["attack"],
             marks=[("attack", 0, 5, (33, 55), 18), ("attack", 0, 6, (76, 90), 16)],
             problem="單手握柄尾，兩臂伸直高舉過頭、再伸直往前劈；左手沒握柄，跟著舉在空中。像機器人。",
             fix="照西陸鋤頭攻擊的做法：兩手握柄，舉過右肩斜劈下來。", cost="中"),
        dict(id=4, sev=1, anims=["death"], same="農西-4",
             marks=[("death", 6, 1, (78, 50), 36)],
             problem="倒下一開始有兩格（約 0.17 秒）兩臂向兩側平舉成 T 字；停格看像骨架的預設姿勢，動起來很短。",
             fix="改成被打到往後仰，兩手不對稱地揚起。共用的倒下動作，下次重算時順便改。", cost="中"),
        dict(id=5, sev=2, anims=["work_mine"], same="農西-2",
             marks=[("work_mine", 0, 1, (34, 26), 28)],
             problem="十字鎬太大太白：兩尖全長約 80 公分、根部近 9 公分粗、亮鋼色，舉起來像一把白色的弓。真的鎬頭全長 50–60 公分、約 4 公分粗。",
             fix="真實大小、暗色舊鐵，只有尖端磨亮。和斧頭同一次改。", cost="小"),
        dict(id=6, sev=2, anims=["work_build"], same="農西-3",
             marks=[("work_build", 6, 0, (11, 21), 13)],
             problem="木槌的槌頭 17×34 公分，和人的頭一樣大，還單手揮。真的木工槌槌頭約 10×18 公分。",
             fix="槌頭縮到約 10×18 公分。和斧頭同一次改。", cost="小"),
        dict(id=7, sev=1, anims=["work_mine"],
             marks=[("work_mine", 6, 1, (24, 50), 14)],
             problem="舉鎬時左前臂橫在臉前，像在遮眼睛（只有正面看得到）。",
             fix="左手握在柄的下段，手肘朝外。", cost="小"),
    ], notes={"walk": WALK_NOTE}),
    "farmer_w": dict(no=2, name="農民西陸", tag="農西", n=3, findings=[
        dict(id=1, sev=3, anims=["work_chop"], same="農東-2",
             marks=[("work_chop", 0, 6, (100, 40), 16)],
             problem="斧頭太大太白（和東陸同一把）：斧頭長 41 公分、刃口 34 公分、亮鋼色。",
             fix="真實大小、暗色舊鐵、刃口一條亮線。", cost="小"),
        dict(id=2, sev=2, anims=["work_mine"], same="農東-5",
             marks=[("work_mine", 0, 1, (35, 27), 28)],
             problem="十字鎬太大太白（和東陸同一把）：兩尖全長約 80 公分、根部近 9 公分粗、亮鋼色。",
             fix="真實大小、暗色舊鐵。", cost="小"),
        dict(id=3, sev=2, anims=["work_build"], same="農東-6",
             marks=[("work_build", 6, 0, (11, 21), 13)],
             problem="木槌的槌頭 17×34 公分，和人的頭一樣大（和東陸同一把）。",
             fix="槌頭縮到約 10×18 公分。", cost="小"),
        dict(id=4, sev=1, anims=["death"], same="農東-4",
             marks=[("death", 6, 1, (77, 48), 36)],
             problem="倒下一開始有兩格（約 0.17 秒）兩臂向兩側平舉成 T 字（和東陸一樣）；動起來很短。",
             fix="改成被打到往後仰，兩手不對稱地揚起。", cost="中"),
        dict(id=5, sev=1, anims=["idle", "walk"],
             marks=[("idle", 6, 0, (26, 27), 12)],
             problem="玩家色只有肩上一小塊披肩，從正面看只剩領口；東陸是整片圍裙，一眼就看得出是誰的。",
             fix="頭巾也用玩家色，或在腰上加一條玩家色的圍裙。", cost="中"),
    ], notes={"walk": WALK_NOTE + "從側面看鋤頭和右腳疊在一起，從正面、背面看鋤頭在腳的外側，沒有穿模。"}),
}
