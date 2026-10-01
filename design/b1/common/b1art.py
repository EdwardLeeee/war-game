"""B1 artboards (the images ceo shows the user). File name = label inside the image:
輪次-項目編號-項目名-選項字母-選項名-裝置.

python3 common/b1art.py [b102] [b103] [overview1] [--suffix x3|prev]
"""
import argparse
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "round1" / "common"))
import artboard   # noqa: E402
import config     # noqa: E402
import layouts    # noqa: E402
import proj       # noqa: E402
import scene      # noqa: E402
import town_art   # noqa: E402

BG = (244, 241, 234)
INK = (40, 40, 40)
GREY = (96, 96, 96)
GROUND = (118, 128, 104)
GRID = (104, 114, 92)
FOOT = (226, 200, 96)
CULT = {"E": "東陸", "W": "西陸"}
BNAME = {"main_city": "主城", "house": "民居", "barracks": "兵營"}
SRC_PPM = {"x3": 60, "prev": 30}


def src_ppm(suffix, d=None):
    """Pixels per metre of the renders in a folder (previews vary)."""
    import json
    if suffix == "x3":
        return 60
    if d is not None:
        for m in Path(d).glob(f"*_{suffix}.json"):
            return json.loads(m.read_text())["px_per_m"]
    return SRC_PPM[suffix]


def wrap(dr, x, y, text, width, size=22, fill=GREY):
    f = artboard.font(size)
    line = ""
    for ch in text:
        if ch == "\n":
            dr.text((x, y), line, font=f, fill=fill)
            y += size + 10
            line = ""
            continue
        if dr.textlength(line + ch, font=f) > width:
            dr.text((x, y), line, font=f, fill=fill)
            y += size + 10
            line = ch
        else:
            line += ch
    if line:
        dr.text((x, y), line, font=f, fill=fill)
        y += size + 10
    return y


def header_height(sub, width, size=24):
    return wrap(ImageDraw.Draw(Image.new("RGB", (8, 8))), 0, 120, sub, width, size) + 16


def draw_header(art, label, sub, M, size=24):
    dr = ImageDraw.Draw(art)
    dr.text((M, 36), label, font=artboard.font(54), fill=INK)
    return wrap(dr, M, 120, sub, art.width - 2 * M, size) + 16


def tile(items, pp, footprint=None, pad=24, grid_extra=1, min_size=None):
    """Compose sprites on a ground tile with the cell grid (and the footprint outlined). pp: px per pt."""
    ppm = 20 * pp
    img, origin = scene.render(items, ppm, pad=pad, bg=GROUND)
    if footprint:
        fx, fy = footprint
        # grid under the sprites: draw on a ground copy, then put the sprites back on top
        g = Image.new("RGBA", img.size, (*GROUND, 255))
        dr = ImageDraw.Draw(g)
        for p0, p1 in proj.grid_lines(fx, fy, layouts.CELL, grid_extra):
            dr.line([proj.to_px(p0, origin, ppm), proj.to_px(p1, origin, ppm)], fill=GRID, width=1)
        hx, hy = fx * layouts.CELL / 2, fy * layouts.CELL / 2
        dr.polygon([proj.to_px(p, origin, ppm) for p in ((-hx, -hy), (hx, -hy), (hx, hy), (-hx, hy))], outline=FOOT)
        sp_t, _ = render_transparent(items, ppm, origin, img.size)      # the sprites again, over the grid
        g.alpha_composite(sp_t)
        img = g
    if min_size:
        W, H = max(img.width, min_size[0]), max(img.height, min_size[1])
        c = Image.new("RGBA", (W, H), (*GROUND, 255))
        c.alpha_composite(img, ((W - img.width) // 2, H - img.height))
        img = c
    return img


def render_transparent(items, ppm, origin, size):
    W, H = size
    can = Image.new("RGBA", (W, H), (0, 0, 0, 0))

    def at(s):
        cx = (s.rect[0] + s.rect[1]) / 2
        cy = (s.rect[2] + s.rect[3]) / 2
        return proj.to_px((cx, cy, s.z), origin, ppm)

    for s in [s for s in items if s.ground]:
        gx, gy = at(s)
        can.alpha_composite(s.img, (int(round(gx - s.ax)), int(round(gy - s.ay))))
    for s in items:
        if s.shadow and not s.ground:           # ground pieces (paving, fields) keep their own shading
            gx, gy = at(s)
            si, sax, say = s.shadow
            can.alpha_composite(si, (int(round(gx - sax)), int(round(gy - say))))
    for s in scene.order([s for s in items if not s.ground and not s.top]):
        gx, gy = at(s)
        can.alpha_composite(s.img, (int(round(gx - s.ax)), int(round(gy - s.ay))))
    for s in [s for s in items if s.top]:
        gx, gy = at(s)
        can.alpha_composite(s.img, (int(round(gx - s.ax)), int(round(gy - s.ay))))
    return can, origin


def caption(img, text, size=18):
    dr = ImageDraw.Draw(img)
    f = artboard.font(size)
    dr.text((7, 5), text, font=f, fill=(20, 22, 18))
    dr.text((6, 4), text, font=f, fill=(250, 248, 240))
    return img


# ---------------------------------------------------------------- B1-02

B102 = {
    "build": [
        ("A", "分三階段", ["build_a1", "build_a2", "build_a3"], ["地基", "木架", "半成品"],
         "選項 A：分三個階段蓋起來。第一階段是地基、木樁和繩子圍出整塊占地，旁邊堆木料石材；第二階段牆的木架立起來、"
         "外面搭鷹架；第三階段牆蓋好、屋頂只有椽子。每一棟都照自己的樣子畫。"),
        ("B", "由下往上", ["build_b1", "build_b2", "build_b3"], ["30%", "60%", "85%"],
         "選項 B：蓋好的房子由下往上長出來，外面從頭到尾罩著一整座鷹架和帆布。進度看房子長到多高。"),
    ],
    "damaged": [
        ("A", "著火", ["done", "damaged_a"], ["完成", "受損"],
         "選項 A：屋頂破洞冒出火和黑煙，牆被燻黑。實際大小下靠火光和黑煙一眼看出來。"),
        ("B", "不著火", ["done", "damaged_b"], ["完成", "受損"],
         "選項 B：不著火。屋頂掉了幾片瓦、牆上有裂縫和焦痕、地上散著瓦片，冒一縷細煙。比較安靜，實際大小下比 A 不明顯。"),
    ],
    "destroyed": [
        ("A", "瓦礫堆", ["done", "destroyed_a"], ["完成", "被摧毀"],
         "選項 A：塌成一堆低矮的瓦礫，夾著燒黑的樑和碎瓦，冒一點餘煙。都在 0.6 公尺以下，看起來走得過去"
         "（建築被摧毀後模擬馬上把它移走，那幾格可以走）。"),
        ("B", "焦黑地基", ["done", "destroyed_b"], ["完成", "被摧毀"],
         "選項 B：只剩燒黑的地基和膝蓋高的斷牆，地上有灰燼和碎瓦。牆不超過 0.45 公尺，看起來走得過去。"),
    ],
}
ITEM = {"build": "施工中", "damaged": "受損", "destroyed": "被摧毀"}
CORE = ("main_city", "house", "barracks")


def _state_piece(kind, c, state, suffix, ppm):
    team = "blue" if c == "E" else "red"          # East blue, West red on every B1-02 board
    if state == "done":
        return scene.piece(config.BUILD / "b1" / "core3", f"{kind}_{c}", suffix, ppm=ppm, team=team)
    return scene.piece(config.BUILD / "b1" / "states", f"{kind}_{c}_{state}", suffix, ppm=ppm, team=team)


def b102_board(item, opt, name, states_, labels, sub, suffix):
    label = f"B1-02-{ITEM[item]}-{opt}-{name}-mobile"
    pp = 1.5                                   # px per pt for the big panels (phone pixels are 3)
    scale = 20 * pp                              # pixels per metre on the board
    M = 50
    rows = []
    for kind in CORE:
        cells = []
        for c in ("E", "W"):
            for st, lab in zip(states_, labels):
                sp = _state_piece(kind, c, st, suffix, scale)
                t = tile(scene.with_fx(sp), pp, footprint=tuple(sp.meta["footprint"]))
                cells.append(caption(t, f"{CULT[c]}・{lab}"))
        rows.append((kind, cells))
    # actual size: every building in the last state, both cultures, with a spearman and a farmer
    s1 = 20
    act = []
    for c in ("E", "W"):
        for kind in CORE:
            sp = _state_piece(kind, c, states_[-1], suffix, s1)
            items = scene.with_fx(sp)
            fx, fy = sp.meta["footprint"]
            items.append(scene.unit(town_art.SOLDIER[c], "blue" if c == "E" else "red", scale=1 / 3,
                                    x=-fx - 0.6, y=-fy * 0.2))
            act.append(tile(items, 1.0, pad=10))
    sub2 = sub + "\n上面三列是放大（1 pt = 1.5 px，手機像素的一半），黃框是占地；最下面一列是實際大小（1 pt = 1 px），旁邊站一名士兵當比例尺。東陸藍、西陸紅。"
    gap = 14
    W = M * 2 + max(sum(c.width for c in cells) + gap * (len(cells) - 1) for _, cells in rows) + 140
    top = header_height(sub2, W - 2 * M)
    H = top + sum(max(c.height for c in cells) + 50 for _, cells in rows) + max(a.height for a in act) + 90
    art = Image.new("RGB", (W, H), BG)
    y = draw_header(art, label, sub2, M)
    dr = ImageDraw.Draw(art)
    for kind, cells in rows:
        dr.text((M, y), BNAME[kind], font=artboard.font(30), fill=INK)
        x = M + 140
        hh = max(c.height for c in cells)
        for k, cimg in enumerate(cells):
            art.paste(cimg.convert("RGB"), (x, y + hh - cimg.height))
            x += cimg.width + gap + (24 if k == len(cells) // 2 - 1 else 0)
        y += hh + 50
    dr.text((M, y), "實際大小", font=artboard.font(26), fill=INK)
    x = M + 140
    ah = max(a.height for a in act)
    for a in act:
        art.paste(a.convert("RGB"), (x, y + ah - a.height))
        x += a.width + 10
    art = art.crop((0, 0, W, y + ah + 30))
    p = config.OUT / f"{label}.png"
    art.save(p)
    print("wrote", p.name, art.size)
    return p


def b102(suffix):
    out = []
    for item, opts in B102.items():
        for opt, name, st, labs, sub in opts:
            out.append(b102_board(item, opt, name, st, labs, sub, suffix))
    return out


# ---------------------------------------------------------------- B1-03

B103 = [
    ("A", "旗與炊煙", "A",
     "選項 A「旗與炊煙」：廣場中間的旗桿說明這座城是誰的。中立掛灰白的鄉勇旗；治理中掛治理者顏色的大旗，房子冒炊煙、"
     "旗下堆著繳來的糧袋和金晶；修繕中旗子升到一半；正在搶和廢墟時旗桿斷了。"),
    ("B", "界樁圍一圈", "B",
     "選項 B「界樁圍一圈」：城鎮範圍的邊上立一圈界樁（就是攻下和駐軍算的那個圈）。中立掛一對白燈籠；治理中掛治理者顏色的長幡；"
     "正在搶時燈籠和幡都被扯掉；廢墟時界樁倒在地上。"),
    ("AB", "兩個都要", "AB", "A 和 B 一起用的樣子（兩者不衝突）。"),
]
COMMON_103 = ("三個選項的房子都一樣：廢墟是燒剩的空殼（牆還站著，那幾格仍然擋路）；正在搶時有房子起火、貨車翻倒、敵兵在廣場；"
              "修繕中搭鷹架、堆木料。大城中立時有箭樓，攻下時箭樓一定已經被拆掉（右邊多一欄「中立（箭樓已拆）」是廢墟過後回到中立的樣子）。"
              "我方、敵方只靠玩家色分（ceo 2026-10-01）；國徽只是裝飾。民兵是替代：同文化的槍兵套中立灰白。")
TOWN_ROWS = [("small", "E"), ("small", "W"), ("large", "E"), ("large", "W")]


def b103_board(opt, name, direction, sub, suffix):
    label = f"B1-03-城鎮狀態-{opt}-{name}-mobile"
    M = 50
    cols = town_art.STATES + ["neutral_notower"]
    grid = []
    for size, c in TOWN_ROWS:
        L = layouts.small() if size == "small" else layouts.large()
        row = []
        for st in cols:
            if st == "neutral_notower" and size == "small":
                row.append(None)
                continue
            img, _ = town_art.town(c, L, st, direction, suffix)
            if suffix == "prev":           # previews are 1.5 px per pt; the board is at actual size
                img = img.resize((round(img.width * 2 / 3), round(img.height * 2 / 3)), Image.LANCZOS)
            else:
                img = img.resize((round(img.width / 3), round(img.height / 3)), Image.LANCZOS)
            row.append(img)
        grid.append((size, c, row))
    colw = [max((r[k].width for _, _, r in grid if r[k] is not None), default=200) for k in range(len(cols))]
    sub2 = sub + "\n" + COMMON_103 + "\n全部是實際大小（1 pt = 1 px）：一眼分不分得出來，要在這個大小看。"
    W = M * 2 + 170 + sum(colw) + 12 * len(cols)
    top = header_height(sub2, W - 2 * M)
    rowh = [max(i.height for i in r if i is not None) for _, _, r in grid]
    H = top + 50 + sum(rowh) + 26 * len(grid) + 40
    art = Image.new("RGB", (W, H), BG)
    y = draw_header(art, label, sub2, M)
    dr = ImageDraw.Draw(art)
    x = M + 170
    for k, st in enumerate(cols):
        dr.text((x + 6, y), town_art.NAMES[st], font=artboard.font(24), fill=INK)
        x += colw[k] + 12
    y += 40
    for (size, c, row), h in zip(grid, rowh):
        dr.text((M, y + h // 2 - 16), f"{'小鎮' if size == 'small' else '大城'}・{CULT[c]}", font=artboard.font(26),
                fill=INK)
        x = M + 170
        for k, img in enumerate(row):
            if img is not None:
                art.paste(img.convert("RGB"), (x + (colw[k] - img.width) // 2, y + h - img.height))
            else:
                dr.text((x + 20, y + h // 2), "小鎮沒有箭樓", font=artboard.font(18), fill=GREY)
            x += colw[k] + 12
        y += h + 26
    p = config.OUT / f"{label}.png"
    art.save(p)
    print("wrote", p.name, art.size)
    return p


def b103(suffix):
    return [b103_board(o, n, d, s, suffix) for o, n, d, s in B103]


# ---------------------------------------------------------------- B1-01

GROUPS = [("基礎", ["main_city", "house", "lumber_camp", "mine", "granary", "farm"]),
          ("軍事", ["barracks", "range", "mage_hall", "stable", "workshop", "smithy"]),
          ("城防", ["tower", "walls", "gate", "branch_city"])]
NAMES = {"main_city": "主城", "house": "民居", "lumber_camp": "伐木場", "mine": "礦場", "granary": "糧倉", "farm": "農田",
         "barracks": "兵營", "range": "射場", "mage_hall": ("術院", "晶塔"), "stable": "馬廄", "workshop": "砲坊",
         "smithy": "鐵匠鋪", "tower": "箭樓", "walls": "城牆", "gate": "城門", "branch_city": "分城"}
LOOK = {   # what makes each one recognisable at actual size (the second check)
    "main_city": ("重簷大殿、高台、兩面大旗", "石造主堡、圓塔、兩面大旗"),
    "house": ("最小、有門簾、水缸", "最小、木架白牆、煙囪"),
    "lumber_camp": ("草頂棚子下堆滿原木", "草頂棚子下堆滿原木"),
    "mine": ("礦石堆有金塊和魔晶、礦車、吊架", "礦石堆有金塊和魔晶、礦車、吊架"),
    "granary": ("架高的草頂穀倉、糧袋", "穀倉大門、圓筒倉、糧袋"),
    "farm": ("平的田、一行行作物、稻草人", "平的田、一行行麥子、稻草人"),
    "barracks": ("長屋加練兵場：兵器架、木樁人", "長屋加練兵場：兵器架、木樁人、圓盾"),
    "range": ("一排紅圈靶子", "一排紅圈靶子"),
    "mage_hall": ("三層塔、頂上一簇魔晶", "細高石塔、頂上一大簇魔晶"),
    "stable": ("一排馬房門、圍欄、乾草", "一排馬房門、圍欄、乾草"),
    "workshop": ("做到一半的投石器、吊架", "做到一半的投石器、吊架"),
    "smithy": ("煙囪、爐火、鐵砧", "煙囪、爐火、鐵砧"),
    "tower": ("木造高望樓", "圓石塔、尖頂"),
    "walls": ("磚牆、瓦簷、雉堞", "石牆、雉堞"),
    "gate": ("兩座門墩、門樓", "兩座門塔、尖頂"),
    "branch_city": ("台基上的單簷大殿、一面大旗", "方石塔加大屋、旗"),
}


def bname(kind, c):
    n = NAMES[kind]
    return n if isinstance(n, str) else n[0 if c == "E" else 1]


def _bdir(kind):
    return "core3" if kind in CORE else "b101"


def bpiece(kind, c, suffix, ppm, team="blue", x=0.0, y=0.0, tag=None):
    name = f"{kind}_{c}" + (f"_{tag}" if tag else "")
    sp = scene.piece(config.BUILD / "b1" / _bdir(kind), name, suffix, team=team, ppm=ppm, x=x, y=y)
    sp.ground = kind == "farm"           # walkable and low: drawn with the ground, under the units
    return sp


def walls_items(c, suffix, ppm, team="blue"):
    """A small walled square, 9 x 7 cells: four corner turrets, straight runs, a gate in the middle of
    the -y side (along x) and of the -x side (along y)."""
    items = []
    nx, ny = 9, 7
    C = layouts.CELL
    gx = range(2, 6)            # cells of the -y side taken by the gate along x
    gy = range(1, 5)            # cells of the -x side taken by the gate along y
    for i in range(nx):
        for j in range(ny):
            edge_x = i in (0, nx - 1)
            edge_y = j in (0, ny - 1)
            if not (edge_x or edge_y):
                continue
            x, y = (i - (nx - 1) / 2) * C, (j - (ny - 1) / 2) * C
            if edge_x and edge_y:
                items.append(bpiece("wall", c, suffix, ppm, team, x, y, "corner"))
            elif j == 0 and i in gx:
                if i == gx[0]:
                    items.append(bpiece("gate", c, suffix, ppm, team, x + 1.5 * C, y, "x"))
            elif i == 0 and j in gy:
                if j == gy[0]:
                    items.append(bpiece("gate", c, suffix, ppm, team, x, y + 1.5 * C, "y"))
            elif edge_y:
                items.append(bpiece("wall", c, suffix, ppm, team, x, y, "x"))
            else:
                items.append(bpiece("wall", c, suffix, ppm, team, x, y, "y"))
    return items


def kind_items(kind, c, suffix, scale, team="blue"):
    if kind == "walls":
        return walls_items(c, suffix, scale, team)
    if kind == "gate":
        return scene.with_fx(bpiece("gate", c, suffix, scale, team, tag="x"))
    return scene.with_fx(bpiece(kind, c, suffix, scale, team))


FP = {"main_city": (4, 4), "house": (2, 2), "lumber_camp": (2, 2), "mine": (2, 2), "granary": (2, 2), "farm": (3, 3),
      "barracks": (3, 3), "range": (3, 3), "mage_hall": (3, 3), "stable": (3, 3), "workshop": (3, 3), "smithy": (2, 2),
      "tower": (2, 2), "walls": (9, 7), "gate": (4, 1), "branch_city": (3, 3)}


def footprint_of(kind):
    return FP[kind]


def team_share(kind, c, suffix):
    """Share of the building's pixels that take the player colour (mask > 50%)."""
    import numpy as np
    if kind in ("walls", "gate"):
        name, d = f"gate_{c}_x", "b101"
    else:
        name, d = f"{kind}_{c}", _bdir(kind)
    base = config.BUILD / "b1" / d / f"{name}_{suffix}"
    try:
        a = np.asarray(Image.open(f"{base}_beauty.png").getchannel("A")) > 128
        m = np.asarray(Image.open(f"{base}_mask.png").convert("L")) > 128
    except FileNotFoundError:
        return None
    return float((a & m).sum()) / max(1, a.sum())


def probe_text(kind, c, suffix):
    import json
    if kind in ("walls", "gate"):
        return "城牆和城門本來就要擋路，不做這項測試。"
    p = config.BUILD / "b1" / _bdir(kind) / f"{kind}_{c}_probe.json"         # local probe (thin poles ignored)
    if not p.exists():
        p = config.BUILD / "b1" / _bdir(kind) / f"{kind}_{c}_{suffix}.json"
    m = json.loads(p.read_text())
    pr = m.get("probe")
    if not pr:
        return ""
    b1 = pr["by_cells"]["1"]
    faces = [s[2] for s in b1["spots"] if s[0] != "corner"]
    corner = [s[2] for s in b1["spots"] if s[0] == "corner"][0]
    up = pr["upper_half_from_cells"]
    full = sum(1 for v in faces if v >= 1.75)
    return (f"緊鄰後一格：沿兩面背牆 {len(faces)} 個位置中，{full} 個整個人露出、最少露 {min(faces):.1f} 公尺；"
            f"斜後角露 {corner:.1f} 公尺。隔 {up} 格以上全部露出上半身。" if up else
            f"緊鄰後一格：最少露 {min(faces):.1f} 公尺；隔 5 格還擋住上半身。")


def occlusion_demo(kind, c, suffix, pp=1.5):
    """The building with three spearmen behind it: in the middle of the back-right face and at the back
    corner one cell behind, and one two cells behind the back-left face (the game's draw order)."""
    items = kind_items(kind, c, suffix, 20 * pp)
    fx, fy = footprint_of(kind)
    C = layouts.CELL
    hx, hy = fx * C / 2, fy * C / 2
    sol = town_art.SOLDIER[c]
    us = 20 * pp / 60
    for (x, y, f) in ((hx + C / 2, 0.0, 7), (hx + C / 2, hy + C / 2, 6), (-hx / 2, hy + 1.5 * C, 7)):
        items.append(scene.unit(sol, "red", facing=f, scale=us, x=x, y=y))
    return tile(items, pp, footprint=(fx, fy), grid_extra=2)


def b101_zoom(c, group, kinds, suffix):
    label = f"B1-01-建築放大-{CULT[c]}-{group}-mobile"
    M = 50
    panels = []
    for kind in kinds:
        big = tile(kind_items(kind, c, suffix, 60), 3.0, footprint=footprint_of(kind))
        one_b = tile(kind_items(kind, c, suffix, 20, "blue"), 1.0, pad=8)
        one_r = tile(kind_items(kind, c, suffix, 20, "red"), 1.0, pad=8)
        demo = occlusion_demo(kind, c, suffix)
        share = team_share(kind, c, suffix)
        fx, fy = footprint_of(kind)
        checks = [
            f"占地 {fx}×{fy} 格：底座對齊格子（黃框）。" if kind not in ("walls", "gate") else
            ("每段 1×1 格；轉角是一座角樓，四個方向都用同一張。" if kind == "walls" else "4×1 格，中間 2 格是通道。"),
            f"認得出：{LOOK[kind][0 if c == 'E' else 1]}。",
            (f"看得出是誰的：玩家色佔建築畫面的 {share:.0%}，在朝鏡頭的兩面。" if share is not None else "看得出是誰的：—"),
            "不擋人：" + probe_text(kind, c, suffix),
        ]
        panels.append((kind, big, one_b, one_r, demo, checks))
    W = 2600
    sub = ("每棟一格：左邊是手機像素（1 pt = 3 px）、黃框是占地；中間上是實際大小（1 pt = 1 px）的藍和紅；"
           "中間下是遮擋示範（1 pt = 1.5 px）：三名紅色士兵站在建築後面（右後牆外一格、斜後角一格、左後牆外兩格），"
           "照遊戲的前後順序合成。右邊是四項檢查。")
    top = header_height(sub, W - 2 * M)
    rows_h = []
    for kind, big, ob, orr, demo, checks in panels:
        rows_h.append(max(big.height, ob.height + demo.height + 40, 260) + 60)
    H = top + sum(rows_h) + 30
    art = Image.new("RGB", (W, H), BG)
    y = draw_header(art, label, sub, M)
    dr = ImageDraw.Draw(art)
    for (kind, big, ob, orr, demo, checks), rh in zip(panels, rows_h):
        dr.text((M, y), bname(kind, c), font=artboard.font(34), fill=INK)
        yy = y + 50
        art.paste(big.convert("RGB"), (M, yy))
        x2 = M + big.width + 30
        art.paste(ob.convert("RGB"), (x2, yy))
        art.paste(orr.convert("RGB"), (x2 + ob.width + 10, yy))
        art.paste(demo.convert("RGB"), (x2, yy + max(ob.height, orr.height) + 20))
        x3 = x2 + max(ob.width + orr.width + 10, demo.width) + 30
        ty = yy
        for t in checks:
            ty = wrap(dr, x3, ty, t, W - x3 - M, 22, INK) + 6
        y += rh
    art = art.crop((0, 0, W, y + 20))
    p = config.OUT / f"{label}.png"
    art.save(p)
    print("wrote", p.name, art.size)
    return p


def b101_sheet(c, suffix):
    """Every building of one culture: enlarged (1 pt = 1.5 px), then at actual size in blue and in red,
    with spearmen and farmers for scale."""
    label = f"B1-01-建築總表-{CULT[c]}-mobile"
    M = 50
    kinds = [k for _, ks in GROUPS for k in ks]
    big = []
    for kind in kinds:
        t = tile(kind_items(kind, c, suffix, 30), 1.5, footprint=footprint_of(kind), pad=14)
        big.append(caption(t, bname(kind, c)))
    small = {}
    for team in ("blue", "red"):
        row = []
        for kind in kinds:
            items = kind_items(kind, c, suffix, 20, team)
            fx, fy = footprint_of(kind)
            items.append(scene.unit(town_art.SOLDIER[c], team, scale=1 / 3, x=-fx - 0.8, y=-fy * 0.3))
            farmer = "farmer_e" if c == "E" else "farmer_w"
            items.append(scene.unit(farmer, team, scale=1 / 3, x=-fx * 0.2, y=-fy - 0.8))
            row.append(tile(items, 1.0, pad=8))
        small[team] = row
    sub = ("全部 15 種建築（城牆畫成一座小城，含轉角和兩個方向的城門）。上面是放大（1 pt = 1.5 px），黃框是占地；"
           "下面兩列是實際大小（1 pt = 1 px），藍和紅兩種玩家色，旁邊站一名士兵和一名農民當比例尺。")
    rows = []
    cur, w = [], 0
    for t in big:
        if w + t.width > 3000 and cur:
            rows.append(cur)
            cur, w = [], 0
        cur.append(t)
        w += t.width + 12
    rows.append(cur)
    W = M * 2 + max(sum(t.width + 12 for t in r) for r in rows + [small["blue"]])
    top = header_height(sub, W - 2 * M)
    H = top + sum(max(t.height for t in r) + 16 for r in rows) + 2 * (max(t.height for t in small["blue"]) + 50) + 60
    art = Image.new("RGB", (W, H), BG)
    y = draw_header(art, label, sub, M)
    for r in rows:
        x = M
        h = max(t.height for t in r)
        for t in r:
            art.paste(t.convert("RGB"), (x, y + h - t.height))
            x += t.width + 12
        y += h + 16
    dr = ImageDraw.Draw(art)
    for team, nm in (("blue", "實際大小・藍"), ("red", "實際大小・紅")):
        dr.text((M, y + 6), nm, font=artboard.font(24), fill=INK)
        y += 40
        x = M
        h = max(t.height for t in small[team])
        for t in small[team]:
            art.paste(t.convert("RGB"), (x, y + h - t.height))
            x += t.width + 8
        y += h + 10
    art = art.crop((0, 0, W, y + 20))
    p = config.OUT / f"{label}.png"
    art.save(p)
    print("wrote", p.name, art.size)
    return p


def b101(suffix):
    out = []
    for c in ("E", "W"):
        out.append(b101_sheet(c, suffix))
        for g, ks in GROUPS:
            out.append(b101_zoom(c, g, ks, suffix))
    return out


# ---------------------------------------------------------------- B1-04

def rpiece(name, suffix, ppm, x=0.0, y=0.0, team="blue"):
    sp = scene.piece(config.BUILD / "b1" / "b104", name, suffix, team=team, ppm=ppm, x=x, y=y)
    sp.ground = name.startswith("farm")
    return sp


def forest_items(c, suffix, ppm, cells_, seed=3):
    import random
    rnd = random.Random(seed)
    C = layouts.CELL
    return [rpiece(f"tree_{c}_v{rnd.randrange(3)}", suffix, ppm, x=i * C, y=j * C) for i, j in cells_]


def blob(r):
    return [(i, j) for i in range(-r, r + 1) for j in range(-r, r + 1) if i * i + j * j <= r * r + 1]


def cluster(kind, suffix, ppm, cells_, states_, x0=0.0, y0=0.0):
    C = layouts.CELL
    return [rpiece(f"{kind}_E_v{(i + j) % 2}_{st}", suffix, ppm, x=x0 + i * C, y=y0 + j * C)
            for (i, j), st in zip(cells_, states_)]


def warning_ring(pp):
    """The 晶砲 warning circle as client draws it (WARNING_TINT 0xff8a2a, 3 px stroke, light fill), 1.5 cells."""
    r = 1.5 * layouts.CELL * 20 * pp
    W, H = int(2 * r + 12), int(r + 12)
    im = Image.new("RGB", (W, H), GROUND)
    d = ImageDraw.Draw(im, "RGBA")
    box = [6, 6, W - 6, H - 6]
    d.ellipse(box, fill=(255, 138, 42, 50), outline=(255, 138, 42, 240), width=3)
    return im.convert("RGBA")


def b104(suffix):
    label = "B1-04-資源點總表-mobile"
    M = 50
    pp = 1.5
    ppm = 20 * pp
    C = layouts.CELL
    sections = []
    # trees
    for c in ("E", "W"):
        ims = [caption(tile(scene.with_fx(rpiece(f"tree_{c}_v{v}", suffix, 60)), 3.0, footprint=(1, 1)), n)
               for v, n in enumerate(("松", "曲松", "樟") if c == "E" else ("橡", "冷杉", "樺"))]
        ims.append(caption(tile([rpiece(f"tree_{c}_stump", suffix, 60)], 3.0, footprint=(1, 1)), "砍掉後"))
        sections.append((f"樹・{CULT[c]}（手機像素）", ims))
    # forests with the edge test
    ims = []
    for c in ("E", "W"):
        cells_ = blob(3)
        items = forest_items(c, suffix, ppm, cells_)
        sol = town_art.SOLDIER[c]
        for (x, y) in ((4 * C, 0.0), (3 * C, 3 * C), (0.0, 4.5 * C)):
            items.append(scene.unit(sol, "red", scale=pp * 20 / 60, x=x, y=y))
        ims.append(caption(tile(items, pp, pad=20), f"一片森林・{CULT[c]}：三名士兵站在森林後緣外一格、斜後角、兩格"))
        mt = ""
        try:
            import json
            m = json.loads((config.BUILD / "b1" / "b104" / f"forest_{c}_{suffix}.json").read_text())
            pr = m["probe"]
            b1 = pr["by_cells"]["1"]
            faces = [sp[2] for sp in b1["spots"] if sp[0] != "corner"]
            mt = f"量測（3×3 的樹）：緊鄰後一格最少露 {min(faces):.1f} 公尺、斜後角 {[sp[2] for sp in b1['spots'] if sp[0] == 'corner'][0]:.1f} 公尺；隔 {pr['upper_half_from_cells']} 格露出上半身。"
        except Exception:
            pass
        ims[-1].info["note"] = mt
    sections.append(("一片森林（1 pt = 1.5 px）", ims))
    # gold: 2 x 2 cells, full / some mined / all used up
    g = [(0, 0), (1, 0), (0, 1), (1, 1)]
    ims = [caption(tile(cluster("gold", suffix, ppm, g, ["full"] * 4), pp, footprint=(2, 2)), "金礦（2×2 格）"),
           caption(tile(cluster("gold", suffix, ppm, g, ["mined", "full", "depleted", "mined"]), pp, footprint=(2, 2)),
                   "採了一部分"),
           caption(tile(cluster("gold", suffix, ppm, g, ["depleted"] * 4), pp, footprint=(2, 2)), "採完（可以走）")]
    b = [(i, j) for i in range(3) for j in range(2)]
    ims += [caption(tile(cluster("berry", suffix, ppm, b, ["full"] * 6), pp, footprint=(3, 2)), "野果（3×2 格）"),
            caption(tile(cluster("berry", suffix, ppm, b, ["full", "depleted", "full", "depleted", "depleted", "full"]), pp,
                         footprint=(3, 2)), "採了一部分"),
            caption(tile(cluster("berry", suffix, ppm, b, ["depleted"] * 6), pp, footprint=(3, 2)), "採完（可以走）")]
    sections.append(("金礦、野果（1 pt = 1.5 px）", ims))
    # crystal vein next to the mage's shield and the 晶砲 warning circle
    v = [(0, 0), (1, 0), (0, 1), (1, 1)]
    ims = [caption(tile(cluster("crystal", suffix, ppm, v, ["full"] * 4), pp, footprint=(2, 2)), "晶脈（2×2 格）"),
           caption(tile(cluster("crystal", suffix, ppm, v, ["depleted"] * 4), pp, footprint=(2, 2)), "採完（可以走）")]
    shp = HERE.parents[1] / "production" / "build" / "val_shield" / "mage_e"
    try:
        sh = Image.open(shp / "proxy_on_00_x3_shield.png").convert("RGBA")
        sh = sh.resize((round(sh.width * pp / 3), round(sh.height * pp / 3)), Image.LANCZOS)
        t = Image.new("RGBA", (sh.width + 40, sh.height + 40), (*GROUND, 255))
        t.alpha_composite(sh, (20, 20))
        ims.append(caption(t, "法師的防護罩"))
    except FileNotFoundError:
        pass
    ims.append(caption(warning_ring(pp), "晶砲預警圈"))
    sections.append(("晶脈：和防護罩、晶砲預警圈並排（1 pt = 1.5 px）", ims))
    # crops
    for c in ("E", "W"):
        ims = []
        for st, n in (("sown", "剛種"), ("growing", "長高"), ("ripe", "成熟")):
            items = [rpiece(f"farm_{c}_{st}", suffix, ppm)]
            farmer = "farmer_e" if c == "E" else "farmer_w"
            items.append(scene.unit(farmer, "blue", scale=pp * 20 / 60, x=0.6, y=-0.4))
            ims.append(caption(tile(items, pp, footprint=(3, 3)), n))
        sections.append((f"農田作物・{CULT[c]}（站一名農民：作物不擋人）", ims))
    sub = ("資源點和模擬一樣是一格一塊：樹一格一棵；金礦 2×2、野果 3×2、晶脈 2×2，每一格各自採完，採完的那格就可以走，"
           "所以剩下的樣子都很低。樹照東西陸各三種，金礦、野果、晶脈兩邊共用。晶脈是飽和的魔晶青、長在深色岩石上的晶簇，"
           "和淡色半透明的防護罩、橘色的預警圈分得開。最下面是實際大小（1 pt = 1 px）。")
    # actual size: a few of everything
    items = forest_items("E", suffix, 20, blob(2)) + cluster("gold", suffix, 20, g, ["full"] * 4, x0=6 * C, y0=-2 * C) + \
        cluster("crystal", suffix, 20, v, ["full"] * 4, x0=-2 * C, y0=6 * C) + \
        cluster("berry", suffix, 20, b, ["full"] * 6, x0=6 * C, y0=4 * C)
    items.append(scene.unit("spear_e", "blue", scale=1 / 3, x=3.5 * C, y=0.5 * C))
    items.append(scene.unit("farmer_e", "blue", scale=1 / 3, x=5 * C, y=1.0 * C))
    act = tile(items, 1.0, pad=20)
    W = 2800
    top = header_height(sub, W - 2 * M)
    H = top + sum(max(i.height for i in ims) + 140 for _, ims in sections) + act.height + 400
    art = Image.new("RGB", (W, H), BG)
    y = draw_header(art, label, sub, M)
    dr = ImageDraw.Draw(art)
    for title, ims in sections:
        dr.text((M, y), title, font=artboard.font(28), fill=INK)
        y += 44
        x = M
        h = max(i.height for i in ims)
        for im in ims:
            if x + im.width > W - M:
                break
            art.paste(im.convert("RGB"), (x, y + h - im.height))
            note = im.info.get("note")
            if note:
                ny = wrap(dr, x, y + h + 4, note, im.width, 18, INK)
                h = max(h, ny - y)
            x += im.width + 16
        y += h + 36
    dr.text((M, y), "實際大小（1 pt = 1 px）：森林、金礦、晶脈、野果，一名士兵和一名農民", font=artboard.font(26), fill=INK)
    y += 40
    art.paste(act.convert("RGB"), (M, y))
    art = art.crop((0, 0, W, y + act.height + 30))
    p = config.OUT / f"{label}.png"
    art.save(p)
    print("wrote", p.name, art.size)
    return p


# ---------------------------------------------------------------- overview of the first batch (the choices)

def overview1(suffix):
    label = "B1-99-總覽對照-選擇題"
    M = 50
    W = 3000
    art = Image.new("RGB", (W, 6000), BG)
    dr = ImageDraw.Draw(art)
    dr.text((M, 36), label, font=artboard.font(54), fill=INK)
    sub = ("第一批：要使用者選的兩項。B1-02 建築的三種狀態（施工中、受損、被摧毀，各有 A、B 兩種畫法），"
           "B1-03 城鎮四種狀態怎麼一眼分得出來（A 旗與炊煙、B 界樁圍一圈，也可以兩個都要）。"
           "每一項另有一張完整的選項圖。這裡是主城和民居（東陸藍、西陸紅），放大 1 pt = 1.5 px；城鎮是實際大小。")
    y = wrap(dr, M, 120, sub, W - 2 * M, 24) + 20
    for item, opts in B102.items():
        dr.text((M, y), f"B1-02 {ITEM[item]}", font=artboard.font(34), fill=INK)
        y += 52
        x = M
        hh = 0
        for opt, name, sts, labs, _ in opts:
            row = []
            for c in ("E", "W"):
                for kind in ("main_city", "house"):
                    st = sts[-1] if item != "build" else sts[1]
                    sp = _state_piece(kind, c, st, suffix, 30)
                    row.append(tile(scene.with_fx(sp), 1.5, footprint=tuple(sp.meta["footprint"]), pad=12))
            w = sum(r.width for r in row) + 8 * (len(row) - 1)
            h = max(r.height for r in row)
            dr.text((x, y), f"{opt} {name}", font=artboard.font(26), fill=INK)
            xx = x
            for r in row:
                art.paste(r.convert("RGB"), (xx, y + 36 + h - r.height))
                xx += r.width + 8
            x += w + 60
            hh = max(hh, h + 36)
        y += hh + 40
    dr.text((M, y), "B1-03 城鎮（小鎮・東陸，實際大小）", font=artboard.font(34), fill=INK)
    y += 52
    L = layouts.small()
    for opt, name, direction, _ in B103:
        dr.text((M, y), f"{opt} {name}", font=artboard.font(26), fill=INK)
        x = M + 220
        h = 0
        for st in ("neutral", "ours", "enemy", "ruins", "plunder", "repair"):
            img, _ = town_art.town("E", L, st, direction, suffix)
            f = (1 / 3) if suffix == "x3" else (2 / 3)
            img = img.resize((round(img.width * f), round(img.height * f)), Image.LANCZOS)
            img = caption(img, town_art.NAMES[st], 16)
            art.paste(img.convert("RGB"), (x, y))
            x += img.width + 10
            h = max(h, img.height)
        y += h + 30
    art = art.crop((0, 0, W, y + 20))
    p = config.OUT / f"{label}.png"
    art.save(p)
    print("wrote", p.name, art.size)
    return p


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("what", nargs="*", default=["b102", "b103"])
    ap.add_argument("--suffix", default="x3")
    a = ap.parse_args()
    config.OUT.mkdir(parents=True, exist_ok=True)
    if "b102" in a.what:
        b102(a.suffix)
    if "b103" in a.what:
        b103(a.suffix)
    if "b101" in a.what:
        b101(a.suffix)
    if "b104" in a.what:
        b104(a.suffix)
    if "overview1" in a.what:
        overview1(a.suffix)
