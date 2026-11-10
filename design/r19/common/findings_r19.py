"""R19: what the look over every unit's every action found (ui, 2026-11-10, on the published art-v7.8).

A unit: its board's number and name, its tag, the enlargement of its frames, its findings. A finding:
  id     its number on the board (the tag and it: 農東-1)
  sev    3 高, 2 中, 1 低 (how odd it looks on the phone)
  anims  the actions it shows in
  marks  [(anim, facing, frame, (x, y), r)]: circles, in the px of inspect_r19.py's cell of that action (from its
         top-left); the first is the card's picture
  problem, fix: a sentence each;  cost: 小 (a number or a material), 中 (an action), 大 (a model or several actions)
  same   the same thing on another unit's board (one row in the table)
  slide  [frame, frame]: the card's picture is these two frames of the walk over the ground's ticks
"""

SLIDE = dict(sev=1, anims=["walk"], slide=[3, 5],
             problem="走路時踩在地上的腳會滑：同一隻腳從第 4 格到第 6 格往後滑了約 14 px（手機上約 5 pt、地上約 25 公分）。步兵共用這個走路，都一樣；手機上不明顯。",
             fix="把走路循環裡著地那隻腳改成等速往後（一個函式）。要重算所有步兵，不建議單獨改；下次有別的理由重算時順便改。", cost="大")

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
        dict(id=4, sev=2, anims=["death"], same="農西-5",
             marks=[("death", 6, 1, (78, 50), 36)],
             problem="倒下的第 2、3 格兩臂向兩側平舉成 T 字，像骨架的預設姿勢。",
             fix="改成被打到往後仰，兩手不對稱地揚起。", cost="中"),
        dict(id=5, sev=2, anims=["work_mine"], same="農西-3",
             marks=[("work_mine", 0, 1, (34, 26), 28)],
             problem="十字鎬太大太白：兩尖全長約 80 公分、4.4 公分粗、亮鋼色，舉起來像一把白色的弓。真的鎬頭全長 50–60 公分。",
             fix="真實大小、暗色舊鐵，只有尖端磨亮。和斧頭同一次改。", cost="小"),
        dict(id=6, sev=2, anims=["work_build"], same="農西-4",
             marks=[("work_build", 7, 1, (64, 45), 16), ("work_build", 0, 0, (46, 34), 16)],
             problem="木槌的槌頭 17×34 公分，比人的頭還大，單手揮；舉起來時貼在臉前。",
             fix="槌頭縮到約 10×18 公分；舉在右肩外側，不擋臉。", cost="小"),
        dict(id=7, sev=1, anims=["work_mine"],
             marks=[("work_mine", 6, 1, (24, 50), 14)],
             problem="舉鎬時左前臂橫在臉前，像在遮眼睛（只有正面看得到）。",
             fix="左手握在柄的下段，手肘朝外。", cost="小"),
        dict(SLIDE, id=8, same="農西-7", marks=[("walk", 0, 3, (49, 109), 9), ("walk", 0, 5, (15, 105), 9)]),
    ]),
    "farmer_w": dict(no=2, name="農民西陸", tag="農西", n=3, findings=[
        dict(id=2, sev=2, anims=["walk"],
             marks=[("walk", 0, 2, (61, 99), 11)],
             problem="走路時鋤頭垂在右腳前，每一步右腳都踩進鋤頭裡（穿模）。",
             fix="走路時把鋤頭提到小腿一半高、往外側移 10 公分；或走路改成扛在肩上。", cost="中"),
        dict(id=1, sev=3, anims=["work_chop"], same="農東-2",
             marks=[("work_chop", 0, 6, (100, 40), 16)],
             problem="斧頭太大太白（和東陸同一把）：斧頭長 41 公分、刃口 34 公分、亮鋼色。",
             fix="真實大小、暗色舊鐵、刃口一條亮線。", cost="小"),
        dict(id=3, sev=2, anims=["work_mine"], same="農東-5",
             marks=[("work_mine", 0, 1, (35, 27), 28)],
             problem="十字鎬太大太白（和東陸同一把）：兩尖全長約 80 公分、亮鋼色。",
             fix="真實大小、暗色舊鐵。", cost="小"),
        dict(id=4, sev=2, anims=["work_build"], same="農東-6",
             marks=[("work_build", 7, 1, (60, 45), 16)],
             problem="木槌的槌頭比人的頭還大（和東陸同一把），舉起來時貼在臉前。",
             fix="槌頭縮到約 10×18 公分；舉在右肩外側。", cost="小"),
        dict(id=5, sev=2, anims=["death"], same="農東-4",
             marks=[("death", 6, 1, (77, 48), 36)],
             problem="倒下的第 2、3 格兩臂向兩側平舉成 T 字（和東陸一樣）。",
             fix="改成被打到往後仰，兩手不對稱地揚起。", cost="中"),
        dict(id=6, sev=1, anims=["idle", "walk"],
             marks=[("idle", 6, 0, (27, 38), 12)],
             problem="玩家色只有肩上一小塊披肩，從正面看只剩領口；東陸是整片圍裙，一眼就看得出是誰的。",
             fix="頭巾也用玩家色，或在腰上加一條玩家色的圍裙。", cost="中"),
        dict(SLIDE, id=7, same="農東-8", marks=[("walk", 0, 3, (46, 109), 9), ("walk", 0, 5, (12, 105), 9)]),
    ]),
}
