"""R19: what the look over every unit's every action found (ui, 2026-11-10, on the published art-v7.8).

A unit: its board's number and name, its tag, the enlargement of its frames, its findings. A finding:
  id     its number on the board (the tag and it: 農東-1)
  sev    3 高, 2 中, 1 低 (how odd it looks on the phone)
  anims  the actions it shows in
  marks  [(anim, facing, frame, (x, y), r)]: circles, in the px of inspect_r19.py's cell of that action (from its
         top-left; frames from 0 here, from 1 on the boards); the first is the card's picture
  problem, fix: a sentence each;  cost: 小 (a number or a material), 中 (an action), 大 (a model or several actions)
  key    the same thing on other units' boards carries the same key (one row in the table)

A unit's `notes`: {action: a sentence} for something measured or looked at that is not a finding (it goes under the
action's title, among the grounds). `shield`: a mage, drawn at the phone's size inside its shield as the client does.
`checked`: what was looked at and is fine, a line each on the cards' sheet: the weapon's size beside a real one's
(measured on the sprites, facing right: 60 px a metre across, 52 up), the hold, the player colour.
"""

WALK_NOTE = ("量過腳滑：朝右走時，同一隻腳著地的位置前後差約 14 px（手機上約 5 pt）。這個量法分不出腳跟到腳尖的滾動，"
             "下面那一排看起來也幾乎停在同一條線上，所以不列成問題；請看 GIF。步兵共用這個走路。")
HORSE_NOTE = ("馬一個循環前進 1.33 公尺、每秒約 2.4 個循環（騎兵每秒走 1.6 格）；真馬這個速度大約每秒 1.4 步。"
              "腳步可能顯得碎，停格看不出來，沒列成問題；請看 GIF。")
MAGE_WALK_NOTE = "法師的走路是自己的 12 格循環，袍子蓋住腳，停格看不出腳有沒有滑；請看 GIF。"
SHIELD_NOTE = "手機上法師平常罩在護盾（淡青色的球）裡，「手機上的大小」那一排有畫；放大的圖沒畫護盾，才看得到人。"

TPOSE = dict(sev=1, key="tpose", anims=["death"],
             problem="倒下一開始有兩三格（約 0.2 秒）兩臂向兩側甩開、平舉成 T 字；停格看像骨架的預設姿勢，動起來很短。這個倒下是之前核准過的（P2-03：先往後仰、兩臂甩開，再軟倒）。",
             fix="把甩開的兩臂改成不對稱（一高一低、手肘彎著）。步兵和法師共用同一組關鍵格，改一處，但要重算這 8 個兵種；建議等它們有別的理由重算時順便改。",
             cost="中")
SHARDS = dict(sev=1, key="shards", anims=["shatter"],
              problem="護盾是淡青色半透明的球，碎掉時飛出來的卻是純白、不透明的小塊，像紙屑。",
              fix="碎片改成和護盾同色、半透明，邊緣一條亮線。只改特效的材質。", cost="小")
BOW_ARM = dict(sev=1, key="bowarm", anims=["idle", "walk"],
               problem="待機和走路時右手空著、手肘彎著平舉在腰前，像端著東西；走路時這隻手維持同一個姿勢、不擺動（正面、側面、背面都一樣）。",
               fix="右手自然垂下（或搭在箭筒上），走路時右臂前後擺、持弓的手放低。", cost="中")
SCABBARD = dict(sev=1, key="scabbard", anims=["death"],
                problem="倒地後腰上的刀（連鞘）還照站著時的角度固定在腰上：槍兵仰躺，刀鞘穿進地裡，畫出來是身體下面伸出一根黑棍、壓在槍上；騎兵趴著，刀鞘直直朝天豎著。一直到屍體消失。",
                fix="倒地的最後幾格讓刀鞘貼著身體躺平。", cost="小")

UNITS = {
    "farmer_e": dict(no=1, name="農民東陸", tag="農東", n=3, findings=[
        dict(id=1, sev=3, anims=["idle", "walk"],
             marks=[("walk", 0, 2, (107, 79), 17), ("idle", 7, 0, (56, 97), 12), ("idle", 7, 0, (50, 52), 8)],
             problem="斧頭握在柄尾、整根往前伸，斧頭擱在一步外的地上；走路時像推著拖把走。左手也懸空往前伸。",
             fix="照西陸鋤頭改後的拿法：右手握柄的中段垂在身側，斧頭朝下、離地；左手自然垂下。", cost="中"),
        dict(id=2, sev=3, key="axe", anims=["idle", "walk", "attack", "death", "work_chop"],
             marks=[("work_chop", 0, 6, (100, 41), 16), ("death", 0, 8, (115, 111), 16)],
             problem="斧頭太大太白：斧頭長 41 公分、刃口 34 公分、亮鋼色，砍樹和掉在地上時整片發白。真的伐木斧長約 20 公分、刃口約 11 公分。",
             fix="照鋤頭（R16 選 A）的標準：真實大小、暗色舊鐵、刃口一條磨亮的細線。兩國砍樹用同一把，一起改。", cost="小"),
        dict(id=3, sev=2, anims=["attack"],
             marks=[("attack", 0, 5, (33, 55), 18), ("attack", 0, 6, (76, 90), 16)],
             problem="單手握柄尾，兩臂伸直高舉過頭、再伸直往前劈；左手沒握柄，跟著舉在空中。像機器人。",
             fix="照西陸鋤頭攻擊的做法：兩手握柄，舉過右肩斜劈下來。", cost="中"),
        dict(TPOSE, id=4, marks=[("death", 6, 1, (78, 50), 36)]),
        dict(id=5, sev=2, key="pick", anims=["work_mine"],
             marks=[("work_mine", 0, 1, (34, 26), 28)],
             problem="十字鎬太大太白：兩尖全長約 80 公分、根部近 9 公分粗、亮鋼色，舉起來像一把白色的弓。真的鎬頭全長 50–60 公分、約 4 公分粗。",
             fix="真實大小、暗色舊鐵，只有尖端磨亮。和斧頭同一次改。", cost="小"),
        dict(id=6, sev=2, key="mallet", anims=["work_build"],
             marks=[("work_build", 6, 0, (11, 21), 13)],
             problem="木槌的槌頭 17×34 公分，和人的頭一樣大，還單手揮。真的木工槌槌頭約 10×18 公分。",
             fix="槌頭縮到約 10×18 公分。和斧頭同一次改。", cost="小"),
        dict(id=7, sev=1, anims=["work_mine"],
             marks=[("work_mine", 6, 1, (24, 50), 14)],
             problem="舉鎬時左前臂橫在臉前，像在遮眼睛（只有正面看得到）。",
             fix="左手握在柄的下段，手肘朝外。", cost="小"),
    ], notes={"walk": WALK_NOTE}, checked=[
        "鋤頭（種田才拿）：柄 1.3 公尺、鐵頭 15×17 公分、暗色舊鐵，R16 剛改過，和真的钁鋤一樣大。種田動作沒挑到問題。",
        "玩家色：整片圍裙，藍、紅在草地和泥地上都清楚。",
    ]),
    "farmer_w": dict(no=2, name="農民西陸", tag="農西", n=3, findings=[
        dict(id=1, sev=3, key="axe", anims=["work_chop"],
             marks=[("work_chop", 0, 6, (100, 40), 16)],
             problem="斧頭太大太白（和東陸同一把）：斧頭長 41 公分、刃口 34 公分、亮鋼色。",
             fix="真實大小、暗色舊鐵、刃口一條亮線。", cost="小"),
        dict(id=2, sev=2, key="pick", anims=["work_mine"],
             marks=[("work_mine", 0, 1, (35, 27), 28)],
             problem="十字鎬太大太白（和東陸同一把）：兩尖全長約 80 公分、根部近 9 公分粗、亮鋼色。",
             fix="真實大小、暗色舊鐵。", cost="小"),
        dict(id=3, sev=2, key="mallet", anims=["work_build"],
             marks=[("work_build", 6, 0, (11, 21), 13)],
             problem="木槌的槌頭 17×34 公分，和人的頭一樣大（和東陸同一把）。",
             fix="槌頭縮到約 10×18 公分。", cost="小"),
        dict(TPOSE, id=4, marks=[("death", 6, 1, (77, 48), 36)]),
        dict(id=5, sev=1, anims=["idle", "walk"],
             marks=[("idle", 6, 0, (26, 27), 12)],
             problem="玩家色只有肩上一小塊披肩（R8 照中古農民的兜帽披肩做的，兜帽沒戴起來），從正面看只剩領口；東陸是整片圍裙，一眼就看得出是誰的。",
             fix="把兜帽戴起來（頭也是玩家色），或在腰上加一條玩家色的圍裙。", cost="中"),
    ], notes={"walk": WALK_NOTE + "從側面看鋤頭和右腳疊在一起，從正面、背面看鋤頭在腳的外側，沒有穿模。"}, checked=[
        "鋤頭：柄 1.25 公尺、鐵頭 19×19 公分、暗色舊鐵，R16 剛改過。平常右手握柄中段垂在身側，攻擊兩手握柄劈下，種田動作都沒挑到問題。",
    ]),
    "spear_e": dict(no=3, name="槍兵東陸", tag="槍東", n=2, findings=[
        dict(SCABBARD, id=1, marks=[("death", 7, 9, (82, 169), 13)]),
        dict(TPOSE, id=2, marks=[("death", 6, 2, (95, 100), 38)]),
    ], notes={"walk": WALK_NOTE, "sling": "投石時槍立在身旁、左手扶著，和待機（槍平端）之間沒有過渡的格；民兵才會用到，沒列成問題。"}, checked=[
        "槍：立起來約是身高的 1.8 倍。真的步兵長槍 3–4 公尺、是身高的 1.8–2.4 倍，大小合理（偏短的那一端）。",
        "拿法：兩手握槍、平端在腰前，攻擊是兩手往前刺，合理（使用者 2026-10-21 要的雙手持槍）。",
        "腰刀：橫刀，連鞘掛在左腰，模型上約 1 公尺，和真的差不多。",
        "玩家色：袍子的袖子和下襬，藍、紅都清楚。待機、走路、攻擊、投石沒挑到問題。",
    ]),
    "pike_w": dict(no=4, name="槍兵西陸", tag="槍西", n=2, findings=[
        dict(SCABBARD, id=1, marks=[("death", 7, 9, (82, 204), 13)]),
        dict(TPOSE, id=2, marks=[("death", 6, 2, (77, 132), 40)]),
    ], notes={"walk": WALK_NOTE, "sling": "投石時槍立在身旁、左手扶著，和待機（槍平端）之間沒有過渡的格；民兵才會用到，沒列成問題。"}, checked=[
        "長矛：模型上 3.6 公尺，立起來約是身高的 2.3 倍。真的中古長矛 3.5–5.5 公尺、是身高的 2–3 倍，大小合理。",
        "拿法：兩手握矛、平端在腰前，攻擊是兩手往前刺，合理。",
        "腰刀：寬刃的單刃刀（falchion），連鞘掛在左腰，模型上約 70 公分，和真的差不多。",
        "玩家色：整件罩袍，藍、紅都清楚。待機、走路、攻擊、投石沒挑到問題。",
    ]),
    "bow_e": dict(no=5, name="遠程兵東陸", tag="弓東", n=3, findings=[
        dict(BOW_ARM, id=1, marks=[("walk", 6, 2, (21, 61), 11), ("idle", 7, 0, (31, 66), 10)]),
        dict(TPOSE, id=2, marks=[("death", 6, 2, (88, 60), 40)]),
    ], notes={"walk": WALK_NOTE}, checked=[
        "弓：模型上是上弦後 1.22 公尺的角弓，約身高的七成。亞洲的角弓一般 1.1–1.4 公尺，大小合理。",
        "攻擊：左手持弓、右手拉到耳邊再放，箭在弦上，合理。箭筒掛在右腰。",
        "玩家色：整件袍子，藍、紅都清楚。",
    ]),
    "bow_w": dict(no=6, name="遠程兵西陸", tag="弓西", n=3, findings=[
        dict(BOW_ARM, id=1, marks=[("walk", 6, 2, (20, 80), 11), ("idle", 7, 0, (28, 82), 10)]),
        dict(TPOSE, id=2, marks=[("death", 6, 2, (103, 75), 42)]),
    ], notes={"walk": WALK_NOTE}, checked=[
        "弓：約是身高的 0.85–0.9 倍。真的英格蘭長弓 1.8–2 公尺、比人還高，所以這把偏短；手機上看不出來，沒列成問題。",
        "攻擊：左手持弓、右手拉到耳邊再放，合理。",
        "玩家色：兜帽和披肩，藍、紅都清楚。",
    ]),
    "hcav_e": dict(no=7, name="騎兵東陸", tag="騎東", n=2, findings=[
        dict(SCABBARD, id=1, marks=[("death", 0, 9, (193, 162), 18), ("death", 1, 9, (183, 126), 16)]),
    ], notes={"walk": HORSE_NOTE}, checked=[
        "騎槍：模型上連槍頭 2.7 公尺，漆成暗紅。唐代騎兵用的漆槍比步兵的短（《唐六典》），馬槊則長到 4 公尺；這裡是之前特意做短的（柄尾不穿過人）。",
        "拿法：右手握槍、夾在腋下平端，攻擊往前刺，合理。馬的待機、跑步、倒下沒挑到問題。",
        "玩家色：馬甲下緣的布和騎士的袖子，藍、紅都清楚。",
    ]),
    "knight_w": dict(no=8, name="騎兵西陸", tag="騎西", n=2, findings=[
        dict(SCABBARD, id=1, marks=[("death", 0, 9, (192, 165), 18), ("death", 1, 9, (185, 127), 16)]),
    ], notes={"walk": HORSE_NOTE}, checked=[
        "騎槍：模型上連槍頭 2.7 公尺的木槍。真的 1300 年前後的騎槍約 3–3.7 公尺；這裡是之前特意做短的（柄尾不穿過人）。",
        "拿法：右手握槍、夾在腋下平端，攻擊往前刺，合理。馬的待機、跑步、倒下沒挑到問題。",
        "玩家色：整件馬衣和騎士的罩袍，藍、紅都很清楚。",
    ]),
    "mage_e": dict(no=9, name="法師東陸", tag="法東", n=2, shield=True, findings=[
        dict(id=1, sev=1, anims=["cast"],
             marks=[("cast", 7, 19, (89, 76), 28)],
             problem="施法時手前的法陣是六芒星的圓，和西陸法師的一模一樣，是西方魔法陣的樣子，不像東陸（唐末五代）。手機上法陣約 19 pt 寬，只看得出幾圈同心圓，要放大鏡頭才看得出星形。",
             fix="東陸換成八卦或雲雷紋的圓（手前出現法陣是 D-018 定的，這裡只換圖樣）。只改東陸法師的特效圖。", cost="中"),
        dict(SHARDS, id=2, marks=[("shatter", 7, 1, (140, 82), 58)]),
        dict(dict(TPOSE, anims=["fall"]), id=3, marks=[("fall", 6, 2, (78, 46), 50)]),          # (three frames of 12 here)
        dict(id=4, sev=1, anims=["idle", "walk"],
             marks=[("idle", 7, 0, (29, 55), 16)],
             problem="玩家色只有搭在兩肩的帔（胸前兩條、背後一條領子，手機上每條約 2 pt 寬）和腰帶，又罩在護盾裡；西陸法師是整個兜帽和披肩。",
             fix="帔是照唐代道士的法服做的（R8），所以不換掉：把它加寬，或把外袍的領子、袖口鑲邊也改成玩家色。", cost="中"),
    ], notes={"idle": SHIELD_NOTE, "walk": MAGE_WALK_NOTE}, checked=[
        "東陸法師空手，沒有武器。攻擊是單手往前推出一團光，施法是兩手往前、腳下和手前各一個圓，被打時舉手擋，都沒挑到問題。",
        "護盾：淡青色半透明的球，罩著時還看得到人。",
    ]),
    "mage_w": dict(no=10, name="法師西陸", tag="法西", n=2, shield=True, findings=[
        dict(SHARDS, id=1, marks=[("shatter", 7, 1, (141, 85), 58)]),
        dict(dict(TPOSE, anims=["fall"]), id=2, marks=[("fall", 6, 2, (133, 80), 50)]),
    ], notes={"idle": SHIELD_NOTE, "walk": MAGE_WALK_NOTE}, checked=[
        "杖：模型上連頂上的水晶約 2.3 公尺，比人高出一截。真的手杖約 1.5–2 公尺；法師的長杖是設計上的選擇，不算問題。",
        "拿法：右手握杖、杖尾著地；走路時拄著走；攻擊時杖頭往前指、發光；施法時舉杖。都合理。",
        "玩家色：整個兜帽和披肩，藍、紅都清楚。西陸用六芒星的法陣合適。",
    ]),
    "siege_e": dict(no=11, name="攻城砲東陸", tag="砲東", n=1.5, findings=[
        dict(id=1, sev=2, anims=["attack"],
             marks=[("attack", 7, 4, (218, 260), 45)],
             problem="東陸的砲是人拉繩子發射的拽索砲，可是沒有人：繩子垂到地上，砲桿自己甩出去；甩上去那三格，繩子和待機時一樣垂著（量過，那一塊只差 3 個像素）。",
             fix="便宜的做法：發射那幾格讓繩子被往下拉緊再彈回（改一個動作）。完整的做法：加 2–4 名拉繩子的人（大）。", cost="中"),
    ], notes={"idle": "待機 8 格完全相同（旗子不動）。砲站著本來就不動，沒列成問題。"}, checked=[
        "大小：比人高一倍多的四輪砲車。真的拽索砲更大（要幾十人拉）；遊戲裡縮成一個兵的大小，不算問題。",
        "走路時輪子會轉（美術包裡記了一個循環前進 0.66 公尺，遊戲照這個播；沒有另外量對不對得上）。倒下是整台散開，合理。",
        "玩家色：兩側的布和旗，藍、紅都清楚。",
    ]),
    "siege_w": dict(no=12, name="攻城砲西陸", tag="砲西", n=1.5, findings=[
        dict(id=1, sev=2, anims=["walk"],
             marks=[("walk", 0, 2, (140, 190), 34)],
             problem="西陸的砲沒有輪子，走路的 8 格完全相同（量過，一個像素都沒變）：移動時整台貼著地面滑行。東陸的砲有輪子、會轉。固定木架是 2026-10-21 照史實改的（配重砲；原本帶輪子的扭力砲沒有中古依據）。",
             fix="底架下加四個實心小木輪或墊滾木，走路時轉。這是遷就遊戲（真的配重砲是拆開搬、到了再組）；也可以維持現狀。要改模型、重算西陸攻城砲。", cost="中"),
    ], notes={"idle": "待機 8 格完全相同（旗子不動）。砲站著本來就不動，沒列成問題。"}, checked=[
        "大小：模型上砲臂 3.4 公尺的配重砲。真的配重砲砲臂 8–15 公尺；遊戲裡縮成一個兵的大小，不算問題。",
        "攻擊：配重落下、砲臂甩上去、石頭從皮兜飛出，合理。倒下是整台垮掉，合理。",
        "玩家色：配重箱的布和旗，藍、紅都清楚。",
    ]),
}


def others(unit, f):
    """The tags of the same finding on other units' boards."""
    if not f.get("key"):
        return []
    return [f"{s['tag']}-{g['id']}" for u, s in UNITS.items() if u != unit for g in s["findings"] if g.get("key") == f["key"]]
