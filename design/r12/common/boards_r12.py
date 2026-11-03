"""R12's boards (D-119: the 3 x 3 outpost, a piece of wall): one per option (A 敵臺門洞, B 塢堡小院, C 關城閘樓), East and
West, the four states (施工中, 完成, 受損, 有人躲在裡面), at the phone's pixels on the diamond camera's grass; beside the
finished one the arrow tower for the size and a spearman walking through the passage (one's own men pass, D-115).

python3 design/r12/common/boards_r12.py GRASS UNITS OUT
  GRASS: a diamond-camera grass screen (design/r11 scene_r11.py's grass_d.png); UNITS: a spear_e atlas folder
"""
import math
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
DESIGN = HERE.parents[1]
sys.path.insert(0, str(DESIGN / "r11" / "common"))
sys.path.insert(0, str(DESIGN / "r9" / "common"))
import scene_r11 as SR    # noqa: E402
import boards_r9 as B9    # noqa: E402

PIECES = DESIGN / "b1" / "build" / "b1" / "r12"
PPM = SR.PPM
OPTS = (("A", "敵臺門洞", "一段 6 公尺長、4.4 公尺厚的牆，高約 2.6 公尺，中間一條門洞南北穿過，牆頂有女牆和垛口。東陸是夯土，門洞是平頂木框（唐代不用磚券門），"
                     "掛皮竹笆盾牌；西陸是亂石砌、角上一塊塊淺色角石，圓拱門洞，前面一道木造的懸挑廊（hoarding）。"),
        ("B", "塢堡小院", "四面矮牆圍成一個小院，南、北各一個門可以穿過，四個角加高；院子裡一座戰棚。像一座縮小的堡，牆頂只看得到西、南兩面的女牆。"),
        ("C", "關城閘樓", "一段東西向的厚牆，中間門洞，牆上一座低矮的單層門樓：東陸是三開間、廡殿頂的木構；西陸是木造的廊樓、兩坡頂。最像關口的城門。"))
STATES = (("build", "施工中"), ("done", "完成"), ("damaged", "受損"), ("garrison", "有人躲在裡面"))
CULT = (("E", "東陸"), ("W", "西陸"))


def at(dx, dy):
    """Screen offset (3x pixels) of a ground offset (metres, x east, y south) on the diamond camera."""
    c = math.cos(math.radians(45))
    return (dx * c + dy * c) * PPM, (-dx * c + dy * c) * PPM * 0.5


def tile(grass, name, extra=(), size=(1000, 760), mid=(430, 500)):
    """One state on grass: the piece at mid, extra: (sprite, dx, dy, flip) more on the ground (metres)."""
    w, h = size
    g = grass.crop((700, 200, 700 + w, 200 + h)).convert("RGBA")
    items, shadows = [], []

    def put(spr, dx, dy, flip=False):
        (im, ax, ay), sh = spr
        if flip:
            im = im.transpose(Image.FLIP_LEFT_RIGHT)
            ax = im.width - ax
        ox, oy = at(dx, dy)
        X, Y = mid[0] + ox, mid[1] + oy
        items.append((Y, im, (int(round(X - ax)), int(round(Y - ay)))))
        if sh:
            si, sx, sy = sh
            shadows.append((si, (int(round(X - sx)), int(round(Y - sy)))))
    put(SR.piece(name, "blue", PIECES), 0, 0)
    for spr, dx, dy, flip in extra:
        put(spr, dx, dy, flip)
    return SR.S9.screen_layers(g, items, shadows).convert("RGB")


def main(grass_p, units, out):
    out.mkdir(parents=True, exist_ok=True)
    grass = Image.open(grass_p).convert("RGB")
    note = ("R12（D-119，使用者 2026-11-04：「我是把它當作城牆來設計的」，選「先 A」3×3）：哨所改成 3×3（6×6 公尺）的一段牆，"
            "比箭樓矮而寬，自己人從門洞走得過，最多 9 名槍兵躲在裡面、從垛口戳 1 格內的敵人。art-v7 的寫實、菱形 45 度。"
            "「完成」那格旁邊是箭樓（比高度）和一名從門洞走過的槍兵（比大小、看得出能穿過）。")
    overview = []
    for o, oname, text in OPTS:
        rows = []
        for c, cname in CULT:
            tiles = []
            for s, sname in STATES:
                extra = ()
                if s == "done":
                    walker, flip = SR.unit(units, "walk", 6, 3)
                    extra = ((SR.piece(f"arrow_tower_{c}_d", "blue", PIECES), 3.5, 5.5, False), (walker, 0.0, 1.2, flip))
                tiles.append(tile(grass, f"outpost3_{o}_{c}_{s}_d", extra))
            strip = Image.new("RGB", (sum(t.width // 2 for t in tiles) + 3 * 12, tiles[0].height // 2), B9.BG)
            x = 0
            for t in tiles:
                strip.paste(t.resize((t.width // 2, t.height // 2), Image.LANCZOS), (x, 0))
                x += t.width // 2 + 12
            rows.append((f"{cname}（手機像素的一半）：" + "、".join(sn for _, sn in STATES), strip))
            done = tiles[1]
            rows.append((f"{cname} 完成：手機實際大小（1 倍）", done.resize((done.width // 3, done.height // 3), Image.LANCZOS)))
            overview.append((f"{o} {oname}・{cname}", done.resize((done.width // 2, done.height // 2), Image.LANCZOS)))
        B9.board(f"R12-01-哨所-{o}-{oname}-phone", note + "\n" + f"{o} {oname}：" + text, rows, out)
    # the overview: the finished ones of every option, East and West side by side
    pairs = []
    for i in range(0, len(overview), 2):
        (ca, ia), (cb, ib) = overview[i], overview[i + 1]
        pairs.append((f"{ca}　／　{cb.split('・')[1]}", B9.pair(ia, ib)))
    B9.board("R12-99-哨所-總覽-phone", note + "\n三個選項的「完成」，左東陸、右西陸（手機像素的一半）。", pairs, out)
    print("boards in", out)


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]))
