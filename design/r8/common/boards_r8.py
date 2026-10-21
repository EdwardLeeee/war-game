"""R8 (D-093) approval drafts for the units: one board per unit, a GIF of its animations, and the readability numbers
measured on every frame of every direction (not a sample: the brief's must-pass rule).

python3 design/r8/common/boards_r8.py UNIT ATLAS_DIR [UNIT ATLAS_DIR ...]
  ATLAS_DIR  the unit's 3x atlas (atlas_x3/ with <unit>.json: the production pipeline with R7_VERSION=8)
  writes design/r8/out/R8-<nn>-<名>-<東陸|西陸>-mobile.png, ...-動作.gif, and design/r8/out/readability.json

Readability, per frame and per team colour (blue, red), on the R8 ground graded by GRADE (a clean stretch of grass):
  contrast   |L*(unit) - L*(ground)|: the soldier's mean lightness against the ground's (CIE L*, 0-100)
  visible    the share of the soldier's pixels at least 20 apart from the ground's colour (CIE Lab, delta E 1976):
             lightness and colour both count (blue and red on green read by hue as much as by lightness)
  team       the share of the soldier's pixels in the player colour (the team layer's coverage)
GRADE is the ground's "grade" in client's ground.json (agreed 2026-10-21): linear RGB, saturation toward the
luminance, then brightness. 1.1 / 0.85 measured best on the East archer (lightness gap up, colour gap held).
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
R8 = HERE.parent
sys.path.insert(0, str(R8.parent / "r6" / "common"))
import boards   # noqa: E402
import field    # noqa: E402

OUT = R8 / "out"
BUILD = R8 / "build"
boards.OUT = OUT
PPM = 60
FACINGS = range(8)
GRADE = dict(brightness=1.1, saturation=0.85)
# the units' numbers and names on the boards (the brief's table)
UNITS = {
    "farmer_e": (1, "村民", "東陸"), "farmer_w": (2, "村民", "西陸"), "spear_e": (3, "槍兵", "東陸"),
    "pike_w": (4, "長矛兵", "西陸"), "bow_e": (5, "弓手", "東陸"), "bow_w": (6, "長弓兵", "西陸"),
    "hcav_e": (7, "具裝騎兵", "東陸"), "knight_w": (8, "騎士", "西陸"), "siege_e": (9, "霹靂車", "東陸"),
    "siege_w": (10, "投石機", "西陸"), "mage_e": (11, "術士", "東陸"), "mage_w": (12, "晶術師", "西陸"),
}
WHAT = {
    "spear_e": "東陸槍兵（唐末五代的樣子，照 ceo 的考據筆記）：MPFB 寫實人體；札甲（一排排小甲片）、三層披膊、及膝腿裙，"
               "碗形兜鍪加頓項，甲下圓領袍，行縢加靴，左腰直的橫刀；雙手持槍，紮槍由後手推。玩家色是袍子（袖子、袍腳）和頓項。",
    "farmer_e": "東陸村民（唐末五代的樣子，照 ceo 的考據筆記）：MPFB 寫實人體；頭巾包髻，麻布短衫、長褲、綁腿、草鞋；"
                "工作動作照舊（砍、挖、鋤、敲）。玩家色是腰間的圍裙和腰帶。",
    "hcav_e": "東陸具裝騎兵（唐末五代的樣子，照 ceo 的考據筆記）：騎者 MPFB 寫實人體，札甲、兜鍪加頓項；漆槍；"
              "馬披全套黑漆札甲（面簾、雞項、盪胸、馬身甲、搭後）。玩家色是騎者的袖子、頓項和馬甲下緣一圈。馬換成寫實馬（CC0，見要點⑦）。",
    "siege_e": "東陸霹靂車：拉索式的砲車（木架、砲梢、一排拉索、拋石的兜），裝在輪子上。考據筆記沒有寫到砲車，參考圖是另外找的《武經總要》。"
               "玩家色是架頂的旗。",
    "mage_e": "東陸術士（唐代道士，照 ceo 的考據筆記）：MPFB 寫實人體；頭頂盤髻、小蓮花冠加簪，木蘭色寬袖褐，玩家色的帔，"
              "露出黃裙；施法只用單手劍指（D-018）。玩家色是帔、腰帶和袖口。",
    "pike_w": "西陸長矛兵（約 1250 年，照 ceo 的考據筆記）：MPFB 寫實人體；直條縫線的棉甲、壺盔、玩家色的素面罩袍、腰間單刃刀；"
              "3.6 m 長槍雙手持，不拿盾。玩家色是罩袍。",
    "bow_w": "西陸長弓兵（約 1250 年，照 ceo 的考據筆記）：MPFB 寫實人體；本色及膝上衣、長襪、玩家色連肩頭巾，持弓臂綁護腕；"
             "和人差不多高的單體長弓，箭一捆插在右腰。拉弓拉到臉頰，放箭後箭由遊戲另外畫。玩家色是頭巾。",
    "knight_w": "西陸騎士（約 1250 年，照 ceo 的考據筆記）：騎者 MPFB 寫實人體，鎖子甲、玩家色罩袍、平頂桶盔、畫國徽的三角盾、"
                "木矛加玩家色雙尾小旗、十字劍；寫實馬（CC0）披玩家色布馬衣到小腿。玩家色是罩袍、馬衣、小旗。",
    "farmer_w": "西陸村民（約 1250 年，照 ceo 的考據筆記）：MPFB 寫實人體；本色及膝上衣束腰、白亞麻內褲、白亞麻小帽、玩家色連肩頭巾；"
                "工作動作照舊。玩家色是頭巾。",
    "mage_w": "西陸晶術師（照 ceo 的考據筆記）：MPFB 寫實人體；學者的黑色及踵圓斗篷，兜帽拉起用玩家色；長鬍子；書裝在腰間皮袋；"
              "木杖頂用樹根抓住魔晶，沒有金屬。玩家色是兜帽和披肩。",
    "siege_w": "西陸投石機（照 ceo 的考據筆記）：配重投石機，固定的木頭底座、兩片 A 字架、長臂、帶鉸鏈的配重箱、皮兜、絞盤；"
               "沒有輪子。玩家色是架上的旗。",
    "bow_e": "東陸弓手（唐末五代的樣子，照 ceo 的考據筆記）：MPFB 寫實人體；圓領缺胯袍、黑革帶、黑色軟幞頭，右腰有蓋的胡祿、"
             "左腰弓袋，行縢加靴；角弓上下對稱、握中間。拉弓拉到臉頰，放箭時手往耳後甩；弓弦跟著右手，放箭後箭由遊戲另外畫。"
             "玩家色是袍子。",
}
# the reference pictures beside each board (ceo's note, research/east-reference/: R8_REFS points there; only the
# public-domain and CC0 ones, LICENSES.md: the CC BY-SA ones stay out of the repo and the pictures) and the points
# taken from them, each with how well it is known: 一手 (period text, object or picture), 二手 (modern work), 推論
# (inferred), 設計選擇 (ours)
REFS = {
    "farmer_e": dict(
        images=[
            ("build:cma_145350.jpg", (560, 230, 1960, 3290),
             "隋唐之際（6 世紀末–7 世紀初）馬伕俑：幹活的人穿短衫、包頭、穿靴。CC0，克里夫蘭美術館 1970.58。"),
        ],
        points=[
            "① 頭巾包髻：頭頂紮髻，用布包起來，在後面打結。〔一手：唐代勞動者俑（筆記圖 14，CC BY-SA，只看不放）、左圖的馬伕俑〕"
            "拿掉斗笠：筆記說農夫可以戴斗笠（敦煌 23 窟〈雨中耕作圖〉），但原本的笠使用者看成日本的，改成頭巾是設計選擇。",
            "② 麻布本色的短衫、長褲、綁腿、草鞋。〔一手：唐代勞動者俑；筆記：顏色用麻布本色，不要鮮豔〕",
            "③ 玩家色是腰間的圍裙和腰帶。〔設計選擇〕　④ 工具（斧、鎬、鋤、錘）和工作動作照舊，沒有另外考據工具的形狀。",
        ]),
    "hcav_e": dict(
        images=[
            ("01-張議潮統軍出行圖-甲騎旗隊與樂舞.jpg", (1000, 880, 1560, 1260),
             "圖 01　〈張議潮統軍出行圖〉局部（約 851–867 年）：騎者穿札甲、兜鍪連頓項；馬沒有披甲。公有領域（PD-Art），Wikimedia Commons。"),
            ("build:met_52556_full.jpg", (60, 120, 1340, 1700),
             "北魏（6 世紀）甲馬騎俑：人馬都披甲，馬的頭、頸、身、臀分塊。比遊戲時代早約 300 年。CC0，大都會博物館 20.39.3。"),
            ("build:met_52555_full.jpg", (150, 250, 3100, 3850),
             "同一批的另一件（20.39.2）：面簾包住馬臉，甲從頸、胸一路蓋到臀。CC0，大都會博物館。"),
        ],
        points=[
            "① 騎者：札甲、三層披膊、腿裙，兜鍪加頓項，同槍兵；拿掉背旗。〔一手：圖 01〕",
            "② 馬甲五塊：面簾、雞項、盪胸、馬身甲、搭後，黑漆札甲、紅繩。〔一手：唐律「具裝」、《唐六典》「馬甲」；部件名照《武經總要》（宋，1044）；"
            "整體輪廓參考中、右兩圖（北魏，比遊戲時代早）〕",
            "③ 人馬都披全套甲是設計選擇：晚唐五代常見人披甲、馬不披甲（圖 01）。〔筆記〕",
            "④ 漆槍，比步兵的槍短：全長 2.6 m。〔一手：《唐六典》「漆槍短，騎兵用之」；長度是設計選擇〕",
            "⑤ 沒有馬屁股上的扇形「寄生」，拿掉馬頭的纓和金珠。〔筆記：寄生是北朝的東西〕",
            "⑥ 玩家色：騎者的袖子、頓項，馬身甲下緣一圈。〔設計選擇〕",
            "⑦ 馬換成 CC0 的寫實馬（Lyndon Daniels 做、ChadM 加骨架，OpenGameArt），綁到我們的馬骨架，馬甲照新馬的身形重做。"
            "原模型是比較粗壯的挽馬，馬的品種和體型沒有另外考據。",
        ]),
    "siege_e": dict(
        images=[
            ("build:c_Xuanfengwupao.jpg", (0, 0, 400, 609),
             "《武經總要》（宋，1044 年成書；這是後世刻本）〈旋風五砲〉：一根立柱上裝砲梢，梢頭一排拉索。公有領域，Wikimedia Commons。"),
            ("build:c_Hudunpao-wujingzongyao.jpg", (0, 0, 400, 581),
             "《武經總要》〈虎蹲砲〉：斜撐的木架上裝砲梢，一頭拉索、一頭拋石的兜。公有領域，Wikimedia Commons。"),
        ],
        points=[
            "① 考據筆記沒有寫到砲車；這兩張圖是另外找的，年代是宋（1044），比遊戲時代晚約 100 年。",
            "② 和《武經總要》一樣的地方：木架、砲梢、梢頭一排拉索（人拉，不是配重）、拋石的兜。〔一手，宋〕",
            "③ 不一樣的地方：裝了四個輪子，方便在遊戲裡移動，是設計選擇；書裡的砲大多不裝輪。沒有畫拉索的人。",
            "④ 模型這一輪沒有改（只換寫實材質和打光）。",
        ]),
    "mage_e": dict(
        images=[
            ("build:cma_163118_print.jpg", (1410, 1040, 3080, 2200),
             "南宋（13 世紀）〈道釋圖冊〉第 20 開〈道教神祇行列〉局部：頭頂髻上戴小冠、寬袖長袍、肩上披帔。比遊戲時代晚約 300 年。"
             "CC0，克里夫蘭美術館 2004.1.20。"),
        ],
        points=[
            "① 頭：頭頂盤髻，戴小蓮花冠（芙蓉冠），橫插簪子；不戴幞頭、不戴盔。〔一手：《洞玄靈寶三洞奉道科戒營始》、張萬福《三洞法服科戒文》〕",
            "② 身：寬袖長袍（褐），木蘭色；外披長帔到膝，用玩家色；前面露出黃裙。〔一手：同上「黃裙」、《唐六典》道士衣色「木蘭、青碧、皂荊黃」；"
            "帔用玩家色是設計選擇〕黃裙用土黃，不用皇帝的亮黃。",
            "③ 施法只用單手劍指（食指和中指併攏）。〔D-018；劍指的記載多是宋以後，二手〕",
            "④ 拿掉：背上的劍、長馬尾、淡青色長袍（修仙漫畫的樣子）。〔筆記〕　⑤ 不穿任何金屬；冠和簪是漆和骨。",
            "⑥ 參考圖是南宋的畫，唐代道士的圖這一輪沒找到可以公開用的（筆記的圖 15 是 CC BY-SA，只看不放）。",
        ]),
    "pike_w": dict(
        images=[
            ("west:05-摩根聖經10r-步兵棉甲壺盔與騎士-約1250年.jpg", (237, 275, 1600, 1100),
             "圖 05　摩根聖經 10r（約 1250 年）：左邊的步兵穿棉甲、戴壺盔，雙手握長柄武器；騎士穿鎖子甲和罩袍。公有領域，摩根圖書館 MS M.638。"),
        ],
        points=[
            "① 棉甲＋鐵帽＋長矛＋刀，是平民步兵的標準配備。〔證據：1181 年《武裝敕令》、1285 年《溫徹斯特法令》〕棉甲做直條縫線。〔證據：圖 05 的畫法〕",
            "② 壺盔（寬簷鐵帽）。〔證據：摩根聖經的步兵大量戴〕　③ 素面罩袍用玩家色。〔證據＋設計選擇：侍從穿領主主色的素面罩袍〕",
            "④ 雙手持 3.6 m 長槍、不拿盾：設計選擇。11–13 世紀圖像主要是單手矛＋盾；雙手持長槍成陣要到 1298、1302 年才明確。"
            "法令的長槍約 4–5 m，這裡縮短是為了畫框和手機記憶體。〔證據＋設計選擇〕",
            "⑤ 腰間單刃刀（十字護手）。〔證據：13 世紀的索普單刃刀〕　⑥ 拿掉鐵肩甲：板甲是 14 世紀以後。〔證據〕",
        ]),
    "bow_w": dict(
        images=[
            ("west:10-勒特雷爾詩篇-長弓練習-14世紀.jpg", (0, 0, 1123, 763),
             "圖 10　勒特雷爾詩篇（約 1325–35，比基準晚）：長弓和人差不多高，拉到胸口和臉旁；連肩頭巾、及膝上衣、長襪；備用的箭和弓一起握在手。"
             "公有領域，大英圖書館。"),
            ("west:06-摩根聖經23v-騎士桶盔馬衣與投石機-約1250年.jpg", (1950, 0, 2640, 430),
             "圖 06 局部（約 1250 年）：塔上的弓手，弓比人矮，持弓手同時握著幾支箭。公有領域，摩根圖書館。"),
        ],
        points=[
            "① 一根木頭的單體弓，上下對稱、握在中間，沒有反曲；約和人一樣高。〔證據：瑪麗玫瑰號實物（1545）；弓長是設計選擇：約 1250 年的弓應該更短（圖 06）〕",
            "② 箭一捆插在右腰的腰帶上，不背在背上。〔證據：學者整理 11–16 世紀圖像；背上的箭袋幾乎沒有證據〕拿掉原本背上的箭袋。",
            "③ 本色及膝上衣、長襪、連肩頭巾（玩家色）、持弓臂的皮護腕。〔證據＋設計選擇〕",
            "④ 長弓兵的全盛期是 1298–1415 年，比基準晚；塞勒斯「商業城邦＋長弓」是遊戲設定，歷史上商業共和國用弩手。〔證據〕",
        ]),
    "knight_w": dict(
        images=[
            ("west:06-摩根聖經23v-騎士桶盔馬衣與投石機-約1250年.jpg", (510, 390, 2580, 1680),
             "圖 06　摩根聖經 23v（約 1250 年）：騎士戴平頂桶盔、穿鎖子甲和罩袍，馬披布馬衣連頭罩住。公有領域，摩根圖書館。"),
            ("west:08-達伯農銅像版畫-鎖子甲罩袍與三角盾-傳1277年.jpg", (0, 0, 1777, 3000),
             "圖 08　達伯農銅像（19 世紀版畫，原件約 1277–1327）：鎖子甲連頭罩、罩袍、三角盾、長矛。公有領域。"),
        ],
        points=[
            "① 鎖子甲（連頭罩、手套、腿甲）外面套玩家色罩袍，前後開衩方便騎馬。〔證據：圖 06、08〕",
            "② 平頂桶盔，前面有眼縫和透氣孔。〔證據：圖 06；達根桶盔實物〕　③ 三角盾畫國徽（雙塔），不跟著玩家色變。〔證據＋設計選擇〕",
            "④ 白蠟木長矛約 3.6 m，掛玩家色雙尾小旗；十字劍掛左腰。〔證據；長度是設計選擇〕",
            "⑤ 馬換成 CC0 的寫實馬（同具裝騎兵），披玩家色布馬衣到小腿。〔證據：圖 06；顏色是設計選擇〕拿掉馬身的紋章片和鐵面（馬頭鐵面約 1250 年後才有）。",
        ]),
    "farmer_w": dict(
        images=[
            ("west:11-摩根聖經17v-收割的農民-約1250年.jpg", (325, 250, 1725, 1050),
             "圖 11　摩根聖經 17v（約 1250 年）：收割的人穿及膝上衣、白亞麻小帽、寬簷草帽，有人穿長襪。公有領域，摩根圖書館。"),
            ("west:12-勒特雷爾詩篇74v-打穀的農民-14世紀.jpg", (0, 0, 1679, 857),
             "圖 12　勒特雷爾詩篇 74v（約 1325–35，比基準晚）：打穀。只參考動作，衣形較晚。CC0，大英圖書館。"),
        ],
        points=[
            "① 及膝上衣，腰帶束起；白亞麻內褲。〔證據：圖 11〕　② 白亞麻小帽，外加連肩頭巾（玩家色）。〔證據＋設計選擇〕",
            "③ 顏色：本色（米白、灰褐）的衣服，加褪色的紅褐長襪；不要全身土褐色。〔證據：便宜的菘藍、茜草染料〕",
            "④ 拿掉原本的圍兜和頭巾。工具和工作動作照舊，沒有另外照筆記換成鐮刀、連枷、乾草叉。",
        ]),
    "mage_w": dict(
        images=[
            ("west:14-托雷多道德聖經-獻辭頁-神職學者口述-約1230年.jpg", (100, 1560, 950, 2570),
             "圖 14　托雷多道德化聖經獻辭頁（1227–34）：教士學者穿深色、長到腳的連帽寬袍，剃鬍。公有領域，摩根圖書館 M.240。"),
            ("west:15-沃爾托利納-波隆那大學講課-學袍長鬚-14世紀後半.jpg", (0, 0, 1500, 1350),
             "圖 15　波隆那大學講課圖（14 世紀後半，比基準晚）：老師和年長的聽講者留長鬍子、戴兜帽。公有領域標章，柏林國家博物館。"),
        ],
        points=[
            "① 黑色、圓形、長到腳跟的閉合斗篷，連帽。〔證據：1215 年巴黎大學章程、1222 年蘭頓的命令〕兜帽拉起，用玩家色。〔設計選擇〕",
            "② 長鬍子是設計選擇：13 世紀巴黎的教士學者剃鬍（圖 14），長鬍子學者見於 14 世紀義大利（圖 15）。",
            "③ 書裝在腰間的皮袋：腰帶書是 15 世紀的東西。〔證據〕　④ 杖頂用木頭和樹根抓住魔晶，不用金屬。〔設計選擇：金屬干擾魔晶〕",
            "⑤ 不戴尖頂帽：中世紀尖頂帽是標記猶太人的帽子。〔證據〕拿掉原本的寬袖、披帶、小帽。",
        ]),
    "siege_w": dict(
        images=[
            ("west:06-摩根聖經23v-騎士桶盔馬衣與投石機-約1250年.jpg", (0, 0, 1680, 750),
             "圖 06 局部（約 1250 年）：拋石機的長臂，短臂端吊一個長方形箱子（看起來是配重箱），長臂端的皮兜由一個人拉下。公有領域，摩根圖書館。"),
            ("west:13-現代重建-配重投石機-卡斯泰爾諾城堡.jpg", (0, 0, 2677, 2064),
             "圖 13　法國卡斯泰爾諾城堡的現代重建配重投石機（不是中世紀原物）。CC0，Jebulon 攝。"),
        ],
        points=[
            "① 配重投石機：一根長臂架在兩片 A 字形木架之間的軸上；短臂端吊裝石頭泥土的大木箱，長臂端掛皮兜；底座是固定的木頭框架。"
            "〔證據：西方約 1215 年以後；圖 06、13〕",
            "② 用絞盤把長臂拉下來上弦。〔證據＋推論〕　③ 沒有輪子：中世紀歐洲沒找到配重投石機裝輪子的證據。〔證據〕"
            "遊戲裡移動時整台滑動。",
            "④ 選配重式是為了和東陸人拉的霹靂車一眼分開。〔設計選擇〕拿掉原本有輪子、末端是杓子的扭力投石車（中世紀沒有證據，是 18 世紀的誤會）。",
            "⑤ 臂長約 3.4 m，比真的小很多（重建品約 18 m 高），為了放進畫框。〔設計選擇〕",
        ]),
    "spear_e": dict(
        images=[
            ("01-張議潮統軍出行圖-甲騎旗隊與樂舞.jpg", (1000, 880, 1560, 1260),
             "圖 01　敦煌莫高窟 156 窟〈張議潮統軍出行圖〉局部（約 851–867 年）：甲騎的札甲畫成一排排橫條，兜鍪連頓項包住頭和後頸，"
             "槍豎著拿。公有領域（PD-Art），Wikimedia Commons。"),
            ("06-前蜀永陵-抬棺力士背面-兜鍪頓項.jpg", (900, 240, 1920, 1350),
             "圖 06　前蜀王建墓（永陵，918 年）抬棺力士背面：碗形兜鍪，後面垂一大片頓項蓋住後頸到肩。"
             "CC0，攝影 Gary Todd，Wikimedia Commons。"),
            ("04-榆林窟25窟-中唐甲士-長牌與札甲.jpg", (384, 256, 1056, 1376),
             "圖 04　榆林窟 25 窟（中唐，781–848 年）甲士：札甲的排數、披膊、腿裙一段一段分開。公有領域（PD-Art），Wikimedia Commons。"),
        ],
        points=[
            "① 札甲：一排排小甲片用繩子串起來；甲身、三層披膊、及膝的腿裙前面開口。〔一手：圖 01、04，唐代甲片實物〕拿掉整片上漆的板甲和方方的肩板。",
            "② 兜鍪加頓項：碗形鐵盔，頂上一顆小圓珠；後面和兩側垂頓項，蓋住後頸、耳朵和肩頭，臉露出來。〔一手：圖 06、04〕"
            "頓項做成布、用玩家色，是設計選擇〔筆記：布或甲片都有〕。拿掉盔纓和三層階梯形的頸甲。",
            "③ 甲下穿圓領袍：袖子、甲裙下的袍腳到小腿，兩側開衩。〔一手：《新唐書·車服志》「缺骻衫」〕"
            "袍子用玩家色：一支部隊一個顏色合乎史實〔一手：李克用的「鴉軍」皆衣黑〕。",
            "④ 雙手持槍：後手握在離槍尾 0.5 m，前手在槍桿上；紮槍由後手推，槍桿從前手裡滑過去。"
            "〔推論：《太白陰經》只有兩成配盾；沒有找到畫雙手刺槍的圖〕",
            "⑤ 槍全長 3 m，素木桿，細長的葉形槍頭，拿掉槍上的大纓。〔長度是設計選擇；一手：《唐六典》「木槍長，步兵用之」〕",
            "⑥ 左腰掛直的橫刀，環首。〔一手：《唐六典》「橫刀，佩刀也，兵士所佩」；唐代環首刀實物〕",
            "⑦ 小腿綁行縢，穿靴。〔一手：《新唐書·兵志》、《舊唐書·輿服志》〕　⑧ 拿掉背旗：旗由旗手拿。〔筆記〕",
        ]),
    "bow_e": dict(
        images=[
            ("01-張議潮統軍出行圖-甲騎旗隊與樂舞.jpg", (0, 450, 560, 960),
             "圖 01　同一幅〈出行圖〉局部：沒穿甲的隨行和樂隊，圓領長袍、頭包黑色幞頭（壁畫很小，細節看不清）。"
             "公有領域（PD-Art），Wikimedia Commons。"),
            ("02-敦煌晚唐壁畫-持長牌步兵出城-出處待查.jpg", (400, 640, 654, 992),
             "圖 02　敦煌晚唐壁畫（哪一窟待查，只當晚唐敦煌畫風參考）：出城的隊伍，圓領長袍、黑色幞頭。公有領域（PD-Art），Wikimedia Commons。"),
        ],
        points=[
            "① 角弓：上下對稱，握在正中間；彎的那段短，弓梢長而直、往前翹；上弦後全長 1.22 m。"
            "〔二手：Selby；長度是推論，筆記建議 1.2–1.4 m〕這批參考圖裡沒有清楚的唐五代弓，形狀照文字做。",
            "② 拉弓：右手拉到臉頰、手肘抬在後面，放箭時手往耳後甩；手指勾弦，不做扳指。〔一手：《射經》的「中國法」；動作是設計〕",
            "③ 圓領缺胯袍到小腿，兩側開衩，黑革帶。〔一手：《新唐書·車服志》；圖 01、02〕袍子用玩家色（同槍兵）。",
            "④ 黑色軟幞頭：包住頭頂的髻，後面垂兩條軟腳。〔一手：《新唐書·車服志》、《夢溪筆談》、《宋史·輿服志》：五代是軟腳或略硬的短腳〕"
            "不戴紅抹額：紅色會和紅方的玩家色混在一起。",
            "⑤ 右腰有蓋的胡祿（看不到箭），左腰空的弓袋。〔一手：《新唐書·兵志》「弓一，矢三十，胡祿」；掛法是二手：Dwyer〕",
            "⑥ 小腿綁行縢，穿靴。　⑦ 拿掉：漆背心、黑圓帽、背旗、開口的箭袋。",
        ]),
}
# what is still missing next to Age of Empires and StarCraft (honest; on every board)
GAP = ("和世紀帝國、星海爭霸比還差：①貼圖是現成的 CC0 照片材質平鋪，不是美術依模型畫的貼圖，所以沒有手繪的磨損、縫線、刻紋；"
       "②模型的盔甲、衣服是程式拼的形狀，沒有雕刻的褶皺和厚度；③動作是逐格的關節角度，沒有動作捕捉的重心和慣性；"
       "④31 pt 的大小下，這些細節大多看不到，能拉近的主要是光、材質、輪廓和玩家色。")


def _lin(rgb):
    c = rgb / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lab(rgb):
    """sRGB (n, 3) 0-255 -> CIE Lab (D65)."""
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = _lin(rgb) @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)


def graded(img):
    """The ground with GRADE applied (what the client draws)."""
    a = np.asarray(img.convert("RGBA"), np.float32)
    lin = _lin(a[..., :3])
    Y = (lin @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
    lin = (Y + (lin - Y) * GRADE["saturation"]) * GRADE["brightness"]
    out = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * np.clip(lin, 0, None) ** (1 / 2.4) - 0.055)
    a[..., :3] = np.clip(out * 255, 0, 255)
    return Image.fromarray(a.astype(np.uint8), "RGBA")


def ground():
    im = graded(Image.open(BUILD / "ground" / "ground_x3.png"))
    meta = json.loads((BUILD / "ground" / "ground_x3.json").read_text())
    return im, meta


def swatch(w, h):
    """A clean strip of the R8 ground's grass (south-west of the patch), repeated to w x h."""
    im, meta = ground()
    ax, ay = meta["anchor"]
    x, y = int(ax - 9.5 * PPM), int(ay + 6.6 * PPM * 0.5)
    x = min(max(x, w // 2), im.width - w // 2)
    band = im.crop((x - w // 2, y - 36, x + w // 2, y + 36))
    out = Image.new("RGBA", (w, h))
    for k in range(0, h, band.height):
        out.paste(band if (k // band.height) % 2 == 0 else band.transpose(Image.FLIP_TOP_BOTTOM), (0, k))
    return out


def frame(a, unit, anim, facing, k, team):
    mirrored = a.m["facings"]["mirrored"]
    f = int(mirrored.get(str(facing), facing))
    name = f"{unit}_{anim}_f{f}_{k:02d}"
    if name not in a.m["frames"]:
        return None
    body, ax, ay = a.body(name, team)
    if str(facing) in mirrored:
        body = body.transpose(Image.FLIP_LEFT_RIGHT)
        ax = body.width - ax
    sh = a.shadow(f"{unit}_{anim}_f{facing}_{k:02d}")
    return body, (ax, ay), sh


def team_share(a, unit, anim, facing, k):
    mirrored = a.m["facings"]["mirrored"]
    f = int(mirrored.get(str(facing), facing))
    name = f"{unit}_{anim}_f{f}_{k:02d}"
    col = a._crop("color", "frames", name)
    t = a._crop("team", "team", name) if "team" in a.pages else None
    if col is None:
        return None
    ca = np.asarray(col[0], np.float32)[..., 3] / 255.0
    if t is None:
        return 0.0
    ti, tax, tay = t
    canvas = Image.new("L", col[0].size, 0)
    canvas.paste(ti.getchannel("A"), (int(round(col[1] - tax)), int(round(col[2] - tay))))
    ta = np.asarray(canvas, np.float32) / 255.0
    body = ca > 0.5
    return float((ta[body] > 0.5).sum() / max(body.sum(), 1))


def measure(unit, a, ground_lab):
    """Every frame of every animation in every direction, both teams."""
    rows = []
    for anim, d in a.m["anims"].items():
        for facing in FACINGS:
            for k in range(d["frames"]):
                ts = team_share(a, unit, anim, facing, k)
                if ts is None:
                    continue
                rec = dict(anim=anim, facing=facing, frame=k, team=ts)
                for team in ("blue", "red"):
                    body, _, _ = frame(a, unit, anim, facing, k, team)
                    px = np.asarray(body, np.float32)
                    m = px[..., 3] > 128
                    L = lab(px[m][:, :3])
                    rec[f"contrast_{team}"] = float(abs(L[:, 0].mean() - ground_lab[0]))
                    rec[f"visible_{team}"] = float((np.linalg.norm(L - ground_lab, axis=1) >= 20).mean())
                rows.append(rec)
    return rows


def summary(rows):
    out = {}
    for key in ("contrast_blue", "contrast_red", "visible_blue", "visible_red", "team"):
        vals = [r[key] for r in rows]
        lo, hi = min(vals), max(vals)
        r_lo = min(rows, key=lambda r: r[key])
        out[key] = dict(min=round(lo, 3), max=round(hi, 3), min_at=f"{r_lo['anim']} 朝向 {r_lo['facing']} 第 {r_lo['frame']} 格")
    out["frames"] = len(rows)
    return out


def cell(a, unit, anim, facing, k, team, bg):
    canvas = bg.copy()
    got = frame(a, unit, anim, facing, k, team)
    if got is None:
        return canvas
    body, (ax, ay), sh = got
    fx, fy = canvas.width // 2, canvas.height - 50
    if sh is not None:
        im, sax, say = sh
        canvas.alpha_composite(im, (int(round(fx - sax)), int(round(fy - say))))
    canvas.alpha_composite(body, (int(round(fx - ax)), int(round(fy - ay))))
    return canvas


def strip(cells, scale=1.0):
    W = sum(c.width for c in cells)
    out = Image.new("RGBA", (W, cells[0].height))
    x = 0
    for c in cells:
        out.paste(c, (x, 0))
        x += c.width
    if scale != 1.0:
        out = out.resize((round(out.width * scale), round(out.height * scale)), Image.LANCZOS)
    return out.convert("RGB")


def faceoff(a, unit, bg_full):
    """Same culture, blue against red: four a side, facing each other, on the R8 ground (3x crop)."""
    g, meta = bg_full
    ax, ay = meta["anchor"]
    img = g.copy()
    spots = [(-3.5, -3.0), (-2.6, -4.6), (-4.4, -5.6), (-3.0, -6.4)]
    items = []
    for x, y in spots:
        items.append(("blue", x, y, 1))
        items.append(("red", -x + 1.0, y + 0.3, 5))
    anims = list(a.m["anims"])
    use = "attack" if "attack" in anims else anims[0]
    for team, x, y, f in sorted(items, key=lambda t: -t[2]):
        got = frame(a, unit, use, f, 3, team) or frame(a, unit, anims[0], f, 0, team)
        if got is None:
            continue
        body, (bx, by), sh = got
        px, py = ax + x * PPM, ay - y * PPM * 0.5
        if sh is not None:
            im, sax, say = sh
            img.alpha_composite(im, (int(round(px - sax)), int(round(py - say))))
        img.alpha_composite(body, (int(round(px - bx)), int(round(py - by))))
    x0, y0 = int(ax - 7.0 * PPM), int(ay - 2.0 * PPM * 0.5)
    y1 = min(img.height, int(ay + 7.6 * PPM * 0.5))
    return img.crop((x0, y0, x0 + int(15.0 * PPM), y1)).convert("RGB")


def refrow(unit, W):
    """The reference pictures and the points (REFS), or None without R8_REFS."""
    import os
    ref = REFS.get(unit)
    folder = os.environ.get("R8_REFS")
    if not ref or not folder:
        return None
    probe = ImageDraw.Draw(Image.new("RGB", (8, 8)))
    tiles = []
    for name, box, caption in ref["images"]:
        if name.startswith("build:"):
            src = BUILD / "refs" / name[6:]
        elif name.startswith("west:"):
            src = Path(folder).parent / "west-reference" / name[5:]
        else:
            src = Path(folder) / name
        im = Image.open(src).convert("RGB").crop(box)
        h = 560
        im = im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
        w = max(im.width, 420)
        th = boards.wrap(probe, 0, 0, caption, w, size=22) + 10
        tile = Image.new("RGB", (w, h + th + 12), boards.BG)
        tile.paste(im, (0, 0))
        boards.wrap(ImageDraw.Draw(tile), 0, h + 12, caption, w, size=22)
        tiles.append(tile)
    text = "\n".join(ref["points"])
    th = boards.wrap(probe, 0, 0, text, W - 2 * boards.M, size=26) + 20
    gap = 30
    inner = Image.new("RGB", (max(sum(t.width for t in tiles) + gap * (len(tiles) - 1), 1300),
                              max(t.height for t in tiles)), boards.BG)          # 1300: room for the title
    x = 0
    for t in tiles:
        inner.paste(t, (x, 0))
        x += t.width + gap
    top = boards.row([boards.captioned(inner, "參考（文物和壁畫，只當參考：照著重新做 3D，圖不放進遊戲）", 26)], W)
    out = Image.new("RGB", (W, top.height + th + 20), boards.BG)
    out.paste(top, (0, 0))
    boards.wrap(ImageDraw.Draw(out), boards.M, top.height, text, W - 2 * boards.M, size=26, fill=boards.INK)
    return out


def board(unit, a, nums):
    n, name, side = UNITS[unit]
    label = f"R8-{n:02d}-{name}-{side}"
    bg = swatch(240, 270)
    s = nums
    text = (f"{WHAT.get(unit, '')}\n"
            f"好不好認（程式量，{s['frames']} 格＝全部動作 × 8 個方向的每一格，藍紅各量一次）："
            f"兵和地面的亮度差 ΔL* 藍 {s['contrast_blue']['min']:.0f}–{s['contrast_blue']['max']:.0f}、紅 {s['contrast_red']['min']:.0f}–{s['contrast_red']['max']:.0f}"
            f"（最低在 {s['contrast_blue']['min_at']}）；和地面色差 ΔE 20 以上的像素 藍 {s['visible_blue']['min']:.0%}–{s['visible_blue']['max']:.0%}、"
            f"紅 {s['visible_red']['min']:.0%}–{s['visible_red']['max']:.0%}；玩家色佔兵的面積 {s['team']['min']:.0%}–{s['team']['max']:.0%}"
            f"（最低在 {s['team']['min_at']}）。\n{GAP}\n"
            "上：8 個方向（idle，3 倍）；中：每個動作（朝向 1，3 倍）；下：同文化藍紅對上（3 倍和實際大小）、8 個方向實際大小。")
    W = 2500
    parts = [boards.header(W, label + "-mobile", text)]
    refs = refrow(unit, W)
    if refs is not None:
        parts.append(refs)
    parts.append(boards.row([boards.captioned(strip([cell(a, unit, "idle", f, 0, "blue", bg) for f in FACINGS]),
                                              "8 個方向（藍）", 24)], W))
    for anim, d in a.m["anims"].items():
        k = list(range(d["frames"]))[:10]
        parts.append(boards.row([boards.captioned(strip([cell(a, unit, anim, 1, i, "blue", bg) for i in k]),
                                                  f"{anim}（{d['frames']} 格）", 24)], W))
    fo = faceoff(a, unit, ground())
    parts.append(boards.row([boards.captioned(fo, "同文化藍紅對上（3 倍）", 24),
                             boards.captioned(fo.resize((fo.width // 3, fo.height // 3), Image.LANCZOS), "實際大小", 24)], W))
    parts.append(boards.row([boards.captioned(strip([cell(a, unit, "idle", f, 0, t, bg) for t in ("blue", "red")
                                                     for f in (1, 3, 5, 7)], 1 / 3), "實際大小：藍、紅各 4 個方向", 24)], W))
    p = boards.save(boards.stack(parts, W), label + "-mobile")
    # the GIF: every animation, facings 1 and 7
    frames = []
    for t in range(40):
        row = []
        for f in (1, 7):
            for anim, d in a.m["anims"].items():
                fps = d.get("fps", 12)
                i = int(t * fps / 20) % d["frames"] if d.get("loop") else min(int(t * fps / 20), d["frames"] - 1)
                row.append(cell(a, unit, anim, f, i, "blue", bg))
        frames.append(strip(row, 0.6))
    g = OUT / f"{label}-動作.gif"
    frames[0].save(g, save_all=True, append_images=frames[1:], duration=50, loop=0, optimize=True)
    print("wrote", g.name)
    return p


def main(args):
    OUT.mkdir(parents=True, exist_ok=True)
    g, meta = ground()
    sw = np.asarray(swatch(240, 270), np.float32)
    ground_lab = lab(sw[..., :3].reshape(-1, 3)).mean(0)
    report = {"ground_lab": [round(float(v), 1) for v in ground_lab], "grade": GRADE}
    rp = OUT / "readability.json"
    if rp.exists():
        report.update(json.loads(rp.read_text()))
    for unit, adir in zip(args[0::2], args[1::2]):
        a = field.Atlas(Path(adir) / f"{unit}.json")
        rows = measure(unit, a, ground_lab)
        s = summary(rows)
        report[unit] = s
        board(unit, a, s)
        print(unit, s)
    rp.write_text(json.dumps(report, ensure_ascii=False, indent=1))
    overview({u: field.Atlas(Path(d) / f"{u}.json") for u, d in zip(args[0::2], args[1::2])})



PAIRS = [("farmer_e", "farmer_w"), ("spear_e", "pike_w"), ("bow_e", "bow_w"), ("hcav_e", "knight_w"),
         ("siege_e", "siege_w"), ("mage_e", "mage_w")]


def overview(atlases):
    """R8-99: the units of this batch side by side, East and West of each role in one row, blue and red of each on
    the R8 ground (attack, frame 3), 3x and actual size, with the readability numbers of each (readability.json)."""
    units = list(atlases)
    bg = swatch(430, 380)
    rows = []
    for e, w in PAIRS:
        tiles = []
        for u in (e, w):
            if u not in atlases:
                continue
            a = atlases[u]
            anim = "attack" if "attack" in a.m["anims"] else list(a.m["anims"])[0]
            pair = strip([cell(a, u, anim, 1, 3, "blue", bg), cell(a, u, anim, 7, 3, "red", bg)])
            n, name, side = UNITS[u]
            tiles.append(boards.captioned(pair, f"R8-{n:02d} {side}{name}（藍、紅）", 24))
        if tiles:
            rows.append(tiles)
    gap = 30
    tw = max(t.width for r in rows for t in r)
    th = max(t.height for r in rows for t in r)
    grid = Image.new("RGB", (2 * tw + gap, len(rows) * (th + gap)), boards.BG)
    for i, r in enumerate(rows):
        for j, t in enumerate(r):
            grid.paste(t, (j * (tw + gap), i * (th + gap)))
    rep = json.loads((OUT / "readability.json").read_text())
    names = "、".join(f"{UNITS[u][2]}{UNITS[u][1]}" for u in units)
    lines = [f"{UNITS[u][2]}{UNITS[u][1]}：ΔL* {rep[u]['contrast_blue']['min']:.0f}–{rep[u]['contrast_blue']['max']:.0f}、色差 ΔE≥20 "
             f"{rep[u]['visible_blue']['min']:.0%}–{rep[u]['visible_blue']['max']:.0%}、玩家色 {rep[u]['team']['min']:.0%}–{rep[u]['team']['max']:.0%}"
             for u in units]
    W = 2500
    text = (f"這一批：{names}。每一列是同一個兵種，左東陸、右西陸；每格左藍右紅（攻擊第 3 格），寫實地面（地面調色 亮度 {GRADE['brightness']}、"
            f"彩度 {GRADE['saturation']}）。\n"
            "好不好認（全部方向全部影格，最小–最大）：" + "；".join(lines) + "。\n" + GAP)
    parts = [boards.header(W, "R8-99-兵-總覽", text)]
    parts.append(boards.row([boards.captioned(grid, "手機像素（3 倍）", 26)], W))
    parts.append(boards.row([boards.captioned(grid.resize((grid.width // 3, grid.height // 3), Image.LANCZOS),
                                              "實際大小（兵約 31 pt）", 26)], W))
    return boards.save(boards.stack(parts, W), "R8-99-兵-總覽")


if __name__ == "__main__":
    main(sys.argv[1:])
