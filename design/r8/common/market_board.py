"""R8-38 (D-101 市場): the market drafts for the user, two options a culture, in the R8 look (market_r8.py).

python3 design/r8/common/market_board.py RESEARCH_DIR     the option boards (RESEARCH_DIR: the research worktree)
python3 design/r8/common/market_board.py states           the chosen options' states (r8m_states, found_3x3, rubble_3x3)
Needs build/b1/r8m/market_<c>_<A|B>_x3.* (run.py r8m_draft) and build/b1/r8p/{house,granary}_<c>_done_x3.* (r8p_<c>_*).
"""
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import samples_r8 as S   # noqa: E402
B = S.boards
MDIR = S.config.BUILD / "b1" / "r8m"
PDIR = S.config.BUILD / "b1" / "r8p"
SIDE = {"E": "東陸", "W": "西陸"}
NAME = {("E", "A"): "市的一角", ("E", "B"): "邸店院", ("W", "A"): "市場棚", ("W", "B"): "市場十字"}

COMMON = ("市場（D-101，ceo 2026-10-24 核准，開關 MARKET 預設關）：用多出來的糧或木換金，換越多越貴。要先有糧倉。占地 3×3 格（6×6 公尺）。"
          "考據筆記在 research/market-reference。每個選項都有三樣貨：糧（麻袋、糧桶）、木（柴捆、原木）、錢；"
          "要在手機上一眼看出是市場，靠開敞的棚子、一堆一堆的貨和一個高的記號。玩家色在布上（幌子、掛布、布篷）。"
          "這一輪先選樣子；選定以後再畫施工三段、受損、瓦礫給你看。\n")
POINTS = {
    ("E", "A"): "東陸 A「市的一角」：唐代的市是有牆的一大塊，中午打鼓開市、日落敲鉦散市（《唐六典》《唐會要》）。6 公尺放不下整座市，做成它的一角：\n"
                "・後面一段矮夯土牆，牆上一座烏頭門（兩根柱、一根橫木、柱頭塗黑；《營造法式》，不用明清的牌樓）。\n"
                "・門裡兩間偏廂攤棚（單坡蓆頂、紅柱），櫃台上有成串的銅錢和銀鋌，另一張放斗量的糧；左後一面開市的鼓。\n"
                "・外面一座大桿秤（三根木桿綁的架子吊秤桿，正在秤一袋糧），麻袋、柴捆、原木。",
    ("E", "B"): "東陸 B「邸店院」：唐代存貨、交易的地方叫邸店；後唐 926 年的敕令說洛陽市上糧和柴炭都由牙人居間。做成一個商家的院子：\n"
                "・後面一棟夯土倉房（邸），懸山瓦頂，木門、小通風口。\n"
                "・前面一間開敞的店，櫃台上放銅錢串、銀鋌和錢箱；簷下掛玩家色的幌子。\n"
                "・院子裡一座大桿秤在秤糧，等著秤的麻袋，柴捆和原木，一張記帳的小桌。\n"
                "・缺點：倉房有點像民居和糧倉，要靠桿秤和貨堆分。",
    ("W", "A"): "西陸 A「市場棚」：大一點的城有木柱撐大屋頂的市場棚（halle）。現存的都比 1250 年晚、也大得多（普盧埃斯卡、迪沃），這裡只借它的構造，縮成兩開間：\n"
                "・5×3.4 公尺，六根粗木柱立在石墩上，斜撐，陡的兩坡石板瓦頂（52°），四面開敞。\n"
                "・棚下兩張攤台（布匹、麻袋），前面敞口糧桶、麻袋，右邊酒桶和原木，右前角一座公秤（柱子吊橫桿、兩邊秤盤）。\n"
                "・玩家色是簷下的兩塊掛布和一面三角旗。\n"
                "・缺點：屋頂大，遠看有點像糧倉（什一稅倉）；靠四面開敞和前面的貨分。",
    ("W", "B"): "西陸 B「市場十字」：1250 年的市場多半是廣場上的攤子加一座市場十字（維奧萊勒杜克：市場常常沒有自己的建築）。\n"
                "・中間一座三層石階的十字，石柱 2.6 公尺，頂上小十字：西陸市場最好認的高記號。\n"
                "・三個木馬攤台，上面撐玩家色的單坡布篷；一張換錢桌（格子布、一堆堆銀幣、錢袋、小天平；沙特爾彩窗的換錢商）。\n"
                "・糧桶、麻袋、酒桶、柴捆在地上。1250 年日常的錢是銀幣，所以「金」畫成換錢桌和錢袋，不畫一大堆金幣。\n"
                "・布篷的顏色沒有證據，是遊戲為了玩家色加的。",
}
REFS = {
    ("E", "A"): [("04-東陸-營造法式-烏頭門-兩柱一橫的木門.jpg", "04《營造法式》烏頭門（公有領域）：兩柱一橫、柱頭塗黑的木門［一手文獻］"),
                 ("01-東陸-清明上河圖原本-虹橋兩頭的攤棚與大傘.jpg", "01《清明上河圖》虹橋兩頭的攤棚（北宋，公有領域）［類比］"),
                 ("03-東陸-閘口盤車圖-五代官磨-麻袋牛車與彩樓.jpg", "03〈閘口盤車圖〉（Commons 標五代，公有領域）：麻袋、牛車［一手圖像］")],
    ("E", "B"): [("03-東陸-閘口盤車圖-五代官磨-麻袋牛車與彩樓.jpg", "03〈閘口盤車圖〉（Commons 標五代，公有領域）：官營磨坊的倉房、麻袋［一手圖像］"),
                 ("05-東陸-唐建中二年銀鋌-長條銀板.jpg", "05 唐建中二年（781）銀鋌（CC0）：長條銀板［一手實物］"),
                 ("06-東陸-開元通寶-唐代銅錢.jpg", "06 開元通寶（CC0）：唐代銅錢，成串叫一貫［一手實物］"),
                 ("07-東陸-明代戥子-小桿秤與秤盤-類比.jpg", "07 明代戥子（CC0）：桿秤的樣子［類比，唐五代的實物沒找到］")],
    ("W", "A"): [("15-西陸-普盧埃斯卡市場棚-木柱撐大屋頂-明信片-類比.jpg", "15 普盧埃斯卡市場棚（20 世紀初明信片，公有領域）：木柱撐大屋頂［類比，16 世紀］"),
                 ("16-西陸-迪沃市場棚內部-木構架與攤台-類比.jpg", "16 迪沃市場棚內部（2023 年照片，CC0）：木構架與攤台［類比］"),
                 ("09-西陸-摩根聖經6r-約瑟賣糧-糧桶量斗與麻袋-約1250年.jpg", "09 摩根聖經 6r 約瑟賣糧（約 1250，公有領域）：糧桶、量斗、麻袋［一手］")],
    ("W", "B"): [("17-西陸-利德尼市場十字-階梯台座與石柱-1890年代.jpg", "17 利德尼市場十字（1890 年代照片，公有領域）：階梯台座與石柱［一手實物］"),
                 ("11-西陸-沙特爾彩窗106-換錢商櫃台上的天平與錢堆-1210至1225年.jpg", "11 沙特爾彩窗 106（1210–1225，公有領域）：換錢商的天平和錢堆［一手］"),
                 ("14-西陸-維奧萊勒杜克-店鋪雨棚-石托上的木架單坡.jpg", "14 維奧萊勒杜克〈雨棚〉（公有領域）：單坡雨棚［二手］")],
}


def market(c, o, pp, team="blue"):
    S.DIR = MDIR
    return S.tile(f"market_{c}_{o}", "x3", pp, (3, 3), team=team)


def lineup(c, o, pp=1):
    """At the phone's size: a house, a granary and the market in a row on the ground, as they could stand in a town."""
    S.DIR = PDIR
    items = [S.scene.piece(PDIR, f"house_{c}_done", "x3", team="blue", ppm=20 * pp, x=-7.5, y=0.0),
             S.scene.piece(PDIR, f"granary_{c}_done", "x3", team="blue", ppm=20 * pp, x=-2.5, y=0.0),
             S.scene.piece(MDIR, f"market_{c}_{o}", "x3", team="blue", ppm=20 * pp, x=3.5, y=-1.0)]
    for it, n in zip(items, ("house", "granary", "market")):
        S.realistic(it.meta, n)
    img, _ = S.scene.render(items, 20 * pp, pad=16, bg=S.b1art.GROUND)
    return img.convert("RGB")


def board_option(c, o, research, W=2900):
    label = f"R8-38-市場-{o}-{NAME[(c, o)]}-{SIDE[c]}-mobile"
    parts = [B.header(W, label, COMMON + POINTS[(c, o)])]
    row = [B.captioned(market(c, o, 2, t), n, 22) for t, n in (("blue", "我方（藍）"), ("neutral", "中立"), ("red", "敵方（紅）"))]
    parts.append(B.row(row, W, gap=24))
    parts.append(B.row([B.captioned(market(c, o, 3, "blue"), "3 倍", 22),
                        B.captioned(lineup(c, o, 2), "2 倍：和民居、糧倉擺在一起（左到右：民居、糧倉、市場）", 22)], W, gap=30))
    parts.append(B.row([B.captioned(lineup(c, o, 1), "實際大小（1 倍）", 22)], W))
    parts += S.refs_row(W, Path(research) / "market-reference", REFS[(c, o)])
    return B.save(B.stack(parts, W), label)


def board_overview(W=3000):
    label = "R8-38-市場-總覽-mobile"
    text = (COMMON + "東陸 A「市的一角」：矮牆、烏頭門、兩間攤棚、開市的鼓、桿秤和貨。　東陸 B「邸店院」：後面倉房、前面開敞的店、院子裡秤糧。\n"
            "西陸 A「市場棚」：木柱撐陡屋頂的開敞棚子、糧桶、公秤。　西陸 B「市場十字」：石階十字、布篷攤子、換錢桌。")
    parts = [B.header(W, label, text)]
    for c in "EW":
        tiles = [B.captioned(market(c, o, 2), f"{SIDE[c]} {o}「{NAME[(c, o)]}」", 24) for o in "AB"]
        tiles += [B.captioned(lineup(c, o, 1), f"{o}：實際大小", 22) for o in "AB"]
        parts.append(B.row(tiles, W, gap=28))
    return B.save(B.stack(parts, W), label)


CHOSEN = {"E": "A", "W": "B"}        # the user 2026-10-25, in the choice popup
STATES_TEXT = {
    "E": "東陸 A「市的一角」（使用者 2026-10-25 選）的每一種樣子，照其他寫實建築的做法：\n"
         "・施工 1：地基（木樁、繩子），所有 3×3 建築共用同一張。施工 2：牆、門、攤棚只蓋到一半，四周搭鷹架。施工 3：攤棚的屋頂只有骨架。\n"
         "・受損（生命一半以下）：攤棚的蓆頂燒破、冒火和黑煙；烏頭門和牆還在。\n"
         "・瓦礫（被打掉以後，可以走、壓得很低）：所有 3×3 建築共用同一張。",
    "W": "西陸 B「市場十字」（使用者 2026-10-25 選）的每一種樣子，照其他寫實建築的做法：\n"
         "・施工 1：地基（木樁、繩子），所有 3×3 建築共用同一張。施工 2：攤台和十字的台階蓋到一半，四周搭鷹架。施工 3：十字的石柱還沒立好，布篷只有木架。\n"
         "・受損（生命一半以下）：布篷燒起來、冒火和黑煙；十字和攤台還在。\n"
         "・瓦礫（被打掉以後，可以走、壓得很低）：所有 3×3 建築共用同一張。",
}


def state_tile(c, s, pp):
    if s in ("build1", "rubble"):
        S.DIR = PDIR
        return S.tile(f"{'found' if s == 'build1' else 'rubble'}_3x3_{c}", "x3", pp, (3, 3))
    S.DIR = MDIR
    return S.tile(f"market_{c}_{s}", "x3", pp, (3, 3))


def board_states(c, W=3000):
    o = CHOSEN[c]
    label = f"R8-38-市場-{o}-{NAME[(c, o)]}-狀態-{SIDE[c]}-mobile"
    names = (("build1", "施工 1（地基，3×3 共用）"), ("build2", "施工 2"), ("build3", "施工 3"), ("done", "完好"),
             ("damaged", "受損（生命一半以下）"), ("rubble", "瓦礫（可以走，3×3 共用）"))
    parts = [B.header(W, label, STATES_TEXT[c])]
    parts.append(B.row([B.captioned(state_tile(c, s, 2), n, 22) for s, n in names], W, gap=18))
    parts.append(B.row([B.captioned(B.row([B.captioned(state_tile(c, s, 1), n.split("（")[0], 20) for s, n in names],
                                          W - 2 * B.M, gap=16), "實際大小（1 倍）", 22)], W))
    return B.save(B.stack(parts, W), label)


if __name__ == "__main__":
    if sys.argv[1] == "states":
        out = [board_states(c) for c in "EW"]
    else:
        research = sys.argv[1]
        out = [board_option(c, o, research) for c in "EW" for o in "AB"] + [board_overview()]
    print("\n".join(str(p) for p in out))
