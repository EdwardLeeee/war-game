"""R6-51 (the user 2026-10-20: 「地形感覺可以多元一點，石頭好少 我覺得這種天然障礙物可以多些來擋路可能會更好玩」): one board
per kind of natural obstacle, on a stretch of road at actual size (oblique, art-v3 units), showing that it blocks and
where the way goes round; and the whole fixed map with the obstacles (design/b1/common/terrain_map.py, checked by
war-game-core). The rules are core's (2026-10-20): none stops shots or sight; the sim changes and saved games end, in
D-089's batch (the castle walls).

python3 common/r651.py plan                  -> prints the patch plans (design/b1/common/run.py r651_* renders them)
python3 common/r651.py ART RAW TERRAIN_DIR   -> out/R6-51-地形-<種類>-mobile.png, …-整張地圖-mobile.png, …-總覽.png
  RAW          the patch renders (run.py r651_*: tpatch_<kind>_x3_*)
  TERRAIN_DIR  terrain_map.py's output (fixed-map-terrain-grid.json) and core's base grid next to it
"""
import json
import math
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

W_CELLS, D_CELLS = 24, 14            # the stretch of road: 48 x 28 m
CX, CY = 12.0, 7.0                   # its middle, in the local cells the scenes use
COMMON = "不擋射擊和視野（例如懸崖、河後面的兵照樣打得到）；要改模擬（地圖產生和固定地圖要放這些地形），存著的局會接不下去，和城牆同一批（D-089）。"
KINDS = [
    ("rocks", "石堆", "一堆一堆的大石頭，不能走、不能蓋。現在的岩石只是多擺、擺大堆。",
     "模擬沿用現在的岩石規則；電腦本來就會繞岩石，預期不會變笨（以 core 的量測為準）。ui 約半天：石頭圖塊 6 種。"),
    ("ridge", "岩脊", "一長條岩石帶，像一道石牆，中間留 3 格寬的缺口。",
     "模擬沿用岩石規則，擺成一長條；缺口 3 格寬，和城門一樣，大軍不會卡成一條線。ui 和石堆共用圖塊。"),
    ("cliff", "懸崖", "1 格寬的一道岩壁，比石堆高、顏色深。只能從它的盡頭繞過去。",
     "模擬：規則和岩石一樣，地格多一個值讓畫面畫成懸崖；斜的懸崖也擋得住，兵不能切角穿過。ui 約半天：岩壁圖塊（直、轉角、端點）。"),
    ("ford", "河與淺灘", "2–3 格寬的河，不能走；淺灘 3 格寬，看得到露出的石頭，從那裡過河。第一版走淺灘不會變慢。",
     "模擬：新地格「水」不能走、不能蓋，「淺灘」可以走。電腦本來就會繞路找窄口，但大軍可能在窄口擠住，core 會量。ui 約 1 天：水和岸邊的圖塊。"),
    ("bridge", "河與橋", "同一條河，3 格寬的木橋，從橋上過河。",
     "模擬：「橋」和淺灘一樣可以走，只是圖不同。ui 和河共用圖塊，另加橋。"),
    ("lake", "湖", "一大片水，從兩邊繞過去。",
     "模擬：和河的水一樣。ui 和河共用圖塊。"),
    ("forestA", "密林甲（可以砍）", "成片的樹林，就是現在的樹，村民砍完路就開了，地形會隨對局改變。",
     "模擬不用新規則，只是多種、成片種；電腦照舊砍樹，不會專門去開路。ui 不用新圖。"),
    ("forestB", "密林乙（砍不掉）", "樹下長滿灌木和荊棘，看得出走不進去；規則和岩石一樣，是固定的障礙。",
     "模擬：規則和岩石一樣，地格多一個值。ui 約半天：密林圖塊。"),
]


def cells_blob(cx, cy, rx, ry):
    return [(x, y) for x in range(W_CELLS) for y in range(D_CELLS) if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1]


def scene(kind):
    """dict(block (cells), open (the walkable gap / crossing cells), route (the way round, local cells), road, ...)."""
    s = dict(block=[], open=[], water=[], ford=[], bridge=[], trees=[], thick=[], rocks=[], cliff=[])
    straight = [(0.0, 7.5), (24.0, 7.5)]
    if kind == "rocks":
        s["rocks"] = cells_blob(11.5, 8.2, 2.6, 2.4) + cells_blob(15.8, 10.6, 1.2, 1.1)
        route = [(0, 7.5), (7.5, 7.5), (9.5, 4.6), (14.5, 4.6), (16.5, 7.5), (24, 7.5)]
    elif kind == "ridge":
        s["rocks"] = [(x, y) for x in (11, 12) for y in range(D_CELLS) if not 2 <= y <= 4]
        s["open"] = [(x, y) for x in (11, 12) for y in (2, 3, 4)]
        route = [(0, 7.5), (8.0, 7.5), (10.0, 3.5), (14.0, 3.5), (16.0, 7.5), (24, 7.5)]
    elif kind == "cliff":
        s["cliff"] = sorted({(int(8.6 + 7.0 * t), int(0.2 + 11.6 * t)) for t in [k / 48 for k in range(49)]})
        route = [(0, 7.5), (8.0, 10.0), (12.5, 13.0), (17.0, 13.0), (19.0, 10.0), (24, 7.5)]
    elif kind in ("ford", "bridge"):
        s["water"] = [(x, y) for y in range(D_CELLS) for x in range(W_CELLS)
                      if abs(x + 0.5 - (12.1 + 0.8 * math.sin((y + 0.5) / 2.6))) <= 1.3]
        cross = [(x, y) for x, y in s["water"] if 6 <= y <= 8]
        s["water"] = [c for c in s["water"] if c not in cross]
        s["open"] = cross
        s["ford" if kind == "ford" else "bridge"] = cross
        route = straight
    elif kind == "lake":
        s["water"] = cells_blob(12.0, 7.5, 4.8, 3.6)
        route = [(0, 7.5), (6.0, 7.5), (8.5, 2.4), (15.5, 2.4), (18.0, 7.5), (24, 7.5)]
    else:
        cells = cells_blob(12.0, 7.0, 3.8, 4.4)
        s["trees" if kind == "forestA" else "thick"] = cells
        route = [(0, 7.5), (6.5, 7.5), (8.5, 12.6), (15.5, 12.6), (17.5, 7.5), (24, 7.5)]
    s["block"] = s["rocks"] + s["cliff"] + s["water"] + s["trees"] + s["thick"]
    s["route"] = route
    s["straight"] = straight
    return s


def to_m(x, y):
    return (x - CX) * 2.0, -(y - CY) * 2.0


def _poly_cells(cells):
    """One square polygon per cell (metres): the patch draws water and fords cell by cell."""
    out = []
    for x, y in cells:
        (a, b), (c, d) = to_m(x, y), to_m(x + 1, y + 1)
        out.append([(a, b), (c, b), (c, d), (a, d)])
    return out


def _band(line, half, y0=None, y1=None):
    """A polygon round a centre line (local cells) `half` cells to each side, metres; only the part with y0 <= y < y1."""
    pts = [(x, y) for x, y in line if (y0 is None or y >= y0) and (y1 is None or y <= y1)]
    left, right = [], []
    for k, (x, y) in enumerate(pts):
        a, b = pts[max(0, k - 1)], pts[min(len(pts) - 1, k + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / L, dx / L
        left.append(to_m(x + nx * half, y + ny * half))
        right.append(to_m(x - nx * half, y - ny * half))
    return left + right[::-1]


def _ellipse(cx, cy, rx, ry, n=40, j=0.06, seed=3):
    rnd = random.Random(seed)
    out = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + rnd.uniform(-j, j)
        out.append(to_m(cx + rx * k * math.cos(a), cy + ry * k * math.sin(a)))
    return out


RIVER = [(12.1 + 0.8 * math.sin(y / 2.6), y) for y in [k * 0.5 - 1.0 for k in range(34)]]
CLIFF = [(8.6 + 7.0 * t, 0.2 + 11.6 * t) for t in [k / 12 for k in range(13)]]


def plan(kind):
    s = scene(kind)
    rnd = random.Random(5)
    blocked = set(s["block"])
    decals = []
    for _ in range(90):
        x, y = rnd.uniform(0, W_CELLS), rnd.uniform(0, D_CELLS)
        if (int(x), int(y)) in blocked or any(math.hypot(x - a, y - b) < 1.6 for a, b in s["route"]):
            continue
        decals.append((rnd.choice(["flower", "tuft", "tuft", "pebble"]), *to_m(x, y), rnd.uniform(0.8, 1.2)))
    road = [[to_m(x, y) for x, y in s["route"]]]
    p = dict(ground=dict(road=road, decals=decals, dark=[], dirt=[], gravel=[]),
             rocks=[to_m(x + 0.5, y + 0.5) for x, y in s["rocks"]],
             cliff_line=[to_m(x, y) for x, y in CLIFF] if kind == "cliff" else [],
             water=[], bank=[], ford=[],
             trees=[(*to_m(x + 0.5, y + 0.5), (x * 7 + y * 13) % 3) for x, y in s["trees"]],
             thick=[to_m(x + 0.5, y + 0.5) for x, y in s["thick"]])
    if kind in ("ford", "bridge"):
        p["bank"] = [_band(RIVER, 1.75)]
        if kind == "ford":
            p["water"] = [_band(RIVER, 1.3, None, 6.0), _band(RIVER, 1.3, 9.0, None)]
            p["ford"] = [_band(RIVER, 1.4, 5.9, 9.1)]
        else:
            p["water"] = [_band(RIVER, 1.3)]
            cx = 12.1 + 0.8 * math.sin(7.5 / 2.6)
            (a, b), (c, d) = to_m(cx - 1.9, 9.0), to_m(cx + 1.9, 6.0)
            p["bridge"] = [(a, b, c, d)]
    elif kind == "lake":
        p["bank"] = [_ellipse(12.0, 7.5, 5.25, 4.0)]
        p["water"] = [_ellipse(12.0, 7.5, 4.8, 3.6)]
    return p


# ---------------------------------------------------------------- the boards

def board_shot(kind, art, raw):
    import field
    import rawart
    import boards
    field.VIEW = "oblique"
    s = scene(kind)
    atl = rawart.RawAtlas(raw)
    patch = dict(atlas=atl, frame=f"tpatch_{kind}", x=CX, y=CY, front=-999, ground=True)
    units = [("spear_e", "blue", 2.6 + (k % 3) * 1.0, 6.9 + (k // 3) * 1.0, 7, "walk", (k * 3) % 8, False) for k in range(6)]
    sc = dict(centre=(CX, CY), buildings=[], nodes=[], props=[patch], units=units)
    old = field.SCREEN
    field.SCREEN = (W_CELLS * 40, D_CELLS * 20)
    try:
        img, _ = field.render(sc, art, scale=3)
    finally:
        field.SCREEN = old
    img = img.convert("RGBA")
    k = 3
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    dr = ImageDraw.Draw(ov)
    pt = lambda x, y: (x * 40 * k, y * 20 * k)
    # the way round: a dashed line with an arrow head
    route = [pt(x, y) for x, y in s["route"]]
    for (x0, y0), (x1, y1) in zip(route, route[1:]):
        L = math.hypot(x1 - x0, y1 - y0)
        n = int(L / 36)
        for i in range(0, n, 2):
            a, b = i / n, min(1, (i + 1) / n)
            dr.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)], fill=(255, 243, 176, 235), width=10)
    (xa, ya), (xb, yb) = route[-2], route[-1]
    ang = math.atan2(yb - ya, xb - xa)
    tip = (xb - 30 * math.cos(ang), yb - 30 * math.sin(ang))
    dr.polygon([tip, (tip[0] - 46 * math.cos(ang - 0.5), tip[1] - 46 * math.sin(ang - 0.5)),
                (tip[0] - 46 * math.cos(ang + 0.5), tip[1] - 46 * math.sin(ang + 0.5))], fill=(255, 243, 176, 245))
    # where the straight way is blocked: a red cross, when the route is not straight
    if s["route"] != s["straight"]:
        bx = [x for x, y in s["block"] if 6 <= y <= 8]
        if bx:
            cx, cy = pt(min(bx) - 0.6, 7.5)
            for d in (-1, 1):
                dr.line([(cx - 34, cy - 34 * d), (cx + 34, cy + 34 * d)], fill=(217, 67, 58, 240), width=12)
    # the walkable gap or crossing, outlined
    if s["open"]:
        xs = [x for x, _ in s["open"]]
        ys = [y for _, y in s["open"]]
        dr.rectangle([*pt(min(xs), min(ys)), *pt(max(xs) + 1, max(ys) + 1)], outline=(120, 230, 120, 240), width=8)
    img.alpha_composite(ov)
    return img.convert("RGB")


def map_picture(rows, k=6):
    col = {".": (122, 152, 92), "-": (122, 152, 92), "#": (128, 122, 112), "R": (128, 122, 112), "K": (92, 70, 54),
           "~": (60, 112, 172), "f": (140, 182, 202), "=": (176, 124, 72), "F": (24, 60, 28), "T": (46, 98, 44),
           "G": (230, 200, 40), "B": (200, 40, 80), "C": (60, 200, 220), "M": (40, 90, 220), "W": (64, 54, 44),
           "D": (236, 196, 120), "i": (214, 206, 186), "O": (160, 60, 50)}
    n = len(rows)
    im = Image.new("RGB", (n * k, n * k))
    dr = ImageDraw.Draw(im)
    for y, r in enumerate(rows):
        for x, ch in enumerate(r):
            dr.rectangle([x * k, y * k, x * k + k - 1, y * k + k - 1], fill=col[ch])
    return im


def main(art, raw, tdir):
    import boards
    tdir = Path(tdir)
    shots = {}
    for kind, name, what, cost in KINDS:
        img = board_shot(kind, art, raw)
        shots[kind] = img
        W = boards.M * 2 + img.width
        label = f"R6-51-地形-{name.split('（')[0] if kind not in ('forestA', 'forestB') else name.replace('（', '-').rstrip('）')}-mobile"
        head = boards.header(W, label, f"{name}：{what}\n代價：{cost}{COMMON}\n"
                             "一段路，方形斜看、實際的大小；一隊槍兵要往右走。黃色虛線是要繞的路，紅叉是直走過不去的地方，綠框是可以走的缺口或過河的地方"
                             "（這些線只畫在設計稿上，遊戲裡沒有）。上：手機像素（3 倍）；下：實際大小。")
        top = Image.new("RGB", (W, img.height + 20), boards.BG)
        top.paste(img, (boards.M, 0))
        act = boards.row([boards.captioned(img.resize((img.width // 3, img.height // 3), Image.LANCZOS), "實際大小", 22)], W)
        boards.save(boards.stack([head, top, act], W), label)
    # the whole fixed map: now and with the obstacles
    base = json.loads((tdir / "fixed-map-base-grid.json").read_text())["rows"]
    new = json.loads((tdir / "fixed-map-terrain-grid.json").read_text())
    a, b = map_picture(base), map_picture(new["rows"])
    W = boards.M * 2 + a.width + b.width + 60
    # the detours as war-game-core measured them (2026-10-20, its own walker: 8-way, 10 / 14, no corner cutting, uncut
    # trees block), against an obstacle-free walk
    mm, towns = 1.118, [1.000, 1.025, 1.048, 1.250]
    head = boards.header(W, "R6-51-地形-整張地圖-mobile",
                         "固定地圖縮到最小（一格 6 px）。左：現在；右：加了地形以後（war-game-core 檢查過：兩家完全對稱、沒有被圍死的地方、每座城的門外都走得到）。"
                         "每家門前一條河：往中間和西北兩座小鎮走橋，往東南小鎮走淺灘；中間西邊兩段岩脊留缺口；往東南小鎮的路旁一道懸崖；"
                         "中間和東南小鎮之間一個湖；河邊一片密林乙。\n"
                         f"繞路（core 量的，和什麼都不擋時比）：主城到主城 {mm:.3f} 倍（ceo 定 1.10–1.40），主城到各城鎮 {min(towns):.3f}–{max(towns):.3f} 倍（最多 1.60）；兩家到最近小鎮一樣遠。"
                         "藍：水；淺藍：淺灘；褐：橋；灰：岩石；深褐：懸崖；深綠：密林乙；綠：樹（密林甲）。" + COMMON)
    row = boards.row([boards.captioned(a, "現在", 26), boards.captioned(b, "加了地形", 26)], W, gap=60)
    boards.save(boards.stack([head, row], W), "R6-51-地形-整張地圖-mobile")
    # the overview: every kind at actual size, two to a row
    cells = [boards.captioned(shots[k].resize((shots[k].width // 3, shots[k].height // 3), Image.LANCZOS), n, 22) for k, n, _, _ in KINDS]
    cw = cells[0].width
    W = boards.M * 2 + 2 * cw + 40
    parts = [boards.header(W, "R6-51-地形-總覽", "八種天然障礙物，實際大小。黃色虛線：繞過去的路；綠框：可以走的缺口、淺灘、橋。" + COMMON)]
    for i in range(0, len(cells), 2):
        parts.append(boards.row(cells[i:i + 2], W))
    boards.save(boards.stack(parts, W), "R6-51-地形-總覽")


if __name__ == "__main__":
    if sys.argv[1] == "plan":
        for k, *_ in KINDS:
            p = plan(k)
            print(k, {kk: len(v) for kk, v in p.items() if kk != "ground"})
    else:
        main(*sys.argv[1:4])
