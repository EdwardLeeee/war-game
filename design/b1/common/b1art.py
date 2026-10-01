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
        if s.shadow:
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


def _state_piece(kind, c, state, suffix, scale):
    if state == "done":
        return scene.piece(config.BUILD / "b1" / "core3", f"{kind}_{c}", suffix, scale=scale)
    return scene.piece(config.BUILD / "b1" / "states", f"{kind}_{c}_{state}", suffix, scale=scale)


def b102_board(item, opt, name, states_, labels, sub, suffix):
    label = f"B1-02-{ITEM[item]}-{opt}-{name}-mobile"
    pp = 1.5                                   # px per pt for the big panels (phone pixels are 3)
    scale = 20 * pp / SRC_PPM[suffix]
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
    s1 = 20 / SRC_PPM[suffix]
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
