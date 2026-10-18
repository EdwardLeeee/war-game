"""R6 representative battlefield (brief B.2, ceo 2026-10-18): the diamond battlefield near our base, one squad of
ours selected (6 spearmen, 4 crossbowmen) facing an enemy squad coming in, our main city, houses, barracks and a
field, trees and a gold mine. Positions are given on the screen (pt) and turned into cells, so the composition is
set by eye; the camera is on CENTRE.
"""
from field import pt_to_cell, squad

CENTRE = (24.0, 70.0)          # near our spawn (16, 78), the left corner of the diamond


def cell(px, py):
    return pt_to_cell(px, py, CENTRE)


def footprint_at(px, py, n):
    """Top-left cell of an n x n footprint whose centre is drawn at (px, py)."""
    x, y = cell(px, py)
    return round(x - n / 2), round(y - n / 2)


def representative():
    b = []
    for c, btype, st, (px, py), n in (
            ("E", "MainCity", "done", (215, 118), 4),
            ("E", "House", "done", (330, 62), 2),
            ("E", "House", "done", (120, 178), 2),
            ("E", "Barracks", "done", (352, 140), 3),
            ("E", "Farm", "ripe", (205, 222), 3),
            ("E", "Farm", "growing", (300, 252), 3),
            ("E", "ArrowTower", "done", (448, 92), 2)):
        x, y = footprint_at(px, py, n)
        b.append((c, btype, st, x, y, "blue"))
    nodes = []
    for i, (px, py) in enumerate(((560, 52), (600, 70), (640, 48), (668, 84), (615, 104), (700, 60), (560, 92), (645, 128),
                                  (520, 70), (690, 116))):
        x, y = cell(px, py)
        nodes.append((f"tree_E_v{i % 3}", int(x), int(y)))
    for px, py, v in ((626, 168, 0), (652, 184, 1)):
        x, y = cell(px, py)
        nodes.append((f"gold_v{v}_full", int(x), int(y)))
    units = []
    sx, sy = cell(470, 190)
    pos = squad(sx, sy, 5, 2)
    for i, (x, y) in enumerate(pos):              # front row 5 spearmen; back row 1 spearman, 4 crossbowmen
        units.append(("spear_e" if i < 6 else "xbow_e", "blue", x, y, 7, "idle", (i * 3) % 8, True))
    ex, ey = cell(642, 252)
    for i, (x, y) in enumerate(squad(ex, ey, 4, 2)):
        units.append(("pike_w" if i < 4 else "bow_w", "red", x, y, 3, "walk", (i * 2) % 8, False))
    for i, (px, py) in enumerate(((176, 214), (232, 236), (300, 236))):
        x, y = cell(px, py)
        units.append(("farmer_e", "blue", x, y, (6, 7, 0)[i], "idle", i * 2, False))
    return dict(centre=CENTRE, buildings=b, nodes=nodes, units=units)


def raid():
    """Home is hit (NEW-02, INV-37): an enemy squad at our fields attacking the farmers; nothing of ours selected."""
    sc = representative()
    units = [u for u in sc["units"] if u[1] == "blue" and u[0] != "farmer_e"]
    units = [(u[0], u[1], u[2], u[3], u[4], u[5], u[6], False) for u in units]
    ex, ey = cell(250, 262)
    for i, (x, y) in enumerate(squad(ex, ey, 3, 2)):
        units.append(("pike_w" if i < 3 else "bow_w", "red", x, y, 3, "attack", (i * 3) % 10, False))
    for i, (px, py) in enumerate(((176, 214), (205, 238))):
        x, y = cell(px, py)
        units.append(("farmer_e", "blue", x, y, 7, "walk", i * 3, False))
    return dict(sc, units=units)
