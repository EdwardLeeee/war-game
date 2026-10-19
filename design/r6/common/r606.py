"""R6-06 (the user 2026-10-19: 「阿中立城市沒有圖耶」): what a town looks like on the oblique battlefield (D-088), two
ways, the small town and the big city side by side, in each holder's state.

甲 不改規則: the landmark across the street at the front of the square (towns.tgate: the east's 牌坊), which units
   walk through; round it only what B1-03 approved and does not look like it blocks (the boundary posts, the paving),
   the house plots left as gardens. The big city's tower stays in the middle, the 牌坊 in front of it. Only images.
乙 照 B1-03 原樣: the approved B1-03 houses round the square; they block, so the sim must take the layout.
The west's landmark (a stone arch) once, neutral, in the overview's corner: the towns of the west's lands later.

python3 common/r606.py ART RAW
  ART  an extracted art-v2-x3.tar.gz (the units)
  RAW  the oblique town renders (design/b1/common/run.py r606_*)
-> out/R6-06-野城-<甲|乙>-<中立|我方|敵方|廢墟>-mobile.png, out/R6-06-野城-總覽.png
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "b1" / "common"))
import boards     # noqa: E402
import field      # noqa: E402
import layouts    # noqa: E402
import rawart     # noqa: E402

SCALE = 3
STATES = [("neutral", "中立"), ("ours", "我方"), ("enemy", "敵方"), ("ruins", "廢墟")]
STATUS = {"neutral": "中立", "ours": "我方治理", "enemy": "敵方治理", "ruins": "廢墟"}
OPTS = [("甲", "不改規則"), ("乙", "照 B1-03 原樣")]
WHAT = {
    "甲": "城鎮中間不放房子：廣場前的街口立一座牌坊當地標，人從底下穿過去，看起來就不擋路；匾和兩面垂幔是擁有者的顏色。"
          "周圍只有 B1-03 核准過的界樁和鋪面，原本的房子那幾格改成菜園。大城的箭樓照舊在中間，牌坊立在它前面的街口。",
    "乙": "照 B1-03 核准的配置：房子圍著廣場，街道留給部隊走；房子會擋路。界樁照 B1-03 圍一圈。",
}
COST = {
    "甲": "代價：要算牌坊（完整、斷掉）和界樁、鋪面的方形斜看圖，約 1 天；只改圖，不用改模擬，存著的局可以繼續。",
    "乙": "代價：B1-03 全部城鎮圖用方形斜看重算，約 1 天；core 要改模擬（房子擋路、尋路、民兵站的位置），重新量打城難度；存著的局會接不下去。",
}
OWNER = {"neutral": "neutral", "ours": "blue", "enemy": "red", "ruins": None}
RING = {"neutral": (216, 210, 192), "ours": (63, 127, 224), "enemy": (217, 67, 58), "ruins": (109, 98, 88)}
SOLDIER = {"neutral": "spear_e", "ours": "spear_e", "enemy": "pike_w"}


def scene(opt, size, state, atl, west=False):
    """The town round the layout's origin at (30, 30) in sim cells (+y toward the camera, the layout's +y away)."""
    L = layouts.small() if size == "small" else layouts.large()
    big = size == "large"
    ox, oy = 30.0, 30.0
    sim = lambda a, b: (ox + a, oy - b)
    owner = OWNER[state]
    team = owner or "neutral"
    props = [dict(atlas=atl, frame=f"tground_E_{L['name']}_{'A' if opt == '甲' else 'B'}", x=ox, y=oy, front=0, ground=True)]
    if opt == "乙":
        for kind, ci, cj, var in L["pieces"]:
            fx, fy = layouts.piece_fp(kind)
            x, y = sim(ci, cj)
            props.append(dict(atlas=atl, frame=f"{kind}_E_{'ruin' if state == 'ruins' else 'intact'}_v{var % 2}",
                              x=x, y=y, front=y + fy / 2, team=team))
    else:
        gy = oy + (3.0 if big else 1.5)          # the square's front edge
        frame = "tgate_W_small_intact" if west else f"tgate_E_{size}_{'ruin' if state == 'ruins' else 'intact'}"
        props.append(dict(atlas=atl, frame=frame, x=ox, y=gy, front=gy + 0.3, team=team))
    if big and state == "neutral":
        props.append(dict(atlas=atl, frame="ttower_E_intact", x=ox, y=oy, front=oy + 1, team="neutral"))
    if not west:
        post = {"neutral": "lantern", "ours": "pennant", "enemy": "pennant", "ruins": "fallen"}[state]
        for px, py in L["posts"]:
            x, y = sim(px, py)
            props.append(dict(atlas=atl, frame=f"tpost_E_{post}", x=x, y=y, front=y + 0.3, team=team))
    units = []
    if state == "neutral":
        sol = "pike_w" if west else "spear_e"
        for k, (mx, my) in enumerate(L["militia"][:4] if west else L["militia"]):
            units.append((sol, "neutral", *sim(mx, my), (6, 7, 0)[k % 3], "idle", (k * 3) % 8, False))
    elif state in ("ours", "enemy"):
        for k, (gx, gy_) in enumerate(L["garrison"]):
            units.append((SOLDIER[state], owner, *sim(gx, gy_), (7, 6)[k % 2], "idle", k * 2, False))
    return dict(centre=(ox, oy - (2.0 if big else 1.5)), buildings=[], nodes=[], props=props, units=units), L, (ox, oy)


def ring_decal(L, origin, centre, colour):
    """The town's range on the ground (R6-23b): the circle in the holder's colour."""
    W, H = field.SCREEN[0] * SCALE, field.SCREEN[1] * SCALE
    k = 2
    im = Image.new("RGBA", (W * k, H * k), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    cx, cy = (v * SCALE * k for v in field.cell_to_pt(*origin, centre))
    rx, ry = L["radius"] * field.CELL_W * SCALE * k, L["radius"] * field.CELL_D * SCALE * k
    dr.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=(*colour, 22), outline=(*colour, 200), width=3 * SCALE * k)
    im = im.resize((W, H), Image.LANCZOS)
    return im, W / 2, H / 2, centre[0], centre[1]


def panel(opt, size, state, atl, art, west=False):
    sc, L, origin = scene(opt, size, state, atl, west)
    sc["decals"] = [ring_decal(L, origin, sc["centre"], RING[state])]
    img, _ = field.render(sc, art, scale=SCALE)
    cx, cy = field.cell_to_pt(*origin, sc["centre"])
    R = L["radius"]
    half_w, below, above = R * field.CELL_W + 26, R * field.CELL_D + 34, R * field.CELL_D + (150 if size == "large" else 110)
    box = (cx - half_w, cy - above, cx + half_w, cy + below)
    out = img.crop(tuple(int(round(v * SCALE)) for v in box)).convert("RGB")
    dr = ImageDraw.Draw(out)
    f = boards.font(13 * SCALE)
    t = ("中立" if west else STATUS[state]) + ("大城" if size == "large" else "小鎮")
    tw = dr.textlength(t, font=f)
    dr.text(((out.width - tw) / 2, out.height - 26 * SCALE), t, font=f, fill=(255, 255, 255), stroke_width=SCALE,
            stroke_fill=(0, 0, 0))
    return out


def main(art, raw):
    field.VIEW = "oblique"
    field.SCREEN = (1000, 560)              # a canvas bigger than the phone's, so the big city's circle fits
    atl = rawart.RawAtlas(raw)
    small_px = {}
    for opt, oname in OPTS:
        for state, sname in STATES:
            pa, pb = panel(opt, "small", state, atl, art), panel(opt, "large", state, atl, art)
            W = boards.M * 2 + pa.width + pb.width + 40
            label = f"R6-06-野城-{opt}-{sname}-mobile"
            head = boards.header(W, label, f"選項 {opt}「{oname}」，{sname}：{WHAT[opt]}\n{COST[opt]}\n"
                                 "左：小鎮；右：大城（中立時中間有箭樓；被攻下的大城箭樓已經拆了）。圓圈和下面的字是遊戲畫在戰場上的（R6-23b）。"
                                 "都是方形斜看（D-088）、東陸的樣子（原型的城鎮先用東陸）；民兵先用中立色的槍兵代替。上：手機像素（3 倍）；下：實際大小。")
            big = boards.row([boards.captioned(pa, "小鎮", 30), boards.captioned(pb, "大城", 30)], W)
            sa, sb = (p.resize((p.width // 3, p.height // 3), Image.LANCZOS) for p in (pa, pb))
            small_px[(opt, state)] = (sa, sb)
            boards.save(boards.stack([head, big, boards.row([boards.captioned(sa, "實際大小：小鎮", 22),
                                                             boards.captioned(sb, "實際大小：大城", 22)], W)], W), label)
    # overview: a row per state, 甲 left and 乙 right, at actual size; the west's landmark at the end
    cellw = max(a.width + b.width + 16 for a, b in small_px.values())
    W = boards.M * 2 + 2 * cellw + 60
    parts = [boards.header(W, "R6-06-野城-總覽",
                           "左兩欄：甲「不改規則」（牌坊當地標，不擋路，只改圖）；右兩欄：乙「照 B1-03 原樣」（房子擋路，要改模擬，存著的局接不下去）。"
                           "每組左邊小鎮、右邊大城，實際大小（1 pt = 1 px）。最下面是西陸地區之後的城鎮地標（只畫中立）。")]

    def pair(a, b):
        out = Image.new("RGB", (a.width + 16 + b.width, max(a.height, b.height)), boards.BG)
        out.paste(a, (0, 0))
        out.paste(b, (a.width + 16, 0))
        return out
    for state, sname in STATES:
        cells = [boards.captioned(pair(*small_px[(opt, state)]), f"{opt}「{oname}」・{sname}", 22) for opt, oname in OPTS]
        parts.append(boards.row(cells, W, gap=60))
    west = panel("甲", "small", "neutral", atl, art, west=True)
    parts.append(boards.row([boards.captioned(west.resize((west.width // 3, west.height // 3), Image.LANCZOS),
                                              "西陸的地標：石拱門（只畫中立）", 22)], W))
    boards.save(boards.stack(parts, W), "R6-06-野城-總覽")


if __name__ == "__main__":
    main(*sys.argv[1:3])
