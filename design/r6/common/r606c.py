"""R6-06 城堡 (the user 2026-10-19: 「希望像一個城堡」, D-089): the walled towns on the oblique battlefield, east and
west, the small town (palisade) and the big city (stone walls) side by side, in each holder's state. The cells are
design/b1/common/castle.py's (agreed with war-game-core); the pieces design/b1/blender/castle.py's.

python3 common/r606c.py ART RAW
  ART  an extracted art-v2/v3-x3.tar.gz (the units)
  RAW  the castle renders (design/b1/common/run.py castle_*)
-> out/R6-06-城堡-<東陸|西陸>-<中立|我方|敵方|廢墟>-mobile.png, out/R6-06-城堡-總覽.png
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "b1" / "common"))
import boards     # noqa: E402
import castle     # noqa: E402
import field      # noqa: E402
import rawart     # noqa: E402

SCALE = 3
STATES = [("neutral", "中立"), ("ours", "我方"), ("enemy", "敵方"), ("ruins", "廢墟")]
STATUS = {"neutral": "中立", "ours": "我方治理", "enemy": "敵方治理", "ruins": "廢墟"}
CULT = [("E", "東陸"), ("W", "西陸")]
OWNER = {"neutral": "neutral", "ours": "blue", "enemy": "red", "ruins": None}
SOLDIER = {"E": "spear_e", "W": "pike_w"}
COST = ("代價：core 要改模擬（牆擋路、四個門、尋路、民兵和駐軍站的位置），重新量打城難度；"
        "城鎮範圍改成牆以內：小鎮 81 格（和原本的圓圈一樣），大城 144 格（固定地圖，比原本的 156 格少 12 格；"
        "隨機地圖相鄰出生的大城 169 格，比原本的 149 格多 20 格，箭樓 3×3）；"
        "牆只擋走路、不擋射擊（遠程兵、法師、箭樓都能隔著牆打）；牆不會壞；存著的局會接不下去；"
        "ui 約 1.5 天（牆的圖塊和牆內鋪面，東陸、西陸各一套）。")


def pieces(L, c, state, atl, origin):
    """The wall pieces on their cells (one sprite for a gate's or a corner tower's cells), the paving, the tower."""
    ox, oy = origin
    big = L["name"] == "large"
    off = 0.5 if big else 0.0
    s = "ruin" if state == "ruins" else "intact"
    team = OWNER[state] or "neutral"
    out = [dict(atlas=atl, frame=f"tground_{c}_castle_{L['name']}", x=ox, y=oy, front=-99, ground=True)]
    R = L["wall"]                                 # 5 (cell offsets) or 6.5 (cell middles from the corner)

    def put(kind, a, b, n_deep=1):
        x, y = ox + a + (0.5 if not big else 0.0), oy + b + (0.5 if not big else 0.0)
        out.append(dict(atlas=atl, frame=f"{kind}_{c}_{s}", x=x, y=y, front=y + n_deep / 2, team=team))
    pre = "sw" if big else "pal"
    for (dx, dy), k in sorted(L["cells"].items()):
        a, b = dx + off, dy + off                 # the cell's middle, from the layout's middle
        if k == "gate":
            if abs(b) == R and abs(a) == (0.5 if big else 0):
                put(f"{pre}_gate_x", 0.0 if big else a, b)             # one sprite for the gate's cells
            elif abs(a) == R and abs(b) == (0.5 if big else 0):
                put(f"{pre}_gate_y", a, 0.0 if big else b, 4 if big else 3)
            continue
        if k == "ctower":
            if abs(a) == 6.5 and abs(b) == 6.5:
                put("sw_ctower", 6.0 * (1 if a > 0 else -1), 6.0 * (1 if b > 0 else -1), 2)
            continue
        if k == "corner":
            put("pal_corner", a, b)
            continue
        if k == "wall":
            if big and ((abs(b) == R and abs(a) == 1.5) or (abs(a) == R and abs(b) == 1.5)):
                continue                          # a gate's pier: drawn with the gate
            put(f"{pre}_x" if abs(b) == R else f"{pre}_y", a, b)
    if big and state == "neutral":
        out.append(dict(atlas=atl, frame=f"ttower_{c}_intact", x=ox, y=oy, front=oy + 1, team="neutral"))
    return out


def scene(L, c, state, atl):
    big = L["name"] == "large"
    origin = (30.0, 30.0) if big else (30.5, 30.5)        # the layout's middle: the tower's corner / the centre cell's middle
    props = pieces(L, c, state, atl, origin if big else (30.0, 30.0))
    units = []
    owner = OWNER[state]
    if state == "neutral":
        for k, (mx, my) in enumerate(L["militia"]):
            units.append((SOLDIER[c], "neutral", 30 + mx + 0.5, 30 + my + 0.5, (6, 7, 0)[k % 3], "idle", (k * 3) % 8, False))
    elif owner:
        for k, (gx, gy) in enumerate(L["garrison"]):
            units.append((SOLDIER[c], owner, 30 + gx + 0.5, 30 + gy + 0.5, (7, 6)[k % 2], "idle", k * 2, False))
    return dict(centre=(origin[0], origin[1] - (2.2 if big else 1.6)), buildings=[], nodes=[], props=props, units=units), origin


def panel(L, c, state, atl, art):
    sc, origin = scene(L, c, state, atl)
    img, _ = field.render(sc, art, scale=SCALE)
    cx, cy = field.cell_to_pt(*origin, sc["centre"])
    R = L["wall"] + 1
    half_w, below, above = R * field.CELL_W + 20, R * field.CELL_D + 40, R * field.CELL_D + (150 if L["name"] == "large" else 110)
    out = img.crop(tuple(int(round(v * SCALE)) for v in (cx - half_w, cy - above, cx + half_w, cy + below))).convert("RGB")
    dr = ImageDraw.Draw(out)
    f = boards.font(13 * SCALE)
    t = STATUS[state] + ("大城" if L["name"] == "large" else "小鎮")
    tw = dr.textlength(t, font=f)
    dr.text(((out.width - tw) / 2, out.height - 26 * SCALE), t, font=f, fill=(255, 255, 255), stroke_width=SCALE,
            stroke_fill=(0, 0, 0))
    return out


def main(art, raw):
    field.VIEW = "oblique"
    field.SCREEN = (1100, 640)
    atl = rawart.RawAtlas(raw)
    S, Lg = castle.small(), castle.large()
    small_px = {}
    for c, cn in CULT:
        for state, sname in STATES:
            pa, pb = panel(S, c, state, atl, art), panel(Lg, c, state, atl, art)
            W = boards.M * 2 + pa.width + pb.width + 40
            label = f"R6-06-城堡-{cn}-{sname}-mobile"
            head = boards.header(W, label,
                                 f"{cn}，{sname}：小鎮圍一圈木柵、四個門口有望樓；大城是石牆，四個城門（南北有城樓），四角有角樓。"
                                 "城門一直開著，誰都能走；擁有者的顏色在城門和角上的垂幔、旗子（中立米色、我方藍、敵方紅）。"
                                 + ("廢墟時牆照舊站著，燒黑、旗子燒掉，門開著。" if state == "ruins" else "")
                                 + f"\n{COST}\n"
                                 "左：小鎮；右：大城（中立時中間有箭樓；被攻下的大城箭樓已經拆了）。城鎮範圍就是牆以內，原本的範圍圈不畫了。"
                                 "格子照 R6-06-城堡-格子（和 core 對過）；都是方形斜看（D-088）。民兵先用中立色的槍兵代替。上：手機像素（3 倍）；下：實際大小。")
            big = boards.row([boards.captioned(pa, "小鎮（木柵）", 30), boards.captioned(pb, "大城（石牆）", 30)], W)
            sa, sb = (p.resize((p.width // 3, p.height // 3), Image.LANCZOS) for p in (pa, pb))
            small_px[(c, state)] = (sa, sb)
            boards.save(boards.stack([head, big, boards.row([boards.captioned(sa, "實際大小：小鎮", 22),
                                                             boards.captioned(sb, "實際大小：大城", 22)], W)], W), label)

    def pair(a, b):
        out = Image.new("RGB", (a.width + 16 + b.width, max(a.height, b.height)), boards.BG)
        out.paste(a, (0, 0))
        out.paste(b, (a.width + 16, 0))
        return out
    cellw = max(a.width + b.width + 16 for a, b in small_px.values())
    W = boards.M * 2 + 2 * cellw + 60
    parts = [boards.header(W, "R6-06-城堡-總覽", "左兩欄東陸、右兩欄西陸；每組左邊小鎮（木柵）、右邊大城（石牆），實際大小（1 pt = 1 px）。\n" + COST)]
    for state, sname in STATES:
        parts.append(boards.row([boards.captioned(pair(*small_px[(c, state)]), f"{cn}・{sname}", 22) for c, cn in CULT], W, gap=60))
    boards.save(boards.stack(parts, W), "R6-06-城堡-總覽")


if __name__ == "__main__":
    main(*sys.argv[1:3])
