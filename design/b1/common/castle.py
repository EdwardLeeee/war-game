"""R6-06 城堡 (the user 2026-10-19: 「希望像一個城堡」; ceo: walls block walking, only the gates are open, the gates
always open to everyone; the small town a palisade, the big city stone walls with gate towers and corner towers; the
town's area becomes 「牆以內」; the walls never break and do not stop shots): which cells the walls, the gates and
the towers take, for war-game-core to put into the sim (the numbers are the ones core and ui agree on).

Cells are sim cells, as offsets from the town (sim/src/core/map.ts):
  small town: (dx, dy) from the town's centre cell (the town's middle is that cell's middle);
  big city:   (dx, dy) from the town's centre cell too, the tower on dx, dy in {-1, 0} (map.ts tower = centre - 1),
              so the layout is symmetric about the cell corner (0, 0) and a cell's middle is (dx + 0.5, dy + 0.5).
+x is east (screen right), +y south (toward the camera).

Kinds: wall (blocks), gate (walkable, always open), corner (wall cell at a corner: blocks), ctower (big city corner
tower, 2 x 2: blocks), tower (the TownTower, 2 x 2: blocks while it stands), square, street, garden (walkable).
The walls stand where the enclosed area is about the old circle's: the small town 9 x 9 = 81 cells inside (the
circle of radius 5 holds 81 cell middles), the big city 12 x 12 = 144 (the circle of radius 7 holds 156).

python3 common/castle.py      -> ../r6/out/R6-06-城堡-格子-小鎮.png, …-大城.png, ../castle-layout.json
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "round1" / "common"))

BLOCKS = {"wall", "corner", "ctower", "keep"}


# D-100 (the user 2026-10-23: the towns about 1.5 times bigger, a keep that shoots in every town; war-game-core's grid
# 2026-10-23, core-scratch/d100-grid): both layouts odd and centred on the town's centre cell, the 3 x 3 keep (主堡) on
# max(|dx|, |dy|) <= 1 (the big city's tower is its keep now), the gates 3 wide in the middle of each side facing it.
# The D-089/D-096 layouts (9 x 9 and 12 x 12 inside, the 2 x 2 tower, large3) are in git history and art-v5.2.

def small():
    """The small town: the palisade on max(|dx|, |dy|) == 7 (13 x 13 = 169 cells inside), 1-cell corner posts, the
    square one ring round the keep, streets 3 wide."""
    W = 7
    cells = {}
    for dx in range(-W, W + 1):
        for dy in range(-W, W + 1):
            m = max(abs(dx), abs(dy))
            if m == W:
                if abs(dx) == W and abs(dy) == W:
                    k = "corner"
                elif (abs(dy) == W and abs(dx) <= 1) or (abs(dx) == W and abs(dy) <= 1):
                    k = "gate"
                else:
                    k = "wall"
            elif m <= 1:
                k = "keep"
            elif m <= 2:
                k = "square"
            elif abs(dx) <= 1 or abs(dy) <= 1:
                k = "street"
            else:
                k = "garden"
            cells[(dx, dy)] = k
    militia = [(2, 0), (0, 2), (-2, 0), (0, -2), (2, 2), (-2, -2)]
    return dict(name="small", wall=W, cells=cells, militia=militia, garrison=[], flag=None, mid=lambda dx, dy: (dx, dy))


def large():
    """The big city: stone walls on max(|dx|, |dy|) == 9 (17 x 17 inside, 285 cells without the corner towers' inner
    cells), 2 x 2 corner towers, a pier on each side of every gate (the gate piece 5 cells), the square two rings round
    the keep, avenues 5 wide."""
    W = 9
    cells = {}
    for dx in range(-W, W + 1):
        for dy in range(-W, W + 1):
            m = max(abs(dx), abs(dy))
            if m == W:
                if abs(dx) >= W - 1 and abs(dy) >= W - 1:
                    k = "ctower"
                elif (abs(dy) == W and abs(dx) <= 1) or (abs(dx) == W and abs(dy) <= 1):
                    k = "gate"
                else:
                    k = "wall"                    # |d| == 2 beside a gate: the gate towers' piers
            elif abs(dx) == W - 1 and abs(dy) == W - 1:
                k = "ctower"
            elif m <= 1:
                k = "keep"
            elif m <= 3:
                k = "square"
            elif abs(dx) <= 2 or abs(dy) <= 2:
                k = "street"
            else:
                k = "garden"
            cells[(dx, dy)] = k
    militia = [(2, 0), (0, 2), (-2, 0), (0, -2), (2, 2), (-2, -2), (2, -2), (-2, 2), (3, 0), (0, 3), (-3, 0), (0, -3)]
    return dict(name="large", wall=W, cells=cells, militia=militia, garrison=[], flag=None, mid=lambda dx, dy: (dx, dy))


LAYOUTS = (small, large)


def counts(L):
    """(cells of each kind, cells inside the wall ring: the town's area from now on)."""
    from collections import Counter
    inner = L["wall"] - 1
    inside = sum(1 for (dx, dy), k in L["cells"].items() if max(abs(dx), abs(dy)) <= inner and k != "ctower")
    return dict(Counter(L["cells"].values())), inside


def ground_plan(L):
    """[(x, y, kind)] in metres from the layout's middle, for towns.tground: the square, the streets (the gates too) and
    the gardens inside the walls; the keep's cells paved (seen once it is ruined)."""
    from layouts import CELL
    off = 0.0
    out = []
    R = L["wall"]
    for (dx, dy), k in L["cells"].items():
        k = {"gate": "street", "keep": "square"}.get(k, k)
        if k in ("square", "street", "garden"):
            out.append(((dx + off) * CELL, -(dy + off) * CELL, k))    # the render's +y is the sim's north
        if L["cells"][(dx, dy)] == "gate":
            # the road goes on 2 cells out of every gate: seen from the camera, the east and west walls are edge-on
            # and their gaps hidden, so the road says where the gate is
            a, b = dx + off, dy + off
            nx, ny = (0, 1 if b > 0 else -1) if abs(b) == R else (1 if a > 0 else -1, 0)
            for k2 in (1, 2):
                out.append(((a + nx * k2) * CELL, -(b + ny * k2) * CELL, "street"))
    return out


# ---------------------------------------------------------------- the pieces on their cells (art-v4, castle_<c>.json)

PIECE_FOOT = {"pal_corner": (1, 1), "pal_gate_x": (3, 1), "pal_gate_y": (1, 3), "sw_ctower": (2, 2),
              "sw_gate_x": (4, 1), "sw_gate_y": (1, 4), "sw_gate_x3": (5, 1), "sw_gate_y3": (1, 5)}
# D-096 (units on the walls; the user 2026-10-22: 「上城牆不是這樣畫圖參考一下現實」): one plain-wall piece per side,
# since the walk is on the town side (art-v4 had pal_x, pal_y, sw_x, sw_y for both sides of an axis)
SIDES = ("n", "s", "w", "e")
PIECE_FOOT.update({f"{w}_{d}": (1, 1) for w in ("pal", "sw") for d in SIDES})
GATE_PIECES = ("pal_gate_x", "pal_gate_y", "sw_gate_x", "sw_gate_y", "sw_gate_x3", "sw_gate_y3")
GATE_STATES = ("closed", "damaged", "broken")      # blender/gates.py; "intact" is the open gate
FRONTS = ("pal_s", "sw_n", "sw_s", "pal_corner", "sw_ctower", "sw_gate_x", "sw_gate_y", "sw_gate_x3", "sw_gate_y3")
# ^ the pieces whose front layer (castle.front_only) may hold something; an empty one is left out when packing
INWARD = {"n": (0, 1), "s": (0, -1), "w": (1, 0), "e": (-1, 0)}   # toward the town, in the sim's cells (+y south)


def placements(L):
    """Every wall piece of layout L on its cells: [dict(piece, cells, anchor, front, footprint)]. Cells are (dx, dy)
    offsets from the town's centre cell (cell (dx, dy) covers x in [townX + dx, townX + dx + 1)); the anchor is the
    footprint's middle on the ground in the same offsets (sim cells: add townX, townY); front is the footprint's
    front edge y (the draw order, design/b1/atlas-buildings.md 6). One piece for a gate and its piers, one for a corner
    tower's 2 x 2 cells, one per cell of plain wall (D-096: <pal|sw>_<n|s|w|e>, by the side it is on)."""
    cells = L["cells"]
    lo = min(dy for _, dy in cells)
    hi = max(dy for _, dy in cells)
    stone = L["name"] != "small"
    taken, out = set(), []

    def add(piece, cs):
        xs = [x for x, _ in cs]
        ys = [y for _, y in cs]
        w, h = max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
        assert (w, h) == PIECE_FOOT[piece], (piece, w, h)
        ax, ay = min(xs) + w / 2, min(ys) + h / 2
        out.append(dict(piece=piece, cells=sorted([list(c) for c in cs]), anchor=[ax, ay], front=min(ys) + h, footprint=[w, h]))
        taken.update(cs)

    lox = min(dx for dx, _ in cells)
    hix = max(dx for dx, _ in cells)

    def side(c):
        dx, dy = c
        return "n" if dy == lo else "s" if dy == hi else "w" if dx == lox else "e"
    # the gates, with their piers on the stone walls
    gates = [c for c, k in cells.items() if k == "gate"]
    for edge in ("n", "s", "w", "e"):
        g = [c for c in gates if {"n": c[1] == lo, "s": c[1] == hi, "w": c[0] == lo, "e": c[0] == hi}[edge]]
        if not g:
            continue
        axis = "x" if edge in ("n", "s") else "y"
        if stone:
            if axis == "x":
                xs = [x for x, _ in g]
                g = g + [(min(xs) - 1, g[0][1]), (max(xs) + 1, g[0][1])]
            else:
                ys = [y for _, y in g]
                g = g + [(g[0][0], min(ys) - 1), (g[0][0], max(ys) + 1)]
            piece = f"sw_gate_{axis}" + ("3" if len(g) == 5 else "")
        else:
            piece = f"pal_gate_{axis}"
        add(piece, g)
    # the corner towers (2 x 2) and the palisade's corner posts
    for (dx, dy), k in sorted(cells.items()):
        if k == "ctower" and (dx, dy) not in taken and dx in (lo, hi) and dy in (lo, hi):
            sx = 1 if dx == lo else -1
            sy = 1 if dy == lo else -1
            add("sw_ctower", [(dx, dy), (dx + sx, dy), (dx, dy + sy), (dx + sx, dy + sy)])
        elif k == "corner":
            add("pal_corner", [(dx, dy)])
    for (dx, dy), k in sorted(cells.items()):
        if k == "wall" and (dx, dy) not in taken:
            add(("sw_" if stone else "pal_") + side((dx, dy)), [(dx, dy)])
    left = [c for c, k in cells.items() if k in ("wall", "gate", "corner", "ctower") and c not in taken]
    assert not left, left
    return sorted(out, key=lambda p: (p["front"], p["anchor"][0]))


def floor(L):
    """The floor tiles inside the walls and the road out of every gate: [dict(cell, tile)], tile square / street /
    garden; the keep's cells paved (seen once it is ruined); 2 cells of street out of each gate cell."""
    cells = L["cells"]
    lo = min(dy for _, dy in cells)
    hi = max(dy for _, dy in cells)
    out = []
    for (dx, dy), k in sorted(cells.items()):
        t = {"gate": "street", "keep": "square"}.get(k, k)
        if t in ("square", "street", "garden"):
            out.append(dict(cell=[dx, dy], tile=t))
        if k == "gate":
            nx, ny = (0, -1) if dy == lo else (0, 1) if dy == hi else (-1, 0) if dx == lo else (1, 0)
            for s in (1, 2):
                out.append(dict(cell=[dx + nx * s, dy + ny * s], tile="street"))
    return out


COL = {"wall": (96, 88, 80), "corner": (70, 62, 56), "ctower": (60, 52, 46), "keep": (120, 60, 50), "gate": (232, 196, 120),
       "square": (214, 206, 186), "street": (196, 186, 164), "garden": (150, 178, 112)}
NAMES = {"wall": "牆（擋路）", "corner": "牆角（擋路）", "ctower": "角樓 2×2（擋路）", "keep": "主堡 3×3（擋路，會射箭）",
         "gate": "城門（可走，一直開著）", "square": "廣場", "street": "街", "garden": "菜園"}


def diagram(L, title, sub, out):
    import artboard
    f = lambda s, b=True: artboard.font(s, weight="bold" if b else "regular")
    C = 34
    xs = [dx for dx, _ in L["cells"]]
    ys = [dy for _, dy in L["cells"]]
    x0, y0 = min(xs), min(ys)
    n = max(xs) - x0 + 1
    left, top = 70, 250
    W = max(left + n * C + 460, 1260)
    H = top + n * C + 140
    img = Image.new("RGB", (W, H), (244, 241, 234))
    dr = ImageDraw.Draw(img)
    dr.text((40, 26), title, font=f(40), fill=(40, 40, 40))
    y = 86
    for line in sub:
        dr.text((40, y), line, font=f(18, False), fill=(90, 90, 90))
        y += 26
    for (dx, dy), k in L["cells"].items():
        px, py = left + (dx - x0) * C, top + (dy - y0) * C
        dr.rectangle([px, py, px + C - 1, py + C - 1], fill=COL[k], outline=(244, 241, 234))
        if k in BLOCKS:
            dr.line([px + 4, py + 4, px + C - 5, py + C - 5], fill=(30, 26, 24), width=2)
    # the old circle, for comparison
    r = 5 if L["name"] == "small" else 7
    cx = left + (0 - x0 + (0 if L["name"] == "large" else 0.5)) * C
    cy = top + (0 - y0 + (0 if L["name"] == "large" else 0.5)) * C
    dr.ellipse([cx - r * C, cy - r * C, cx + r * C, cy + r * C], outline=(200, 60, 50), width=3)
    for mx, my in L["militia"]:
        px, py = left + (mx - x0 + 0.5) * C, top + (my - y0 + 0.5) * C
        dr.ellipse([px - 7, py - 7, px + 7, py + 7], fill=(250, 250, 250), outline=(40, 40, 40), width=2)
    for gx, gy in L["garrison"]:
        px, py = left + (gx - x0 + 0.5) * C, top + (gy - y0 + 0.5) * C
        dr.rectangle([px - 6, py - 6, px + 6, py + 6], fill=(63, 127, 224), outline=(20, 30, 60), width=2)
    # axis labels: dx along the top, dy down the left
    for i in range(n):
        dr.text((left + i * C + 8, top - 24), str(x0 + i), font=f(13, False), fill=(110, 110, 110))
        dr.text((left - 34, top + i * C + 9), str(y0 + i), font=f(13, False), fill=(110, 110, 110))
    lx, ly = left + n * C + 30, top
    for k in ("wall", "corner", "ctower", "tower", "gate", "square", "street", "garden"):
        if k not in L["cells"].values():
            continue
        dr.rectangle([lx, ly, lx + 26, ly + 26], fill=COL[k])
        if k in BLOCKS:
            dr.line([lx + 3, ly + 3, lx + 23, ly + 23], fill=(30, 26, 24), width=2)
        dr.text((lx + 36, ly + 2), NAMES[k], font=f(17, False), fill=(50, 50, 50))
        ly += 38
    dr.ellipse([lx + 6, ly + 6, lx + 20, ly + 20], fill=(250, 250, 250), outline=(40, 40, 40), width=2)
    dr.text((lx + 36, ly + 2), "民兵（B1-03 的位置）", font=f(17, False), fill=(50, 50, 50))
    ly += 38
    dr.rectangle([lx + 7, ly + 7, lx + 19, ly + 19], fill=(63, 127, 224), outline=(20, 30, 60), width=2)
    dr.text((lx + 36, ly + 2), "駐軍（示意，位置照 core）", font=f(17, False), fill=(50, 50, 50))
    ly += 38
    dr.ellipse([lx + 2, ly + 2, lx + 24, ly + 24], outline=(200, 60, 50), width=3)
    dr.text((lx + 36, ly + 2), f"原本的範圍（半徑 {r} 格）", font=f(17, False), fill=(50, 50, 50))
    img.save(out, optimize=True)
    print("wrote", out.name, img.size)


def export(Ls):
    """castle-layout.json (war-game-core makes sim/src/core/castle-layout.ts from it)."""
    out = {}
    for L in Ls:
        c, inside = counts(L)
        by = {}
        for (dx, dy), k in sorted(L["cells"].items(), key=lambda q: (q[0][1], q[0][0])):
            by.setdefault(k, []).append([dx, dy])
        out[L["name"]] = {"origin": "the town's centre cell (the keep's middle cell)", "cells": by,
                          "militia": [list(m) for m in L["militia"]], "garrison": L["garrison"], "counts": c,
                          "inside_walls": inside}
    p = HERE.parent / "castle-layout.json"
    p.write_text(json.dumps(out, indent=1))
    print("wrote", p.name)
    return out


if __name__ == "__main__":
    OUT = HERE.parents[1] / "r6" / "out"
    Ls = [f() for f in LAYOUTS]
    info = export(Ls)
    for L, nm in zip(Ls, ("小鎮", "大城")):
        i = info[L["name"]]
        c = i["counts"]
        sub = [f"牆以內 {i['inside_walls']} 格；擋路的牆 {c.get('wall', 0) + c.get('corner', 0)} 格"
               + (f"、角樓 {c.get('ctower', 0)} 格" if 'ctower' in c else "") + f"；城門 {c.get('gate', 0)} 格（四個門）；主堡 3×3。",
               "格子是 sim 的格，原點：城鎮中心那一格（主堡正中那一格）。+x 往東（畫面右），+y 往南（離鏡頭近）。打叉的格子擋路。",
               "D-100（使用者 2026-10-23）：城鎮放大約 1.5 倍，每座城鎮正中一座會射箭的主堡；格子是 war-game-core 2026-10-23 的提案。"]
        diagram(L, f"D100-城堡-格子-{nm}", sub, OUT / f"D100-城堡-格子-{nm}.png")
