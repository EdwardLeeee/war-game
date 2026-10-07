"""Render the D-074 sample maps (maps.json from sim/src/map-samples.ts) as PNGs.

    python3 render.py maps.json <out dir>

8 px per cell, the label top-left, a Chinese legend and one line of distances underneath.
"""

import heapq
import json
import math
import sys

from PIL import Image, ImageDraw, ImageFont

PX = 8
DIAG = math.sqrt(2)
HALF_DIAG = math.sqrt(0.5)
FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"
TC = 3  # Noto Sans CJK TC inside the collection

COL = {
    ".": (226, 214, 172),
    "#": (112, 108, 104),
    "T": (46, 108, 52),
    "G": (240, 184, 0),
    "B": (204, 44, 110),
    "C": (120, 72, 220),
}
BLUE = (30, 90, 220)
RED = (210, 40, 40)
SMALL = (255, 120, 0)
LARGE = (150, 0, 40)
TOWER = (60, 30, 10)
BG = (250, 248, 242)
INK = (30, 30, 30)

LEGEND = [
    ("swatch", COL["."], "空地"),
    ("swatch", COL["#"], "岩石（不能走）"),
    ("swatch", COL["T"], "森林（木材）"),
    ("swatch", COL["G"], "金礦"),
    ("swatch", COL["B"], "野果（糧食）"),
    ("swatch", COL["C"], "晶脈（晶石）"),
    ("swatch", BLUE, "藍方主城（玩家 0）"),
    ("swatch", RED, "紅方主城（玩家 1）"),
    ("ring", SMALL, "小鎮（圈＝搶城範圍）"),
    ("ring", LARGE, "大城（圈＝搶城範圍）"),
    ("swatch", TOWER, "大城箭樓"),
    ("dash", INK, "對稱軸（雙方對著它鏡射）"),
]


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size, index=TC)


def passable(grid, x, y):
    return 0 <= y < len(grid) and 0 <= x < len(grid) and grid[y][x] == "."


def walk(grid, starts, goals, start_cost=0.0, goal_cost=0.0):
    """Shortest 8-way walk in cells (no corner cutting), from any start to any goal.

    start_cost / goal_cost: from the exact start or goal point to the centre of those cells
    (a main city's centre is a cell corner, half a diagonal from its four inner cells)."""
    n = len(grid)
    goals = set(goals)
    dist = {}
    heap = [(start_cost, s) for s in starts]
    for _, s in heap:
        dist[s] = start_cost
    heapq.heapify(heap)
    while heap:
        d, (x, y) = heapq.heappop(heap)
        if (x, y) in goals:
            return d + goal_cost
        if d > dist.get((x, y), 1e18):
            continue
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                nx, ny = x + dx, y + dy
                if not (0 <= nx < n and 0 <= ny < n) or not passable(grid, nx, ny):
                    continue
                if dx and dy and not (passable(grid, x + dx, y) and passable(grid, x, y + dy)):
                    continue
                nd = d + (DIAG if dx and dy else 1.0)
                if nd < dist.get((nx, ny), 1e18):
                    dist[(nx, ny)] = nd
                    heapq.heappush(heap, (nd, (nx, ny)))
    return None


def city_cells(s):
    return [(s["cellX"] + dx, s["cellY"] + dy) for dx in (-1, 0) for dy in (-1, 0)]


def numbers(m):
    n = m["size"]
    grid = m["grid"]
    sp = m["spawns"]
    centre = [(s["cellX"], s["cellY"]) for s in sp]
    towns = m["towns"]
    tc = lambda t: (t["cellX"] + 0.5, t["cellY"] + 0.5)
    eu = lambda p, q: math.hypot(p[0] - q[0], p[1] - q[1])
    large = [t for t in towns if t["size"] == 1][0]
    smalls = [t for t in towns if t["size"] == 0]
    near = [min(smalls, key=lambda t: eu(c, tc(t))) for c in centre]
    shared = near[0] is near[1]

    def pair(targets):
        e_exact = [eu(centre[p], tc(targets[p])) for p in (0, 1)]
        e = [round(x) for x in e_exact]
        w = [walk(grid, city_cells(sp[p]), [(targets[p]["cellX"], targets[p]["cellY"])], HALF_DIAG) for p in (0, 1)]
        for p in (0, 1):
            assert w[p] is None or w[p] >= e_exact[p] - 1e-9, (w[p], e_exact[p])
        w = [round(x) if x is not None else "走不到" for x in w]
        if e[0] == e[1] and w[0] == w[1]:
            return f"雙方各 {e[0]} 格（走路 {w[0]}）"
        return f"藍 {e[0]}（走 {w[0]}）／紅 {e[1]}（走 {w[1]}）"

    main = round(eu(centre[0], centre[1]))
    main_walk = walk(grid, city_cells(sp[0]), city_cells(sp[1]), HALF_DIAG, HALF_DIAG)
    assert main_walk >= eu(centre[0], centre[1]) - 1e-9
    layout = {"diagonal": "對角出生", "adjacent": "相鄰出生"}[m["layout"]]
    home = "到最近小鎮（軸上共用）" if shared else "到家旁小鎮"
    return (
        f"{n}×{n}・{layout}｜主城相距 {main} 格（走路 {round(main_walk)}）｜"
        f"{home} {pair(near)}｜到大城 {pair([large, large])}｜城鎮 {len(towns)} 座"
    )


def axis_line(m):
    n = m["size"]
    a, b, c, d = m["mirror"]["m"]
    if (a, b, c, d) == (0, 1, 1, 0):
        return (0, 0), (n, n)
    if (a, b, c, d) == (0, -1, -1, 0):
        return (0, n), (n, 0)
    if (a, b, c, d) == (-1, 0, 0, 1):
        return (n / 2, 0), (n / 2, n)
    return (0, n / 2), (n, n / 2)


def dashed(draw, p, q, color, width, dash=14, gap=10):
    length = math.hypot(q[0] - p[0], q[1] - p[1])
    ux, uy = (q[0] - p[0]) / length, (q[1] - p[1]) / length
    t = 0
    while t < length:
        e = min(t + dash, length)
        draw.line([(p[0] + ux * t, p[1] + uy * t), (p[0] + ux * e, p[1] + uy * e)], fill=color, width=width)
        t = e + gap


def draw_map(m):
    n = m["size"]
    img = Image.new("RGB", (n * PX, n * PX), COL["."])
    d = ImageDraw.Draw(img, "RGBA")
    for y, row in enumerate(m["grid"]):
        for x, ch in enumerate(row):
            if ch != ".":
                d.rectangle([x * PX, y * PX, x * PX + PX - 1, y * PX + PX - 1], fill=COL[ch])
    p, q = axis_line(m)
    dashed(d, (p[0] * PX, p[1] * PX), (q[0] * PX, q[1] * PX), (255, 255, 255, 230), 5)
    dashed(d, (p[0] * PX, p[1] * PX), (q[0] * PX, q[1] * PX), (20, 20, 20, 230), 2)
    # The crystal vein sits on the axis: draw it again on top, outlined.
    for y, row in enumerate(m["grid"]):
        for x, ch in enumerate(row):
            if ch == "C":
                d.rectangle([x * PX - 1, y * PX - 1, x * PX + PX, y * PX + PX], fill=COL["C"], outline=(255, 255, 255), width=1)
    for t in m["towns"]:
        cx, cy = (t["cellX"] + 0.5) * PX, (t["cellY"] + 0.5) * PX
        r = (t["radius"] + 0.5) * PX
        color = LARGE if t["size"] == 1 else SMALL
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color + (50,), outline=color, width=4 if t["size"] == 1 else 3)
        d.ellipse([cx - 5, cy - 5, cx + 5, cy + 5], fill=color, outline=(255, 255, 255), width=2)
    tw = m["tower"]
    d.rectangle([tw["cellX"] * PX, tw["cellY"] * PX, (tw["cellX"] + 2) * PX - 1, (tw["cellY"] + 2) * PX - 1], fill=TOWER, outline=(255, 255, 255), width=1)
    f = font(18, True)
    for s, color, name in ((m["spawns"][0], BLUE, "藍"), (m["spawns"][1], RED, "紅")):
        x0, y0 = (s["cellX"] - 2) * PX, (s["cellY"] - 2) * PX
        d.rectangle([x0, y0, x0 + 4 * PX - 1, y0 + 4 * PX - 1], fill=color, outline=(255, 255, 255), width=2)
        tx = x0 + 4 * PX + 4 if s["cellX"] < n / 2 else x0 - 24
        ty = y0 + 4 * PX + 2 if s["cellY"] < n / 2 else y0 - 26
        d.text((tx, ty), name, font=f, fill=color, stroke_width=3, stroke_fill=(255, 255, 255))
    return img


def legend_rows(width, f):
    rows, row, x = [], [], 12
    for item in LEGEND:
        w = 28 + f.getlength(item[2]) + 22
        if x + w > width - 12 and row:
            rows.append(row)
            row, x = [], 12
        row.append((x, item))
        x += w
    rows.append(row)
    return rows


def render(m, label, path):
    n = m["size"]
    W = n * PX
    head = 46
    f_label = font(22, True)
    f_leg = font(17)
    rows = legend_rows(W, f_leg)
    line = numbers(m)
    size = 18
    while font(size).getlength(line) > W - 24 and size > 11:
        size -= 1
    f_num = font(size, True)
    H = head + W + 14 + len(rows) * 30 + 10 + size + 22
    img = Image.new("RGB", (W, H), BG)
    img.paste(draw_map(m), (0, head))
    d = ImageDraw.Draw(img)
    d.text((12, 9), label, font=f_label, fill=INK)
    y = head + W + 14
    for row in rows:
        for x, (kind, color, text) in row:
            if kind == "swatch":
                d.rectangle([x, y + 3, x + 20, y + 21], fill=color, outline=(90, 90, 90))
            elif kind == "ring":
                d.ellipse([x, y + 2, x + 21, y + 23], fill=tuple(int(c * 0.2 + 255 * 0.8) for c in color), outline=color, width=3)
            else:
                dashed(d, (x, y + 12), (x + 22, y + 12), color, 2, dash=6, gap=4)
            d.text((x + 28, y), text, font=f_leg, fill=INK)
        y += 30
    y += 10
    d.text((12, y), line, font=f_num, fill=INK)
    img.save(path, optimize=True)
    return img, line


def main():
    maps = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    names = []
    letters = "ABCDEFG"
    for i, m in enumerate(maps):
        if m["kind"] == "fixed":
            option = "固定地圖對照"
        else:
            option = f"種子{m['seed']}-{'對角' if m['layout'] == 'diagonal' else '相鄰'}"
        label = f"R9-01-隨機地圖-{letters[i]}-{option}-map"
        img, line = render(m, label, f"{out}/{label}.png")
        names.append((label, img))
        print(f"{label}.png  {img.size[0]}x{img.size[1]}  {line}")
    # Overview: every map side by side, scaled down.
    tw = 420
    thumbs = []
    for label, img in names:
        h = round(img.size[1] * tw / img.size[0])
        thumbs.append((label, img.resize((tw, h), Image.LANCZOS)))
    cols = 4
    th = max(t.size[1] for _, t in thumbs)
    W = cols * (tw + 16) + 16
    rows = (len(thumbs) + cols - 1) // cols
    H = 60 + rows * (th + 40)
    sheet = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(sheet)
    d.text((16, 14), "R9-01-隨機地圖-總覽-map（A–C 對角出生、D–F 相鄰出生、G 現在的固定地圖）", font=font(24, True), fill=INK)
    for i, (label, t) in enumerate(thumbs):
        x = 16 + (i % cols) * (tw + 16)
        y = 60 + (i // cols) * (th + 40)
        d.text((x, y), label.replace("R9-01-隨機地圖-", ""), font=font(17, True), fill=INK)
        sheet.paste(t, (x, y + 28))
    sheet.save(f"{out}/R9-01-隨機地圖-總覽-map.png", optimize=True)
    print(f"R9-01-隨機地圖-總覽-map.png  {W}x{H}")


if __name__ == "__main__":
    main()
