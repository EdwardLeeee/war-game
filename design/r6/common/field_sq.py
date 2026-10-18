"""R6-04 (the user, 2026-10-18: 「改正方形地圖吧 我想改方案」): the representative battlefield on a square map, two ways.

甲 方形斜看 (mode "sq"): the camera 30 degrees up as now, but square to the grid: the map's edges run along the screen,
   a 2 m cell is 40 pt across and 20 pt deep. Units: the approved renders (8 facings, one step round). Buildings and
   resource points: re-rendered with this camera (design/b1/common/run.py dir_sq).
乙 正上方俯視 (mode "top"): the ground seen straight down, square cells 40 x 40 pt (the prototype's ground); the units as
   they are (the client's art-v1-x2-battle screenshot); buildings and resource points re-rendered 60 degrees up (run.py
   dir_top), so their footprint is 0.87 as deep as wide, close to the square cell.

render(mode, art, dirs) -> (RGBA screen at 3 px a pt, overlay with the selected units' points)
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parents[1] / "b1" / "common"))
import field      # noqa: E402

CELL_W = 40.0                                   # pt: a 2 m cell across, at zoom 1 (20 pt a metre)
CELL_D = {"sq": 20.0, "top": 40.0}             # pt: a cell's depth on the screen
CENTRE = (24.0, 70.0)


def to_pt(mode, x, y, centre=CENTRE):
    return field.SCREEN[0] / 2 + (x - centre[0]) * CELL_W, field.SCREEN[1] / 2 + (y - centre[1]) * CELL_D[mode]


def to_cell(mode, px, py, centre=CENTRE):
    return centre[0] + (px - field.SCREEN[0] / 2) / CELL_W, centre[1] + (py - field.SCREEN[1] / 2) / CELL_D[mode]


def scene(mode):
    """The R6-01 composition (selected squad, main city, barracks, houses, trees, gold mine, the enemy squad, farmers),
    laid out by screen position for this map."""
    c = lambda px, py: to_cell(mode, px, py)
    def foot(px, py, n):
        x, y = c(px, py)
        return round(x - n / 2), round(y - n / 2)
    b = [("main_city", 4, foot(170, 150, 4)), ("house", 2, foot(300, 92, 2)), ("house", 2, foot(84, 252, 2)), ("barracks", 3, foot(318, 182, 3))]
    nodes = [(f"tree_E_v{i % 3}", *c(px, py)) for i, (px, py) in enumerate(((560, 52), (604, 72), (648, 48), (676, 92), (612, 112), (700, 58),
                                                                             (556, 98), (652, 136), (520, 66)))]
    nodes.append(("gold_v0_full", *c(630, 196)))
    units = []
    sx, sy = c(500, 165)
    d = CELL_D[mode] / CELL_W
    for i in range(10):
        col, row = i % 5, i // 5
        x, y = sx + (col - 2) * 1.0, sy + (row - 0.5) * 1.0
        units.append(("spear_e" if i < 6 else "xbow_e", "blue", x, y, 7, "idle", (i * 3) % 8, True))
    ex, ey = c(670, 262)
    for i in range(8):
        col, row = i % 4, i // 4
        units.append(("pike_w" if i < 4 else "bow_w", "red", ex + (col - 1.5), ey + (row - 0.5), 3, "walk", (i * 2) % 8, False))
    for i, (px, py) in enumerate(((150, 238), (220, 246), (120, 196))):
        units.append(("farmer_e", "blue", *c(px, py), (6, 7, 0)[i], "idle", i * 2, False))
    return dict(buildings=b, nodes=nodes, units=units)


def _piece(src, name, team):
    """A B1 render (beauty, mask, shadow, ao) with the player colour as the client draws it: (colour, ax, ay, shadow)."""
    import atlas_b1
    atlas_b1.SRC = Path(src)
    col, tm, sh, (ax, ay), (sax, say) = atlas_b1.layers(name)
    arr = np.asarray(tm, np.float32).copy()
    arr[..., :3] *= np.array(field.TEAM[team], np.float32) / 255.0
    col = col.copy()
    col.alpha_composite(Image.fromarray(arr.astype(np.uint8), "RGBA"))
    a = sh.getchannel("A")
    shadow = Image.merge("RGBA", (Image.new("L", a.size, 0),) * 3 + (a,)).resize((sh.width * 2, sh.height * 2), Image.BILINEAR)
    return col, ax, ay, (shadow, sax * 2, say * 2)


def grid(img, mode, scale):
    """Faint cell lines, so the shape of the cells shows (the boards only; the game has no grid)."""
    dr = ImageDraw.Draw(img)
    W, H = img.size
    x0, y0 = to_cell(mode, 0, 0)
    x1, y1 = to_cell(mode, *field.SCREEN)
    for gx in range(int(x0) - 1, int(x1) + 2):
        px = to_pt(mode, gx, 0)[0] * scale
        dr.line([(px, 0), (px, H)], fill=(40, 50, 30, 26), width=2)
    for gy in range(int(y0) - 1, int(y1) + 2):
        py = to_pt(mode, 0, gy)[1] * scale
        dr.line([(0, py), (W, py)], fill=(40, 50, 30, 26), width=2)


def render(mode, art, dirs, scale=3, ring=((240, 207, 138, 235), 1.4)):
    art = Path(art)
    W, H = field.SCREEN[0] * scale, field.SCREEN[1] * scale
    img = field.ground(W, H)
    grid(img, mode, scale)
    sc = scene(mode)
    tag = "dir_sq" if mode == "sq" else "dir_top"
    items, shadows = [], []
    at = lambda x, y: tuple(v * scale for v in to_pt(mode, x, y))
    for kind, n, (x, y) in sc["buildings"]:
        col, ax, ay, sh = _piece(dirs, f"{kind}_E_{tag}", "blue")
        gx, gy = at(x + n / 2, y + n / 2)
        items.append((gy, col, ax, ay, gx, gy))
        shadows.append((*sh, gx, gy))
    for fr, x, y in sc["nodes"]:
        col, ax, ay, sh = _piece(dirs, f"{fr}_{tag}", "neutral")
        gx, gy = at(x, y)
        items.append((gy, col, ax, ay, gx, gy))
        shadows.append((*sh, gx, gy))
    uatl, overlay = {}, {"selected": []}
    for unit, team, x, y, facing, anim, frame, sel in sc["units"]:
        a = uatl.setdefault(unit, field.Atlas(art / "units" / unit / f"{unit}.json"))
        mirrored = a.m["facings"]["mirrored"]
        name = f"{unit}_{anim}_f{mirrored.get(str(facing), facing)}_{frame:02d}"
        body, ax, ay = a.body(name, team)
        if str(facing) in mirrored:
            body = body.transpose(Image.FLIP_LEFT_RIGHT)
            ax = body.width - ax
        gx, gy = at(x, y)
        items.append((gy, body, ax, ay, gx, gy))
        s = a.shadow(f"{unit}_{anim}_f{facing}_{frame:02d}")
        if s:
            shadows.append((*s, gx, gy))
        if sel:
            overlay["selected"].append(dict(x=gx / scale, y=gy / scale, top=(gy - ay) / scale))
    sh_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    for im, ax, ay, gx, gy in shadows:
        sh_layer.alpha_composite(im, (int(round(gx - ax)), int(round(gy - ay))))
    img.alpha_composite(sh_layer.filter(ImageFilter.GaussianBlur(1.2)))
    k = 4
    rl = Image.new("RGBA", (W * k // 2, H * k // 2), (0, 0, 0, 0))
    dr = ImageDraw.Draw(rl)
    rx = 0.62 * 20 * scale * k / 2
    ry = rx * CELL_D[mode] / CELL_W
    for u in overlay["selected"]:
        cx, cy = u["x"] * scale * k / 2, u["y"] * scale * k / 2
        dr.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], outline=ring[0], width=int(ring[1] * scale * k / 2))
    img.alpha_composite(rl.resize(img.size, Image.LANCZOS))
    for _, im, ax, ay, gx, gy in sorted(items, key=lambda t: t[0]):
        img.alpha_composite(im, (int(round(gx - ax)), int(round(gy - ay))))
    return img, overlay


def minimap_square(size_px, mode, sc_units, k=4):
    """The square minimap of this map, with the camera's view: a rectangle (the screen squares to the grid)."""
    import minimap
    img, vis = minimap.world()
    N = minimap.N
    S = size_px * k
    cells = Image.fromarray((img * vis[..., None]).clip(0, 255).astype(np.uint8), "RGB").resize((S, S), Image.NEAREST).convert("RGBA")
    dr = ImageDraw.Draw(cells)
    to_px = lambda x, y: (x / N * S, y / N * S)
    s = 1.2 * k * size_px / 312
    for unit, team, x, y, *_ in sc_units:
        px, py = to_px(x, y)
        dr.ellipse([px - s, py - s, px + s, py + s], fill=minimap.OWN_UNIT if team == "blue" else minimap.ENEMY_UNIT)
    x0, y0 = to_cell(mode, 0, 0)
    x1, y1 = to_cell(mode, *field.SCREEN)
    dr.rectangle([*to_px(x0, y0), *to_px(x1, y1)], outline=(255, 255, 255, 235), width=int(2.2 * k * size_px / 312))
    return cells.resize((size_px, size_px), Image.LANCZOS)
